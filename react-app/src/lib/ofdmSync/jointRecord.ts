import { ofdmHash } from "../ofdmProtocol.js";
import {
  freezeJointPlan,
  JOINT_ENGINE,
  type JointPlan,
  type JointTrial,
} from "./jointEngine.js";
import type { SyncMetric } from "./engine.js";

export interface JointRecord {
  schema: "signallab-ofdm-joint-record-v1";
  engineVersion: typeof JOINT_ENGINE;
  plan: JointPlan;
  protocolHash: string;
  sourceFingerprint: string;
  runtimeFingerprint: string;
  createdAt: string;
  trials: JointTrial[];
  integrityHash: string;
}
type Identity = {
  protocolHash: string;
  sourceFingerprint: string;
  runtimeFingerprint: string;
};
const hash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function metric(value: SyncMetric): boolean {
  return (
    !!value &&
    value.bits === 768 &&
    Number.isInteger(value.errors) &&
    value.errors >= 0 &&
    Number.isInteger(value.erasedBits) &&
    value.erasedBits >= 0 &&
    value.errors + value.erasedBits <= value.bits &&
    Number.isFinite(value.signalEnergy) &&
    value.signalEnergy >= 0 &&
    (value.errorEnergy === null ||
      (Number.isFinite(value.errorEnergy) && value.errorEnergy >= 0)) &&
    (value.erasedBits === 0 || value.errorEnergy === null)
  );
}
function trial(value: JointTrial, index: number): boolean {
  if (
    !value ||
    value.index !== index ||
    !Number.isFinite(value.noisePower) ||
    value.noisePower < 0 ||
    !Number.isFinite(value.expectedEbTotal) ||
    value.expectedEbTotal <= 0 ||
    !Number.isFinite(value.actualTransmitEnergy) ||
    value.actualTransmitEnergy <= 0 ||
    !metric(value.raw) ||
    !metric(value.ideal) ||
    !value.estimated ||
    !metric(value.estimated.metric) ||
    !value.evaluation
  )
    return false;
  const e = value.estimated,
    v = value.evaluation;
  if (e.status === "failed")
    return (
      typeof e.reason === "string" &&
      e.metric.erasedBits === 768 &&
      v.estimatedWindowSafe === null &&
      v.estimatedTimingError === null &&
      v.cfoError === null
    );
  return (
    e.status === "ok" &&
    Number.isFinite(e.cfo) &&
    e.cfo >= -1 &&
    e.cfo <= 1 &&
    Number.isFinite(e.coherence) &&
    e.coherence >= 0 &&
    e.coherence <= 1 + 1e-10 &&
    Number.isInteger(e.peak) &&
    Number.isInteger(e.start) &&
    Number.isFinite(e.score) &&
    e.score >= 0 &&
    e.score <= 1 + 1e-10 &&
    typeof v.estimatedWindowSafe === "boolean" &&
    Number.isInteger(v.estimatedTimingError) &&
    Number.isFinite(v.cfoError)
  );
}
export async function createJointRecord(
  plan: JointPlan,
  trials: JointTrial[],
  identity: Identity,
): Promise<JointRecord> {
  const frozen = await freezeJointPlan(plan);
  if (
    !identity ||
    !hash(identity.protocolHash) ||
    identity.protocolHash !== frozen.protocolHash ||
    !hash(identity.sourceFingerprint) ||
    !hash(identity.runtimeFingerprint) ||
    !Array.isArray(trials) ||
    trials.length !== frozen.plan.trials ||
    trials.some((t, i) => !trial(t, i))
  )
    throw new Error("Invalid joint record.");
  const base = {
    schema: "signallab-ofdm-joint-record-v1" as const,
    engineVersion: JOINT_ENGINE,
    plan: frozen.plan,
    ...identity,
    createdAt: new Date().toISOString(),
    trials,
  };
  return { ...base, integrityHash: await ofdmHash(base) };
}
export async function parseJointRecord(value: unknown): Promise<JointRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid joint record.");
  const r = value as JointRecord;
  if (
    r.schema !== "signallab-ofdm-joint-record-v1" ||
    r.engineVersion !== JOINT_ENGINE ||
    !hash(r.protocolHash) ||
    !hash(r.sourceFingerprint) ||
    !hash(r.runtimeFingerprint) ||
    !hash(r.integrityHash) ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt))
  )
    throw new Error("Invalid joint identity.");
  const frozen = await freezeJointPlan(r.plan);
  if (
    frozen.protocolHash !== r.protocolHash ||
    !Array.isArray(r.trials) ||
    r.trials.length !== frozen.plan.trials ||
    r.trials.some((t, i) => !trial(t, i))
  )
    throw new Error("Invalid joint trial prefix.");
  const { integrityHash, ...base } = r;
  if ((await ofdmHash(base)) !== integrityHash)
    throw new Error("Joint record hash mismatch.");
  return r;
}
const DATABASE = "signallab-ofdm-joint-v14";
let connection: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () =>
        reject(request.error ?? new Error("Joint storage failed."));
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Joint storage blocked by another page."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
  return connection!;
}
export async function readJointState(): Promise<{
  revision: number;
  record: JointRecord | null;
}> {
  const db = await open();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("state", "readonly"),
      request = tx.objectStore("state").get("current");
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  if (value === undefined) return { revision: 0, record: null };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Joint local data is corrupt; preserved.");
  const v = value as { revision: unknown; record: unknown };
  if (
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    !("record" in v)
  )
    throw new Error("Joint local data is corrupt; preserved.");
  return {
    revision: Number(v.revision),
    record: v.record === null ? null : await parseJointRecord(v.record),
  };
}
export async function saveJointRecord(
  record: JointRecord,
  expected: number,
): Promise<number> {
  const parsed = await parseJointRecord(record),
    current = await readJointState();
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    current.revision !== expected
  )
    throw new Error("Joint history changed in another page; export first.");
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state"),
      request = store.get("current");
    let failure: unknown;
    request.onsuccess = () => {
      const revision = request.result?.revision ?? 0;
      if (revision !== expected || !Number.isSafeInteger(expected + 1)) {
        failure = new Error(
          "Joint history changed in another page; export first.",
        );
        tx.abort();
        return;
      }
      store.put({ revision: expected + 1, record: parsed }, "current");
    };
    tx.oncomplete = () => resolve(expected + 1);
    tx.onabort = () => reject(failure ?? tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
