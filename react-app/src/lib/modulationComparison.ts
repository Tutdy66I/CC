import {
  theoreticalBpskBer,
  validateSweepRequest,
  type SweepRequest,
} from './berSweep.js'
import { createAwgnSampler } from './signallab.js'
import {
  decodeQam16Axis,
  QAM16_LEVELS,
  QAM16_SCALE,
  theoreticalQam16Ber,
} from './qam16.js'
import type { EvmResult } from './evm.js'

export const MODULATIONS = ['BPSK', 'QPSK', '16QAM'] as const
export type Modulation = (typeof MODULATIONS)[number]
export const COMPARISON_DB = [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14] as const
export interface ComparisonPoint {
  modulation: Modulation
  ebN0Db: number
  bits: number
  seed: number
  errors: number
  ber: number
  theoretical: number
  evm: EvmResult
}
export type ComparisonMessage =
  | { type: 'point'; point: ComparisonPoint }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** 64-bit cycle: every four-bit word from 0000 through 1111, MSB first. */
export function comparisonBit(index: number): number {
  return ((Math.floor(index / 4) % 16) >> (3 - (index % 4))) & 1
}

export function validateComparisonRequest(request: SweepRequest): void {
  validateSweepRequest(request)
  if (request.bits % 64 !== 0)
    throw new Error('对比每点比特数须为 64 的倍数，以完整覆盖 16QAM 星座。')
}

export function simulateComparisonPoint(
  modulation: Modulation,
  ebN0Db: number,
  bits: number,
  seed: number,
): ComparisonPoint {
  validateComparisonRequest({ bits, seed })
  if (!MODULATIONS.includes(modulation)) throw new Error('不支持的调制方式。')
  const theoretical =
    modulation === '16QAM'
      ? theoreticalQam16Ber(ebN0Db)
      : theoreticalBpskBer(ebN0Db)
  const sample = createAwgnSampler(ebN0Db, seed)
  let errors = 0,
    signalEnergy = 0,
    errorEnergy = 0
  const width = modulation === 'BPSK' ? 1 : modulation === 'QPSK' ? 2 : 4
  const hamming = [0, 1, 1, 2]
  for (let index = 0; index < bits; index += width) {
    if (modulation === '16QAM') {
      const ci = 2 * comparisonBit(index) + comparisonBit(index + 1)
      const cq = 2 * comparisonBit(index + 2) + comparisonBit(index + 3)
      const i = QAM16_LEVELS[ci] * QAM16_SCALE,
        q = QAM16_LEVELS[cq] * QAM16_SCALE
      const ri = sample(i),
        rq = sample(q)
      errors +=
        hamming[ci ^ decodeQam16Axis(ri)] + hamming[cq ^ decodeQam16Axis(rq)]
      signalEnergy += i * i + q * q
      errorEnergy += (ri - i) ** 2 + (rq - q) ** 2
    } else {
      // QPSK uses the same per-bit stream as BPSK, intentionally pairing randomness.
      for (let axis = 0; axis < width; axis++) {
        const bit = comparisonBit(index + axis),
          symbol = bit === 0 ? 1 : -1
        const received = sample(symbol)
        errors += Number(bit !== (received >= 0 ? 0 : 1))
        signalEnergy += 1
        errorEnergy += (received - symbol) ** 2
      }
    }
  }
  const rms = Math.sqrt(errorEnergy / signalEnergy)
  return {
    modulation,
    ebN0Db,
    bits,
    seed,
    errors,
    ber: errors / bits,
    theoretical,
    evm: {
      rms,
      percent: rms * 100,
      db: rms === 0 ? null : 20 * Math.log10(rms),
    },
  }
}
