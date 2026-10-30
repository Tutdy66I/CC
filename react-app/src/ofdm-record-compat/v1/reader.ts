import {
  canonicalOfdm,
  freezeOfdmCombPlan,
  ofdmHash,
} from '../../lib/ofdmCombProtocol.js'
import { summarizeOfdmComb } from '../../lib/ofdmCombResearch.js'
import {
  OFDM_COMB_RECORD_BYTES,
  validateOfdmCombTrial,
  type OfdmCombRecord,
} from '../../lib/ofdmCombResearchRecord.js'

export const POLICY = 'ofdm-comb-read-compat-v1' as const
const THEORY_A = 2.267395844454416e-19
const THEORY_B = 2.2673958444544166e-19
const keys = (v: unknown, expected: string[]) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    JSON.stringify(Object.keys(v).sort()) !==
      JSON.stringify([...expected].sort())
  )
    throw new Error('记录结构不符合协议。')
}

// JSON.parse alone silently accepts duplicate keys. Scan the already parsed JSON
// grammar independently and reject duplicate decoded keys at every object level.
function rejectDuplicateKeys(text: string) {
  let i = 0
  const ws = () => {
    while (/\s/.test(text[i] ?? '') && i < text.length) i++
  }
  const str = () => {
    const start = i++
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2
        continue
      }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i)) as string
    }
    throw new Error('JSON 字符串无效。')
  }
  const value = (depth: number): void => {
    if (depth > 128) throw new Error('JSON 嵌套过深。')
    ws()
    if (text[i] === '{') {
      i++
      ws()
      const seen = new Set<string>()
      if (text[i] === '}') {
        i++
        return
      }
      while (true) {
        ws()
        if (text[i] !== '"') throw new Error('JSON 对象无效。')
        const k = str()
        if (seen.has(k)) throw new Error('JSON 存在重复键。')
        seen.add(k)
        ws()
        if (text[i++] !== ':') throw new Error('JSON 对象无效。')
        value(depth + 1)
        ws()
        const c = text[i++]
        if (c === '}') return
        if (c !== ',') throw new Error('JSON 对象无效。')
      }
    }
    if (text[i] === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return
      }
      while (true) {
        value(depth + 1)
        ws()
        const c = text[i++]
        if (c === ']') return
        if (c !== ',') throw new Error('JSON 数组无效。')
      }
    }
    if (text[i] === '"') {
      str()
      return
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      )
    if (!match) throw new Error('JSON 值无效。')
    i += match[0].length
  }
  value(0)
  ws()
  if (i !== text.length) throw new Error('JSON 尾部无效。')
}

export type Comparison = {
  path: string
  original: number
  recomputed: number
  ulpDistance: 1
  rule: 'qpsk-awgn-16-data-eb'
}
export type Validation = {
  originalBytes: Uint8Array
  fileSha256: string
  record: OfdmCombRecord
  policyVersion: typeof POLICY
  comparisons: Comparison[]
  provenance: 'unverified-source'
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

export async function validateOriginal(bytes: Uint8Array): Promise<Validation> {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > OFDM_COMB_RECORD_BYTES
  )
    throw new Error('文件大小无效。')
  const originalBytes = new Uint8Array(bytes)
  const fileSha256 = await digest(originalBytes)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(originalBytes)
  const raw: unknown = JSON.parse(text)
  rejectDuplicateKeys(text)
  keys(raw, [
    'engineVersion',
    'randomVersion',
    'protocolHash',
    'plan',
    'schemaVersion',
    'status',
    'sourceFingerprint',
    'runtimeFingerprint',
    'trials',
    'integrityHash',
    'summary',
  ])
  const r = raw as OfdmCombRecord
  if (
    r.engineVersion !== 'ofdm-v13.2' ||
    r.schemaVersion !== 1 ||
    r.status !== 'complete' ||
    !Array.isArray(r.trials) ||
    !Array.isArray(r.summary)
  )
    throw new Error('记录版本或状态不受支持。')
  if (
    !/^[a-f0-9]{64}$/.test(r.integrityHash) ||
    !/^[a-f0-9]{64}$/.test(r.sourceFingerprint) ||
    !/^[a-f0-9]{64}$/.test(r.runtimeFingerprint)
  )
    throw new Error('记录身份格式无效。')
  const { integrityHash, ...payload } = r
  if ((await ofdmHash(payload)) !== integrityHash)
    throw new Error('记录完整性哈希不匹配。')
  keys(r.plan, [
    'fftSize',
    'cp',
    'activeBins',
    'dataSymbols',
    'modulation',
    'taps',
    'channels',
    'ebN0Db',
    'energyBasis',
    'seed',
    'trials',
    'noiseEnabled',
    'pilotLayouts',
  ])
  const frozen = await freezeOfdmCombPlan(r.plan)
  if (
    r.protocolHash !== frozen.protocolHash ||
    r.randomVersion !== frozen.randomVersion ||
    r.trials.length !== r.plan.trials
  )
    throw new Error('协议身份或帧数不匹配。')
  r.plan.taps.forEach((t) => keys(t, ['delay', 'i', 'q', 'power']))
  r.trials.forEach((t, i) => validateOfdmCombTrial(r.plan, t, i))
  const computed = summarizeOfdmComb(frozen, r.trials)
  if (r.summary.length !== computed.length) throw new Error('汇总长度不匹配。')
  const comparisons: Comparison[] = []
  for (let i = 0; i < computed.length; i++) {
    const actual = r.summary[i],
      expected = computed[i]
    keys(actual, Object.keys(expected))
    const { idealTheoryBer: a, ...restA } = actual
    const { idealTheoryBer: b, ...restB } = expected
    if (canonicalOfdm(restA) !== canonicalOfdm(restB))
      throw new Error(`汇总统计不匹配：${i}`)
    if (Object.is(a, b) || (a === 0 && b === 0)) continue
    const cell = r.trials[0].cells[Math.floor(i / 6)]
    if (
      r.plan.modulation !== 'QPSK' ||
      r.plan.energyBasis !== 'data-eb' ||
      !r.plan.noiseEnabled ||
      !cell ||
      cell.channel !== 'awgn' ||
      cell.ebN0Db !== 16 ||
      !cell.cpSufficient ||
      !(
        (a === THEORY_A && b === THEORY_B) ||
        (a === THEORY_B && b === THEORY_A)
      )
    )
      throw new Error(`理论值不符合兼容规则：${i}`)
    comparisons.push({
      path: `summary[${i}].idealTheoryBer`,
      original: a,
      recomputed: b,
      ulpDistance: 1,
      rule: 'qpsk-awgn-16-data-eb',
    })
  }
  return {
    originalBytes,
    fileSha256,
    record: r,
    policyVersion: POLICY,
    comparisons,
    provenance: 'unverified-source',
  }
}
