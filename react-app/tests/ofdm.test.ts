import assert from "node:assert/strict";
import test from "node:test";
import { fft } from "../src/lib/fft.js";
import { addCp, removeCp } from "../src/lib/ofdm.js";
import { convolve, frequencyResponse } from "../src/lib/multipathChannel.js";
import { defaultOfdmPlan, validateOfdmPlan } from "../src/lib/ofdmProtocol.js";
import { energyBudget } from "../src/lib/ofdmEnergy.js";

const near = (a: number, b: number, tolerance = 1e-11) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("unitary FFT impulse and negative tone have independently known scale and direction", () => {
  const impulse = new Float64Array(16);
  impulse[0] = 1;
  const transformed = fft(impulse);
  for (let k = 0; k < 8; k++) {
    near(transformed[2 * k], 1 / Math.sqrt(8));
    near(transformed[2 * k + 1], 0);
  }
  const tone = Float64Array.from({ length: 16 }, (_, j) =>
    j % 2
      ? Math.sin((-2 * Math.PI * Math.floor(j / 2)) / 8)
      : Math.cos((-2 * Math.PI * Math.floor(j / 2)) / 8),
  );
  const bins = fft(tone);
  near(bins[14], Math.sqrt(8));
  near(bins[2], 0);
  near(
    bins.reduce((s, x) => s + x * x, 0),
    8,
  );
  assert.throws(() => fft(new Float64Array(6)));
});

test("continuous FIR preserves previous symbols; CP boundary uses maximum absolute delay", () => {
  const n = 8;
  const spectra = [1, 2, 3].map((s) =>
    Float64Array.from({ length: 2 * n }, (_, j) => Math.sin((j + 1) * s)),
  );
  const taps = [
    { delay: 1, i: 0.8, q: 0.2 },
    { delay: 3, i: -0.3, q: 0.1 },
  ];
  const h = frequencyResponse(n, taps);
  for (const cp of [3, 2, 0]) {
    const signal = Float64Array.from(
      spectra.flatMap((x) => [...addCp(fft(x, true), cp)]),
    );
    const received = convolve(signal, taps);
    let discrepancy = 0;
    for (let m = 0; m < 3; m++) {
      const y = fft(
        removeCp(
          received.subarray(2 * m * (n + cp), 2 * (m + 1) * (n + cp)),
          cp,
          n,
        ),
      );
      for (let k = 0; k < n; k++)
        discrepancy += Math.abs(
          y[2 * k] -
            (h[2 * k] * spectra[m][2 * k] -
              h[2 * k + 1] * spectra[m][2 * k + 1]),
        );
    }
    if (cp === 3) near(discrepancy, 0);
    else assert.ok(discrepancy > 0.01);
  }
});

test("energy ledger includes deterministic training CP and uses a fixed expected Eb", () => {
  const plan = defaultOfdmPlan();
  const e = energyBudget(plan);
  assert.equal(e.informationBits, 768);
  assert.ok(e.expectedTotalEnergy > e.expectedUsefulEnergy);
  near(e.expectedEbTotal, e.expectedTotalEnergy / e.informationBits);
  const noCp = energyBudget({ ...plan, cp: 0 });
  near(noCp.expectedEbTotal, 1.25);
  assert.throws(() => validateOfdmPlan({ ...plan, activeBins: [0, 1] }));
  assert.throws(() => validateOfdmPlan({ ...plan, trials: 100000 }));
  assert.throws(() =>
    validateOfdmPlan({ ...plan, taps: [{ delay: 128, i: 1, q: 0, power: 1 }] }),
  );
});
