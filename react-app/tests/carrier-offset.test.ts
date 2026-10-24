import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  rotateCarrier,
  simulateCarrierPoint,
  runCarrierExperiment,
  defaultCarrierPlan,
  validateCarrierPlan,
  type CarrierPointRequest,
} from '../src/lib/carrierOffset.js'
import {
  simulateComparisonPoint,
  comparisonBit,
} from '../src/lib/modulationComparison.js'
import { createAwgnSampler } from '../src/lib/signallab.js'
import { modulateQpsk, demodulateQpsk } from '../src/lib/qpsk.js'
import { modulateQam16, demodulateQam16 } from '../src/lib/qam16.js'
import { measureEvm } from '../src/lib/evm.js'

const request: CarrierPointRequest = {
  modulation: 'QPSK',
  bits: 1024,
  ebN0Db: 4,
  seed: 42,
  phaseDeg: 0,
  frequency: 0,
  noiseEnabled: true,
}

test('rotation fixes quadrantal ties, preserves energy and tracks absolute symbol time', () => {
  assert.deepEqual(rotateCarrier(1, 0, 90, 0, 0), { i: 0, q: 1 })
  assert.deepEqual(rotateCarrier(1, 0, 0, 0.25, 2), { i: -1, q: 0 })
  assert.deepEqual(rotateCarrier(1, 0, 0, -0.25, 1), { i: 0, q: -1 })
  const p = rotateCarrier(2, -3, 17, 0.001, 131071)
  assert.ok(Math.abs(p.i ** 2 + p.q ** 2 - 13) < 1e-12)
  const tiny = rotateCarrier(1, 0, 1e-14, 0, 0)
  assert.ok(Math.abs(tiny.q - (1e-14 * Math.PI) / 180) < 1e-29)
  for (const [phaseDeg, expected] of [
    [89.99999999999999, 0],
    [90, 0.5],
    [90.00000000000001, 1],
  ]) {
    assert.equal(
      simulateCarrierPoint({
        ...request,
        modulation: 'BPSK',
        phaseDeg,
        noiseEnabled: false,
      }).ber,
      expected,
    )
  }
})

test('zero offsets preserve legacy BER and complex QPSK/QAM EVM for boundary seeds', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const)
    for (const seed of [0, 42, 0xffffffff]) {
      const p = simulateCarrierPoint({ ...request, modulation, seed })
      const old = simulateComparisonPoint(modulation, 4, 1024, seed)
      assert.equal(p.errors, old.errors)
      if (modulation !== 'BPSK')
        assert.ok(Math.abs(p.evmRms - old.evm.rms) < 1e-12)
      assert.ok(Math.abs(p.theoretical - old.theoretical) < 1e-7)
    }
})

test('streamed phase/frequency samples match independent array channel and original slicers', () => {
  const bits = Array.from({ length: 1024 }, (_, n) => comparisonBit(n))
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const) {
    const symbols =
      modulation === 'BPSK'
        ? bits.map((b) => ({ i: 1 - 2 * b, q: 0 }))
        : modulation === 'QPSK'
          ? modulateQpsk(bits)
          : modulateQam16(bits)
    const noise = createAwgnSampler(4, 42)
    const qNoise = createAwgnSampler(4, (42 ^ 0x9e3779b9) >>> 0)
    const received = symbols.map((s, n) => {
      const angle = (23 / 180) * Math.PI + 2 * Math.PI * -0.0007 * n
      return {
        i: s.i * Math.cos(angle) - s.q * Math.sin(angle) + noise(0),
        q:
          s.i * Math.sin(angle) +
          s.q * Math.cos(angle) +
          (modulation === 'BPSK' ? qNoise(0) : noise(0)),
      }
    })
    const decoded =
      modulation === 'BPSK'
        ? received.map((r) => (r.i >= 0 ? 0 : 1))
        : modulation === 'QPSK'
          ? demodulateQpsk(received)
          : demodulateQam16(received)
    const p = simulateCarrierPoint({
      ...request,
      modulation,
      phaseDeg: 23,
      frequency: -0.0007,
    })
    assert.equal(
      p.errors,
      decoded.reduce((sum, b, i) => sum + Number(b !== bits[i]), 0),
    )
    assert.ok(Math.abs(p.evmRms - measureEvm(symbols, received).rms) < 1e-12)
    assert.equal(p.preview[0].index, 0)
    assert.equal(p.preview.at(-1)?.index, symbols.length - 1)
    assert.ok(p.preview.length <= 128)
  }
})

test('noise-free phase EVM and deterministic boundary predictions are exact', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const)
    for (const phaseDeg of [-180, -90, -30, 0, 30, 90, 180]) {
      const p = simulateCarrierPoint({
        ...request,
        modulation,
        phaseDeg,
        noiseEnabled: false,
      })
      assert.equal(p.ber, p.theoretical)
      assert.ok(
        Math.abs(
          p.evmRms - 2 * Math.abs(Math.sin((phaseDeg * Math.PI) / 360)),
        ) < 1e-12,
      )
    }
  const p = simulateCarrierPoint({
    ...request,
    modulation: 'BPSK',
    phaseDeg: 90,
  })
  assert.equal(p.theoretical, 0.5)
})

test('finite-frame predictions match independent Gaussian reference values', () => {
  // Python math.erfc reference: Q(sqrt(2*10**(.4))*cos(pi/6)).
  const b = simulateCarrierPoint({
    ...request,
    modulation: 'BPSK',
    phaseDeg: 30,
  })
  assert.ok(Math.abs(b.theoretical - 0.026123692470602245) < 1e-7)
  const q = simulateCarrierPoint({ ...request, phaseDeg: 45 })
  // 0.5*(Q(2*sqrt(10**.4)) + Q(0)).
  assert.ok(Math.abs(q.theoretical - 0.2503813776085476) < 1e-7)
  // Independent Python stdlib erfc integration: scripts/carrier-reference.py.
  for (const [modulation, expected] of [
    ['BPSK', 0.555836182026755],
    ['QPSK', 0.24340575338237275],
    ['16QAM', 0.13826707484971854],
  ] as const) {
    const p = simulateCarrierPoint({
      ...request,
      modulation,
      phaseDeg: 23,
      frequency: -0.0007,
    })
    assert.ok(Math.abs(p.theoretical - expected) < 1e-7)
  }
  for (const [modulation, expected] of [
    ['BPSK', 0.41427093382741054],
    ['QPSK', 0.5407862918699152],
    ['16QAM', 0.2943847040389951],
  ] as const) {
    const p = simulateCarrierPoint({
      ...request,
      modulation,
      phaseDeg: -17,
      frequency: 0.0013,
    })
    assert.ok(Math.abs(p.theoretical - expected) < 1e-7)
  }
})

test('trials retain full-grid seed indices and paired offset streams with positive zero-error bounds', () => {
  const plan = {
    ...defaultCarrierPlan(),
    seed: 0xffffffff,
    ebN0Db: 14,
    bits: 1024,
    offsets: [0, 30],
    noiseEnabled: false,
  }
  const rows = runCarrierExperiment(plan, () => {})
  assert.deepEqual(rows[0].seeds, [8, 18, 28, 38, 48])
  assert.deepEqual(rows[0].seeds, rows[1].seeds)
  assert.equal(rows[0].totalErrors, 0)
  assert.ok(rows[0].interval[1] > 0)
  assert.deepEqual(
    rows,
    runCarrierExperiment(plan, () => {}),
  )
})

test('requests reject invalid inputs and work explosion rather than coercing values', () => {
  for (const patch of [
    { bits: 63 },
    { seed: -1 },
    { seed: 2 ** 32 },
    { phaseDeg: NaN },
    { frequency: 0.5 },
    { frequency: Infinity },
    { ebN0Db: 3 },
    { trials: 1 },
    { offsets: [0, 0] },
    { offsets: [30, 0] },
    { offsets: [NaN] },
    { noiseEnabled: 1 },
    { offsets: Array.from({ length: 22 }, (_, n) => n) },
  ])
    assert.throws(
      () => validateCarrierPlan({ ...defaultCarrierPlan(), ...patch }),
      JSON.stringify(patch),
    )
  assert.throws(() => validateCarrierPlan(null))
  assert.throws(() =>
    simulateCarrierPoint({
      ...request,
      modulation: 'bad',
    } as unknown as CarrierPointRequest),
  )
})

test('maximum frame uses bounded storage and agrees with conditional theory', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { simulateCarrierPoint } from './.test-build/src/lib/carrierOffset.js';
    for (const modulation of ['BPSK','QPSK','16QAM']) {
      const p = simulateCarrierPoint({modulation,bits:131072,ebN0Db:4,seed:4294967295,
        phaseDeg:17,frequency:.0013,noiseEnabled:true});
      assert.equal(p.preview.length,128);
      assert.ok(Math.abs(p.ber-p.theoretical)<.02);
    }
  `,
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
})
