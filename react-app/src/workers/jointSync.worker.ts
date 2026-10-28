import { ofdmHash } from "../lib/ofdmProtocol.js";
import {
  freezeJointPlan,
  simulateJointTrial,
  JOINT_ENGINE,
  type JointPlan,
  type JointTrial,
} from "../lib/ofdmSync/jointEngine.js";

declare const __OFDM_JOINT_SOURCE_FINGERPRINT__: string;
let started = false;
self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data as {
    type?: unknown;
    runId?: unknown;
    plan?: unknown;
  };
  const runId = typeof request?.runId === "string" ? request.runId : "";
  let protocolHash = "";
  try {
    if (!runId || runId.length > 100 || request.type !== "start" || started)
      throw new Error("Invalid joint Worker request.");
    started = true;
    const frozen = await freezeJointPlan(request.plan as JointPlan);
    protocolHash = frozen.protocolHash;
    const sourceFingerprint =
      typeof __OFDM_JOINT_SOURCE_FINGERPRINT__ === "undefined"
        ? await ofdmHash("unbundled-joint-test-runtime")
        : __OFDM_JOINT_SOURCE_FINGERPRINT__;
    if (!/^[a-f0-9]{64}$/.test(sourceFingerprint))
      throw new Error("Invalid joint source identity.");
    const runtimeFingerprint = await ofdmHash({
      runtime: typeof navigator === "undefined" ? "node" : navigator.userAgent,
      probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
    });
    const identity = {
      runId,
      engineVersion: JOINT_ENGINE,
      protocolHash,
      sourceFingerprint,
      runtimeFingerprint,
    };
    self.postMessage({ type: "ready", ...identity, plan: frozen.plan });
    let batch: JointTrial[] = [],
      sent = performance.now();
    for (let index = 0; index < frozen.plan.trials; index++) {
      batch.push(await simulateJointTrial(frozen.plan, index));
      if (performance.now() - sent >= 100 || index + 1 === frozen.plan.trials) {
        self.postMessage({
          type: "batch",
          ...identity,
          trials: batch,
          completed: index + 1,
        });
        batch = [];
        sent = performance.now();
      }
    }
    self.postMessage({
      type: "done",
      ...identity,
      completed: frozen.plan.trials,
    });
  } catch (cause) {
    self.postMessage({
      type: "error",
      runId,
      engineVersion: JOINT_ENGINE,
      protocolHash,
      message: cause instanceof Error ? cause.message : "Joint Worker failed.",
    });
  }
  self.close();
};
