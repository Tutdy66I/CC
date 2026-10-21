import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultGuidedPlan,
  parseGuidedProposal,
  runGuidedExperiment,
  validateGuidedPlan,
  readGuidedHistory,
  type GuidedMessage,
} from '../src/lib/guidedExperiment.js'

test('guided plans reject invalid model parameters and changed objectives', () => {
  const plan = defaultGuidedPlan('equivalence')
  assert.deepEqual(
    parseGuidedProposal(JSON.stringify(plan), 'equivalence'),
    plan,
  )
  for (const patch of [
    { seed: -1 },
    { seed: 2 ** 32 },
    { seed: null },
    { bits: 123 },
    { trials: 21 },
    { dbValues: [0, 0] },
    { dbValues: [1] },
    { dbValues: [] },
    { dbValues: [4, 0] },
    { template: 'unknown' },
    { rationale: 'a'.repeat(2001) },
  ])
    assert.throws(() => validateGuidedPlan({ ...plan, ...patch }))
  assert.throws(() =>
    parseGuidedProposal(
      JSON.stringify({ ...plan, template: 'qam' }),
      'equivalence',
    ),
  )
  assert.throws(() =>
    parseGuidedProposal('我已经运行并得到 BER=0', 'equivalence'),
  )
})

test('guided Worker core is reproducible, paired, and retains exact counts and positive zero-error bounds', () => {
  const plan = {
    ...defaultGuidedPlan('equivalence'),
    dbValues: [0, 14],
    seed: 0xffffffff,
  }
  const messages: GuidedMessage[] = []
  const rows = runGuidedExperiment(plan, (m) => messages.push(m))
  assert.deepEqual(
    runGuidedExperiment(plan, () => {}),
    rows,
  )
  assert.equal(rows.length, 4)
  assert.equal(messages.at(-1)?.type, 'done')
  for (const row of rows) {
    assert.equal(row.completed, plan.trials)
    assert.equal(row.totalBits, plan.bits * plan.trials)
    assert.equal(row.meanBer, row.totalErrors / row.totalBits)
    assert.ok(row.interval && row.interval[1] > 0)
    assert.equal(row.deviation, row.meanBer - row.theoretical)
    assert.equal(row.seeds[0], (plan.seed + (row.ebN0Db + 4) / 2) >>> 0)
  }
  assert.equal(rows[0].meanBer, rows[1].meanBer)
  assert.equal(rows[2].meanBer, rows[3].meanBer)
  assert.equal(rows[2].totalErrors, 0)
})

test('sample-size experiment compares N/4 with N and QAM retains measured EVM', () => {
  const sampling = runGuidedExperiment(
    { ...defaultGuidedPlan('sampling'), dbValues: [0] },
    () => {},
  )
  assert.deepEqual(
    sampling.map((r) => r.bitsPerTrial),
    [4096, 16384],
  )
  assert.ok(
    sampling[0].interval![1] - sampling[0].interval![0] >
      sampling[1].interval![1] - sampling[1].interval![0],
  )
  const qam = runGuidedExperiment(
    { ...defaultGuidedPlan('qam'), dbValues: [0, 10] },
    () => {},
  )
  assert.ok(qam.every((r) => r.modulation === '16QAM' && r.evmPercent > 0))
  assert.ok(qam[0].evmPercent > qam[1].evmPercent)
})

test('history ignores malformed, incomplete or inconsistent stored records', () => {
  for (const text of [
    null,
    'bad',
    '{}',
    '[{}]',
    '[{"version":1,"status":"running"}]',
  ])
    assert.deepEqual(readGuidedHistory(text), [])
  const plan = defaultGuidedPlan('equivalence')
  const record = {
    version: 1,
    id: 'test-run',
    completedAt: '2026-10-21T00:00:00.000Z',
    plan,
    rows: runGuidedExperiment(plan, () => {}),
    analysis: '',
  }
  assert.equal(readGuidedHistory(JSON.stringify([record])).length, 1)
  const inconsistent = structuredClone(record)
  inconsistent.rows[0].totalErrors++
  assert.deepEqual(readGuidedHistory(JSON.stringify([inconsistent])), [])
})
