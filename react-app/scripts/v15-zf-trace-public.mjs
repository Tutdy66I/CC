// Fixed public fixture. Instrument a verified in-memory copy of the compiled
// function and compare the final bits with the unmodified production export.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { equalizeOfdm } from "../.test-build/src/lib/ofdmEqualizer.js";

const toHex = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const fromHex = (s) => Buffer.from(s, "hex").readDoubleBE();
const result = spawnSync(
  process.execPath,
  ["scripts/v15-interval-public-node.mjs"],
  { encoding: "utf8" },
);
if (result.status !== 0) throw new Error(result.stderr || "fixture failed");
const data = JSON.parse(result.stdout);
const row = data.cases.find((r) => r.id === "zf-boundary");
if (!row) throw new Error("missing fixture");
const path = ".test-build/src/lib/ofdmEqualizer.js";
const source = readFileSync(path, "utf8");
const original = `    const scale = Math.max(Math.abs(h[0]), Math.abs(h[1]));
    if (scale === 0)
        return null;
    const a = h[0] / scale, b = h[1] / scale, d = a * a + b * b, u = y[0] / scale, v = y[1] / scale;
    const z = [(u * a + v * b) / d, (v * a - u * b) / d];`;
const replacement = `    const scale = rec("scale", Math.max(Math.abs(h[0]), Math.abs(h[1])));
    if (scale === 0) return null;
    const a = rec("zf.a", h[0] / scale), b = rec("zf.b", h[1] / scale), d = rec("zf.d", rec("zf.a2", a * a) + rec("zf.b2", b * b)), u = rec("zf.u", y[0] / scale), v = rec("zf.v", y[1] / scale);
    const z = [rec("zf.re", rec("zf.re.numerator", rec("zf.ua", u * a) + rec("zf.vb", v * b)) / d), rec("zf.im", rec("zf.im.numerator", rec("zf.va", v * a) - rec("zf.ub", u * b)) / d)];`;
if (source.split(original).length !== 2)
  throw new Error("compiled divide source changed; refusing to instrument");
const prefix = `const steps=[]; function rec(name, value) { const b=Buffer.alloc(8); b.writeDoubleBE(value); steps.push({name,bits:b.toString("hex")}); return value; }\n`;
const instrumented =
  prefix +
  source.replace(original, replacement) +
  `\nexport function publicTrace(){ return steps; }\n`;
const adapter = await import(
  `data:text/javascript;base64,${Buffer.from(instrumented).toString("base64")}`
);
const y = row.fft.slice(0, 2).map(fromHex),
  h = row.h.map(fromHex);
const traced = adapter.equalizeOfdm(y, h, 0, 2, "zf"),
  production = equalizeOfdm(y, h, 0, 2, "zf");
if (
  !traced.decision ||
  !production.decision ||
  traced.decision.some((v, i) => !Object.is(v, production.decision[i]))
)
  throw new Error("instrumented and production final values differ");
console.log(
  JSON.stringify({
    fixture: row,
    nodeConstants: { sqrt2: data.sqrt2, scale: data.scale },
    runtime: data.runtime,
    compiledSourceSha256: createHash("sha256").update(source).digest("hex"),
    trace: adapter.publicTrace(),
    productionDecision: production.decision.map(toHex),
  }),
);
