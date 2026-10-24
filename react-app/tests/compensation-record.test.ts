import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultCarrierPlan } from '../src/lib/carrierOffset.js'
import { runCompensationExperiment } from '../src/lib/carrierCompensation.js'
import {
  makeCompensationRecord,
  parseCompensationRecord,
  readCompensationRecords,
  COMPENSATION_HISTORY_KEY,
} from '../src/lib/carrierCompensationRecord.js'
import { CARRIER_HISTORY_KEY } from '../src/lib/carrierOffsetRecord.js'

const plan = { ...defaultCarrierPlan(), bits: 64, offsets: [0, 60] }
const create = () =>
  makeCompensationRecord(
    plan,
    runCompensationExperiment(plan, () => {}),
    'paired',
    '2026-10-24T00:00:00Z',
  )

test('versioned paired snapshots roundtrip, detach and use a separate history key', () => {
  const record = create()
  assert.notEqual(COMPENSATION_HISTORY_KEY, CARRIER_HISTORY_KEY)
  assert.deepEqual(
    parseCompensationRecord(JSON.parse(JSON.stringify(record))),
    record,
  )
  assert.notEqual(record.plan, plan)
  assert.deepEqual(readCompensationRecords(JSON.stringify([record])), {
    records: [record],
    rejected: 0,
  })
})

test('unknown engines, mismatched pairs, false correction previews and invalid theory are rejected', () => {
  const r = create(),
    row = r.rows[1]
  for (const bad of [
    { ...r, version: 2 },
    { ...r, engineVersion: 'future' },
    { ...r, compensation: 'estimated' },
    { ...r, seedRule: 'different' },
    { ...r, sourceEngine: 'different' },
    { ...r, rows: [r.rows[0]] },
    {
      ...r,
      rows: [r.rows[0], { ...row, after: { ...row.after, totalBits: 1 } }],
    },
    { ...r, rows: [r.rows[0], { ...row, theoreticalEvmAfter: 1 }] },
    { ...r, rows: [r.rows[0], { ...row, theoreticalEvmBefore: NaN }] },
    { ...r, rows: [r.rows[0], { ...row, theoreticalEvmBefore: 1e100 }] },
    {
      ...r,
      rows: [r.rows[0], { ...row, after: { ...row.after, theoretical: 1 } }],
    },
    {
      ...r,
      rows: [
        r.rows[0],
        { ...row, after: { ...row.after, preview: row.before.preview } },
      ],
    },
  ])
    assert.throws(() => parseCompensationRecord(bad))
  assert.deepEqual(readCompensationRecords('broken'), {
    records: [],
    rejected: 1,
  })
  assert.deepEqual(readCompensationRecords(null), { records: [], rejected: 0 })
  assert.deepEqual(
    readCompensationRecords(JSON.stringify([r, { ...r, version: 9 }])),
    { records: [r], rejected: 1 },
  )
})
