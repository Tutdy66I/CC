import { binIndex, modulateOfdm } from "../lib/ofdm.js";
import { trainingGrid } from "../lib/ofdmEnergy.js";
import { equalizeOfdm, fullTrainingLs } from "../lib/ofdmEqualizer.js";
import { ofdmDecode, ofdmModulate } from "../lib/ofdmModulation.js";
import { defaultOfdmPlan } from "../lib/ofdmProtocol.js";
import { xoshiro128StarStar } from "../lib/fadingRandom.js";
import type { Tap } from "../lib/multipathChannel.js";
import {
  captureFrame,
  receiverFfts,
  rotateSamples,
} from "../lib/ofdmSync/capture.js";
import {
  acquireJointObservation,
  publicSyncPreamble,
} from "../lib/ofdmSync/jointEngine.js";

export const V15_CORE_VERSION = "signallab-v15-p1a-core-1";
// This domain accepts frame IDs only: no v1.4 seed can be supplied.
export const V15_TEST_RANDOM = "signallab-v15-p1a-test-rng-v1";
const N = 128,
  GUARD = 32,
  PREAMBLE = 256,
  DATA = 4,
  BITS = 768;

export interface FrameConfig {
  frameId: number;
  cp: number;
  cfo: number;
  sto: number;
  phase: number;
  taps: readonly Tap[];
  noisePower: number;
}
export interface Metric {
  bits: number;
  errors: number;
  erasedBits: number;
}
export interface Bounds {
  lower: number;
  upper: number;
}

async function random(frameId: number, role: "data" | "noise", slot: number) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${V15_TEST_RANDOM}|${frameId}|${role}|${slot}`),
  );
  const view = new DataView(bytes);
  return xoshiro128StarStar([0, 4, 8, 12].map((i) => view.getUint32(i, true)));
}

function validate(p: FrameConfig) {
  if (
    !p ||
    !Number.isSafeInteger(p.frameId) ||
    p.frameId < 0 ||
    !Number.isInteger(p.cp) ||
    p.cp < 0 ||
    p.cp > 32 ||
    !Number.isFinite(p.cfo) ||
    Math.abs(p.cfo) > 1 ||
    !Number.isInteger(p.sto) ||
    Math.abs(p.sto) > 16 ||
    !Number.isFinite(p.phase) ||
    Math.abs(p.phase) > Math.PI ||
    !Number.isFinite(p.noisePower) ||
    p.noisePower < 0 ||
    !Array.isArray(p.taps) ||
    p.taps.length < 1 ||
    p.taps.length > 4 ||
    p.taps.some(
      (t, i) =>
        !t ||
        !Number.isInteger(t.delay) ||
        t.delay < 0 ||
        t.delay > 15 ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        Math.abs(t.i) > 16 ||
        Math.abs(t.q) > 16 ||
        (i > 0 && t.delay <= p.taps[i - 1].delay),
    ) ||
    !p.taps.some((t) => t.i !== 0 || t.q !== 0)
  )
    throw new Error("Invalid v1.5 frame configuration.");
}

/** The estimator receives only an observation and the public CP length. */
export function estimateObservation(received: Float64Array, cp: number) {
  return acquireJointObservation(received, cp);
}

/** Delta is the useful FFT start minus the true useful start, in samples. */
export function safeWindow(
  cp: number,
  taps: readonly Tap[],
  delta: number,
): boolean {
  if (
    !Number.isInteger(cp) ||
    cp < 0 ||
    cp > 32 ||
    !Number.isInteger(delta) ||
    !Array.isArray(taps) ||
    taps.length === 0 ||
    taps.some(
      (t, i) =>
        !t ||
        !Number.isInteger(t.delay) ||
        t.delay < 0 ||
        t.delay > 15 ||
        !Number.isFinite(t.i) ||
        !Number.isFinite(t.q) ||
        (i > 0 && t.delay <= taps[i - 1].delay),
    )
  )
    throw new Error("Invalid safe-window inputs.");
  const active = taps.filter((t) => t.i !== 0 || t.q !== 0);
  if (!active.length) throw new Error("Channel has no active taps.");
  return (
    delta >= active[active.length - 1].delay - cp && delta <= active[0].delay
  );
}

export function berBounds(m: Metric): Bounds {
  if (
    !Number.isSafeInteger(m.bits) ||
    m.bits <= 0 ||
    !Number.isSafeInteger(m.errors) ||
    !Number.isSafeInteger(m.erasedBits) ||
    m.errors < 0 ||
    m.erasedBits < 0 ||
    m.errors + m.erasedBits > m.bits
  )
    throw new Error("Invalid metric.");
  return {
    lower: m.errors / m.bits,
    upper: (m.errors + m.erasedBits) / m.bits,
  };
}

/** Interval for B(e,d) - B(e,0) - B(0,d) + B(0,0). */
export function interaction(
  ed: Metric,
  e0: Metric,
  zD: Metric,
  z0: Metric,
): Bounds {
  if ([e0, zD, z0].some((m) => m.bits !== ed.bits))
    throw new Error("Unpaired frame denominators.");
  const a = berBounds(ed),
    b = berBounds(e0),
    c = berBounds(zD),
    d = berBounds(z0);
  return {
    lower: a.lower - b.upper - c.upper + d.lower,
    upper: a.upper - b.lower - c.lower + d.upper,
  };
}

/** A single synthetic frame. Test-only randomness, never a study stream. */
export async function createFrame(p: FrameConfig) {
  validate(p);
  const old = { ...defaultOfdmPlan(), cp: p.cp };
  const bins = old.activeBins.map((q) => binIndex(q, N));
  const training = trainingGrid(old),
    grids = [training],
    payload: number[][][] = [];
  for (let m = 0; m < DATA; m++) {
    const rng = await random(p.frameId, "data", m),
      grid = new Float64Array(2 * N),
      bits: number[][] = [];
    for (let k = 0; k < N; k++) {
      const values = Array.from({ length: 4 }, () => (rng() < 0.5 ? 0 : 1));
      if (bins.includes(k)) {
        bits[k] = values.slice(0, 2);
        grid.set(ofdmModulate(bits[k], "QPSK"), 2 * k);
      }
    }
    payload.push(bits);
    grids.push(grid);
  }
  const wave = Float64Array.from([
    ...publicSyncPreamble(),
    ...grids.flatMap((g) => [...modulateOfdm(g, p.cp)]),
  ]);
  const noise = new Float64Array(
    2 * (GUARD * 2 + wave.length / 2 + p.taps[p.taps.length - 1].delay),
  );
  const rng = await random(p.frameId, "noise", 0);
  for (let i = 0; i < noise.length; i += 2) {
    const radius =
        (Math.sqrt(-2 * Math.log(1 - rng())) / Math.SQRT2) *
        Math.sqrt(p.noisePower),
      angle = 2 * Math.PI * rng();
    noise[i] = radius * Math.cos(angle);
    noise[i + 1] = radius * Math.sin(angle);
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
  // The payload is for scoring only; it is never passed to the estimator.
  const config = Object.freeze({
    ...p,
    taps: Object.freeze(p.taps.map((t) => Object.freeze({ ...t }))),
  });
  return { received, wave, noise, training, payload, bins, config };
}

type Frame = Awaited<ReturnType<typeof createFrame>>;
/** Intervention uses truth only to set correction and absolute window; phase is not corrected. */
export function controlledMetric(
  frame: Frame,
  residualCfo: number,
  delta: number,
): Metric {
  const p = frame.config;
  if (
    !Number.isFinite(residualCfo) ||
    Math.abs(residualCfo) > 2 ||
    !Number.isInteger(delta)
  )
    throw new Error("Invalid intervention.");
  const cpStart = GUARD + p.sto + PREAMBLE + delta;
  const corrected = rotateSamples(
    frame.received,
    N,
    -(p.cfo - residualCfo),
    0,
    0,
  );
  // receiverFfts rejects a partial, negative, or out-of-capture window.
  const rx = receiverFfts(corrected, N, p.cp, cpStart, 1 + DATA);
  const csi = fullTrainingLs(
    frame.bins.flatMap((k) => [rx[0][2 * k], rx[0][2 * k + 1]]),
    frame.bins.flatMap((k) => [
      frame.training[2 * k],
      frame.training[2 * k + 1],
    ]),
  );
  const metric: Metric = { bits: BITS, errors: 0, erasedBits: 0 };
  for (let m = 1; m <= DATA; m++)
    for (let j = 0; j < frame.bins.length; j++) {
      const k = frame.bins[j];
      const eq = equalizeOfdm(
        [rx[m][2 * k], rx[m][2 * k + 1]],
        csi.slice(2 * j, 2 * j + 2),
        p.noisePower,
        2,
        "zf",
      );
      if (!eq.decision) {
        metric.erasedBits += 2;
        continue;
      }
      const decoded = ofdmDecode(eq.decision[0], eq.decision[1], "QPSK");
      metric.errors += decoded.reduce(
        (sum, bit, i) => sum + Number(bit !== frame.payload[m - 1][k][i]),
        0,
      );
    }
  return metric;
}

export function controlledExperiment(frame: Frame, e: number, delta: number) {
  const ed = controlledMetric(frame, e, delta),
    e0 = controlledMetric(frame, e, 0),
    zD = controlledMetric(frame, 0, delta),
    z0 = controlledMetric(frame, 0, 0);
  return { ed, e0, zD, z0, interaction: interaction(ed, e0, zD, z0) };
}
