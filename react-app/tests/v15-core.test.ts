import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { receiverFfts, rotateSamples } from "../src/lib/ofdmSync/capture.js";
import {
  berBounds,
  controlledExperiment,
  controlledMetric,
  createFrame,
  estimateObservation,
  interaction,
  safeWindow,
  V15_TEST_RANDOM,
  type FrameConfig,
  type Metric,
} from "../src/research-v15/core.js";

type ReferenceCase = {
  config: FrameConfig;
  e: number;
  delta: number;
  wave: number[][];
  noise: number[][];
  capture: number[][];
  spectrum: number[][];
  metrics: { ed: Metric; e0: Metric; zD: Metric; z0: Metric };
  ideal: Metric;
  interaction: number;
};
const reference = spawnSync(
  "python",
  ["-I", "-B", "scripts/v15-reference.py"],
  { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
);
assert.equal(reference.status, 0, reference.stderr || String(reference.error));
const fixture = JSON.parse(reference.stdout) as {
  domain: string;
  cases: ReferenceCase[];
  windows: { cp: number; delays: number[]; delta: number; safe: boolean }[];
  outside: boolean[];
};

function close(actual: ArrayLike<number>, pairs: number[][], tolerance = 1e-9) {
  const expected = pairs.flat();
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) < tolerance,
      `sample ${i}: ${actual[i]} vs ${expected[i]}`,
    );
}

test("independent Python DFT/FIR agrees for four impairment cases and short CP", async () => {
  assert.equal(fixture.domain, V15_TEST_RANDOM);
  assert.equal(fixture.cases.length, 5);
  for (const v of fixture.cases) {
    const frame = await createFrame(v.config);
    close(frame.wave, v.wave);
    close(frame.noise, v.noise, 1e-12);
    close(frame.received, v.capture);
    const corrected = rotateSamples(
      frame.received,
      128,
      -(v.config.cfo - v.e),
      0,
      0,
    );
    const fft = receiverFfts(
      corrected,
      128,
      v.config.cp,
      32 + v.config.sto + 256 + v.delta,
      5,
    );
    close(fft[0], v.spectrum, 1e-9);
    const result = controlledExperiment(frame, v.e, v.delta);
    assert.deepEqual(
      { ed: result.ed, e0: result.e0, zD: result.zD, z0: result.z0 },
      v.metrics,
    );
    assert.ok(Math.abs(result.interaction.lower - v.interaction) < 1e-12);
    assert.ok(Math.abs(result.interaction.upper - v.interaction) < 1e-12);
    assert.deepEqual(controlledMetric(frame, 0, 0), v.metrics.z0);
    assert.deepEqual(
      v.metrics.z0,
      v.ideal,
      "truth phase removal is absorbed by training LS",
    );
    const repeated = await createFrame(v.config);
    assert.deepEqual(frame.received, repeated.received);
    assert.deepEqual(
      estimateObservation(frame.received, v.config.cp),
      estimateObservation(repeated.received, v.config.cp),
    );
  }
});

test("safe window uses nonzero tap endpoints, includes bounds, and can be empty", () => {
  for (const v of fixture.windows) {
    const taps = v.delays.map((delay) => ({ delay, i: 1, q: 0 }));
    assert.equal(safeWindow(v.cp, taps, v.delta), v.safe);
  }
  const taps = fixture.cases[0].config.taps;
  for (const d of [-9, -8, 0]) assert.equal(safeWindow(16, taps, d), true);
  for (const d of [-10, 1]) assert.equal(safeWindow(16, taps, d), false);
  for (let d = -10; d <= 10; d++) assert.equal(safeWindow(3, taps, d), false);
  assert.equal(safeWindow(0, [{ delay: 0, i: 1, q: 0 }], 0), true);
  assert.throws(() => safeWindow(16, [{ delay: 0, i: 0, q: 0 }], 0));
});

test("invalid FFT windows and interventions are rejected, not silently truncated", async () => {
  assert.deepEqual(fixture.outside, [true, true]);
  const frame = await createFrame(fixture.cases[0].config);
  assert.throws(() => controlledMetric(frame, 0, -1000));
  assert.throws(() => controlledMetric(frame, 0, 1000));
  assert.throws(() => controlledMetric(frame, NaN, 0));
  assert.throws(() => controlledMetric(frame, 0, 0.5));
  await assert.rejects(
    createFrame({ ...fixture.cases[0].config, frameId: -1 }),
  );
});

test("BER and interaction preserve erasure uncertainty and validate counts", () => {
  const a = { bits: 10, errors: 2, erasedBits: 3 };
  const b = { bits: 10, errors: 1, erasedBits: 2 };
  assert.deepEqual(berBounds(a), { lower: 0.2, upper: 0.5 });
  const x = interaction(a, b, b, a);
  assert.ok(Math.abs(x.lower - -0.2) < 1e-12);
  assert.ok(Math.abs(x.upper - 0.8) < 1e-12);
  assert.throws(() => berBounds({ bits: 10, errors: 8, erasedBits: 3 }));
});

test("zero received capture erases all 768 bits after zero-channel equalization failure", async () => {
  const frame = await createFrame(fixture.cases[0].config);
  const zeroObservation = new Float64Array(frame.received.length);
  const metric = controlledMetric(
    { ...frame, received: zeroObservation },
    0,
    0,
  );

  assert.deepEqual(metric, { bits: 768, errors: 0, erasedBits: 768 });
  assert.deepEqual(berBounds(metric), { lower: 0, upper: 1 });
});
