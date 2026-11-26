// Fixed public fixtures; instrumentation is an in-memory copy only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { convolve } from "../.test-build/src/lib/multipathChannel.js";
import { fft } from "../.test-build/src/lib/fft.js";
import {
  fullTrainingLs,
  equalizeOfdm,
} from "../.test-build/src/lib/ofdmEqualizer.js";
import { ofdmDecode } from "../.test-build/src/lib/ofdmModulation.js";

const hx = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const prefix = `const events=[];const hex=x=>{const b=Buffer.alloc(8);b.writeDoubleBE(x);return b.toString("hex")};function op(name,args,value){events.push({name,args:args.map(hex),value:hex(value)});return value} const add=(a,b)=>op("add",[a,b],a+b),sub=(a,b)=>op("sub",[a,b],a-b),mul=(a,b)=>op("mul",[a,b],a*b),div=(a,b)=>op("div",[a,b],a/b),sin=a=>op("sin",[a],Math.sin(a)),cos=a=>op("cos",[a],Math.cos(a)),sqrt=a=>op("sqrt",[a],Math.sqrt(a));\n`;
async function instrument(file, replacements) {
  const source = readFileSync(file, "utf8");
  let copy = source;
  for (const [before, after] of replacements) {
    if (copy.split(before).length !== 2)
      throw new Error(`Unexpected compiled source ${file}`);
    copy = copy.replace(before, after);
  }
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(prefix + copy + "\nexport function takeEvents(){return events.splice(0)}\n").toString("base64")}`
  );
  return { mod, sourceHash: createHash("sha256").update(source).digest("hex") };
}
const fir = await instrument(".test-build/src/lib/multipathChannel.js", [
  [
    "out[k] += t.i * signal[j] - t.q * signal[j + 1];",
    "out[k] = add(out[k], sub(mul(t.i, signal[j]), mul(t.q, signal[j + 1])));",
  ],
  [
    "out[k + 1] += t.q * signal[j] + t.i * signal[j + 1];",
    "out[k + 1] = add(out[k + 1], add(mul(t.q, signal[j]), mul(t.i, signal[j + 1])));",
  ],
]);
const tf = await instrument(".test-build/src/lib/fft.js", [
  [
    "const c = Math.cos(angle), s = Math.sin(angle), a = 2 * (start + j), b = 2 * (start + j + size / 2);",
    "const c = cos(angle), s = sin(angle), a = 2 * (start + j), b = 2 * (start + j + size / 2);",
  ],
  [
    "const re = c * out[b] - s * out[b + 1], im = s * out[b] + c * out[b + 1];",
    "const re = sub(mul(c, out[b]), mul(s, out[b + 1])), im = add(mul(s, out[b]), mul(c, out[b + 1]));",
  ],
  ["out[b] = out[a] - re;", "out[b] = sub(out[a], re);"],
  ["out[b + 1] = out[a + 1] - im;", "out[b + 1] = sub(out[a + 1], im);"],
  ["out[a] += re;", "out[a] = add(out[a], re);"],
  ["out[a + 1] += im;", "out[a + 1] = add(out[a + 1], im);"],
  ["const scale = 1 / Math.sqrt(n);", "const scale = div(1, sqrt(n));"],
  ["out[i] *= scale;", "out[i] = mul(out[i], scale);"],
]);
const eq = await instrument(".test-build/src/lib/ofdmEqualizer.js", [
  [
    "const a = h[0] / scale, b = h[1] / scale, d = a * a + b * b, u = y[0] / scale, v = y[1] / scale;",
    "const a = div(h[0],scale), b = div(h[1],scale), d = add(mul(a,a),mul(b,b)), u = div(y[0],scale), v = div(y[1],scale);",
  ],
  [
    "const z = [(u * a + v * b) / d, (v * a - u * b) / d];",
    "const z = [div(add(mul(u,a),mul(v,b)),d), div(sub(mul(v,a),mul(u,b)),d)];",
  ],
]);
const fixtures = [
  {
    id: "fir2-fft8",
    n: 8,
    taps: [
      { delay: 0, i: 1, q: 0 },
      { delay: 1, i: 0.25, q: 0.125 },
    ],
  },
  {
    id: "fir3-fft16",
    n: 16,
    taps: [
      { delay: 0, i: 1, q: 0 },
      { delay: 1, i: 0.25, q: 0.125 },
      { delay: 3, i: -0.125, q: 0.0625 },
    ],
  },
  {
    id: "fir4-rounded-fft8",
    n: 8,
    taps: [
      { delay: 0, i: 1, q: 0 },
      { delay: 1, i: 0.1, q: 0.2 },
      { delay: 2, i: -0.3, q: 0.1 },
      { delay: 3, i: 0.2, q: -0.1 },
    ],
  },
];
const cases = [];
for (const f of fixtures) {
  const signal = Float64Array.from(
    { length: 2 * f.n },
    (_, j) => (((j * 7) % 11) - 5) / 8,
  );
  const filtered = fir.mod.convolve(signal, f.taps),
    actualFir = convolve(signal, f.taps),
    firEvents = fir.mod.takeEvents();
  if ([...filtered].some((v, i) => !Object.is(v, actualFir[i])))
    throw new Error("FIR instrumentation mismatch");
  const input = filtered.slice(0, 2 * f.n),
    spectrum = tf.mod.fft(input),
    actualFft = fft(input),
    fftEvents = tf.mod.takeEvents();
  if ([...spectrum].some((v, i) => !Object.is(v, actualFft[i])))
    throw new Error("FFT instrumentation mismatch");
  const pilot = [1, 1],
    training = [spectrum[0], spectrum[1]],
    csi = eq.mod.fullTrainingLs(training, pilot),
    actualCsi = fullTrainingLs(training, pilot),
    lsEvents = eq.mod.takeEvents();
  if (csi.some((v, i) => !Object.is(v, actualCsi[i])))
    throw new Error("LS instrumentation mismatch");
  const data = [spectrum[2], spectrum[3]],
    z = eq.mod.equalizeOfdm(data, csi, 0, 2, "zf"),
    actual = equalizeOfdm(data, csi, 0, 2, "zf"),
    zfEvents = eq.mod.takeEvents();
  if (
    !z.decision ||
    !actual.decision ||
    z.decision.some((v, i) => !Object.is(v, actual.decision[i]))
  )
    throw new Error("ZF instrumentation mismatch");
  cases.push({
    id: f.id,
    n: f.n,
    taps: f.taps.map((t) => ({ delay: t.delay, i: hx(t.i), q: hx(t.q) })),
    signal: [...signal].map(hx),
    pilot: pilot.map(hx),
    fir: [...filtered].map(hx),
    spectrum: [...spectrum].map(hx),
    csi: csi.map(hx),
    decision: z.decision.map(hx),
    bits: ofdmDecode(...z.decision, "QPSK"),
    events: { fir: firEvents, fft: fftEvents, ls: lsEvents, zf: zfEvents },
  });
}
console.log(
  JSON.stringify({
    runtime: { node: process.versions.node, v8: process.versions.v8 },
    sources: {
      fir: fir.sourceHash,
      fft: tf.sourceHash,
      equalizer: eq.sourceHash,
    },
    cases,
  }),
);
