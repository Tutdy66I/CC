import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  countPilots,
  spacedPilots,
  commonDataBins,
  validateOfdmCombPlan,
} from "../src/lib/ofdmCombProtocol.js";
import { interpolateComplex, estimateComb } from "../src/lib/ofdmCombPilots.js";
import {
  simulateOfdmCombTrial,
  summarizeOfdmComb,
  combFrameInputs,
} from "../src/lib/ofdmCombResearch.js";
import { assembleCombFrame, energyBudget } from "../src/lib/ofdmCombEnergy.js";
import {
  makeOfdmCombRecord,
  makeOfdmCombCheckpoint,
  parseOfdmCombCheckpoint,
  assertOfdmCombResumeIdentity,
  assertOfdmCombCompletedPrefix,
} from "../src/lib/ofdmCombResearchRecord.js";
import {
  parseOfdmCheckpoint,
  serializeOfdmCheckpoint,
} from "../src/lib/ofdmResearchRecord.js";
const small = () => ({
  ...defaultOfdmCombPlan(),
  fftSize: 64,
  cp: 8,
  dataSymbols: 2,
  trials: 2,
  activeBins: [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6],
  pilotLayouts: [
    [-6, -2, 2, 6],
    [-6, -3, 3, 6],
  ],
  channels: ["awgn" as const],
  ebN0Db: [8],
});
const identity = {
  sourceFingerprint: "a".repeat(64),
  runtimeFingerprint: "b".repeat(64),
};
test("all modulations and energy bases retain gain-aware paired decisions and noiseless ideal/training recovery", async () => {
  for (const modulation of ["BPSK", "QPSK", "16QAM"] as const)
    for (const energyBasis of ["data-eb", "total-eb"] as const)
      for (const noiseEnabled of [true, false]) {
        const p = {
            ...small(),
            modulation,
            energyBasis,
            noiseEnabled,
            channels: ["awgn", "rayleigh"] as ("awgn" | "rayleigh")[],
          },
          t = await simulateOfdmCombTrial(p, 0);
        for (const c of t.cells) {
          for (const prefix of ["ideal", "training", "comb"] as const) {
            assert.equal(
              c.methods[`${prefix}-zf`].errors,
              c.methods[`${prefix}-mmse`].errors,
            );
            assert.equal(
              c.methods[`${prefix}-zf`].decisionErrorEnergy,
              c.methods[`${prefix}-mmse`].decisionErrorEnergy,
            );
          }
          if (!noiseEnabled) {
            assert.equal(c.methods["ideal-zf"].errors, 0);
            assert.equal(c.methods["training-zf"].errors, 0);
          }
        }
      }
});
test("comb layouts use signed physical coordinates and reject invalid pilot resources", () => {
  const p = small();
  validateOfdmCombPlan(defaultOfdmCombPlan());
  assert.deepEqual(
    countPilots([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6], 4),
    [-6, -2, 2, 6],
  );
  assert.deepEqual(spacedPilots([-3, -2, -1, 1, 2, 3], 2), [-3, -1, 1, 3]);
  for (const pilotLayouts of [
    [[0, 6]],
    [[-6, -6, 6]],
    [[-7, 6]],
    [[-5, 6]],
    [[-6, 1]],
    [[-6, 2, 1, 6]],
    [p.activeBins],
    [
      [-6, 6],
      [-6, 6],
    ],
    [[NaN, 6]],
  ])
    assert.throws(() => validateOfdmCombPlan({ ...p, pilotLayouts }));
  assert.throws(() => countPilots(p.activeBins, 1));
  assert.throws(() => spacedPilots(p.activeBins, 0));
  assert.throws(() =>
    validateOfdmCombPlan({
      ...p,
      pilotLayouts: [p.activeBins.filter((q) => q !== -1), [-6, -1, 6]],
    }),
  );
  assert.deepEqual(commonDataBins(p), [-5, -4, -1, 1, 4, 5]);
  for (const args of [
    [[-2, 2], [1, 0, 2, 0], [-3]],
    [[2, -2], [1, 0, 2, 0], [0]],
    [[-2, 2], [NaN, 0, 2, 0], [0]],
  ] as const)
    assert.throws(() =>
      interpolateComplex([...args[0]], [...args[1]], [...args[2]]),
    );
  assert.throws(() =>
    estimateComb([-2, 2], [1, 0, 1, 0], [0, 0, 1, 0], [-1, 1]),
  );
  assert.deepEqual(
    interpolateComplex([-3, 2], [0, 0, 10, 20], [-1, 1]),
    [4, 8, 8, 16],
  );
});
test("common data/noise pairing, energy accounting and deterministic resume are exact", async () => {
  const p = small(),
    input = await combFrameInputs(p, 0),
    a = assembleCombFrame(p, 0, input.virtual),
    b = assembleCombFrame(p, 1, input.virtual);
  for (const q of commonDataBins(p)) {
    const k = (q + 64) % 64;
    assert.deepEqual(
      [...a.grids[1].subarray(2 * k, 2 * k + 2)],
      [...b.grids[1].subarray(2 * k, 2 * k + 2)],
    );
  }
  for (const frame of [a, b])
    assert.ok(
      Math.abs(
        frame.energy.cp -
          frame.energy.trainingCp -
          frame.energy.pilotCp -
          frame.energy.dataCp -
          frame.energy.crossCp,
      ) < 1e-10,
    );
  const f = await freezeOfdmCombPlan(p),
    t = await Promise.all([0, 1].map((j) => simulateOfdmCombTrial(p, j)));
  assert.deepEqual(await simulateOfdmCombTrial(p, 1), t[1]);
  const r = await makeOfdmCombRecord(f, t, identity),
    cp = await makeOfdmCombCheckpoint(f, t.slice(0, 1), identity);
  assert.deepEqual(await parseOfdmCombCheckpoint(JSON.stringify(r)), r);
  assert.deepEqual(await parseOfdmCombCheckpoint(cp), cp);
  assert.throws(() => summarizeOfdmComb(f, t.slice(0, 1)));
  assert.throws(() =>
    assertOfdmCombResumeIdentity(cp, {
      ...identity,
      sourceFingerprint: "c".repeat(64),
    }),
  );
  assert.throws(() => assertOfdmCombCompletedPrefix(r, [t[0]]));
  assertOfdmCombCompletedPrefix(r, t);
  for (const c of t[0].cells)
    for (const prefix of ["ideal", "training", "comb"] as const) {
      assert.equal(
        c.methods[`${prefix}-zf`].errors,
        c.methods[`${prefix}-mmse`].errors,
      );
      assert.equal(
        c.methods[`${prefix}-zf`].decisionErrorEnergy,
        c.methods[`${prefix}-mmse`].decisionErrorEnergy,
      );
    }
  const bad = structuredClone(r);
  bad.trials[0].cells[0].methods["comb-zf"].bits++;
  await assert.rejects(() => parseOfdmCombCheckpoint(bad));
  const badSummary = structuredClone(r);
  badSummary.summary[0].ber = 0.9;
  await assert.rejects(() => parseOfdmCombCheckpoint(badSummary));
  const changed = await freezeOfdmCombPlan({ ...p, energyBasis: "total-eb" });
  assert.notEqual(changed.protocolHash, f.protocolHash);
  const total = await simulateOfdmCombTrial(
    { ...p, energyBasis: "total-eb" },
    0,
  );
  assert.ok(
    Math.abs(
      total.cells[0].noisePower -
        t[0].cells[0].noisePower * energyBudget(p).expectedEbTotal,
    ) < 1e-12,
  );
});
test("CP insufficient retains FIR interference and disables diagonal references", async () => {
  const p = {
    ...small(),
    cp: 0,
    noiseEnabled: false,
    channels: ["fixed" as const],
    taps: [
      { delay: 0, i: 1, q: 0, power: 1 },
      { delay: 3, i: 0.5, q: 0.2, power: 0.3 },
    ],
  };
  const t = await simulateOfdmCombTrial(p, 0);
  assert.ok(
    t.cells.every(
      (c) =>
        !c.cpSufficient &&
        c.estimation.bias === null &&
        c.estimation.noise === null,
    ),
  );
  assert.ok(t.cells[0].diagonalResidual[1] > 0.01);
  const f = await freezeOfdmCombPlan(p),
    summary = summarizeOfdmComb(f, [t, await simulateOfdmCombTrial(p, 1)]);
  assert.ok(
    summary.every(
      (s) => s.idealTheoryBer === null && s.interpolationBias === null,
    ),
  );
});
test("legacy v13.1 complete and partial records retain their exact export without migration", async () => {
  for (const name of ["record", "checkpoint"]) {
    const text = readFileSync(
        `tests/fixtures/ofdm-v131-legacy-${name}.json`,
        "utf8",
      ),
      r = await parseOfdmCheckpoint(text);
    assert.equal(serializeOfdmCheckpoint(r), text);
    await assert.rejects(() => parseOfdmCombCheckpoint(text));
  }
});
test("flat/noiseless link and strict deep-null erasures retain frame denominators", async () => {
  const p = { ...small(), noiseEnabled: false };
  const t = await simulateOfdmCombTrial(p, 0);
  for (const c of t.cells) {
    assert.ok(c.estimation.combError < 1e-25);
    assert.ok(c.estimation.trainingError < 1e-25);
    assert.ok(
      Object.values(c.methods).every(
        (m) => m.errors === 0 && m.erasedBits === 0,
      ),
    );
  }
  const zero = {
      ...p,
      channels: ["fixed" as const],
      taps: [{ delay: 0, i: 0, q: 0, power: 1 }],
    },
    f = await freezeOfdmCombPlan(zero),
    trials = await Promise.all(
      [0, 1].map((j) => simulateOfdmCombTrial(zero, j)),
    ),
    r = await makeOfdmCombRecord(f, trials, identity);
  assert.ok(
    r.summary.every(
      (s) =>
        s.ber === null && s.erasedBits === s.bits && s.channelNmse === null,
    ),
  );
});
test("small fixed-seed screen separates interpolation floor from pilot noise (not a formal study)", async () => {
  const active = Array.from({ length: 48 }, (_, j) =>
      j < 24 ? j - 24 : j - 23,
    ),
    p = {
      ...small(),
      activeBins: active,
      pilotLayouts: [countPilots(active, 4), countPilots(active, 8)],
      trials: 40,
      channels: ["fixed" as const],
      ebN0Db: [0, 40],
      taps: [
        { delay: 0, i: 1, q: 0, power: 1 },
        { delay: 7, i: 0, q: 0.6, power: 0.36 },
      ],
    },
    f = await freezeOfdmCombPlan(p),
    trials = [];
  for (let j = 0; j < p.trials; j++)
    trials.push(await simulateOfdmCombTrial(p, j));
  const s = summarizeOfdmComb(f, trials).filter(
    (s) => s.method === "comb-zf" && s.scope === "all",
  );
  for (const row of s) {
    assert.ok(
      Math.abs(row.lsMse - row.interpolationBias! - row.pilotNoise!) <
        0.2 * (row.interpolationBias! + row.pilotNoise!) + 0.002,
    );
    if (row.ebN0Db === 40) {
      assert.ok(row.interpolationBias! > 0.005);
      assert.ok(row.pilotNoise! < 0.000051);
    }
  }
  for (const row of summarizeOfdmComb(f, trials).filter(
    (s) => s.method === "training-zf" && s.scope === "all",
  ))
    assert.ok(
      Math.abs(row.lsMse - 10 ** (-row.ebN0Db / 10) / 2) <
        (0.2 * 10 ** (-row.ebN0Db / 10)) / 2,
    );
});
test("maximum FFT, full-length CP, Nyquist signed bin and maximum delay retain continuous-link model", async () => {
  const p = {
    ...small(),
    fftSize: 1024,
    cp: 1024,
    dataSymbols: 1,
    activeBins: [-512, -1, 1, 511],
    pilotLayouts: [[-512, 511]],
    noiseEnabled: false,
    channels: ["fixed" as const],
    taps: [
      { delay: 0, i: 1, q: 0, power: 1 },
      { delay: 1023, i: 0.2, q: 0.1, power: 0.05 },
    ],
  };
  const t = await simulateOfdmCombTrial(p, 0);
  assert.ok(
    t.cells.every(
      (c) => c.cpSufficient && c.diagonalResidual.every((v) => v < 1e-23),
    ),
  );
  assert.equal(t.cells[0].methods["ideal-zf"].errors, 0);
  assert.ok(Math.abs(energyBudget(p).cpSampleFraction - 0.5) < 1e-15);
});
