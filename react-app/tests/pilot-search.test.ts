import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPilotLayout,
  fitPilotOls,
  searchPilots,
  searchCost,
  pilotGcd,
} from '../src/lib/pilotSearch.js'
import type { PilotObservation } from '../src/lib/pilotEstimator.js'

function observations(
  indices: number[],
  phase = 0.7,
  frequency = 0.071,
): PilotObservation[] {
  return indices.map((index) => {
    const a = phase + 2 * Math.PI * frequency * index
    return {
      index,
      pi: 1,
      pq: 1,
      i: Math.cos(a) - Math.sin(a),
      q: Math.sin(a) + Math.cos(a),
    }
  })
}
const circular = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b))
test('pilot layouts preserve count/span or disclose extra adjacent training energy', () => {
  const u = buildPilotLayout(2049, 16, 'uniform'),
    s = buildPilotLayout(2049, 16, 'shifted'),
    p = buildPilotLayout(2049, 16, 'paired')
  assert.equal(u.length, 129)
  assert.equal(s.length, 129)
  assert.ok(p.length > 129)
  assert.equal(pilotGcd(u), 16)
  assert.equal(pilotGcd(s), 1)
  assert.equal(pilotGcd(p), 1)
  for (const a of [u, s, p]) {
    assert.equal(a[0], 0)
    assert.equal(a.at(-1), 2048)
    assert.equal(new Set(a).size, a.length)
  }
  assert.throws(() => buildPilotLayout(2048, 16, 'uniform'))
})
test('pilot-only search recovers signed offsets and phase boundaries without unwrapping', () => {
  const indices = buildPilotLayout(257, 16, 'shifted')
  for (const phi of [-Math.PI, 0, Math.PI])
    for (const frequency of [-0.49, -0.071, 0, 0.071, 0.49]) {
      const fit = searchPilots(observations(indices, phi, frequency))
      assert.equal(fit.status, 'ok')
      if (fit.status !== 'ok') continue
      assert.ok(Math.abs(fit.frequency - frequency) < 1e-8)
      assert.ok(Math.abs(circular(fit.phaseRad, phi)) < 1e-5)
      assert.ok(fit.coherenceDeficit < 1e-10)
      assert.ok(fit.operations <= searchCost(indices))
    }
})
test('uniform pilot ambiguity is retained, not resolved from truth', () => {
  const indices = buildPilotLayout(257, 16, 'uniform'),
    a = searchPilots(observations(indices, 0.3, 0.001)),
    b = searchPilots(observations(indices, 0.3, 0.001 + 1 / 16))
  assert.equal(a.status, 'ok')
  assert.equal(b.status, 'ok')
  if (a.status === 'ok' && b.status === 'ok') {
    assert.ok(Math.abs(a.frequency - b.frequency) < 1e-8)
    assert.equal(a.period, 1 / 16)
    assert.ok(Math.abs(a.frequency) < 1 / 32)
  }
})
test('independent complex SSE identifies the searched solution on noisy pilots', () => {
  const input = observations(buildPilotLayout(129, 16, 'paired'), 0.2, -0.041)
  input.forEach((p, m) => {
    p.i += 0.15 * Math.sin(m * 3)
    p.q += 0.1 * Math.cos(m * 5)
  })
  const fit = searchPilots(input)
  assert.equal(fit.status, 'ok')
  if (fit.status !== 'ok') return
  const objective = (f: number) => {
    let i = 0,
      q = 0
    for (const p of input) {
      const a = -2 * Math.PI * f * p.index,
        c = Math.cos(a),
        s = Math.sin(a)
      const zi = p.i * p.pi + p.q * p.pq,
        zq = p.q * p.pi - p.i * p.pq
      i += zi * c - zq * s
      q += zi * s + zq * c
    }
    return Math.hypot(i, q)
  }
  const best = objective(fit.frequency)
  for (let m = 0; m < 20000; m++)
    assert.ok(best >= objective(-0.5 + m / 20000) - 1e-7)
})
test('generalized OLS matches exact nonuniform fits within its unwrap capture condition', () => {
  const fit = fitPilotOls(
    observations(buildPilotLayout(257, 16, 'shifted'), -3.1, 0.001),
  )
  assert.equal(fit.status, 'ok')
  if (fit.status === 'ok') {
    assert.ok(Math.abs(fit.frequency - 0.001) < 1e-12)
    assert.ok(Math.abs(circular(fit.phaseRad, -3.1)) < 1e-10)
  }
  for (const values of [
    [],
    new Array<PilotObservation>(8),
    observations([0, 0]),
    observations([0, 1]).map((p) => ({ ...p, i: 0, q: 0 })),
  ])
    assert.equal(searchPilots(values).status, 'failed')
})
