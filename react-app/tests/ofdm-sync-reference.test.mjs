import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/ofdm-sync-p1-reference.json", import.meta.url),
    "utf8",
  ),
);
const flat = (values) => Float64Array.from(values.flat());
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  const err = Math.hypot(...actual.map((value, i) => value - expected[i]));
  const scale = Math.hypot(...expected);
  assert.ok(err <= 1e-12 + 1e-10 * scale, `L2 error ${err}`);
};

test("half-bin CFO rotates every continuous sample and produces ICI", async () => {
  const kernel =
    await import("../.test-build/src/lib/ofdmSync/capture.js").catch(
      () => null,
    );
  assert.ok(kernel, "v1.4 continuous capture kernel must exist");
  const actual = kernel.rotateSamples(
    Float64Array.from([1, 0, 1, 0, 1, 0, 1, 0]),
    4,
    0.5,
    0,
    0,
  );
  const a = Math.SQRT1_2;
  const expected = [1, 0, a, a, 0, 1, -a, a];
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12));
  const { fft } = await import("../.test-build/src/lib/fft.js");
  const spectrum = fft(actual);
  assert.ok(Math.abs(spectrum[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(spectrum[1] - (0.5 + a)) < 1e-12);
  assert.ok(
    Math.hypot(...spectrum.slice(2)) > 0.1,
    "CFO creates off-bin energy",
  );
});

test("continuous multipath capture and both noisy receiver paths match independent DFT/FIR vectors", async () => {
  const kernel = await import("../.test-build/src/lib/ofdmSync/capture.js");
  assert.equal(
    typeof kernel.captureFrame,
    "function",
    "captureFrame must create a complete received waveform",
  );
  assert.equal(
    typeof kernel.receiverFfts,
    "function",
    "receiverFfts must use each branch’s own waveform",
  );
  for (const vector of fixture.cases) {
    const received = kernel.captureFrame(
      flat(fixture.wave),
      fixture.taps,
      fixture.n,
      vector.cfo,
      vector.phase,
      fixture.guard,
      fixture.suffix,
      flat(fixture.noise),
    );
    close(received, flat(vector.received));
    const compensated = kernel.rotateSamples(
      received,
      fixture.n,
      -vector.cfo,
      -vector.phase,
      0,
    );
    close(compensated, flat(vector.compensated));
    const raw = kernel.receiverFfts(
      received,
      fixture.n,
      fixture.cp,
      fixture.guard,
      fixture.grids.length,
    );
    const ideal = kernel.receiverFfts(
      compensated,
      fixture.n,
      fixture.cp,
      fixture.guard,
      fixture.grids.length,
    );
    raw.forEach((v, index) => close(v, flat(vector.rawFft[index])));
    ideal.forEach((v, index) => close(v, flat(vector.idealFft[index])));
  }
});

test("P1 trial is reproducible, paired and exactly reduces to the zero-CFO receiver", async () => {
  const engine =
    await import("../.test-build/src/lib/ofdmSync/engine.js").catch(() => null);
  assert.ok(engine, "the isolated P1 simulation engine must exist");
  const plan = { ...engine.defaultSyncPlan(), cfo: 0, phase: 0 };
  const a = await engine.simulateSyncTrial(plan, 0);
  assert.deepEqual(a, await engine.simulateSyncTrial(plan, 0));
  assert.deepEqual(a.raw, a.ideal);
  assert.equal(a.raw.bits, 4 * 96 * 2);
  assert.notDeepEqual(a, await engine.simulateSyncTrial(plan, 1));
});

test("noise-free ideal compensation restores QPSK in a nondegenerate channel", async () => {
  const engine =
    await import("../.test-build/src/lib/ofdmSync/engine.js").catch(() => null);
  assert.ok(engine, "the isolated P1 simulation engine must exist");
  const plan = {
    ...engine.defaultSyncPlan(),
    cfo: 0.5,
    phase: 0.4,
    noiseEnabled: false,
  };
  const result = await engine.simulateSyncTrial(plan, 0);
  assert.equal(result.ideal.errors, 0);
  assert.equal(result.ideal.erasedBits, 0);
  assert.ok(result.ideal.errorEnergy < 1e-20);
  assert.ok(result.raw.errorEnergy > 1);
});

test("P1 protocol freezes all physical parameters and rejects malformed or excessive plans", async () => {
  const engine = await import("../.test-build/src/lib/ofdmSync/engine.js");
  const plan = engine.defaultSyncPlan();
  const frozen = await engine.freezeSyncPlan(plan);
  assert.equal(frozen.engineVersion, "ofdm-sync-v14-p1");
  assert.match(frozen.protocolHash, /^[a-f0-9]{64}$/);
  assert.equal(
    (await engine.freezeSyncPlan(plan)).protocolHash,
    frozen.protocolHash,
  );
  assert.notEqual(
    (await engine.freezeSyncPlan({ ...plan, cfo: 0.2 })).protocolHash,
    frozen.protocolHash,
  );
  for (const bad of [
    { ...plan, cfo: NaN },
    { ...plan, trials: 1001 },
    { ...plan, cp: 129 },
    { ...plan, taps: [{ delay: 0, i: 0, q: 0 }] },
    {
      ...plan,
      taps: [
        { delay: 2, i: 1, q: 0 },
        { delay: 2, i: 1, q: 0 },
      ],
    },
  ])
    assert.throws(() => engine.normalizeSyncPlan(bad));
});

test("capture rejects incomplete noise, non-finite samples and invalid windows", async () => {
  const { captureFrame, receiverFfts, rotateSamples } =
    await import("../.test-build/src/lib/ofdmSync/capture.js");
  assert.throws(() =>
    captureFrame(
      Float64Array.from([1, 0]),
      [{ delay: 0, i: 1, q: 0 }],
      4,
      0,
      0,
      1,
      1,
      new Float64Array(2),
    ),
  );
  assert.throws(() => rotateSamples(Float64Array.from([NaN, 0]), 4, 0, 0, 0));
  assert.throws(() => receiverFfts(new Float64Array(8), 4, 1, 0, 1));
});

test("zero-offset windows match the v1.3 demodulator on identical explicit samples", async () => {
  const { captureFrame, receiverFfts } =
    await import("../.test-build/src/lib/ofdmSync/capture.js");
  const { demodulateOfdm } = await import("../.test-build/src/lib/ofdm.js");
  const received = captureFrame(
    flat(fixture.wave),
    fixture.taps,
    fixture.n,
    0,
    0,
    fixture.guard,
    fixture.suffix,
    flat(fixture.noise),
  );
  const result = receiverFfts(
    received,
    fixture.n,
    fixture.cp,
    fixture.guard,
    fixture.grids.length,
  );
  result.forEach((actual, m) => {
    const start = 2 * (fixture.guard + m * (fixture.n + fixture.cp));
    const legacy = demodulateOfdm(
      received.slice(start, start + 2 * (fixture.n + fixture.cp)),
      fixture.cp,
      fixture.n,
    );
    close(actual, legacy);
  });
});

test("insufficient CP preserves real intersymbol interference instead of a diagonal shortcut", async () => {
  const { captureFrame, receiverFfts } =
    await import("../.test-build/src/lib/ofdmSync/capture.js");
  const f = fixture.shortCp;
  const noise = new Float64Array(flat(f.clean).length);
  const received = captureFrame(
    flat(f.wave),
    fixture.taps,
    fixture.n,
    0,
    0,
    0,
    0,
    noise,
  );
  close(received, flat(f.clean));
  const rx = receiverFfts(received, fixture.n, f.cp, 0, fixture.grids.length);
  rx.forEach((v, m) => close(v, flat(f.fft[m])));
  const expected = fixture.grids[1].map(([xr, xi], k) => {
    const [hr, hi] = f.frequency[k];
    return [hr * xr - hi * xi, hr * xi + hi * xr];
  });
  assert.ok(Math.hypot(...rx[1].map((v, i) => v - flat(expected)[i])) > 0.01);
});

test("independent Python reference and RNG domain reproduce frozen vectors", async () => {
  const python = spawnSync(
    process.env.SIGNALLAB_PYTHON || "python3",
    ["-I", "-B", "scripts/ofdm-sync-reference.py"],
    { encoding: "utf8" },
  );
  assert.equal(python.status, 0, python.stderr || python.error?.message);
  const compareFixture = (a, b) => {
    if (typeof a === "number" && typeof b === "number") {
      assert.ok(Math.abs(a - b) <= 1e-12 + Math.abs(b) * 1e-12);
    } else if (a && typeof a === "object") {
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const key of Object.keys(a)) compareFixture(a[key], b[key]);
    } else assert.deepEqual(a, b);
  };
  compareFixture(JSON.parse(python.stdout), fixture);
  const engine = await import("../.test-build/src/lib/ofdmSync/engine.js");
  assert.equal(
    typeof engine.deriveSyncState,
    "function",
    "RNG state derivation must be independently checkable",
  );
  assert.deepEqual(
    await engine.deriveSyncState(20261028, 7, "data", 2),
    fixture.randomState,
  );
  assert.notDeepEqual(
    await engine.deriveSyncState(20261028, 7, "noise", 2),
    fixture.randomState,
  );
});

test("P1 Worker emits an isolated versioned protocol and both branch results", async () => {
  const messages = [];
  globalThis.self = {
    postMessage: (message) => messages.push(message),
    close: () => {},
  };
  try {
    const worker =
      await import("../.test-build/src/workers/ofdmSync.worker.js").catch(
        () => null,
      );
    assert.ok(worker, "P1 Worker module must exist");
    const { defaultSyncPlan } =
      await import("../.test-build/src/lib/ofdmSync/engine.js");
    await globalThis.self.onmessage({
      data: {
        type: "start",
        runId: "p1-test",
        plan: { ...defaultSyncPlan(), trials: 2 },
      },
    });
    const done = messages.find((m) => m.type === "done");
    assert.ok(done);
    assert.equal(done.runId, "p1-test");
    assert.equal(done.engineVersion, "ofdm-sync-v14-p1");
    assert.match(done.protocolHash, /^[a-f0-9]{64}$/);
    assert.match(done.sourceFingerprint, /^[a-f0-9]{64}$/);
    assert.match(done.runtimeFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(done.completed, 2);
    assert.equal(
      messages.filter((m) => m.type === "batch").flatMap((m) => m.trials)
        .length,
      2,
    );
  } finally {
    delete globalThis.self;
  }
});
