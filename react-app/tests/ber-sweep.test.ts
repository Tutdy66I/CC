import assert from 'node:assert/strict'
import test from 'node:test'
import {
  berInterval,
  simulateBerPoint,
  theoreticalBpskBer,
} from '../src/lib/berSweep.js'
import { simulateBpsk } from '../src/lib/signallab.js'

test('theoretical BPSK BER matches reference values across the scan range', () => {
  for (const [db, expected] of [
    [0, 0.07864960352514258],
    [4, 0.01250081804073755],
    [8, 0.00019090777407599314],
    [10, 0.000003872108215522035],
  ]) {
    assert.ok(
      Math.abs(theoreticalBpskBer(db) / expected - 1) < 1e-6,
      `${db} dB`,
    )
  }
  assert.ok(theoreticalBpskBer(-4) > theoreticalBpskBer(0))
  for (const db of [NaN, Infinity, -Infinity, -11, 16])
    assert.throws(() => theoreticalBpskBer(db))
})

test('Wilson interval matches a known 50/100 example and stays inside [0,1]', () => {
  const interval = berInterval(50, 100)
  assert.equal(interval.kind, 'wilson')
  assert.ok(Math.abs(interval.lower - 0.40383153) < 1e-7)
  assert.ok(Math.abs(interval.upper - 0.59616847) < 1e-7)
  const allErrors = berInterval(100, 100)
  assert.ok(allErrors.lower > 0.96)
  assert.equal(allErrors.upper, 1)
})

test('zero errors returns an exact one-sided 95% upper bound instead of zero', () => {
  const interval = berInterval(0, 100000)
  assert.equal(interval.kind, 'zero-upper')
  assert.equal(interval.lower, 0)
  assert.ok(interval.upper > 0)
  assert.ok(Math.abs((1 - interval.upper) ** 100000 - 0.05) < 1e-10)
  assert.ok(berInterval(0, 1000000).upper < interval.upper)
})

test('statistics reject invalid sample counts and error counts', () => {
  for (const [errors, bits] of [
    [0, 0],
    [-1, 10],
    [11, 10],
    [1.5, 10],
    [0, NaN],
    [0, 1.5],
    [Infinity, 10],
  ]) {
    assert.throws(() => berInterval(errors, bits))
  }
})

test('scan points reuse the real BPSK channel with reproducible balanced bits', () => {
  const point = simulateBerPoint(0, 10000, 42)
  const bits = Array.from({ length: 10000 }, (_, index) => index % 2)
  const expected = simulateBpsk(bits, 0, 42)
  assert.equal(point.errors, expected.errors)
  assert.equal(point.ber, expected.ber)
  assert.equal(point.bits, 10000)
  assert.equal(point.seed, 42)
  assert.equal(point.theoretical, theoreticalBpskBer(0))
  assert.deepEqual(point, simulateBerPoint(0, 10000, 42))
  assert.notEqual(point.errors, simulateBerPoint(0, 10000, 43).errors)
})

test('scan measurements agree with theory within a fixed statistical tolerance', () => {
  for (const db of [-4, 0, 4, 8]) {
    const point = simulateBerPoint(db, 100000, 2026)
    const standardError = Math.sqrt(
      (point.theoretical * (1 - point.theoretical)) / point.bits,
    )
    assert.ok(
      Math.abs(point.ber - point.theoretical) < 5 * standardError,
      `${db} dB: ${point.ber}`,
    )
  }
})

test('zero-error scan point preserves the measured zero and positive upper limit', () => {
  const point = simulateBerPoint(10, 10000, 42)
  assert.equal(point.errors, 0)
  assert.equal(point.ber, 0)
  assert.equal(point.interval.kind, 'zero-upper')
  assert.ok(point.interval.upper > point.theoretical)
})

test('scan points reject out-of-budget inputs before allocating arrays', () => {
  for (const count of [0, -1, 1.5, NaN, 1000001])
    assert.throws(() => simulateBerPoint(0, count, 42))
  for (const seed of [-1, NaN, 1.5, 4294967296])
    assert.throws(() => simulateBerPoint(0, 10000, seed))
})
