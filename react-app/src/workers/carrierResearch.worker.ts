import {
  runCarrierResearch,
  type ResearchMessage,
} from '../lib/carrierResearch'
import { parseResearchCheckpoint } from '../lib/carrierResearchRecord'
self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    const checkpoint = parseResearchCheckpoint(event.data)
    runCarrierResearch(
      checkpoint.plan,
      (message: ResearchMessage) => self.postMessage(message),
      { resume: checkpoint.trials },
    )
  } catch (cause) {
    self.postMessage({
      type: 'error',
      message: cause instanceof Error ? cause.message : '研究计算失败。',
    } satisfies ResearchMessage)
  }
}
