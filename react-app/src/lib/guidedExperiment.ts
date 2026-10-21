import {
  COMPARISON_DB,
  simulateComparisonPoint,
  type ComparisonPoint,
  type Modulation,
} from './modulationComparison.js'
import {
  statisticsSeed,
  summarizeTrials,
  validateStatisticsRequest,
  type SeedSummary,
} from './seedStatistics.js'

export const GUIDED_TEMPLATES = {
  equivalence: {
    title: 'BPSK / QPSK BER 对照',
    goal: '验证相同 Eb/N0 下 BPSK 与 Gray QPSK 的理论 BER 相同，解释配对噪声下实测重合。',
  },
  qam: {
    title: '16QAM 的 BER 与 EVM',
    goal: '观察 Eb/N0 提高时 16QAM BER 与 EVM 的变化，区分两种指标与有限样本波动。',
  },
  sampling: {
    title: '样本量与种子波动',
    goal: '比较 N/4 与 N 比特的 BPSK 重复试验，观察种子间波动与固定样本区间的变化。',
  },
} as const
export type GuidedTemplate = keyof typeof GUIDED_TEMPLATES
export interface GuidedPlan {
  template: GuidedTemplate
  bits: number
  seed: number
  trials: number
  dbValues: number[]
  rationale: string
}
export interface GuidedRow extends SeedSummary {
  bitsPerTrial: number
  seeds: number[]
  evmPercent: number
  deviation: number
}
export interface GuidedRecord {
  version: 1
  id: string
  completedAt: string
  plan: GuidedPlan
  rows: GuidedRow[]
  analysis: string
}
export type GuidedMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'done'; rows: GuidedRow[] }
  | { type: 'error'; message: string }

export function defaultGuidedPlan(template: GuidedTemplate): GuidedPlan {
  return {
    template,
    bits: 16384,
    seed: 42,
    trials: 5,
    dbValues: [0, 4, 8],
    rationale: '先以较小工作量建立基线；固定种子便于复现，多次重复观察波动。',
  }
}

export function validateGuidedPlan(
  value: unknown,
): asserts value is GuidedPlan {
  if (!value || typeof value !== 'object') throw new Error('引导方案格式无效。')
  const p = value as GuidedPlan
  if (
    !Object.hasOwn(GUIDED_TEMPLATES, p.template) ||
    ![16384, 65536, 131072].includes(p.bits) ||
    ![5, 10, 20].includes(p.trials)
  )
    throw new Error('实验目标、比特数或重复次数不受支持。')
  validateStatisticsRequest(p)
  if (
    !Array.isArray(p.dbValues) ||
    !p.dbValues.length ||
    p.dbValues.length > 10 ||
    p.dbValues.some(
      (db, i) =>
        !COMPARISON_DB.some((v) => v === db) ||
        (i > 0 && db <= p.dbValues[i - 1]),
    )
  )
    throw new Error('请选择递增且不重复的预设 Eb/N0 点。')
  if (
    typeof p.rationale !== 'string' ||
    !p.rationale.trim() ||
    p.rationale.length > 2000
  )
    throw new Error('参数理由须为 1 至 2000 字。')
}

export function parseGuidedProposal(
  answer: string,
  template: GuidedTemplate,
): GuidedPlan {
  let value: unknown
  try {
    value = JSON.parse(
      answer
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    )
  } catch {
    throw new Error('AI 未返回有效的参数 JSON，请重试或使用模板。')
  }
  validateGuidedPlan(value)
  if (value.template !== template) throw new Error('AI 不能更改已选实验目标。')
  // Copy only the executable allowlist; never execute model code or extra fields.
  return {
    template,
    bits: value.bits,
    seed: value.seed,
    trials: value.trials,
    dbValues: [...value.dbValues],
    rationale: value.rationale,
  }
}

function groups(plan: GuidedPlan) {
  const modulations: Modulation[] =
    plan.template === 'equivalence'
      ? ['BPSK', 'QPSK']
      : plan.template === 'qam'
        ? ['16QAM']
        : ['BPSK']
  const sizes =
    plan.template === 'sampling' ? [plan.bits / 4, plan.bits] : [plan.bits]
  return plan.dbValues.flatMap((db) =>
    sizes.flatMap((bits) =>
      modulations.map((modulation) => ({ db, bits, modulation })),
    ),
  )
}

/** Uses the existing physical model and fixed-sample block bounds, without O(bits) storage. */
export function runGuidedExperiment(
  plan: GuidedPlan,
  emit: (m: GuidedMessage) => void,
): GuidedRow[] {
  validateGuidedPlan(plan)
  const jobs = groups(plan)
  let completed = 0
  const rows = jobs.map(({ db, bits, modulation }) => {
    const points: ComparisonPoint[] = []
    const snrIndex = COMPARISON_DB.findIndex((v) => v === db)
    for (let trial = 0; trial < plan.trials; trial++) {
      points.push(
        simulateComparisonPoint(
          modulation,
          db,
          bits,
          statisticsSeed(plan.seed, trial, snrIndex),
        ),
      )
      emit({
        type: 'progress',
        completed: ++completed,
        total: jobs.length * plan.trials,
      })
    }
    const summary = summarizeTrials(points, { ...plan, bits })
    return {
      ...summary,
      bitsPerTrial: bits,
      seeds: points.map((p) => p.seed),
      evmPercent:
        100 *
        Math.sqrt(
          points.reduce((sum, p) => sum + p.evm.rms ** 2, 0) / points.length,
        ),
      deviation: summary.meanBer - summary.theoretical,
    }
  })
  emit({ type: 'done', rows })
  return rows
}

/** Reject broken or inconsistent browser history rather than presenting it as a completed run. */
export function readGuidedHistory(text: string | null): GuidedRecord[] {
  if (!text || text.length > 1_000_000) return []
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return []
    return value.slice(0, 5).filter((record: GuidedRecord) => {
      try {
        validateGuidedPlan(record.plan)
        if (
          record.version !== 1 ||
          typeof record.id !== 'string' ||
          !record.id ||
          record.id.length > 100 ||
          !Number.isFinite(Date.parse(record.completedAt)) ||
          typeof record.analysis !== 'string' ||
          record.analysis.length > 12000
        )
          return false
        const jobs = groups(record.plan)
        return (
          Array.isArray(record.rows) &&
          record.rows.length === jobs.length &&
          record.rows.every((r, i) => {
            const job = jobs[i]
            const snrIndex = COMPARISON_DB.findIndex((v) => v === job.db)
            const theoretical = simulateComparisonPoint(
              job.modulation,
              job.db,
              64,
              0,
            ).theoretical
            const radius = Math.sqrt(Math.log(40) / (2 * (r.totalBits / 64)))
            return (
              r.modulation === job.modulation &&
              r.ebN0Db === job.db &&
              r.bitsPerTrial === job.bits &&
              r.completed === record.plan.trials &&
              r.totalBits === job.bits * record.plan.trials &&
              Number.isInteger(r.totalErrors) &&
              r.totalErrors >= 0 &&
              r.totalErrors <= r.totalBits &&
              r.meanBer === r.totalErrors / r.totalBits &&
              r.theoretical === theoretical &&
              r.deviation === r.meanBer - theoretical &&
              Array.isArray(r.seeds) &&
              r.seeds.length === record.plan.trials &&
              r.seeds.every(
                (s, t) => s === statisticsSeed(record.plan.seed, t, snrIndex),
              ) &&
              Number.isFinite(r.evmPercent) &&
              r.evmPercent >= 0 &&
              typeof r.sampleSd === 'number' &&
              Number.isFinite(r.sampleSd) &&
              r.sampleSd >= 0 &&
              r.minBer >= 0 &&
              r.minBer <= r.meanBer &&
              r.maxBer >= r.meanBer &&
              r.maxBer <= 1 &&
              Array.isArray(r.interval) &&
              r.interval[0] === Math.max(0, r.meanBer - radius) &&
              r.interval[1] === Math.min(1, r.meanBer + radius)
            )
          })
        )
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}
