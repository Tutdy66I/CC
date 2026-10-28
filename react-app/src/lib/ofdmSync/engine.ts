import { binIndex, modulateOfdm } from "../ofdm.js";
import { complexEnergy, energyBudget, trainingGrid } from "../ofdmEnergy.js";
import { equalizeOfdm, fullTrainingLs } from "../ofdmEqualizer.js";
import { ofdmDecode, ofdmModulate } from "../ofdmModulation.js";
import { defaultOfdmPlan, ofdmHash } from "../ofdmProtocol.js";
import { xoshiro128StarStar } from "../fadingRandom.js";
import type { Tap } from "../multipathChannel.js";
import type { OfdmPlan } from "../ofdmTypes.js";
import { captureFrame, receiverFfts, rotateSamples } from "./capture.js";

export const SYNC_ENGINE = "ofdm-sync-v14-p1" as const;
export const SYNC_RANDOM = "signallab-ofdm-sync-rng-v1" as const;
export interface SyncPlan {
  cp: number;
  taps: Tap[];
  cfo: number;
  phase: number;
  ebN0Db: number;
  energyBasis: "data-eb" | "total-eb";
  noiseEnabled: boolean;
  seed: number;
  trials: number;
}
export interface SyncMetric {
  bits: number;
  errors: number;
  erasedBits: number;
  signalEnergy: number;
  errorEnergy: number | null;
}
export interface SyncTrial {
  index: number;
  noisePower: number;
  cpSufficient: boolean;
  expectedEbTotal: number;
  actualTransmitEnergy: number;
  raw: SyncMetric;
  ideal: SyncMetric;
}
export function defaultSyncPlan(): SyncPlan {
  return {
    cp: 16,
    taps: [{ delay: 0, i: 1, q: 0 }],
    cfo: 0.1,
    phase: 0,
    ebN0Db: 8,
    energyBasis: "data-eb",
    noiseEnabled: true,
    seed: 20261028,
    trials: 100,
  };
}
export function normalizeSyncPlan(p: SyncPlan): SyncPlan {
  if (
    !p ||
    !Number.isInteger(p.cp) ||
    p.cp < 0 ||
    p.cp > 128 ||
    !Number.isFinite(p.cfo) ||
    Math.abs(p.cfo) > 1 ||
    !Number.isFinite(p.phase) ||
    Math.abs(p.phase) > Math.PI ||
    !Number.isFinite(p.ebN0Db) ||
    p.ebN0Db < -10 ||
    p.ebN0Db > 40 ||
    !["data-eb", "total-eb"].includes(p.energyBasis) ||
    typeof p.noiseEnabled !== "boolean" ||
    !Number.isInteger(p.seed) ||
    p.seed < 0 ||
    p.seed > 0xffffffff ||
    !Number.isInteger(p.trials) ||
    p.trials < 2 ||
    p.trials > 1000 ||
    !Array.isArray(p.taps) ||
    p.taps.length < 1 ||
    p.taps.length > 4 ||
    p.taps.some(
      (t, i) =>
        !t ||
        !Number.isInteger(t.delay) ||
        t.delay < 0 ||
        t.delay >= 128 ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        Math.abs(t.i) > 16 ||
        Math.abs(t.q) > 16 ||
        (i > 0 && t.delay <= p.taps[i - 1].delay),
    ) ||
    !p.taps.some((t) => t.i !== 0 || t.q !== 0)
  )
    throw new Error("Invalid P1 synchronization plan.");
  return {
    cp: p.cp,
    taps: p.taps.map(({ delay, i, q }) => ({ delay, i, q })),
    cfo: p.cfo,
    phase: p.phase,
    ebN0Db: p.ebN0Db,
    energyBasis: p.energyBasis,
    noiseEnabled: p.noiseEnabled,
    seed: p.seed,
    trials: p.trials,
  };
}
export async function freezeSyncPlan(input: SyncPlan) {
  const plan = normalizeSyncPlan(input);
  const protocol = {
    engineVersion: SYNC_ENGINE,
    randomVersion: SYNC_RANDOM,
    plan,
    frame:
      "N128;CP;one-public-full-training;four-QPSK-data;active+-1..48;guard16;suffix16",
    signal:
      "continuous-FIR-zero-prehistory;CFO=exp(j*(phase+2pi*cfo*n/128));post-CFO-AWGN",
    random:
      "sha256-domain|seed|trial|role|slot;LE4;xoshiro128**;4bits-per-bin;BoxMuller/sqrt2",
    receiver:
      "same-capture;raw-vs-known-truth-CFO-and-phase;full-training-LS;ZF;erasure",
    energy: "data-Eb=1;expected-total-Eb;training-and-CP-included",
  };
  return { ...protocol, protocolHash: await ofdmHash(protocol) };
}
function legacyPlan(p: SyncPlan): OfdmPlan {
  return {
    ...defaultOfdmPlan(),
    cp: p.cp,
    taps: p.taps.map((t) => ({ ...t, power: 1 })),
    channels: ["fixed"],
    ebN0Db: [p.ebN0Db],
    modulation: "QPSK",
    energyBasis: p.energyBasis,
    seed: p.seed,
    trials: p.trials,
    noiseEnabled: p.noiseEnabled,
  };
}
export async function deriveSyncState(
  seed: number,
  trial: number,
  role: "data" | "noise",
  slot: number,
): Promise<number[]> {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isSafeInteger(trial) ||
    trial < 0 ||
    !["data", "noise"].includes(role) ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 3
  )
    throw new Error("Invalid P1 random domain.");
  const input = new TextEncoder().encode(
    `${SYNC_RANDOM}|${seed}|${trial}|${role}|${slot}`,
  );
  const digest = new DataView(await crypto.subtle.digest("SHA-256", input));
  const state = [0, 4, 8, 12].map((i) => digest.getUint32(i, true));
  if (state.every((word) => word === 0))
    throw new Error("Invalid zero random state.");
  return state;
}
async function random(
  seed: number,
  trial: number,
  role: "data" | "noise",
  slot: number,
) {
  const uniform = xoshiro128StarStar(
    await deriveSyncState(seed, trial, role, slot),
  );
  return {
    uniform,
    complex(): [number, number] {
      const r = Math.sqrt(-2 * Math.log(1 - uniform())) / Math.SQRT2,
        a = 2 * Math.PI * uniform();
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  };
}
export async function simulateSyncTrial(
  input: SyncPlan,
  index: number,
): Promise<SyncTrial> {
  const p = normalizeSyncPlan(input);
  if (!Number.isInteger(index) || index < 0 || index >= p.trials)
    throw new Error("Invalid frame index.");
  const old = legacyPlan(p),
    n = 128,
    dataSymbols = 4,
    guard = 16,
    suffix = 16;
  const bins = old.activeBins.map((q) => binIndex(q, n)),
    training = trainingGrid(old);
  const grids = [training],
    bitsBySymbol: number[][][] = [];
  for (let m = 0; m < dataSymbols; m++) {
    const rng = await random(p.seed, index, "data", m),
      grid = new Float64Array(2 * n),
      bits: number[][] = [];
    for (let k = 0; k < n; k++) {
      const values = Array.from({ length: 4 }, () =>
        rng.uniform() < 0.5 ? 0 : 1,
      );
      if (bins.includes(k)) {
        grid.set(ofdmModulate(values.slice(0, 2), "QPSK"), 2 * k);
        bits[k] = values.slice(0, 2);
      }
    }
    grids.push(grid);
    bitsBySymbol.push(bits);
  }
  const symbols = grids.map((grid) => modulateOfdm(grid, p.cp));
  const wave = Float64Array.from(symbols.flatMap((symbol) => [...symbol]));
  const budget = energyBudget(old);
  const n0 = p.noiseEnabled
    ? (p.energyBasis === "data-eb" ? 1 : budget.expectedEbTotal) /
      10 ** (p.ebN0Db / 10)
    : 0;
  const noise = new Float64Array(
    2 * (guard + wave.length / 2 + p.taps.at(-1)!.delay + suffix),
  );
  const rng = await random(p.seed, index, "noise", 0);
  for (let j = 0; j < noise.length; j += 2) {
    const [a, b] = rng.complex();
    noise[j] = a * Math.sqrt(n0);
    noise[j + 1] = b * Math.sqrt(n0);
  }
  const received = captureFrame(
    wave,
    p.taps,
    n,
    p.cfo,
    p.phase,
    guard,
    suffix,
    noise,
  );
  const corrected = rotateSamples(received, n, -p.cfo, -p.phase, 0);
  function measure(signal: Float64Array): SyncMetric {
    const rx = receiverFfts(signal, n, p.cp, guard, 1 + dataSymbols);
    const csi = fullTrainingLs(
      bins.flatMap((k) => [rx[0][2 * k], rx[0][2 * k + 1]]),
      bins.flatMap((k) => [training[2 * k], training[2 * k + 1]]),
    );
    const metric: SyncMetric = {
      bits: 0,
      errors: 0,
      erasedBits: 0,
      signalEnergy: 0,
      errorEnergy: 0,
    };
    for (let m = 1; m <= dataSymbols; m++)
      for (let j = 0; j < bins.length; j++) {
        const k = bins[j],
          tx = [grids[m][2 * k], grids[m][2 * k + 1]];
        const equalized = equalizeOfdm(
          [rx[m][2 * k], rx[m][2 * k + 1]],
          csi.slice(2 * j, 2 * j + 2),
          n0,
          2,
          "zf",
        );
        metric.bits += 2;
        metric.signalEnergy += tx[0] ** 2 + tx[1] ** 2;
        if (!equalized.decision) {
          metric.erasedBits += 2;
          metric.errorEnergy = null;
          continue;
        }
        const decoded = ofdmDecode(
          equalized.decision[0],
          equalized.decision[1],
          "QPSK",
        );
        metric.errors += decoded.reduce(
          (sum, bit, i) => sum + (bit === bitsBySymbol[m - 1][k][i] ? 0 : 1),
          0,
        );
        if (metric.errorEnergy !== null) {
          const error =
            metric.errorEnergy +
            (equalized.decision[0] - tx[0]) ** 2 +
            (equalized.decision[1] - tx[1]) ** 2;
          metric.errorEnergy = Number.isFinite(error) ? error : null;
        }
      }
    return metric;
  }
  return {
    index,
    noisePower: n0,
    cpSufficient:
      p.cp >= p.taps.filter((t) => t.i !== 0 || t.q !== 0).at(-1)!.delay,
    expectedEbTotal: budget.expectedEbTotal,
    actualTransmitEnergy: complexEnergy(wave),
    raw: measure(received),
    ideal: measure(corrected),
  };
}
