import {
  addAwgn,
  calculateBer,
  demodulateBpsk,
  modulateBpsk,
} from './signallab.js'

export interface QpskSymbol {
  i: number
  q: number
}

/** Gray mapping with Eb=1 and Es=2: each axis is a unit-energy BPSK bit. */
export function modulateQpsk(bits: readonly number[]): QpskSymbol[] {
  if (!bits.length || bits.length % 2 !== 0) {
    throw new Error('QPSK 每个符号需要 2 比特，请输入非空、偶数长度的比特流。')
  }
  const axes = modulateBpsk(bits)
  return Array.from({ length: axes.length / 2 }, (_, n) => ({
    i: axes[2 * n],
    q: axes[2 * n + 1],
  }))
}

export function demodulateQpsk(samples: readonly QpskSymbol[]): number[] {
  return demodulateBpsk(samples.flatMap(({ i, q }) => [i, q]))
}

export function simulateQpsk(
  bits: readonly number[],
  ebN0Db: number,
  seed: number,
  noiseEnabled = true,
) {
  const symbols = modulateQpsk(bits)
  // One RNG stream, consecutive independent Gaussian draws for I and Q.
  const axes = symbols.flatMap(({ i, q }) => [i, q])
  const noisy = noiseEnabled ? addAwgn(axes, ebN0Db, seed) : axes
  const received = Array.from({ length: symbols.length }, (_, n) => ({
    i: noisy[2 * n],
    q: noisy[2 * n + 1],
  }))
  const decoded = demodulateQpsk(received)
  return { symbols, received, decoded, ...calculateBer(bits, decoded) }
}
