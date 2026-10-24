import {
  CARRIER_ENGINE,
  CARRIER_SEED_RULE,
  rotateCarrier,
  type CarrierPlan,
} from './carrierOffset.js'
import { makeCarrierRecord } from './carrierOffsetRecord.js'
import {
  COMPENSATION_ENGINE,
  type CompensationRow,
} from './carrierCompensation.js'
import { comparisonBit } from './modulationComparison.js'
import { modulateBpsk } from './signallab.js'
import { modulateQpsk } from './qpsk.js'
import { modulateQam16, theoreticalQam16Ber } from './qam16.js'
import { theoreticalBpskBer } from './berSweep.js'

export const COMPENSATION_HISTORY_KEY = 'signallab-carrier-compensation-v1'
export interface CompensationRecord {
  version: 1
  experimentType: 'carrier-compensation'
  engineVersion: typeof COMPENSATION_ENGINE
  sourceEngine: typeof CARRIER_ENGINE
  compensation: 'known-truth-inverse-rotation'
  seedRule: typeof CARRIER_SEED_RULE
  symbolStart: 0
  evmDefinition: 'reference-energy-IQ-paired-known-truth'
  theoreticalEvmDefinition: 'sqrt-expected-squared-evm'
  id: string
  completedAt: string
  plan: CarrierPlan
  rows: CompensationRow[]
}

export function makeCompensationRecord(
  plan: CarrierPlan,
  rows: CompensationRow[],
  id: string,
  completedAt: string,
): CompensationRecord {
  return parseCompensationRecord({
    version: 1,
    experimentType: 'carrier-compensation',
    engineVersion: COMPENSATION_ENGINE,
    sourceEngine: CARRIER_ENGINE,
    compensation: 'known-truth-inverse-rotation',
    seedRule: CARRIER_SEED_RULE,
    symbolStart: 0,
    evmDefinition: 'reference-energy-IQ-paired-known-truth',
    theoreticalEvmDefinition: 'sqrt-expected-squared-evm',
    id,
    completedAt,
    plan,
    rows,
  })
}
const close = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-10 * (1 + Math.abs(b))

/** Structural and paired-preview validation; local data is not an audit certificate. */
export function parseCompensationRecord(value: unknown): CompensationRecord {
  const fail = (): never => {
    throw new Error('理想补偿记录版本未知或成对结果校验失败。')
  }
  if (!value || typeof value !== 'object') return fail()
  const r = value as CompensationRecord
  if (
    r.version !== 1 ||
    r.experimentType !== 'carrier-compensation' ||
    r.engineVersion !== COMPENSATION_ENGINE ||
    r.sourceEngine !== CARRIER_ENGINE ||
    r.compensation !== 'known-truth-inverse-rotation' ||
    r.seedRule !== CARRIER_SEED_RULE ||
    r.symbolStart !== 0 ||
    r.evmDefinition !== 'reference-energy-IQ-paired-known-truth' ||
    r.theoreticalEvmDefinition !== 'sqrt-expected-squared-evm' ||
    !Array.isArray(r.rows) ||
    r.rows.length > 21 ||
    r.rows.some((row) => !row || typeof row !== 'object')
  )
    return fail()
  const before = makeCarrierRecord(
    r.plan,
    r.rows.map((row) => row.before),
    r.id,
    r.completedAt,
  )
  const after = makeCarrierRecord(
    r.plan,
    r.rows.map((row) => row.after),
    r.id,
    r.completedAt,
  )
  const plan = before.plan
  const width =
    plan.modulation === 'BPSK' ? 1 : plan.modulation === 'QPSK' ? 2 : 4
  const expectedAfter = plan.noiseEnabled
    ? 1 / Math.sqrt(width * 10 ** (plan.ebN0Db / 10))
    : 0
  const expectedBerAfter = !plan.noiseEnabled
    ? 0
    : plan.modulation === '16QAM'
      ? theoreticalQam16Ber(plan.ebN0Db)
      : theoreticalBpskBer(plan.ebN0Db)
  const cycleBits = Array.from({ length: 64 }, (_, n) => comparisonBit(n))
  const reference =
    plan.modulation === 'BPSK'
      ? modulateBpsk(cycleBits).map((i) => ({ i, q: 0 }))
      : plan.modulation === 'QPSK'
        ? modulateQpsk(cycleBits)
        : modulateQam16(cycleBits)
  r.rows.forEach((row, n) => {
    if (
      !Number.isFinite(row.theoreticalEvmBefore) ||
      row.theoreticalEvmBefore < 0 ||
      !close(row.theoreticalEvmAfter, expectedAfter) ||
      row.theoreticalEvmBefore + 1e-10 < expectedAfter
    )
      fail()
    const phase = plan.mode === 'phase' ? plan.offsets[n] : plan.phaseDeg
    const frequency = plan.mode === 'frequency' ? plan.offsets[n] : 0
    // Deterministic prediction validation uses only a bounded constellation cycle;
    // no random draws or measurement rerun. Symbol time continues through the frame.
    let impairmentEnergy = 0,
      signalEnergy = 0
    const symbols = plan.bits / width
    for (let index = 0; index < symbols; index++) {
      const s = reference[index % reference.length]
      const impaired = rotateCarrier(s.i, s.q, phase, frequency, index)
      signalEnergy += s.i ** 2 + s.q ** 2
      impairmentEnergy += (impaired.i - s.i) ** 2 + (impaired.q - s.q) ** 2
    }
    const noiseEnergy = plan.noiseEnabled
      ? symbols / 10 ** (plan.ebN0Db / 10)
      : 0
    if (
      !close(
        row.theoreticalEvmBefore,
        Math.sqrt((impairmentEnergy + noiseEnergy) / signalEnergy),
      ) ||
      !close(row.after.theoretical, expectedBerAfter)
    )
      fail()
    if (
      !plan.noiseEnabled &&
      (row.after.totalErrors !== 0 ||
        row.after.theoretical !== 0 ||
        row.after.evmRms > 1e-12)
    )
      fail()
    if (
      phase === 0 &&
      frequency === 0 &&
      (row.before.totalErrors !== row.after.totalErrors ||
        !close(row.before.evmRms, row.after.evmRms) ||
        !close(row.before.theoretical, row.after.theoretical))
    )
      fail()
    row.before.preview.forEach((raw, k) => {
      const corrected = row.after.preview[k]
      const expected = rotateCarrier(
        raw.i,
        raw.q,
        -phase,
        -frequency,
        raw.index,
      )
      if (
        raw.si !== corrected.si ||
        raw.sq !== corrected.sq ||
        !close(corrected.i, expected.i) ||
        !close(corrected.q, expected.q)
      )
        fail()
    })
  })
  return structuredClone({
    version: 1,
    experimentType: 'carrier-compensation',
    engineVersion: COMPENSATION_ENGINE,
    sourceEngine: CARRIER_ENGINE,
    compensation: 'known-truth-inverse-rotation',
    seedRule: CARRIER_SEED_RULE,
    symbolStart: 0,
    evmDefinition: 'reference-energy-IQ-paired-known-truth',
    theoreticalEvmDefinition: 'sqrt-expected-squared-evm',
    id: before.id,
    completedAt: before.completedAt,
    plan,
    rows: r.rows.map((row, n) => ({
      before: before.rows[n],
      after: after.rows[n],
      theoreticalEvmBefore: row.theoreticalEvmBefore,
      theoreticalEvmAfter: row.theoreticalEvmAfter,
    })),
  })
}

export function readCompensationRecords(text: string | null): {
  records: CompensationRecord[]
  rejected: number
} {
  if (text === null) return { records: [], rejected: 0 }
  if (text.length > 8_000_000) return { records: [], rejected: 1 }
  try {
    const values: unknown = JSON.parse(text)
    if (!Array.isArray(values) || values.length > 5)
      return { records: [], rejected: 1 }
    const records: CompensationRecord[] = []
    let rejected = 0
    for (const value of values) {
      try {
        const r = parseCompensationRecord(value)
        if (records.some((p) => p.id === r.id)) throw new Error('duplicate id')
        records.push(r)
      } catch {
        rejected++
      }
    }
    return { records, rejected }
  } catch {
    return { records: [], rejected: 1 }
  }
}
