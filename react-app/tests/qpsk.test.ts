import assert from 'node:assert/strict'
import test from 'node:test'
import { modulateQpsk, demodulateQpsk, simulateQpsk } from '../src/lib/qpsk.js'
import { theoreticalBpskBer } from '../src/lib/berSweep.js'
import { simulateBpsk } from '../src/lib/signallab.js'

const bits = Array.from(
  { length: 200000 },
  (_, i) => [0, 0, 0, 1, 1, 1, 1, 0][i % 8],
)

test('QPSK uses exactly the BPSK axis stream at SNR and seed boundaries', () => {
  const input = Object.freeze([0, 0, 0, 1, 1, 1, 1, 0])
  for (const db of [-10, 0, 15]) {
    for (const seed of [0, 42, 0xffffffff]) {
      const bpsk = simulateBpsk(input, db, seed)
      const qpsk = simulateQpsk(input, db, seed)
      assert.deepEqual(
        qpsk.received.flatMap(({ i, q }) => [i, q]),
        bpsk.received,
      )
      assert.deepEqual(qpsk.decoded, bpsk.decoded)
      assert.equal(qpsk.errors, bpsk.errors)
    }
  }
})

test('QPSK maps all Gray pairs with Eb=1 and Es=2', () => {
  const symbols = modulateQpsk([0, 0, 0, 1, 1, 1, 1, 0])
  assert.deepEqual(symbols, [
    { i: 1, q: 1 },
    { i: 1, q: -1 },
    { i: -1, q: -1 },
    { i: -1, q: 1 },
  ])
  assert.ok(symbols.every(({ i, q }) => i * i + q * q === 2))
  assert.deepEqual(demodulateQpsk(symbols), [0, 0, 0, 1, 1, 1, 1, 0])
  assert.deepEqual(
    demodulateQpsk([
      { i: 0, q: -0.01 },
      { i: -2, q: 0 },
    ]),
    [0, 1, 1, 0],
  )
})

test('QPSK restores every bit without noise across seed boundaries', () => {
  for (const seed of [0, 42, 0xffffffff]) {
    const result = simulateQpsk(bits.slice(0, 8192), 0, seed, false)
    assert.deepEqual(result.decoded, bits.slice(0, 8192))
    assert.deepEqual(result.received, result.symbols)
    assert.equal(result.errors, 0)
    assert.equal(result.ber, 0)
  }
})

test('QPSK noise is reproducible and does not mutate caller data', () => {
  const input = Object.freeze([0, 0, 0, 1, 1, 1, 1, 0])
  const result = simulateQpsk(input, 0, 42)
  assert.deepEqual(result, simulateQpsk(input, 0, 42))
  assert.notDeepEqual(result.received, simulateQpsk(input, 0, 43).received)
  assert.deepEqual(input, [0, 0, 0, 1, 1, 1, 1, 0])
  assert.notStrictEqual(result.received, result.symbols)
})

test('QPSK I/Q noise has independent zero-mean N0/2 components', () => {
  const { symbols, received } = simulateQpsk(bits, 0, 123)
  const ni = received.map((s, n) => s.i - symbols[n].i)
  const nq = received.map((s, n) => s.q - symbols[n].q)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const mi = mean(ni)
  const mq = mean(nq)
  assert.ok(Math.abs(mi) < 0.01 && Math.abs(mq) < 0.01)
  for (const xs of [ni, nq]) {
    assert.ok(Math.abs(mean(xs.map((x) => x * x)) - 0.5) < 0.015)
  }
  const covariance = mean(ni.map((x, n) => (x - mi) * (nq[n] - mq)))
  assert.ok(Math.abs(covariance) < 0.01, `covariance=${covariance}`)
})

test('QPSK BER follows coherent Gray-coded theory at the same Eb/N0', () => {
  for (const seed of [1, 42, 2026]) {
    const results = [-4, 0, 4, 8].map((db) => simulateQpsk(bits, db, seed))
    for (let n = 0; n < results.length; n++) {
      const expected = theoreticalBpskBer([-4, 0, 4, 8][n])
      const tolerance = 6 * Math.sqrt((expected * (1 - expected)) / bits.length)
      assert.ok(
        Math.abs(results[n].ber - expected) < tolerance,
        `seed=${seed}, BER=${results[n].ber}, expected=${expected}`,
      )
      if (n > 0) assert.ok(results[n].ber < results[n - 1].ber)
    }
  }
})

test('QPSK rejects odd, empty, nonbinary and nonfinite inputs', () => {
  for (const input of [[], [0], [0, 1, 0], [0, 2], [NaN, 1]]) {
    assert.throws(() => modulateQpsk(input))
    assert.throws(() => simulateQpsk(input, 0, 42))
  }
  assert.throws(() => demodulateQpsk([{ i: NaN, q: 0 }]))
  assert.throws(() => demodulateQpsk([{ i: 0, q: Infinity }]))
  for (const seed of [-1, 1.5, NaN, 0x100000000]) {
    assert.throws(() => simulateQpsk([0, 1], 0, seed))
  }
  for (const db of [NaN, Infinity, -Infinity, 10000, -10000]) {
    assert.throws(() => simulateQpsk([0, 1], db, 42))
  }
})
