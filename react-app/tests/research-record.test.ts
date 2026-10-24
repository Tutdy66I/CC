import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultResearchPlan,
  runCarrierResearch,
} from '../src/lib/carrierResearch.js'
import {
  makeResearchRecord,
  parseResearchRecord,
  readResearchHistory,
  parseResearchCheckpoint,
  RESEARCH_HISTORY_KEY,
  parseResearchTrial,
} from '../src/lib/carrierResearchRecord.js'

test('incremental trial parsing validates its absolute position without rereading earlier trials', () => {
  const plan = { ...defaultResearchPlan(), frameSymbols: 257 }
  const result = runCarrierResearch(plan, () => {})
  const trials = [...result.calibration, ...result.evaluation]
  for (const [index, trial] of trials.entries()) {
    assert.deepEqual(parseResearchTrial(plan, trial, index), trial)
  }
  assert.throws(() => parseResearchTrial(plan, trials[0], 1))
  const bad = structuredClone(trials[25])
  bad.arms[0].ml.phaseRms = 3
  assert.throws(() => parseResearchTrial(plan, bad, 25))
})

test('research history projects bounded versioned snapshots and does not share legacy keys', () => {
  const p = { ...defaultResearchPlan(), frameSymbols: 257 },
    result = runCarrierResearch(p, () => {}),
    record = makeResearchRecord(result, 'test', '2026-10-24T00:00:00Z')
  const extra = JSON.parse(JSON.stringify(record))
  extra.result.evaluation[0].arms[0].ml.fit.unexpected = 'drop'
  assert.deepEqual(parseResearchRecord(extra), record)
  assert.equal(readResearchHistory(JSON.stringify([record])).records.length, 1)
  assert.equal(
    readResearchHistory(JSON.stringify([record, record])).rejected,
    1,
  )
  assert.equal(RESEARCH_HISTORY_KEY, 'signallab-carrier-research-v11')
  for (const corrupt of [
    (r: typeof record) => {
      r.result.summary[0].methods.ml.failures++
    },
    (r: typeof record) => {
      r.result.evaluation[0].seed++
    },
    (r: typeof record) => {
      r.result.evaluation[0].arms[0].raw.all.ber = 0.91
    },
    (r: typeof record) => {
      r.result.calibration.pop()
    },
  ]) {
    const bad = structuredClone(record)
    corrupt(bad)
    assert.throws(() => parseResearchRecord(bad))
  }
})
test('checkpoints preserve only a valid prefix and cannot fabricate completed statistics', () => {
  const p = { ...defaultResearchPlan(), frameSymbols: 257 },
    r = runCarrierResearch(p, () => {}),
    prefix = r.calibration.slice(0, 7)
  const checkpoint = { engineVersion: r.engineVersion, plan: p, trials: prefix }
  assert.equal(parseResearchCheckpoint(checkpoint).trials.length, 7)
  assert.throws(() =>
    parseResearchCheckpoint({ ...checkpoint, trials: [prefix[2]] }),
  )
  for (const text of ['bad', '[{}]', ' '.repeat(12_000_001)])
    assert.ok(readResearchHistory(text).rejected > 0)
})

test('checkpoints reject impossible solver metadata, subset errors and phase RMS', () => {
  const p = {
      ...defaultResearchPlan(),
      frameSymbols: 257,
      noiseEnabled: false,
    },
    r = runCarrierResearch(p, () => {}),
    original = {
      engineVersion: r.engineVersion,
      plan: p,
      trials: r.calibration.slice(0, 1),
    }
  for (const mutate of [
    (c: typeof original) => {
      c.trials[0].arms[0].ml.fit = {
        status: 'ok',
        phaseRad: 0,
        frequency: 0.25,
        period: 1 / 16,
        coherenceDeficit: 0,
        peakRatio: 2,
        gridSize: 0,
        operations: 0,
        boundaryHit: false,
      }
    },
    (c: typeof original) => {
      const o = c.trials[0].arms[0].ml
      o.common!.errors = 1
      o.common!.ber = 1 / o.common!.bits
    },
    (c: typeof original) => {
      c.trials[0].arms[0].ml.phaseRms = 3
    },
    (c: typeof original) => {
      const f = c.trials[0].arms[0].ml.fit
      if (f.status === 'ok') {
        f.gridSize = 0
        f.operations = 0
      }
    },
    (c: typeof original) => {
      c.trials[0].arms[0].ideal.common.evmRms = 2
    },
    (c: typeof original) => {
      const m = c.trials[0].arms[1].raw.common
      m.errors++
      m.ber = m.errors / m.bits
    },
  ]) {
    const changed = structuredClone(original)
    mutate(changed)
    assert.throws(() => parseResearchCheckpoint(changed))
  }
})
