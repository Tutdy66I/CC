import { ofdmHash } from "../ofdmProtocol.js";
import { JOINT_ENGINE } from "./jointEngine.js";

declare const __OFDM_JOINT_SOURCE_FINGERPRINT__: string;
export async function jointSourceFingerprint(): Promise<string> {
  const source =
    typeof __OFDM_JOINT_SOURCE_FINGERPRINT__ === "undefined"
      ? "unbundled-joint-test-runtime"
      : __OFDM_JOINT_SOURCE_FINGERPRINT__;
  return /^[a-f0-9]{64}$/.test(source) ? source : await ofdmHash(source);
}
export function matchesJointIdentity(
  value: unknown,
  source: string,
  protocol: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    engineVersion?: unknown;
    protocolHash?: unknown;
    sourceFingerprint?: unknown;
    runtimeFingerprint?: unknown;
  };
  return (
    v.engineVersion === JOINT_ENGINE &&
    v.protocolHash === protocol &&
    v.sourceFingerprint === source &&
    typeof v.runtimeFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(v.runtimeFingerprint)
  );
}
