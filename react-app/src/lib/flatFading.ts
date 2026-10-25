import type { ChannelModel, Complex } from "./channelTypes.js";

/** h is unit-average-power in the ensemble, never normalized within a frame. */
export function sampleFlatChannel(
  model: ChannelModel,
  coefficient: Complex,
  frameCoefficient: Complex,
): Complex {
  if (model === "awgn") return { i: 1, q: 0 };
  if (model === "rayleigh-block") return frameCoefficient;
  if (model === "rayleigh-iid") return coefficient;
  throw new Error("未知平坦衰落模型。");
}

/** y=h*x+sqrt(N0)*z, where z~CN(0,1). N0 is not a measured receive power. */
export function applyFlatChannel(
  tx: Complex,
  h: Complex,
  z: Complex,
  noisePower: number,
): Complex {
  if (!Number.isFinite(noisePower) || noisePower < 0)
    throw new Error("噪声功率无效。");
  const scale = Math.sqrt(noisePower);
  return {
    i: h.i * tx.i - h.q * tx.q + scale * z.i,
    q: h.i * tx.q + h.q * tx.i + scale * z.q,
  };
}
