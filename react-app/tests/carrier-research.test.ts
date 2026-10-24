import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  defaultResearchPlan,
  researchSeeds,
  validateResearchPlan,
  researchOperations,
  makeResearchFrames,
  simulateResearchTrial,
  runCarrierResearch,
  validateResearchPrefix,
} from '../src/lib/carrierResearch.js'

test('research freezes resources, separates seed domains and rejects excessive budgets', () => {
  const p = defaultResearchPlan(),
    a = researchSeeds(p, 'calibration'),
    b = researchSeeds(p, 'evaluation')
  assert.equal(a.length, 20)
  assert.equal(b.length, 20)
  assert.equal(new Set([...a, ...b]).size, 40)
  assert.ok(researchOperations(p) < 50_000_000)
  assert.throws(() =>
    validateResearchPlan({
      ...p,
      frameSymbols: 2049,
      trials: 200,
      layouts: [{ kind: 'paired', spacing: 8 }],
    }),
  )
  for (const seed of [0, 42, 0xffffffff]) {
    const q = { ...p, seed }
    assert.equal(
      new Set([
        ...researchSeeds(q, 'calibration'),
        ...researchSeeds(q, 'evaluation'),
      ]).size,
      40,
    )
  }
})
test('200-trial confirmation supports the full uint32 seed schedule without changing v1 helpers', () => {
  const p = {
    ...defaultResearchPlan(),
    frameSymbols: 257,
    trials: 200,
    seed: 0xffffffff,
    layouts: [{ kind: 'uniform' as const, spacing: 16 }],
  }
  validateResearchPlan(p)
  const calibration = researchSeeds(p, 'calibration'),
    evaluation = researchSeeds(p, 'evaluation')
  assert.equal(evaluation.length, 200)
  assert.equal(new Set([...calibration, ...evaluation]).size, 220)
  assert.equal(evaluation[199], (p.seed + 0x40000000 + 199 * 10 + 2) >>> 0)
  const confirmed = runCarrierResearch({ ...p, noiseEnabled: false }, () => {})
  assert.equal(confirmed.evaluation.length, 200)
  assert.equal(confirmed.summary[0].methods.ml.failures, 0)
  assert.ok(
    Math.abs(
      confirmed.summary[0].methods.ml.failureInterval.upper -
        (1 - Math.pow(0.05, 1 / 200)),
    ) < 1e-12,
  )
})
test('absolute-index frames pair common noisy data and disclose actual pilot resources', () => {
  const p = defaultResearchPlan(),
    frames = makeResearchFrames(p, 42)
  for (const n of frames.commonIndices)
    assert.deepEqual(
      [frames.arms[0].i[n], frames.arms[0].q[n]],
      [frames.arms[1].i[n], frames.arms[1].q[n]],
    )
  assert.equal(frames.arms[0].pilots.length, frames.arms[1].pilots.length)
  assert.equal(frames.arms[0].pilotEnergy, frames.arms[1].pilotEnergy)
  assert.ok(frames.commonIndices.length < frames.arms[0].dataIndices.length)
})
test('noiseless branch errors and alias classes remain separate from acquisition labels', () => {
  const p = {
    ...defaultResearchPlan(),
    noiseEnabled: false,
    frequency: 0.071,
    frameSymbols: 257,
  }
  const t = simulateResearchTrial(p, 'evaluation', 0)
  const uniform = t.arms[0],
    shifted = t.arms[1]
  assert.equal(uniform.ml.acquired, false)
  assert.equal(uniform.ml.aliasClassError, true)
  assert.equal(shifted.ml.acquired, true)
  assert.equal(shifted.ml.aliasClassError, false)
  assert.equal(shifted.ml.all?.errors, 0)
  assert.ok(shifted.ml.all!.evmRms < 1e-5)
  assert.equal(shifted.ml.branchChanges, null)
  assert.ok(uniform.ols.branchChanges! > 0)
})
test('full research is deterministic, resumable and never gives partial-run confidence claims', () => {
  const p = { ...defaultResearchPlan(), frameSymbols: 257, noiseEnabled: false }
  const prefix = Array.from({ length: 5 }, (_, m) =>
    simulateResearchTrial(p, 'calibration', m),
  )
  validateResearchPrefix(p, prefix)
  const events: unknown[] = []
  const result = runCarrierResearch(p, (m) => events.push(m), {
    resume: prefix,
  })
  assert.deepEqual(
    result,
    runCarrierResearch(p, () => {}),
  )
  assert.equal(result.evaluation.length, 20)
  assert.equal(result.calibration.length, 20)
  assert.equal(events.length, 36)
  assert.deepEqual(events.at(-1), { type: 'done', result })
  for (const row of result.summary) {
    assert.equal(row.methods.ml.failures, 0)
    assert.ok(row.methods.ml.failureInterval.upper > 0)
    assert.equal(row.methods.ml.total, 20)
  }
  const bad = structuredClone(prefix)
  bad[0].seed++
  assert.throws(() => validateResearchPrefix(p, bad))
})
test('detector calibration is frozen without evaluation truth leakage, and reports both error classes', () => {
  const p = { ...defaultResearchPlan(), frameSymbols: 257, ebN0Db: -4 }
  const result = runCarrierResearch(p, () => {})
  for (const row of result.summary)
    for (const method of ['ols', 'ml'] as const) {
      const r = row.methods[method]
      assert.equal(r.total, 20)
      if (r.confusion)
        assert.equal(
          r.confusion.tp + r.confusion.fp + r.confusion.fn + r.confusion.tn,
          20,
        )
      assert.ok(r.valid <= 20)
      assert.ok(r.failureInterval.lower >= 0 && r.failureInterval.upper <= 1)
      assert.ok(
        r.roc.every(
          (point) => point.fpr === null || (point.fpr >= 0 && point.fpr <= 1),
        ),
      )
    }
})

test('maximum frame six-layout kernel stays bounded under 32 MiB old-space', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=32',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {defaultResearchPlan,simulateResearchTrial} from './.test-build/src/lib/carrierResearch.js';
    const layouts=[... [8,16,32,64].map(spacing=>({kind:'uniform',spacing})),{kind:'shifted',spacing:16},{kind:'paired',spacing:16}];
    for(const modulation of ['BPSK','QPSK','16QAM']){const trial=simulateResearchTrial({...defaultResearchPlan(),modulation,frameSymbols:2049,layouts},'evaluation',0);assert.equal(trial.arms.length,6);for(const a of trial.arms)assert.equal(a.ml.fit.status,'ok')}
  `,
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
})
