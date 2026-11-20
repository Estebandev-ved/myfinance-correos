// node --test correos/   (no necesita variables de entorno ni Firestore)
const test = require('node:test')
const assert = require('node:assert/strict')
const { pickGift, MIN_STREAK, ACTIVE_WITHIN_DAYS } = require('./thanks')

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 21, 15)
const seen = (days) => NOW - days * DAY

test('con racha de 10 o más y activo, sí toca; con menos, no', () => {
  assert.equal(pickGift({ streak: MIN_STREAK - 1, lastSeenMs: seen(0), nowMs: NOW }), null)
  assert.deepEqual(pickGift({ streak: MIN_STREAK, lastSeenMs: seen(0), nowMs: NOW }), { streak: 10, coins: 100, tier: 'plata' })
})

test('desde 20 días de racha el regalo es mayor', () => {
  assert.deepEqual(pickGift({ streak: 19, lastSeenMs: seen(1), nowMs: NOW }), { streak: 19, coins: 100, tier: 'plata' })
  assert.deepEqual(pickGift({ streak: 20, lastSeenMs: seen(1), nowMs: NOW }), { streak: 20, coins: 200, tier: 'oro' })
  assert.deepEqual(pickGift({ streak: 45, lastSeenMs: seen(1), nowMs: NOW }), { streak: 45, coins: 200, tier: 'oro' })
})

test('una racha vieja de alguien que ya no entra no cuenta', () => {
  assert.notEqual(pickGift({ streak: 30, lastSeenMs: seen(ACTIVE_WITHIN_DAYS), nowMs: NOW }), null)
  assert.equal(pickGift({ streak: 30, lastSeenMs: seen(ACTIVE_WITHIN_DAYS + 1), nowMs: NOW }), null)
  assert.equal(pickGift({ streak: 30, lastSeenMs: seen(40), nowMs: NOW }), null)
})

test('datos ausentes o raros no producen regalo', () => {
  assert.equal(pickGift({ streak: undefined, lastSeenMs: seen(0), nowMs: NOW }), null)
  assert.equal(pickGift({ streak: NaN, lastSeenMs: seen(0), nowMs: NOW }), null)
  assert.equal(pickGift({ streak: 20, lastSeenMs: null, nowMs: NOW }), null)
  assert.equal(pickGift({ streak: 20, lastSeenMs: NOW + DAY, nowMs: NOW }), null)
  assert.equal(pickGift({ streak: '20', lastSeenMs: seen(0), nowMs: NOW }), null)
})

test('se puede cambiar la racha mínima', () => {
  assert.equal(pickGift({ streak: 10, lastSeenMs: seen(0), nowMs: NOW, minStreak: 14 }), null)
  assert.notEqual(pickGift({ streak: 14, lastSeenMs: seen(0), nowMs: NOW, minStreak: 14 }), null)
})
