import { executeJob, P1C_VERSION, snapshotJob } from './p1cProtocol.js'
let started = false
self.onmessage = (event: MessageEvent<unknown>) => {
  void (async () => {
    let runId = ''
    try {
      const raw = event.data as { runId?: unknown }
      runId = typeof raw?.runId === 'string' ? raw.runId : ''
      if (started) throw new Error('Duplicate start')
      const job = snapshotJob(event.data)
      started = true
      self.postMessage({
        type: 'ready',
        version: P1C_VERSION,
        runId: job.runId,
      })
      const result = await executeJob(job, (completed, frameId) =>
        self.postMessage({
          type: 'progress',
          version: P1C_VERSION,
          runId: job.runId,
          completed,
          total: job.frameIds.length,
          frameId,
        }),
      )
      self.postMessage({
        type: 'done',
        version: P1C_VERSION,
        runId: job.runId,
        result,
      })
    } catch (e) {
      self.postMessage({
        type: 'error',
        version: P1C_VERSION,
        runId,
        code: started ? 'calculation-failed' : 'invalid-input',
        message: e instanceof Error ? e.message : 'Worker failed',
      })
    }
    self.close()
  })()
}
