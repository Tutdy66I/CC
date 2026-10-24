import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultEstimationPlan,
  runEstimation,
} from '../src/lib/carrierEstimation.js'
import {
  makeEstimationRecord,
  parseEstimationRecord,
  readEstimationRecords,
  ESTIMATION_HISTORY_KEY,
} from '../src/lib/carrierEstimationRecord.js'

test('estimation snapshots are isolated, detached and bounded', () => {
  const p = defaultEstimationPlan(),
    result = runEstimation(p),
    record = makeEstimationRecord(p, result, 'test', '2026-10-24T00:00:00Z')
  p.seed = 0
  result.raw.errors = 99
  assert.equal(record.plan.seed, 42)
  assert.deepEqual(
    parseEstimationRecord(JSON.parse(JSON.stringify(record))),
    record,
  )
  assert.equal(
    readEstimationRecords(JSON.stringify([record])).records.length,
    1,
  )
  assert.equal(
    readEstimationRecords(JSON.stringify([record, record])).rejected,
    1,
  )
  assert.equal(ESTIMATION_HISTORY_KEY, 'signallab-carrier-estimation-v1')
  assert.equal(readEstimationRecords(null).rejected, 0)
  for (const text of [
    '{',
    '[]x',
    JSON.stringify(Array(6).fill(record)),
    ' '.repeat(4_000_001),
  ])
    assert.ok(readEstimationRecords(text).rejected > 0)
})
test('malformed metadata, fit, metrics, paired previews and frozen parameters are rejected', () => {
  const valid = makeEstimationRecord(
    defaultEstimationPlan(),
    runEstimation(defaultEstimationPlan()),
    'test',
    '2026-10-24T00:00:00Z',
  )
  for (const corrupt of [
    (r: typeof valid) => {
      r.engineVersion = 'unknown' as typeof r.engineVersion
    },
    (r: typeof valid) => {
      r.result.dataBits++
    },
    (r: typeof valid) => {
      r.result.raw.ber = 0.9
    },
    (r: typeof valid) => {
      r.result.ideal.preview[0].i++
    },
    (r: typeof valid) => {
      r.result.estimated = null
    },
    (r: typeof valid) => {
      if (r.result.fit.status === 'ok') r.result.fit.frequency += 0.01
    },
    (r: typeof valid) => {
      r.plan.seed = -1
    },
    (r: typeof valid) => {
      r.result.frequencyError = 0
    },
    (r: typeof valid) => {
      r.result.dataEnergy = 1
      r.result.payloadEnergyRatio = 1 + r.plan.pilots * 2
    },
  ]) {
    const changed = structuredClone(valid)
    corrupt(changed)
    assert.throws(() => parseEstimationRecord(changed))
  }
})

test('record projection discards unknown nested fields instead of growing persisted payloads', () => {
  const p = defaultEstimationPlan(),
    r = makeEstimationRecord(
      p,
      runEstimation(p),
      'test',
      '2026-10-24T00:00:00Z',
    )
  const extra = JSON.parse(JSON.stringify(r))
  extra.result.unexpected = 'arbitrary'
  extra.result.raw.preview[0].unexpected = 'arbitrary'
  assert.deepEqual(parseEstimationRecord(extra), r)
})
