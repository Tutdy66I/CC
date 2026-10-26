import {
  defaultOfdmPlan,
  freezeOfdmPlan,
  simulateOfdmTrial,
  makeOfdmRecord,
  identity,
} from "./ofdm-tooling.mjs";
const p = defaultOfdmPlan(),
  f = await freezeOfdmPlan(p),
  id = await identity(),
  before = process.memoryUsage(),
  started = performance.now(),
  trials = [];
let peak = before.heapUsed + before.arrayBuffers;
for (let i = 0; i < p.trials; i++) {
  trials.push(await simulateOfdmTrial(p, i));
  const m = process.memoryUsage();
  peak = Math.max(peak, m.heapUsed + m.arrayBuffers);
}
const record = await makeOfdmRecord(f, trials, id);
process.stdout.write(
  JSON.stringify(
    {
      runtime: process.version,
      platform: process.platform,
      frames: p.trials,
      cellFrames: p.trials * 6,
      elapsedMs: performance.now() - started,
      peakProcessHeapPlusArrayBuffersMiB: peak / 1024 ** 2,
      recordBytes: Buffer.byteLength(JSON.stringify(record)),
      limitation:
        "Node whole-process managed allocation sample, not browser Worker native working set or end-to-end latency.",
      identity: id,
    },
    null,
    2,
  ) + "\n",
);
