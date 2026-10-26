export interface Tap {
  delay: number;
  i: number;
  q: number;
}
function validateTaps(taps: readonly Tap[]) {
  if (
    !taps.length ||
    taps.length > 16 ||
    taps.some(
      (t, j) =>
        !Number.isInteger(t.delay) ||
        t.delay < 0 ||
        t.delay > 1023 ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        (j > 0 && t.delay <= taps[j - 1].delay),
    )
  )
    throw new Error("多径需要 1 到 16 条排序且互异的有限整数时延抽头。");
}
/** Causal, continuous linear FIR over the entire frame; zero prehistory, retained tail. */
export function convolve(
  signal: Float64Array,
  taps: readonly Tap[],
): Float64Array {
  validateTaps(taps);
  if (signal.length % 2 || signal.some((x) => !Number.isFinite(x)))
    throw new Error("FIR 输入无效。");
  const out = new Float64Array(signal.length + 2 * taps.at(-1)!.delay);
  for (const t of taps)
    for (let j = 0; j < signal.length; j += 2) {
      const k = j + 2 * t.delay;
      out[k] += t.i * signal[j] - t.q * signal[j + 1];
      out[k + 1] += t.q * signal[j] + t.i * signal[j + 1];
    }
  return out;
}
/** Unnormalized tap DFT, so h=[1] produces H[k]=1. Never generates the waveform. */
export function frequencyResponse(
  n: number,
  taps: readonly Tap[],
): Float64Array {
  validateTaps(taps);
  if (!Number.isInteger(n) || n < 2 || n > 1024 || taps.at(-1)!.delay >= n)
    throw new Error("频响长度无效。");
  const out = new Float64Array(2 * n);
  for (let k = 0; k < n; k++)
    for (const t of taps) {
      const angle = (-2 * Math.PI * k * t.delay) / n,
        c = Math.cos(angle),
        s = Math.sin(angle);
      out[2 * k] += t.i * c - t.q * s;
      out[2 * k + 1] += t.i * s + t.q * c;
    }
  return out;
}
