import assert from 'node:assert/strict'
import test from 'node:test'
import { addAwgn } from '../src/lib/signallab.js'
import {
  modulateQam16,
  demodulateQam16,
  simulateQam16,
  theoreticalQam16Ber,
  QAM16_SCALE,
} from '../src/lib/qam16.js'

const bits = Array.from(
  { length: 64 },
  (_, i) => ((i >> 2) >> (3 - (i % 4))) & 1,
)

test('16QAM covers all Gray points, average Es=4 and Eb=1', () => {
  const symbols = modulateQam16(bits)
  assert.equal(new Set(symbols.map(({ i, q }) => `${i},${q}`)).size, 16)
  assert.ok(
    Math.abs(
      symbols.reduce((sum, { i, q }) => sum + i * i + q * q, 0) / 16 - 4,
    ) < 1e-12,
  )
  assert.deepEqual(modulateQam16([0, 0, 1, 1]), [
    { i: -3 * QAM16_SCALE, q: QAM16_SCALE },
  ])
  assert.deepEqual(demodulateQam16(symbols), bits)
  for (const seed of [0, 42, 0xffffffff])
    assert.equal(simulateQam16(bits, 0, seed, false).errors, 0)
})

test('16QAM threshold ties go to the upper region; adjacent Gray levels change one bit', () => {
  assert.deepEqual(
    demodulateQam16([
      { i: -2 * QAM16_SCALE, q: 0 },
      { i: 2 * QAM16_SCALE, q: -0 },
    ]),
    [0, 1, 1, 1, 1, 0, 1, 1],
  )
  const codes = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]
  for (let i = 1; i < codes.length; i++)
    assert.equal(codes[i].filter((bit, n) => bit !== codes[i - 1][n]).length, 1)
})

test('16QAM noise consumes consecutive I/Q draws and preserves caller input', () => {
  const input = Object.freeze([...bits])
  const result = simulateQam16(input, 0, 42)
  const axes = result.symbols.flatMap(({ i, q }) => [i, q])
  assert.deepEqual(
    result.received.flatMap(({ i, q }) => [i, q]),
    addAwgn(axes, 0, 42),
  )
  assert.deepEqual(result, simulateQam16(input, 0, 42))
  assert.notDeepEqual(result.received, simulateQam16(input, 0, 43).received)
  assert.deepEqual(input, bits)
})

test('16QAM rejects invalid bit groups, samples, SNR and seeds', () => {
  for (const input of [
    [],
    [0],
    [0, 1],
    [0, 1, 0],
    [0, 1, 0, 2],
    [0, NaN, 0, 1],
  ])
    assert.throws(() => modulateQam16(input))
  for (const value of [NaN, Infinity, -Infinity])
    assert.throws(() => demodulateQam16([{ i: value, q: 0 }]))
  for (const db of [NaN, Infinity, -10000, 10000])
    assert.throws(() => simulateQam16(bits, db, 42))
  for (const seed of [-1, 0x100000000, 1.5, NaN])
    assert.throws(() => simulateQam16(bits, 0, seed))
})

test('16QAM BER matches independent erfc references and statistical measurements', () => {
  // Python math.erfc reference; includes low-SNR non-nearest-neighbour errors.
  const references = [
    [-10, 0.37086010545280346],
    [-4, 0.23670972805258894],
    [0, 0.14098163506684164],
    [4, 0.05862373728340438],
    [8, 0.00924721374147441],
    [10, 0.00175415061789273],
    [15, 1.8418555110944837e-7],
  ]
  for (const [db, expected] of references)
    assert.ok(
      Math.abs(theoreticalQam16Ber(db) / expected - 1) < 1e-6,
      `${db} dB`,
    )
  for (const db of [-11, 16, NaN, Infinity])
    assert.throws(() => theoreticalQam16Ber(db))
  const input = Array.from({ length: 262144 }, (_, i) => bits[i % 64])
  for (const db of [-4, 0, 4, 8]) {
    const measured = simulateQam16(input, db, 2026).ber
    const expected = theoreticalQam16Ber(db)
    assert.ok(
      Math.abs(measured - expected) <
        8 * Math.sqrt((expected * (1 - expected)) / input.length),
      `${db}: ${measured} vs ${expected}`,
    )
  }
})
