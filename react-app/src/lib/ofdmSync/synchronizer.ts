/** Observation-only acquisition. Inputs must never include simulation truth. */
export type CfoEstimate =
  | { status: "ok"; cfo: number; coherence: number; ambiguous: true }
  | {
      status: "failed";
      reason: "low-energy" | "low-coherence";
      coherence: number;
    };

export function estimateCfo(
  received: Float64Array,
  n: number,
  start: number,
  lag: number,
  count: number,
): CfoEstimate {
  if (
    !(received instanceof Float64Array) ||
    received.length % 2 !== 0 ||
    received.some((v) => !Number.isFinite(v)) ||
    !Number.isInteger(n) ||
    n < 2 ||
    n > 1024 ||
    !Number.isInteger(start) ||
    start < 0 ||
    !Number.isInteger(lag) ||
    lag < 1 ||
    !Number.isInteger(count) ||
    count < 1 ||
    start + lag + count > received.length / 2
  )
    throw new Error("Invalid repeated-preamble observation.");
  let re = 0,
    im = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < count; i++) {
    const x = 2 * (start + i),
      y = 2 * (start + i + lag);
    const xr = received[x],
      xi = received[x + 1],
      yr = received[y],
      yi = received[y + 1];
    re += xr * yr + xi * yi;
    im += xr * yi - xi * yr;
    a += xr * xr + xi * xi;
    b += yr * yr + yi * yi;
  }
  if (!(a > 1e-24) || !(b > 1e-24))
    return { status: "failed", reason: "low-energy", coherence: 0 };
  const coherence = (2 * Math.hypot(re, im)) / (a + b);
  if (!Number.isFinite(coherence) || coherence < 0.1)
    return {
      status: "failed",
      reason: "low-coherence",
      coherence: Number.isFinite(coherence) ? coherence : 0,
    };
  let angle = Math.atan2(im, re);
  if (angle >= Math.PI) angle -= 2 * Math.PI;
  return {
    status: "ok",
    cfo: (n * angle) / (2 * Math.PI * lag),
    coherence,
    ambiguous: true,
  };
}

export type TimingEstimate =
  | { status: "ok"; peak: number; start: number; score: number }
  | {
      status: "failed";
      reason: "low-energy" | "low-correlation";
      score: number;
    };

/** Match a public training waveform; earliest peak wins an exact tie. */
export function estimateTiming(
  received: Float64Array,
  reference: Float64Array,
  lower: number,
  upper: number,
  backoff: number,
): TimingEstimate {
  if (
    !(received instanceof Float64Array) ||
    received.length % 2 !== 0 ||
    received.some((v) => !Number.isFinite(v)) ||
    !(reference instanceof Float64Array) ||
    reference.length < 2 ||
    reference.length % 2 !== 0 ||
    reference.some((v) => !Number.isFinite(v)) ||
    !Number.isInteger(lower) ||
    lower < 0 ||
    !Number.isInteger(upper) ||
    upper < lower ||
    upper - lower > 128 ||
    !Number.isInteger(backoff) ||
    backoff < 0 ||
    backoff > lower ||
    upper + reference.length / 2 > received.length / 2
  )
    throw new Error("Invalid timing search.");
  const refEnergy = reference.reduce((s, v) => s + v * v, 0);
  if (!(refEnergy > 1e-24) || !Number.isFinite(refEnergy))
    return { status: "failed", reason: "low-energy", score: 0 };
  let best = lower,
    bestScore = 0;
  for (let start = lower; start <= upper; start++) {
    let re = 0,
      im = 0,
      energy = 0;
    for (let i = 0; i < reference.length / 2; i++) {
      const pr = reference[2 * i],
        pi = reference[2 * i + 1];
      const xr = received[2 * (start + i)],
        xi = received[2 * (start + i) + 1];
      re += pr * xr + pi * xi;
      im += pr * xi - pi * xr;
      energy += xr * xr + xi * xi;
    }
    const score =
      energy > 1e-24 ? (re * re + im * im) / (energy * refEnergy) : 0;
    if (Number.isFinite(score) && score > bestScore) {
      best = start;
      bestScore = score;
    }
  }
  if (bestScore < 0.1)
    return { status: "failed", reason: "low-correlation", score: bestScore };
  return { status: "ok", peak: best, start: best - backoff, score: bestScore };
}
