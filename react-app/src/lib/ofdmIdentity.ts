import { ofdmHash } from "./ofdmProtocol.js";
declare const __OFDM_SOURCE_FINGERPRINT__: string;
export interface OfdmIdentity {
  sourceFingerprint: string;
  runtimeFingerprint: string;
}
export async function ofdmIdentity(): Promise<OfdmIdentity> {
  const source =
    typeof __OFDM_SOURCE_FINGERPRINT__ === "undefined"
      ? "unbundled-test-runtime"
      : __OFDM_SOURCE_FINGERPRINT__;
  return {
    sourceFingerprint: /^[a-f0-9]{64}$/.test(source)
      ? source
      : await ofdmHash(source),
    runtimeFingerprint: await ofdmHash({
      runtime: typeof navigator === "undefined" ? "node" : navigator.userAgent,
      probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
    }),
  };
}
