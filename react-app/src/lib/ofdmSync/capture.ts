import { fft } from "../fft.js";
import { convolve, type Tap } from "../multipathChannel.js";

/** Rotate an interleaved complex stream using absolute capture sample indices. */
export function rotateSamples(
  input: Float64Array,
  fftSize: number,
  cfo: number,
  phase: number,
  start: number,
): Float64Array {
  if (
    !(input instanceof Float64Array) ||
    input.length % 2 !== 0 ||
    input.some((value) => !Number.isFinite(value)) ||
    !Number.isSafeInteger(fftSize) ||
    fftSize < 2 ||
    fftSize > 1024 ||
    !Number.isFinite(cfo) ||
    Math.abs(cfo) > fftSize / 2 ||
    !Number.isFinite(phase) ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(start + input.length / 2)
  )
    throw new Error("Invalid continuous CFO rotation input.");
  const out = new Float64Array(input.length);
  for (let t = 0; t < input.length / 2; t++) {
    const turns = (phase / (2 * Math.PI) + (cfo / fftSize) * (start + t)) % 1;
    const angle = 2 * Math.PI * turns;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    out[2 * t] = input[2 * t] * c - input[2 * t + 1] * s;
    out[2 * t + 1] = input[2 * t] * s + input[2 * t + 1] * c;
  }
  return out;
}

/** FIR over the whole frame, then CFO and receiver noise over the whole capture. */
export function captureFrame(
  wave: Float64Array,
  taps: readonly Tap[],
  fftSize: number,
  cfo: number,
  phase: number,
  guard: number,
  suffix: number,
  noise: Float64Array,
): Float64Array {
  if (
    !(wave instanceof Float64Array) ||
    wave.length === 0 ||
    wave.length % 2 !== 0 ||
    !Number.isInteger(guard) ||
    guard < 0 ||
    guard > 4096 ||
    !Number.isInteger(suffix) ||
    suffix < 0 ||
    suffix > 4096 ||
    !(noise instanceof Float64Array) ||
    noise.some((v) => !Number.isFinite(v))
  )
    throw new Error("Invalid OFDM capture input.");
  const filtered = convolve(wave, taps);
  const padded = new Float64Array(2 * guard + filtered.length + 2 * suffix);
  if (noise.length !== padded.length)
    throw new Error("Noise must cover the complete capture.");
  padded.set(filtered, 2 * guard);
  const received = rotateSamples(padded, fftSize, cfo, phase, 0);
  for (let i = 0; i < received.length; i++) received[i] += noise[i];
  return received;
}

/** Extract the nominal useful window from each consecutive CP-OFDM symbol. */
export function receiverFfts(
  capture: Float64Array,
  fftSize: number,
  cp: number,
  guard: number,
  symbols: number,
): Float64Array[] {
  if (
    !(capture instanceof Float64Array) ||
    capture.length % 2 !== 0 ||
    capture.some((v) => !Number.isFinite(v)) ||
    !Number.isInteger(fftSize) ||
    fftSize < 2 ||
    fftSize > 1024 ||
    (fftSize & (fftSize - 1)) !== 0 ||
    !Number.isInteger(cp) ||
    cp < 0 ||
    cp > fftSize ||
    !Number.isInteger(guard) ||
    guard < 0 ||
    !Number.isInteger(symbols) ||
    symbols < 1 ||
    symbols > 9 ||
    2 * (guard + symbols * (fftSize + cp)) > capture.length
  )
    throw new Error("Invalid or incomplete OFDM receiver window.");
  return Array.from({ length: symbols }, (_, m) => {
    const start = 2 * (guard + m * (fftSize + cp) + cp);
    return fft(capture.slice(start, start + 2 * fftSize));
  });
}
