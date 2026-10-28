import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/ofdm-sync-estimation-reference.json", import.meta.url),
    "utf8",
  ),
);
const flat = (pairs) => Float64Array.from(pairs.flat());

test("CFO estimation uses repeated noisy observations and matches independent complex correlations", async () => {
  const sync =
    await import("../.test-build/src/lib/ofdmSync/synchronizer.js").catch(
      () => null,
    );
  assert.ok(sync, "the observation-only synchronization module must exist");
  assert.equal(typeof sync.estimateCfo, "function");
  for (const vector of fixture.vectors) {
    const result = sync.estimateCfo(
      flat(vector.samples),
      fixture.n,
      fixture.start,
      fixture.lag,
      fixture.count,
    );
    assert.equal(result.status, "ok");
    assert.ok(Math.abs(result.cfo - vector.expected.cfo) < 1e-10);
    assert.ok(Math.abs(result.coherence - vector.expected.coherence) < 1e-10);
  }
});

test("CFO estimator rejects absent and degenerate observations and never guesses an alias", async () => {
  const sync =
    await import("../.test-build/src/lib/ofdmSync/synchronizer.js").catch(
      () => null,
    );
  assert.ok(sync, "the observation-only synchronization module must exist");
  assert.equal(
    sync.estimateCfo(new Float64Array(512), 128, 64, 64, 64).status,
    "failed",
  );
  assert.throws(() => sync.estimateCfo(new Float64Array(4), 128, 0, 64, 64));
  const aliased = fixture.vectors.find((v) => v.inputCfo === 1.25);
  const result = sync.estimateCfo(flat(aliased.samples), 128, 64, 64, 64);
  assert.ok(Math.abs(result.cfo - -0.75) < 1e-10);
});

test("timing search matches independent normalized correlations and declared backoff", async () => {
  const sync = await import("../.test-build/src/lib/ofdmSync/synchronizer.js");
  assert.equal(
    typeof sync.estimateTiming,
    "function",
    "observation-only timing search must exist",
  );
  for (const vector of fixture.timing) {
    const result = sync.estimateTiming(
      flat(vector.samples),
      flat(fixture.timingReference),
      4,
      20,
      2,
    );
    assert.equal(result.status, "ok");
    assert.equal(result.peak, vector.best);
    assert.equal(result.start, vector.start);
    assert.ok(Math.abs(result.score - vector.score) < 1e-10);
  }
  assert.equal(
    sync.estimateTiming(
      new Float64Array(80),
      flat(fixture.timingReference),
      4,
      20,
      2,
    ).status,
    "failed",
  );
  assert.throws(() =>
    sync.estimateTiming(
      new Float64Array(8),
      flat(fixture.timingReference),
      0,
      8,
      2,
    ),
  );
});

test("joint simulation recovers noiseless in-range CFO and integer timing without truth leakage", async () => {
  const engine =
    await import("../.test-build/src/lib/ofdmSync/jointEngine.js").catch(
      () => null,
    );
  assert.ok(engine, "joint receiver engine must exist");
  for (const sto of [-12, 0, 12]) {
    const plan = {
      ...engine.defaultJointPlan(),
      sto,
      cfo: 0.375,
      phase: 0.4,
      noiseEnabled: false,
    };
    const result = await engine.simulateJointTrial(plan, 0);
    assert.equal(result.estimated.status, "ok");
    assert.ok(Math.abs(result.estimated.cfo - 0.375) < 1e-10);
    assert.equal(result.evaluation.estimatedWindowSafe, true);
    assert.equal(result.estimated.metric.errors, 0);
    assert.equal(result.estimated.metric.erasedBits, 0);
    assert.equal(result.ideal.errors, 0);
    assert.deepEqual(result, await engine.simulateJointTrial(plan, 0));
  }
});

test("joint failure is retained as erasures, never repaired using simulation truth", async () => {
  const engine =
    await import("../.test-build/src/lib/ofdmSync/jointEngine.js").catch(
      () => null,
    );
  assert.ok(engine, "joint receiver engine must exist");
  const acquire = engine.acquireJointObservation;
  assert.equal(typeof acquire, "function");
  const empty = new Float64Array(2 * 1200);
  const a = acquire(empty, 16);
  assert.equal(a.status, "failed");
  assert.equal(a.reason, "low-energy");
});

test("joint protocol separates P1 identity and freezes offset and acquisition rules", async () => {
  const engine =
    await import("../.test-build/src/lib/ofdmSync/jointEngine.js").catch(
      () => null,
    );
  assert.ok(engine, "joint receiver engine must exist");
  const plan = engine.defaultJointPlan(),
    a = await engine.freezeJointPlan(plan);
  assert.match(a.protocolHash, /^[a-f0-9]{64}$/);
  assert.notEqual(a.engineVersion, "ofdm-sync-v14-p1");
  assert.notEqual(
    (await engine.freezeJointPlan({ ...plan, sto: 1 })).protocolHash,
    a.protocolHash,
  );
  assert.throws(() => engine.normalizeJointPlan({ ...plan, sto: 17 }));
});

test("public repeated training has no shorter cyclic period than 64 samples", async () => {
  const { publicSyncPreamble } =
    await import("../.test-build/src/lib/ofdmSync/jointEngine.js");
  const samples = publicSyncPreamble();
  assert.equal(samples.length, fixture.preamble.length * 2);
  flat(fixture.preamble).forEach((v, i) =>
    assert.ok(Math.abs(samples[i] - v) < 1e-12),
  );
  for (let lag = 1; lag < 64; lag++) {
    let equal = true;
    for (let i = 0; i < 64; i++)
      if (
        samples[2 * i] !== samples[2 * ((i + lag) % 64)] ||
        samples[2 * i + 1] !== samples[2 * ((i + lag) % 64) + 1]
      ) {
        equal = false;
        break;
      }
    assert.equal(equal, false, `unexpected ${lag}-sample subperiod`);
  }
});

test("joint receiver handles multipath and both integer timing boundaries without oracle timing", async () => {
  const { defaultJointPlan, simulateJointTrial } =
    await import("../.test-build/src/lib/ofdmSync/jointEngine.js");
  for (const sto of [-16, 16]) {
    const result = await simulateJointTrial(
      {
        ...defaultJointPlan(),
        sto,
        cfo: -0.75,
        noiseEnabled: false,
        taps: [
          { delay: 0, i: 0.8, q: 0.1 },
          { delay: 3, i: 0.2, q: -0.1 },
          { delay: 7, i: 0.1, q: 0.05 },
        ],
      },
      0,
    );
    assert.equal(result.estimated.status, "ok");
    assert.ok(Math.abs(result.estimated.cfo + 0.75) < 1e-10);
    assert.equal(result.evaluation.estimatedWindowSafe, true);
    assert.equal(result.estimated.metric.errors, 0);
    assert.equal(result.ideal.errors, 0);
  }
});

test("joint Worker returns complete paired branches and versioned identities", async () => {
  const messages = [];
  globalThis.self = {
    postMessage: (message) => messages.push(message),
    close: () => {},
  };
  try {
    const worker =
      await import("../.test-build/src/workers/jointSync.worker.js").catch(
        () => null,
      );
    assert.ok(worker, "joint synchronization Worker must exist");
    const { defaultJointPlan } =
      await import("../.test-build/src/lib/ofdmSync/jointEngine.js");
    await globalThis.self.onmessage({
      data: {
        type: "start",
        runId: "joint-test",
        plan: { ...defaultJointPlan(), trials: 2 },
      },
    });
    const done = messages.find((m) => m.type === "done");
    assert.equal(done?.engineVersion, "ofdm-sync-v14-joint-1");
    assert.equal(done.completed, 2);
    assert.match(done.protocolHash, /^[a-f0-9]{64}$/);
    assert.match(done.sourceFingerprint, /^[a-f0-9]{64}$/);
    const trials = messages
      .filter((m) => m.type === "batch")
      .flatMap((m) => m.trials);
    assert.equal(trials.length, 2);
    assert.ok(trials.every((t) => t.raw && t.ideal && t.estimated));
  } finally {
    delete globalThis.self;
  }
});

test("the independent reference regenerates within floating-point tolerance", () => {
  const r = spawnSync(
    process.env.SIGNALLAB_PYTHON || "python3",
    ["-I", "-B", "scripts/ofdm-sync-estimation-reference.py"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  const compare = (a, b) => {
    if (typeof a === "number" && typeof b === "number")
      assert.ok(Math.abs(a - b) <= 1e-12 + Math.abs(b) * 1e-12);
    else if (a && typeof a === "object") {
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const k of Object.keys(a)) compare(a[k], b[k]);
    } else assert.deepEqual(a, b);
  };
  compare(JSON.parse(r.stdout), fixture);
});
