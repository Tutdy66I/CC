import type { Complex } from "./channelTypes.js";

export interface ChannelPilotObservation {
  tx: Complex;
  received: Complex;
}
export type ChannelEstimate =
  | { status: "ok"; estimate: Complex }
  | { status: "failed"; reason: string };

/** Constant-complex-gain LS. This interface cannot receive channel truth or payload. */
export function estimatePilotChannel(
  pilots: readonly ChannelPilotObservation[],
): ChannelEstimate {
  let denominator = 0,
    i = 0,
    q = 0;
  if (pilots.length === 0) return { status: "failed", reason: "no-pilots" };
  for (const { tx, received } of pilots) {
    if (![tx.i, tx.q, received.i, received.q].every(Number.isFinite))
      return { status: "failed", reason: "nonfinite-pilot" };
    denominator += tx.i ** 2 + tx.q ** 2;
    i += tx.i * received.i + tx.q * received.q;
    q += tx.i * received.q - tx.q * received.i;
  }
  if (!(denominator > 0) || ![denominator, i, q].every(Number.isFinite))
    return { status: "failed", reason: "invalid-pilot-energy" };
  const estimate = { i: i / denominator, q: q / denominator };
  return [estimate.i, estimate.q].every(Number.isFinite)
    ? { status: "ok", estimate }
    : { status: "failed", reason: "nonfinite-estimate" };
}
