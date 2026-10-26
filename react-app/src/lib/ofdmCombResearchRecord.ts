import {
  bitsPerSymbol,
  canonicalOfdm,
  freezeOfdmCombPlan,
  ofdmHash,
  normalizeOfdmCombPlan,
  commonDataBins,
} from "./ofdmCombProtocol.js";
import { energyBudget } from "./ofdmCombEnergy.js";
import { summarizeOfdmComb, type OfdmCombSummary } from "./ofdmCombResearch.js";
import {
  OFDM_COMB_METHODS,
  type FrozenOfdmCombPlan,
  type OfdmCombPlan,
  type OfdmCombTrial,
} from "./ofdmCombTypes.js";
import type { OfdmCombIdentity } from "./ofdmCombIdentity.js";
export const OFDM_COMB_RECORD_BYTES = 8 * 1024 * 1024;
export interface OfdmCombCheckpoint
  extends FrozenOfdmCombPlan, OfdmCombIdentity {
  schemaVersion: 1;
  status: "checkpoint" | "complete";
  trials: OfdmCombTrial[];
  integrityHash: string;
  summary?: OfdmCombSummary[];
}
export interface OfdmCombRecord extends OfdmCombCheckpoint {
  status: "complete";
  summary: OfdmCombSummary[];
}
const fail = (): never => {
  throw new Error(
    "梳状导频记录损坏、版本不支持或完整性校验失败；保留原文以便导出。",
  );
};
export function serializeOfdmCombCheckpoint(r: OfdmCombCheckpoint): string {
  const text = JSON.stringify(r);
  if (new TextEncoder().encode(text).length > OFDM_COMB_RECORD_BYTES)
    throw new Error("梳状导频记录超过 8 MiB；已保留内存结果。");
  return text;
}
function keys(v: unknown, expected: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join("|") !== [...expected].sort().join("|")
  )
    fail();
}
const finite = (v: unknown, lo = 0) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo;
const count = (v: unknown, max: number) =>
  finite(v) && Number.isSafeInteger(v) && (v as number) <= max;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-10 * (1 + Math.abs(b));
export function validateOfdmCombTrial(
  p: OfdmCombPlan,
  raw: unknown,
  index: number,
): asserts raw is OfdmCombTrial {
  const t = raw as OfdmCombTrial;
  keys(t, ["index", "cells"]);
  const perLayout = 2 * p.channels.length * p.ebN0Db.length;
  if (
    t.index !== index ||
    !Array.isArray(t.cells) ||
    t.cells.length !== perLayout * p.pilotLayouts.length
  )
    fail();
  const budgets = p.pilotLayouts.map((_, j) => energyBudget(p, j)),
    commonCount = commonDataBins(p).length;
  t.cells.forEach((c, j) => {
    keys(c, [
      "layout",
      "scope",
      "channel",
      "ebN0Db",
      "noisePower",
      "cpSufficient",
      "energy",
      "estimation",
      "diagonalResidual",
      "methods",
      "preview",
    ]);
    const layout = Math.floor(j / perLayout),
      scope = j % 2 === 0 ? "all" : "common",
      local = Math.floor(j / 2) % (perLayout / 2),
      budget = budgets[layout],
      tones =
        (scope === "all"
          ? p.activeBins.length - p.pilotLayouts[layout].length
          : commonCount) * p.dataSymbols,
      b = bitsPerSymbol(p.modulation),
      bits = tones * b;
    if (
      c.layout !== layout ||
      c.scope !== scope ||
      c.channel !== p.channels[Math.floor(local / p.ebN0Db.length)] ||
      c.ebN0Db !== p.ebN0Db[local % p.ebN0Db.length] ||
      typeof c.cpSufficient !== "boolean"
    )
      fail();
    const n0 = p.noiseEnabled
      ? (p.energyBasis === "data-eb" ? 1 : budget.expectedEbTotal) /
        10 ** (c.ebN0Db / 10)
      : 0;
    if (!finite(c.noisePower) || !close(c.noisePower, n0)) fail();
    keys(c.energy, [
      "useful",
      "cp",
      "training",
      "total",
      "expectedEbTotal",
      "trainingCp",
      "dataCp",
      "pilotCp",
      "crossCp",
      "dataUseful",
      "pilotUseful",
    ]);
    if (
      Object.entries(c.energy).some(
        ([k, v]) => !finite(v, k === "crossCp" ? -Number.MAX_VALUE : -1e-8),
      ) ||
      !close(c.energy.expectedEbTotal, budget.expectedEbTotal) ||
      !close(c.energy.total, c.energy.useful + c.energy.cp) ||
      !close(
        c.energy.cp,
        c.energy.trainingCp +
          c.energy.dataCp +
          c.energy.pilotCp +
          c.energy.crossCp,
      ) ||
      !close(c.energy.trainingCp, budget.trainingCpEnergy) ||
      !close(c.energy.pilotCp, budget.pilotCpEnergy) ||
      !close(
        c.energy.pilotUseful,
        p.dataSymbols * p.pilotLayouts[layout].length * b,
      ) ||
      !close(
        c.energy.useful,
        c.energy.dataUseful + c.energy.pilotUseful + p.activeBins.length * b,
      )
    )
      fail();
    keys(c.estimation, [
      "trainingError",
      "combError",
      "channelEnergy",
      "tones",
      "bias",
      "noise",
    ]);
    const e = c.estimation;
    if (
      e.tones !== tones ||
      ![e.trainingError, e.combError, e.channelEnergy].every((v) =>
        finite(v),
      ) ||
      (c.cpSufficient
        ? !finite(e.bias) || !finite(e.noise)
        : e.bias !== null || e.noise !== null)
    )
      fail();
    if (
      !Array.isArray(c.diagonalResidual) ||
      c.diagonalResidual.length !== p.dataSymbols + 1 ||
      c.diagonalResidual.some((v) => !finite(v))
    )
      fail();
    keys(c.methods, [...OFDM_COMB_METHODS]);
    for (const method of OFDM_COMB_METHODS) {
      const m = c.methods[method];
      keys(m, [
        "bits",
        "errors",
        "erasedBits",
        "deepFadeSymbols",
        "signalEnergy",
        "rawErrorEnergy",
        "decisionErrorEnergy",
      ]);
      if (
        m.bits !== bits ||
        !count(m.errors, bits) ||
        !count(m.erasedBits, bits - m.errors) ||
        m.erasedBits % b ||
        !count(m.deepFadeSymbols, tones) ||
        !finite(m.signalEnergy, Number.MIN_VALUE) ||
        !close(m.signalEnergy, c.methods["ideal-zf"].signalEnergy) ||
        ![m.rawErrorEnergy, m.decisionErrorEnergy].every(
          (v) => v === null || finite(v),
        ) ||
        (m.erasedBits > 0 && m.decisionErrorEnergy !== null)
      )
        fail();
    }
    for (const prefix of ["ideal", "training", "comb"] as const) {
      const a = c.methods[`${prefix}-zf`],
        b = c.methods[`${prefix}-mmse`];
      if (
        a.errors !== b.errors ||
        a.erasedBits !== b.erasedBits ||
        a.decisionErrorEnergy !== b.decisionErrorEnergy
      )
        fail();
    }
    keys(c.preview, ["bins", "truth", "training", "comb", "pilots", "pilotLs"]);
    const v = c.preview,
      show = index === 0 && scope === "all";
    for (const list of Object.values(v))
      if (
        !Array.isArray(list) ||
        list.length > 2 * p.fftSize ||
        list.some((x) => !finite(x, -Number.MAX_VALUE)) ||
        (!show && list.length)
      )
        fail();
    if (
      show &&
      (canonicalOfdm(v.bins) !== canonicalOfdm(p.activeBins) ||
        canonicalOfdm(v.pilots) !== canonicalOfdm(p.pilotLayouts[layout]) ||
        [v.truth, v.training, v.comb].some(
          (x) => x.length !== 2 * v.bins.length,
        ) ||
        v.pilotLs.length !== 2 * v.pilots.length)
    )
      fail();
    if (scope === "common") {
      const a = t.cells[j - 1];
      if (canonicalOfdm(a.energy) !== canonicalOfdm(c.energy)) fail();
      for (const method of OFDM_COMB_METHODS) {
        const x = c.methods[method],
          y = a.methods[method];
        if (
          x.errors > y.errors ||
          x.erasedBits > y.erasedBits ||
          x.signalEnergy > y.signalEnergy + 1e-8
        )
          fail();
      }
    }
  });
}
function validateIdentity(v: OfdmCombIdentity) {
  if (
    !/^[a-f0-9]{64}$/.test(v.sourceFingerprint) ||
    !/^[a-f0-9]{64}$/.test(v.runtimeFingerprint)
  )
    fail();
}
export function assertOfdmCombResumeIdentity(
  r: OfdmCombCheckpoint,
  current: OfdmCombIdentity,
) {
  if (
    r.sourceFingerprint !== current.sourceFingerprint ||
    r.runtimeFingerprint !== current.runtimeFingerprint
  )
    throw new Error(
      "源码或运行时指纹变化；不能拼接检查点，请导出原记录并开始新实验。",
    );
}
export function assertOfdmCombCompletedPrefix(
  r: OfdmCombCheckpoint,
  trials: OfdmCombTrial[],
) {
  if (
    r.status !== "complete" ||
    canonicalOfdm(r.trials) !== canonicalOfdm(trials)
  )
    throw new Error("梳状导频完成记录与已验证前缀不一致。");
}
async function make(
  f: FrozenOfdmCombPlan,
  trials: OfdmCombTrial[],
  identity: OfdmCombIdentity,
  complete: boolean,
): Promise<OfdmCombCheckpoint> {
  validateIdentity(identity);
  if (trials.length > f.plan.trials) fail();
  trials.forEach((t, j) => validateOfdmCombTrial(f.plan, t, j));
  const payload = {
    engineVersion: f.engineVersion,
    randomVersion: f.randomVersion,
    protocolHash: f.protocolHash,
    plan: normalizeOfdmCombPlan(f.plan),
    ...identity,
    schemaVersion: 1 as const,
    status: complete ? ("complete" as const) : ("checkpoint" as const),
    trials: structuredClone(trials),
    ...(complete ? { summary: summarizeOfdmComb(f, trials) } : {}),
  };
  const r = { ...payload, integrityHash: await ofdmHash(payload) };
  serializeOfdmCombCheckpoint(r);
  return r;
}
export const makeOfdmCombCheckpoint = (
  f: FrozenOfdmCombPlan,
  t: OfdmCombTrial[],
  i: OfdmCombIdentity,
) => make(f, t, i, false);
export const makeOfdmCombRecord = async (
  f: FrozenOfdmCombPlan,
  t: OfdmCombTrial[],
  i: OfdmCombIdentity,
) => (await make(f, t, i, true)) as OfdmCombRecord;
export async function parseOfdmCombCheckpoint(
  value: unknown,
): Promise<OfdmCombCheckpoint> {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (
      typeof text !== "string" ||
      text.length > OFDM_COMB_RECORD_BYTES ||
      new TextEncoder().encode(text).length > OFDM_COMB_RECORD_BYTES
    )
      fail();
    const v = JSON.parse(text) as OfdmCombCheckpoint;
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
      v.engineVersion === "ofdm-v13.2" &&
      v.schemaVersion === 1 &&
      ["checkpoint", "complete"].includes(v.status) &&
      Array.isArray(v.trials)
    ) {
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
        "pilotLayouts",
      ]);
      const f = await freezeOfdmCombPlan(v.plan);
      if (
        v.randomVersion !== f.randomVersion ||
        v.protocolHash !== f.protocolHash ||
        v.trials.length > v.plan.trials
      )
        fail();
      v.plan.taps.forEach((t) => keys(t, ["delay", "i", "q", "power"]));
      v.trials.forEach((t, j) => validateOfdmCombTrial(v.plan, t, j));
      if (
        v.status === "complete" &&
        canonicalOfdm(v.summary) !==
          canonicalOfdm(summarizeOfdmComb(f, v.trials))
      )
        fail();
      const { integrityHash, ...payload } = v;
      if ((await ofdmHash(payload)) !== integrityHash) fail();
      return v;
    }
    return fail();
  } catch {
    return fail();
  }
}
