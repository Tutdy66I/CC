/** Scaled complex division avoids squaring a deep fade. No epsilon or gain cutoff. */
function divide(
  y: readonly number[],
  h: readonly number[],
): [number, number] | null {
  const scale = Math.max(Math.abs(h[0]), Math.abs(h[1]));
  if (scale === 0) return null;
  const a = h[0] / scale,
    b = h[1] / scale,
    d = a * a + b * b,
    u = y[0] / scale,
    v = y[1] / scale;
  const z: [number, number] = [(u * a + v * b) / d, (v * a - u * b) / d];
  return z.every(Number.isFinite) ? z : null;
}
export function fullTrainingLs(
  observed: readonly number[],
  pilots: readonly number[],
): number[] {
  if (
    !observed.length ||
    observed.length % 2 ||
    observed.length !== pilots.length ||
    [...observed, ...pilots].some((x) => !Number.isFinite(x))
  )
    throw new Error("LS 导频输入无效。");
  const out: number[] = [];
  for (let j = 0; j < observed.length; j += 2) {
    const z = divide(observed.slice(j, j + 2), pilots.slice(j, j + 2));
    if (!z) throw new Error("LS 导频为零或数值失效。");
    out.push(...z);
  }
  return out;
}
export function equalizeOfdm(
  y: readonly number[],
  h: readonly number[],
  n0: number,
  es: number,
  method: "zf" | "mmse",
) {
  if (
    y.length !== 2 ||
    h.length !== 2 ||
    [...y, ...h, n0, es].some((x) => !Number.isFinite(x)) ||
    n0 < 0 ||
    es <= 0 ||
    !["zf", "mmse"].includes(method)
  )
    throw new Error("均衡器输入无效。");
  const decision = divide(y, h);
  const failure = decision
    ? null
    : h[0] === 0 && h[1] === 0
      ? "zero-csi"
      : "nonfinite-coordinate";
  if (!decision) return { raw: null, decision: null, gain: 0, failure };
  if (method === "zf" || n0 === 0)
    return { raw: decision, decision, gain: 1, failure: null };
  const h2 = h[0] * h[0] + h[1] * h[1],
    lambda = n0 / es,
    d = h2 + lambda,
    gain = h2 / d;
  const wi = h[0] / d,
    wq = -h[1] / d;
  const raw: [number, number] = [wi * y[0] - wq * y[1], wi * y[1] + wq * y[0]];
  return {
    raw: raw.every(Number.isFinite) ? raw : null,
    decision,
    gain,
    failure: raw.every(Number.isFinite) ? null : "nonfinite-output",
  };
}
