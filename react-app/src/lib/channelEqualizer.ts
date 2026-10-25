import type { Complex } from "./channelTypes.js";

export interface EqualizedSample {
  sample: Complex | null;
  failure: string | null;
}

/** Scaled complex division avoids underflow, with no epsilon, clipping or oracle rejection. */
export function zeroForcingEqualize(
  received: Complex,
  csi: Complex,
): EqualizedSample {
  if (![received.i, received.q, csi.i, csi.q].every(Number.isFinite))
    return { sample: null, failure: "nonfinite-input" };
  const scale = Math.max(Math.abs(csi.i), Math.abs(csi.q));
  if (scale === 0) return { sample: null, failure: "zero-csi" };
  const hi = csi.i / scale,
    hq = csi.q / scale;
  const denominator = hi ** 2 + hq ** 2;
  const ri = received.i / scale,
    rq = received.q / scale;
  const sample = {
    i: (ri * hi + rq * hq) / denominator,
    q: (rq * hi - ri * hq) / denominator,
  };
  return [sample.i, sample.q].every(Number.isFinite)
    ? { sample, failure: null }
    : { sample: null, failure: "nonfinite-equalization" };
}
