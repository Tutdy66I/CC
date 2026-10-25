import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  createFadingRandom,
  deriveFadingState,
  xoshiro128StarStar,
} from "../src/lib/fadingRandom.js";
import { applyFlatChannel, sampleFlatChannel } from "../src/lib/flatFading.js";
import { estimatePilotChannel } from "../src/lib/channelEstimator.js";
import { zeroForcingEqualize } from "../src/lib/channelEqualizer.js";
import {
  channelBer,
  simulateChannelTrial,
} from "../src/lib/channelSimulation.js";
import type { ChannelPlan } from "../src/lib/channelTypes.js";

const plan: ChannelPlan = {
  frameSymbols: 128,
  modulation: "QPSK",
  ebN0Db: [0, 8],
  pilotCounts: [4, 8],
  channels: ["awgn", "rayleigh-block", "rayleigh-iid"],
  trials: 20,
  seed: 42,
  energyBasis: "data-eb",
  noiseEnabled: true,
};
const close = (actual: number, expected: number, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

test("SHA256 role domains use four little-endian words and reject all-zero xoshiro state", async () => {
  const digest = createHash("sha256")
    .update("signallab-channel-rng-v1|42|7|channel")
    .digest();
  assert.deepEqual(await deriveFadingState(42, 7, "channel"), [
    digest.readUInt32LE(0),
    digest.readUInt32LE(4),
    digest.readUInt32LE(8),
    digest.readUInt32LE(12),
  ]);
  assert.throws(() => xoshiro128StarStar([0, 0, 0, 0]), /zero|零/);
  const random = xoshiro128StarStar([1, 2, 3, 4]);
  close(random(), 11520 / 2 ** 32, 0);
  close(random(), 0, 0);
  close(random(), 5927040 / 2 ** 32, 0);
});

test("random roles reproduce and complex Gaussian samples have unit mean power without sample normalization", async () => {
  const a = await createFadingRandom(0, 3, "noise");
  const b = await createFadingRandom(0, 3, "noise");
  const other = await createFadingRandom(0, 3, "channel");
  assert.deepEqual(a.complex(), b.complex());
  assert.notDeepEqual(a.complex(), other.complex());
  let power = 0,
    iMean = 0,
    qMean = 0,
    deep = 0;
  for (let n = 0; n < 100_000; n++) {
    const z = a.complex();
    const p = z.i ** 2 + z.q ** 2;
    power += p;
    iMean += z.i;
    qMean += z.q;
    if (p < 0.01) deep++;
  }
  assert.ok(Math.abs(power / 100_000 - 1) < 0.015);
  assert.ok(Math.abs(iMean / 100_000) < 0.01);
  assert.ok(Math.abs(qMean / 100_000) < 0.01);
  assert.ok(Math.abs(deep / 100_000 - (1 - Math.exp(-0.01))) < 0.002);
});

test("complex channel multiplication and model choices match hand arithmetic", () => {
  assert.deepEqual(
    applyFlatChannel({ i: 2, q: -1 }, { i: 3, q: 4 }, { i: 1, q: -2 }, 4),
    { i: 12, q: 1 },
  );
  const unit = { i: 3, q: 4 },
    block = { i: 2, q: -1 };
  assert.deepEqual(sampleFlatChannel("awgn", unit, block), { i: 1, q: 0 });
  assert.deepEqual(sampleFlatChannel("rayleigh-block", unit, block), block);
  assert.deepEqual(sampleFlatChannel("rayleigh-iid", unit, block), unit);
});

test("complex LS weights pilot energy and depends only on supplied observations", () => {
  const fit = estimatePilotChannel([
    { tx: { i: 1, q: 1 }, received: { i: 0, q: 3 } },
    { tx: { i: 2, q: 0 }, received: { i: 2, q: 3 } },
  ]);
  assert.equal(fit.status, "ok");
  if (fit.status === "ok") {
    close(fit.estimate.i, 7 / 6);
    close(fit.estimate.q, 1.5);
  }
  assert.equal(estimatePilotChannel([]).status, "failed");
  assert.equal(
    estimatePilotChannel([{ tx: { i: 0, q: 0 }, received: { i: 1, q: 1 } }])
      .status,
    "failed",
  );
});

test("ZF has no deep-fade epsilon and represents exact-zero CSI explicitly", () => {
  const out = zeroForcingEqualize({ i: 3, q: 4 }, { i: 1, q: 2 });
  assert.equal(out.failure, null);
  assert.ok(out.sample);
  close(out.sample.i, 2.2);
  close(out.sample.q, -0.4);
  const tiny = zeroForcingEqualize({ i: 1e-100, q: 0 }, { i: 1e-100, q: 0 });
  assert.equal(tiny.failure, null);
  assert.deepEqual(tiny.sample, { i: 1, q: 0 });
  const zero = zeroForcingEqualize({ i: 3, q: 4 }, { i: 0, q: 0 });
  assert.equal(zero.failure, "zero-csi");
  assert.equal(zero.sample, null);
});

test("closed-form theory agrees with independently tabulated coherent BER at 0dB and supports 20dB", () => {
  close(channelBer("BPSK", "awgn", 0), 0.07864960352514258, 2e-14);
  close(channelBer("QPSK", "rayleigh-block", 0), 0.1464466094067262, 1e-14);
  close(channelBer("BPSK", "rayleigh-iid", 20), 0.0024814048950054235, 1e-14);
  for (const model of plan.channels) {
    assert.ok(channelBer("16QAM", model, 20) > 0);
    assert.ok(channelBer("16QAM", model, 20) < channelBer("16QAM", model, 0));
  }
});

test("Rayleigh Gray-16QAM reference matches independent Craig-integral Simpson quadrature", () => {
  for (const db of [-4, 0, 8, 20]) {
    const gamma = 10 ** (db / 10);
    const integrate = (a: number) => {
      const intervals = 4096;
      const step = Math.PI / (2 * intervals);
      let sum = 0;
      for (let n = 0; n <= intervals; n++) {
        const s = Math.sin(n * step) ** 2;
        const weight = n === 0 || n === intervals ? 1 : n % 2 ? 4 : 2;
        sum += (weight * s) / (s + a * gamma);
      }
      return (sum * step) / (3 * Math.PI);
    };
    const reference =
      0.75 * integrate(0.4) + 0.5 * integrate(3.6) - 0.25 * integrate(10);
    close(channelBer("16QAM", "rayleigh-block", db), reference, 1e-13);
    close(channelBer("16QAM", "rayleigh-iid", db), reference, 1e-13);
  }
});

test("one received frame is shared by methods, pilot counts and SNR with absolute-index noise pairing", async () => {
  const result = await simulateChannelTrial(plan, 0);
  assert.equal(result.cells.length, 12);
  const low = result.cells.find(
    (c) => c.model === "rayleigh-block" && c.ebN0Db === 0 && c.pilots === 4,
  )!;
  const high = result.cells.find(
    (c) => c.model === "rayleigh-block" && c.ebN0Db === 8 && c.pilots === 8,
  )!;
  const shared = low.preview.find((p) => p.index >= 8)!;
  const peer = high.preview.find((p) => p.index === shared.index)!;
  assert.ok(peer);
  assert.deepEqual(shared.tx, peer.tx);
  assert.deepEqual(shared.h, peer.h);
  const clean = applyFlatChannel(shared.tx, shared.h, { i: 0, q: 0 }, 0);
  close(
    (shared.received.i - clean.i) / Math.sqrt(low.noisePower),
    (peer.received.i - clean.i) / Math.sqrt(high.noisePower),
  );
  close(
    (shared.received.q - clean.q) / Math.sqrt(low.noisePower),
    (peer.received.q - clean.q) / Math.sqrt(high.noisePower),
  );
  assert.equal(low.methods.ideal.common.bits, 240);
  assert.equal(high.methods.ideal.common.bits, 240);
  assert.deepEqual(result, await simulateChannelTrial(plan, 0));
  assert.ok(
    (await simulateChannelTrial(plan, 1)).cells.every(
      (c) => c.preview.length === 0,
    ),
  );
});

test("noise-free constant channels recover all three modulations, whereas iid pilots cannot determine data channels", async () => {
  for (const modulation of ["BPSK", "QPSK", "16QAM"] as const) {
    const trial = await simulateChannelTrial(
      { ...plan, modulation, noiseEnabled: false },
      0,
    );
    assert.equal(trial.cells.length, 12);
    for (const c of trial.cells) {
      assert.equal(c.methods.ideal.all.errors, 0);
      assert.ok(c.methods.ideal.all.evmRms! < 1e-14);
      if (c.model !== "rayleigh-iid") {
        assert.equal(c.methods.ls.all.errors, 0);
        assert.ok(c.estimationSquaredError! < 1e-28);
      } else {
        assert.ok(c.estimationSquaredError! > 0.05);
      }
    }
  }
});

test("total-Eb accounting includes pilots and all/common energy uses actual surviving symbols", async () => {
  const trial = await simulateChannelTrial(
    { ...plan, modulation: "16QAM", energyBasis: "total-eb" },
    0,
  );
  assert.equal(trial.cells.length, 12);
  for (const c of trial.cells) {
    close(
      c.noisePower,
      plan.frameSymbols /
        (plan.frameSymbols - c.pilots) /
        10 ** (c.ebN0Db / 10),
    );
    close(c.pilotEnergy, c.pilots * 4);
    close(c.totalEnergy, c.pilotEnergy + c.dataEnergy);
    assert.equal(c.methods.raw.all.signalEnergy, c.dataEnergy);
    assert.equal(c.methods.raw.common.signalEnergy, c.commonDataEnergy);
    assert.equal(c.methods.raw.all.bits, c.dataSymbols * 4);
  }
});

test("block LS MSE follows N0/(P*Ep), while iid payload prediction retains 1+(1+N0/Ep)/P", async () => {
  const trials = 800;
  const p: ChannelPlan = {
    ...plan,
    frameSymbols: 64,
    ebN0Db: [0],
    pilotCounts: [8],
    channels: ["rayleigh-block", "rayleigh-iid"],
    trials,
  };
  let block = 0,
    iid = 0,
    meanBlockPower = 0;
  for (let n = 0; n < trials; n++) {
    const trial = await simulateChannelTrial(p, n);
    block += trial.cells[0].estimationSquaredError!;
    iid += trial.cells[1].estimationSquaredError!;
    meanBlockPower += trial.cells[0].hMeanPower;
  }
  // Independent-frame Monte Carlo tolerances fixed before this run, approximately six standard errors.
  close(block / trials, 1 / (8 * 2), 0.015);
  close(iid / trials, 1 + (1 + 1 / 2) / 8, 0.085);
  close(meanBlockPower / trials, 1, 0.15);
});

test("public -10dB and total-Eb conversion below -4dB keep finite internal reference BER", async () => {
  const trial = await simulateChannelTrial(
    { ...plan, ebN0Db: [-10, -4], pilotCounts: [16], energyBasis: "total-eb" },
    0,
  );
  assert.equal(trial.cells.length, 6);
  for (const cell of trial.cells) {
    const dataDb = 10 * Math.log10(1 / cell.noisePower);
    assert.ok(dataDb < cell.ebN0Db);
    const reference = channelBer(plan.modulation, cell.model, dataDb);
    assert.ok(Number.isFinite(reference) && reference > 0 && reference <= 0.5);
  }
  for (const model of plan.channels)
    for (const modulation of ["BPSK", "QPSK", "16QAM"] as const) {
      const low = channelBer(modulation, model, -100);
      const high = channelBer(modulation, model, 100);
      assert.ok(Number.isFinite(low) && low > 0.49 && low <= 0.5);
      assert.ok(Number.isFinite(high) && high >= 0 && high < low);
    }
  assert.throws(() => channelBer("BPSK", "awgn", NaN));
  assert.throws(() => channelBer("BPSK", "awgn", Infinity));
});
