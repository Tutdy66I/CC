import {
  estimatePilots,
  wrapPhase,
  type PilotObservation,
} from './pilotEstimator.js'
export const RESEARCH_LAYOUTS = ['uniform', 'shifted', 'paired'] as const
export type PilotLayoutKind = (typeof RESEARCH_LAYOUTS)[number]
export type SearchFit =
  | {
      status: 'ok'
      phaseRad: number
      frequency: number
      period: number
      coherenceDeficit: number
      peakRatio: number | null
      gridSize: number
      operations: number
      boundaryHit: boolean
      trace?: number[]
    }
  | { status: 'failed'; reason: string }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
export function pilotGcd(indices: readonly number[]): number {
  if (
    indices.length < 2 ||
    indices.some(
      (n, m) =>
        !Number.isSafeInteger(n) || n < 0 || (m > 0 && n <= indices[m - 1]),
    )
  )
    throw new Error('导频位置须为递增整数。')
  return indices.slice(1).reduce((g, n) => gcd(g, n - indices[0]), 0)
}
export function buildPilotLayout(
  N: number,
  L: number,
  kind: PilotLayoutKind,
): number[] {
  if (
    ![257, 513, 1025, 2049, 129].includes(N) ||
    ![8, 16, 32, 64].includes(L) ||
    (N - 1) % L ||
    !RESEARCH_LAYOUTS.includes(kind)
  )
    throw new Error('导频布局参数无效。')
  const base = Array.from({ length: (N - 1) / L + 1 }, (_, m) => m * L)
  if (kind === 'uniform') return base
  if (kind === 'shifted')
    return base.map((n, m) =>
      m > 0 && m < base.length - 1 && m % 2 === 1 ? n + 1 : n,
    )
  return base.flatMap((n) => (n < N - 1 ? [n, n + 1] : [n]))
}
function valid(samples: readonly PilotObservation[]): boolean {
  return (
    Array.isArray(samples) &&
    samples.length >= 2 &&
    samples.length <= 1024 &&
    Array.from(samples).every(
      (p, m) =>
        p &&
        [p.index, p.pi, p.pq, p.i, p.q].every(Number.isFinite) &&
        Number.isSafeInteger(p.index) &&
        p.index >= 0 &&
        p.index <= 2048 &&
        (m === 0 || p.index > samples[m - 1].index) &&
        p.pi * p.pi + p.pq * p.pq > 0,
    )
  )
}
function gridFor(indices: readonly number[]): number {
  const g = pilotGcd(indices),
    span = indices.at(-1)! - indices[0]
  return Math.max(128, 2 ** Math.ceil(Math.log2((8 * span) / g)))
}
export function searchCost(indices: readonly number[]): number {
  return (gridFor(indices) + 4 * 35 + 1) * indices.length
}
function coherence(
  samples: readonly PilotObservation[],
  phase: number,
  frequency: number,
): number {
  let residual = 0,
    rxEnergy = 0,
    txEnergy = 0
  for (const p of samples) {
    const a = phase + 2 * Math.PI * frequency * p.index,
      c = Math.cos(a),
      s = Math.sin(a)
    residual += p.i * (p.pi * c - p.pq * s) + p.q * (p.pi * s + p.pq * c)
    rxEnergy += p.i * p.i + p.q * p.q
    txEnergy += p.pi * p.pi + p.pq * p.pq
  }
  return Math.max(0, Math.min(1, 1 - residual / Math.sqrt(rxEnergy * txEnergy)))
}
/** Pilot-only approximate ML: full principal-period grid + four local peak refinements. */
export function searchPilots(samples: readonly PilotObservation[]): SearchFit {
  const fail = (): SearchFit => ({
    status: 'failed',
    reason: '导频观测无效或接收能量为零。',
  })
  if (!valid(samples)) return fail()
  const indices = samples.map((p) => p.index),
    g = pilotGcd(indices),
    period = 1 / g,
    M = gridFor(indices),
    step = period / M,
    low = -period / 2
  let rxEnergy = 0,
    txEnergy = 0
  const pilots = samples.map((p) => {
    rxEnergy += p.i * p.i + p.q * p.q
    txEnergy += p.pi * p.pi + p.pq * p.pq
    return {
      n: p.index,
      i: p.i * p.pi + p.q * p.pq,
      q: p.q * p.pi - p.i * p.pq,
    }
  })
  if (
    !(rxEnergy > 0) ||
    !Number.isFinite(rxEnergy) ||
    !Number.isFinite(txEnergy)
  )
    return fail()
  const re = new Float64Array(M),
    im = new Float64Array(M)
  // Recurrence avoids a trigonometric call for every grid/pilot pair.
  for (const p of pilots) {
    const a = -2 * Math.PI * low * p.n,
      b = -2 * Math.PI * step * p.n,
      c = Math.cos(b),
      s = Math.sin(b)
    let i = p.i * Math.cos(a) - p.q * Math.sin(a),
      q = p.i * Math.sin(a) + p.q * Math.cos(a)
    for (let m = 0; m < M; m++) {
      re[m] += i
      im[m] += q
      const ni = i * c - q * s
      q = i * s + q * c
      i = ni
    }
  }
  const power = Array.from(re, (i, m) => i * i + im[m] * im[m]),
    peaks: number[] = []
  for (let m = 0; m < M; m++)
    if (power[m] >= power[(m + M - 1) % M] && power[m] >= power[(m + 1) % M])
      peaks.push(m)
  peaks.sort((a, b) => power[b] - power[a] || a - b)
  const radius = Math.max(
      1,
      Math.ceil((M * g) / (indices.at(-1)! - indices[0])),
    ),
    chosen: number[] = []
  for (const m of peaks)
    if (
      chosen.every(
        (n) => Math.min(Math.abs(n - m), M - Math.abs(n - m)) > radius,
      )
    ) {
      chosen.push(m)
      if (chosen.length === 4) break
    }
  if (!chosen.length) chosen.push(power.indexOf(Math.max(...power)))
  let evaluations = 0
  const correlate = (f: number) => {
    evaluations++
    let i = 0,
      q = 0
    for (const p of pilots) {
      const a = -2 * Math.PI * f * p.n,
        c = Math.cos(a),
        s = Math.sin(a)
      i += p.i * c - p.q * s
      q += p.i * s + p.q * c
    }
    return { f, i, q, power: i * i + q * q }
  }
  const refined = chosen.map((m) => {
    let a = low + (m - 1) * step,
      b = low + (m + 1) * step
    const ratio = (Math.sqrt(5) - 1) / 2
    let x = b - ratio * (b - a),
      y = a + ratio * (b - a),
      cx = correlate(x),
      cy = correlate(y)
    for (let k = 0; k < 32; k++) {
      if (cx.power > cy.power) {
        b = y
        y = x
        cy = cx
        x = b - ratio * (b - a)
        cx = correlate(x)
      } else {
        a = x
        x = y
        cx = cy
        y = a + ratio * (b - a)
        cy = correlate(y)
      }
    }
    return correlate((a + b) / 2)
  })
  refined.sort((a, b) => b.power - a.power || a.f - b.f)
  const frequency =
      ((((refined[0].f + period / 2) % period) + period) % period) - period / 2,
    final = correlate(frequency),
    phaseRad = Math.atan2(final.q, final.i)
  if (
    ![frequency, phaseRad, final.power].every(Number.isFinite) ||
    !(final.power > 0)
  )
    return fail()
  return {
    status: 'ok',
    phaseRad: wrapPhase(phaseRad),
    frequency,
    period,
    coherenceDeficit: Math.max(
      0,
      Math.min(1, 1 - Math.sqrt(final.power / (rxEnergy * txEnergy))),
    ),
    peakRatio: refined[1]?.power > 0 ? final.power / refined[1].power : null,
    gridSize: M,
    operations: (M + evaluations) * samples.length,
    boundaryHit: period / 2 - Math.abs(frequency) < 2 * step,
  }
}
/** Frozen v1.0 for regular positions; explicit new nonuniform sequential-unwrap extension. */
export function fitPilotOls(samples: readonly PilotObservation[]): SearchFit {
  if (!valid(samples) || samples.some((p) => p.i * p.i + p.q * p.q === 0))
    return { status: 'failed', reason: '展开导频无效或幅度为零。' }
  const L = samples[1].index - samples[0].index,
    regular = samples.every((p, m) => p.index === samples[0].index + m * L)
  const angles = samples.map((p) =>
      Math.atan2(p.q * p.pi - p.i * p.pq, p.i * p.pi + p.q * p.pq),
    ),
    trace = [angles[0]]
  for (let m = 1; m < angles.length; m++)
    trace.push(trace[m - 1] + wrapPhase(angles[m] - angles[m - 1]))
  let phaseRad: number, frequency: number
  if (regular) {
    const fit = estimatePilots(samples)
    if (fit.status === 'failed') return fit
    phaseRad = fit.phaseRad
    frequency = fit.frequency
  } else {
    const xm = samples.reduce((s, p) => s + p.index, 0) / samples.length,
      ym = trace.reduce((a, b) => a + b) / trace.length
    const slope =
      samples.reduce((s, p, m) => s + (p.index - xm) * (trace[m] - ym), 0) /
      samples.reduce((s, p) => s + (p.index - xm) ** 2, 0)
    phaseRad = wrapPhase(ym - slope * xm)
    frequency = slope / (2 * Math.PI)
  }
  return {
    status: 'ok',
    phaseRad,
    frequency,
    period: 1 / pilotGcd(samples.map((p) => p.index)),
    coherenceDeficit: coherence(samples, phaseRad, frequency),
    peakRatio: null,
    gridSize: 0,
    operations: samples.length,
    boundaryHit: false,
    trace,
  }
}
