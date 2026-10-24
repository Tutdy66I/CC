import {
  estimatePilots,
  wrapPhase,
  type PilotEstimate,
  type PilotObservation,
} from './pilotEstimator.js'
import { createAwgnSampler } from './signallab.js'
import {
  COMPARISON_DB,
  MODULATIONS,
  comparisonBit,
  type Modulation,
} from './modulationComparison.js'
import { QAM16_LEVELS, QAM16_SCALE, decodeQam16Axis } from './qam16.js'
import { rotateCarrier } from './carrierOffset.js'

export const ESTIMATION_ENGINE = 'pilot-unwrap-ols-v1' as const
export interface EstimationPlan {
  modulation: Modulation
  ebN0Db: number
  phaseDeg: number
  frequency: number
  spacing: number
  pilots: number
  seed: number
  noiseEnabled: boolean
}
export interface EstimationPreview {
  index: number
  si: number
  sq: number
  i: number
  q: number
}
export interface EstimationMetrics {
  errors: number
  ber: number
  evmRms: number
  preview: EstimationPreview[]
}
export interface EstimationResult {
  totalSymbols: number
  pilotCount: number
  dataBits: number
  overhead: number
  payloadEnergyRatio: number
  dataEnergy: number
  fit: PilotEstimate
  pilotObservations: PilotObservation[]
  outsideRange: boolean
  phaseErrorDeg: number | null
  frequencyError: number | null
  raw: EstimationMetrics
  estimated: EstimationMetrics | null
  ideal: EstimationMetrics
}
export function defaultEstimationPlan(): EstimationPlan {
  return {
    modulation: 'QPSK',
    ebN0Db: 8,
    phaseDeg: 37,
    frequency: 0.001,
    spacing: 16,
    pilots: 128,
    seed: 42,
    noiseEnabled: true,
  }
}
export function validateEstimationPlan(
  value: unknown,
): asserts value is EstimationPlan {
  if (!value || typeof value !== 'object') throw new Error('载波估计方案无效。')
  const p = value as EstimationPlan
  if (
    !MODULATIONS.includes(p.modulation) ||
    !COMPARISON_DB.some((n) => n === p.ebN0Db) ||
    !Number.isInteger(p.seed) ||
    p.seed < 0 ||
    p.seed > 0xffffffff ||
    !Number.isFinite(p.phaseDeg) ||
    Math.abs(p.phaseDeg) > 180 ||
    !Number.isFinite(p.frequency) ||
    p.frequency < -0.5 ||
    p.frequency >= 0.5 ||
    typeof p.noiseEnabled !== 'boolean' ||
    !Number.isInteger(p.spacing) ||
    p.spacing < 2 ||
    p.spacing > 128 ||
    !Number.isInteger(p.pilots) ||
    p.pilots < 8 ||
    p.pilots > 1024 ||
    (p.pilots - 1) * p.spacing + 1 > 131072
  )
    throw new Error(
      '参数无效：导频间距2–128，数量8–1024，总符号≤131072；请核对种子、信噪比和偏移。',
    )
}
export function estimationWidth(modulation: Modulation): number {
  return modulation === 'BPSK' ? 1 : modulation === 'QPSK' ? 2 : 4
}
export function trainingSymbol(modulation: Modulation) {
  return modulation === 'BPSK'
    ? { i: 1, q: 0 }
    : modulation === 'QPSK'
      ? { i: 1, q: 1 }
      : { i: Math.SQRT2, q: Math.SQRT2 }
}
export function estimationDataSymbol(modulation: Modulation, index: number) {
  const k = index * estimationWidth(modulation)
  if (modulation === '16QAM')
    return {
      i:
        QAM16_LEVELS[comparisonBit(k) * 2 + comparisonBit(k + 1)] * QAM16_SCALE,
      q:
        QAM16_LEVELS[comparisonBit(k + 2) * 2 + comparisonBit(k + 3)] *
        QAM16_SCALE,
    }
  return {
    i: 1 - 2 * comparisonBit(k),
    q: modulation === 'BPSK' ? 0 : 1 - 2 * comparisonBit(k + 1),
  }
}

/** One deterministic point per stratum, avoiding coherent sampling of pilot periods. */
export function estimationPreviewDataIndex(
  slot: number,
  dataSymbols: number,
): number {
  const count = Math.min(128, dataSymbols)
  if (slot === 0) return 0
  if (slot === count - 1) return dataSymbols - 1
  const low = Math.floor((slot * dataSymbols) / count),
    high = Math.floor(((slot + 1) * dataSymbols) / count) - 1
  return low + ((Math.imul(slot, 0x9e3779b9) >>> 0) % (high - low + 1))
}

/** Generate one noisy frame. Truth only enters channel generation and ideal/evaluation paths. */
export function runEstimation(p: EstimationPlan): EstimationResult {
  validateEstimationPlan(p)
  const totalSymbols = (p.pilots - 1) * p.spacing + 1,
    dataSymbols = totalSymbols - p.pilots
  const width = estimationWidth(p.modulation),
    dataBits = dataSymbols * width
  const ri = new Float64Array(dataSymbols),
    rq = new Float64Array(dataSymbols)
  const sample = createAwgnSampler(p.ebN0Db, p.seed),
    bpskQ = createAwgnSampler(p.ebN0Db, (p.seed ^ 0x9e3779b9) >>> 0)
  const training = trainingSymbol(p.modulation),
    pilots: PilotObservation[] = []
  let data = 0,
    dataEnergy = 0
  for (let n = 0; n < totalSymbols; n++) {
    const pilot = n % p.spacing === 0,
      tx = pilot ? training : estimationDataSymbol(p.modulation, data)
    const channel = rotateCarrier(tx.i, tx.q, p.phaseDeg, p.frequency, n)
    const i = channel.i + (p.noiseEnabled ? sample(0) : 0),
      q =
        channel.q + (p.noiseEnabled ? (width === 1 ? bpskQ(0) : sample(0)) : 0)
    if (pilot) pilots.push({ index: n, pi: tx.i, pq: tx.q, i, q })
    else {
      ri[data] = i
      rq[data] = q
      data++
      dataEnergy += tx.i ** 2 + tx.q ** 2
    }
  }
  const fit = estimatePilots(pilots)
  function measure(phase: number, frequency: number): EstimationMetrics {
    let errors = 0,
      errorEnergy = 0,
      slot = 0
    const preview: EstimationPreview[] = [],
      count = Math.min(128, dataSymbols),
      hamming = [0, 1, 1, 2]
    for (let d = 0; d < dataSymbols; d++) {
      const index =
        Math.floor(d / (p.spacing - 1)) * p.spacing + 1 + (d % (p.spacing - 1))
      const tx = estimationDataSymbol(p.modulation, d),
        out = rotateCarrier(ri[d], rq[d], -phase, -frequency, index)
      if (width === 4)
        errors +=
          hamming[decodeQam16Axis(tx.i) ^ decodeQam16Axis(out.i)] +
          hamming[decodeQam16Axis(tx.q) ^ decodeQam16Axis(out.q)]
      else {
        errors += Number(tx.i >= 0 !== out.i >= 0)
        if (width === 2) errors += Number(tx.q >= 0 !== out.q >= 0)
      }
      errorEnergy += (out.i - tx.i) ** 2 + (out.q - tx.q) ** 2
      if (slot < count && d === estimationPreviewDataIndex(slot, dataSymbols)) {
        preview.push({ index, si: tx.i, sq: tx.q, i: out.i, q: out.q })
        slot++
      }
    }
    return {
      errors,
      ber: errors / dataBits,
      evmRms: Math.sqrt(errorEnergy / dataEnergy),
      preview,
    }
  }
  return {
    totalSymbols,
    pilotCount: p.pilots,
    dataBits,
    overhead: p.pilots / totalSymbols,
    payloadEnergyRatio: 1 + (p.pilots * width) / dataEnergy,
    dataEnergy,
    fit,
    pilotObservations: pilots,
    outsideRange: Math.abs(p.frequency) >= 1 / (2 * p.spacing),
    phaseErrorDeg:
      fit.status === 'ok'
        ? (wrapPhase(fit.phaseRad - (p.phaseDeg * Math.PI) / 180) * 180) /
          Math.PI
        : null,
    frequencyError: fit.status === 'ok' ? fit.frequency - p.frequency : null,
    raw: measure(0, 0),
    estimated:
      fit.status === 'ok'
        ? measure((fit.phaseRad * 180) / Math.PI, fit.frequency)
        : null,
    ideal: measure(p.phaseDeg, p.frequency),
  }
}
