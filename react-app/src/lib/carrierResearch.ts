import {
  buildPilotLayout,
  fitPilotOls,
  pilotGcd,
  searchCost,
  searchPilots,
  RESEARCH_LAYOUTS,
  type PilotLayoutKind,
  type SearchFit,
} from './pilotSearch.js'
import { wrapPhase, type PilotObservation } from './pilotEstimator.js'
import { createAwgnSampler } from './signallab.js'
import {
  estimationDataSymbol,
  estimationWidth,
  trainingSymbol,
} from './carrierEstimation.js'
import { rotateCarrier } from './carrierOffset.js'
import { decodeQam16Axis } from './qam16.js'
import {
  COMPARISON_DB,
  MODULATIONS,
  type Modulation,
} from './modulationComparison.js'

import { berInterval, type BerInterval } from './berSweep.js'

export const RESEARCH_ENGINE = 'carrier-research-v11.1' as const
export const RESEARCH_BUDGET = 50_000_000
export const CALIBRATION_TRIALS = 20
export const RESEARCH_SEED_RULE =
  'statisticsSeed(base + (stage=evaluation ? 0x40000000 : 0), trial, full-grid snrIndex) mod 2^32; absolute-symbol I/Q draws; BPSK Q XOR 0x9e3779b9'
export type ResearchStage = 'calibration' | 'evaluation'
export const RESEARCH_METHODS = ['ols', 'ml'] as const
export interface ResearchLayout {
  kind: PilotLayoutKind
  spacing: number
}
export interface ResearchPlan {
  frameSymbols: number
  modulation: Modulation
  ebN0Db: number
  phaseDeg: number
  frequency: number
  seed: number
  trials: number
  layouts: ResearchLayout[]
  noiseEnabled: boolean
}
export interface ResearchMetric {
  bits: number
  errors: number
  ber: number
  evmRms: number
}
export interface ResearchOutcome {
  fit: SearchFit
  all: ResearchMetric | null
  common: ResearchMetric | null
  acquired: boolean
  frequencyError: number | null
  phaseErrorDeg: number | null
  phaseRms: number | null
  branchChanges: number | null
  aliasClassError: boolean | null
}
export interface ResearchArm {
  id: string
  pilots: number
  gcd: number
  overhead: number
  pilotEnergy: number
  dataEnergy: number
  totalEnergy: number
  raw: { all: ResearchMetric; common: ResearchMetric }
  ideal: { all: ResearchMetric; common: ResearchMetric }
  ols: ResearchOutcome
  ml: ResearchOutcome
}
export interface ResearchTrial {
  stage: ResearchStage
  index: number
  seed: number
  arms: ResearchArm[]
}
export interface Confusion {
  tp: number
  fp: number
  fn: number
  tn: number
}
export interface MethodSummary {
  total: number
  valid: number
  failures: number
  failureInterval: BerInterval
  meanBer: number | null
  meanCommonBer: number | null
  meanEvm: number | null
  frequencyRmse: number | null
  phaseRmseDeg: number | null
  p95FrequencyError: number | null
  branchErrorFrames: number | null
  branchLabelled: number
  branchInterval: BerInterval | null
  aliasErrorFrames: number
  aliasLabelled: number
  aliasInterval: BerInterval | null
  threshold: number | null
  accepted: number | null
  acceptedMeanBer: number | null
  confusion: Confusion | null
  roc: { threshold: number; fpr: number | null; tpr: number | null }[]
}
export interface ResearchSummary {
  id: string
  pilots: number
  overhead: number
  gcd: number
  methods: { ols: MethodSummary; ml: MethodSummary }
  pairedCommonBerDifference: { mean: number; interval: [number, number] } | null
}
export interface ResearchResult {
  engineVersion: typeof RESEARCH_ENGINE
  seedRule: typeof RESEARCH_SEED_RULE
  plan: ResearchPlan
  calibration: ResearchTrial[]
  evaluation: ResearchTrial[]
  summary: ResearchSummary[]
}
export type ResearchMessage =
  | { type: 'trial'; trial: ResearchTrial; completed: number; total: number }
  | { type: 'done'; result: ResearchResult }
  | { type: 'error'; message: string }
export function defaultResearchPlan(): ResearchPlan {
  return {
    frameSymbols: 513,
    modulation: 'QPSK',
    ebN0Db: 0,
    phaseDeg: 37,
    frequency: 0.001,
    seed: 42,
    trials: 20,
    layouts: [
      { kind: 'uniform', spacing: 16 },
      { kind: 'shifted', spacing: 16 },
    ],
    noiseEnabled: true,
  }
}
export const researchLayoutId = (layout: ResearchLayout) =>
  `${layout.kind}-L${layout.spacing}`
export function researchSeeds(p: ResearchPlan, stage: ResearchStage): number[] {
  return Array.from(
    { length: stage === 'calibration' ? 20 : p.trials },
    (_, t) =>
      (p.seed +
        (stage === 'evaluation' ? 0x40000000 : 0) +
        t * 10 +
        COMPARISON_DB.findIndex((n) => n === p.ebN0Db)) >>>
      0,
  )
}
export function researchOperations(p: ResearchPlan): number {
  return (
    (20 + p.trials) *
    p.layouts.reduce((s, l) => {
      const indices = buildPilotLayout(p.frameSymbols, l.spacing, l.kind)
      return s + searchCost(indices) + indices.length
    }, 0)
  )
}
export function validateResearchPlan(
  value: unknown,
  maxOperations = RESEARCH_BUDGET,
): asserts value is ResearchPlan {
  if (!value || typeof value !== 'object') throw new Error('研究方案无效。')
  const p = value as ResearchPlan
  if (
    ![257, 513, 1025, 2049].includes(p.frameSymbols) ||
    !MODULATIONS.includes(p.modulation) ||
    !COMPARISON_DB.some((n) => n === p.ebN0Db) ||
    !Number.isFinite(p.phaseDeg) ||
    Math.abs(p.phaseDeg) > 180 ||
    !Number.isFinite(p.frequency) ||
    p.frequency < -0.5 ||
    p.frequency >= 0.5 ||
    !Number.isInteger(p.seed) ||
    p.seed < 0 ||
    p.seed > 0xffffffff ||
    ![20, 200].includes(p.trials) ||
    typeof p.noiseEnabled !== 'boolean' ||
    !Array.isArray(p.layouts) ||
    p.layouts.length < 1 ||
    p.layouts.length > 12 ||
    p.layouts.some(
      (l) =>
        !l ||
        !RESEARCH_LAYOUTS.includes(l.kind) ||
        ![8, 16, 32, 64].includes(l.spacing),
    ) ||
    new Set(p.layouts.map(researchLayoutId)).size !== p.layouts.length
  )
    throw new Error(
      '研究参数无效：固定帧257/513/1025/2049，评估20或200次，最多12个不重复布局。',
    )
  const seeds = [
    ...researchSeeds(p, 'calibration'),
    ...researchSeeds(p, 'evaluation'),
  ]
  const streams =
    p.modulation === 'BPSK'
      ? [...seeds, ...seeds.map((s) => (s ^ 0x9e3779b9) >>> 0)]
      : seeds
  if (new Set(streams).size !== streams.length)
    throw new Error('校准和评估噪声种子发生重叠。')
  if (researchOperations(p) > maxOperations)
    throw new Error(
      '研究超出复数乘加预算；请减少帧长或布局，长确认实验使用离线分块脚本。',
    )
}
export function makeResearchFrames(p: ResearchPlan, seed: number) {
  const N = p.frameSymbols,
    k = estimationWidth(p.modulation),
    noise = createAwgnSampler(p.ebN0Db, seed),
    qNoise = createAwgnSampler(p.ebN0Db, (seed ^ 0x9e3779b9) >>> 0),
    ni = new Float64Array(N),
    nq = new Float64Array(N),
    training = trainingSymbol(p.modulation)
  for (let n = 0; n < N; n++) {
    ni[n] = p.noiseEnabled ? noise(0) : 0
    nq[n] = p.noiseEnabled ? (k === 1 ? qNoise(0) : noise(0)) : 0
  }
  const masks = p.layouts.map(
    (l) => new Set(buildPilotLayout(N, l.spacing, l.kind)),
  )
  const commonIndices = Array.from({ length: N }, (_, n) => n).filter((n) =>
    masks.every((mask) => !mask.has(n)),
  )
  const arms = p.layouts.map((layout, m) => {
    const i = new Float64Array(N),
      q = new Float64Array(N),
      pilots: PilotObservation[] = [],
      dataIndices: number[] = []
    let dataEnergy = 0
    for (let n = 0; n < N; n++) {
      const pilot = masks[m].has(n),
        tx = pilot ? training : estimationDataSymbol(p.modulation, n),
        rx = rotateCarrier(tx.i, tx.q, p.phaseDeg, p.frequency, n)
      i[n] = rx.i + ni[n]
      q[n] = rx.q + nq[n]
      if (pilot) pilots.push({ index: n, pi: tx.i, pq: tx.q, i: i[n], q: q[n] })
      else {
        dataIndices.push(n)
        dataEnergy += tx.i ** 2 + tx.q ** 2
      }
    }
    return {
      id: researchLayoutId(layout),
      i,
      q,
      pilots,
      dataIndices,
      dataEnergy,
      pilotEnergy: pilots.length * k,
    }
  })
  return { arms, commonIndices }
}
function metric(
  p: ResearchPlan,
  frame: { i: Float64Array; q: Float64Array },
  indices: number[],
  phase: number,
  frequency: number,
): ResearchMetric {
  let errors = 0,
    errorEnergy = 0,
    energy = 0
  const hamming = [0, 1, 1, 2],
    k = estimationWidth(p.modulation)
  for (const n of indices) {
    const tx = estimationDataSymbol(p.modulation, n),
      rx = rotateCarrier(frame.i[n], frame.q[n], -phase, -frequency, n)
    energy += tx.i ** 2 + tx.q ** 2
    errorEnergy += (rx.i - tx.i) ** 2 + (rx.q - tx.q) ** 2
    if (k === 4)
      errors +=
        hamming[decodeQam16Axis(tx.i) ^ decodeQam16Axis(rx.i)] +
        hamming[decodeQam16Axis(tx.q) ^ decodeQam16Axis(rx.q)]
    else {
      errors += Number(tx.i >= 0 !== rx.i >= 0)
      if (k === 2) errors += Number(tx.q >= 0 !== rx.q >= 0)
    }
  }
  const bits = indices.length * k
  return {
    bits,
    errors,
    ber: errors / bits,
    evmRms: Math.sqrt(errorEnergy / energy),
  }
}
function outcome(
  p: ResearchPlan,
  frame: ReturnType<typeof makeResearchFrames>['arms'][number],
  common: number[],
  fit: SearchFit,
): ResearchOutcome {
  if (fit.status === 'failed')
    return {
      fit,
      all: null,
      common: null,
      acquired: false,
      frequencyError: null,
      phaseErrorDeg: null,
      phaseRms: null,
      branchChanges: null,
      aliasClassError: null,
    }
  const frequencyError = fit.frequency - p.frequency,
    phaseErrorDeg =
      (wrapPhase(fit.phaseRad - (p.phaseDeg * Math.PI) / 180) * 180) / Math.PI
  const phaseRms = Math.sqrt(
    frame.dataIndices.reduce(
      (s, n) =>
        s +
        wrapPhase(
          fit.phaseRad -
            (p.phaseDeg * Math.PI) / 180 +
            2 * Math.PI * frequencyError * n,
        ) **
          2,
      0,
    ) / frame.dataIndices.length,
  )
  let branchChanges: number | null = null
  if (fit.trace) {
    let previous: number | undefined
    branchChanges = 0
    frame.pilots.forEach((obs, m) => {
      const truth =
          (p.phaseDeg * Math.PI) / 180 + 2 * Math.PI * p.frequency * obs.index,
        angle = Math.atan2(
          obs.q * obs.pi - obs.i * obs.pq,
          obs.i * obs.pi + obs.q * obs.pq,
        ),
        noise = wrapPhase(angle - truth),
        branch = Math.round((fit.trace![m] - truth - noise) / (2 * Math.PI))
      if (previous !== undefined && previous !== branch) branchChanges!++
      previous = branch
    })
  }
  const projected: SearchFit = {
    status: 'ok',
    phaseRad: fit.phaseRad,
    frequency: fit.frequency,
    period: fit.period,
    coherenceDeficit: fit.coherenceDeficit,
    peakRatio: fit.peakRatio,
    gridSize: fit.gridSize,
    operations: fit.operations,
    boundaryHit: fit.boundaryHit,
  }
  return {
    fit: projected,
    all: metric(
      p,
      frame,
      frame.dataIndices,
      (fit.phaseRad * 180) / Math.PI,
      fit.frequency,
    ),
    common: metric(
      p,
      frame,
      common,
      (fit.phaseRad * 180) / Math.PI,
      fit.frequency,
    ),
    acquired:
      Math.abs(frequencyError) * (p.frameSymbols - 1) <= 1 / 8 &&
      Math.abs(phaseErrorDeg) <= 22.5,
    frequencyError,
    phaseErrorDeg,
    phaseRms,
    branchChanges,
    aliasClassError:
      fit.period < 1 &&
      Math.round((p.frequency - fit.frequency) / fit.period) !== 0,
  }
}
export function simulateResearchTrial(
  p: ResearchPlan,
  stage: ResearchStage,
  index: number,
): ResearchTrial {
  const seed = researchSeeds(p, stage)[index]
  if (seed === undefined) throw new Error('研究试验索引无效。')
  const frames = makeResearchFrames(p, seed)
  return {
    stage,
    index,
    seed,
    arms: frames.arms.map((frame) => ({
      id: frame.id,
      pilots: frame.pilots.length,
      gcd: pilotGcd(frame.pilots.map((p) => p.index)),
      overhead: frame.pilots.length / p.frameSymbols,
      pilotEnergy: frame.pilotEnergy,
      dataEnergy: frame.dataEnergy,
      totalEnergy: frame.dataEnergy + frame.pilotEnergy,
      raw: {
        all: metric(p, frame, frame.dataIndices, 0, 0),
        common: metric(p, frame, frames.commonIndices, 0, 0),
      },
      ideal: {
        all: metric(p, frame, frame.dataIndices, p.phaseDeg, p.frequency),
        common: metric(p, frame, frames.commonIndices, p.phaseDeg, p.frequency),
      },
      ols: outcome(p, frame, frames.commonIndices, fitPilotOls(frame.pilots)),
      ml: outcome(p, frame, frames.commonIndices, searchPilots(frame.pilots)),
    })),
  }
}
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const quantile = (values: number[], fraction: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * fraction) - 1)
      ]
    : null
function confusion(values: ResearchOutcome[], threshold: number): Confusion {
  const result = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const v of values) {
    const warned =
      v.fit.status === 'failed' || v.fit.coherenceDeficit > threshold
    if (warned) {
      if (v.acquired) result.fp++
      else result.tp++
    } else if (v.acquired) result.tn++
    else result.fn++
  }
  return result
}
export function summarizeResearch(
  p: ResearchPlan,
  calibration: ResearchTrial[],
  evaluation: ResearchTrial[],
): ResearchSummary[] {
  if (calibration.length !== 20 || evaluation.length !== p.trials)
    throw new Error('不完整研究不能产生固定样本区间。')
  return p.layouts.map((layout, a) => {
    const methods = Object.fromEntries(
      RESEARCH_METHODS.map((method) => {
        const values = evaluation.map((t) => t.arms[a][method]),
          calibrated = calibration
            .map((t) => t.arms[a][method])
            .filter((v) => v.acquired && v.fit.status === 'ok')
            .map((v) => (v.fit.status === 'ok' ? v.fit.coherenceDeficit : 0)),
          threshold = quantile(calibrated, 0.9),
          valid = values.filter((v) => v.fit.status === 'ok'),
          accepted =
            threshold === null
              ? null
              : values.filter(
                  (v) =>
                    v.fit.status === 'ok' &&
                    v.fit.coherenceDeficit <= threshold,
                ),
          failures = values.filter((v) => !v.acquired).length,
          frequencyRmse = mean(valid.map((v) => v.frequencyError! ** 2)),
          phaseRmse = mean(valid.map((v) => v.phaseErrorDeg! ** 2))
        const row: MethodSummary = {
          total: p.trials,
          valid: valid.length,
          failures,
          failureInterval: berInterval(failures, p.trials),
          meanBer: mean(valid.map((v) => v.all!.ber)),
          meanCommonBer: mean(valid.map((v) => v.common!.ber)),
          meanEvm: mean(valid.map((v) => v.all!.evmRms)),
          frequencyRmse:
            frequencyRmse === null ? null : Math.sqrt(frequencyRmse),
          phaseRmseDeg: phaseRmse === null ? null : Math.sqrt(phaseRmse),
          p95FrequencyError: quantile(
            valid.map((v) => Math.abs(v.frequencyError!)),
            0.95,
          ),
          branchErrorFrames:
            method === 'ols'
              ? values.filter((v) => (v.branchChanges ?? 0) > 0).length
              : null,
          branchLabelled: values.filter((v) => v.branchChanges !== null).length,
          branchInterval: values.some((v) => v.branchChanges !== null)
            ? berInterval(
                values.filter((v) => (v.branchChanges ?? 0) > 0).length,
                values.filter((v) => v.branchChanges !== null).length,
              )
            : null,
          aliasErrorFrames: values.filter((v) => v.aliasClassError).length,
          aliasLabelled: values.filter((v) => v.aliasClassError !== null)
            .length,
          aliasInterval: valid.length
            ? berInterval(
                values.filter((v) => v.aliasClassError).length,
                valid.length,
              )
            : null,
          threshold,
          accepted: accepted?.length ?? null,
          acceptedMeanBer:
            accepted === null ? null : mean(accepted.map((v) => v.all!.ber)),
          confusion: threshold === null ? null : confusion(values, threshold),
          roc: [0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1].map((t) => {
            const c = confusion(values, t)
            return {
              threshold: t,
              fpr: c.fp + c.tn ? c.fp / (c.fp + c.tn) : null,
              tpr: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null,
            }
          }),
        }
        return [method, row]
      }),
    ) as ResearchSummary['methods']
    const differences = evaluation
        .filter((t) => t.arms[a].ml.common && t.arms[a].ols.common)
        .map((t) => t.arms[a].ml.common!.ber - t.arms[a].ols.common!.ber),
      delta = mean(differences),
      radius = Math.sqrt((2 * Math.log(40)) / p.trials)
    return {
      id: researchLayoutId(layout),
      pilots: evaluation[0].arms[a].pilots,
      overhead: evaluation[0].arms[a].overhead,
      gcd: evaluation[0].arms[a].gcd,
      methods,
      pairedCommonBerDifference:
        differences.length === p.trials && delta !== null
          ? {
              mean: delta,
              interval: [
                Math.max(-1, delta - radius),
                Math.min(1, delta + radius),
              ],
            }
          : null,
    }
  })
}
/** Validate bounded checkpoint prefix without replaying channel/noise or trusting supplied summaries. */
export function validateResearchPrefix(
  p: ResearchPlan,
  value: unknown,
  startIndex = 0,
): asserts value is ResearchTrial[] {
  if (
    !Number.isInteger(startIndex) ||
    startIndex < 0 ||
    !Array.isArray(value) ||
    startIndex + value.length > 20 + p.trials
  )
    throw new Error('研究检查点长度无效。')
  const masks = p.layouts.map((l) =>
      buildPilotLayout(p.frameSymbols, l.spacing, l.kind),
    ),
    union = new Set(masks.flat()),
    k = estimationWidth(p.modulation),
    commonBits = (p.frameSymbols - union.size) * k
  let commonEnergy = 0
  for (let n = 0; n < p.frameSymbols; n++)
    if (!union.has(n)) {
      const tx = estimationDataSymbol(p.modulation, n)
      commonEnergy += tx.i ** 2 + tx.q ** 2
    }
  for (const [offset, trial] of value.entries()) {
    const m = startIndex + offset
    const stage = m < 20 ? 'calibration' : 'evaluation',
      index = m < 20 ? m : m - 20
    if (
      !trial ||
      trial.stage !== stage ||
      trial.index !== index ||
      trial.seed !== researchSeeds(p, stage)[index] ||
      !Array.isArray(trial.arms) ||
      trial.arms.length !== p.layouts.length
    )
      throw new Error('研究检查点顺序、种子或布局无效。')
    for (const [a, arm] of (trial as ResearchTrial).arms.entries()) {
      const indices = masks[a],
        data = new Set(indices),
        bits = (p.frameSymbols - indices.length) * k
      let energy = 0
      for (let n = 0; n < p.frameSymbols; n++)
        if (!data.has(n)) {
          const tx = estimationDataSymbol(p.modulation, n)
          energy += tx.i ** 2 + tx.q ** 2
        }
      if (
        !arm ||
        arm.id !== researchLayoutId(p.layouts[a]) ||
        arm.pilots !== indices.length ||
        arm.gcd !== pilotGcd(indices) ||
        arm.overhead !== indices.length / p.frameSymbols ||
        arm.pilotEnergy !== indices.length * k ||
        Math.abs(arm.dataEnergy - energy) > 1e-8 ||
        arm.totalEnergy !== arm.dataEnergy + arm.pilotEnergy
      )
        throw new Error('研究资源统计无效。')
      const checkMetric = (v: ResearchMetric | null, expected: number) => {
        if (
          !v ||
          v.bits !== expected ||
          !Number.isInteger(v.errors) ||
          v.errors < 0 ||
          v.errors > expected ||
          v.ber !== v.errors / expected ||
          !Number.isFinite(v.evmRms) ||
          v.evmRms < 0
        )
          throw new Error('研究BER/EVM无效。')
      }
      const checkSubset = (all: ResearchMetric, common: ResearchMetric) => {
        if (
          common.errors > all.errors ||
          all.errors - common.errors > all.bits - common.bits
        )
          throw new Error('公共数据不是全部数据的有效子集。')
        if (
          common.evmRms ** 2 * commonEnergy >
          all.evmRms ** 2 * energy +
            1e-8 * Math.max(1, energy * all.evmRms ** 2)
        )
          throw new Error('公共数据误差能量超过全部数据误差能量。')
      }
      for (const v of [arm.raw, arm.ideal]) {
        if (!v) throw new Error('研究基准结果缺失。')
        checkMetric(v.all, bits)
        checkMetric(v.common, commonBits)
        checkSubset(v.all, v.common)
      }
      if (a > 0)
        for (const baseline of ['raw', 'ideal'] as const) {
          const anchor = (trial as ResearchTrial).arms[0][baseline].common,
            current = arm[baseline].common
          if (
            anchor.bits !== current.bits ||
            anchor.errors !== current.errors ||
            Math.abs(anchor.evmRms - current.evmRms) > 1e-10
          )
            throw new Error('跨布局公共接收数据未保持配对。')
        }
      for (const method of RESEARCH_METHODS) {
        const out = arm[method]
        if (!out || !out.fit) throw new Error('研究估计结果缺失。')
        if (out.fit.status === 'failed') {
          if (
            typeof out.fit.reason !== 'string' ||
            out.fit.reason.length > 200 ||
            out.all !== null ||
            out.common !== null ||
            out.acquired !== false ||
            [
              out.frequencyError,
              out.phaseErrorDeg,
              out.phaseRms,
              out.branchChanges,
              out.aliasClassError,
            ].some((v) => v !== null)
          )
            throw new Error('失败结果格式无效。')
          continue
        }
        const f = out.fit,
          df = f.frequency - p.frequency,
          dp =
            (wrapPhase(f.phaseRad - (p.phaseDeg * Math.PI) / 180) * 180) /
            Math.PI
        const grid = searchCost(indices) / indices.length - 141
        const refinements = (f.operations / indices.length - grid - 1) / 35
        const regular = indices.every(
          (n, j) => n === indices[0] + j * (indices[1] - indices[0]),
        )
        if (
          method === 'ml'
            ? f.gridSize !== grid ||
              !Number.isInteger(refinements) ||
              refinements < 1 ||
              refinements > 4 ||
              f.frequency < -f.period / 2 - 1e-12 ||
              f.frequency >= f.period / 2 + 1e-12
            : f.gridSize !== 0 ||
              f.operations !== indices.length ||
              f.peakRatio !== null ||
              f.boundaryHit !== false ||
              (regular && Math.abs(f.frequency) > f.period / 2 + 1e-12)
        )
          throw new Error('研究求解器网格、计数或主值范围无效。')
        if (
          f.status !== 'ok' ||
          ![
            f.phaseRad,
            f.frequency,
            f.period,
            f.coherenceDeficit,
            f.gridSize,
            f.operations,
          ].every(Number.isFinite) ||
          Math.abs(f.phaseRad) > Math.PI ||
          Math.abs(f.frequency) > 0.5 ||
          f.period !== 1 / arm.gcd ||
          f.coherenceDeficit < 0 ||
          f.coherenceDeficit > 1 ||
          typeof f.boundaryHit !== 'boolean' ||
          (f.peakRatio !== null &&
            (!Number.isFinite(f.peakRatio) || f.peakRatio < 0)) ||
          f.operations < 0 ||
          f.operations > searchCost(indices) ||
          !Number.isInteger(f.operations) ||
          f.gridSize < 0 ||
          !Number.isInteger(f.gridSize) ||
          out.frequencyError !== df ||
          out.phaseErrorDeg !== dp ||
          !Number.isFinite(out.phaseRms) ||
          out.phaseRms! < 0 ||
          out.phaseRms! > Math.PI ||
          out.acquired !==
            (Math.abs(df) * (p.frameSymbols - 1) <= 1 / 8 &&
              Math.abs(dp) <= 22.5) ||
          out.aliasClassError !==
            (f.period < 1 &&
              Math.round((p.frequency - f.frequency) / f.period) !== 0) ||
          (method === 'ml'
            ? out.branchChanges !== null
            : !Number.isInteger(out.branchChanges) ||
              out.branchChanges! < 0 ||
              out.branchChanges! >= indices.length)
        )
          throw new Error('研究参数误差或诊断无效。')
        checkMetric(out.all, bits)
        checkMetric(out.common, commonBits)
        checkSubset(out.all!, out.common!)
        let squared = 0,
          count = 0
        for (let n = 0; n < p.frameSymbols; n++)
          if (!data.has(n)) {
            squared +=
              wrapPhase(
                f.phaseRad -
                  (p.phaseDeg * Math.PI) / 180 +
                  2 * Math.PI * df * n,
              ) ** 2
            count++
          }
        if (Math.abs(out.phaseRms! - Math.sqrt(squared / count)) > 1e-10)
          throw new Error('剩余相位RMS与参数不一致。')
      }
    }
  }
}
export function runCarrierResearch(
  p: ResearchPlan,
  emit: (message: ResearchMessage) => void,
  options: { resume?: ResearchTrial[]; maxOperations?: number } = {},
): ResearchResult {
  validateResearchPlan(p, options.maxOperations)
  const trials = structuredClone(options.resume ?? [])
  validateResearchPrefix(p, trials)
  for (let m = trials.length; m < 20 + p.trials; m++) {
    const trial = simulateResearchTrial(
      p,
      m < 20 ? 'calibration' : 'evaluation',
      m < 20 ? m : m - 20,
    )
    trials.push(trial)
    emit({ type: 'trial', trial, completed: m + 1, total: 20 + p.trials })
  }
  const calibration = trials.slice(0, 20),
    evaluation = trials.slice(20),
    result: ResearchResult = {
      engineVersion: RESEARCH_ENGINE,
      seedRule: RESEARCH_SEED_RULE,
      plan: structuredClone(p),
      calibration,
      evaluation,
      summary: summarizeResearch(p, calibration, evaluation),
    }
  emit({ type: 'done', result })
  return result
}
