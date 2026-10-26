import type { Modulation } from "./modulationComparison.js";
import type { Tap } from "./multipathChannel.js";
export type OfdmChannel = "awgn" | "fixed" | "rayleigh";
export type OfdmMethod = "ideal-zf" | "ideal-mmse" | "ls-zf" | "ls-mmse";
export const OFDM_METHODS: OfdmMethod[] = [
  "ideal-zf",
  "ideal-mmse",
  "ls-zf",
  "ls-mmse",
];
export interface OfdmPlan {
  fftSize: number;
  cp: number;
  activeBins: number[];
  dataSymbols: number;
  modulation: Modulation;
  taps: (Tap & { power: number })[];
  channels: OfdmChannel[];
  ebN0Db: number[];
  energyBasis: "data-eb" | "total-eb";
  seed: number;
  trials: number;
  noiseEnabled: boolean;
}
export interface OfdmMetric {
  bits: number;
  errors: number;
  erasedBits: number;
  deepFadeSymbols: number;
  signalEnergy: number;
  rawErrorEnergy: number | null;
  decisionErrorEnergy: number | null;
}
export interface OfdmCell {
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
  };
  channelErrorEnergy: number;
  channelEnergy: number;
  lsToneCount: number;
  diagonalResidual: number[];
  methods: Record<OfdmMethod, OfdmMetric>;
  preview: {
    bins: number[];
    truth: number[];
    estimate: number[];
    tx: number[];
    received: number[];
    ls: number[];
  };
}
export interface OfdmTrial {
  index: number;
  cells: OfdmCell[];
}
export interface FrozenOfdmPlan {
  engineVersion: "ofdm-v13.1";
  randomVersion: "signallab-ofdm-rng-v1";
  protocolHash: string;
  plan: OfdmPlan;
}
