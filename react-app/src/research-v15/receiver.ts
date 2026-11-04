import { binIndex } from "../lib/ofdm.js";
import { trainingGrid } from "../lib/ofdmEnergy.js";
import { equalizeOfdm, fullTrainingLs } from "../lib/ofdmEqualizer.js";
import { ofdmDecode } from "../lib/ofdmModulation.js";
import { defaultOfdmPlan } from "../lib/ofdmProtocol.js";
import { receiverFfts, rotateSamples } from "../lib/ofdmSync/capture.js";
import { acquireJointObservation } from "../lib/ofdmSync/jointEngine.js";

const N = 128,
  GUARD = 32,
  PREAMBLE = 256,
  SYMBOLS = 5,
  BITS = 768;

/** This object contains only public CP and an owned copy of received samples. */
export interface Observation {
  readonly cp: number;
}
const observations = new WeakMap<Observation, Float64Array>();
export type AcquisitionInfo =
  | { status: "not-attempted" }
  | { status: "failed"; reason: string }
  | {
      status: "ok";
      cfo: number;
      usefulStart: number;
      peak: number;
      score: number;
      coherence: number;
    };
export type ReceiverOutput =
  | {
      status: "ok";
      acquisition: AcquisitionInfo;
      correction: number;
      usefulStart: number;
      decisions: Uint8Array;
    }
  | { status: "capture-failed"; acquisition: AcquisitionInfo; reason: string }
  | {
      status: "window-failed";
      acquisition: AcquisitionInfo;
      reason: "incomplete-window";
      correction: number;
      usefulStart: number;
    };

/** Validate and copy; no full frame or arbitrary metadata is accepted. */
export function makeObservation(
  samples: Float64Array,
  cp: number,
): Observation {
  if (
    !(samples instanceof Float64Array) ||
    samples.length % 2 !== 0 ||
    samples.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e12) ||
    !Number.isInteger(cp) ||
    cp < 0 ||
    cp > 32
  )
    throw new Error("Invalid public observation.");
  const observation = Object.freeze({ cp });
  observations.set(observation, new Float64Array(samples));
  return observation;
}
function validateObservation(obs: Observation) {
  if (!obs || Object.keys(obs).join(",") !== "cp" || !observations.has(obs))
    throw new Error("Invalid public observation.");
  return observations.get(obs)!;
}

/** usefulStart is the useful FFT start, NOT the CP start used by receiverFfts. */
export function receiveAt(
  obs: Observation,
  correction: number,
  usefulStart: number,
  acquisition: AcquisitionInfo = { status: "not-attempted" },
): ReceiverOutput {
  const samples = validateObservation(obs);
  if (
    !Number.isFinite(correction) ||
    Math.abs(correction) > N / 2 ||
    !Number.isSafeInteger(usefulStart)
  )
    throw new Error("Invalid receiver parameters.");
  const cpStart = usefulStart - obs.cp;
  if (cpStart < 0 || cpStart + SYMBOLS * (N + obs.cp) > samples.length / 2)
    return {
      status: "window-failed",
      acquisition,
      reason: "incomplete-window",
      correction,
      usefulStart,
    };
  const rotated = rotateSamples(samples, N, -correction, 0, 0);
  const spectra = receiverFfts(rotated, N, obs.cp, cpStart, SYMBOLS);
  const plan = defaultOfdmPlan(),
    bins = plan.activeBins.map((q) => binIndex(q, N));
  const training = trainingGrid(plan);
  const csi = fullTrainingLs(
    bins.flatMap((k) => [spectra[0][2 * k], spectra[0][2 * k + 1]]),
    bins.flatMap((k) => [training[2 * k], training[2 * k + 1]]),
  );
  const decisions = new Uint8Array(BITS);
  let index = 0;
  for (let m = 1; m < SYMBOLS; m++)
    for (let j = 0; j < bins.length; j++) {
      const k = bins[j];
      // ZF does not need simulator noise power.
      const result = equalizeOfdm(
        [spectra[m][2 * k], spectra[m][2 * k + 1]],
        csi.slice(2 * j, 2 * j + 2),
        0,
        2,
        "zf",
      );
      if (!result.decision) {
        decisions[index++] = 2;
        decisions[index++] = 2;
      } else
        for (const bit of ofdmDecode(
          result.decision[0],
          result.decision[1],
          "QPSK",
        ))
          decisions[index++] = bit;
    }
  return { status: "ok", acquisition, correction, usefulStart, decisions };
}

/** Estimation receives nothing beyond the observation and public CP. */
export function receiveEstimated(obs: Observation): ReceiverOutput {
  const samples = validateObservation(obs);
  // v1.4 estimator requires both correlation regions and the full timing search.
  if (samples.length / 2 < GUARD + PREAMBLE + obs.cp + 31 + N)
    return {
      status: "capture-failed",
      reason: "insufficient-observation",
      acquisition: { status: "failed", reason: "insufficient-observation" },
    };
  const acquired = acquireJointObservation(samples, obs.cp);
  if (acquired.status === "failed")
    return {
      status: "capture-failed",
      reason: acquired.reason,
      acquisition: { status: "failed", reason: acquired.reason },
    };
  const acquisition: AcquisitionInfo = {
    status: "ok",
    cfo: acquired.cfo,
    usefulStart: acquired.start,
    peak: acquired.peak,
    score: acquired.score,
    coherence: acquired.coherence,
  };
  return receiveAt(obs, acquired.cfo, acquired.start, acquisition);
}

export function receiveRaw(obs: Observation): ReceiverOutput {
  validateObservation(obs);
  return receiveAt(obs, 0, GUARD + PREAMBLE + obs.cp);
}
