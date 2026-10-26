/** Interleaved complex radix-2 transform. Both directions have scale 1/sqrt(N). */
export function fft(input: Float64Array, inverse = false): Float64Array {
  const n = input.length / 2;
  if (
    n < 2 ||
    n > 1024 ||
    !Number.isInteger(n) ||
    (n & (n - 1)) !== 0 ||
    input.some((x) => !Number.isFinite(x))
  )
    throw new Error("FFT 需要 2 到 1024 个有限复数采样，长度为 2 的幂。");
  const out = input.slice();
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j)
      for (let axis = 0; axis < 2; axis++) {
        const v = out[2 * i + axis];
        out[2 * i + axis] = out[2 * j + axis];
        out[2 * j + axis] = v;
      }
  }
  for (let size = 2; size <= n; size *= 2) {
    for (let start = 0; start < n; start += size)
      for (let j = 0; j < size / 2; j++) {
        const angle = ((inverse ? 2 : -2) * Math.PI * j) / size;
        const c = Math.cos(angle),
          s = Math.sin(angle),
          a = 2 * (start + j),
          b = 2 * (start + j + size / 2);
        const re = c * out[b] - s * out[b + 1],
          im = s * out[b] + c * out[b + 1];
        out[b] = out[a] - re;
        out[b + 1] = out[a + 1] - im;
        out[a] += re;
        out[a + 1] += im;
      }
  }
  const scale = 1 / Math.sqrt(n);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}
