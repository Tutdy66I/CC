import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  comparisonBit,
  simulateComparisonPoint,
  MODULATIONS,
  validateComparisonRequest,
} from '../src/lib/modulationComparison.js'
import { simulateBpsk } from '../src/lib/signallab.js'
import { simulateQpsk } from '../src/lib/qpsk.js'
import { simulateQam16 } from '../src/lib/qam16.js'
import { measureEvm } from '../src/lib/evm.js'

test('comparison sequence covers every four-bit word uniformly', () => {
  const bits = Array.from({ length: 64 }, (_, i) => comparisonBit(i))
  for (let symbol = 0; symbol < 16; symbol++)
    assert.equal(
      parseInt(bits.slice(symbol * 4, symbol * 4 + 4).join(''), 2),
      symbol,
    )
  for (let i = 0; i < 64; i++)
    assert.equal(comparisonBit(i), comparisonBit(i + 64))
})

test('streaming comparison matches full BPSK/QPSK/16QAM BER and reference-aided EVM', () => {
  const bits = Array.from({ length: 1024 }, (_, i) => comparisonBit(i))
  const simulations = {
    BPSK: simulateBpsk,
    QPSK: simulateQpsk,
    '16QAM': simulateQam16,
  }
  for (const modulation of MODULATIONS)
    for (const seed of [0, 42, 0xffffffff])
      for (const db of [-4, 0, 10, 14]) {
        const actual = simulateComparisonPoint(
          modulation,
          db,
          bits.length,
          seed,
        )
        const expected = simulations[modulation](bits, db, seed)
        assert.equal(actual.errors, expected.errors)
        assert.equal(actual.ber, expected.ber)
        assert.ok(
          Math.abs(
            actual.evm.percent -
              measureEvm(expected.symbols, expected.received).percent,
          ) < 1e-11,
        )
      }
})

test('common random numbers explain identical BPSK and QPSK comparison BER', () => {
  const a = simulateComparisonPoint('BPSK', 0, 131072, 42)
  const b = simulateComparisonPoint('QPSK', 0, 131072, 42)
  const qam = simulateComparisonPoint('16QAM', 0, 131072, 42)
  assert.equal(a.errors, b.errors)
  assert.ok(qam.ber > a.ber)
  assert.ok(Math.abs(a.evm.rms - Math.SQRT1_2) < 0.01)
  assert.ok(Math.abs(qam.evm.rms - 0.5) < 0.01)
  for (const point of [a, b, qam])
    assert.deepEqual(
      point,
      simulateComparisonPoint(point.modulation, 0, 131072, 42),
    )
})

test('comparison rejects partial constellation cycles and out-of-budget requests', () => {
  for (const bits of [0, 1, 63, 65, 1000001, Infinity])
    assert.throws(() => validateComparisonRequest({ bits, seed: 42 }))
  for (const seed of [-1, 1.5, Infinity, 0x100000000])
    assert.throws(() => validateComparisonRequest({ bits: 64, seed }))
  assert.doesNotThrow(() =>
    validateComparisonRequest({ bits: 1000000, seed: 0xffffffff }),
  )
})

test('million-bit three-modulation comparison fits a 32 MiB old-space budget', () => {
  const url = new URL('../src/lib/modulationComparison.js', import.meta.url)
    .href
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `import { simulateComparisonPoint, MODULATIONS } from ${JSON.stringify(url)}; for(const m of MODULATIONS) simulateComparisonPoint(m,0,1000000,42)`,
    ],
    { encoding: 'utf8', timeout: 15000 },
  )
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr.slice(-300),
  )
})
