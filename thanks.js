/**
 * Myfinance — a quién se le manda el correo de agradecimiento con el "sello de por vida", sin tocar Firestore
 * (así se puede probar a fondo). Es para quien lleva racha y SIGUE activo: una racha vieja de alguien que ya se fue no cuenta.
 */
const DAY = 86_400_000

/** Racha mínima por defecto (se puede cambiar con la variable GIFT_MIN_STREAK). */
const MIN_STREAK = 10
/** Monedas de Tití del regalo según la racha (sin valor en plata real). OJO: la app acepta hasta 500 (app/src/lib/gift.ts). */
const TIERS = [
  { from: 20, coins: 200, tier: 'oro' },
  { from: 0, coins: 100, tier: 'plata' },
]
/** Cuántos días máximo desde que abrió la app para considerarlo activo. */
const ACTIVE_WITHIN_DAYS = 3

/**
 * streak: racha guardada en stats/{uid} la última vez que sincronizó. lastSeenMs: última vez que abrió la app.
 * Devuelve null si no toca, o { streak, coins, tier }.
 */
function pickGift({ streak, lastSeenMs, nowMs, minStreak = MIN_STREAK }) {
  if (typeof streak !== 'number' || !Number.isFinite(streak) || streak < minStreak) return null
  if (typeof lastSeenMs !== 'number' || !Number.isFinite(lastSeenMs) || lastSeenMs > nowMs) return null
  if (nowMs - lastSeenMs > ACTIVE_WITHIN_DAYS * DAY) return null
  const s = Math.floor(streak)
  const t = TIERS.find((x) => s >= x.from)
  return { streak: s, coins: t.coins, tier: t.tier }
}

module.exports = { pickGift, MIN_STREAK, TIERS, ACTIVE_WITHIN_DAYS }
