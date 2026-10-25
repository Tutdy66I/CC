import { CHANNEL_ENGINE, validateChannelTrial } from '../lib/channelResearch'
import {
  makeChannelRecord,
  parseChannelCheckpoint,
} from '../lib/channelResearchRecord'
import { simulateChannelTrial } from '../lib/channelSimulation'
import type { ChannelTrial } from '../lib/channelTypes'

// Each start owns a Worker; cancellation terminates this process and saves its validated prefix.
self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data as { runId?: unknown; checkpoint?: unknown }
  const runId = typeof request?.runId === 'string' ? request.runId : ''
  let protocolHash = ''
  try {
    if (!runId || runId.length > 100) throw new Error('信道任务标识无效。')
    const frozen = await parseChannelCheckpoint(request.checkpoint)
    protocolHash = frozen.protocolHash
    const trials = [...frozen.trials],
      batch: ChannelTrial[] = []
    let sent = performance.now()
    for (let i = trials.length; i < frozen.plan.trials; i++) {
      const trial = await simulateChannelTrial(frozen.plan, i)
      validateChannelTrial(frozen.plan, trial, i)
      trials.push(trial)
      batch.push(trial)
      if (performance.now() - sent >= 100 || i === frozen.plan.trials - 1) {
        self.postMessage({
          type: 'batch',
          runId,
          protocolHash,
          engineVersion: CHANNEL_ENGINE,
          trials: batch.splice(0),
          completed: trials.length,
          total: frozen.plan.trials,
        })
        sent = performance.now()
      }
    }
    self.postMessage({
      type: 'done',
      runId,
      protocolHash,
      engineVersion: CHANNEL_ENGINE,
      record: makeChannelRecord(frozen, trials),
    })
  } catch (cause) {
    self.postMessage({
      type: 'error',
      runId,
      protocolHash,
      engineVersion: CHANNEL_ENGINE,
      message: cause instanceof Error ? cause.message : '信道研究计算失败。',
    })
  }
}
