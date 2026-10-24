import {
  RESEARCH_ENGINE,
  RESEARCH_SEED_RULE,
  validateResearchPlan,
  validateResearchPrefix,
  summarizeResearch,
  type ResearchPlan,
  type ResearchResult,
  type ResearchTrial,
  type ResearchMetric,
  type ResearchOutcome,
  type ResearchArm,
} from './carrierResearch.js'
export const RESEARCH_HISTORY_KEY = 'signallab-carrier-research-v11'
export const RESEARCH_DRAFT_KEY = 'signallab-carrier-research-v11-checkpoint'
export const OFFLINE_RESEARCH_BUDGET = 2_000_000_000
export interface ResearchRecord {
  version: 1
  id: string
  completedAt: string
  result: ResearchResult
}
export interface ResearchCheckpoint {
  engineVersion: typeof RESEARCH_ENGINE
  plan: ResearchPlan
  trials: ResearchTrial[]
}
const fail = (): never => {
  throw new Error('研究记录、检查点或Worker结果无效。')
}
function projectPlan(p: ResearchPlan): ResearchPlan {
  return {
    frameSymbols: p.frameSymbols,
    modulation: p.modulation,
    ebN0Db: p.ebN0Db,
    phaseDeg: p.phaseDeg,
    frequency: p.frequency,
    seed: p.seed,
    trials: p.trials,
    noiseEnabled: p.noiseEnabled,
    layouts: p.layouts.map(({ kind, spacing }) => ({ kind, spacing })),
  }
}
function projectMetric(m: ResearchMetric): ResearchMetric {
  return { bits: m.bits, errors: m.errors, ber: m.ber, evmRms: m.evmRms }
}
function projectOutcome(o: ResearchOutcome): ResearchOutcome {
  const f = o.fit
  return {
    fit:
      f.status === 'failed'
        ? { status: 'failed', reason: f.reason }
        : {
            status: f.status,
            phaseRad: f.phaseRad,
            frequency: f.frequency,
            period: f.period,
            coherenceDeficit: f.coherenceDeficit,
            peakRatio: f.peakRatio,
            gridSize: f.gridSize,
            operations: f.operations,
            boundaryHit: f.boundaryHit,
          },
    all: o.all === null ? null : projectMetric(o.all),
    common: o.common === null ? null : projectMetric(o.common),
    acquired: o.acquired,
    frequencyError: o.frequencyError,
    phaseErrorDeg: o.phaseErrorDeg,
    phaseRms: o.phaseRms,
    branchChanges: o.branchChanges,
    aliasClassError: o.aliasClassError,
  }
}
function projectTrial(t: ResearchTrial): ResearchTrial {
  return {
    stage: t.stage,
    index: t.index,
    seed: t.seed,
    arms: t.arms.map(
      (a): ResearchArm => ({
        id: a.id,
        pilots: a.pilots,
        gcd: a.gcd,
        overhead: a.overhead,
        pilotEnergy: a.pilotEnergy,
        dataEnergy: a.dataEnergy,
        totalEnergy: a.totalEnergy,
        raw: {
          all: projectMetric(a.raw.all),
          common: projectMetric(a.raw.common),
        },
        ideal: {
          all: projectMetric(a.ideal.all),
          common: projectMetric(a.ideal.common),
        },
        ols: projectOutcome(a.ols),
        ml: projectOutcome(a.ml),
      }),
    ),
  }
}
function equivalent(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b))
    )
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
    Object.keys(bb).every((key) => equivalent(aa[key], bb[key]))
  )
}
export function parseResearchCheckpoint(value: unknown): ResearchCheckpoint {
  try {
    if (!value || typeof value !== 'object') return fail()
    const v = value as ResearchCheckpoint
    if (v.engineVersion !== RESEARCH_ENGINE) return fail()
    validateResearchPlan(v.plan, OFFLINE_RESEARCH_BUDGET)
    validateResearchPrefix(v.plan, v.trials)
    return {
      engineVersion: RESEARCH_ENGINE,
      plan: projectPlan(v.plan),
      trials: v.trials.map(projectTrial),
    }
  } catch {
    return fail()
  }
}
export function makeResearchRecord(
  result: unknown,
  id: string,
  completedAt: string,
): ResearchRecord {
  return parseResearchRecord({ version: 1, id, completedAt, result })
}

/** Validate one incoming frame; persisted checkpoints still validate the full prefix. */
export function parseResearchTrial(
  plan: ResearchPlan,
  value: unknown,
  index: number,
): ResearchTrial {
  try {
    const trial = [value]
    validateResearchPrefix(plan, trial, index)
    return projectTrial(trial[0])
  } catch {
    return fail()
  }
}
export function parseResearchRecord(value: unknown): ResearchRecord {
  try {
    if (!value || typeof value !== 'object') return fail()
    const r = value as ResearchRecord,
      v = r.result
    if (
      r.version !== 1 ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100 ||
      typeof r.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(r.completedAt)) ||
      !v ||
      v.engineVersion !== RESEARCH_ENGINE ||
      v.seedRule !== RESEARCH_SEED_RULE ||
      !Array.isArray(v.calibration) ||
      !Array.isArray(v.evaluation) ||
      v.calibration.length !== 20 ||
      v.evaluation.length !== v.plan?.trials
    )
      return fail()
    const checkpoint = parseResearchCheckpoint({
      engineVersion: v.engineVersion,
      plan: v.plan,
      trials: [...v.calibration, ...v.evaluation],
    })
    const calibration = checkpoint.trials.slice(0, 20),
      evaluation = checkpoint.trials.slice(20),
      summary = summarizeResearch(checkpoint.plan, calibration, evaluation)
    if (!equivalent(v.summary, summary)) return fail()
    return {
      version: 1,
      id: r.id,
      completedAt: r.completedAt,
      result: {
        engineVersion: RESEARCH_ENGINE,
        seedRule: RESEARCH_SEED_RULE,
        plan: checkpoint.plan,
        calibration,
        evaluation,
        summary,
      },
    }
  } catch {
    return fail()
  }
}
export function readResearchHistory(text: string | null): {
  records: ResearchRecord[]
  rejected: number
} {
  if (text === null) return { records: [], rejected: 0 }
  if (text.length > 12_000_000) return { records: [], rejected: 1 }
  try {
    const values: unknown = JSON.parse(text)
    if (!Array.isArray(values) || values.length > 2)
      return { records: [], rejected: 1 }
    const records: ResearchRecord[] = []
    let rejected = 0
    for (const v of values)
      try {
        const r = parseResearchRecord(v)
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
