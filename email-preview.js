/**
 * Vista previa de los correos, SIN enviar nada.
 *   node email-preview.js [carpeta]     (por defecto ./preview)
 * Genera un .html por cada plantilla con datos de ejemplo y un index.html que los junta. Las imágenes de Tití se
 * toman de ../web/email (así se ven aunque aún no estén publicadas).
 */
const fs = require('fs')
const path = require('path')
const T = require('./mail-templates')

const out = path.resolve(process.argv[2] || path.join(__dirname, 'preview'))
fs.mkdirSync(out, { recursive: true })
const local = 'file:///' + path.resolve(__dirname, '..', 'web', 'email').replace(/\\/g, '/')

const samples = {
  '01-bienvenida': T.welcomeMail({ name: 'Esteban Ruiz', email: 'esteban@mail.com' }),
  '02-presupuesto': T.budgetMail('Esteban', [
    { level: 'late', title: 'Te pasaste en Comida', detail: '$ 162.000 de $ 150.000 este mes', pct: 108 },
    { level: 'soon', title: 'Transporte va al 84% del tope', detail: '$ 101.000 de $ 120.000 este mes', pct: 84 },
  ]),
  '03-racha': T.streakMail('Esteban', 14),
  '04-meta-grupo': T.groupMail('Esteban', { name: 'Viaje a Cartagena', target: 2000000 }, [{ name: 'Ana', amount: 80000, note: 'Para el hotel' }], 1380000, 69),
  '05-manana': T.reminderMail('morning', 'Esteban', [{ level: 'late', title: 'Hoy pagas Nu', detail: 'Cuota de $ 120.000' }, { level: 'soon', title: 'Granizo te debe $ 30.000', detail: 'Fiado de hace 9 días' }], 0),
  '06-tarde': T.reminderMail('afternoon', 'Esteban', [], 0),
  '07-noche-racha': T.reminderMail('night', 'Esteban', [], 12),
  '08-semana': T.weeklyMail('Esteban', { spent: 286000, income: 750000, prevSpent: 210000, topCat: 'Comida', topAmount: 94000 }, { change: 36, registered: 5, flags: [true, true, false, true, true, false, true], labels: ['V', 'S', 'D', 'L', 'M', 'M', 'J'] }),
  '09-mes': T.monthlyMail('Esteban', { income: 1283959, expense: 1020711, topCat: 'Comida', topAmount: 312000 }, 'octubre'),
  '10-inactividad-7': T.inactivityMail(7, 'Esteban', 7),
  '11-inactividad-14': T.inactivityMail(14, 'Esteban', 14),
  '12-inactividad-21': T.inactivityMail(21, 'Esteban', 21),
  '13-inactividad-27': T.inactivityMail(27, 'Esteban', 27),
  '14-cupo-liberado': T.releasedMail('Esteban'),
  '15-admin-liberacion': T.adminReleaseMail([{ name: 'Ana Gómez', email: 'ana@mail.com', idle: 31 }, { name: '', email: 'beto@mail.com', idle: 34 }], 4, true),
  '16-admin-mensaje': T.adminMail('Esteban', 'Novedades de Myfinance', 'Hola,\n\nYa salió la versión nueva con Tití.\nCuéntanos qué te parece.'),
}

const links = []
for (const [name, mail] of Object.entries(samples)) {
  fs.writeFileSync(path.join(out, `${name}.html`), mail.html.replaceAll('https://myfinance-info.web.app/email', local))
  links.push(`<li><a href="${name}.html">${name}</a> — ${mail.subject}</li>`)
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Correos</title><body style="font-family:Arial;padding:24px"><h1>Correos de Myfinance</h1><ul>${links.join('')}</ul></body>`)
console.log(`${links.length} correos en ${out}`)
