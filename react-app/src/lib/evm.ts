export type ReferenceSample = number | { i: number; q: number }
export interface EvmResult {
  rms: number
  percent: number
  db: number | null
}

/** Data-aided RMS EVM, average actual reference power; no gain/phase correction. */
export function measureEvm(
  reference: readonly ReferenceSample[],
  received: readonly ReferenceSample[],
): EvmResult {
  if (!reference.length || reference.length !== received.length)
    throw new Error('EVM 需要长度相同且非空的参考与接收序列。')
  let signalEnergy = 0
  let errorEnergy = 0
  for (let index = 0; index < reference.length; index++) {
    const s = reference[index],
      r = received[index]
    const si = typeof s === 'number' ? s : s.i
    const sq = typeof s === 'number' ? 0 : s.q
    const ri = typeof r === 'number' ? r : r.i
    const rq = typeof r === 'number' ? 0 : r.q
    if (![si, sq, ri, rq].every(Number.isFinite))
      throw new Error('EVM 采样必须为有限数。')
    signalEnergy += si * si + sq * sq
    errorEnergy += (ri - si) ** 2 + (rq - sq) ** 2
  }
  if (
    !(signalEnergy > 0) ||
    !Number.isFinite(signalEnergy) ||
    !Number.isFinite(errorEnergy)
  )
    throw new Error('EVM 参考能量必须为正且可计算。')
  const rms = Math.sqrt(errorEnergy / signalEnergy)
  if (!Number.isFinite(rms * 100)) throw new Error('EVM 超出可计算范围。')
  return {
    rms,
    percent: rms * 100,
    db: rms === 0 ? null : 20 * Math.log10(rms),
  }
}
