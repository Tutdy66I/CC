import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { handshakeOfdmCombWorker } from "../src/lib/ofdmCombIdentity.js";
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
} from "../src/lib/ofdmCombProtocol.js";
import { simulateOfdmCombTrial } from "../src/lib/ofdmCombResearch.js";
import {
  makeOfdmCombCheckpoint,
  makeOfdmCombRecord,
  parseOfdmCombCheckpoint,
  assertOfdmCombResumeIdentity,
  assertOfdmCombCompletedPrefix,
  serializeOfdmCombCheckpoint,
} from "../src/lib/ofdmCombResearchRecord.js";
import {
  readOfdmCombState,
  saveOfdmCombCheckpoint,
  saveOfdmCombRecord,
  validateOfdmCombStoredState,
} from "../src/lib/ofdmCombResearchStore.js";
const identity = {
  sourceFingerprint: "a".repeat(64),
  runtimeFingerprint: "b".repeat(64),
};
test("Worker ready binds run/source/engine and supplies its own runtime", async () => {
  const worker = new EventTarget() as Worker,
    controller = new AbortController();
  worker.postMessage = (request: unknown) => {
    const v = request as { runId: string };
    queueMicrotask(() =>
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "ready",
            runId: v.runId,
            engineVersion: "ofdm-v13.2",
            ...identity,
          },
        }),
      ),
    );
  };
  assert.deepEqual(
    await handshakeOfdmCombWorker(
      worker,
      "run",
      identity.sourceFingerprint,
      controller.signal,
    ),
    identity,
  );
  await assert.rejects(
    handshakeOfdmCombWorker(worker, "run", "c".repeat(64), controller.signal),
    /身份无效/,
  );
});
test("aborted Worker initialization rejects immediately without starting a frame", async () => {
  const worker = new EventTarget() as Worker,
    controller = new AbortController();
  worker.postMessage = () => {};
  const ready = handshakeOfdmCombWorker(
    worker,
    "run",
    identity.sourceFingerprint,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(ready, /初始化已取消/);
});
test("corrupt storage envelopes and pseudo-empty checkpoints are rejected", () => {
  for (const checkpoint of [0, "", undefined, false])
    assert.throws(() =>
      validateOfdmCombStoredState({ revision: 0, records: [], checkpoint }),
    );
  assert.throws(() =>
    validateOfdmCombStoredState({
      revision: -1,
      records: [],
      checkpoint: null,
    }),
  );
});
test("comb storage CAS is independent and preserves complete records", async () => {
  const p = { ...defaultOfdmCombPlan(), trials: 2, ebN0Db: [8] },
    f = await freezeOfdmCombPlan(p),
    cp = await makeOfdmCombCheckpoint(f, [], identity);
  assertOfdmCombResumeIdentity(cp, identity);
  const results = await Promise.allSettled([
    saveOfdmCombCheckpoint(cp, 0),
    saveOfdmCombCheckpoint(cp, 0),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  await assert.rejects(() => saveOfdmCombCheckpoint(cp, 0));
  const t = await Promise.all([0, 1].map((j) => simulateOfdmCombTrial(p, j))),
    r = await makeOfdmCombRecord(f, t, identity);
  assertOfdmCombCompletedPrefix(r, t);
  await saveOfdmCombRecord(r, 1);
  const state = await readOfdmCombState();
  assert.equal(state.revision, 2);
  assert.equal(state.checkpoint, null);
  assert.equal(state.records.length, 1);
});
test("maximum 1500 cell-frame synthetic serialization fits compact importer budget", async () => {
  const p = {
      ...defaultOfdmCombPlan(),
      fftSize: 64,
      cp: 16,
      dataSymbols: 1,
      modulation: "16QAM" as const,
      activeBins: Array.from({ length: 48 }, (_, j) =>
        j < 24 ? j - 24 : j - 23,
      ),
      pilotLayouts: [[-24, -8, 8, 24]],
      trials: 1500,
      channels: ["rayleigh" as const],
      ebN0Db: [0],
      taps: [{ delay: 0, i: 1, q: 0, power: 1 }],
    },
    f = await freezeOfdmCombPlan(p),
    first = await simulateOfdmCombTrial(p, 0);
  // Repeated synthetic values test byte limits only; not an independent-frame study.
  const trials = Array.from({ length: 1500 }, (_, index) => {
    const t = structuredClone(first);
    t.index = index;
    if (index)
      for (const c of t.cells)
        c.preview = {
          bins: [],
          truth: [],
          training: [],
          comb: [],
          pilots: [],
          pilotLs: [],
        };
    return t;
  });
  const r = await makeOfdmCombRecord(f, trials, identity),
    text = serializeOfdmCombCheckpoint(r);
  assert.ok(Buffer.byteLength(text) < 8 * 1024 * 1024);
  assert.equal((await parseOfdmCombCheckpoint(text)).trials.length, 1500);
});
