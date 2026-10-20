import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addAwgn,
  calculateBer,
  demodulateBpsk,
  modulateBpsk,
  parseBits,
  simulateBpsk,
} from '../src/lib/signallab.js'

test('parses bits with whitespace and rejects invalid or empty input', () => {
  assert.deepEqual(parseBits('01 10\n01'), [0, 1, 1, 0, 0, 1])
  for (const input of ['', '  ', '012', '0,1']) {
    assert.throws(() => parseBits(input))
  }
})

test('BPSK uses unit energy and a zero threshold hard decision', () => {
  assert.deepEqual(modulateBpsk([0, 1, 1, 0]), [1, -1, -1, 1])
  assert.deepEqual(demodulateBpsk([2, -0.01, 0, -3]), [0, 1, 0, 1])
})

test('noiseless transmission restores every bit across multiple seeds', () => {
  const bits = Array.from({ length: 8192 }, (_, i) => (i * 7 + (i >> 2)) % 2)
  for (const seed of [0, 1, 42, 4294967295]) {
    const result = simulateBpsk(bits, 0, seed, false)
    assert.deepEqual(result.decoded, bits)
    assert.deepEqual(result.received, result.symbols)
    assert.equal(result.errors, 0)
    assert.equal(result.ber, 0)
  }
})

test('AWGN is reproducible, does not mutate input, and changes with the seed', () => {
  const symbols = [1, -1, 1, -1]
  const original = [...symbols]
  const received = addAwgn(symbols, 0, 42)
  assert.deepEqual(received, addAwgn(symbols, 0, 42))
  assert.notDeepEqual(received, addAwgn(symbols, 0, 43))
  assert.deepEqual(symbols, original)
})

test('AWGN has approximately zero mean and N0/2 variance at 0 dB', () => {
  const noise = addAwgn(Array<number>(100000).fill(0), 0, 123)
  const mean = noise.reduce((sum, value) => sum + value, 0) / noise.length
  const variance =
    noise.reduce((sum, value) => sum + (value - mean) ** 2, 0) / noise.length
  assert.ok(Math.abs(mean) < 0.01, `mean=${mean}`)
  assert.ok(Math.abs(variance - 0.5) < 0.015, `variance=${variance}`)
})

test('BER counts actual mismatches and rejects unequal or empty sequences', () => {
  assert.deepEqual(calculateBer([0, 1, 0, 1], [0, 0, 1, 1]), {
    errors: 2,
    ber: 0.5,
  })
  assert.throws(() => calculateBer([0], []))
  assert.throws(() => calculateBer([], []))
})

test('BER decreases with Eb/N0 over a reproducible 100000-bit experiment', () => {
  const bits = Array.from({ length: 100000 }, (_, i) => i % 2)
  for (const seed of [1, 42, 2026]) {
    const results = [-4, 0, 4, 8].map((db) => simulateBpsk(bits, db, seed))
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].ber < results[i - 1].ber)
    }
    // Coherent BPSK at 0 dB has BER approximately 0.07865.
    assert.ok(Math.abs(results[1].ber - 0.07865) < 0.004)
    console.log(
      `seed=${seed}, Eb/N0=[-4,0,4,8] dB, BER=${results.map((r) => r.ber).join(',')}`,
    )
  }
})

test('algorithm boundaries reject invalid numbers and nonbinary data', () => {
  assert.throws(() => modulateBpsk([0, 2]))
  assert.throws(() => demodulateBpsk([NaN]))
  assert.throws(() => calculateBer([2], [0]))
  for (const db of [NaN, Infinity, -Infinity, 10000, -10000]) {
    assert.throws(() => addAwgn([1], db, 42))
  }
  for (const seed of [NaN, -1, 1.5, 4294967296]) {
    assert.throws(() => addAwgn([1], 0, seed))
  }
})
