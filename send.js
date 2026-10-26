/**
 * Myfinance — correos desde GitHub Actions (sin Cloud Functions, sin plan Blaze).
 *
 *   node send.js welcome     bienvenida a quien canjeó su invitación + aviso al admin
 *   node send.js morning     8:00  pendientes del día
 *   node send.js afternoon   14:00 "¿ya anotaste?" (solo si no ha registrado hoy)
 *   node send.js night       20:00 "cierra tu día"  (solo si no ha registrado hoy)
 *
 * Variables: FIREBASE_SERVICE_ACCOUNT (JSON de la llave), BREVO_API_KEY, SENDER_EMAIL, ADMIN_EMAIL (opcional).
 * Solo lee `notify` y `members`; nunca toca los respaldos.
 */
const admin = require('firebase-admin')

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
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const firstName = (n) => esc(String(n || 'amigo').trim().split(/\s+/)[0])

function layout(inner) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
    <h2 style="color:#e5253b;margin:0 0 4px">Myfinance</h2>
    ${inner}
    <p style="margin:20px 0"><a href="${APP_URL}" style="background:#e5253b;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir Myfinance</a></p>
    <p style="color:#888;font-size:12px">Puedes apagar estos correos en Más → Ajustes → Recordatorios por correo.</p>
  </div>`
}

function pendingRows(items) {
  const rows = items
    .map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee"><b style="color:${i.level === 'late' ? '#d62839' : '#b36b00'}">${esc(i.title)}</b><br><span style="color:#666;font-size:13px">${esc(i.detail)}</span></td></tr>`)
    .join('')
  return rows ? `<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>` : ''
}

async function sendMail(to, name, subject, html) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Myfinance', email: SENDER_EMAIL }, to: [{ email: to, name: name || undefined }], subject, htmlContent: html }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`)
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
          </ol>
          <p style="margin:12px 0 0;color:#666;font-size:13px">Tip: instálala en tu celular desde el menú del navegador → "Agregar a pantalla de inicio".</p>`),
      )
      // Se marca primero: si el aviso al admin falla, no se le repite la bienvenida al amigo
      await doc.ref.set({ welcomedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      await sendMail(ADMIN_EMAIL, 'Admin', `Myfinance: se unió ${m.name || m.email}`, layout(`<p>${esc(m.name || '')} (${esc(m.email)}) acaba de entrar con su código de invitación.</p>`)).catch((e) => console.error('Aviso al admin', String(e)))
      sent++
    } catch (e) {
      console.error('No se pudo enviar la bienvenida', doc.id, String(e))
    }
  }
  console.log(`Bienvenida: ${sent} correo(s) enviados de ${snap.size} miembros`)
}

/* ───────────── Recordatorios ───────────── */
const SLOTS = {
  morning: {
    skipIfRegistered: false,
    build(name, items) {
      const urgent = items.filter((i) => i.level === 'late').length
      const subject = items.length
        ? urgent ? `Myfinance: ${urgent} pendiente${urgent > 1 ? 's' : ''} vencido${urgent > 1 ? 's' : ''}` : `Myfinance: tienes ${items.length} pendiente${items.length > 1 ? 's' : ''}`
        : 'Buenos días: ¿qué vas a registrar hoy?'
      const body = items.length
        ? `<p style="margin:0 0 4px">Buenos días ${name}, esto es lo que necesita tu atención hoy:</p>${pendingRows(items)}`
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
    build(name) {
      return {
        subject: 'Cierra tu día en Myfinance 🌙',
        html: layout(`<p style="margin:0">${name}, no dejes que se te olvide: registra lo que gastaste o ganaste hoy antes de dormir. Mañana ya no te acordarás de los detalles.</p>`),
      }
    },
  },
}

async function remind(slot) {
  const cfg = SLOTS[slot]
  const snap = await db.collection('notify').where('enabled', '==', true).get()
  const today = dayKey(Date.now())
  let sent = 0
  for (const doc of snap.docs) {
    const d = doc.data()
    const updated = d.updatedAt?.toMillis?.() ?? 0
    // Sin correo, ya enviado este turno hoy, o la app lleva más de 2 semanas sin abrirse (no insistimos)
    if (!d.email || d.sent?.[slot] === today || Date.now() - updated > STALE_AFTER_MS) continue
    if (cfg.skipIfRegistered && d.lastTxAt && dayKey(d.lastTxAt) === today) continue
    const items = Array.isArray(d.items) ? d.items : []
    try {
      const { subject, html } = cfg.build(firstName(d.name), items)
      await sendMail(d.email, d.name, subject, html)
      await doc.ref.set({ sent: { [slot]: today } }, { merge: true })
      sent++
    } catch (e) {
      console.error('No se pudo enviar el recordatorio', doc.id, slot, String(e))
    }
  }
  console.log(`Recordatorio ${slot}: ${sent} correo(s) enviados de ${snap.size} activados`)
}

const mode = process.argv[2]
const run = mode === 'welcome' ? welcome() : SLOTS[mode] ? remind(mode) : Promise.reject(new Error(`Modo desconocido: ${mode}`))
run.then(() => process.exit(0), (e) => {
  console.error(e)
  process.exit(1)
})
