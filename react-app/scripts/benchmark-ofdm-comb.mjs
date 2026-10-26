// Fixed engineering workload. No configurable Monte Carlo sweep or formal study.
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  simulateOfdmCombTrial,
  makeOfdmCombRecord,
  serializeOfdmCombCheckpoint,
  identity,
} from "./ofdm-comb-tooling.mjs";
const plan = defaultOfdmCombPlan(),
  frozen = await freezeOfdmCombPlan(plan),
  id = await identity(),
  trials = [],
  start = performance.now();
let peak = 0;
for (let j = 0; j < plan.trials; j++) {
  trials.push(await simulateOfdmCombTrial(plan, j));
  const m = process.memoryUsage();
  peak = Math.max(peak, m.heapUsed + m.arrayBuffers);
}
const kernelMs = performance.now() - start,
  record = await makeOfdmCombRecord(frozen, trials, id),
  text = serializeOfdmCombCheckpoint(record),
  result = {
    engine: frozen.engineVersion,
    source: id.sourceFingerprint,
    frames: plan.trials,
    cellFrames:
      plan.trials *
      plan.channels.length *
      plan.ebN0Db.length *
      plan.pilotLayouts.length,
    kernelMs,
    totalWithRecordMs: performance.now() - start,
    compactBytes: Buffer.byteLength(text),
    peakSampledNodeHeapAndArraysMiB: peak / 1024 ** 2,
    limitation:
      "Fixed engineering default only. Node process managed-memory samples include records, not native/OS Worker working set; no formal research.",
  };
await mkdir("../output/signallab-v13-comb-validation", { recursive: true });
await writeFile(
  "../output/signallab-v13-comb-validation/node-performance.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
