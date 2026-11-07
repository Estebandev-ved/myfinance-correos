// node --test correos/   (no necesita variables de entorno ni Firestore)
const test = require('node:test')
const assert = require('node:assert/strict')
const { decide, DAY } = require('./inactivity')

const NOW = Date.UTC(2026, 10, 20, 15)
const ago = (days, extra = 0) => NOW - days * DAY - extra

test('antes del primer aviso no pasa nada', () => {
  assert.equal(decide({ lastSeen: ago(0), nowMs: NOW }).action, 'none')
  assert.equal(decide({ lastSeen: ago(6), nowMs: NOW }).action, 'none')
})

test('los avisos salen a los 7, 14, 21 y 27 días, uno por vez y en orden', () => {
  let st = {}
  const sent = []
  for (let day = 0; day <= 29; day++) {
    const d = decide({ lastSeen: ago(day), st, nowMs: NOW })
    if (d.action === 'warn') {
      sent.push(d.stage)
      st = { since: ago(day), stage: d.stage, sentAt: NOW }
    }
  }
  assert.deepEqual(sent, [7, 14, 21, 27])
})

test('si ya pasaron muchos días de golpe, no manda los 4 juntos: manda el siguiente', () => {
  const d = decide({ lastSeen: ago(40), st: {}, nowMs: NOW })
  assert.deepEqual([d.action, d.stage], ['warn', 7])
  const d2 = decide({ lastSeen: ago(40), st: { since: ago(40), stage: 7, sentAt: NOW }, nowMs: NOW })
  assert.deepEqual([d2.action, d2.stage], ['warn', 14])
})

test('no se libera sin haber recibido los 4 avisos', () => {
  assert.equal(decide({ lastSeen: ago(45), st: { since: ago(45), stage: 21, sentAt: NOW - 10 * DAY }, nowMs: NOW }).action, 'warn')
  assert.equal(decide({ lastSeen: ago(45), st: {}, nowMs: NOW }).action, 'warn')
})

test('se libera a los 30 días con los 4 avisos, y solo si el último tiene 3 días o más', () => {
  const st = (sentDaysAgo, seenDaysAgo = 31) => ({ since: ago(seenDaysAgo), stage: 27, sentAt: NOW - sentDaysAgo * DAY })
  assert.equal(decide({ lastSeen: ago(31), st: st(1), nowMs: NOW }).action, 'none')
  assert.equal(decide({ lastSeen: ago(31), st: st(3), nowMs: NOW }).action, 'release')
  assert.equal(decide({ lastSeen: ago(29), st: st(5, 29), nowMs: NOW }).action, 'none') // aún no llega al día 30
})

test('volver a abrir la app lo cancela todo', () => {
  const st = { since: ago(28), stage: 27, sentAt: NOW - 1 * DAY }
  assert.equal(decide({ lastSeen: ago(0), st, nowMs: NOW }).action, 'reset')
  assert.equal(decide({ lastSeen: ago(2), st, nowMs: NOW }).action, 'reset')
})

test('quien nunca ha sido avisado y entró hoy no tiene seguimiento que borrar', () => {
  assert.equal(decide({ lastSeen: ago(0), st: {}, nowMs: NOW }).action, 'none')
})
