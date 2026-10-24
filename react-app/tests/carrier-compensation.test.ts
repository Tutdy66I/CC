import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  simulateCarrierPoint,
  defaultCarrierPlan,
  rotateCarrier,
  type CarrierPointRequest,
} from '../src/lib/carrierOffset.js'
import {
  simulateCompensationPoint,
  runCompensationExperiment,
} from '../src/lib/carrierCompensation.js'
import { comparisonBit } from '../src/lib/modulationComparison.js'
import { createAwgnSampler } from '../src/lib/signallab.js'
import { modulateQam16, demodulateQam16 } from '../src/lib/qam16.js'
import { modulateQpsk, demodulateQpsk } from '../src/lib/qpsk.js'
import { measureEvm } from '../src/lib/evm.js'

const request: CarrierPointRequest = {
  modulation: 'QPSK',
  bits: 1024,
  seed: 42,
  ebN0Db: 4,
  phaseDeg: 23,
  frequency: -0.0007,
  noiseEnabled: true,
}

test('paired raw path remains identical to v0.9 for all modulations and seed boundaries', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const)
    for (const seed of [0, 42, 0xffffffff]) {
      const p = { ...request, modulation, seed }
      assert.deepEqual(
        simulateCompensationPoint(p).before,
        simulateCarrierPoint(p),
      )
    }
})

test('actual noisy receive samples are inverse-rotated, matching an independent array channel', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const) {
    const bits = Array.from({ length: 1024 }, (_, n) => comparisonBit(n))
    const reference =
      modulation === 'BPSK'
        ? bits.map((b) => ({ i: 1 - 2 * b, q: 0 }))
        : modulation === 'QPSK'
          ? modulateQpsk(bits)
          : modulateQam16(bits)
    const noise = createAwgnSampler(4, 42),
      qNoise = createAwgnSampler(4, (42 ^ 0x9e3779b9) >>> 0)
    const received = reference.map((s, n) => {
      const a = (23 * Math.PI) / 180 + 2 * Math.PI * -0.0007 * n
      const c = Math.cos(a),
        t = Math.sin(a)
      const i = s.i * c - s.q * t + noise(0),
        q = s.i * t + s.q * c + (modulation === 'BPSK' ? qNoise(0) : noise(0))
      return { i: i * c + q * t, q: -i * t + q * c }
    })
    const decoded =
      modulation === 'BPSK'
        ? received.map((s) => (s.i >= 0 ? 0 : 1))
        : modulation === 'QPSK'
          ? demodulateQpsk(received)
          : demodulateQam16(received)
    const result = simulateCompensationPoint({ ...request, modulation })
    assert.equal(
      result.after.errors,
      decoded.reduce((sum, b, n) => sum + Number(b !== bits[n]), 0),
    )
    assert.ok(
      Math.abs(result.after.evmRms - measureEvm(reference, received).rms) <
        1e-12,
    )
    result.before.preview.forEach((raw, n) => {
      const expected = rotateCarrier(raw.i, raw.q, -23, 0.0007, raw.index)
      assert.deepEqual(
        { i: result.after.preview[n].i, q: result.after.preview[n].q },
        expected,
      )
    })
  }
})

test('zero offsets agree and all noiseless offsets recover bits with near-zero EVM', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const) {
    const zero = simulateCompensationPoint({
      ...request,
      modulation,
      phaseDeg: 0,
      frequency: 0,
    })
    assert.deepEqual(zero.before, zero.after)
    for (const phaseDeg of [
      -180, -90, 89.99999999999999, 90, 90.00000000000001, 180,
    ])
      for (const frequency of [-0.5, -0.001, 0, 0.001, 0.499]) {
        const p = simulateCompensationPoint({
          ...request,
          modulation,
          phaseDeg,
          frequency,
          noiseEnabled: false,
        })
        assert.equal(p.after.errors, 0)
        assert.equal(p.after.theoretical, 0)
        assert.ok(p.after.evmRms < 1e-12)
        assert.ok(p.theoreticalEvmAfter === 0)
        assert.ok(Math.abs(p.before.evmRms - p.theoreticalEvmBefore) < 1e-12)
      }
  }
})

test('rotating noise preserves energy across offsets; expected squared EVM has correct Eb normalization', () => {
  for (const [modulation, width] of [
    ['BPSK', 1],
    ['QPSK', 2],
    ['16QAM', 4],
  ] as const) {
    const a = simulateCompensationPoint({
      ...request,
      modulation,
      phaseDeg: 0,
      frequency: 0,
    })
    const b = simulateCompensationPoint({ ...request, modulation })
    assert.ok(Math.abs(a.after.evmRms - b.after.evmRms) < 1e-12)
    assert.ok(
      Math.abs(b.theoreticalEvmAfter - 1 / Math.sqrt(width * 10 ** 0.4)) <
        1e-12,
    )
    const staticPhase = simulateCompensationPoint({
      ...request,
      modulation,
      phaseDeg: 60,
      frequency: 0,
    })
    assert.ok(
      Math.abs(
        staticPhase.theoreticalEvmBefore ** 2 - (1 + 1 / (width * 10 ** 0.4)),
      ) < 1e-12,
    )
    assert.ok(Math.abs(b.after.theoretical - a.before.theoretical) < 1e-7)
  }
})

test('paired driver freezes seed schedule, reports complete progress and repeats exactly', () => {
  const plan = {
    ...defaultCarrierPlan(),
    bits: 1024,
    seed: 0xffffffff,
    offsets: [0, 60],
  }
  const progress: unknown[] = []
  const rows = runCompensationExperiment(plan, (m) => progress.push(m))
  assert.deepEqual(
    rows,
    runCompensationExperiment(plan, () => {}),
  )
  assert.deepEqual(rows[0].before.seeds, [5, 15, 25, 35, 45])
  assert.deepEqual(rows[0].before.seeds, rows[0].after.seeds)
  assert.deepEqual(rows[0].before, rows[0].after)
  assert.equal(rows[0].before.totalBits, 5120)
  assert.equal(progress.length, 11)
  assert.deepEqual(progress.at(-1), { type: 'done', rows })
  assert.throws(() =>
    runCompensationExperiment({ ...plan, seed: -1 }, () => {}),
  )
})

test('maximum frames remain bounded and compensated measurements agree with AWGN theory', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {simulateCompensationPoint} from './.test-build/src/lib/carrierCompensation.js';
    for(const modulation of ['BPSK','QPSK','16QAM']){
      const p=simulateCompensationPoint({modulation,bits:131072,seed:4294967295,ebN0Db:4,phaseDeg:37,frequency:.0013,noiseEnabled:true});
      assert.equal(p.before.preview.length,128);assert.equal(p.after.preview.length,128);
      assert.ok(Math.abs(p.after.ber-p.after.theoretical)<.01);
      assert.ok(Math.abs(p.after.evmRms-p.theoreticalEvmAfter)<.01);
    }
  `,
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
})
