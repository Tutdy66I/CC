import type { OfdmPlan, OfdmMetric, OfdmChannel } from "./ofdmTypes.js";
export type { OfdmMetric, OfdmChannel } from "./ofdmTypes.js";
export type OfdmCombChannel = OfdmChannel;
export interface OfdmCombPlan extends OfdmPlan {
  pilotLayouts: number[][];
}
export const OFDM_COMB_METHODS = [
  "ideal-zf",
  "ideal-mmse",
  "training-zf",
  "training-mmse",
  "comb-zf",
  "comb-mmse",
] as const;
export type OfdmCombMethod = (typeof OFDM_COMB_METHODS)[number];
export type CombScope = "all" | "common";
export interface OfdmCombCell {
  layout: number;
  scope: CombScope;
  channel: OfdmChannel;
  ebN0Db: number;
  noisePower: number;
  cpSufficient: boolean;
  energy: {
    useful: number;
    cp: number;
    training: number;
    total: number;
    expectedEbTotal: number;
    trainingCp: number;
    dataCp: number;
    pilotCp: number;
    crossCp: number;
    dataUseful: number;
    pilotUseful: number;
  };
  estimation: {
    trainingError: number;
    combError: number;
    channelEnergy: number;
    tones: number;
    bias: number | null;
    noise: number | null;
  };
  diagonalResidual: number[];
  methods: Record<OfdmCombMethod, OfdmMetric>;
  preview: {
    bins: number[];
    truth: number[];
    training: number[];
    comb: number[];
    pilots: number[];
    pilotLs: number[];
  };
}
export interface OfdmCombTrial {
  index: number;
  cells: OfdmCombCell[];
}
export interface FrozenOfdmCombPlan {
  engineVersion: "ofdm-v13.2";
  randomVersion: "signallab-ofdm-rng-v1";
  protocolHash: string;
  plan: OfdmCombPlan;
}
