import {
  CARRIER_ENGINE,
  CARRIER_SEED_RULE,
  validateCarrierPlan,
  type CarrierPlan,
  type CarrierRow,
} from './carrierOffset.js'
import { COMPARISON_DB } from './modulationComparison.js'
import { statisticsSeed } from './seedStatistics.js'

export const CARRIER_HISTORY_KEY = 'signallab-carrier-offset-v1'
export interface CarrierRecord {
  version: 1
  experimentType: 'carrier-offset'
  engineVersion: typeof CARRIER_ENGINE
  seedRule: typeof CARRIER_SEED_RULE
  symbolStart: 0
  evmDefinition: 'reference-energy-IQ-no-correction'
  id: string
  completedAt: string
  plan: CarrierPlan
  rows: CarrierRow[]
}

export function makeCarrierRecord(
  plan: CarrierPlan,
  rows: CarrierRow[],
  id: string,
  completedAt: string,
): CarrierRecord {
  return parseCarrierRecord({
    version: 1,
    experimentType: 'carrier-offset',
    engineVersion: CARRIER_ENGINE,
    seedRule: CARRIER_SEED_RULE,
    symbolStart: 0,
    evmDefinition: 'reference-energy-IQ-no-correction',
    id,
    completedAt,
    plan,
    rows,
  })
}

function finite(
  value: unknown,
  low = 0,
  high = Number.MAX_VALUE,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= low &&
    value <= high
  )
}

/** Structural consistency, not an audit signature or proof of authentic measurements. */
export function parseCarrierRecord(value: unknown): CarrierRecord {
  const fail = () => {
    throw new Error('偏移记录版本未知或数值一致性校验失败。')
  }
  if (!value || typeof value !== 'object') return fail()
  const r = value as CarrierRecord
  if (
    r.version !== 1 ||
    r.experimentType !== 'carrier-offset' ||
    r.engineVersion !== CARRIER_ENGINE ||
    r.seedRule !== CARRIER_SEED_RULE ||
    r.symbolStart !== 0 ||
    r.evmDefinition !== 'reference-energy-IQ-no-correction' ||
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 100 ||
    typeof r.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(r.completedAt))
  )
    return fail()
  validateCarrierPlan(r.plan)
  const p = r.plan
  const width = p.modulation === 'BPSK' ? 1 : p.modulation === 'QPSK' ? 2 : 4
  const symbols = p.bits / width,
    count = Math.min(128, symbols)
  const snrIndex = COMPARISON_DB.findIndex((db) => db === p.ebN0Db)
  const totalBits = p.bits * p.trials
  const radius = Math.sqrt(Math.log(40) / (2 * (totalBits / 64)))
  if (!Array.isArray(r.rows) || r.rows.length !== p.offsets.length)
    return fail()
  for (const [index, row] of r.rows.entries()) {
    if (
      !row ||
      row.offset !== p.offsets[index] ||
      row.totalBits !== totalBits ||
      !Number.isInteger(row.totalErrors) ||
      !finite(row.totalErrors, 0, totalBits) ||
      row.ber !== row.totalErrors / totalBits ||
      !finite(row.theoretical, 0, 1) ||
      !finite(row.evmRms) ||
      !finite(row.sampleSd, 0, 1) ||
      !Array.isArray(row.interval) ||
      row.interval.length !== 2 ||
      row.interval[0] !== Math.max(0, row.ber - radius) ||
      row.interval[1] !== Math.min(1, row.ber + radius) ||
      !Array.isArray(row.seeds) ||
      row.seeds.length !== p.trials ||
      row.seeds.some((s, t) => s !== statisticsSeed(p.seed, t, snrIndex)) ||
      !Array.isArray(row.preview) ||
      row.preview.length !== count
    )
      return fail()
    const phase = p.mode === 'phase' ? row.offset : p.phaseDeg
    const frequency = p.mode === 'frequency' ? row.offset : 0
    if (
      row.preview.some(
        (sample, n) =>
          !sample ||
          sample.index !== Math.round((n * (symbols - 1)) / (count - 1)) ||
          ![sample.si, sample.sq, sample.i, sample.q].every((v) =>
            finite(v, -Number.MAX_VALUE),
          ) ||
          sample.phaseDeg !== phase + 360 * frequency * sample.index,
      )
    )
      return fail()
  }
  // Explicit schema boundary, detached from callers and legacy cloud record types.
  return structuredClone({
    version: 1,
    experimentType: 'carrier-offset',
    engineVersion: CARRIER_ENGINE,
    seedRule: CARRIER_SEED_RULE,
    symbolStart: 0,
    evmDefinition: 'reference-energy-IQ-no-correction',
    id: r.id,
    completedAt: r.completedAt,
    plan: {
      mode: p.mode,
      modulation: p.modulation,
      bits: p.bits,
      ebN0Db: p.ebN0Db,
      seed: p.seed,
      trials: p.trials,
      phaseDeg: p.phaseDeg,
      frequency: p.frequency,
      noiseEnabled: p.noiseEnabled,
      offsets: p.offsets,
    },
    rows: r.rows,
  })
}

export function readCarrierRecords(text: string | null): {
  records: CarrierRecord[]
  rejected: number
} {
  if (text === null) return { records: [], rejected: 0 }
  if (text.length > 4_000_000) return { records: [], rejected: 1 }
  try {
    const values: unknown = JSON.parse(text)
    if (!Array.isArray(values) || values.length > 5)
      return { records: [], rejected: 1 }
    const records: CarrierRecord[] = []
    let rejected = 0
    for (const value of values) {
      try {
        const record = parseCarrierRecord(value)
        if (records.some((r) => r.id === record.id))
          throw new Error('duplicate id')
        records.push(record)
      } catch {
        rejected++
      }
    }
    return { records, rejected }
  } catch {
    return { records: [], rejected: 1 }
  }
}
