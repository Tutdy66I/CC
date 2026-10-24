import {
  ESTIMATION_ENGINE,
  estimationWidth,
  estimationDataSymbol,
  estimationPreviewDataIndex,
  trainingSymbol,
  validateEstimationPlan,
  type EstimationPlan,
  type EstimationResult,
  type EstimationMetrics,
} from './carrierEstimation.js'
import { estimatePilots, wrapPhase } from './pilotEstimator.js'
import { rotateCarrier } from './carrierOffset.js'

export const ESTIMATION_HISTORY_KEY = 'signallab-carrier-estimation-v1'
export const ESTIMATION_SEED_RULE =
  'single-frame seed uint32; Mulberry32/Box-Muller; I/Q per transmitted symbol; BPSK Q seed XOR 0x9e3779b9'
export interface EstimationRecord {
  version: 1
  engineVersion: typeof ESTIMATION_ENGINE
  experimentType: 'pilot-carrier-estimation'
  seedRule: typeof ESTIMATION_SEED_RULE
  evmDefinition: 'data-only-reference-energy-IQ'
  id: string
  completedAt: string
  plan: EstimationPlan
  result: EstimationResult
}
const close = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b))
function equivalent(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return close(a, b)
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>
  return (
    Object.keys(aa).length === Object.keys(bb).length &&
    Object.keys(bb).every((k) => equivalent(aa[k], bb[k]))
  )
}
export function makeEstimationRecord(
  plan: EstimationPlan,
  result: unknown,
  id: string,
  completedAt: string,
): EstimationRecord {
  return parseEstimationRecord({
    version: 1,
    engineVersion: ESTIMATION_ENGINE,
    experimentType: 'pilot-carrier-estimation',
    seedRule: ESTIMATION_SEED_RULE,
    evmDefinition: 'data-only-reference-energy-IQ',
    id,
    completedAt,
    plan,
    result,
  })
}
/** Structural/math validation, not an authenticity claim or full measurement replay. */
export function parseEstimationRecord(value: unknown): EstimationRecord {
  const fail = (): never => {
    throw new Error('载波估计记录或 Worker 结果无效。')
  }
  if (!value || typeof value !== 'object') return fail()
  const r = value as EstimationRecord
  if (
    r.version !== 1 ||
    r.engineVersion !== ESTIMATION_ENGINE ||
    r.experimentType !== 'pilot-carrier-estimation' ||
    r.seedRule !== ESTIMATION_SEED_RULE ||
    r.evmDefinition !== 'data-only-reference-energy-IQ' ||
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 100 ||
    typeof r.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(r.completedAt))
  )
    return fail()
  validateEstimationPlan(r.plan)
  const p = r.plan,
    s = r.result,
    k = estimationWidth(p.modulation),
    N = (p.pilots - 1) * p.spacing + 1,
    D = N - p.pilots,
    training = trainingSymbol(p.modulation)
  if (
    !s ||
    s.totalSymbols !== N ||
    s.pilotCount !== p.pilots ||
    s.dataBits !== D * k ||
    s.overhead !== p.pilots / N ||
    !Number.isFinite(s.dataEnergy) ||
    s.dataEnergy <= 0 ||
    !close(s.payloadEnergyRatio, 1 + (p.pilots * k) / s.dataEnergy) ||
    s.outsideRange !== Math.abs(p.frequency) >= 1 / (2 * p.spacing) ||
    !Array.isArray(s.pilotObservations) ||
    s.pilotObservations.length !== p.pilots
  )
    return fail()
  if (
    s.pilotObservations.some(
      (obs, m) =>
        !obs ||
        obs.index !== m * p.spacing ||
        obs.pi !== training.i ||
        obs.pq !== training.q ||
        ![obs.i, obs.q].every(Number.isFinite),
    )
  )
    return fail()
  const fit = estimatePilots(s.pilotObservations)
  let expectedEnergy = 0
  for (let d = 0; d < D; d++) {
    const tx = estimationDataSymbol(p.modulation, d)
    expectedEnergy += tx.i ** 2 + tx.q ** 2
  }
  if (!close(s.dataEnergy, expectedEnergy)) return fail()
  if (!equivalent(s.fit, fit)) return fail()
  if (fit.status === 'ok') {
    if (
      !s.estimated ||
      !close(s.frequencyError!, fit.frequency - p.frequency) ||
      !close(
        s.phaseErrorDeg!,
        (wrapPhase(fit.phaseRad - (p.phaseDeg * Math.PI) / 180) * 180) /
          Math.PI,
      )
    )
      return fail()
  } else if (
    s.estimated !== null ||
    s.frequencyError !== null ||
    s.phaseErrorDeg !== null
  )
    return fail()
  for (const metric of [
    s.raw,
    s.ideal,
    ...(s.estimated ? [s.estimated] : []),
  ]) {
    if (
      !metric ||
      !Number.isInteger(metric.errors) ||
      metric.errors < 0 ||
      metric.errors > s.dataBits ||
      metric.ber !== metric.errors / s.dataBits ||
      !Number.isFinite(metric.evmRms) ||
      metric.evmRms < 0 ||
      !Array.isArray(metric.preview) ||
      metric.preview.length !== Math.min(128, D)
    )
      return fail()
    for (const [slot, sample] of metric.preview.entries()) {
      const d = estimationPreviewDataIndex(slot, D),
        index =
          Math.floor(d / (p.spacing - 1)) * p.spacing +
          1 +
          (d % (p.spacing - 1))
      if (
        !sample ||
        sample.index !== index ||
        ![sample.si, sample.sq, sample.i, sample.q].every(Number.isFinite)
      )
        return fail()
      const tx = estimationDataSymbol(p.modulation, d)
      if (sample.si !== tx.i || sample.sq !== tx.q) return fail()
    }
  }
  for (const [metric, phase, freq] of [
    [s.ideal, p.phaseDeg, p.frequency],
    ...(s.estimated && fit.status === 'ok'
      ? [[s.estimated, (fit.phaseRad * 180) / Math.PI, fit.frequency] as const]
      : []),
  ] as const) {
    metric.preview.forEach((sample, m) => {
      const raw = s.raw.preview[m],
        out = rotateCarrier(raw.i, raw.q, -phase, -freq, raw.index)
      if (
        sample.si !== raw.si ||
        sample.sq !== raw.sq ||
        !close(sample.i, out.i) ||
        !close(sample.q, out.q)
      )
        fail()
    })
  }
  const project = (m: EstimationMetrics): EstimationMetrics => ({
    errors: m.errors,
    ber: m.ber,
    evmRms: m.evmRms,
    preview: m.preview.map(({ index, si, sq, i, q }) => ({
      index,
      si,
      sq,
      i,
      q,
    })),
  })
  return structuredClone({
    version: 1,
    engineVersion: ESTIMATION_ENGINE,
    experimentType: 'pilot-carrier-estimation',
    seedRule: ESTIMATION_SEED_RULE,
    evmDefinition: 'data-only-reference-energy-IQ',
    id: r.id,
    completedAt: r.completedAt,
    plan: {
      modulation: p.modulation,
      ebN0Db: p.ebN0Db,
      phaseDeg: p.phaseDeg,
      frequency: p.frequency,
      spacing: p.spacing,
      pilots: p.pilots,
      seed: p.seed,
      noiseEnabled: p.noiseEnabled,
    },
    result: {
      totalSymbols: s.totalSymbols,
      pilotCount: s.pilotCount,
      dataBits: s.dataBits,
      overhead: s.overhead,
      payloadEnergyRatio: s.payloadEnergyRatio,
      dataEnergy: s.dataEnergy,
      fit,
      pilotObservations: s.pilotObservations.map(({ index, pi, pq, i, q }) => ({
        index,
        pi,
        pq,
        i,
        q,
      })),
      outsideRange: s.outsideRange,
      phaseErrorDeg: s.phaseErrorDeg,
      frequencyError: s.frequencyError,
      raw: project(s.raw),
      estimated: s.estimated ? project(s.estimated) : null,
      ideal: project(s.ideal),
    },
  })
}
export function readEstimationRecords(text: string | null): {
  records: EstimationRecord[]
  rejected: number
} {
  if (text === null) return { records: [], rejected: 0 }
  if (text.length > 4_000_000) return { records: [], rejected: 1 }
  try {
    const values: unknown = JSON.parse(text)
    if (!Array.isArray(values) || values.length > 5)
      return { records: [], rejected: 1 }
    const records: EstimationRecord[] = []
    let rejected = 0
    for (const value of values)
      try {
        const r = parseEstimationRecord(value)
        if (records.some((old) => old.id === r.id)) throw new Error('duplicate')
        records.push(r)
      } catch {
        rejected++
      }
    return { records, rejected }
  } catch {
    return { records: [], rejected: 1 }
  }
}
