import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  controlledExperiment,
  controlledMetric,
  createFrame,
  type FrameConfig,
} from "../src/research-v15/core.js";
import {
  compareFrame,
  pairedDifference,
  runEngineeringBatch,
  scoreReceiver,
} from "../src/research-v15/comparison.js";
import {
  makeObservation,
  receiveAt,
  receiveEstimated,
  receiveRaw,
  type ReceiverOutput,
} from "../src/research-v15/receiver.js";

type Expected = {
  config: FrameConfig;
  kind: string;
  raw: Record<string, number | string>;
  ideal: Record<string, number | string>;
  estimated: Record<string, number | string>;
  acquisition: {
    status: string;
    reason?: string;
    cfo?: number;
    start?: number;
    peak?: number;
    score?: number;
    coherence?: number;
  };
};
const reference = spawnSync(
  "python",
  ["-I", "-B", "scripts/v15-p1b-reference.py"],
  { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
);
assert.equal(reference.status, 0, reference.stderr || String(reference.error));
const cases = JSON.parse(reference.stdout) as Expected[];

function check(
  result: ReceiverOutput,
  expected: Record<string, number | string>,
  frame: Awaited<ReturnType<typeof createFrame>>,
) {
  assert.equal(result.status, expected.status);
  const metric = scoreReceiver(result, frame.payload, frame.bins);
  assert.deepEqual(metric, {
    bits: expected.bits,
    errors: expected.errors,
    erasedBits: expected.erasedBits,
  });
}

test("independent Python validates all receiver branches and capture/window failures", async () => {
  assert.equal(cases.length, 12);
  for (const v of cases) {
    const frame = await createFrame(v.config);
    let samples = frame.received;
    if (v.kind === "zero") samples = new Float64Array(samples.length);
    if (v.kind === "short") samples = samples.slice(0, 1000);
    if (v.kind === "tiny") samples = samples.slice(0, 200);
    if (v.kind === "low-coherence" || v.kind === "low-correlation") {
      samples = new Float64Array(samples.length);
      for (let i = 0; i < 64; i++) {
        samples[2 * (96 + i)] = 1;
        samples[2 * (160 + i)] = v.kind === "low-coherence" && i % 2 ? -1 : 1;
      }
    }
    const obs = makeObservation(samples, v.config.cp);
    const raw = receiveRaw(obs),
      estimated = receiveEstimated(obs),
      ideal = receiveAt(
        obs,
        v.config.cfo,
        32 + v.config.sto + 256 + v.config.cp,
      );
    check(raw, v.raw, frame);
    check(estimated, v.estimated, frame);
    check(ideal, v.ideal, frame);
    if (v.acquisition.status === "ok") {
      assert.equal(estimated.acquisition.status, "ok");
      if (estimated.acquisition.status !== "ok")
        throw new Error("expected acquisition");
      assert.equal(estimated.acquisition.usefulStart, v.acquisition.start);
      assert.equal(estimated.acquisition.peak, v.acquisition.peak);
      for (const key of ["cfo", "coherence", "score"] as const)
        assert.ok(
          Math.abs(estimated.acquisition[key] - v.acquisition[key]!) < 1e-9,
          key,
        );
    } else {
      assert.equal(estimated.status, "capture-failed");
      if (estimated.status !== "capture-failed")
        throw new Error("expected failure");
      assert.equal(estimated.reason, v.acquisition.reason);
    }
  }
});

test("estimator useful start subtracts CP exactly once before receiverFfts", async () => {
  const frame = await createFrame(cases[3].config),
    result = compareFrame(frame, 0.2, -4);
  assert.equal(result.estimated.receiver.status, "ok");
  const receiver = result.estimated.receiver;
  if (receiver.status !== "ok") throw new Error("expected capture");
  const delta =
    receiver.usefulStart - (32 + frame.config.sto + 256 + frame.config.cp);
  assert.deepEqual(
    result.estimated.metric,
    controlledMetric(frame, frame.config.cfo - receiver.correction, delta),
  );
  assert.deepEqual(result.ideal.metric, controlledMetric(frame, 0, 0));
});

test("P1b retains all four P1a interventions and their interaction on the same capture", async () => {
  for (const entry of cases.slice(0, 5)) {
    const frame = await createFrame(entry.config);
    for (const [e, delta] of [
      [0.2, -4],
      [-0.2, 4],
    ]) {
      const a = compareFrame(frame, e, delta).controlled;
      const b = controlledExperiment(frame, e, delta);
      assert.deepEqual(
        {
          ed: a.ed.metric,
          e0: a.e0.metric,
          zD: a.zD.metric,
          z0: a.z0.metric,
          interaction: a.interaction,
        },
        b,
      );
    }
  }
});

test("runtime observation contains no truth or payload and is detached from source", async () => {
  const frame = await createFrame(cases[3].config),
    obs = makeObservation(frame.received, frame.config.cp);
  const initial = receiveEstimated(obs);
  assert.deepEqual(Object.keys(obs), ["cp"]);
  frame.received.fill(0);
  assert.deepEqual(receiveEstimated(obs), initial);
  const contaminated = { ...obs, cfo: 0.3, sto: 8, payload: frame.payload };
  assert.throws(() => receiveEstimated(contaminated));
  const first = await createFrame(cases[3].config);
  const altered = {
    ...first,
    config: {
      ...first.config,
      cfo: -0.4,
      sto: -5,
      taps: [{ delay: 0, i: 1, q: 0 }],
    },
    payload: first.payload.map((symbol) =>
      symbol.map((bits) => bits?.map((b) => 1 - b)),
    ),
  };
  const a = compareFrame(first, 0.1, 0),
    b = compareFrame(altered, 0.1, 0);
  assert.deepEqual(a.estimated.receiver, b.estimated.receiver);
  assert.deepEqual(a.raw.receiver, b.raw.receiver);
});

test("capture failure and post-capture incomplete window retain full erasures", async () => {
  const frame = await createFrame(cases[0].config);
  const zero = compareFrame(
    { ...frame, received: new Float64Array(frame.received.length) },
    0,
    0,
  );
  assert.equal(zero.estimated.receiver.status, "capture-failed");
  assert.deepEqual(zero.estimated.metric, {
    bits: 768,
    errors: 0,
    erasedBits: 768,
  });
  assert.deepEqual(zero.estimated.ber, { lower: 0, upper: 1 });
  assert.deepEqual(zero.controlled.interaction, { lower: -2, upper: 2 });
  const short = compareFrame(
    { ...frame, received: frame.received.slice(0, 1000) },
    0.1,
    0,
  );
  assert.equal(short.estimated.receiver.status, "window-failed");
  assert.equal(short.estimated.receiver.acquisition.status, "ok");
  assert.deepEqual(short.estimated.metric, {
    bits: 768,
    errors: 0,
    erasedBits: 768,
  });
  assert.equal(short.estimated.windowSafe, null);
  assert.equal(short.controlled.ed.status, "window-failed");
  assert.deepEqual(short.controlled.ed.metric, {
    bits: 768,
    errors: 0,
    erasedBits: 768,
  });
});

test("engineering batch is bounded, paired and refuses invalid configuration", async () => {
  const { frameId: _id, ...config } = cases[3].config;
  assert.equal(_id, 3);
  const first = await runEngineeringBatch(config, [101, 102], 0.2, -4);
  const repeat = await runEngineeringBatch(config, [101, 102], 0.2, -4);
  assert.deepEqual(first, repeat);
  assert.equal(first.purpose, "engineering-test-only");
  for (const frame of first.results) {
    assert.deepEqual(
      frame.paired.estimatedMinusRaw,
      pairedDifference(frame.estimated.metric, frame.raw.metric),
    );
    assert.deepEqual(
      frame.paired.estimatedMinusIdeal,
      pairedDifference(frame.estimated.metric, frame.ideal.metric),
    );
    assert.equal(frame.controlled.ed.metric.bits, 768);
    assert.deepEqual(
      frame.paired.jointInterventionMinusIdeal,
      pairedDifference(frame.controlled.ed.metric, frame.controlled.z0.metric),
    );
  }
  assert.equal(
    (
      await runEngineeringBatch(
        config,
        Array.from({ length: 16 }, (_, i) => i),
        0,
        0,
      )
    ).results.length,
    16,
  );
  const mutableConfig = { ...config, taps: config.taps.map((t) => ({ ...t })) },
    mutableIds = [70, 71];
  const pending = runEngineeringBatch(mutableConfig, mutableIds, 0, 0);
  mutableConfig.cfo = -0.75;
  mutableConfig.taps[0].i = 0.01;
  mutableIds[1] = 999;
  const snapshotted = await pending;
  assert.deepEqual(snapshotted.frameIds, [70, 71]);
  assert.equal(snapshotted.config.cfo, config.cfo);
  assert.equal(snapshotted.config.taps[0].i, config.taps[0].i);
  const pair = pairedDifference(
    { bits: 10, errors: 2, erasedBits: 3 },
    { bits: 10, errors: 1, erasedBits: 2 },
  );
  assert.ok(
    Math.abs(pair.lower + 0.1) < 1e-12 && Math.abs(pair.upper - 0.4) < 1e-12,
  );
  await assert.rejects(runEngineeringBatch(config, [1, 1], 0, 0));
  await assert.rejects(
    runEngineeringBatch(
      config,
      Array.from({ length: 17 }, (_, i) => i),
      0,
      0,
    ),
  );
  await assert.rejects(runEngineeringBatch(config, [1], 0, 1000));
  await assert.rejects(runEngineeringBatch(config, [1], NaN, 0));
  await assert.rejects(
    runEngineeringBatch({ ...config, noisePower: 1e7 }, [1], 0, 0),
  );
  assert.throws(() => makeObservation(Float64Array.of(1e13, 0), 16));
});
