import assert from 'node:assert/strict'
import test from 'node:test'
import { measureEvm } from '../src/lib/evm.js'

test('EVM normalizes error energy to the actual transmitted reference', () => {
  const result = measureEvm(
    [
      { i: 1, q: 1 },
      { i: -1, q: -1 },
    ],
    [
      { i: 1.1, q: 1.1 },
      { i: -1.1, q: -1.1 },
    ],
  )
  assert.ok(Math.abs(result.rms - 0.1) < 1e-14)
  assert.ok(Math.abs(result.percent - 10) < 1e-12)
  assert.ok(Math.abs(result.db! + 20) < 1e-12)
  assert.deepEqual(measureEvm([1, -1], [1, -1]), {
    rms: 0,
    percent: 0,
    db: null,
  })
  assert.equal(measureEvm([1], [3]).percent, 200)
  // A deliberately wrong hard decision cannot become the EVM reference.
  assert.equal(measureEvm([1], [-1]).percent, 200)
})

test('EVM rejects empty, mismatched, zero-energy, nonfinite and overflowing data', () => {
  assert.throws(() => measureEvm([], []))
  assert.throws(() => measureEvm([1], []))
  assert.throws(() => measureEvm([0], [1]))
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    assert.throws(() => measureEvm([1], [value]))
})
