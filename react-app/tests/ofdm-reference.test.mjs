import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fft } from "../.test-build/src/lib/fft.js";
import {
  convolve,
  frequencyResponse,
} from "../.test-build/src/lib/multipathChannel.js";
import { modulateOfdm, demodulateOfdm } from "../.test-build/src/lib/ofdm.js";
import { deriveOfdmState } from "../.test-build/src/lib/ofdmRandom.js";
import { equalizeOfdm } from "../.test-build/src/lib/ofdmEqualizer.js";
import { defaultOfdmPlan } from "../.test-build/src/lib/ofdmProtocol.js";
import { energyBudget } from "../.test-build/src/lib/ofdmEnergy.js";
import { channelBer } from "../.test-build/src/lib/channelSimulation.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/ofdm-v13-reference.json", import.meta.url),
    "utf8",
  ),
);
const flat = (x) => Float64Array.from(x.flat());
test("training CP energy and coherent theory match independent Python DFT and erfc", () => {
  fixture.energy.forEach((e, j) => {
    const budget = energyBudget({
      ...defaultOfdmPlan(),
      modulation: ["BPSK", "QPSK", "16QAM"][j],
    });
    for (const [actual, expected] of [
      [budget.trainingCpEnergy, e.trainingCp],
      [budget.expectedTotalEnergy, e.expectedTotal],
      [budget.expectedEbTotal, e.ebTotal],
    ])
      assert.ok(
        Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)),
      );
  });
  for (const [db, ber] of Object.entries(fixture.awgnBer))
    assert.ok(Math.abs(channelBer("QPSK", "awgn", Number(db)) - ber) < 1e-12);
});
const compare = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  const error = Math.hypot(...actual.map((v, j) => v - expected[j])),
    scale = Math.hypot(...expected);
  assert.ok(
    error <= 1e-12 + scale * 1e-10,
    `relative L2 ${error / Math.max(scale, 1e-12)}`,
  );
};
test("independent Python fixture regenerates without importing production code", () => {
  const r = spawnSync(
    process.env.SIGNALLAB_PYTHON || "python3",
    ["scripts/ofdm-reference.py"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  const verify = (a, b) => {
    if (typeof a === "number" && typeof b === "number")
      assert.ok(Math.abs(a - b) <= 1e-12 + Math.abs(b) * 1e-12);
    else if (a && typeof a === "object") {
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const k of Object.keys(a)) verify(a[k], b[k]);
    } else assert.deepEqual(a, b);
  };
  verify(JSON.parse(r.stdout), fixture);
});
test("random integer state and scalar receiver match independent Python references", async () => {
  assert.deepEqual(
    await deriveOfdmState(20261026, 7, "data", 2),
    fixture.randomState,
  );
  for (const c of fixture.equalizers) {
    const result = equalizeOfdm(c.y, c.estimate, c.n0, c.es, c.method);
    compare(result.raw, c.raw);
    compare(result.decision, c.decision);
    assert.ok(Math.abs(result.gain - c.gain) < 1e-12);
  }
});
test("production transform matches independent direct DFT including direction, scale and Parseval", () => {
  for (const vector of fixture.transforms) {
    compare(fft(flat(vector.x)), flat(vector.forward));
    compare(fft(flat(vector.x), true), flat(vector.inverse));
    const x = flat(vector.x),
      y = fft(x);
    assert.ok(
      Math.abs(
        x.reduce((s, v) => s + v * v, 0) - y.reduce((s, v) => s + v * v, 0),
      ) < 1e-10,
    );
    // These incorrect implementations must be rejected even if their inverse cancels them.
    if (vector.name.endsWith("impulse"))
      assert.throws(() =>
        compare(
          Float64Array.from(fft(x), (v) => v / Math.sqrt(x.length / 2)),
          flat(vector.forward),
        ),
      );
  }
});
test("continuous production link matches independent direct FIR and full Toeplitz matrix", () => {
  for (const c of fixture.channels) {
    const signal = Float64Array.from(
      c.grids.flatMap((g) => [...modulateOfdm(flat(g), c.cp)]),
    );
    compare(signal, flat(c.signal));
    compare(convolve(signal, c.taps), flat(c.output));
    compare(frequencyResponse(c.n, c.taps), flat(c.response));
    const output = convolve(signal, c.taps);
    c.received.forEach((y, m) =>
      compare(
        demodulateOfdm(
          output.subarray(2 * m * (c.n + c.cp), 2 * (m + 1) * (c.n + c.cp)),
          c.cp,
          c.n,
        ),
        flat(y),
      ),
    );
    if (c.cp === 3) assert.ok(c.residual.every((x) => x < 1e-24));
    else assert.ok(c.residual[1] > 0.01);
  }
});
