import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  berInterval,
  simulateBerPoint,
  theoreticalBpskBer,
  SWEEP_DB,
  MAX_SWEEP_BITS,
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

test('scan results exactly match the array channel across range, odd counts and boundary seeds', () => {
  for (const count of [1, 2, 3, 31, 10000]) {
    const input = Array.from({ length: count }, (_, index) => index % 2)
    for (const seed of [0, 1, 42, 0xffffffff]) {
      for (const db of [-10, ...SWEEP_DB, 15]) {
        const expected = simulateBpsk(input, db, seed)
        const point = simulateBerPoint(db, count, seed)
        assert.equal(
          point.errors,
          expected.errors,
          `N=${count}, seed=${seed}, db=${db}`,
        )
        assert.equal(point.ber, expected.ber)
        assert.deepEqual(point.interval, berInterval(expected.errors, count))
      }
    }
  }
})

test('maximum scan budget and wrapped seed retain exact counts', () => {
  const input = Array.from({ length: MAX_SWEEP_BITS }, (_, index) => index % 2)
  const seed = (0xffffffff + 1) >>> 0
  const expected = simulateBpsk(input, -4, seed)
  const point = simulateBerPoint(-4, MAX_SWEEP_BITS, seed)
  assert.equal(point.errors, expected.errors)
  assert.equal(point.ber, expected.ber)
})

test('million-bit scan fits a 32 MiB V8 old-space budget', () => {
  const moduleUrl = new URL('../src/lib/berSweep.js', import.meta.url).href
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `import { simulateBerPoint } from ${JSON.stringify(moduleUrl)}; const p = simulateBerPoint(0, 1000000, 42); if (p.bits !== 1000000) process.exit(2)`,
    ],
    { encoding: 'utf8', timeout: 15000 },
  )
  assert.equal(
    child.status,
    0,
    `scan exceeded heap budget or failed: ${child.error?.message ?? child.signal ?? child.stderr.slice(-300)}`,
  )
})

test('intervals are finite and bounded for a single bit and safe-integer sample limit', () => {
  for (const bits of [1, Number.MAX_SAFE_INTEGER]) {
    for (const errors of [0, 1, bits]) {
      const { lower, upper } = berInterval(errors, bits)
      assert.ok(Number.isFinite(lower) && Number.isFinite(upper))
      assert.ok(lower >= 0 && upper <= 1 && lower <= upper)
    }
  }
  assert.throws(() => berInterval(0, Number.MAX_SAFE_INTEGER + 1))
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
