import {
  simulateCarrierPoint,
  rotateCarrier,
  validateCarrierPlan,
  type CarrierPlan,
  type CarrierPointRequest,
  type CarrierPoint,
  type CarrierRow,
  type CarrierPreview,
} from './carrierOffset.js'
import { COMPARISON_DB } from './modulationComparison.js'
import { decodeQam16Axis, theoreticalQam16Ber } from './qam16.js'
import { theoreticalBpskBer } from './berSweep.js'
import { statisticsSeed } from './seedStatistics.js'

export const COMPENSATION_ENGINE = 'carrier-compensation-v1' as const
export interface CompensationPoint {
  before: CarrierPoint
  after: CarrierPoint
  theoreticalEvmBefore: number
  theoreticalEvmAfter: number
}
export interface CompensationRow {
  before: CarrierRow
  after: CarrierRow
  theoreticalEvmBefore: number
  theoreticalEvmAfter: number
}
export type CompensationMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'done'; rows: CompensationRow[] }
  | { type: 'error'; message: string }

/** Rotate the actual noisy samples, using known truth; never generate another noise stream. */
export function simulateCompensationPoint(
  p: CarrierPointRequest,
): CompensationPoint {
  let signalEnergy = 0,
    errorEnergy = 0,
    impairmentEnergy = 0,
    errors = 0
  const width = p.modulation === 'BPSK' ? 1 : p.modulation === 'QPSK' ? 2 : 4
  const preview: CarrierPreview[] = []
  const symbols = p.bits / width,
    previewCount = Math.min(128, symbols)
  let previewSlot = 0
  const before = simulateCarrierPoint(p, (raw) => {
    const { i, q } = rotateCarrier(
      raw.i,
      raw.q,
      -p.phaseDeg,
      -p.frequency,
      raw.index,
    )
    if (p.modulation === '16QAM') {
      const hamming = [0, 1, 1, 2]
      errors +=
        hamming[decodeQam16Axis(raw.si) ^ decodeQam16Axis(i)] +
        hamming[decodeQam16Axis(raw.sq) ^ decodeQam16Axis(q)]
    } else {
      errors += Number(raw.si >= 0 !== i >= 0)
      if (p.modulation === 'QPSK') errors += Number(raw.sq >= 0 !== q >= 0)
    }
    signalEnergy += raw.si ** 2 + raw.sq ** 2
    errorEnergy += (i - raw.si) ** 2 + (q - raw.sq) ** 2
    const impaired = rotateCarrier(
      raw.si,
      raw.sq,
      p.phaseDeg,
      p.frequency,
      raw.index,
    )
    impairmentEnergy += (impaired.i - raw.si) ** 2 + (impaired.q - raw.sq) ** 2
    if (
      previewSlot < previewCount &&
      raw.index ===
        Math.round((previewSlot * (symbols - 1)) / (previewCount - 1))
    ) {
      // phaseDeg retains the original channel impairment, not a residual estimate.
      preview.push({ ...raw, i, q })
      previewSlot++
    }
  })
  const expectedNoise = p.noiseEnabled ? symbols / 10 ** (p.ebN0Db / 10) : 0
  const theoretical =
    p.phaseDeg === 0 && p.frequency === 0
      ? before.theoretical
      : !p.noiseEnabled
        ? 0
        : p.modulation === '16QAM'
          ? theoreticalQam16Ber(p.ebN0Db)
          : theoreticalBpskBer(p.ebN0Db)
  return {
    before,
    after: {
      errors,
      ber: errors / p.bits,
      theoretical,
      evmRms: Math.sqrt(errorEnergy / signalEnergy),
      preview,
    },
    theoreticalEvmBefore: Math.sqrt(
      (impairmentEnergy + expectedNoise) / signalEnergy,
    ),
    theoreticalEvmAfter: Math.sqrt(expectedNoise / signalEnergy),
  }
}

function summarize(
  points: CarrierPoint[],
  plan: CarrierPlan,
  offset: number,
  seeds: number[],
): CarrierRow {
  let mean = 0,
    m2 = 0
  points.forEach((p, n) => {
    const delta = p.ber - mean
    mean += delta / (n + 1)
    m2 += delta * (p.ber - mean)
  })
  const totalBits = plan.bits * plan.trials,
    totalErrors = points.reduce((sum, p) => sum + p.errors, 0)
  const ber = totalErrors / totalBits
  const radius = Math.sqrt(Math.log(40) / (2 * (totalBits / 64)))
  return {
    offset,
    totalBits,
    totalErrors,
    ber,
    theoretical: points[0].theoretical,
    evmRms: Math.sqrt(
      points.reduce((sum, p) => sum + p.evmRms ** 2, 0) / points.length,
    ),
    sampleSd: Math.sqrt(Math.max(0, m2 / (points.length - 1))),
    interval: [Math.max(0, ber - radius), Math.min(1, ber + radius)],
    seeds,
    preview: points[0].preview,
  }
}

export function runCompensationExperiment(
  plan: CarrierPlan,
  emit: (message: CompensationMessage) => void,
): CompensationRow[] {
  validateCarrierPlan(plan)
  const snrIndex = COMPARISON_DB.findIndex((db) => db === plan.ebN0Db)
  let completed = 0
  const rows = plan.offsets.map((offset) => {
    const points: CompensationPoint[] = [],
      seeds: number[] = []
    for (let trial = 0; trial < plan.trials; trial++) {
      const seed = statisticsSeed(plan.seed, trial, snrIndex)
      seeds.push(seed)
      points.push(
        simulateCompensationPoint({
          ...plan,
          seed,
          phaseDeg: plan.mode === 'phase' ? offset : plan.phaseDeg,
          frequency: plan.mode === 'frequency' ? offset : 0,
        }),
      )
      emit({
        type: 'progress',
        completed: ++completed,
        total: plan.trials * plan.offsets.length,
      })
    }
    return {
      before: summarize(
        points.map((p) => p.before),
        plan,
        offset,
        seeds,
      ),
      after: summarize(
        points.map((p) => p.after),
        plan,
        offset,
        [...seeds],
      ),
      theoreticalEvmBefore: points[0].theoreticalEvmBefore,
      theoreticalEvmAfter: points[0].theoreticalEvmAfter,
    }
  })
  emit({ type: 'done', rows })
  return rows
}
