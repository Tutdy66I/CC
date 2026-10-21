import assert from 'node:assert/strict'
import test from 'node:test'
import {
  statisticsSeed,
  summarizeTrials,
  validateStatisticsRequest,
  runSeedStatistics,
  type StatisticsMessage,
} from '../src/lib/seedStatistics.js'
import { simulateComparisonPoint } from '../src/lib/modulationComparison.js'

const request = { bits: 64, seed: 0xffffffff, trials: 5 }
const points = [0, 16, 32, 48, 64].map((errors, trial) => ({
  ...simulateComparisonPoint(
    '16QAM',
    -4,
    64,
    statisticsSeed(request.seed, trial, 0),
  ),
  errors,
  ber: errors / 64,
}))

test('seed schedule wraps uint32 without reusing seeds within the run', () => {
  const seeds = new Set<number>()
  for (let trial = 0; trial < 20; trial++)
    for (let snr = 0; snr < 10; snr++)
      seeds.add(statisticsSeed(0xffffffff, trial, snr))
  assert.equal(seeds.size, 200)
  assert.equal(statisticsSeed(0xffffffff, 0, 1), 0)
  assert.equal(statisticsSeed(0xffffffff, 1, 0), 9)
  assert.throws(() => statisticsSeed(0, -1, 0))
})

test('statistics validates fixed repeats, complete cycles and bounded total work', () => {
  assert.doesNotThrow(() =>
    validateStatisticsRequest({ bits: 131072, seed: 0, trials: 20 }),
  )
  for (const change of [
    { bits: 65 },
    { bits: 1000000 },
    { trials: 0 },
    { trials: 21 },
    { trials: 5.5 },
    { seed: NaN },
  ])
    assert.throws(() => validateStatisticsRequest({ ...request, ...change }))
})

test('aggregation reports hand-computed mean, range and sample standard deviation', () => {
  const result = summarizeTrials(points, request)
  assert.equal(result.meanBer, 0.5)
  assert.equal(result.minBer, 0)
  assert.equal(result.maxBer, 1)
  assert.equal(result.totalErrors, 160)
  assert.equal(result.totalBits, 320)
  assert.equal(result.sampleSd, Math.sqrt(0.625 / 4))
  assert.deepEqual(result.interval, [0, 1])
})

test('partial samples never present fixed-horizon intervals and one sample has no SD', () => {
  const result = summarizeTrials(points.slice(0, 1), request)
  assert.equal(result.sampleSd, null)
  assert.equal(result.interval, null)
  assert.equal(result.completed, 1)
  assert.throws(() => summarizeTrials([], request))
  assert.throws(() => summarizeTrials([points[0], points[0]], request))
  assert.throws(() =>
    summarizeTrials([points[0], { ...points[1], bits: 128 }], request),
  )
  assert.throws(() => summarizeTrials([{ ...points[0], errors: 65 }], request))
})

test('block Hoeffding bounds remain positive at zero errors and shrink with sample size', () => {
  const make = (bits: number, errors: number) =>
    summarizeTrials(
      points.map((p) => ({ ...p, bits, errors, ber: errors / bits })),
      { ...request, bits },
    )
  const zero = make(6400, 0)
  assert.equal(zero.sampleSd, 0)
  assert.equal(zero.interval![0], 0)
  assert.ok(
    Math.abs(zero.interval![1] - Math.sqrt(Math.log(40) / 1000)) < 1e-15,
  )
  assert.ok(make(12800, 0).interval![1] < zero.interval![1])
  assert.equal(make(6400, 6400).interval![1], 1)
  assert.ok(make(6400, 6400).interval![0] < 1)
})

test('complete driver is reproducible and reuses unchanged per-trial simulations', () => {
  const messages: StatisticsMessage[] = []
  runSeedStatistics(request, (m) => messages.push(m))
  const replay: StatisticsMessage[] = []
  runSeedStatistics(request, (m) => replay.push(m))
  assert.deepEqual(messages, replay)
  assert.equal(messages.length, 151)
  assert.equal(messages.at(-1)!.type, 'done')
  const finals = messages.filter(
    (m) => m.type === 'summary' && m.summary.completed === 5,
  )
  assert.equal(finals.length, 30)
  for (const message of finals) {
    if (message.type !== 'summary') continue
    const { modulation, ebN0Db, totalErrors } = message.summary
    const index = (ebN0Db + 4) / 2
    let expected = 0
    for (let trial = 0; trial < 5; trial++)
      expected += simulateComparisonPoint(
        modulation,
        ebN0Db,
        request.bits,
        statisticsSeed(request.seed, trial, index),
      ).errors
    assert.equal(totalErrors, expected)
  }
})
