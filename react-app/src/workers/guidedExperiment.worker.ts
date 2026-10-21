import {
  runGuidedExperiment,
  type GuidedPlan,
  type GuidedMessage,
} from '../lib/guidedExperiment'

self.onmessage = (event: MessageEvent<GuidedPlan>) => {
  const emit = (message: GuidedMessage) => self.postMessage(message)
  try {
    runGuidedExperiment(event.data, emit)
  } catch (cause) {
    emit({
      type: 'error',
      message: cause instanceof Error ? cause.message : '引导实验计算失败。',
    })
  }
}
