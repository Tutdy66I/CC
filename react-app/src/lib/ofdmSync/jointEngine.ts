import { binIndex, modulateOfdm } from "../ofdm.js";
import { fft } from "../fft.js";
import { complexEnergy, energyBudget, trainingGrid } from "../ofdmEnergy.js";
import { equalizeOfdm, fullTrainingLs } from "../ofdmEqualizer.js";
import { ofdmDecode, ofdmModulate } from "../ofdmModulation.js";
import { defaultOfdmPlan, ofdmHash } from "../ofdmProtocol.js";
import { xoshiro128StarStar } from "../fadingRandom.js";
import type { OfdmPlan } from "../ofdmTypes.js";
import { captureFrame, receiverFfts, rotateSamples } from "./capture.js";
import {
  defaultSyncPlan,
  normalizeSyncPlan,
  type SyncMetric,
  type SyncPlan,
} from "./engine.js";
import { estimateCfo, estimateTiming } from "./synchronizer.js";

export const JOINT_ENGINE = "ofdm-sync-v14-joint-1" as const;
export const JOINT_RANDOM = "signallab-ofdm-sync-joint-rng-v1" as const;
const N = 128,
  GUARD = 32,
  PREAMBLE = 256,
  DATA = 4,
  BITS = 768;
export interface JointPlan extends SyncPlan {
  sto: number;
}
export type JointEstimate =
  | {
      status: "ok";
      cfo: number;
      coherence: number;
      peak: number;
      start: number;
      score: number;
      metric: SyncMetric;
    }
  | { status: "failed"; reason: string; metric: SyncMetric };
export interface JointTrial {
  index: number;
  noisePower: number;
  expectedEbTotal: number;
  actualTransmitEnergy: number;
  raw: SyncMetric;
  ideal: SyncMetric;
  estimated: JointEstimate;
  evaluation: {
    estimatedWindowSafe: boolean | null;
    estimatedTimingError: number | null;
    cfoError: number | null;
  };
}
export function defaultJointPlan(): JointPlan {
  return { ...defaultSyncPlan(), sto: 0 };
}
export function normalizeJointPlan(input: JointPlan): JointPlan {
  const plan = normalizeSyncPlan(input);
  if (
    !Number.isInteger(input.sto) ||
    input.sto < -16 ||
    input.sto > 16 ||
    plan.cp > 32 ||
    plan.taps.at(-1)!.delay > 15
  )
    throw new Error(
      "Joint plan requires STO [-16,16], CP [0,32] and tap delays [0,15].",
    );
  return { ...plan, sto: input.sto };
}
export async function freezeJointPlan(input: JointPlan) {
  const plan = normalizeJointPlan(input);
  const protocol = {
    engineVersion: JOINT_ENGINE,
    randomVersion: JOINT_RANDOM,
    plan,
    frame:
      "N128;four repeated 64-sample public blocks;hash32-v1;one public full-training OFDM;four QPSK data;guard32;STO[-16,16]",
    acquisition:
      "fixed public correlation 96/64/64;principal CFO [-1,1);normalized training search;earliest tie;backoff min(7,CP);threshold .1",
    channel:
      "continuous causal FIR;global receiver sample CFO;post-CFO independent capture noise",
    random:
      "sha256|seed|trial|role|slot;LE4;xoshiro128**;four-bits-per-bin;BoxMuller/sqrt2",
    receiver:
      "same capture;raw;known-truth ideal;observation-only estimate;own training LS;ZF;failures are erased bits",
    energy:
      "data Eb=1;total Eb includes all public preamble, training and CP;fixed expected energy",
  };
  return { ...protocol, protocolHash: await ofdmHash(protocol) };
}
export function publicSyncPreamble(): Float64Array {
  const out = new Float64Array(2 * PREAMBLE);
  for (let i = 0; i < PREAMBLE; i++) {
    const t = i % 64;
    let v = Math.imul(t + 1, 0x9e3779b1) >>> 0;
    v = (v ^ (v >>> 16)) >>> 0;
    v = Math.imul(v, 0x85ebca6b) >>> 0;
    v = (v ^ (v >>> 13)) >>> 0;
    out[2 * i] = (v & 1 ? 1 : -1) / Math.SQRT2;
    out[2 * i + 1] = (v & 2 ? 1 : -1) / Math.SQRT2;
  }
  return out;
}
function oldPlan(p: JointPlan): OfdmPlan {
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
export async function deriveJointState(
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
    throw new Error("Invalid joint random domain.");
  const digest = new DataView(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `${JOINT_RANDOM}|${seed}|${trial}|${role}|${slot}`,
      ),
    ),
  );
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
    await deriveJointState(seed, trial, role, slot),
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
type Acquisition =
  | {
      status: "ok";
      cfo: number;
      coherence: number;
      peak: number;
      start: number;
      score: number;
      corrected: Float64Array;
    }
  | { status: "failed"; reason: string };
/** Receives only noisy samples and public CP length; never receives offsets or taps. */
export function acquireJointObservation(
  received: Float64Array,
  cp: number,
): Acquisition {
  if (!Number.isInteger(cp) || cp < 0 || cp > 32)
    throw new Error("Invalid public CP length.");
  const cfo = estimateCfo(received, N, GUARD + 64, 64, 64);
  if (cfo.status === "failed") return { status: "failed", reason: cfo.reason };
  const corrected = rotateSamples(received, N, -cfo.cfo, 0, 0);
  const training = fft(trainingGrid(defaultOfdmPlan()), true);
  const nominal = GUARD + PREAMBLE + cp;
  const timing = estimateTiming(
    corrected,
    training,
    nominal - 16,
    nominal + 16 + 15,
    Math.min(7, cp),
  );
  if (timing.status === "failed")
    return { status: "failed", reason: timing.reason };
  return {
    status: "ok",
    cfo: cfo.cfo,
    coherence: cfo.coherence,
    peak: timing.peak,
    start: timing.start,
    score: timing.score,
    corrected,
  };
}
function erased(): SyncMetric {
  return {
    bits: BITS,
    errors: 0,
    erasedBits: BITS,
    signalEnergy: BITS,
    errorEnergy: null,
  };
}
export async function simulateJointTrial(
  input: JointPlan,
  index: number,
): Promise<JointTrial> {
  const p = normalizeJointPlan(input);
  if (!Number.isInteger(index) || index < 0 || index >= p.trials)
    throw new Error("Invalid frame index.");
  const old = oldPlan(p),
    bins = old.activeBins.map((q) => binIndex(q, N)),
    training = trainingGrid(old);
  const grids = [training],
    payloads: number[][][] = [];
  for (let m = 0; m < DATA; m++) {
    const rng = await random(p.seed, index, "data", m),
      grid = new Float64Array(2 * N),
      payload: number[][] = [];
    for (let k = 0; k < N; k++) {
      const bits = Array.from({ length: 4 }, () =>
        rng.uniform() < 0.5 ? 0 : 1,
      );
      if (bins.includes(k)) {
        grid.set(ofdmModulate(bits.slice(0, 2), "QPSK"), 2 * k);
        payload[k] = bits.slice(0, 2);
      }
    }
    grids.push(grid);
    payloads.push(payload);
  }
  const preamble = publicSyncPreamble(),
    symbols = grids.map((g) => modulateOfdm(g, p.cp));
  const wave = Float64Array.from([
      ...preamble,
      ...symbols.flatMap((s) => [...s]),
    ]),
    budget = energyBudget(old);
  const expectedEbTotal =
    (budget.expectedTotalEnergy + complexEnergy(preamble)) / BITS;
  const noisePower = p.noiseEnabled
    ? (p.energyBasis === "data-eb" ? 1 : expectedEbTotal) /
      10 ** (p.ebN0Db / 10)
    : 0;
  const noise = new Float64Array(
    2 * (GUARD * 2 + wave.length / 2 + p.taps.at(-1)!.delay),
  );
  const rng = await random(p.seed, index, "noise", 0);
  for (let i = 0; i < noise.length; i += 2) {
    const [a, b] = rng.complex();
    noise[i] = a * Math.sqrt(noisePower);
    noise[i + 1] = b * Math.sqrt(noisePower);
  }
  const received = captureFrame(
    wave,
    p.taps,
    N,
    p.cfo,
    p.phase,
    GUARD + p.sto,
    GUARD - p.sto,
    noise,
  );
  const idealSignal = rotateSamples(received, N, -p.cfo, -p.phase, 0);
  const acquisition = acquireJointObservation(received, p.cp);
  function measure(signal: Float64Array, start: number): SyncMetric {
    const rx = receiverFfts(signal, N, p.cp, start, 1 + DATA);
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
    for (let m = 1; m <= DATA; m++)
      for (let j = 0; j < bins.length; j++) {
        const k = bins[j],
          tx = [grids[m][2 * k], grids[m][2 * k + 1]];
        const eq = equalizeOfdm(
          [rx[m][2 * k], rx[m][2 * k + 1]],
          csi.slice(2 * j, 2 * j + 2),
          noisePower,
          2,
          "zf",
        );
        metric.bits += 2;
        metric.signalEnergy += tx[0] ** 2 + tx[1] ** 2;
        if (!eq.decision) {
          metric.erasedBits += 2;
          metric.errorEnergy = null;
          continue;
        }
        const decoded = ofdmDecode(eq.decision[0], eq.decision[1], "QPSK");
        metric.errors += decoded.reduce(
          (s, b, i) => s + (b === payloads[m - 1][k][i] ? 0 : 1),
          0,
        );
        if (metric.errorEnergy !== null) {
          const e =
            metric.errorEnergy +
            (eq.decision[0] - tx[0]) ** 2 +
            (eq.decision[1] - tx[1]) ** 2;
          metric.errorEnergy = Number.isFinite(e) ? e : null;
        }
      }
    return metric;
  }
  const raw = measure(received, GUARD + PREAMBLE),
    ideal = measure(idealSignal, GUARD + p.sto + PREAMBLE);
  const delta =
    acquisition.status === "ok"
      ? acquisition.start - (GUARD + p.sto + PREAMBLE + p.cp)
      : null;
  const actual = p.taps.filter((t) => t.i !== 0 || t.q !== 0),
    minDelay = actual[0].delay,
    maxDelay = actual.at(-1)!.delay;
  const estimated: JointEstimate =
    acquisition.status === "failed"
      ? { ...acquisition, metric: erased() }
      : {
          status: "ok",
          cfo: acquisition.cfo,
          coherence: acquisition.coherence,
          peak: acquisition.peak,
          start: acquisition.start,
          score: acquisition.score,
          metric: measure(acquisition.corrected, acquisition.start - p.cp),
        };
  return {
    index,
    noisePower,
    expectedEbTotal,
    actualTransmitEnergy: complexEnergy(wave),
    raw,
    ideal,
    estimated,
    evaluation: {
      estimatedWindowSafe:
        delta === null ? null : delta >= maxDelay - p.cp && delta <= minDelay,
      estimatedTimingError: delta,
      cfoError: acquisition.status === "ok" ? acquisition.cfo - p.cfo : null,
    },
  };
}
