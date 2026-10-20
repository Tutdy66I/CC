import {
  simulateBerPoint,
  SWEEP_DB,
  validateSweepRequest,
  type SweepMessage,
  type SweepRequest,
} from '../lib/berSweep'

const send = (message: SweepMessage) => self.postMessage(message)

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  try {
    const { bits, seed } = event.data
    validateSweepRequest({ bits, seed })
    for (const [index, db] of SWEEP_DB.entries()) {
      send({
        type: 'point',
        point: simulateBerPoint(db, bits, (seed + index) >>> 0),
      })
    }
    send({ type: 'done' })
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : '扫描失败。',
    })
  }
}
