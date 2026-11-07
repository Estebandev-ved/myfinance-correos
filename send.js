/**
 * Myfinance — correos desde GitHub Actions (sin Cloud Functions, sin plan Blaze).
 *
 *   node send.js frequent    cada ~15 min: bienvenida, alertas de presupuesto, racha y avisos de metas en grupo
 *   node send.js morning     8:00  pendientes del día
 *   node send.js afternoon   14:00 "¿ya anotaste?" (solo si no ha registrado hoy)
 *   node send.js night       20:00 "cierra tu día"  (solo si no ha registrado hoy; avisa si la racha corre peligro)
 *   node send.js miss        10:00 inactividad: avisos a los 7, 14, 21 y 27 días sin abrir la app; a los 30 se libera el cupo
 *                            (solo si RELEASE_SEATS=1; sin esa variable es un ensayo que le avisa al admin). Ver inactivity.js
 *   node send.js weekly      domingos 18:00 resumen de la semana
 *   node send.js monthly     día 1, 9:00 cierre del mes anterior
 *   node send.js pushupdate  aviso push "hay una versión nueva" a todos los dispositivos con avisos activados
 *
 * Variables: FIREBASE_SERVICE_ACCOUNT (JSON de la llave), BREVO_API_KEY, SENDER_EMAIL, ADMIN_EMAIL (opcional),
 * VAPID_PRIVATE_KEY (solo para los avisos push).
 * Solo lee `notify`, `members` y las metas en grupo; nunca toca los respaldos. Todo lo que se manda a un
 * amigo (menos la bienvenida) exige que él haya activado "Recordatorios por correo".
 */
const admin = require('firebase-admin')
const webpush = require('web-push')
// El diseño de los correos vive aparte (ver mail-templates.js y mail-ui.js); aquí solo se decide a quién y cuándo
const T = require('./mail-templates')
const { esc } = require('./mail-ui')

const { FIREBASE_SERVICE_ACCOUNT, BREVO_API_KEY, SENDER_EMAIL } = process.env
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'grubiano23@gmail.com'
for (const [k, v] of Object.entries({ FIREBASE_SERVICE_ACCOUNT, BREVO_API_KEY, SENDER_EMAIL })) {
  if (!v) {
    console.error(`Falta la variable ${k}`)
    process.exit(1)
  }
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) })
const db = admin.firestore()

const APP_URL = 'https://myfinance-gr23.web.app'
const TZ = 'America/Bogota'
const DAY = 86_400_000
const STALE_AFTER_MS = 14 * DAY
const { MILESTONES, money } = T
const { decide } = require('./inactivity')

const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const shiftDay = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
const monthName = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('es-CO', { month: 'long', timeZone: 'UTC' })

/** Días seguidos que terminan en `endKey` (cuenta hacia atrás mientras haya registros) */
function streakEnding(days, endKey) {
  let n = 0
  for (let k = endKey; days.has(k); k = shiftDay(k, -1)) n++
  return n
}

// DRY_RUN=1: solo muestra qué se enviaría, sin enviar ni marcar nada
const DRY = process.env.DRY_RUN === '1'

async function sendMail(to, name, subject, html) {
  if (DRY) return console.log(`[DRY] a ${to}: ${subject}`)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Myfinance', email: SENDER_EMAIL }, to: [{ email: to, name: name || undefined }], subject, htmlContent: html }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`)
}

const loadNotify = async () => (await db.collection('notify').where('enabled', '==', true).get()).docs
const fresh = (d) => Date.now() - (d.updatedAt?.toMillis?.() ?? 0) <= STALE_AFTER_MS
const daysOf = (d) => new Set(Array.isArray(d.digest?.days) ? d.digest.days : [])

/** Recorre a quienes tienen los avisos activos; `fn` devuelve {subject, html, mark} o null para saltar */
async function forEachPerson(label, docs, fn) {
  let sent = 0
  for (const doc of docs) {
    const d = doc.data()
    if (!d.email) continue
    try {
      const mail = await fn(d, doc.id)
      if (!mail) continue
      await sendMail(d.email, d.name, mail.subject, mail.html)
      if (!DRY) await doc.ref.set(mail.mark, { merge: true })
      sent++
    } catch (e) {
      console.error(`No se pudo enviar (${label})`, doc.id, String(e))
    }
  }
  console.log(`${label}: ${sent} correo(s) enviados de ${docs.length} activados`)
}

/* ───────────── Bienvenida ───────────── */
async function welcome() {
  const snap = await db.collection('members').get()
  let sent = 0
  for (const doc of snap.docs) {
    const m = doc.data()
    if (m.welcomedAt || !m.email) continue
    try {
      const mail = T.welcomeMail(m)
      await sendMail(m.email, m.name, mail.subject, mail.html)
      // Se marca primero: si el aviso al admin falla, no se le repite la bienvenida al amigo
      if (!DRY) await doc.ref.set({ welcomedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      const note = T.adminJoinMail(m)
      await sendMail(ADMIN_EMAIL, 'Admin', note.subject, note.html).catch((e) => console.error('Aviso al admin', String(e)))
      sent++
    } catch (e) {
      console.error('No se pudo enviar la bienvenida', doc.id, String(e))
    }
  }
  console.log(`Bienvenida: ${sent} correo(s) enviados de ${snap.size} miembros`)
}

/* ───────────── Alerta de presupuesto: al llegar al 80 % y al 100 % del tope ───────────── */
async function budgetAlerts(docs) {
  const month = dayKey(Date.now()).slice(0, 7)
  await forEachPerson('Alertas de presupuesto', docs, (d) => {
    const found = []
    const mark = {}
    for (const b of Array.isArray(d.digest?.budgets) ? d.digest.budgets : []) {
      if (!b.limit) continue
      const pct = (b.spent / b.limit) * 100
      const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0
      const key = `${month}|${b.category}`
      if (!level || level <= (d.alerts?.[key] ?? 0)) continue
      mark[key] = level
      found.push({
        level: level === 100 ? 'late' : 'soon',
        title: level === 100 ? `Te pasaste en ${b.category}` : `${b.category} va al ${Math.round(pct)}% del tope`,
        detail: `${money(b.spent)} de ${money(b.limit)} este mes`,
        pct,
      })
    }
    if (!found.length) return null
    return { ...T.budgetMail(d.name, found), mark: { alerts: mark } }
  })
}

/* ───────────── Racha: al llegar a 3, 7, 14, 30… días seguidos ───────────── */
async function streakCheers(docs) {
  const today = dayKey(Date.now())
  await forEachPerson('Racha', docs, (d) => {
    const days = daysOf(d)
    if (!days.has(today)) return null
    const streak = streakEnding(days, today)
    const tag = `${streak}@${today}`
    if (!MILESTONES.includes(streak) || d.streakSent === tag) return null
    return { ...T.streakMail(d.name, streak), mark: { streakSent: tag } }
  })
}

/* ───────────── A la hora en que suele anotar: un aviso suave, solo al celular ───────────── */
const hourNow = () => Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }))

async function usualHourPush(docs) {
  const today = dayKey(Date.now())
  const hour = hourNow()
  let sent = 0
  for (const doc of docs) {
    const d = doc.data()
    // Solo a su hora habitual, una vez al día, sin insistir a quien lleva semanas sin abrir la app
    if (d.usualHour !== hour || d.sent?.usual === today || !fresh(d)) continue
    // Si hoy ya anotó (o marcó "hoy no gasté"), no hace falta
    if ((d.lastTxAt && dayKey(d.lastTxAt) === today) || (d.lastQuietAt && dayKey(d.lastQuietAt) === today)) continue
    const streak = streakEnding(daysOf(d), shiftDay(today, -1))
    try {
      const n = await pushToUid(doc.id, {
        title: 'Tu ruta de hoy te espera',
        body: streak >= 2 ? `Tres pasos cortos, 2 minutos. Tu racha de ${streak} días sigue viva.` : 'Tres pasos cortos, 2 minutos: anota tu día, mira cómo vas y aprende algo.',
        url: '/',
        tag: 'myfinance-usual',
      })
      if (!DRY) await doc.ref.set({ sent: { usual: today } }, { merge: true })
      if (n) sent++
    } catch (e) {
      console.error('No se pudo enviar el aviso de la hora habitual', doc.id, String(e))
    }
  }
  console.log(`Hora habitual (${hour}h): ${sent} aviso(s)`)
}

/* ───────────── Aviso de meta en grupo: cuando alguien aporta ───────────── */
async function groupNews(notifyDocs) {
  const byUid = new Map(notifyDocs.map((x) => [x.id, x.data()]))
  const groups = await db.collection('groups').get()
  let sent = 0
  for (const g of groups.docs) {
    const stateRef = db.collection('mailState').doc(g.id)
    const state = await stateRef.get()
    const now = Date.now()
    if (!state.exists) {
      // Primera vez que vemos esta meta: no avisamos de lo que ya estaba
      if (!DRY) await stateRef.set({ lastCheck: now })
      continue
    }
    const since = state.data().lastCheck
    const recent = (await g.ref.collection('contributions').where('date', '>', since).get()).docs.map((x) => x.data())
    if (!DRY) await stateRef.set({ lastCheck: now })
    if (!recent.length) continue

    const group = g.data()
    const all = (await g.ref.collection('contributions').get()).docs.reduce((s, x) => s + (x.data().amount || 0), 0)
    const pct = group.target ? Math.min(100, Math.round((all / group.target) * 100)) : 0
    const members = await g.ref.collection('members').get()
    for (const m of members.docs) {
      const n = byUid.get(m.id)
      const others = recent.filter((c) => c.uid !== m.id)
      if (!n?.email || !others.length) continue
      try {
        const mail = T.groupMail(n.name, group, others, all, pct)
        await sendMail(n.email, n.name, mail.subject, mail.html)
        sent++
      } catch (e) {
        console.error('No se pudo avisar de la meta', g.id, m.id, String(e))
      }
    }
  }
  console.log(`Metas en grupo: ${sent} correo(s) enviados`)
}

/* ───────────── Avisos push al celular ───────────── */
// Clave pública VAPID: la misma que usa la app (src/lib/push.ts). La privada va en el secreto VAPID_PRIVATE_KEY.
const VAPID_PUBLIC = 'BKSYQNqfALcnOlyS3l8abnVdg8o0B6tcy4QwFlKM6R2s604I3JRAJ0NFhCC8WZYx4ERqNUEIfM75D025QfLTd-Q'

/** Manda una notificación a todos los dispositivos que activaron los avisos. Devuelve a cuántos llegó. */
async function sendPush({ title, body, url = '/' }) {
  if (!process.env.VAPID_PRIVATE_KEY) throw new Error('Falta el secreto VAPID_PRIVATE_KEY para enviar avisos push')
  webpush.setVapidDetails(`mailto:${ADMIN_EMAIL}`, VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY)
  const subs = await db.collection('pushSubs').get()
  const seen = new Set()
  let sent = 0
  for (const doc of subs.docs) {
    let sub
    try {
      sub = JSON.parse(doc.data().sub)
    } catch {
      continue
    }
    if (!sub?.endpoint || seen.has(sub.endpoint)) continue
    seen.add(sub.endpoint)
    if (DRY) {
      console.log(`[DRY] push a ${doc.id}: ${title}`)
      sent++
      continue
    }
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body, url, tag: 'myfinance-update' }), { TTL: 60 * 60 * 24, urgency: 'high' })
      sent++
    } catch (e) {
      // 404/410: el dispositivo ya no recibe avisos (desinstaló la app o los apagó)
      if (e.statusCode === 404 || e.statusCode === 410) await doc.ref.delete().catch(() => undefined)
      else console.error('No se pudo enviar el push', doc.id, String(e.statusCode || e))
    }
  }
  console.log(`Push «${title}»: ${sent} de ${subs.size} dispositivos`)
  return sent
}

/** Aviso push a los dispositivos de UNA persona. Si no hay clave VAPID o no activó los avisos, no hace nada. */
async function pushToUid(uid, { title, body, url = '/', tag = 'myfinance-streak' }) {
  if (DRY) return console.log(`[DRY] push a ${uid}: ${title}`)
  if (!process.env.VAPID_PRIVATE_KEY) return 0
  webpush.setVapidDetails(`mailto:${ADMIN_EMAIL}`, VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY)
  const subs = await db.collection('pushSubs').where('uid', '==', uid).get()
  const seen = new Set()
  let sent = 0
  for (const doc of subs.docs) {
    let sub
    try {
      sub = JSON.parse(doc.data().sub)
    } catch {
      continue
    }
    if (!sub?.endpoint || seen.has(sub.endpoint)) continue
    seen.add(sub.endpoint)
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body, url, tag }), { TTL: 60 * 60 * 6, urgency: 'normal' })
      sent++
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await doc.ref.delete().catch(() => undefined)
      else console.error('No se pudo enviar el push personal', uid, String(e.statusCode || e))
    }
  }
  return sent
}

/* ───────────── Correos redactados por el admin en su panel (colección outbox) ───────────── */
async function processOutbox() {
  const pending = await db.collection('outbox').where('status', '==', 'pending').get()
  for (const job of pending.docs) {
    const o = job.data()
    if (o.channel === 'push') {
      if (!DRY) await job.ref.update({ status: 'sending' })
      let n = 0
      try {
        n = await sendPush({ title: o.subject, body: o.body })
      } catch (e) {
        console.error('Falló el aviso push', String(e))
      }
      if (!DRY) await job.ref.update({ status: 'sent', sent: n, sentAt: admin.firestore.FieldValue.serverTimestamp() })
      continue
    }
    // Se marca antes de enviar: si algo falla a medias, no se reenvía a quienes ya lo recibieron
    if (!DRY) await job.ref.update({ status: 'sending' })
    let people
    if (o.audience === 'me') people = [{ email: ADMIN_EMAIL, name: 'Admin' }]
    else if (o.audience === 'reminders') people = (await loadNotify()).map((x) => x.data())
    else people = (await db.collection('members').get()).docs.map((x) => x.data())
    const seen = new Set()
    let sent = 0
    for (const p of people) {
      if (!p.email || seen.has(p.email)) continue
      seen.add(p.email)
      try {
        const mail = T.adminMail(p.name, o.subject, o.body)
        await sendMail(p.email, p.name, mail.subject, mail.html)
        sent++
      } catch (e) {
        console.error('No se pudo enviar el correo del admin', p.email, String(e))
      }
    }
    if (!DRY) await job.ref.update({ status: 'sent', sent, sentAt: admin.firestore.FieldValue.serverTimestamp() })
    console.log(`Correo del admin «${o.subject}»: ${sent} de ${seen.size}`)
  }
}

async function frequent() {
  const docs = await loadNotify()
  for (const [label, fn] of [
    ['welcome', () => welcome()],
    ['budgets', () => budgetAlerts(docs)],
    ['streak', () => streakCheers(docs)],
    ['usual', () => usualHourPush(docs)],
    ['groups', () => groupNews(docs)],
    ['outbox', () => processOutbox()],
  ]) {
    await fn().catch((e) => console.error(`Falló ${label}`, String(e)))
  }
}

/* ───────────── Recordatorios: 8:00, 14:00 y 20:00 ───────────── */
// skipIfRegistered: a quien ya anotó hoy (o marcó "hoy no gasté") no se le insiste. El diseño está en mail-templates.js
const SLOTS = { morning: { skipIfRegistered: false }, afternoon: { skipIfRegistered: true }, night: { skipIfRegistered: true } }

async function remind(slot) {
  const cfg = SLOTS[slot]
  const today = dayKey(Date.now())
  await forEachPerson(`Recordatorio ${slot}`, await loadNotify(), async (d, uid) => {
    // Ya enviado este turno hoy, o la app lleva más de 2 semanas sin abrirse (no insistimos)
    if (d.sent?.[slot] === today || !fresh(d)) return null
    const loggedToday = (d.lastTxAt && dayKey(d.lastTxAt) === today) || (d.lastQuietAt && dayKey(d.lastQuietAt) === today)
    if (cfg.skipIfRegistered && loggedToday) return null
    const items = Array.isArray(d.items) ? d.items : []
    const streak = streakEnding(daysOf(d), shiftDay(today, -1))
    const { subject, html } = T.reminderMail(slot, d.name, items, streak)
    // Por la mañana, con pendientes vencidos o por vencer, además del correo va un aviso al celular
    if (slot === 'morning' && items.length) {
      const late = items.filter((i) => i.level === 'late').length
      await pushToUid(uid, {
        title: late ? `${late} pendiente${late > 1 ? 's' : ''} vencido${late > 1 ? 's' : ''}` : `Tienes ${items.length} pendiente${items.length > 1 ? 's' : ''}`,
        body: items[0].detail ? `${items[0].title}. ${items[0].detail}` : items[0].title,
        url: '/',
        tag: 'myfinance-pending',
      })
    }
    // De noche, con racha viva y nada anotado hoy, además del correo va un aviso al celular
    if (slot === 'night' && streak >= 2) await pushToUid(uid, { title: `🔥 Tu racha de ${streak} días corre peligro`, body: 'Anota un gasto pequeño y sigue viva.', url: '/nuevo' })
    return { subject, html, mark: { sent: { [slot]: today } } }
  })
}

/* ───────────── Inactividad: 4 avisos y, si no vuelve, se libera su cupo ─────────────
 * Quien lleva INACTIVITY.stages[0] días sin abrir la app recibe un aviso cada semana más o menos (7, 14, 21 y 27 días).
 * Abrir la app una sola vez cancela todo. Si pasan 30 días y el último aviso tiene 3 o más días, se le quita el acceso
 * (se borra members/{uid}) pero NO se borra ningún dato suyo. El cupo (config/spots.used) NO baja solo: el administrador
 * decide a quién dársela desde el panel (released/{uid}).
 * RELEASE_SEATS=1 es lo que de verdad libera; sin esa variable solo se ensaya: se le avisa al admin a quién se le
 * liberaría y no se toca a nadie. Quien tenga members/{uid}.keep = true se salta (por si hay que protegerlo). */
const RELEASE = process.env.RELEASE_SEATS === '1'
/** INACTIVITY_FROM=AAAA-MM-DD: desde cuándo corre la regla (el día que se le avisó a todos). */
const POLICY_FROM = Date.parse(process.env.INACTIVITY_FROM || '')

async function inactivity() {
  const nowMs = Date.now()
  const members = await db.collection('members').get()
  const candidates = []
  let sent = 0
  let reset = 0
  for (const m of members.docs) {
    const md = m.data()
    const uid = m.id
    if (md.keep === true || String(md.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) continue
    try {
      const u = (await db.collection('users').doc(uid).get()).data() ?? {}
      // La cuenta regresiva no empieza antes de INACTIVITY_FROM (la fecha en que se anunció la regla): nadie recibe los 4
      // avisos de golpe ni pierde el cupo por una inactividad anterior al aviso. Sin esa variable, cuenta desde la última vez que entró.
      const seen = u.lastSeen?.toMillis?.() ?? md.joinedAt?.toMillis?.() ?? null
      if (!seen) continue
      const lastSeen = Math.max(seen, Number.isFinite(POLICY_FROM) ? POLICY_FROM : 0)
      const ref = db.collection('inactivity').doc(uid)
      const st = (await ref.get()).data() ?? {}
      const d = decide({ lastSeen, st, nowMs })
      if (d.action === 'none') continue
      // Volvió a abrir la app: se borra el seguimiento y listo
      if (d.action === 'reset') {
        if (!DRY) await ref.delete()
        reset++
        continue
      }
      const email = u.email || md.email
      if (!email) continue
      const name = u.displayName || md.name
      if (d.action === 'warn') {
        const mail = T.inactivityMail(d.stage, name, d.idle)
        await sendMail(email, name, mail.subject, mail.html)
        if (!DRY) await ref.set({ since: lastSeen, stage: d.stage, sentAt: nowMs, email }, { merge: true })
        sent++
        continue
      }
      candidates.push({ uid, name, email, idle: d.idle, lastSeen, ref, reported: st.dryReported === true })
    } catch (e) {
      console.error('Inactividad', uid, String(e))
    }
  }

  // Quién se queda sin cupo: solo se avisa al admin de los que aún no le habíamos contado (en ensayo no se repite cada día)
  const toRelease = RELEASE ? candidates : candidates.filter((c) => !c.reported)
  if (toRelease.length) {
    const waiting = (await db.collection('waitlist').count().get()).data().count
    if (RELEASE && !DRY) {
      for (const c of toRelease) {
        await db.collection('released').doc(c.uid).set({ name: c.name || null, email: c.email, idle: c.idle, lastSeen: c.lastSeen, releasedAt: admin.firestore.FieldValue.serverTimestamp(), seatGiven: false })
        await db.collection('members').doc(c.uid).delete()
        await c.ref.delete()
        const mail = T.releasedMail(c.name)
        await sendMail(c.email, c.name, mail.subject, mail.html).catch((e) => console.error('Aviso de cupo liberado', c.uid, String(e)))
      }
    } else if (!DRY) {
      for (const c of toRelease) await c.ref.set({ dryReported: true }, { merge: true })
    }
    const note = T.adminReleaseMail(toRelease, waiting, !RELEASE)
    await sendMail(ADMIN_EMAIL, 'Admin', note.subject, note.html).catch((e) => console.error('Aviso al admin', String(e)))
  }
  console.log(`Inactividad: ${sent} aviso(s), ${reset} que volvieron, ${toRelease.length} cupo(s) ${RELEASE ? 'liberados' : 'por liberar (ensayo)'} de ${members.size} miembros`)
}

/* ───────────── Resumen semanal ───────────── */
async function weekly() {
  const today = dayKey(Date.now())
  await forEachPerson('Resumen semanal', await loadNotify(), async (d, uid) => {
    const w = d.digest?.week
    if (!w || !w.count || d.sent?.weekly === today || !fresh(d)) return null
    const days = daysOf(d)
    // Los últimos 7 días, del más viejo a hoy, para dibujar los círculos del correo
    const keys = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6))
    const flags = keys.map((k) => days.has(k))
    const labels = keys.map((k) => 'DLMMJVS'[new Date(`${k}T12:00:00Z`).getUTCDay()])
    const registered = flags.filter(Boolean).length
    const change = w.prevSpent > 0 ? Math.round(((w.spent - w.prevSpent) / w.prevSpent) * 100) : null
    await pushToUid(uid, { title: `Tu semana: gastaste ${money(w.spent)}`, body: change === null ? 'Mira el resumen completo en Myfinance.' : change > 10 ? 'Gastaste más que la semana pasada. Revisa en qué se fue.' : change < -10 ? '¡Bajaste el gasto frente a la semana pasada!' : 'Vas parejo con la semana pasada.', url: '/resumen', tag: 'myfinance-weekly' })
    return { ...T.weeklyMail(d.name, w, { change, registered, flags, labels }), mark: { sent: { weekly: today } } }
  })
}

/* ───────────── Cierre de mes ───────────── */
async function monthly() {
  const today = dayKey(Date.now())
  const prevKey = shiftDay(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  await forEachPerson('Cierre de mes', await loadNotify(), async (d, uid) => {
    const m = (Array.isArray(d.digest?.months) ? d.digest.months : []).find((x) => x.key === prevKey)
    if (!m || !m.count || d.sent?.monthly === prevKey || !fresh(d)) return null
    const balance = m.income - m.expense
    const name = monthName(prevKey)
    await pushToUid(uid, { title: `Así cerró tu ${name}`, body: balance >= 0 ? `Cerraste en positivo: ${money(balance)}.` : `Te pasaste por ${money(-balance)}. Revisa en qué se fue.`, url: '/', tag: 'myfinance-monthly' })
    return { ...T.monthlyMail(d.name, m, name), mark: { sent: { monthly: prevKey } } }
  })
}

const JOBS = { pushupdate: () => sendPush({ title: 'Hay una versión nueva de Myfinance', body: 'Ábrela para actualizar y ver las mejoras.' }), frequent, welcome, morning: () => remind('morning'), afternoon: () => remind('afternoon'), night: () => remind('night'), miss: inactivity, weekly, monthly }
const mode = process.argv[2]
const run = JOBS[mode] ? JOBS[mode]() : Promise.reject(new Error(`Modo desconocido: ${mode}`))
run.then(() => process.exit(0), (e) => {
  console.error(e)
  process.exit(1)
})
