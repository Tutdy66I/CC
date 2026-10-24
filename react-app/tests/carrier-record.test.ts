import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultCarrierPlan,
  runCarrierExperiment,
} from '../src/lib/carrierOffset.js'
import {
  makeCarrierRecord,
  readCarrierRecords,
  parseCarrierRecord,
} from '../src/lib/carrierOffsetRecord.js'

const plan = { ...defaultCarrierPlan(), bits: 64, offsets: [0] }
const record = () =>
  makeCarrierRecord(
    plan,
    runCarrierExperiment(plan, () => {}),
    'test',
    '2026-10-24T00:00:00.000Z',
  )

test('carrier records roundtrip independently and freeze their executable inputs', () => {
  const r = record()
  assert.deepEqual(parseCarrierRecord(JSON.parse(JSON.stringify(r))), r)
  assert.deepEqual(readCarrierRecords(JSON.stringify([r])), {
    records: [r],
    rejected: 0,
  })
  assert.notEqual(r.plan, plan)
  assert.equal(r.engineVersion, 'carrier-offset-v1')
})

test('unknown versions and corrupted counts, seeds, intervals and preview are rejected', () => {
  const r = record()
  for (const bad of [
    { ...r, version: 2 },
    { ...r, engineVersion: 'future' },
    { ...r, seedRule: 'changed' },
    { ...r, symbolStart: 1 },
    { ...r, id: '' },
    { ...r, rows: [{ ...r.rows[0], totalBits: 63 }] },
    { ...r, rows: [{ ...r.rows[0], totalErrors: 0.5 }] },
    { ...r, rows: [{ ...r.rows[0], theoretical: -1 }] },
    { ...r, rows: [{ ...r.rows[0], seeds: [1, 2, 3, 4, 5] }] },
    { ...r, rows: [{ ...r.rows[0], interval: [0, 0] }] },
    { ...r, rows: [{ ...r.rows[0], preview: [{ index: -1 }] }] },
  ])
    assert.throws(() => parseCarrierRecord(bad))
  assert.deepEqual(
    readCarrierRecords(JSON.stringify([r, { ...r, version: 9 }])),
    { records: [r], rejected: 1 },
  )
  assert.deepEqual(readCarrierRecords('broken'), { records: [], rejected: 1 })
  assert.deepEqual(readCarrierRecords(null), { records: [], rejected: 0 })
})
