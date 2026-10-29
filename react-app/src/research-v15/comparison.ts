import {
  berBounds,
  controlledMetric,
  createFrame,
  interaction,
  safeWindow,
  type Bounds,
  type FrameConfig,
  type Metric,
} from "./core.js";
import {
  makeObservation,
  receiveAt,
  receiveEstimated,
  receiveRaw,
  type ReceiverOutput,
} from "./receiver.js";

export const P1B_VERSION = "signallab-v15-p1b-engineering-1";
const N = 128,
  GUARD = 32,
  PREAMBLE = 256,
  SYMBOLS = 5,
  BITS = 768;
type Frame = Awaited<ReturnType<typeof createFrame>>;
type Branch = {
  receiver: ReceiverOutput;
  metric: Metric;
  ber: Bounds;
  windowSafe: boolean | null;
  timingError: number | null;
  cfoError: number | null;
};

/** Payload reaches this scorer only after observation-only reception. */
export function scoreReceiver(
  receiver: ReceiverOutput,
  payload: number[][][],
  bins: number[],
): Metric {
  if (receiver.status !== "ok")
    return { bits: BITS, errors: 0, erasedBits: BITS };
  if (
    receiver.decisions.length !== BITS ||
    bins.length !== 96 ||
    payload.length !== 4
  )
    throw new Error("Invalid receiver output or payload.");
  const metric: Metric = { bits: BITS, errors: 0, erasedBits: 0 };
  let index = 0;
  for (let m = 0; m < 4; m++)
    for (const k of bins) {
      const bits = payload[m]?.[k];
      if (!bits || bits.length !== 2 || bits.some((b) => b !== 0 && b !== 1))
        throw new Error("Invalid scoring payload.");
      for (const bit of bits) {
        const decision = receiver.decisions[index++];
        if (decision === 2) metric.erasedBits++;
        else if (decision === 0 || decision === 1)
          metric.errors += Number(decision !== bit);
        else throw new Error("Invalid receiver decision.");
      }
    }
  return metric;
}

export function pairedDifference(a: Metric, b: Metric): Bounds {
  if (a.bits !== b.bits) throw new Error("Unpaired frame denominators.");
  const x = berBounds(a),
    y = berBounds(b);
  return { lower: x.lower - y.upper, upper: x.upper - y.lower };
}

function branch(frame: Frame, receiver: ReceiverOutput): Branch {
  const metric = scoreReceiver(receiver, frame.payload, frame.bins);
  const p = frame.config;
  const delta =
    receiver.status === "ok"
      ? receiver.usefulStart - (GUARD + p.sto + PREAMBLE + p.cp)
      : null;
  const cfoError =
    receiver.acquisition.status === "ok"
      ? receiver.acquisition.cfo - p.cfo
      : null;
  return {
    receiver,
    metric,
    ber: berBounds(metric),
    timingError: delta,
    windowSafe: delta === null ? null : safeWindow(p.cp, p.taps, delta),
    cfoError,
  };
}

/** Only the simulation evaluator can access truth or payload; receivers get the copied observation. */
export function compareFrame(frame: Frame, e: number, delta: number) {
  const p = frame.config;
  if (!Number.isFinite(e) || Math.abs(e) > 2 || !Number.isSafeInteger(delta))
    throw new Error("Invalid intervention parameters.");
  // Reject an invalid experiment against the complete simulated capture, independently of observed truncation.
  const fullLength =
    2 * GUARD +
    PREAMBLE +
    SYMBOLS * (N + p.cp) +
    p.taps[p.taps.length - 1].delay;
  const requestedCpStart = GUARD + p.sto + PREAMBLE + delta;
  if (
    requestedCpStart < 0 ||
    requestedCpStart + SYMBOLS * (N + p.cp) > fullLength
  )
    throw new Error("Intervention window is outside capture.");
  const obs = makeObservation(frame.received, p.cp);
  function intervention(residual: number, offset: number) {
    const cpStart = GUARD + p.sto + PREAMBLE + offset;
    if (
      cpStart < 0 ||
      cpStart + SYMBOLS * (N + p.cp) > frame.received.length / 2
    )
      return {
        status: "window-failed" as const,
        reason: "incomplete-window" as const,
        metric: { bits: BITS, errors: 0, erasedBits: BITS },
        ber: { lower: 0, upper: 1 },
        windowSafe: null,
      };
    const metric = controlledMetric(frame, residual, offset);
    return {
      status: "ok" as const,
      metric,
      ber: berBounds(metric),
      windowSafe: safeWindow(p.cp, p.taps, offset),
    };
  }
  const ed = intervention(e, delta),
    e0 = intervention(e, 0),
    zD = intervention(0, delta),
    z0 = intervention(0, 0);
  const controlled = {
    ed,
    e0,
    zD,
    z0,
    interaction: interaction(ed.metric, e0.metric, zD.metric, z0.metric),
  };
  const rawOutput = receiveRaw(obs);
  const estimatedOutput = receiveEstimated(obs);
  const idealOutput = receiveAt(obs, p.cfo, GUARD + p.sto + PREAMBLE + p.cp);
  const raw = branch(frame, rawOutput),
    estimated = branch(frame, estimatedOutput),
    ideal = branch(frame, idealOutput);
  return {
    frameId: p.frameId,
    raw,
    estimated,
    ideal,
    controlled,
    paired: {
      estimatedMinusRaw: pairedDifference(estimated.metric, raw.metric),
      estimatedMinusIdeal: pairedDifference(estimated.metric, ideal.metric),
      residualCfoMinusIdeal: pairedDifference(e0.metric, z0.metric),
      timingOffsetMinusIdeal: pairedDifference(zD.metric, z0.metric),
      jointInterventionMinusIdeal: pairedDifference(ed.metric, z0.metric),
    },
  };
}

/** Bounded test-domain runs: no statistical intervals or formal-research claims. */
export async function runEngineeringBatch(
  config: Omit<FrameConfig, "frameId">,
  ids: readonly number[],
  e: number,
  delta: number,
) {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 16 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 0) ||
    new Set(ids).size !== ids.length ||
    !Number.isFinite(e) ||
    Math.abs(e) > 2 ||
    !Number.isSafeInteger(delta) ||
    !config ||
    !Number.isFinite(config.noisePower) ||
    config.noisePower < 0 ||
    config.noisePower > 1e6
  )
    throw new Error("Invalid engineering batch parameters.");
  if (!Array.isArray(config.taps))
    throw new Error("Invalid engineering batch parameters.");
  const frameIds = [...ids];
  const fixed = {
    cp: config.cp,
    cfo: config.cfo,
    sto: config.sto,
    phase: config.phase,
    taps: config.taps.map((t) => ({ ...t })),
    noisePower: config.noisePower,
  };
  const first = await createFrame({ ...fixed, frameId: frameIds[0] });
  const p = first.config,
    cpStart = GUARD + p.sto + PREAMBLE + delta;
  if (cpStart < 0 || cpStart + SYMBOLS * (N + p.cp) > first.received.length / 2)
    throw new Error("Intervention window is outside capture.");
  const results = [compareFrame(first, e, delta)];
  for (const frameId of frameIds.slice(1))
    results.push(
      compareFrame(await createFrame({ ...fixed, frameId }), e, delta),
    );
  return {
    version: P1B_VERSION,
    purpose: "engineering-test-only" as const,
    config: fixed,
    intervention: { e, delta },
    frameIds,
    results,
  };
}
