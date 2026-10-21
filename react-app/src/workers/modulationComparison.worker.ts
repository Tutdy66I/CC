import {
  COMPARISON_DB,
  MODULATIONS,
  simulateComparisonPoint,
  validateComparisonRequest,
  type ComparisonMessage,
} from '../lib/modulationComparison'
import type { SweepRequest } from '../lib/berSweep'

const send = (message: ComparisonMessage) => self.postMessage(message)
self.onmessage = (event: MessageEvent<SweepRequest>) => {
  try {
    const { bits, seed } = event.data
    validateComparisonRequest({ bits, seed })
    for (const [index, db] of COMPARISON_DB.entries())
      for (const modulation of MODULATIONS) {
        send({
          type: 'point',
          point: simulateComparisonPoint(
            modulation,
            db,
            bits,
            (seed + index) >>> 0,
          ),
        })
      }
    send({ type: 'done' })
  } catch (cause) {
    send({
      type: 'error',
      message: cause instanceof Error ? cause.message : '对比计算失败。',
    })
  }
}
