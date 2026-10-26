import { simulateOfdmTrial } from "../lib/ofdmResearch";
import {
  assertOfdmResumeIdentity,
  makeOfdmRecord,
  parseOfdmCheckpoint,
  validateOfdmTrial,
} from "../lib/ofdmResearchRecord";
import { ofdmIdentity } from "../lib/ofdmIdentity";
import { OFDM_ENGINE } from "../lib/ofdmProtocol";
self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data as { runId?: unknown; checkpoint?: unknown };
  const runId = typeof request?.runId === "string" ? request.runId : "";
  let protocolHash = "";
  const identity = await ofdmIdentity();
  try {
    if (!runId || runId.length > 100) throw new Error("OFDM 任务标识无效。");
    const cp = await parseOfdmCheckpoint(request.checkpoint);
    protocolHash = cp.protocolHash;
    if (cp.status !== "checkpoint") throw new Error("仅检查点可继续运行。");
    assertOfdmResumeIdentity(cp, identity);
    const trials = [...cp.trials],
      batch = [];
    let sent = performance.now();
    for (let index = trials.length; index < cp.plan.trials; index++) {
      const trial = await simulateOfdmTrial(cp.plan, index);
      validateOfdmTrial(cp.plan, trial, index);
      trials.push(trial);
      batch.push(trial);
      if (performance.now() - sent >= 100 || trials.length === cp.plan.trials) {
        self.postMessage({
          type: "batch",
          runId,
          protocolHash,
          engineVersion: OFDM_ENGINE,
          ...identity,
          trials: batch.splice(0),
          completed: trials.length,
        });
        sent = performance.now();
      }
    }
    self.postMessage({
      type: "done",
      runId,
      protocolHash,
      engineVersion: OFDM_ENGINE,
      ...identity,
      record: await makeOfdmRecord(cp, trials, identity),
    });
  } catch (cause) {
    self.postMessage({
      type: "error",
      runId,
      protocolHash,
      engineVersion: OFDM_ENGINE,
      ...identity,
      message: cause instanceof Error ? cause.message : "OFDM 计算失败。",
    });
  }
  self.close();
};
