import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createAwgnSampler } from '../src/lib/signallab.js'
import {
  estimatePilots,
  type PilotObservation,
} from '../src/lib/pilotEstimator.js'
import {
  defaultEstimationPlan,
  runEstimation,
  validateEstimationPlan,
} from '../src/lib/carrierEstimation.js'

function pilots(
  phase: number,
  frequency: number,
  spacing = 16,
): PilotObservation[] {
  return Array.from({ length: 128 }, (_, m) => {
    const index = m * spacing,
      angle = phase + 2 * Math.PI * frequency * index
    // Independent complex multiply, nonzero training phase.
    return {
      index,
      pi: 1,
      pq: 1,
      i: Math.cos(angle) - Math.sin(angle),
      q: Math.sin(angle) + Math.cos(angle),
    }
  })
}
const circular = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b))
test('truth-free pilot fit recovers signed frequencies and phase boundaries', () => {
  for (const phase of [-Math.PI, -3.14, 0, 3.14, Math.PI])
    for (const frequency of [-0.02, 0, 0.001, 0.02]) {
      const fit = estimatePilots(pilots(phase, frequency))
      assert.equal(fit.status, 'ok')
      if (fit.status !== 'ok') return
      assert.ok(Math.abs(fit.frequency - frequency) < 1e-12)
      assert.ok(Math.abs(circular(fit.phaseRad, phase)) < 1e-10)
      assert.ok(fit.residualRms < 1e-10)
    }
})
test('uniform pilots cannot distinguish frequencies differing by 1/L', () => {
  const a = estimatePilots(pilots(0.7, 0.002)),
    b = estimatePilots(pilots(0.7, 0.002 + 1 / 16))
  assert.equal(a.status, 'ok')
  assert.equal(b.status, 'ok')
  if (a.status === 'ok' && b.status === 'ok')
    assert.ok(Math.abs(a.frequency - b.frequency) < 1e-12)
})
test('invalid, zero magnitude and degenerate pilot observations fail explicitly', () => {
  for (const values of [
    [],
    pilots(0, 0).map((p) => ({ ...p, index: 0 })),
    pilots(0, 0).map((p) => ({ ...p, i: 0, q: 0 })),
    pilots(0, 0).map((p) => ({ ...p, q: NaN })),
    pilots(0, 0).map((p) => ({ ...p, pi: 0, pq: 0 })),
  ])
    assert.equal(estimatePilots(values).status, 'failed')
})
test('independent noisy phase reference agrees with ordinary least squares', () => {
  const samples = pilots(0.4, 0.002)
  const phases = samples.map(
    (p, m) => 0.4 + 2 * Math.PI * 0.002 * p.index + 0.02 * Math.sin(m),
  )
  samples.forEach((p, m) => {
    p.i = Math.cos(phases[m]) - Math.sin(phases[m])
    p.q = Math.sin(phases[m]) + Math.cos(phases[m])
  })
  const fit = estimatePilots(samples)
  assert.equal(fit.status, 'ok')
  const xm = samples.reduce((s, p) => s + p.index, 0) / samples.length,
    ym = phases.reduce((a, b) => a + b) / phases.length
  const slope =
    samples.reduce((s, p, m) => s + (p.index - xm) * (phases[m] - ym), 0) /
    samples.reduce((s, p) => s + (p.index - xm) ** 2, 0)
  if (fit.status === 'ok') {
    assert.ok(Math.abs(fit.frequency - slope / (2 * Math.PI)) < 1e-13)
    assert.ok(Math.abs(fit.phaseRad - (ym - slope * xm)) < 1e-11)
  }
})
test('three modulation noiseless frames recover data without including pilots in BER', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const)
    for (const frequency of [-0.003, 0, 0.003]) {
      const p = {
        ...defaultEstimationPlan(),
        modulation,
        frequency,
        phaseDeg: 180,
        noiseEnabled: false,
      }
      const r = runEstimation(p)
      assert.equal(
        r.dataBits,
        127 * 15 * (modulation === 'BPSK' ? 1 : modulation === 'QPSK' ? 2 : 4),
      )
      assert.equal(r.totalSymbols, 2033)
      assert.equal(r.pilotCount, 128)
      assert.equal(r.estimated?.errors, 0)
      assert.equal(r.ideal.errors, 0)
      assert.ok(r.estimated!.evmRms < 1e-9)
      assert.ok(r.ideal.evmRms < 1e-12)
      assert.ok(Math.abs(r.frequencyError!) < 1e-12)
      assert.ok(Math.abs(r.phaseErrorDeg!) < 1e-8)
    }
})
test('actual noisy data are paired inverse rotations and repeat deterministically', () => {
  const p = defaultEstimationPlan(),
    r = runEstimation(p)
  assert.deepEqual(r, runEstimation(p))
  assert.equal(r.fit.status, 'ok')
  if (r.fit.status !== 'ok') return
  for (const [branch, phase, freq] of [
    [r.ideal, (p.phaseDeg * Math.PI) / 180, p.frequency],
    [r.estimated!, r.fit.phaseRad, r.fit.frequency],
  ] as const) {
    r.raw.preview.forEach((raw, m) => {
      const a = phase + 2 * Math.PI * freq * raw.index,
        c = Math.cos(a),
        s = Math.sin(a),
        out = branch.preview[m]
      assert.ok(Math.abs(out.i - (raw.i * c + raw.q * s)) < 1e-10)
      assert.ok(Math.abs(out.q - (raw.q * c - raw.i * s)) < 1e-10)
      assert.ok(
        Math.abs(out.i ** 2 + out.q ** 2 - raw.i ** 2 - raw.q ** 2) < 1e-10,
      )
    })
  }
})
test('twenty-seed high-SNR study improves mean measurements while low SNR may fail', () => {
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const) {
    let raw = 0,
      estimated = 0,
      rawBer = 0,
      estimatedBer = 0
    for (let trial = 0; trial < 20; trial++) {
      const r = runEstimation({
        ...defaultEstimationPlan(),
        modulation,
        ebN0Db: 14,
        seed: (42 + trial * 10 + 9) >>> 0,
      })
      raw += r.raw.evmRms
      estimated += r.estimated!.evmRms
      rawBer += r.raw.ber
      estimatedBer += r.estimated!.ber
      const low = runEstimation({
        ...defaultEstimationPlan(),
        modulation,
        ebN0Db: -4,
        seed: trial,
      })
      assert.ok(Number.isFinite(low.raw.evmRms))
    }
    assert.ok(estimated < raw)
    assert.ok(estimatedBer < rawBer)
  }
})
test('out-of-range truth is evaluation only and invalid frame budgets are rejected', () => {
  const p = {
    ...defaultEstimationPlan(),
    noiseEnabled: false,
    frequency: 0.001 + 1 / 16,
  }
  const r = runEstimation(p)
  assert.equal(r.outsideRange, true)
  assert.ok(Math.abs(r.frequencyError!) > 0.06)
  assert.ok(r.estimated!.ber > 0)
  for (const patch of [
    { spacing: 1 },
    { pilots: 1 },
    { seed: -1 },
    { spacing: NaN },
    { noiseEnabled: 0 },
    { frequency: 0.5 },
    { pilots: 1025 },
  ])
    assert.throws(() => validateEstimationPlan({ ...p, ...patch }))
})

test('independent array channel and hard decisions match all noisy data and energy', () => {
  const bit = (n: number) => ((Math.floor(n / 4) % 16) >> (3 - (n % 4))) & 1
  const levels = [-3, -1, 3, 1],
    scale = Math.sqrt(4 / 10)
  const decode = (x: number) =>
    x < -2 * scale ? 0 : x < 0 ? 1 : x < 2 * scale ? 3 : 2
  for (const modulation of ['BPSK', 'QPSK', '16QAM'] as const)
    for (const seed of [0, 42, 0xffffffff]) {
      const p = {
        ...defaultEstimationPlan(),
        modulation,
        seed,
        spacing: 3,
        pilots: 8,
        ebN0Db: 4,
        phaseDeg: -179,
        frequency: -0.04,
      }
      const result = runEstimation(p),
        k = modulation === 'BPSK' ? 1 : modulation === 'QPSK' ? 2 : 4
      const noise = createAwgnSampler(p.ebN0Db, seed),
        qNoise = createAwgnSampler(p.ebN0Db, (seed ^ 0x9e3779b9) >>> 0)
      let d = 0,
        energy = 0,
        errors = 0,
        errorEnergy = 0
      for (let n = 0; n < result.totalSymbols; n++) {
        const pilot = n % 3 === 0,
          b = d * k
        const si = pilot
          ? k === 4
            ? Math.SQRT2
            : 1
          : k === 4
            ? levels[2 * bit(b) + bit(b + 1)] * scale
            : 1 - 2 * bit(b)
        const sq =
          k === 1
            ? 0
            : pilot
              ? k === 4
                ? Math.SQRT2
                : 1
              : k === 4
                ? levels[2 * bit(b + 2) + bit(b + 3)] * scale
                : 1 - 2 * bit(b + 1)
        const angle =
          (p.phaseDeg * Math.PI) / 180 + 2 * Math.PI * p.frequency * n
        const i = si * Math.cos(angle) - sq * Math.sin(angle) + noise(0),
          q =
            si * Math.sin(angle) +
            sq * Math.cos(angle) +
            (k === 1 ? qNoise(0) : noise(0))
        if (pilot) continue
        const sample = result.raw.preview[d]
        assert.equal(sample.index, n)
        assert.ok(Math.abs(sample.i - i) < 1e-12)
        assert.ok(Math.abs(sample.q - q) < 1e-12)
        if (k === 4)
          errors +=
            [0, 1, 1, 2][decode(si) ^ decode(i)] +
            [0, 1, 1, 2][decode(sq) ^ decode(q)]
        else {
          errors += Number(si >= 0 !== i >= 0)
          if (k === 2) errors += Number(sq >= 0 !== q >= 0)
        }
        energy += si * si + sq * sq
        errorEnergy += (i - si) ** 2 + (q - sq) ** 2
        d++
      }
      assert.equal(result.dataBits, d * k)
      assert.equal(result.raw.errors, errors)
      assert.ok(Math.abs(result.dataEnergy - energy) < 1e-12)
      assert.ok(
        Math.abs(result.raw.evmRms - Math.sqrt(errorEnergy / energy)) < 1e-12,
      )
    }
})

test('maximum pilot frame runs with 32 MiB old-space and returns bounded previews', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {runEstimation,defaultEstimationPlan} from './.test-build/src/lib/carrierEstimation.js';
    for(const modulation of ['BPSK','QPSK','16QAM']) {
      const r=runEstimation({...defaultEstimationPlan(),modulation,spacing:128,pilots:1024});
      assert.equal(r.totalSymbols,130945);assert.equal(r.raw.preview.length,128);
      assert.equal(r.fit.status,'ok');assert.equal(r.pilotObservations.length,1024);
    }
  `,
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
})

test('strict ambiguity boundaries are flagged and near-boundary noiseless fits remain exact', () => {
  for (const sign of [-1, 1]) {
    const near = runEstimation({
      ...defaultEstimationPlan(),
      noiseEnabled: false,
      frequency: sign * (1 / 32 - 1e-8),
    })
    assert.equal(near.outsideRange, false)
    assert.ok(Math.abs(near.frequencyError!) < 1e-12)
    const boundary = runEstimation({
      ...defaultEstimationPlan(),
      noiseEnabled: false,
      frequency: sign / 32,
    })
    assert.equal(boundary.outsideRange, true)
    assert.equal(boundary.fit.status, 'ok')
    if (boundary.fit.status === 'ok')
      assert.ok(boundary.fit.warnings.length > 0)
  }
})
