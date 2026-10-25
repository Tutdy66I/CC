import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANNEL_BUDGET,
  channelOperations,
  defaultChannelPlan,
  freezeChannelPlan,
  summarizeChannel,
  validateChannelPlan,
  validateChannelTrial,
} from '../src/lib/channelResearch.js'
import { simulateChannelTrial } from '../src/lib/channelSimulation.js'
import {
  makeChannelCheckpoint,
  makeChannelRecord,
  parseChannelCheckpoint,
  parseChannelRecord,
} from '../src/lib/channelResearchRecord.js'
import type { ChannelPlan } from '../src/lib/channelTypes.js'

const small: ChannelPlan = {
  ...defaultChannelPlan(),
  frameSymbols: 128,
  trials: 4,
  ebN0Db: [0, 8],
  pilotCounts: [4, 16],
  channels: ['awgn', 'rayleigh-block', 'rayleigh-iid'],
}
const frames = () =>
  Promise.all(
    Array.from({ length: small.trials }, (_, i) =>
      simulateChannelTrial(small, i),
    ),
  )

test('browser refuses large result/summary workloads even below the symbol budget', () => {
  const p: ChannelPlan = {
    ...small,
    trials: 10000,
    ebN0Db: [0],
    pilotCounts: [1, 2, 4, 8],
  }
  assert.ok(channelOperations(p) < CHANNEL_BUDGET)
  assert.throws(() => validateChannelPlan(p), /记录|预算/)
  assert.doesNotThrow(() => validateChannelPlan(p, Infinity))
})

test('trial validation rejects broken cross-SNR and cross-pilot truth/data pairing', async () => {
  const t = await simulateChannelTrial(small, 0)
  const bad = structuredClone(t)
  bad.cells[9].hFirst.i += 1
  assert.throws(() => validateChannelTrial(small, bad, 0), /配对/)
})

test('channel default freezes the approved complex-baseband quick protocol', () => {
  assert.deepEqual(defaultChannelPlan(), {
    frameSymbols: 512,
    modulation: 'QPSK',
    ebN0Db: [0, 4, 8, 12],
    pilotCounts: [16],
    channels: ['awgn', 'rayleigh-block'],
    trials: 200,
    seed: 42,
    energyBasis: 'data-eb',
    noiseEnabled: true,
  })
})

test('freeze binds semantics, normalizes unknown fields and rejects oversize without reducing trials', async () => {
  assert.ok(channelOperations(defaultChannelPlan()) < CHANNEL_BUDGET)
  assert.throws(
    () => validateChannelPlan({ ...small, trials: 10000, frameSymbols: 4096 }),
    /预算/,
  )
  assert.throws(
    () => validateChannelPlan({ ...small, pilotCounts: [16, 4] }),
    /参数/,
  )
  assert.throws(() => validateChannelPlan({ ...small, seed: 2 ** 32 }), /参数/)
  const frozen = await freezeChannelPlan(small)
  assert.deepEqual(
    frozen,
    await freezeChannelPlan({ ...small, unused: 'discard' } as ChannelPlan),
  )
  assert.notEqual(
    frozen.protocolHash,
    (await freezeChannelPlan({ ...small, energyBasis: 'total-eb' }))
      .protocolHash,
  )
  small.ebN0Db.push(12)
  assert.deepEqual(frozen.plan.ebN0Db, [0, 8])
  small.ebN0Db.pop()
})

test('every generated cell validates and summaries use independent frames and exact denominators', async () => {
  const trials = await frames()
  trials.forEach((t, i) => validateChannelTrial(small, t, i))
  const rows = summarizeChannel(small, trials)
  assert.equal(rows.length, 12)
  const row = rows[0],
    r = Math.sqrt(Math.log(40) / (2 * 4))
  assert.ok(Math.abs(row.theoreticalBer - 0.07864960352514257) < 1e-13)
  assert.equal(row.expectedLsMse, 1 / (4 * 2))
  assert.equal(row.meanPilotEnergy, 8)
  assert.equal(row.expectedTotalEb, 128 / 124)
  assert.equal(
    row.methods.ideal.berInterval[1],
    Math.min(1, row.methods.ideal.ber! + r),
  )
  assert.deepEqual(summarizeChannel(small, trials), rows)
  assert.throws(() => summarizeChannel(small, trials.slice(1)), /不完整/)
})

test('record roundtrip rejects fabricated summaries, reordered prefixes, energy/noise and version tampering', async () => {
  const frozen = await freezeChannelPlan(small),
    trials = await frames(),
    record = makeChannelRecord(frozen, trials)
  assert.deepEqual(
    await parseChannelRecord(JSON.parse(JSON.stringify(record))),
    record,
  )
  for (const mutate of [
    (r: typeof record) => {
      r.summary[0].mse = 99
    },
    (r: typeof record) => {
      r.trials[0].index = 1
    },
    (r: typeof record) => {
      r.trials[0].cells[0].noisePower = 0.5
    },
    (r: typeof record) => {
      r.trials[0].cells[0].pilotEnergy++
    },
    (r: typeof record) => {
      r.trials[0].cells[0].methods.ideal.all.errors = 99
    },
  ]) {
    const bad = structuredClone(record)
    mutate(bad)
    await assert.rejects(parseChannelRecord(bad))
  }
  await assert.rejects(
    parseChannelRecord({ ...record, engineVersion: 'future' }),
  )
  await assert.rejects(
    parseChannelCheckpoint({ ...record, protocolHash: '0'.repeat(64) }),
  )
  const checkpoint = makeChannelCheckpoint(frozen, trials.slice(0, 2))
  assert.deepEqual(await parseChannelCheckpoint(checkpoint), checkpoint)
  const resumed = [...(await parseChannelCheckpoint(checkpoint)).trials]
  for (let i = resumed.length; i < small.trials; i++)
    resumed.push(await simulateChannelTrial(small, i))
  assert.deepEqual(makeChannelRecord(frozen, resumed), record)
})

test('numerical BER failure widens all-trial bounds and never becomes a zero error observation', async () => {
  const trials = await frames(),
    metric = trials[0].cells[0].methods.ls
  for (const m of [metric.all, metric.common]) {
    m.errors = null
    m.ber = null
    m.errorEnergy = null
    m.evmRms = null
    m.failure = 'nonfinite-sample'
  }
  validateChannelTrial(small, trials[0], 0)
  const row = summarizeChannel(small, trials)[0]
  assert.equal(row.methods.ls.ber, null)
  assert.equal(row.methods.ls.failedFrames, 1)
  assert.ok(
    Math.abs(
      row.methods.ls.berBounds[1] - row.methods.ls.berBounds[0] - 1 / 4,
    ) < 1e-15,
  )
  assert.equal(row.pairedDifference.mean, null)
  assert.equal(row.pairedDifference.bootstrap, null)
})

test('noiseless ideal and LS recovery and total-Eb references remain finite', async () => {
  const p = {
    ...small,
    channels: ['awgn', 'rayleigh-block'] as ChannelPlan['channels'],
    noiseEnabled: false,
  }
  const trials = await Promise.all(
    Array.from({ length: p.trials }, (_, i) => simulateChannelTrial(p, i)),
  )
  trials.forEach((t, i) => validateChannelTrial(p, t, i))
  for (const r of summarizeChannel(p, trials)) {
    assert.equal(r.theoreticalBer, 0)
    assert.equal(r.methods.ideal.ber, 0)
    assert.equal(r.methods.ls.ber, 0)
  }
  const total = { ...small, energyBasis: 'total-eb' as const },
    t = await simulateChannelTrial(total, 0)
  validateChannelTrial(total, t, 0)
  assert.equal(t.cells[0].noisePower, 128 / 124)
})
