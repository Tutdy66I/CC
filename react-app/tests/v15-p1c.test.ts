import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { runEngineeringBatch } from '../src/research-v15/comparison.js'
import {
  executeJob,
  snapshotJob,
  P1C_VERSION,
} from '../src/research-v15/p1cProtocol.js'
import {
  P1cController,
  type WorkerLike,
} from '../src/research-v15/p1cController.js'

const config = {
  cp: 16,
  cfo: 0.17,
  sto: 3,
  phase: 0.2,
  taps: [{ delay: 0, i: 1, q: 0 }],
  noisePower: 0.02,
}
const request = (ids: number[]) => ({
  type: 'start' as const,
  version: P1C_VERSION,
  runId: 'test-1',
  config,
  frameIds: ids,
  intervention: { residualCfo: 0.2, timingOffset: 1 },
})
test('worker scheduler preserves complete P1b results for 1, 2 and 16 frames', async () => {
  for (const n of [1, 2, 16]) {
    const ids = Array.from({ length: n }, (_, i) => i + 100)
    const progress: number[] = []
    const job = snapshotJob(request(ids))
    const actual = await executeJob(job, (completed) =>
      progress.push(completed),
    )
    const expected = await runEngineeringBatch(config, ids, 0.2, 1)
    assert.deepEqual(actual, expected)
    assert.deepEqual(
      progress,
      ids.map((_, i) => i + 1),
    )
  }
})
test('real Worker returns the complete P1b result for 1, 2 and 16 frames', async () => {
  for (const n of [1, 2, 16]) {
    const ids = Array.from({ length: n }, (_, i) => i + 200),
      job = request(ids),
      messages: unknown[] = []
    const result = await new Promise<unknown>((resolve, reject) => {
      const w = new Worker(
        new URL('../../tests/fixtures/p1c-worker-node.mjs', import.meta.url),
      )
      w.on('message', (m) => {
        messages.push(m)
        if (m.type === 'done') resolve(m.result)
        if (m.type === 'error') reject(new Error(m.message))
      })
      w.on('error', reject)
      w.on('exit', (code) => {
        if (code !== 0) reject(new Error(`worker exit ${code}`))
      })
      w.postMessage(job)
    })
    assert.deepEqual(result, await runEngineeringBatch(config, ids, 0.2, 1))
    assert.equal(
      messages.filter((m) => (m as { type: string }).type === 'progress')
        .length,
      n,
    )
  }
})
test('real Worker rejects invalid jobs without publishing results', async () => {
  const messages: unknown[] = []
  await new Promise<void>((resolve, reject) => {
    const w = new Worker(
      new URL('../../tests/fixtures/p1c-worker-node.mjs', import.meta.url),
    )
    w.on('message', (m) => messages.push(m))
    w.on('error', reject)
    w.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
    )
    w.postMessage(request([1, 1]))
  })
  assert.equal(messages.length, 1)
  assert.equal((messages[0] as { type: string }).type, 'error')
})
test('job validates version, run id, counts, duplicate IDs and snapshots input', () => {
  const mutable = request([1, 2]),
    job = snapshotJob(mutable)
  mutable.frameIds[0] = 88
  mutable.config.taps[0].i = 8
  assert.equal(job.frameIds[0], 1)
  assert.equal(job.config.taps[0].i, 1)
  for (const value of [
    { ...request([1]), version: 'old' },
    { ...request([1]), runId: '' },
    request([]),
    request([1, 1]),
    request(Array.from({ length: 17 }, (_, i) => i)),
    { ...request([1]), intervention: { residualCfo: NaN, timingOffset: 0 } },
  ])
    assert.throws(() => snapshotJob(value))
})
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null
  terminated = false
  posted: unknown
  postMessage(v: unknown) {
    this.posted = v
  }
  terminate() {
    this.terminated = true
  }
  emit(v: unknown) {
    this.onmessage?.({ data: v } as MessageEvent)
  }
}
test('controller rejects malformed, stale and repeated terminal messages and never publishes partial data', async () => {
  const made: FakeWorker[] = []
  const changes: string[] = []
  const controller = new P1cController(
    () => {
      const w = new FakeWorker()
      made.push(w)
      return w
    },
    (s) => changes.push(s.state),
  )
  controller.start(request([1]))
  const old = made[0]
  controller.cancel()
  assert.equal(String(controller.state.state), 'cancelled')
  assert.equal(old.terminated, true)
  controller.start({ ...request([1]), runId: 'test-2' })
  const current = made[1]
  old.emit({ type: 'done', version: P1C_VERSION, runId: 'test-1' })
  assert.equal(String(controller.state.state), 'running')
  current.emit({ type: 'ready', version: P1C_VERSION, runId: 'test-2' })
  current.emit({
    type: 'progress',
    version: P1C_VERSION,
    runId: 'test-2',
    completed: 1,
    total: 1,
    frameId: 1,
  })
  assert.equal(String(controller.state.state), 'running')
  assert.equal(Object.hasOwn(controller.state, 'result'), false)
  current.emit({
    type: 'done',
    version: P1C_VERSION,
    runId: 'test-2',
    result: {},
  })
  assert.equal(String(controller.state.state), 'failed')
  assert.equal(Object.hasOwn(controller.state, 'result'), false)
  current.emit({ type: 'done', version: P1C_VERSION, runId: 'test-2' })
  assert.equal(String(controller.state.state), 'failed')
  controller.start({ ...request([1]), runId: 'test-3' })
  const third = made[2]
  third.onmessageerror?.({} as MessageEvent)
  assert.equal(String(controller.state.state), 'failed')
  controller.dispose()
  assert.equal(third.terminated, true)
  assert.ok(changes.includes('cancelled'))
})
test('rapid repeated start is rejected and worker errors terminate without results', () => {
  const w = new FakeWorker()
  const c = new P1cController(
    () => w,
    () => {},
  )
  c.start(request([1]))
  assert.throws(() => c.start(request([2])))
  w.onerror?.({ message: 'boom' } as ErrorEvent)
  assert.equal(c.state.state, 'failed')
  assert.equal(w.terminated, true)
  assert.equal('result' in c.state, false)
})
test('complete result is accepted once and post-terminal messages are ignored', async () => {
  const w = new FakeWorker()
  const c = new P1cController(
    () => w,
    () => {},
  )
  const j = request([1])
  c.start(j)
  w.emit({ type: 'ready', version: P1C_VERSION, runId: j.runId })
  const result = await executeJob(snapshotJob(j), () => {})
  w.emit({
    type: 'progress',
    version: P1C_VERSION,
    runId: j.runId,
    completed: 1,
    total: 1,
    frameId: 1,
  })
  w.emit({ type: 'done', version: P1C_VERSION, runId: j.runId, result })
  assert.equal(c.state.state, 'completed')
  w.emit({ type: 'done', version: P1C_VERSION, runId: j.runId, result: {} })
  assert.equal(c.state.state, 'completed')
  c.dispose()
})
