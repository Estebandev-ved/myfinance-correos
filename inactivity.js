/**
 * Myfinance — la regla de inactividad, sin tocar Firestore (así se puede probar a fondo).
 * Dada la última vez que la persona abrió la app y el seguimiento guardado, dice qué toca hacer.
 */
const DAY = 86_400_000

/** Días de inactividad en que se avisa, y el día en que se libera el cupo si no volvió. */
const INACTIVITY = { release: 30, stages: [7, 14, 21, 27] }
/** Tras el último aviso hay que esperar al menos esto antes de liberar (para que de verdad lo haya podido ver). */
const MIN_AFTER_LAST_WARNING_MS = 3 * DAY

/**
 * lastSeen: ms de la última vez que abrió la app.
 * st: seguimiento guardado { since, stage, sentAt } ({} si no hay).
 * Devuelve:
 *   { action: 'reset' }                  volvió: se borra el seguimiento
 *   { action: 'none', idle }             todavía no toca nada
 *   { action: 'warn', stage, idle }      mandar el aviso de ese día
 *   { action: 'release', idle }          liberar el cupo (ya tuvo los 4 avisos)
 */
function decide({ lastSeen, st = {}, nowMs }) {
  const idle = Math.floor((nowMs - lastSeen) / DAY)
  if (st.since && lastSeen > st.since) return { action: 'reset', idle }
  if (idle < INACTIVITY.stages[0]) return { action: 'none', idle }
  const done = st.stage ?? 0
  const next = INACTIVITY.stages.find((s) => idle >= s && s > done)
  if (next) return { action: 'warn', stage: next, idle }
  const last = INACTIVITY.stages[INACTIVITY.stages.length - 1]
  if (idle >= INACTIVITY.release && done === last && nowMs - (st.sentAt ?? nowMs) >= MIN_AFTER_LAST_WARNING_MS) return { action: 'release', idle }
  return { action: 'none', idle }
}

module.exports = { decide, INACTIVITY, DAY }
