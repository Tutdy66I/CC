import { modulateBpsk } from "./signallab.js";
import { modulateQpsk } from "./qpsk.js";
import { modulateQam16, decodeQam16Axis } from "./qam16.js";
import type { Modulation } from "./modulationComparison.js";
export function ofdmModulate(
  bits: number[],
  modulation: Modulation,
): [number, number] {
  if (modulation === "BPSK") return [modulateBpsk(bits)[0], 0];
  const v =
    modulation === "QPSK" ? modulateQpsk(bits)[0] : modulateQam16(bits)[0];
  return [v.i, v.q];
}
export function ofdmDecode(
  i: number,
  q: number,
  modulation: Modulation,
): number[] {
  if (!Number.isFinite(i) || !Number.isFinite(q))
    throw new Error("判决坐标非有限。");
  if (modulation === "BPSK") return [i >= 0 ? 0 : 1];
  if (modulation === "QPSK") return [i >= 0 ? 0 : 1, q >= 0 ? 0 : 1];
  const a = decodeQam16Axis(i),
    b = decodeQam16Axis(q);
  return [a >> 1, a & 1, b >> 1, b & 1];
}
