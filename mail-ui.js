/**
 * Myfinance — diseño de los correos: piezas con la paleta de la app, gráficos de barras y Tití.
 * Todo con tablas y estilos en línea (es lo que entienden bien Gmail, Outlook y Apple Mail). Sin JavaScript ni imágenes
 * de gráficos: las barras son celdas de color, así nunca se "rompen" ni dependen de que se carguen imágenes.
 * Las imágenes de Tití viven en https://myfinance-info.web.app/email/ (carpeta web/email del proyecto).
 */
const APP_URL = 'https://myfinance-gr23.web.app'
const IMG = 'https://myfinance-info.web.app/email'

const C = {
  brand: '#258374',
  brandDark: '#1B6A5D',
  mint: '#2FA878', // ingresos (más oscuro que el de la app para que se lea sobre blanco)
  gold: '#C99A1F',
  terra: '#D9745B', // gastos
  ink: '#16201F',
  mute: '#5E706B',
  line: '#E3ECE9',
  track: '#E6EEEC',
  bg: '#EEF3F1',
  card: '#FFFFFF',
  soft: '#F3F8F6',
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Imagen de Tití: neutral, happy, worried, celebrate, thinking, sleeping, surprised. */
const titi = (mood = 'neutral', size = 96) => `<img src="${IMG}/titi-${mood}.png" width="${size}" height="${size}" alt="Tití" style="display:block;border:0;width:${size}px;height:${size}px">`

/** Cabecera de la marca: una banda verde con el nombre. */
const header = () => `<tr><td style="background:${C.brand};border-radius:16px 16px 0 0;padding:18px 24px">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:-0.5px">My<span style="color:#9BE3C8">finance</span></span>
</td></tr>`

/** Tití a un lado y un título con su texto al otro. */
function hero({ mood = 'neutral', title, text }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
    <td width="104" valign="middle" style="padding-right:14px">${titi(mood, 96)}</td>
    <td valign="middle"><div class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;font-weight:bold;color:${C.ink}">${title}</div>
    ${text ? `<div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${C.mute};margin-top:6px">${text}</div>` : ''}</td>
  </tr></table>`
}

const p = (html, extra = '') => `<p class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${C.ink};margin:0 0 14px;${extra}">${html}</p>`

const button = (label, url = APP_URL, color = C.brand) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td style="background:${color};border-radius:12px"><a href="${esc(url)}" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`

/** Una barra de progreso (0 a 100). */
function meter(pct, color = C.brand, height = 10) {
  const w = Math.max(2, Math.min(100, Math.round(pct)))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="track" style="background:${C.track};border-radius:${height}px"><tr>
    <td width="${w}%" height="${height}" style="background:${color};border-radius:${height}px;font-size:1px;line-height:1px">&nbsp;</td>
    <td style="font-size:1px;line-height:1px">&nbsp;</td></tr></table>`
}

/**
 * Barras para comparar cantidades. items: [{ label, value, text, color }]; la más grande ocupa todo el ancho.
 * `text` es lo que se muestra a la derecha (ej. el monto con formato).
 */
function bars(items) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px">${items
    .map(
      (i) => `<tr><td style="padding:8px 0 3px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.mute}">${esc(i.label)}</td>
        <td align="right" class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${i.color || C.ink}">${esc(i.text ?? i.value)}</td></tr></table></td></tr>
        <tr><td>${meter((Math.abs(i.value) / max) * 100, i.color || C.brand, 12)}</td></tr>`,
    )
    .join('')}</table>`
}

/** Tres números grandes en tarjetas. items: [{ label, value, color }] */
function kpis(items) {
  const w = Math.floor(100 / items.length)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:4px -6px 14px;width:calc(100% + 12px)"><tr>${items
    .map(
      (i) => `<td width="${w}%" valign="top" class="soft" style="background:${C.soft};border-radius:12px;padding:12px 10px;text-align:center">
        <div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${C.mute}">${esc(i.label)}</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;color:${i.color || C.ink};margin-top:4px">${esc(i.value)}</div></td>`,
    )
    .join('')}</tr></table>`
}

/** Siete círculos (los días de la semana): llenos los días en que anotó. flags: boolean[]; labels opcional. */
function dots(flags, labels = ['L', 'M', 'M', 'J', 'V', 'S', 'D']) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr>${flags
    .map(
      (on, i) => `<td align="center" style="padding-right:8px"><div${on ? '' : ' class="dot-off"'} style="width:30px;height:30px;line-height:30px;border-radius:15px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;${on ? `background:${C.brand};color:#ffffff` : `background:${C.track};color:${C.mute}`}">${on ? '&#10003;' : esc(labels[i] ?? '')}</div></td>`,
    )
    .join('')}</tr></table>`
}

/** Pasos numerados. */
function steps(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px">${list
    .map(
      (t, i) => `<tr><td valign="top" width="36" style="padding:7px 0"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:${C.brand};color:#ffffff;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold">${i + 1}</div></td>
      <td valign="middle" class="tx" style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${C.ink}">${t}</td></tr>`,
    )
    .join('')}</table>`
}

/** Caja destacada. tone: 'ok' | 'warn' | 'bad' | 'info' */
function callout(html, tone = 'info') {
  const t = { ok: ['#E7F6EF', C.mint], warn: ['#FBF3DC', C.gold], bad: ['#FBE9E4', C.terra], info: ['#E8F2EF', C.brand] }[tone]
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr><td class="callout tx" style="background:${t[0]};border-left:4px solid ${t[1]};border-radius:8px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${C.ink}">${html}</td></tr></table>`
}

/** Lista de pendientes. items: [{ level: 'late'|'soon', title, detail }] */
function rows(items) {
  const html = items
    .map(
      (i) => `<tr><td style="padding:11px 0;border-bottom:1px solid ${C.line}"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${i.level === 'late' ? C.terra : C.gold}">${esc(i.title)}</div><div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.mute};margin-top:2px">${esc(i.detail)}</div></td></tr>`,
    )
    .join('')
  return html ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px">${html}</table>` : ''
}

/** Lista de datos (etiqueta a la izquierda, valor a la derecha). */
const stat = (label, value, color = C.ink) =>
  `<tr><td class="mu" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${C.mute}">${esc(label)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${color}">${esc(value)}</td></tr>`
const statTable = (list) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px">${list.join('')}</table>`

const OFF_NOTE = 'Puedes apagar estos correos en Más → Ajustes → Recordatorios por correo.'

/**
 * Envuelve el contenido en el correo completo: cabecera verde, tarjeta blanca, botón y pie con Tití.
 * `opts.cta` = { label, url } o false para no poner botón; `opts.preheader` = el resumen que se ve en la bandeja.
 */
function layout(inner, footer = OFF_NOTE, opts = {}) {
  const cta = opts.cta === false ? '' : button(opts.cta?.label ?? 'Abrir Myfinance', opts.cta?.url ?? APP_URL)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background:#0E1213 !important }
    .card { background:#161C1D !important }
    .tx { color:#F1F4F3 !important }
    .mu { color:#9DB0AB !important }
    .soft { background:#1F292B !important }
    .track { background:#2A383A !important }
    .callout { background:#1F2E2B !important }
    .dot-off { background:#2A383A !important; color:#9DB0AB !important }
  }
  @media (max-width: 480px) { .wrap { width:100% !important } .pad { padding:20px 16px !important } }
</style></head>
<body class="bg" style="margin:0;padding:0;background:${C.bg}">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" class="wrap" style="width:560px;max-width:100%">
${header()}
<tr><td class="card pad" style="background:${C.card};padding:26px 28px;border-radius:0 0 16px 16px">
${inner}
${cta}
</td></tr>
<tr><td align="center" style="padding:16px 8px 4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td valign="middle" style="padding-right:8px">${titi('happy', 36)}</td>
  <td valign="middle" class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${C.mute}">Hecho con cariño por Tití y el equipo de Myfinance.</td></tr></table></td></tr>
<tr><td align="center" class="mu" style="padding:6px 16px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${C.mute}">${footer}</td></tr>
</table></td></tr></table></body></html>`
}

module.exports = { C, esc, titi, hero, p, button, meter, bars, kpis, dots, steps, callout, rows, stat, statTable, layout, OFF_NOTE, APP_URL, IMG }
