import {
  defaultOfdmPlan,
  normalizeOfdmPlan,
  validateOfdmPlan,
  ofdmHash,
} from "./ofdmProtocol.js";
import type { OfdmCombPlan, FrozenOfdmCombPlan } from "./ofdmCombTypes.js";
export { bitsPerSymbol, canonicalOfdm, ofdmHash } from "./ofdmProtocol.js";
export const OFDM_COMB_ENGINE = "ofdm-v13.2" as const;
export const OFDM_COMB_RANDOM = "signallab-ofdm-rng-v1" as const;
/** Equal physical-frequency targets; constrain remaining indices to preserve uniqueness. */
export function countPilots(active: number[], count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count >= active.length)
    throw new Error("导频数量需为 2 到活动载波数−1。");
  let previous = -1;
  return Array.from({ length: count }, (_, j) => {
    const target = active[0] + (j * (active.at(-1)! - active[0])) / (count - 1);
    let best = previous + 1;
    for (let k = best; k <= active.length - count + j; k++)
      if (Math.abs(active[k] - target) < Math.abs(active[best] - target))
        best = k;
    previous = best;
    return active[best];
  });
}
export function spacedPilots(active: number[], spacing: number): number[] {
  if (!Number.isInteger(spacing) || spacing < 1 || spacing > 2048)
    throw new Error("导频间隔需为 1 到 2048 的整数。");
  return active.filter(
    (q, j) =>
      j === 0 || j === active.length - 1 || (q - active[0]) % spacing === 0,
  );
}
export function commonDataBins(p: OfdmCombPlan): number[] {
  const pilots = new Set(p.pilotLayouts.flat());
  return p.activeBins.filter((q) => !pilots.has(q));
}
export function workUnits(p: OfdmCombPlan): number {
  return (
    p.trials *
    p.channels.length *
    p.ebN0Db.length *
    p.pilotLayouts.length *
    (2 * (1 + p.dataSymbols) * p.fftSize * Math.log2(p.fftSize) +
      (1 + p.dataSymbols) * (p.fftSize + p.cp) * p.taps.length +
      64 * p.dataSymbols * p.activeBins.length)
  );
}
export function validateOfdmCombPlan(p: OfdmCombPlan): void {
  validateOfdmPlan(p);
  const active = new Set(p.activeBins);
  if (
    !Array.isArray(p.pilotLayouts) ||
    p.pilotLayouts.length < 1 ||
    p.pilotLayouts.length > 3 ||
    p.pilotLayouts.some(
      (pos) =>
        !Array.isArray(pos) ||
        pos.length < 2 ||
        pos.length >= p.activeBins.length ||
        pos[0] !== p.activeBins[0] ||
        pos.at(-1) !== p.activeBins.at(-1) ||
        pos.some(
          (q, j) =>
            !Number.isInteger(q) ||
            !active.has(q) ||
            (j > 0 && q <= pos[j - 1]),
        ),
    )
  )
    throw new Error(
      "导频需排序、互异、属于活动载波且覆盖两端；DC/保护载波不可用，至少保留一个数据载波。",
    );
  if (
    new Set(p.pilotLayouts.map((x) => x.join(","))).size !==
    p.pilotLayouts.length
  )
    throw new Error("导频布局不可重复。");
  if (!commonDataBins(p).length)
    throw new Error("布局必须保留共同数据位置，才能进行配对比较。");
  const cells = p.channels.length * p.ebN0Db.length * p.pilotLayouts.length;
  if (cells > 24 || cells * p.trials > 1500 || workUnits(p) > 50_000_000)
    throw new Error(
      "超过 comb 预算：24 格、1500 cell-frame 或 50000000 work-unit；不会减少样本。",
    );
}
export function normalizeOfdmCombPlan(p: OfdmCombPlan): OfdmCombPlan {
  validateOfdmCombPlan(p);
  return {
    ...normalizeOfdmPlan(p),
    pilotLayouts: p.pilotLayouts.map((x) => [...x]),
  };
}
export function defaultOfdmCombPlan(): OfdmCombPlan {
  const p = defaultOfdmPlan();
  return {
    ...p,
    trials: 100,
    pilotLayouts: [countPilots(p.activeBins, 4), countPilots(p.activeBins, 8)],
  };
}
export async function freezeOfdmCombPlan(
  p: OfdmCombPlan,
): Promise<FrozenOfdmCombPlan> {
  const plan = normalizeOfdmCombPlan(p);
  const protocol = {
    engineVersion: OFDM_COMB_ENGINE,
    randomVersion: OFDM_COMB_RANDOM,
    plan,
    fft: "unitary-both;standard-bin",
    channel:
      "continuous-FIR-zero-prehistory;block-static;PDP-only-normalization",
    pilots:
      "public-QPSK:((13*k+7)^(k>>>2))&3;Ep=Es;one-full-training-plus-comb-in-every-data-symbol",
    interpolation:
      "signed-physical-frequency;real-imag-linear;edges-required;no-extrapolation",
    energy:
      "Es=bitsPerSymbol;dataEb=1;expected-total-Eb;fixed-pilot-CP-exact;data-pilot-CP-cross-term",
    pairing:
      "shared-channel/virtual-4bits-per-standard-bin/standard-noise;all-and-common-data;layout-pairs-common-only",
    statistics:
      "complete-independent-frames;Hoeffding-alpha=.05;failure-bounds;no-partial-interval;no-multiplicity-correction",
    receiver:
      "no-truth-entry;LS-Y/P;gain-aware-scalar-MMSE;zero-or-nonfinite-erasure",
    random:
      "SHA256-domain|seed|trial|role|slot;LE4;xoshiro128**;4bits/standard-bin;BoxMuller-pair/sqrt2",
  };
  return {
    engineVersion: OFDM_COMB_ENGINE,
    randomVersion: OFDM_COMB_RANDOM,
    plan,
    protocolHash: await ofdmHash(protocol),
  };
}
