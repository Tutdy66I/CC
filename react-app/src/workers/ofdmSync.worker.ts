import { ofdmHash } from "../lib/ofdmProtocol.js";
import {
  freezeSyncPlan,
  simulateSyncTrial,
  SYNC_ENGINE,
  type SyncPlan,
  type SyncTrial,
} from "../lib/ofdmSync/engine.js";

declare const __OFDM_SYNC_SOURCE_FINGERPRINT__: string;
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
      throw new Error("Invalid P1 Worker request.");
    started = true;
    const frozen = await freezeSyncPlan(request.plan as SyncPlan);
    protocolHash = frozen.protocolHash;
    const fingerprint =
      typeof __OFDM_SYNC_SOURCE_FINGERPRINT__ === "undefined"
        ? await ofdmHash("unbundled-sync-test-runtime")
        : __OFDM_SYNC_SOURCE_FINGERPRINT__;
    if (!/^[a-f0-9]{64}$/.test(fingerprint))
      throw new Error("Invalid P1 source fingerprint.");
    const runtimeFingerprint = await ofdmHash({
      runtime: typeof navigator === "undefined" ? "node" : navigator.userAgent,
      probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
    });
    const identity = {
      runId,
      engineVersion: SYNC_ENGINE,
      protocolHash,
      sourceFingerprint: fingerprint,
      runtimeFingerprint,
    };
    self.postMessage({ type: "ready", ...identity, plan: frozen.plan });
    let batch: SyncTrial[] = [],
      sent = performance.now();
    for (let index = 0; index < frozen.plan.trials; index++) {
      batch.push(await simulateSyncTrial(frozen.plan, index));
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
      engineVersion: SYNC_ENGINE,
      protocolHash,
      message: cause instanceof Error ? cause.message : "P1 Worker failed.",
    });
  }
  self.close();
};
