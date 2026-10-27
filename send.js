/**
 * Myfinance — correos desde GitHub Actions (sin Cloud Functions, sin plan Blaze).
 *
 *   node send.js frequent    cada ~15 min: bienvenida, alertas de presupuesto, racha y avisos de metas en grupo
 *   node send.js morning     8:00  pendientes del día
 *   node send.js afternoon   14:00 "¿ya anotaste?" (solo si no ha registrado hoy)
 *   node send.js night       20:00 "cierra tu día"  (solo si no ha registrado hoy; avisa si la racha corre peligro)
 *   node send.js miss        10:00 "te extrañamos" a quien lleva 3 y 7 días sin abrir la app
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
const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const shiftDay = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
const firstName = (n) => esc(String(n || 'amigo').trim().split(/\s+/)[0])
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
const monthName = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('es-CO', { month: 'long', timeZone: 'UTC' })

/** Días seguidos que terminan en `endKey` (cuenta hacia atrás mientras haya registros) */
function streakEnding(days, endKey) {
  let n = 0
  for (let k = endKey; days.has(k); k = shiftDay(k, -1)) n++
  return n
}

const OFF_NOTE = 'Puedes apagar estos correos en Más → Ajustes → Recordatorios por correo.'

function layout(inner, footer = OFF_NOTE) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
    <h2 style="color:#e5253b;margin:0 0 4px">Myfinance</h2>
    ${inner}
    <p style="margin:20px 0"><a href="${APP_URL}" style="background:#e5253b;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir Myfinance</a></p>
    <p style="color:#888;font-size:12px">${footer}</p>
  </div>`
}

function rows(items) {
  const html = items
    .map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee"><b style="color:${i.level === 'late' ? '#d62839' : '#b36b00'}">${esc(i.title)}</b><br><span style="color:#666;font-size:13px">${esc(i.detail)}</span></td></tr>`)
    .join('')
  return html ? `<table style="width:100%;border-collapse:collapse;margin-top:12px">${html}</table>` : ''
}

const stat = (label, value, color = '#111') =>
  `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">${esc(label)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${color}">${esc(value)}</td></tr>`
const statTable = (list) => `<table style="width:100%;border-collapse:collapse;margin-top:12px">${list.join('')}</table>`

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
      const mail = await fn(d)
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
      await sendMail(
        m.email,
        m.name,
        '¡Bienvenido a Myfinance!',
        layout(`<p style="margin:0 0 12px">Hola ${firstName(m.name)}, ya eres parte de Myfinance. 🎉</p>
          <p style="margin:0 0 8px">Para empezar con el pie derecho:</p>
          <ol style="margin:0;padding-left:20px;line-height:1.7">
            <li>Registra tus movimientos del día (toma 10 segundos).</li>
            <li>Ponle un tope a tus gastos en <b>Presupuesto</b>.</li>
            <li>Crea una meta de ahorro y mira cómo crece.</li>
            <li>Activa los <b>recordatorios por correo</b> en Más → Ajustes para no olvidarte de anotar.</li>
          </ol>
          <p style="margin:12px 0 0;color:#666;font-size:13px">Tip: instálala en tu celular desde el menú del navegador → "Agregar a pantalla de inicio".</p>`),
      )
      // Se marca primero: si el aviso al admin falla, no se le repite la bienvenida al amigo
      if (!DRY) await doc.ref.set({ welcomedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      await sendMail(ADMIN_EMAIL, 'Admin', `Myfinance: se unió ${m.name || m.email}`, layout(`<p>${esc(m.name || '')} (${esc(m.email)}) acaba de entrar con su código de invitación.</p>`)).catch((e) => console.error('Aviso al admin', String(e)))
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
      })
    }
    if (!found.length) return null
    const subject = found.length > 1 ? `Myfinance: ${found.length} alertas de presupuesto` : `Myfinance: ${found[0].title}`
    return { subject, html: layout(`<p style="margin:0">Ojo ${firstName(d.name)}, mira cómo vas con tus topes:</p>${rows(found)}`), mark: { alerts: mark } }
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
    return {
      subject: `🔥 ¡${streak} días seguidos en Myfinance!`,
      html: layout(`<p style="margin:0 0 8px;font-size:18px"><b>${streak} días seguidos</b> registrando tus movimientos.</p><p style="margin:0">${firstName(d.name)}, eso es constancia de la buena: así se construyen las finanzas sanas. Mañana, a por el día ${streak + 1}. 💪</p>`),
      mark: { streakSent: tag },
    }
  })
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
      const lines = others.map((c) => `<li><b>${esc(c.name)}</b> aportó ${money(c.amount)}${c.note ? ` — ${esc(c.note)}` : ''}</li>`).join('')
      try {
        await sendMail(
          n.email,
          n.name,
          `Myfinance: novedades en «${group.name}»`,
          layout(`<p style="margin:0 0 8px">Hola ${firstName(n.name)}, se movió la meta <b>${esc(group.name)}</b>:</p><ul style="margin:0 0 12px;padding-left:20px;line-height:1.7">${lines}</ul>
            <p style="margin:0">Ya llevan <b>${money(all)}</b> de ${money(group.target)} (<b>${pct}%</b>). ${pct >= 100 ? '¡Meta cumplida! 🎉' : '¿Y tú ya pusiste tu parte?'}</p>`),
        )
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
      const text = esc(o.body).replace(/\r?\n/g, '<br>')
      try {
        await sendMail(p.email, p.name, o.subject, layout(`<p style="margin:0 0 12px">Hola ${firstName(p.name)},</p><p style="margin:0;line-height:1.6">${text}</p>`, 'Recibes este correo porque eres parte de Myfinance.'))
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
    ['groups', () => groupNews(docs)],
    ['outbox', () => processOutbox()],
  ]) {
    await fn().catch((e) => console.error(`Falló ${label}`, String(e)))
  }
}

/* ───────────── Recordatorios: 8:00, 14:00 y 20:00 ───────────── */
const SLOTS = {
  morning: {
    skipIfRegistered: false,
    build(name, items) {
      const urgent = items.filter((i) => i.level === 'late').length
      const subject = items.length
        ? urgent ? `Myfinance: ${urgent} pendiente${urgent > 1 ? 's' : ''} vencido${urgent > 1 ? 's' : ''}` : `Myfinance: tienes ${items.length} pendiente${items.length > 1 ? 's' : ''}`
        : 'Buenos días: ¿qué vas a registrar hoy?'
      const body = items.length
        ? `<p style="margin:0 0 4px">Buenos días ${name}, esto es lo que necesita tu atención hoy:</p>${rows(items)}`
        : `<p style="margin:0">Buenos días ${name} ☀️ Un buen día empieza sabiendo cuánto tienes. Anota lo de ayer que se te haya quedado por fuera.</p>`
      return { subject, html: layout(body) }
    },
  },
  afternoon: {
    skipIfRegistered: true,
    build(name) {
      return {
        subject: '¿Ya anotaste tus gastos de hoy?',
        html: layout(`<p style="margin:0">Hola ${name}, todavía no has registrado nada hoy. Anotar el almuerzo y el transporte toma 10 segundos y mantiene tus cuentas claras. 💪</p>`),
      }
    },
  },
  night: {
    skipIfRegistered: true,
    build(name, _items, streak) {
      return streak >= 3
        ? {
            subject: `🔥 No pierdas tu racha de ${streak} días`,
            html: layout(`<p style="margin:0">${name}, llevas <b>${streak} días seguidos</b> registrando y hoy todavía no has anotado nada. Anota aunque sea un gasto pequeño y tu racha sigue viva.</p>`),
          }
        : {
            subject: 'Cierra tu día en Myfinance 🌙',
            html: layout(`<p style="margin:0">${name}, no dejes que se te olvide: registra lo que gastaste o ganaste hoy antes de dormir. Mañana ya no te acordarás de los detalles.</p>`),
          }
    },
  },
}

async function remind(slot) {
  const cfg = SLOTS[slot]
  const today = dayKey(Date.now())
  await forEachPerson(`Recordatorio ${slot}`, await loadNotify(), (d) => {
    // Ya enviado este turno hoy, o la app lleva más de 2 semanas sin abrirse (no insistimos)
    if (d.sent?.[slot] === today || !fresh(d)) return null
    if (cfg.skipIfRegistered && d.lastTxAt && dayKey(d.lastTxAt) === today) return null
    const items = Array.isArray(d.items) ? d.items : []
    const { subject, html } = cfg.build(firstName(d.name), items, streakEnding(daysOf(d), shiftDay(today, -1)))
    return { subject, html, mark: { sent: { [slot]: today } } }
  })
}

/* ───────────── Te extrañamos: a los 3 y a los 7 días sin abrir la app ───────────── */
async function miss() {
  await forEachPerson('Te extrañamos', await loadNotify(), (d) => {
    const updated = d.updatedAt?.toMillis?.() ?? 0
    const idle = Math.floor((Date.now() - updated) / DAY)
    const stage = idle >= 7 ? 7 : idle >= 3 ? 3 : 0
    if (!stage || (d.missSince === updated && d.missStage >= stage)) return null
    const name = firstName(d.name)
    return {
      subject: stage === 3 ? `${name}, te extrañamos en Myfinance` : `Hace una semana que no te vemos, ${name}`,
      html: layout(
        stage === 3
          ? `<p style="margin:0">Hola ${name}, llevas ${idle} días sin pasar por Myfinance. No pasa nada: abre la app, anota lo que gastaste estos días y vuelve a tomar el control. Toma 2 minutos. 🙌</p>`
          : `<p style="margin:0">${name}, ya pasó una semana. Tus cuentas no se organizan solas, pero ponerlas al día es más fácil de lo que parece: anota lo grande primero y lo demás después. Aquí te esperamos. 💚</p>`,
      ),
      mark: { missSince: updated, missStage: stage },
    }
  })
}

/* ───────────── Resumen semanal ───────────── */
async function weekly() {
  const today = dayKey(Date.now())
  await forEachPerson('Resumen semanal', await loadNotify(), (d) => {
    const w = d.digest?.week
    if (!w || !w.count || d.sent?.weekly === today || !fresh(d)) return null
    const days = daysOf(d)
    const registered = Array.from({ length: 7 }, (_, i) => shiftDay(today, -i)).filter((k) => days.has(k)).length
    const change = w.prevSpent > 0 ? Math.round(((w.spent - w.prevSpent) / w.prevSpent) * 100) : null
    const list = [stat('Gastaste', money(w.spent), '#d62839'), stat('Ingresaste', money(w.income), '#1a9d5c')]
    if (change !== null) list.push(stat('Frente a la semana pasada', `${change > 0 ? '+' : ''}${change}%`, change > 0 ? '#d62839' : '#1a9d5c'))
    if (w.topCat) list.push(stat('Donde más gastaste', `${w.topCat} (${money(w.topAmount)})`))
    list.push(stat('Días que registraste', `${registered} de 7`))
    const verdict = change === null ? '' : change > 10 ? 'Gastaste más que la semana pasada: revisa en qué se fue.' : change < -10 ? '¡Bajaste el gasto frente a la semana pasada! Sigue así.' : 'Vas estable frente a la semana pasada.'
    return {
      subject: `Tu semana en Myfinance: gastaste ${money(w.spent)}`,
      html: layout(`<p style="margin:0">Hola ${firstName(d.name)}, así te fue esta semana:</p>${statTable(list)}${verdict ? `<p style="margin:12px 0 0">${verdict}</p>` : ''}`),
      mark: { sent: { weekly: today } },
    }
  })
}

/* ───────────── Cierre de mes ───────────── */
async function monthly() {
  const today = dayKey(Date.now())
  const prevKey = shiftDay(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  await forEachPerson('Cierre de mes', await loadNotify(), (d) => {
    const m = (Array.isArray(d.digest?.months) ? d.digest.months : []).find((x) => x.key === prevKey)
    if (!m || !m.count || d.sent?.monthly === prevKey || !fresh(d)) return null
    const balance = m.income - m.expense
    const name = monthName(prevKey)
    const list = [stat('Ingresos', money(m.income), '#1a9d5c'), stat('Gastos', money(m.expense), '#d62839'), stat('Balance', money(balance), balance >= 0 ? '#1a9d5c' : '#d62839')]
    if (m.topCat) list.push(stat('Donde más gastaste', `${m.topCat} (${money(m.topAmount)})`))
    return {
      subject: `Así cerró tu ${name} en Myfinance`,
      html: layout(`<p style="margin:0">Hola ${firstName(d.name)}, este fue tu balance de <b>${esc(name)}</b>:</p>${statTable(list)}<p style="margin:12px 0 0">${balance >= 0 ? 'Cerraste en positivo. ' : 'Gastaste más de lo que ingresó. '}Empieza el mes con topes nuevos en <b>Presupuesto</b> y que este sea mejor. 🚀</p>`),
      mark: { sent: { monthly: prevKey } },
    }
  })
}

const JOBS = { pushupdate: () => sendPush({ title: 'Hay una versión nueva de Myfinance', body: 'Ábrela para actualizar y ver las mejoras.' }), frequent, welcome, morning: () => remind('morning'), afternoon: () => remind('afternoon'), night: () => remind('night'), miss, weekly, monthly }
const mode = process.argv[2]
const run = JOBS[mode] ? JOBS[mode]() : Promise.reject(new Error(`Modo desconocido: ${mode}`))
run.then(() => process.exit(0), (e) => {
  console.error(e)
  process.exit(1)
})
