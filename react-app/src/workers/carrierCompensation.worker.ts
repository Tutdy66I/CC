import {
  runCompensationExperiment,
  type CompensationMessage,
} from '../lib/carrierCompensation'
import type { CarrierPlan } from '../lib/carrierOffset'

self.onmessage = (event: MessageEvent<CarrierPlan>) => {
  const emit = (message: CompensationMessage) => self.postMessage(message)
  try {
    runCompensationExperiment(event.data, emit)
  } catch (cause) {
    emit({
      type: 'error',
      message: cause instanceof Error ? cause.message : '理想补偿计算失败。',
    })
  }
}
