import { createAwgnSampler } from './signallab.js'

export const SWEEP_DB = [-4, -2, 0, 2, 4, 6, 8, 10] as const
export const MAX_SWEEP_BITS = 1000000

export interface BerInterval {
  kind: 'wilson' | 'zero-upper'
  lower: number
  upper: number
}

export interface BerPoint {
  ebN0Db: number
  bits: number
  seed: number
  errors: number
  ber: number
  theoretical: number
  interval: BerInterval
}

export interface SweepRequest {
  bits: number
  seed: number
}

export type SweepMessage =
  | { type: 'point'; point: BerPoint }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function validateSweepRequest({ bits, seed }: SweepRequest): void {
  if (!Number.isInteger(bits) || bits < 1 || bits > MAX_SWEEP_BITS) {
    throw new Error(`每点比特数必须是 1 到 ${MAX_SWEEP_BITS} 的整数。`)
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('随机种子必须是 0 到 4294967295 的整数。')
  }
}

/** Coherent, uncoded, unit-energy BPSK in AWGN. erfc evaluated directly to retain tails. */
export function theoreticalBpskBer(ebN0Db: number): number {
  if (!Number.isFinite(ebN0Db) || ebN0Db < -10 || ebN0Db > 15) {
    throw new Error('理论曲线支持 −10 到 15 dB。')
  }
  const x = Math.sqrt(10 ** (ebN0Db / 10))
  const t = 1 / (1 + x / 2)
  // Numerical Recipes erfc approximation; relative accuracy checked against reference values.
  const coefficients = [
    0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806,
    0.09678418, 0.37409196, 1.00002368,
  ]
  const polynomial = coefficients.reduce(
    (value, coefficient) => value * t + coefficient,
    0,
  )
  return 0.5 * t * Math.exp(-x * x - 1.26551223 + t * polynomial)
}

/** Pointwise 95% Wilson interval, or an exact one-sided bound when no errors were seen. */
export function berInterval(errors: number, bits: number): BerInterval {
  if (
    !Number.isSafeInteger(bits) ||
    bits < 1 ||
    !Number.isInteger(errors) ||
    errors < 0 ||
    errors > bits
  ) {
    throw new Error('误码数和样本量必须是有效整数，且 0 ≤ 误码数 ≤ 样本量。')
  }
  if (errors === 0) {
    return {
      kind: 'zero-upper',
      lower: 0,
      upper: -Math.expm1(Math.log(0.05) / bits),
    }
  }
  const z = 1.959963984540054
  const p = errors / bits
  const denominator = 1 + (z * z) / bits
  const center = (p + (z * z) / (2 * bits)) / denominator
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / bits + (z * z) / (4 * bits * bits))) /
    denominator
  return {
    kind: 'wilson',
    lower: Math.max(0, center - halfWidth),
    upper: errors === bits ? 1 : Math.min(1, center + halfWidth),
  }
}

export function simulateBerPoint(
  ebN0Db: number,
  bits: number,
  seed: number,
): BerPoint {
  validateSweepRequest({ bits, seed })
  const theoretical = theoreticalBpskBer(ebN0Db)
  // A deterministic balanced sequence; bit values do not change coherent BPSK error probability.
  // Stream the same symbol/noise/decision sequence without retaining O(bits) arrays.
  const sample = createAwgnSampler(ebN0Db, seed)
  let errors = 0
  for (let index = 0; index < bits; index++) {
    const bit = index % 2
    const received = sample(bit === 0 ? 1 : -1)
    const decoded = received >= 0 ? 0 : 1
    errors += Number(bit !== decoded)
  }
  const ber = errors / bits
  return {
    ebN0Db,
    bits,
    seed,
    errors,
    ber,
    theoretical,
    interval: berInterval(errors, bits),
  }
}
