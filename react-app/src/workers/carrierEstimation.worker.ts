import {
  runEstimation,
  type EstimationPlan,
  type EstimationResult,
} from '../lib/carrierEstimation'
export type EstimationMessage =
  | { type: 'done'; result: EstimationResult }
  | { type: 'error'; message: string }
self.onmessage = (event: MessageEvent<EstimationPlan>) => {
  try {
    self.postMessage({
      type: 'done',
      result: runEstimation(event.data),
    } satisfies EstimationMessage)
  } catch (cause) {
    self.postMessage({
      type: 'error',
      message: cause instanceof Error ? cause.message : '载波估计计算失败。',
    } satisfies EstimationMessage)
  }
}
