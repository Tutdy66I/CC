import {
  CHANNEL_ENGINE,
  CHANNEL_BUDGET,
  freezeChannelPlan,
  normalizeChannelPlan,
  summarizeChannel,
  validateChannelPlan,
  validateChannelTrial,
  type FrozenChannelPlan,
  type ChannelSummary,
} from './channelResearch.js'
import type { ChannelTrial } from './channelTypes.js'

export interface ChannelCheckpoint extends FrozenChannelPlan {
  schemaVersion: 1
  status: 'checkpoint' | 'complete'
  trials: ChannelTrial[]
}
export interface ChannelRecord extends ChannelCheckpoint {
  status: 'complete'
  summary: ChannelSummary[]
}
function cleanTrials(trials: ChannelTrial[]): ChannelTrial[] {
  // Project known fields: imports never retain arbitrary untrusted JSON payloads.
  return trials.map((t) => ({
    index: t.index,
    cells: t.cells.map((c) => ({
      model: c.model,
      ebN0Db: c.ebN0Db,
      pilots: c.pilots,
      noisePower: c.noisePower,
      dataEnergy: c.dataEnergy,
      pilotEnergy: c.pilotEnergy,
      totalEnergy: c.totalEnergy,
      commonDataEnergy: c.commonDataEnergy,
      dataSymbols: c.dataSymbols,
      commonSymbols: c.commonSymbols,
      hMeanPower: c.hMeanPower,
      hFirst: { i: c.hFirst.i, q: c.hFirst.q },
      estimate: c.estimate ? { i: c.estimate.i, q: c.estimate.q } : null,
      estimationSquaredError: c.estimationSquaredError,
      deepFadeSymbols: c.deepFadeSymbols,
      methods: Object.fromEntries(
        (['raw', 'ideal', 'ls'] as const).map((m) => [
          m,
          Object.fromEntries(
            (['all', 'common'] as const).map((scope) => {
              const v = c.methods[m][scope]
              return [
                scope,
                {
                  bits: v.bits,
                  errors: v.errors,
                  ber: v.ber,
                  signalEnergy: v.signalEnergy,
                  errorEnergy: v.errorEnergy,
                  evmRms: v.evmRms,
                  failure: v.failure,
                },
              ]
            }),
          ),
        ]),
      ) as typeof c.methods,
      preview: c.preview.map((v) => ({
        index: v.index,
        tx: { i: v.tx.i, q: v.tx.q },
        h: { i: v.h.i, q: v.h.q },
        received: { i: v.received.i, q: v.received.q },
        ideal: v.ideal ? { i: v.ideal.i, q: v.ideal.q } : null,
        ls: v.ls ? { i: v.ls.i, q: v.ls.q } : null,
      })),
    })),
  }))
}
export function makeChannelCheckpoint(
  frozen: FrozenChannelPlan,
  trials: ChannelTrial[],
): ChannelCheckpoint {
  if (trials.length > frozen.plan.trials)
    throw new Error('检查点超过冻结帧数。')
  return {
    ...frozen,
    plan: normalizeChannelPlan(frozen.plan),
    schemaVersion: 1,
    status: 'checkpoint',
    trials,
  }
}
export function makeChannelRecord(
  frozen: FrozenChannelPlan,
  trials: ChannelTrial[],
): ChannelRecord {
  if (trials.length !== frozen.plan.trials)
    throw new Error('不完整信道研究不能保存完成记录。')
  return {
    ...makeChannelCheckpoint(frozen, trials),
    status: 'complete',
    summary: summarizeChannel(frozen.plan, trials),
  }
}
export async function parseChannelCheckpoint(
  value: unknown,
  budget = CHANNEL_BUDGET,
): Promise<ChannelCheckpoint> {
  const v = value as ChannelCheckpoint
  if (
    !v ||
    v.schemaVersion !== 1 ||
    v.engineVersion !== CHANNEL_ENGINE ||
    !['checkpoint', 'complete'].includes(v.status) ||
    typeof v.protocolHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.protocolHash) ||
    !Array.isArray(v.trials)
  )
    throw new Error('信道记录版本或协议无效。')
  validateChannelPlan(v.plan, budget)
  const frozen = await freezeChannelPlan(v.plan, budget)
  if (v.protocolHash !== frozen.protocolHash || v.trials.length > v.plan.trials)
    throw new Error('信道协议或检查点长度不匹配。')
  v.trials.forEach((t, i) => validateChannelTrial(frozen.plan, t, i))
  return {
    ...makeChannelCheckpoint(frozen, cleanTrials(v.trials)),
    status: v.status,
  }
}
export async function parseChannelRecord(
  value: unknown,
  budget = CHANNEL_BUDGET,
): Promise<ChannelRecord> {
  const checkpoint = await parseChannelCheckpoint(value, budget)
  if (
    checkpoint.status !== 'complete' ||
    checkpoint.trials.length !== checkpoint.plan.trials
  )
    throw new Error('信道研究尚未完成。')
  const record = makeChannelRecord(checkpoint, checkpoint.trials)
  if (
    JSON.stringify((value as ChannelRecord).summary) !==
    JSON.stringify(record.summary)
  )
    throw new Error('信道汇总与逐帧结果不一致。')
  return record
}
