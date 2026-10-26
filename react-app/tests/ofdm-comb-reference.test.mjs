import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  interpolateComplex,
  interpolationWeights,
  estimateComb,
} from "../.test-build/src/lib/ofdmCombPilots.js";
import { defaultOfdmCombPlan } from "../.test-build/src/lib/ofdmCombProtocol.js";
import {
  assembleCombFrame,
  energyBudget,
} from "../.test-build/src/lib/ofdmCombEnergy.js";
import { convolve } from "../.test-build/src/lib/multipathChannel.js";
import { demodulateOfdm } from "../.test-build/src/lib/ofdm.js";
import { fullTrainingLs } from "../.test-build/src/lib/ofdmEqualizer.js";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/ofdm-comb-reference.json", "utf8").replace(
    /^\uFEFF/,
    "",
  ),
);
const flat = (x) => Float64Array.from(x.flat());
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-10 * (1 + Math.abs(b)), `${a} vs ${b}`);
const compare = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, j) => near(v, b[j]));
};
test("independent Python reference regenerates (no production imports)", () => {
  const r = spawnSync(
    process.env.SIGNALLAB_PYTHON || "python3",
    ["scripts/ofdm-comb-reference.py"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  const visit = (a, b) => {
    if (typeof a === "number") near(a, b);
    else if (a && typeof a === "object") {
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const k of Object.keys(a)) visit(a[k], b[k]);
    } else assert.deepEqual(a, b);
  };
  visit(JSON.parse(r.stdout), fixture);
});
test("constant and complex affine responses match independent interpolation across DC", () => {
  for (const v of fixture.vectors) {
    compare(
      interpolateComplex(v.positions, [...flat(v.values)], v.targets),
      flat(v.estimate),
    );
    compare(
      interpolationWeights(v.positions, v.targets).map(
        (w) => w.a * w.a + w.b * w.b,
      ),
      v.weights,
    );
  }
  const v = fixture.vectors[1],
    i = v.targets.indexOf(-1),
    expected = v.estimate[i];
  near(expected[0], 0.17);
  near(expected[1], -0.58);
});
test("noiseless bias and high-SNR floors depend on physical pilot density and delay spread", () => {
  for (const f of fixture.floors) {
    const active = fixture.frames[0].active,
      data = active.filter((q) => !f.positions.includes(q)),
      h = (q) => [
        1 + 0.6 * Math.sin((2 * Math.PI * q * f.delay) / 64),
        0.6 * Math.cos((2 * Math.PI * q * f.delay) / 64),
      ],
      estimate = interpolateComplex(f.positions, f.positions.flatMap(h), data),
      weights = interpolationWeights(f.positions, data),
      bias =
        data.reduce(
          (s, q, j) =>
            s +
            (estimate[2 * j] - h(q)[0]) ** 2 +
            (estimate[2 * j + 1] - h(q)[1]) ** 2,
          0,
        ) / data.length;
    near(bias, f.bias);
    near(
      bias +
        weights.reduce((s, w) => s + w.a * w.a + w.b * w.b, 0) /
          data.length /
          2,
      f.mse0,
    );
    assert.ok(f.mse40 >= bias && f.mse40 - bias < 0.000051);
  }
  const slow = fixture.floors.filter((f) => f.delay === 1),
    fast = fixture.floors.filter((f) => f.delay === 7);
  assert.ok(slow[2].bias < slow[1].bias && slow[1].bias < slow[0].bias);
  assert.ok(fast[0].bias > slow[0].bias && fast[2].bias > slow[2].bias);
});
test("assembled CP, continuous FIR, noisy LS/interpolation and energy match independent direct DFT", () => {
  for (const f of fixture.frames) {
    const p = {
        ...defaultOfdmCombPlan(),
        fftSize: f.n,
        cp: f.cp,
        activeBins: f.active,
        dataSymbols: 2,
        trials: 2,
        channels: ["fixed"],
        ebN0Db: [8],
        taps: f.taps,
        pilotLayouts: [f.positions],
      },
      assembled = assembleCombFrame(p, 0, f.virtual.map(flat)),
      clean = convolve(assembled.wave, f.taps),
      noisy = Float64Array.from(
        assembled.wave,
        (_, j) => clean[j] + flat(f.noise)[j],
      );
    compare(assembled.wave, flat(f.wave));
    compare(clean, flat(f.output));
    for (const [key, value] of Object.entries(f.energy))
      near(assembled.energy[key], value);
    near(energyBudget(p).expectedCpEnergy, f.expectedCp);
    near(energyBudget(p).expectedEbTotal, f.expectedEbTotal);
    for (let m = 0; m < 3; m++) {
      compare(assembled.grids[m], flat(f.grids[m]));
      const rx = demodulateOfdm(
          noisy.subarray(2 * m * (f.n + f.cp), 2 * (m + 1) * (f.n + f.cp)),
          f.cp,
          f.n,
        ),
        at = (q) => {
          const k = (q + f.n) % f.n;
          return [rx[2 * k], rx[2 * k + 1]];
        };
      compare(rx, flat(f.received[m]));
      if (m === 0)
        compare(
          fullTrainingLs(
            f.active.flatMap(at),
            f.active.flatMap((q) => f.grids[0][(q + f.n) % f.n]),
          ),
          flat(f.trainingLs),
        );
      else {
        const result = estimateComb(
          f.positions,
          f.positions.flatMap(at),
          f.positions.flatMap((q) => f.grids[m][(q + f.n) % f.n]),
          f.active,
        );
        compare(result.pilotLs, flat(f.pilotLs[m - 1]));
        compare(result.estimate, flat(f.interpolated[m - 1]));
      }
    }
  }
  // Some pilot layouts have zero tail energy. Other fixtures must expose the
  // nonzero data/pilot CP cross term rather than assuming it always vanishes.
  assert.ok(fixture.frames.some((f) => Math.abs(f.energy.crossCp) > 0.01));
  assert.ok(fixture.frames.some((f) => Math.abs(f.energy.pilotCp) < 1e-20));
});
