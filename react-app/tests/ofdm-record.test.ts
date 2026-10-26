import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { defaultOfdmPlan, freezeOfdmPlan } from "../src/lib/ofdmProtocol.js";
import { simulateOfdmTrial } from "../src/lib/ofdmResearch.js";
import {
  makeOfdmCheckpoint,
  makeOfdmRecord,
  parseOfdmCheckpoint,
  assertOfdmResumeIdentity,
  assertOfdmCompletedPrefix,
  serializeOfdmCheckpoint,
} from "../src/lib/ofdmResearchRecord.js";
import {
  readOfdmState,
  saveOfdmCheckpoint,
  saveOfdmRecord,
  validateOfdmStoredState,
} from "../src/lib/ofdmResearchStore.js";
const identity = {
  sourceFingerprint: "a".repeat(64),
  runtimeFingerprint: "b".repeat(64),
};
test("corrupt storage envelopes and pseudo-empty checkpoints are rejected", () => {
  for (const checkpoint of [0, "", undefined, false])
    assert.throws(() =>
      validateOfdmStoredState({ revision: 0, records: [], checkpoint }),
    );
  assert.throws(() =>
    validateOfdmStoredState({ revision: -1, records: [], checkpoint: null }),
  );
});
test("maximum cell-frame export remains under the importer byte budget", async () => {
  const p = {
    ...defaultOfdmPlan(),
    fftSize: 64,
    cp: 16,
    dataSymbols: 1,
    modulation: "16QAM" as const,
    activeBins: Array.from({ length: 48 }, (_, j) =>
      j < 24 ? j - 24 : j - 23,
    ),
    trials: 4000,
    channels: ["rayleigh"] as "rayleigh"[],
    ebN0Db: [0],
    taps: [{ delay: 0, i: 1, q: 0, power: 1 }],
  };
  const f = await freezeOfdmPlan(p),
    first = await simulateOfdmTrial(p, 0);
  // Synthetic repeated values test serialization size only; this is not a statistical study.
  const trials = Array.from({ length: 4000 }, (_, index) => {
    const t = structuredClone(first);
    t.index = index;
    if (index)
      t.cells[0].preview = {
        bins: [],
        truth: [],
        estimate: [],
        tx: [],
        received: [],
        ls: [],
      };
    return t;
  });
  const r = await makeOfdmRecord(f, trials, identity),
    text = serializeOfdmCheckpoint(r);
  assert.ok(Buffer.byteLength(text) <= 8 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(r, null, 2)) > 8 * 1024 * 1024);
  assert.equal((await parseOfdmCheckpoint(text)).trials.length, 4000);
});
test("OFDM import preserves verified prefix; rejects tampering, gaps, versions, fake counts and resume identity", async () => {
  const p = { ...defaultOfdmPlan(), trials: 2, ebN0Db: [8] },
    f = await freezeOfdmPlan(p);
  const trials = await Promise.all([0, 1].map((i) => simulateOfdmTrial(p, i)));
  const cp = await makeOfdmCheckpoint(f, trials.slice(0, 1), identity);
  assert.deepEqual(await parseOfdmCheckpoint(JSON.stringify(cp)), cp);
  const continued = await makeOfdmRecord(cp, trials, identity);
  assert.doesNotThrow(() => assertOfdmCompletedPrefix(continued, trials));
  const replaced = structuredClone(continued);
  replaced.trials[0].cells[0].preview.received[0] += 1;
  assert.throws(() => assertOfdmCompletedPrefix(replaced, trials), /前缀/);
  assert.equal((await parseOfdmCheckpoint(continued)).status, "complete");
  const savedAgain = await makeOfdmCheckpoint(cp, cp.trials, identity);
  assert.deepEqual(await parseOfdmCheckpoint(savedAgain), savedAgain);
  assert.throws(
    () =>
      assertOfdmResumeIdentity(cp, {
        ...identity,
        runtimeFingerprint: "c".repeat(64),
      }),
    /运行时/,
  );
  for (const mutate of [
    (c: typeof cp) => {
      c.trials[0].index = 1;
    },
    (c: typeof cp) => {
      c.trials[0].cells[0].methods["ls-zf"].bits++;
    },
    (c: typeof cp) => {
      c.protocolHash = "f".repeat(64);
    },
    (c: typeof cp) => {
      c.trials[0].cells[0].preview.tx.push(Infinity);
    },
  ]) {
    const copy = structuredClone(cp);
    mutate(copy);
    await assert.rejects(parseOfdmCheckpoint(copy));
  }
  const record = await makeOfdmRecord(f, trials, identity);
  assert.equal((await parseOfdmCheckpoint(record)).status, "complete");
  const forged = structuredClone(record);
  forged.summary[0].ber = 1;
  await assert.rejects(parseOfdmCheckpoint(forged));
  await assert.rejects(
    parseOfdmCheckpoint({ ...cp, engineVersion: "channel-v12" }),
  );
  await assert.rejects(parseOfdmCheckpoint("x".repeat(8 * 1024 * 1024 + 1)));
});
test("OFDM storage is independent, retains two records and atomically rejects concurrent writes", async () => {
  const f = await freezeOfdmPlan({
    ...defaultOfdmPlan(),
    trials: 2,
    ebN0Db: [8],
  });
  const cp = await makeOfdmCheckpoint(f, [], identity);
  const initial = await readOfdmState();
  assert.equal(initial.revision, 0);
  const results = await Promise.allSettled([
    saveOfdmCheckpoint(cp, 0),
    saveOfdmCheckpoint(cp, 0),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const state = await readOfdmState();
  assert.equal(state.revision, 1);
  await assert.rejects(saveOfdmCheckpoint(cp, 0), /另一页面/);
  const trials = await Promise.all(
    [0, 1].map((i) => simulateOfdmTrial(f.plan, i)),
  );
  const record = await makeOfdmRecord(f, trials, identity);
  await saveOfdmRecord(record, 1);
  const done = await readOfdmState();
  assert.equal(done.checkpoint, null);
  assert.equal(done.records.length, 1);
});
