import {
  runCarrierExperiment,
  type CarrierPlan,
  type CarrierMessage,
} from '../lib/carrierOffset'

self.onmessage = (event: MessageEvent<CarrierPlan>) => {
  const emit = (message: CarrierMessage) => self.postMessage(message)
  try {
    runCarrierExperiment(event.data, emit)
  } catch (cause) {
    emit({
      type: 'error',
      message: cause instanceof Error ? cause.message : '偏移计算失败。',
    })
  }
}
