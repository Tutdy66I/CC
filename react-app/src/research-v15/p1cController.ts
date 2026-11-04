import {
  P1C_VERSION,
  snapshotJob,
  validateBatch,
  type Batch,
  type Job,
  type Reply,
} from './p1cProtocol.js'
export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(value: unknown): void
  terminate(): void
}
export type State =
  | { state: 'idle' }
  | { state: 'running'; completed: number; total: number }
  | { state: 'completed'; result: Batch }
  | { state: 'failed'; message: string }
  | { state: 'cancelled' }
export class P1cController {
  state: State = { state: 'idle' }
  private active: {
    worker: WorkerLike
    job: Job
    ready: boolean
    completed: number
  } | null = null
  private disposed = false
  private factory: () => WorkerLike
  private publish: (state: State) => void
  constructor(factory: () => WorkerLike, publish: (state: State) => void) {
    this.factory = factory
    this.publish = publish
  }
  private set(state: State) {
    this.state = state
    if (!this.disposed) this.publish(state)
  }
  start(raw: unknown) {
    if (this.disposed || this.active)
      throw new Error('Worker is busy or disposed')
    const job = snapshotJob(raw),
      worker = this.factory(),
      active = { worker, job, ready: false, completed: 0 }
    this.active = active
    const fail = (message: string) => {
      if (this.active !== active) return
      worker.terminate()
      this.active = null
      this.set({ state: 'failed', message })
    }
    worker.onerror = () => fail('Worker 运行失败')
    worker.onmessageerror = () => fail('Worker 消息无法解析')
    worker.onmessage = (event) => {
      if (this.active !== active || this.disposed) return
      try {
        const r = event.data as Reply
        if (!r || r.version !== P1C_VERSION || r.runId !== job.runId)
          throw new Error('Worker 消息身份无效')
        if (r.type === 'error') {
          if (
            !['invalid-input', 'calculation-failed'].includes(r.code) ||
            typeof r.message !== 'string' ||
            r.message.length > 1000
          )
            throw new Error('Worker 错误消息无效')
          fail(r.message)
          return
        }
        if (r.type === 'ready') {
          if (active.ready || active.completed) throw new Error('重复初始化')
          active.ready = true
          return
        }
        if (!active.ready) throw new Error('Worker 未初始化')
        if (r.type === 'progress') {
          if (
            r.total !== job.frameIds.length ||
            r.completed !== active.completed + 1 ||
            r.frameId !== job.frameIds[active.completed]
          )
            throw new Error('Worker 进度无效')
          active.completed = r.completed
          this.set({ state: 'running', completed: r.completed, total: r.total })
          return
        }
        if (r.type === 'done') {
          if (active.completed !== job.frameIds.length)
            throw new Error('Worker 结果不完整')
          validateBatch(r.result, job)
          worker.terminate()
          this.active = null
          this.set({ state: 'completed', result: r.result })
          return
        }
        throw new Error('未知 Worker 消息')
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
      }
    }
    this.set({ state: 'running', completed: 0, total: job.frameIds.length })
    try {
      worker.postMessage(job)
    } catch (e) {
      fail(String(e))
    }
  }
  cancel() {
    if (!this.active) return
    this.active.worker.terminate()
    this.active = null
    this.set({ state: 'cancelled' })
  }
  dispose() {
    this.disposed = true
    if (this.active) {
      this.active.worker.terminate()
      this.active = null
    }
  }
}
