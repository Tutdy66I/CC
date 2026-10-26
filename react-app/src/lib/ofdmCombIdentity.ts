import { ofdmHash, OFDM_COMB_ENGINE } from "./ofdmCombProtocol.js";
declare const __OFDM_COMB_SOURCE_FINGERPRINT__: string;
export interface OfdmCombIdentity {
  sourceFingerprint: string;
  runtimeFingerprint: string;
}
export async function ofdmCombSourceFingerprint(): Promise<string> {
  const source =
    typeof __OFDM_COMB_SOURCE_FINGERPRINT__ === "undefined"
      ? "unbundled-test-runtime"
      : __OFDM_COMB_SOURCE_FINGERPRINT__;
  return /^[a-f0-9]{64}$/.test(source) ? source : await ofdmHash(source);
}
export async function ofdmCombIdentity(): Promise<OfdmCombIdentity> {
  return {
    sourceFingerprint: await ofdmCombSourceFingerprint(),
    runtimeFingerprint: await ofdmHash({
      runtime: typeof navigator === "undefined" ? "node" : navigator.userAgent,
      probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
    }),
  };
}

/** The numerical runtime is the Worker, whose UA may differ from a page-level override. */
export function handshakeOfdmCombWorker(
  worker: Worker,
  runId: string,
  sourceFingerprint: string,
  signal: AbortSignal,
): Promise<OfdmCombIdentity> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error("OFDM 初始化已取消。"));
    const onError = () => fail(new Error("OFDM Worker 初始化失败。"));
    const onMessage = (event: MessageEvent<unknown>) => {
      const v = event.data as {
        type?: unknown;
        runId?: unknown;
        engineVersion?: unknown;
        sourceFingerprint?: unknown;
        runtimeFingerprint?: unknown;
        message?: unknown;
      };
      if (!v || v.runId !== runId) return;
      if (v.type === "error") {
        fail(
          new Error(
            typeof v.message === "string" ? v.message : "OFDM 初始化失败。",
          ),
        );
        return;
      }
      if (
        v.type !== "ready" ||
        v.engineVersion !== OFDM_COMB_ENGINE ||
        v.sourceFingerprint !== sourceFingerprint ||
        typeof v.runtimeFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(v.runtimeFingerprint)
      ) {
        fail(new Error("OFDM Worker 初始化的源码、引擎或运行时身份无效。"));
        return;
      }
      cleanup();
      resolve({ sourceFingerprint, runtimeFingerprint: v.runtimeFingerprint });
    };
    const timeout = setTimeout(
      () => fail(new Error("OFDM Worker 初始化超时。")),
      10000,
    );
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else worker.postMessage({ type: "init", runId });
  });
}
