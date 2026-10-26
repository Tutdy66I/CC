import {
  bitsPerSymbol,
  canonicalOfdm,
  freezeOfdmPlan,
  ofdmHash,
  normalizeOfdmPlan,
} from "./ofdmProtocol.js";
import { energyBudget } from "./ofdmEnergy.js";
import { summarizeOfdm, type OfdmSummary } from "./ofdmResearch.js";
import {
  OFDM_METHODS,
  type FrozenOfdmPlan,
  type OfdmPlan,
  type OfdmTrial,
} from "./ofdmTypes.js";
import type { OfdmIdentity } from "./ofdmIdentity.js";
export const OFDM_RECORD_BYTES = 8 * 1024 * 1024;
export interface OfdmCheckpoint extends FrozenOfdmPlan, OfdmIdentity {
  schemaVersion: 1;
  status: "checkpoint" | "complete";
  trials: OfdmTrial[];
  integrityHash: string;
  summary?: OfdmSummary[];
}
export interface OfdmRecord extends OfdmCheckpoint {
  status: "complete";
  summary: OfdmSummary[];
}
export function serializeOfdmCheckpoint(record: OfdmCheckpoint): string {
  const text = JSON.stringify(record);
  if (new TextEncoder().encode(text).length > OFDM_RECORD_BYTES)
    throw new Error("OFDM 记录超过 8 MiB；已保留内存结果。");
  return text;
}
const fail = () => {
  throw new Error(
    "OFDM 记录损坏、版本不支持或完整性校验失败；保留原文以便导出。",
  );
};
function keys(v: unknown, expected: string[]): void {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join("|") !== [...expected].sort().join("|")
  )
    fail();
}
const finite = (x: unknown, lo = 0, hi = Number.MAX_VALUE) =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const count = (x: unknown, max: number) =>
  finite(x, 0, max) && Number.isSafeInteger(x);
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-10 * (1 + Math.abs(b));
/** Validates per-frame structural, count, energy and method invariants without resimulating it. */
export function validateOfdmTrial(
  p: OfdmPlan,
  raw: unknown,
  index: number,
): asserts raw is OfdmTrial {
  const t = raw as OfdmTrial;
  keys(t, ["index", "cells"]);
  if (
    t.index !== index ||
    !Array.isArray(t.cells) ||
    t.cells.length !== p.channels.length * p.ebN0Db.length
  )
    fail();
  const budget = energyBudget(p),
    bits = budget.informationBits;
  t.cells.forEach((c, j) => {
    keys(c, [
      "channel",
      "ebN0Db",
      "noisePower",
      "cpSufficient",
      "energy",
      "channelErrorEnergy",
      "channelEnergy",
      "lsToneCount",
      "diagonalResidual",
      "methods",
      "preview",
    ]);
    if (
      c.channel !== p.channels[Math.floor(j / p.ebN0Db.length)] ||
      c.ebN0Db !== p.ebN0Db[j % p.ebN0Db.length] ||
      typeof c.cpSufficient !== "boolean"
    )
      fail();
    const n0 = p.noiseEnabled
      ? (p.energyBasis === "data-eb" ? 1 : budget.expectedEbTotal) /
        10 ** (c.ebN0Db / 10)
      : 0;
    if (
      !finite(c.noisePower) ||
      !close(c.noisePower, n0) ||
      !finite(c.channelErrorEnergy) ||
      !finite(c.channelEnergy) ||
      c.lsToneCount !== p.activeBins.length
    )
      fail();
    keys(c.energy, ["useful", "cp", "training", "total", "expectedEbTotal"]);
    if (
      Object.values(c.energy).some((v) => !finite(v, -1e-8)) ||
      !close(c.energy.expectedEbTotal, budget.expectedEbTotal) ||
      !close(c.energy.total, c.energy.useful + c.energy.cp)
    )
      fail();
    if (
      !Array.isArray(c.diagonalResidual) ||
      c.diagonalResidual.length !== p.dataSymbols + 1 ||
      c.diagonalResidual.some((v) => !finite(v))
    )
      fail();
    keys(c.methods, OFDM_METHODS);
    for (const m of OFDM_METHODS) {
      const v = c.methods[m];
      keys(v, [
        "bits",
        "errors",
        "erasedBits",
        "deepFadeSymbols",
        "signalEnergy",
        "rawErrorEnergy",
        "decisionErrorEnergy",
      ]);
      if (
        v.bits !== bits ||
        !count(v.errors, bits) ||
        !count(v.erasedBits, bits - v.errors) ||
        v.erasedBits % bitsPerSymbol(p.modulation) !== 0 ||
        !count(v.deepFadeSymbols, bits / bitsPerSymbol(p.modulation)) ||
        !finite(v.signalEnergy, Number.MIN_VALUE) ||
        ![v.rawErrorEnergy, v.decisionErrorEnergy].every(
          (x) => x === null || finite(x),
        ) ||
        !close(v.signalEnergy, c.methods["ideal-zf"].signalEnergy)
      )
        fail();
      if (v.erasedBits > 0 && v.decisionErrorEnergy !== null) fail();
    }
    for (const prefix of ["ideal", "ls"]) {
      const a = c.methods[`${prefix}-zf` as "ideal-zf" | "ls-zf"],
        b = c.methods[`${prefix}-mmse` as "ideal-mmse" | "ls-mmse"];
      if (
        a.errors !== b.errors ||
        a.erasedBits !== b.erasedBits ||
        a.decisionErrorEnergy !== b.decisionErrorEnergy
      )
        fail();
    }
    keys(c.preview, ["bins", "truth", "estimate", "tx", "received", "ls"]);
    for (const [name, list] of Object.entries(c.preview)) {
      if (
        !Array.isArray(list) ||
        list.length > (name === "bins" ? 512 : 1024) ||
        list.some((x) => !finite(x, -Number.MAX_VALUE)) ||
        (index > 0 && list.length)
      )
        fail();
    }
    const v = c.preview;
    if (
      v.truth.length !== 2 * v.bins.length ||
      v.estimate.length !== v.truth.length ||
      v.tx.length > 512 ||
      v.tx.length % 2 ||
      v.received.length !== v.tx.length ||
      v.ls.length !== v.tx.length ||
      v.bins.some(
        (q, k) => !p.activeBins.includes(q) || (k > 0 && q <= v.bins[k - 1]),
      )
    )
      fail();
  });
}
function validateIdentity(v: OfdmIdentity): void {
  if (
    !/^[a-f0-9]{64}$/.test(v.sourceFingerprint) ||
    !/^[a-f0-9]{64}$/.test(v.runtimeFingerprint)
  )
    fail();
}
export function assertOfdmResumeIdentity(
  record: OfdmCheckpoint,
  current: OfdmIdentity,
): void {
  if (
    record.sourceFingerprint !== current.sourceFingerprint ||
    record.runtimeFingerprint !== current.runtimeFingerprint
  )
    throw new Error(
      "源码或运行时指纹变化；不能拼接检查点，请导出原记录并开始新实验。",
    );
}
export function assertOfdmCompletedPrefix(
  record: OfdmCheckpoint,
  trials: OfdmTrial[],
): void {
  if (
    record.status !== "complete" ||
    canonicalOfdm(record.trials) !== canonicalOfdm(trials)
  )
    throw new Error("OFDM 完成记录与已验证前缀不一致。");
}
async function make(
  frozen: FrozenOfdmPlan,
  trials: OfdmTrial[],
  identity: OfdmIdentity,
  complete: boolean,
): Promise<OfdmCheckpoint> {
  validateIdentity(identity);
  if (trials.length > frozen.plan.trials) fail();
  trials.forEach((t, i) => validateOfdmTrial(frozen.plan, t, i));
  const payload = {
    engineVersion: frozen.engineVersion,
    randomVersion: frozen.randomVersion,
    protocolHash: frozen.protocolHash,
    plan: normalizeOfdmPlan(frozen.plan),
    ...identity,
    schemaVersion: 1 as const,
    status: complete ? ("complete" as const) : ("checkpoint" as const),
    trials: structuredClone(trials),
    ...(complete ? { summary: summarizeOfdm(frozen, trials) } : {}),
  };
  const record = { ...payload, integrityHash: await ofdmHash(payload) };
  serializeOfdmCheckpoint(record);
  return record;
}
export const makeOfdmCheckpoint = (
  f: FrozenOfdmPlan,
  t: OfdmTrial[],
  i: OfdmIdentity,
) => make(f, t, i, false);
export const makeOfdmRecord = async (
  f: FrozenOfdmPlan,
  t: OfdmTrial[],
  i: OfdmIdentity,
) => (await make(f, t, i, true)) as OfdmRecord;
export async function parseOfdmCheckpoint(
  value: unknown,
): Promise<OfdmCheckpoint> {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (
      typeof text !== "string" ||
      text.length > OFDM_RECORD_BYTES ||
      new TextEncoder().encode(text).length > OFDM_RECORD_BYTES
    )
      fail();
    const v = JSON.parse(text) as OfdmCheckpoint;
    keys(v, [
      "engineVersion",
      "randomVersion",
      "protocolHash",
      "plan",
      "schemaVersion",
      "status",
      "sourceFingerprint",
      "runtimeFingerprint",
      "trials",
      "integrityHash",
      ...(v.status === "complete" ? ["summary"] : []),
    ]);
    if (
      v.schemaVersion !== 1 ||
      !["checkpoint", "complete"].includes(v.status) ||
      !Array.isArray(v.trials)
    )
      fail();
    validateIdentity(v);
    keys(v.plan, [
      "fftSize",
      "cp",
      "activeBins",
      "dataSymbols",
      "modulation",
      "taps",
      "channels",
      "ebN0Db",
      "energyBasis",
      "seed",
      "trials",
      "noiseEnabled",
    ]);
    const frozen = await freezeOfdmPlan(v.plan);
    if (
      v.engineVersion !== frozen.engineVersion ||
      v.randomVersion !== frozen.randomVersion ||
      v.protocolHash !== frozen.protocolHash ||
      v.trials.length > v.plan.trials
    )
      fail();
    v.plan.taps.forEach((t) => keys(t, ["delay", "i", "q", "power"]));
    v.trials.forEach((t, i) => validateOfdmTrial(v.plan, t, i));
    if (
      v.status === "complete" &&
      canonicalOfdm(v.summary) !==
        canonicalOfdm(summarizeOfdm(frozen, v.trials))
    )
      fail();
    const { integrityHash, ...payload } = v;
    if ((await ofdmHash(payload)) !== integrityHash) fail();
    return v;
  } catch {
    return fail();
  }
}
