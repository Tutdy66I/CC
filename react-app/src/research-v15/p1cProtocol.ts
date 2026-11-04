import {
  P1B_VERSION,
  pairedDifference,
  runEngineeringBatch,
  summarizeEngineeringFrames,
} from './comparison.js'
import { berBounds, interaction, type FrameConfig } from './core.js'

export const P1C_VERSION = 'signallab-v15-p1c-worker-1' as const
export type Job = {
  type: 'start'
  version: typeof P1C_VERSION
  runId: string
  config: Omit<FrameConfig, 'frameId'>
  frameIds: number[]
  intervention: { residualCfo: number; timingOffset: number }
}
export type Batch = Awaited<ReturnType<typeof runEngineeringBatch>>
export type Reply =
  | { type: 'ready'; version: typeof P1C_VERSION; runId: string }
  | {
      type: 'progress'
      version: typeof P1C_VERSION
      runId: string
      completed: number
      total: number
      frameId: number
    }
  | { type: 'done'; version: typeof P1C_VERSION; runId: string; result: Batch }
  | {
      type: 'error'
      version: typeof P1C_VERSION
      runId: string
      code: 'invalid-input' | 'calculation-failed'
      message: string
    }

export function snapshotJob(raw: unknown): Job {
  const j = raw as Job
  if (
    !j ||
    j.type !== 'start' ||
    j.version !== P1C_VERSION ||
    typeof j.runId !== 'string' ||
    !j.runId ||
    j.runId.length > 100 ||
    !Array.isArray(j.frameIds) ||
    j.frameIds.length < 1 ||
    j.frameIds.length > 16 ||
    j.frameIds.some((x) => !Number.isSafeInteger(x) || x < 0) ||
    new Set(j.frameIds).size !== j.frameIds.length ||
    !j.intervention ||
    !Number.isFinite(j.intervention.residualCfo) ||
    Math.abs(j.intervention.residualCfo) > 2 ||
    !Number.isSafeInteger(j.intervention.timingOffset) ||
    !j.config
  )
    throw new Error('Invalid P1c job')
  const c = j.config
  if (
    !Number.isInteger(c.cp) ||
    c.cp < 0 ||
    c.cp > 32 ||
    !Number.isFinite(c.cfo) ||
    Math.abs(c.cfo) > 1 ||
    !Number.isInteger(c.sto) ||
    Math.abs(c.sto) > 16 ||
    !Number.isFinite(c.phase) ||
    Math.abs(c.phase) > Math.PI ||
    !Number.isFinite(c.noisePower) ||
    c.noisePower < 0 ||
    c.noisePower > 1e6 ||
    !Array.isArray(c.taps) ||
    c.taps.length < 1 ||
    c.taps.length > 4 ||
    c.taps.some(
      (t, i) =>
        !t ||
        !Number.isInteger(t.delay) ||
        t.delay < 0 ||
        t.delay > 15 ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        Math.abs(t.i) > 16 ||
        Math.abs(t.q) > 16 ||
        (i > 0 && t.delay <= c.taps[i - 1].delay),
    ) ||
    !c.taps.some((t) => t.i !== 0 || t.q !== 0)
  )
    throw new Error('Invalid P1c configuration')
  const begin = 32 + c.sto + 256 + j.intervention.timingOffset,
    full = 64 + 256 + 5 * (128 + c.cp) + c.taps[c.taps.length - 1].delay
  if (begin < 0 || begin + 5 * (128 + c.cp) > full)
    throw new Error('Invalid intervention window')
  return {
    type: 'start',
    version: P1C_VERSION,
    runId: j.runId,
    config: {
      cp: c.cp,
      cfo: c.cfo,
      sto: c.sto,
      phase: c.phase,
      taps: c.taps.map((t) => ({ delay: t.delay, i: t.i, q: t.q })),
      noisePower: c.noisePower,
    },
    frameIds: [...j.frameIds],
    intervention: {
      residualCfo: j.intervention.residualCfo,
      timingOffset: j.intervention.timingOffset,
    },
  }
}

export async function executeJob(
  raw: Job,
  progress: (completed: number, frameId: number) => void,
): Promise<Batch> {
  const job = snapshotJob(raw),
    results: Batch['results'] = []
  let first: Batch | undefined
  for (const id of job.frameIds) {
    const next = await runEngineeringBatch(
      job.config,
      [id],
      job.intervention.residualCfo,
      job.intervention.timingOffset,
    )
    first ??= next
    results.push(next.results[0])
    progress(results.length, id)
  }
  if (!first) throw new Error('Empty job')
  return {
    ...first,
    frameIds: [...job.frameIds],
    results,
    summary: summarizeEngineeringFrames(results),
  }
}

export function validateBatch(raw: unknown, job: Job): asserts raw is Batch {
  const b = raw as Batch
  if (
    !b ||
    b.version !== P1B_VERSION ||
    b.purpose !== 'engineering-test-only' ||
    JSON.stringify(b.config) !== JSON.stringify(job.config) ||
    JSON.stringify(b.frameIds) !== JSON.stringify(job.frameIds) ||
    !b.intervention ||
    b.intervention.e !== job.intervention.residualCfo ||
    b.intervention.delta !== job.intervention.timingOffset ||
    !Array.isArray(b.results) ||
    b.results.length !== job.frameIds.length ||
    b.results.some((r, i) => !r || r.frameId !== job.frameIds[i])
  )
    throw new Error('Invalid worker result')
  const summary = summarizeEngineeringFrames(b.results)
  if (JSON.stringify(summary) !== JSON.stringify(b.summary))
    throw new Error('Invalid worker summary')
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)
  for (const r of b.results) {
    for (const branch of [r.raw, r.estimated, r.ideal]) {
      if (
        !branch ||
        !['ok', 'capture-failed', 'window-failed'].includes(
          branch.receiver?.status,
        ) ||
        !same(branch.ber, berBounds(branch.metric)) ||
        (branch.windowSafe !== null &&
          typeof branch.windowSafe !== 'boolean') ||
        (branch.timingError !== null &&
          !Number.isSafeInteger(branch.timingError)) ||
        (branch.cfoError !== null && !Number.isFinite(branch.cfoError))
      )
        throw new Error('Invalid worker branch')
      const acquisition = branch.receiver.acquisition
      if (
        !acquisition ||
        !['not-attempted', 'failed', 'ok'].includes(acquisition.status) ||
        (acquisition.status === 'failed' &&
          typeof acquisition.reason !== 'string') ||
        (acquisition.status === 'ok' &&
          (![
            acquisition.cfo,
            acquisition.peak,
            acquisition.score,
            acquisition.coherence,
          ].every(Number.isFinite) ||
            !Number.isSafeInteger(acquisition.usefulStart)))
      )
        throw new Error('Invalid acquisition')
      if (
        branch.receiver.status === 'ok' &&
        (!(branch.receiver.decisions instanceof Uint8Array) ||
          branch.receiver.decisions.length !== 768 ||
          branch.receiver.decisions.some((v) => v > 2))
      )
        throw new Error('Invalid worker decisions')
      if (
        branch.receiver.status === 'ok' &&
        (!Number.isFinite(branch.receiver.correction) ||
          !Number.isSafeInteger(branch.receiver.usefulStart))
      )
        throw new Error('Invalid worker coordinates')
      if (
        branch.receiver.status !== 'ok' &&
        (typeof branch.receiver.reason !== 'string' ||
          branch.receiver.reason.length > 1000)
      )
        throw new Error('Invalid failure reason')
      if (
        branch.receiver.status === 'ok' &&
        branch.receiver.decisions.filter((v) => v === 2).length !==
          branch.metric.erasedBits
      )
        throw new Error('Invalid erasure count')
      if (
        branch.receiver.status !== 'ok' &&
        (branch.metric.errors !== 0 ||
          branch.metric.erasedBits !== 768 ||
          branch.windowSafe !== null)
      )
        throw new Error('Invalid failure metric')
    }
    const { ed, e0, zD, z0 } = r.controlled
    for (const point of [ed, e0, zD, z0])
      if (
        !point ||
        !['ok', 'window-failed'].includes(point.status) ||
        !same(point.ber, berBounds(point.metric)) ||
        (point.windowSafe !== null && typeof point.windowSafe !== 'boolean') ||
        (point.status === 'window-failed' &&
          (point.metric.errors !== 0 ||
            point.metric.erasedBits !== 768 ||
            point.windowSafe !== null))
      )
        throw new Error('Invalid controlled point')
    if (
      !same(
        r.controlled.interaction,
        interaction(ed.metric, e0.metric, zD.metric, z0.metric),
      ) ||
      !same(r.paired, {
        estimatedMinusRaw: pairedDifference(r.estimated.metric, r.raw.metric),
        estimatedMinusIdeal: pairedDifference(
          r.estimated.metric,
          r.ideal.metric,
        ),
        residualCfoMinusIdeal: pairedDifference(e0.metric, z0.metric),
        timingOffsetMinusIdeal: pairedDifference(zD.metric, z0.metric),
        jointInterventionMinusIdeal: pairedDifference(ed.metric, z0.metric),
      })
    )
      throw new Error('Invalid paired bounds')
  }
}
