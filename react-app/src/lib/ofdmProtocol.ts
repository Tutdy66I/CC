import type { FrozenOfdmPlan, OfdmPlan } from "./ofdmTypes.js";
import { OFDM_PILOT_DEFINITION } from "./ofdmPilots.js";
export const OFDM_ENGINE = "ofdm-v13.1" as const;
export const OFDM_RANDOM = "signallab-ofdm-rng-v1" as const;
export const bitsPerSymbol = (m: OfdmPlan["modulation"]) =>
  m === "BPSK" ? 1 : m === "QPSK" ? 2 : 4;
export function defaultOfdmPlan(): OfdmPlan {
  return {
    fftSize: 128,
    cp: 16,
    activeBins: Array.from({ length: 96 }, (_, j) =>
      j < 48 ? j - 48 : j - 47,
    ),
    dataSymbols: 4,
    modulation: "QPSK",
    taps: [0, 1, 3, 7].map((delay, j) => ({
      delay,
      i: j === 0 ? 1 : 0,
      q: 0,
      power: 10 ** ((-3 * j) / 10),
    })),
    channels: ["awgn", "rayleigh"],
    ebN0Db: [0, 8, 16],
    energyBasis: "data-eb",
    seed: 20261026,
    trials: 200,
    noiseEnabled: true,
  };
}
export function workUnits(p: OfdmPlan): number {
  return (
    p.trials *
    p.channels.length *
    p.ebN0Db.length *
    (2 * (1 + p.dataSymbols) * p.fftSize * Math.log2(p.fftSize) +
      (1 + p.dataSymbols) * (p.fftSize + p.cp) * p.taps.length +
      32 * p.dataSymbols * p.activeBins.length)
  );
}
export function validateOfdmPlan(p: OfdmPlan): void {
  const integer = (v: number, lo: number, hi: number) =>
    Number.isInteger(v) && v >= lo && v <= hi;
  if (
    !p ||
    ![64, 128, 256, 512, 1024].includes(p.fftSize) ||
    !integer(p.cp, 0, p.fftSize) ||
    !integer(p.dataSymbols, 1, 8) ||
    !integer(p.seed, 0, 0xffffffff) ||
    !integer(p.trials, 2, 4000) ||
    typeof p.noiseEnabled !== "boolean" ||
    !["BPSK", "QPSK", "16QAM"].includes(p.modulation) ||
    !["data-eb", "total-eb"].includes(p.energyBasis)
  )
    throw new Error("OFDM 长度、CP、调制、帧数或种子无效。");
  if (
    !Array.isArray(p.activeBins) ||
    p.activeBins.length < 2 ||
    p.activeBins.length > p.fftSize - 1 ||
    p.activeBins.some(
      (q, j) =>
        !integer(q, -p.fftSize / 2, p.fftSize / 2 - 1) ||
        q === 0 ||
        (j > 0 && q <= p.activeBins[j - 1]),
    )
  )
    throw new Error("活动载波必须排序、互异、位于 FFT 范围且不含 DC。");
  if (
    !Array.isArray(p.channels) ||
    p.channels.length < 1 ||
    p.channels.length > 3 ||
    new Set(p.channels).size !== p.channels.length ||
    p.channels.some((x) => !["awgn", "fixed", "rayleigh"].includes(x))
  )
    throw new Error("OFDM 信道列表无效。");
  if (
    !Array.isArray(p.ebN0Db) ||
    p.ebN0Db.length < 1 ||
    p.ebN0Db.length > 8 ||
    new Set(p.ebN0Db).size !== p.ebN0Db.length ||
    p.ebN0Db.some((x) => !Number.isFinite(x) || x < -10 || x > 40)
  )
    throw new Error("Eb/N0 支持 -10 到 40 dB，最多 8 个互异值。");
  if (
    !Array.isArray(p.taps) ||
    !p.taps.length ||
    p.taps.length > 16 ||
    p.taps.some(
      (t, j) =>
        !integer(t.delay, 0, p.fftSize - 1) ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        Math.abs(t.i) > 16 ||
        Math.abs(t.q) > 16 ||
        !Number.isFinite(t.power) ||
        t.power < 0 ||
        t.power > 1e6 ||
        (j > 0 && t.delay <= p.taps[j - 1].delay),
    ) ||
    !p.taps.some((t) => t.power > 0)
  )
    throw new Error(
      "抽头需排序、时延互异且 PDP 总功率为正；固定增益不自动归一化。",
    );
  if (
    p.trials * p.channels.length * p.ebN0Db.length > 4000 ||
    workUnits(p) > 50_000_000
  )
    throw new Error(
      "超过浏览器预算：4000 cell-frame 或 50000000 work-unit；不会自动减少样本。",
    );
}
/** Project only known fields; order is part of the protocol. */
export function normalizeOfdmPlan(p: OfdmPlan): OfdmPlan {
  validateOfdmPlan(p);
  return {
    fftSize: p.fftSize,
    cp: p.cp,
    activeBins: [...p.activeBins],
    dataSymbols: p.dataSymbols,
    modulation: p.modulation,
    taps: p.taps.map((t) => ({
      delay: t.delay,
      i: t.i,
      q: t.q,
      power: t.power,
    })),
    channels: [...p.channels],
    ebN0Db: [...p.ebN0Db],
    energyBasis: p.energyBasis,
    seed: p.seed,
    trials: p.trials,
    noiseEnabled: p.noiseEnabled,
  };
}
export const canonicalOfdm = (v: unknown): string => {
  if ((typeof v === "number" && !Number.isFinite(v)) || v === undefined)
    throw new Error("OFDM 协议不接受非有限值或 undefined。");
  return v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canonicalOfdm).join(",")}]`
      : `{${Object.keys(v)
          .sort()
          .map(
            (k) =>
              `${JSON.stringify(k)}:${canonicalOfdm((v as Record<string, unknown>)[k])}`,
          )
          .join(",")}}`;
};
export async function ofdmHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalOfdm(value)),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function freezeOfdmPlan(p: OfdmPlan): Promise<FrozenOfdmPlan> {
  const plan = normalizeOfdmPlan(p);
  const protocol = {
    engineVersion: OFDM_ENGINE,
    randomVersion: OFDM_RANDOM,
    plan,
    fft: "unitary-both;standard-bin",
    channel:
      "continuous-FIR-zero-prehistory;block-static;PDP-only-normalization",
    pilots: OFDM_PILOT_DEFINITION,
    training: 1,
    noise: "CN(0,N0);dataEb=1;expected-total-Eb;body-prefix-domain-separated",
    decision: "same-CSI-gain-aware;zero-or-nonfinite-erasure;no-epsilon",
    statistics:
      "independent-complete-frame;Hoeffding-alpha=.05;failure-bounds;no-partial-intervals",
    random:
      "SHA256-domain|seed|trial|role|slot;LE4;xoshiro128**;4bits/standard-bin;BoxMuller-pair/sqrt2",
  };
  return {
    engineVersion: OFDM_ENGINE,
    randomVersion: OFDM_RANDOM,
    plan,
    protocolHash: await ofdmHash(protocol),
  };
}
