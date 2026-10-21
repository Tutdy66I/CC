import {
  COMPARISON_DB,
  MODULATIONS,
  simulateComparisonPoint,
  validateComparisonRequest,
  type ComparisonPoint,
  type Modulation,
} from './modulationComparison.js'

export interface StatisticsRequest {
  bits: number
  seed: number
  trials: number
}
export interface SeedSummary {
  modulation: Modulation
  ebN0Db: number
  completed: number
  totalBits: number
  totalErrors: number
  meanBer: number
  minBer: number
  maxBer: number
  sampleSd: number | null
  theoretical: number
  interval: [number, number] | null
}
export type StatisticsMessage =
  | { type: 'summary'; summary: SeedSummary }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function validateStatisticsRequest(request: StatisticsRequest): void {
  validateComparisonRequest(request)
  if (
    !Number.isInteger(request.trials) ||
    request.trials < 5 ||
    request.trials > 20
  )
    throw new Error('重复次数须为 5 至 20 的整数。')
  if (
    request.bits * request.trials * COMPARISON_DB.length * MODULATIONS.length >
    80_000_000
  )
    throw new Error(
      '统计总工作量不能超过 8000 万比特，请减少比特数或重复次数。',
    )
}

export function statisticsSeed(
  base: number,
  trial: number,
  snrIndex: number,
): number {
  if (
    !Number.isInteger(base) ||
    base < 0 ||
    base > 0xffffffff ||
    !Number.isInteger(trial) ||
    trial < 0 ||
    trial >= 20 ||
    !Number.isInteger(snrIndex) ||
    snrIndex < 0 ||
    snrIndex >= COMPARISON_DB.length
  )
    throw new Error('无效的统计种子索引。')
  return (base + trial * COMPARISON_DB.length + snrIndex) >>> 0
}

/** Equal-size trials; only the prespecified final sample receives an interval. */
export function summarizeTrials(
  points: readonly ComparisonPoint[],
  request: StatisticsRequest,
): SeedSummary {
  validateStatisticsRequest(request)
  if (!points.length || points.length > request.trials)
    throw new Error('统计样本数量无效。')
  const first = points[0]
  const snrIndex = COMPARISON_DB.findIndex((db) => db === first.ebN0Db)
  if (snrIndex < 0 || !MODULATIONS.includes(first.modulation))
    throw new Error('统计实验点无效。')
  let mean = 0,
    m2 = 0,
    totalErrors = 0
  let minBer = 1,
    maxBer = 0
  points.forEach((point, index) => {
    if (
      point.modulation !== first.modulation ||
      point.ebN0Db !== first.ebN0Db ||
      point.bits !== request.bits ||
      point.seed !== statisticsSeed(request.seed, index, snrIndex) ||
      !Number.isInteger(point.errors) ||
      point.errors < 0 ||
      point.errors > request.bits ||
      point.ber !== point.errors / request.bits
    )
      throw new Error('统计样本与运行参数不一致。')
    totalErrors += point.errors
    const delta = point.ber - mean
    mean += delta / (index + 1)
    m2 += delta * (point.ber - mean)
    minBer = Math.min(minBer, point.ber)
    maxBer = Math.max(maxBer, point.ber)
  })
  const totalBits = request.bits * points.length
  const meanBer = totalErrors / totalBits
  // Each identical 64-bit constellation cycle is one bounded [0,1] observation.
  // Within-symbol error dependence is allowed; ideal independent noise blocks
  // are assumed. PRNG streams approximate that model rather than prove it.
  const radius = Math.sqrt(Math.log(40) / (2 * (totalBits / 64)))
  return {
    modulation: first.modulation,
    ebN0Db: first.ebN0Db,
    completed: points.length,
    totalBits,
    totalErrors,
    meanBer,
    minBer,
    maxBer,
    sampleSd:
      points.length < 2
        ? null
        : Math.sqrt(Math.max(0, m2 / (points.length - 1))),
    theoretical: first.theoretical,
    interval:
      points.length === request.trials
        ? [Math.max(0, meanBer - radius), Math.min(1, meanBer + radius)]
        : null,
  }
}

/** Bounded storage: at most three groups of 20 scalar trial results. */
export function runSeedStatistics(
  request: StatisticsRequest,
  emit: (message: StatisticsMessage) => void,
): void {
  validateStatisticsRequest(request)
  COMPARISON_DB.forEach((db, snrIndex) => {
    const groups: Record<Modulation, ComparisonPoint[]> = {
      BPSK: [],
      QPSK: [],
      '16QAM': [],
    }
    for (let trial = 0; trial < request.trials; trial++) {
      for (const modulation of MODULATIONS) {
        groups[modulation].push(
          simulateComparisonPoint(
            modulation,
            db,
            request.bits,
            statisticsSeed(request.seed, trial, snrIndex),
          ),
        )
        emit({
          type: 'summary',
          summary: summarizeTrials(groups[modulation], request),
        })
      }
    }
  })
  emit({ type: 'done' })
}
