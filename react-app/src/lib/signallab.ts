/** Unit-energy coherent BPSK at the matched-filter output (one sample/bit). */
function validateBits(bits: readonly number[]): void {
  if (bits.some((bit) => bit !== 0 && bit !== 1)) {
    throw new Error('比特只能是 0 或 1。')
  }
}

export function parseBits(input: string): number[] {
  const compact = input.replace(/\s/g, '')
  if (!/^[01]+$/.test(compact)) {
    throw new Error('请输入 0 和 1；允许空格和换行。')
  }
  return Array.from(compact, Number)
}

export function modulateBpsk(bits: readonly number[]): number[] {
  validateBits(bits)
  return bits.map((bit) => (bit === 0 ? 1 : -1))
}

function validateSamples(samples: readonly number[]): void {
  if (samples.some((sample) => !Number.isFinite(sample))) {
    throw new Error('采样值必须为有限数。')
  }
}

/** Mulberry32, local state only. Seed is an unsigned 32-bit integer. */
function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('随机种子必须是 0 到 4294967295 的整数。')
  }
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function addAwgn(
  symbols: readonly number[],
  ebN0Db: number,
  seed: number,
): number[] {
  validateSamples(symbols)
  // Eb = 1, real matched-filter noise variance = N0/2.
  const variance = 1 / (2 * 10 ** (ebN0Db / 10))
  if (!Number.isFinite(ebN0Db) || !Number.isFinite(variance) || variance <= 0) {
    throw new Error('Eb/N0 必须在可计算的有限范围内。')
  }
  const random = seededRandom(seed)
  const sigma = Math.sqrt(variance)
  return symbols.map((symbol) => {
    // 1-random() avoids log(0), including for seed 0.
    const gaussian =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
    return symbol + sigma * gaussian
  })
}

export function demodulateBpsk(samples: readonly number[]): number[] {
  validateSamples(samples)
  return samples.map((sample) => (sample >= 0 ? 0 : 1))
}

export function calculateBer(
  transmitted: readonly number[],
  decoded: readonly number[],
): { errors: number; ber: number } {
  validateBits(transmitted)
  validateBits(decoded)
  if (!transmitted.length || transmitted.length !== decoded.length) {
    throw new Error('BER 需要长度相同且非空的比特序列。')
  }
  const errors = transmitted.reduce(
    (sum, bit, index) => sum + Number(bit !== decoded[index]),
    0,
  )
  return { errors, ber: errors / transmitted.length }
}

export function simulateBpsk(
  bits: readonly number[],
  ebN0Db: number,
  seed: number,
  noiseEnabled = true,
) {
  const symbols = modulateBpsk(bits)
  const received = noiseEnabled ? addAwgn(symbols, ebN0Db, seed) : [...symbols]
  const decoded = demodulateBpsk(received)
  return { symbols, received, decoded, ...calculateBer(bits, decoded) }
}
