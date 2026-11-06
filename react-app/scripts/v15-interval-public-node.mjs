// Public fixed inputs; compiled, unmodified production functions.
import { convolve } from "../.test-build/src/lib/multipathChannel.js";
import { fft } from "../.test-build/src/lib/fft.js";
import { equalizeOfdm } from "../.test-build/src/lib/ofdmEqualizer.js";
import { ofdmDecode } from "../.test-build/src/lib/ofdmModulation.js";

const cases = [
  { id: "ordinary", signal: [1, 0.5, 0.25, -0.125], h: [1, 0.25] },
  { id: "cancel", signal: [1, 0.5, -1, -0.5], h: [0.3, 0.2] },
  { id: "near", signal: [1, 0.5, -1 + 2 ** -52, -0.5], h: [0.3, 0.2] },
  { id: "zf-boundary", signal: [0.3, -0.45, 0, 0], h: [0.3, 0.2] },
];
const hx = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const rows = cases.map(({ id, signal, h }) => {
  const filtered = convolve(Float64Array.from(signal), [
    { delay: 0, i: 1, q: 0 },
  ]);
  const spectrum = fft(filtered);
  const equalized = equalizeOfdm([spectrum[0], spectrum[1]], h, 0, 2, "zf");
  if (!equalized.decision) throw new Error("Unexpected public fixture erasure");
  return {
    id,
    signal: signal.map(hx),
    h: h.map(hx),
    fir: [...filtered].map(hx),
    fft: [...spectrum].map(hx),
    decision: equalized.decision.map(hx),
    bits: ofdmDecode(...equalized.decision, "QPSK"),
  };
});
console.log(
  JSON.stringify({
    runtime: { node: process.versions.node, v8: process.versions.v8 },
    sqrt2: hx(Math.sqrt(2)),
    scale: hx(1 / Math.sqrt(2)),
    cases: rows,
  }),
);
