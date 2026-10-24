import { createAwgnSampler } from './signallab.js'
import {
  COMPARISON_DB,
  MODULATIONS,
  comparisonBit,
  type Modulation,
} from './modulationComparison.js'
import { QAM16_LEVELS, QAM16_SCALE, decodeQam16Axis } from './qam16.js'
import { statisticsSeed } from './seedStatistics.js'

export const CARRIER_ENGINE = 'carrier-offset-v1' as const
export const CARRIER_SEED_RULE =
  'seed=(baseSeed+trial*10+snrIndex) mod 2^32; full grid [-4,-2,0,2,4,6,8,10,12,14]; BPSK Q seed=seed XOR 0x9e3779b9; offsets share noise'
export interface CarrierPointRequest {
  modulation: Modulation
  bits: number
  ebN0Db: number
  seed: number
  phaseDeg: number
  frequency: number
  noiseEnabled: boolean
}
export interface CarrierPlan extends CarrierPointRequest {
  mode: 'phase' | 'frequency'
  offsets: number[]
  trials: number
}
export interface CarrierPreview {
  index: number
  si: number
  sq: number
  i: number
  q: number
  phaseDeg: number
}
export interface CarrierPoint {
  errors: number
  ber: number
  theoretical: number
  evmRms: number
  preview: CarrierPreview[]
}
export interface CarrierRow {
  offset: number
  totalBits: number
  totalErrors: number
  ber: number
  theoretical: number
  evmRms: number
  sampleSd: number
  interval: [number, number]
  seeds: number[]
  preview: CarrierPreview[]
}
export type CarrierMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'done'; rows: CarrierRow[] }
  | { type: 'error'; message: string }

export function defaultCarrierPlan(): CarrierPlan {
  return {
    mode: 'phase',
    modulation: 'QPSK',
    bits: 16384,
    ebN0Db: 8,
    seed: 42,
    trials: 5,
    phaseDeg: 0,
    frequency: 0,
    noiseEnabled: true,
    offsets: [-60, -30, -15, 0, 15, 30, 60],
  }
}

function validatePoint(p: CarrierPointRequest): void {
  if (
    !MODULATIONS.includes(p.modulation) ||
    !Number.isInteger(p.bits) ||
    p.bits < 64 ||
    p.bits > 131072 ||
    p.bits % 64 !== 0 ||
    !Number.isInteger(p.seed) ||
    p.seed < 0 ||
    p.seed > 0xffffffff ||
    !COMPARISON_DB.some((db) => db === p.ebN0Db) ||
    !Number.isFinite(p.phaseDeg) ||
    Math.abs(p.phaseDeg) > 180 ||
    !Number.isFinite(p.frequency) ||
    p.frequency < -0.5 ||
    p.frequency >= 0.5 ||
    typeof p.noiseEnabled !== 'boolean'
  )
    throw new Error(
      '偏移实验参数无效：请核对调制、比特数、种子、信噪比及偏移范围。',
    )
}

export function validateCarrierPlan(
  value: unknown,
): asserts value is CarrierPlan {
  if (!value || typeof value !== 'object') throw new Error('偏移方案格式无效。')
  const p = value as CarrierPlan
  validatePoint(p)
  if (
    !['phase', 'frequency'].includes(p.mode) ||
    ![5, 10, 20].includes(p.trials) ||
    !Array.isArray(p.offsets) ||
    !p.offsets.length ||
    p.offsets.length > 21 ||
    p.offsets.some(
      (v, n) =>
        !Number.isFinite(v) ||
        (n > 0 && v <= p.offsets[n - 1]) ||
        (p.mode === 'phase' ? Math.abs(v) > 180 : v < -0.5 || v >= 0.5),
    ) ||
    (p.mode === 'phase' && p.frequency !== 0) ||
    p.bits * p.trials * p.offsets.length > 80_000_000
  )
    throw new Error(
      '扫描点须递增且不重复（最多21点）；重复5/10/20次，总工作量不超过8000万比特。相位扫描的频偏须为零。',
    )
}

/** Exact quarter turns define deterministic ties; do not snap nearby values. */
export function rotateCarrier(
  i: number,
  q: number,
  phaseDeg: number,
  frequency: number,
  index: number,
) {
  // Adding 1 would round tiny positive offsets away; retain a signed remainder.
  const turns = (phaseDeg / 360 + frequency * index) % 1
  const quarter = turns * 4
  const quadrant = ((quarter % 4) + 4) % 4
  const c = Number.isInteger(quarter)
    ? [1, 0, -1, 0][quadrant]
    : Math.cos(turns * 2 * Math.PI)
  const s = Number.isInteger(quarter)
    ? [0, 1, 0, -1][quadrant]
    : Math.sin(turns * 2 * Math.PI)
  return { i: i * c - q * s, q: i * s + q * c }
}

/** Numerical Recipes erfc approximation, evaluated in the tail; Q(0) is exact. */
function normalTail(x: number): number {
  if (x === 0) return 0.5
  if (x < 0) return 1 - normalTail(-x)
  const u = x / Math.SQRT2,
    t = 1 / (1 + u / 2)
  const polynomial = [
    0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806,
    0.09678418, 0.37409196, 1.00002368,
  ].reduce((v, coefficient) => v * t + coefficient, 0)
  return 0.5 * t * Math.exp(-u * u - 1.26551223 + t * polynomial)
}

const hamming = [0, 1, 1, 2]
function axisExpectedErrors(code: number, mean: number, sigma: number): number {
  const cuts = [-Infinity, -2 * QAM16_SCALE, 0, 2 * QAM16_SCALE, Infinity]
  const codes = [0, 1, 3, 2]
  let expected = 0
  for (let region = 0; region < 4; region++) {
    const low = (cuts[region] - mean) / sigma,
      high = (cuts[region + 1] - mean) / sigma
    const probability =
      low >= 0
        ? normalTail(low) - normalTail(high)
        : normalTail(-high) - normalTail(-low)
    expected += hamming[code ^ codes[region]] * Math.max(0, probability)
  }
  return expected
}

export function simulateCarrierPoint(p: CarrierPointRequest): CarrierPoint {
  validatePoint(p)
  const width = p.modulation === 'BPSK' ? 1 : p.modulation === 'QPSK' ? 2 : 4
  const symbols = p.bits / width
  const sample = createAwgnSampler(p.ebN0Db, p.seed)
  const bpskQ = createAwgnSampler(p.ebN0Db, (p.seed ^ 0x9e3779b9) >>> 0)
  const sigma = Math.sqrt(1 / (2 * 10 ** (p.ebN0Db / 10)))
  let errors = 0,
    signalEnergy = 0,
    errorEnergy = 0,
    expectedErrors = 0
  const preview: CarrierPreview[] = []
  // Deterministic evenly spaced symbols, no extra random draws, including both ends.
  let previewSlot = 0
  const previewCount = Math.min(128, symbols)
  for (let n = 0; n < symbols; n++) {
    const k = n * width
    const ci =
      p.modulation === '16QAM'
        ? comparisonBit(k) * 2 + comparisonBit(k + 1)
        : comparisonBit(k)
    const cq =
      p.modulation === '16QAM'
        ? comparisonBit(k + 2) * 2 + comparisonBit(k + 3)
        : comparisonBit(k + 1)
    const si =
      p.modulation === '16QAM' ? QAM16_LEVELS[ci] * QAM16_SCALE : 1 - 2 * ci
    const sq =
      p.modulation === 'BPSK'
        ? 0
        : p.modulation === '16QAM'
          ? QAM16_LEVELS[cq] * QAM16_SCALE
          : 1 - 2 * cq
    const rotated = rotateCarrier(si, sq, p.phaseDeg, p.frequency, n)
    const i = rotated.i + (p.noiseEnabled ? sample(0) : 0)
    const q =
      rotated.q +
      (p.noiseEnabled ? (p.modulation === 'BPSK' ? bpskQ(0) : sample(0)) : 0)
    const count =
      p.modulation === '16QAM'
        ? hamming[ci ^ decodeQam16Axis(i)] + hamming[cq ^ decodeQam16Axis(q)]
        : Number(ci !== (i >= 0 ? 0 : 1)) +
          (width === 2 ? Number(cq !== (q >= 0 ? 0 : 1)) : 0)
    errors += count
    if (!p.noiseEnabled) expectedErrors += count
    else if (p.modulation === '16QAM')
      expectedErrors +=
        axisExpectedErrors(ci, rotated.i, sigma) +
        axisExpectedErrors(cq, rotated.q, sigma)
    else
      expectedErrors +=
        normalTail((si * rotated.i) / sigma) +
        (width === 2 ? normalTail((sq * rotated.q) / sigma) : 0)
    signalEnergy += si * si + sq * sq
    errorEnergy += (i - si) ** 2 + (q - sq) ** 2
    if (
      previewSlot < previewCount &&
      n === Math.round((previewSlot * (symbols - 1)) / (previewCount - 1))
    ) {
      preview.push({
        index: n,
        si,
        sq,
        i,
        q,
        phaseDeg: p.phaseDeg + 360 * p.frequency * n,
      })
      previewSlot++
    }
  }
  return {
    errors,
    ber: errors / p.bits,
    theoretical: expectedErrors / p.bits,
    evmRms: Math.sqrt(errorEnergy / signalEnergy),
    preview,
  }
}

/** Paired noise per offset; 64-bit independent-noise blocks may have different means. */
export function runCarrierExperiment(
  plan: CarrierPlan,
  emit: (message: CarrierMessage) => void,
): CarrierRow[] {
  validateCarrierPlan(plan)
  const snrIndex = COMPARISON_DB.findIndex((db) => db === plan.ebN0Db)
  let completed = 0
  const rows = plan.offsets.map((offset) => {
    let totalErrors = 0,
      mean = 0,
      m2 = 0,
      evmSquared = 0
    let first: CarrierPoint | undefined
    const seeds: number[] = []
    for (let trial = 0; trial < plan.trials; trial++) {
      const seed = statisticsSeed(plan.seed, trial, snrIndex)
      seeds.push(seed)
      const point = simulateCarrierPoint({
        ...plan,
        seed,
        phaseDeg: plan.mode === 'phase' ? offset : plan.phaseDeg,
        frequency: plan.mode === 'frequency' ? offset : 0,
      })
      first ??= point
      totalErrors += point.errors
      evmSquared += point.evmRms ** 2
      const delta = point.ber - mean
      mean += delta / (trial + 1)
      m2 += delta * (point.ber - mean)
      emit({
        type: 'progress',
        completed: ++completed,
        total: plan.offsets.length * plan.trials,
      })
    }
    const totalBits = plan.bits * plan.trials,
      ber = totalErrors / totalBits
    const radius = Math.sqrt(Math.log(40) / (2 * (totalBits / 64)))
    return {
      offset,
      totalBits,
      totalErrors,
      ber,
      theoretical: first!.theoretical,
      evmRms: Math.sqrt(evmSquared / plan.trials),
      sampleSd: Math.sqrt(Math.max(0, m2 / (plan.trials - 1))),
      interval: [Math.max(0, ber - radius), Math.min(1, ber + radius)] as [
        number,
        number,
      ],
      seeds,
      preview: first!.preview,
    }
  })
  emit({ type: 'done', rows })
  return rows
}
