import { addAwgn, calculateBer } from './signallab.js'
import type { QpskSymbol } from './qpsk.js'

export const QAM16_SCALE = Math.sqrt(2 / 5)
export const QAM16_LEVELS = [-3, -1, 3, 1] as const

export function modulateQam16(bits: readonly number[]): QpskSymbol[] {
  if (
    !bits.length ||
    bits.length % 4 !== 0 ||
    bits.some((bit) => bit !== 0 && bit !== 1)
  )
    throw new Error('16QAM 需要非空、4 的倍数长度的二进制比特流，不自动补位。')
  return Array.from({ length: bits.length / 4 }, (_, index) => ({
    i: QAM16_LEVELS[bits[index * 4] * 2 + bits[index * 4 + 1]] * QAM16_SCALE,
    q:
      QAM16_LEVELS[bits[index * 4 + 2] * 2 + bits[index * 4 + 3]] * QAM16_SCALE,
  }))
}

/** Returns the two-bit Gray code as an integer 0..3; ties choose the upper region. */
export function decodeQam16Axis(value: number): number {
  if (!Number.isFinite(value)) throw new Error('16QAM 采样必须为有限数。')
  return value < -2 * QAM16_SCALE
    ? 0
    : value < 0
      ? 1
      : value < 2 * QAM16_SCALE
        ? 3
        : 2
}

export function demodulateQam16(samples: readonly QpskSymbol[]): number[] {
  return samples.flatMap(({ i, q }) => {
    const ci = decodeQam16Axis(i),
      cq = decodeQam16Axis(q)
    return [ci >> 1, ci & 1, cq >> 1, cq & 1]
  })
}

export function simulateQam16(
  bits: readonly number[],
  ebN0Db: number,
  seed: number,
  noiseEnabled = true,
) {
  const symbols = modulateQam16(bits)
  const axes = symbols.flatMap(({ i, q }) => [i, q])
  const noisy = noiseEnabled ? addAwgn(axes, ebN0Db, seed) : axes
  const received = Array.from({ length: symbols.length }, (_, index) => ({
    i: noisy[index * 2],
    q: noisy[index * 2 + 1],
  }))
  const decoded = demodulateQam16(received)
  return { symbols, received, decoded, ...calculateBer(bits, decoded) }
}

/** Exact uniform Gray square-16QAM bit-error expression; Q evaluated numerically. */
export function theoreticalQam16Ber(ebN0Db: number): number {
  if (!Number.isFinite(ebN0Db) || ebN0Db < -10 || ebN0Db > 15)
    throw new Error('理论曲线支持 −10 到 15 dB。')
  const q = (x: number) => {
    const u = x / Math.SQRT2,
      t = 1 / (1 + u / 2)
    const polynomial = [
      0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806,
      0.09678418, 0.37409196, 1.00002368,
    ].reduce((value, c) => value * t + c, 0)
    return 0.5 * t * Math.exp(-u * u - 1.26551223 + t * polynomial)
  }
  const d = Math.sqrt(0.8 * 10 ** (ebN0Db / 10))
  return 0.75 * q(d) + 0.5 * q(3 * d) - 0.25 * q(5 * d)
}
