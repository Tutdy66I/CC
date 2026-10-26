import { fft } from "./fft.js";
export const binIndex = (q: number, n: number) => (q + n) % n;
export function addCp(body: Float64Array, cp: number): Float64Array {
  if (!Number.isInteger(cp) || cp < 0 || cp > body.length / 2)
    throw new Error("CP 长度无效。");
  const out = new Float64Array(body.length + 2 * cp);
  out.set(body.subarray(body.length - 2 * cp));
  out.set(body, 2 * cp);
  return out;
}
export function removeCp(
  symbol: Float64Array,
  cp: number,
  n: number,
): Float64Array {
  if (
    !Number.isInteger(cp) ||
    cp < 0 ||
    cp > n ||
    symbol.length !== 2 * (n + cp)
  )
    throw new Error("接收符号或 CP 长度无效。");
  return symbol.slice(2 * cp);
}
export const modulateOfdm = (grid: Float64Array, cp: number) =>
  addCp(fft(grid, true), cp);
export const demodulateOfdm = (symbol: Float64Array, cp: number, n: number) =>
  fft(removeCp(symbol, cp, n));
