import {
  runSeedStatistics,
  type StatisticsRequest,
  type StatisticsMessage,
} from '../lib/seedStatistics'

self.onmessage = (event: MessageEvent<StatisticsRequest>) => {
  const emit = (message: StatisticsMessage) => self.postMessage(message)
  try {
    runSeedStatistics(event.data, emit)
  } catch (cause) {
    emit({
      type: 'error',
      message: cause instanceof Error ? cause.message : '统计计算失败。',
    })
  }
}
