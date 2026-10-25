import { MODULATIONS } from './modulationComparison.js'
import { berInterval, type BerInterval } from './berSweep.js'
import { channelBer } from './channelSimulation.js'
import { FADING_RANDOM_PROTOCOL } from './fadingRandom.js'
import type {
  ChannelCell,
  ChannelMethod,
  ChannelMetric,
  ChannelModel,
  ChannelPlan,
  ChannelTrial,
} from './channelTypes.js'

export const CHANNEL_ENGINE = 'flat-channel-v12.1' as const
export const CHANNEL_BUDGET = 50_000_000
export const CHANNEL_RESULT_ROWS = 4_000
export const CHANNEL_RANDOM_RULE =
  'sha256(signallab-channel-rng-v1|seed|frame|role); first 4 LE uint32; xoshiro128**; paired Box-Muller; absolute-symbol data/channel/noise'
export const CHANNEL_METHODS: ChannelMethod[] = ['raw', 'ideal', 'ls']
export interface FrozenChannelPlan {
  engineVersion: typeof CHANNEL_ENGINE
  protocolHash: string
  plan: ChannelPlan
}
export interface ChannelMethodSummary {
  ber: number | null
  commonBer: number | null
  berBounds: [number, number]
  berInterval: [number, number]
  validFrames: number
  failedFrames: number
  frameErrorRate: number | null
  frameErrorInterval: BerInterval | null
  evm: {
    median: number | null
    p90: number | null
    p99: number | null
    max: number | null
    pooledRms: number | null
    validFrames: number
  }
}
export interface ChannelSummary {
  model: ChannelModel
  ebN0Db: number
  pilots: number
  frames: number
  pilotOverhead: number
  expectedLsMse: number
  theoreticalBer: number
  mse: number | null
  nmse: number | null
  deepFadeRate: number
  meanDataEnergy: number
  meanPilotEnergy: number
  meanTotalEnergy: number
  expectedTotalEb: number
  methods: Record<ChannelMethod, ChannelMethodSummary>
  pairedDifference: {
    mean: number | null
    interval: [number, number]
    bootstrap: [number, number] | null
  }
}
export function defaultChannelPlan(): ChannelPlan {
  return {
    frameSymbols: 512,
    modulation: 'QPSK',
    ebN0Db: [0, 4, 8, 12],
    pilotCounts: [16],
    channels: ['awgn', 'rayleigh-block'],
    trials: 200,
    seed: 42,
    energyBasis: 'data-eb',
    noiseEnabled: true,
  }
}

export function channelOperations(p: ChannelPlan): number {
  return (
    p.frameSymbols *
    p.trials *
    p.ebN0Db.length *
    p.pilotCounts.length *
    p.channels.length *
    3
  )
}
export function validateChannelPlan(
  value: unknown,
  budget = CHANNEL_BUDGET,
): asserts value is ChannelPlan {
  if (!value || typeof value !== 'object') throw new Error('信道研究方案无效。')
  const p = value as ChannelPlan
  const sorted = (
    a: unknown,
    min: number,
    max: number,
    integers = false,
  ): a is number[] =>
    Array.isArray(a) &&
    a.length > 0 &&
    a.length <= 8 &&
    a.every(
      (v, i) =>
        Number.isFinite(v) &&
        v >= min &&
        v <= max &&
        (!integers || Number.isInteger(v)) &&
        (i === 0 || v > a[i - 1]),
    )
  if (
    ![128, 256, 512, 1024, 2048, 4096].includes(p.frameSymbols) ||
    !MODULATIONS.includes(p.modulation) ||
    !sorted(p.ebN0Db, -10, 20) ||
    !sorted(p.pilotCounts, 1, p.frameSymbols - 1, true) ||
    !Array.isArray(p.channels) ||
    p.channels.length < 1 ||
    p.channels.length > 3 ||
    p.channels.some(
      (c) => !['awgn', 'rayleigh-block', 'rayleigh-iid'].includes(c),
    ) ||
    new Set(p.channels).size !== p.channels.length ||
    !Number.isInteger(p.trials) ||
    p.trials < 1 ||
    p.trials > 10000 ||
    !Number.isInteger(p.seed) ||
    p.seed < 0 ||
    p.seed > 0xffffffff ||
    !['data-eb', 'total-eb'].includes(p.energyBasis) ||
    typeof p.noiseEnabled !== 'boolean'
  )
    throw new Error(
      '信道参数无效；请核对帧长、递增SNR/导频列表、试验数和uint32种子。',
    )
  if (channelOperations(p) > budget)
    throw new Error('信道研究超出符号路径预算；请使用离线研究脚本。')
  if (
    budget !== Infinity &&
    p.trials * p.channels.length * p.ebN0Db.length * p.pilotCounts.length >
      CHANNEL_RESULT_ROWS
  )
    throw new Error(
      '信道记录或统计工作超出浏览器预算（最多4000场景帧）；请使用离线脚本。',
    )
}
export function normalizeChannelPlan(p: ChannelPlan): ChannelPlan {
  return {
    frameSymbols: p.frameSymbols,
    modulation: p.modulation,
    ebN0Db: [...p.ebN0Db],
    pilotCounts: [...p.pilotCounts],
    channels: [...p.channels],
    trials: p.trials,
    seed: p.seed,
    energyBasis: p.energyBasis,
    noiseEnabled: p.noiseEnabled,
  }
}
export async function channelDigest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')
}
export async function freezeChannelPlan(
  p: ChannelPlan,
  budget = CHANNEL_BUDGET,
): Promise<FrozenChannelPlan> {
  validateChannelPlan(p, budget)
  const plan = normalizeChannelPlan(p)
  return {
    engineVersion: CHANNEL_ENGINE,
    protocolHash: await channelDigest(
      JSON.stringify({
        engineVersion: CHANNEL_ENGINE,
        randomRule: FADING_RANDOM_PROTOCOL,
        statistics:
          'frame-hoeffding95; paired400-frame-bootstrap-lcg1664525-1013904223-percentile-nearest-rank',
        plan,
      }),
    ),
    plan,
  }
}
export function channelCellSpecs(p: ChannelPlan) {
  return p.channels.flatMap((model) =>
    p.ebN0Db.flatMap((ebN0Db) =>
      p.pilotCounts.map((pilots) => ({ model, ebN0Db, pilots })),
    ),
  )
}
const close = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
function checkMetric(m: ChannelMetric, bits: number, energy: number): void {
  if (
    !m ||
    m.bits !== bits ||
    !close(m.signalEnergy, energy) ||
    !(
      m.failure === null ||
      (typeof m.failure === 'string' &&
        m.failure.length > 0 &&
        m.failure.length <= 200)
    )
  )
    throw new Error('信道指标分母或失败原因无效。')
  if (
    m.errors === null
      ? m.ber !== null || m.failure === null
      : !Number.isInteger(m.errors) ||
        m.errors < 0 ||
        m.errors > bits ||
        m.ber !== m.errors / bits
  )
    throw new Error('信道误码统计无效。')
  if (
    m.errorEnergy === null
      ? m.evmRms !== null || m.failure === null
      : !Number.isFinite(m.errorEnergy) ||
        m.errorEnergy < 0 ||
        m.evmRms === null ||
        !close(m.evmRms, Math.sqrt(m.errorEnergy / energy))
  )
    throw new Error('信道EVM统计无效。')
  if (m.failure === null && (m.errors === null || m.errorEnergy === null))
    throw new Error('信道失败状态缺失。')
}
export function validateChannelTrial(
  p: ChannelPlan,
  value: unknown,
  index: number,
): asserts value is ChannelTrial {
  const t = value as ChannelTrial
  const specs = channelCellSpecs(p),
    k = p.modulation === 'BPSK' ? 1 : p.modulation === 'QPSK' ? 2 : 4
  if (
    !t ||
    t.index !== index ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= p.trials ||
    !Array.isArray(t.cells) ||
    t.cells.length !== specs.length
  )
    throw new Error('信道帧顺序或场景数无效。')
  const common = p.frameSymbols - Math.max(...p.pilotCounts)
  for (let a = 0; a < specs.length; a++) {
    const c = t.cells[a],
      s = specs[a],
      D = p.frameSymbols - s.pilots
    const n0 = p.noiseEnabled
      ? (p.energyBasis === 'data-eb' ? 1 : p.frameSymbols / D) /
        10 ** (s.ebN0Db / 10)
      : 0
    const energy = (v: number, n: number) =>
      Number.isFinite(v) &&
      (k < 4
        ? close(v, k * n)
        : v >= 0.8 * n - 1e-8 &&
          v <= 7.2 * n + 1e-8 &&
          close(v / 0.8, Math.round(v / 0.8)))
    if (
      !c ||
      c.model !== s.model ||
      c.ebN0Db !== s.ebN0Db ||
      c.pilots !== s.pilots ||
      c.dataSymbols !== D ||
      c.commonSymbols !== common ||
      !close(c.noisePower, n0) ||
      !energy(c.dataEnergy, D) ||
      !energy(c.commonDataEnergy, common) ||
      c.commonDataEnergy > c.dataEnergy + 1e-8 ||
      !close(c.pilotEnergy, s.pilots * k) ||
      !close(c.totalEnergy, c.dataEnergy + c.pilotEnergy) ||
      !c.hFirst ||
      ![c.hFirst.i, c.hFirst.q, c.hMeanPower].every(Number.isFinite) ||
      c.hMeanPower < 0 ||
      !Number.isInteger(c.deepFadeSymbols) ||
      c.deepFadeSymbols < 0 ||
      c.deepFadeSymbols > D
    )
      throw new Error('信道资源、噪声或真值统计无效。')
    if (
      s.model === 'awgn' &&
      (!close(c.hFirst.i, 1) ||
        !close(c.hFirst.q, 0) ||
        !close(c.hMeanPower, 1) ||
        c.deepFadeSymbols !== 0)
    )
      throw new Error('AWGN基准无效。')
    const h2 = c.hFirst.i ** 2 + c.hFirst.q ** 2
    if (
      s.model === 'rayleigh-block' &&
      (!close(c.hMeanPower, h2) || c.deepFadeSymbols !== (h2 < 0.01 ? D : 0))
    )
      throw new Error('准静态信道统计无效。')
    if (
      c.estimate === null
        ? c.estimationSquaredError !== null
        : ![c.estimate.i, c.estimate.q, c.estimationSquaredError].every(
            (v) => typeof v === 'number' && Number.isFinite(v),
          ) || c.estimationSquaredError! < 0
    )
      throw new Error('信道估计误差无效。')
    if (
      c.estimate &&
      s.model !== 'rayleigh-iid' &&
      !close(
        c.estimationSquaredError!,
        (c.estimate.i - c.hFirst.i) ** 2 + (c.estimate.q - c.hFirst.q) ** 2,
      )
    )
      throw new Error('信道估计误差与真值不符。')
    for (const method of CHANNEL_METHODS) {
      const metrics = c.methods?.[method]
      if (!metrics) throw new Error('信道算法指标缺失。')
      checkMetric(metrics.all, D * k, c.dataEnergy)
      checkMetric(metrics.common, common * k, c.commonDataEnergy)
      const all = metrics.all,
        sub = metrics.common
      if (
        all.errors !== null &&
        sub.errors !== null &&
        (sub.errors > all.errors ||
          all.errors - sub.errors > all.bits - sub.bits)
      )
        throw new Error('公共误码不是数据子集。')
      if (
        all.errorEnergy !== null &&
        sub.errorEnergy !== null &&
        sub.errorEnergy > all.errorEnergy + 1e-8 * Math.max(1, all.errorEnergy)
      )
        throw new Error('公共误差能量超过全部数据。')
    }
    if (
      !Array.isArray(c.preview) ||
      c.preview.length > (index === 0 ? 32 : 0) ||
      c.preview.some(
        (v) =>
          !Number.isInteger(v.index) ||
          v.index < s.pilots ||
          v.index >= p.frameSymbols ||
          [v.tx, v.h, v.received].some(
            (z) => !z || ![z.i, z.q].every(Number.isFinite),
          ) ||
          [v.ideal, v.ls].some(
            (z) => z !== null && (!z || ![z.i, z.q].every(Number.isFinite)),
          ),
      )
    )
      throw new Error('信道预览无效。')
    if (p.energyBasis === 'data-eb') {
      const anchor = t.cells.find(
        (v) => v.model === c.model && v.ebN0Db === c.ebN0Db,
      )
      if (
        anchor &&
        ['raw', 'ideal'].some(
          (m) =>
            JSON.stringify(anchor.methods[m as ChannelMethod].common) !==
            JSON.stringify(c.methods[m as ChannelMethod].common),
        )
      )
        throw new Error('公共数据接收帧未保持配对。')
    }
    const shared = t.cells.find((v) => v.model === c.model)
    const samePayload = t.cells.find((v) => v.pilots === c.pilots)
    const sameChannelData = t.cells.find(
      (v) => v.model === c.model && v.pilots === c.pilots,
    )
    if (
      (shared &&
        (!close(shared.hFirst.i, c.hFirst.i) ||
          !close(shared.hFirst.q, c.hFirst.q))) ||
      (samePayload && !close(samePayload.dataEnergy, c.dataEnergy)) ||
      !close(t.cells[0].commonDataEnergy, c.commonDataEnergy) ||
      (sameChannelData &&
        (!close(sameChannelData.hMeanPower, c.hMeanPower) ||
          sameChannelData.deepFadeSymbols !== c.deepFadeSymbols))
    )
      throw new Error('跨场景信道或数据未保持配对。')
  }
}

const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const quantile = (v: number[], q: number) =>
  v.length
    ? [...v].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * v.length) - 1)]
    : null
// Deliberately separate from channel/data RNG: resampling changes no received frame.
function bootstrapMean(v: number[], seed: number): [number, number] {
  let state = seed >>> 0
  const means: number[] = []
  for (let b = 0; b < 400; b++) {
    let sum = 0
    for (let i = 0; i < v.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      sum += v[Math.floor((state / 4294967296) * v.length)]
    }
    means.push(sum / v.length)
  }
  return [quantile(means, 0.025)!, quantile(means, 0.975)!]
}
function summarizeMethod(
  cells: ChannelCell[],
  method: ChannelMethod,
): ChannelMethodSummary {
  const ms = cells.map((c) => c.methods[method].all),
    valid = ms.filter((m) => m.ber !== null),
    F = cells.length
  const lo = ms.reduce((a, m) => a + (m.ber ?? 0), 0) / F,
    hi = ms.reduce((a, m) => a + (m.ber ?? 1), 0) / F,
    r = Math.sqrt(Math.log(40) / (2 * F))
  const evm = ms.filter((m) => m.evmRms !== null),
    e = evm.map((m) => m.evmRms!)
  const common = cells.map((c) => c.methods[method].common.ber)
  const frameErrors = valid.filter((m) => m.errors! > 0).length
  return {
    ber: valid.length === F ? lo : null,
    commonBer: common.every((v) => v !== null)
      ? average(common as number[])
      : null,
    berBounds: [lo, hi],
    berInterval: [Math.max(0, lo - r), Math.min(1, hi + r)],
    validFrames: valid.length,
    failedFrames: F - valid.length,
    frameErrorRate: valid.length === F ? frameErrors / F : null,
    frameErrorInterval: valid.length === F ? berInterval(frameErrors, F) : null,
    evm: {
      median: quantile(e, 0.5),
      p90: quantile(e, 0.9),
      p99: quantile(e, 0.99),
      max: quantile(e, 1),
      pooledRms:
        evm.length === F
          ? Math.sqrt(
              evm.reduce((a, m) => a + m.errorEnergy!, 0) /
                evm.reduce((a, m) => a + m.signalEnergy, 0),
            )
          : null,
      validFrames: evm.length,
    },
  }
}
export function summarizeChannel(
  p: ChannelPlan,
  trials: ChannelTrial[],
): ChannelSummary[] {
  if (trials.length !== p.trials)
    throw new Error('不完整信道研究不能产生固定样本汇总。')
  return channelCellSpecs(p).map((s, a) => {
    const cells = trials.map((t) => t.cells[a]),
      F = cells.length,
      k = p.modulation === 'BPSK' ? 1 : p.modulation === 'QPSK' ? 2 : 4
    const mse = cells.map((c) => c.estimationSquaredError),
      h = average(cells.map((c) => c.hMeanPower)),
      n0 = cells[0].noisePower
    const diffs = cells.map((c) => {
      const x = c.methods.ls.common.ber,
        y = c.methods.ideal.common.ber
      return x === null || y === null ? null : x - y
    })
    const valid = diffs.filter((v): v is number => v !== null),
      dlo = diffs.reduce<number>((x, v) => x + (v ?? -1), 0) / F,
      dhi = diffs.reduce<number>((x, v) => x + (v ?? 1), 0) / F,
      rad = Math.sqrt((2 * Math.log(40)) / F)
    const meanMse = mse.every((v) => v !== null)
      ? average(mse as number[])
      : null
    const dataDb = 10 * Math.log10(1 / (n0 || Number.MIN_VALUE))
    return {
      ...s,
      frames: F,
      pilotOverhead: s.pilots / p.frameSymbols,
      expectedLsMse:
        s.model === 'rayleigh-iid'
          ? 1 + 1 / s.pilots + n0 / (s.pilots * k)
          : n0 / (s.pilots * k),
      theoreticalBer: p.noiseEnabled
        ? channelBer(p.modulation, s.model, dataDb)
        : 0,
      mse: meanMse,
      nmse: meanMse === null || h === 0 ? null : meanMse / h,
      deepFadeRate:
        cells.reduce((x, c) => x + c.deepFadeSymbols, 0) /
        (F * cells[0].dataSymbols),
      meanDataEnergy: average(cells.map((c) => c.dataEnergy)),
      meanPilotEnergy: average(cells.map((c) => c.pilotEnergy)),
      meanTotalEnergy: average(cells.map((c) => c.totalEnergy)),
      expectedTotalEb: p.frameSymbols / (p.frameSymbols - s.pilots),
      methods: {
        raw: summarizeMethod(cells, 'raw'),
        ideal: summarizeMethod(cells, 'ideal'),
        ls: summarizeMethod(cells, 'ls'),
      },
      pairedDifference: {
        mean: valid.length === F ? average(valid) : null,
        interval: [Math.max(-1, dlo - rad), Math.min(1, dhi + rad)] as [
          number,
          number,
        ],
        bootstrap:
          valid.length === F
            ? bootstrapMean(valid, (p.seed + a * 2654435761) >>> 0)
            : null,
      },
    }
  })
}
