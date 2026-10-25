import type {
  ChannelCell,
  ChannelMethod,
  ChannelMetric,
  ChannelModel,
  ChannelPlan,
  ChannelTrial,
  Complex,
} from "./channelTypes.js";
import type { Modulation } from "./modulationComparison.js";
import { QAM16_LEVELS, QAM16_SCALE, decodeQam16Axis } from "./qam16.js";
import { createFadingRandom } from "./fadingRandom.js";
import { applyFlatChannel, sampleFlatChannel } from "./flatFading.js";
import { estimatePilotChannel } from "./channelEstimator.js";
import { zeroForcingEqualize } from "./channelEqualizer.js";

/** Q(x)=Gamma(1/2,x^2/2)/(2*sqrt(pi)); series and continued fraction avoid cancellation. */
function normalTail(x: number): number {
  if (x === 0) return 0.5;
  const t = (x * x) / 2;
  const factor = Math.exp(-t + 0.5 * Math.log(t) - 0.5 * Math.log(Math.PI));
  if (t < 1.5) {
    let term = 2,
      sum = 2;
    for (let n = 1; n < 200; n++) {
      term *= t / (n + 0.5);
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * 2e-16) break;
    }
    return 0.5 * (1 - factor * sum);
  }
  let b = t + 0.5,
    c = 1e300,
    d = 1 / b,
    h = d;
  for (let n = 1; n < 200; n++) {
    const a = -n * (n - 0.5);
    b += 2;
    d = a * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + a / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const change = d * c;
    h *= change;
    if (Math.abs(change - 1) < 2e-15) break;
  }
  return 0.5 * factor * h;
}

/** Ensemble coherent perfect-CSI reference. Block and iid have the same marginal BER. */
export function channelBer(
  modulation: Modulation,
  model: ChannelModel,
  db: number,
): number {
  if (
    !["BPSK", "QPSK", "16QAM"].includes(modulation) ||
    !["awgn", "rayleigh-block", "rayleigh-iid"].includes(model) ||
    !Number.isFinite(db) ||
    db < -100 ||
    db > 100
  )
    throw new Error(
      "信道理论 BER 支持三种调制及 -100 到 100 dB 的内部 data Eb/N0。",
    );
  const gamma = 10 ** (db / 10);
  const r = (a: number) => {
    const t = a * gamma;
    return 0.5 / ((1 + t) * (1 + Math.sqrt(t / (1 + t))));
  };
  if (model !== "awgn")
    return modulation === "16QAM"
      ? 0.75 * r(0.4) + 0.5 * r(3.6) - 0.25 * r(10)
      : r(1);
  if (modulation !== "16QAM") return normalTail(Math.sqrt(2 * gamma));
  const distance = Math.sqrt(0.8 * gamma);
  return (
    0.75 * normalTail(distance) +
    0.5 * normalTail(3 * distance) -
    0.25 * normalTail(5 * distance)
  );
}

interface MetricAccumulator {
  bits: number;
  errors: number | null;
  signalEnergy: number;
  errorEnergy: number | null;
  failure: string | null;
}
const emptyMetric = (): MetricAccumulator => ({
  bits: 0,
  errors: 0,
  signalEnergy: 0,
  errorEnergy: 0,
  failure: null,
});
const methods: ChannelMethod[] = ["raw", "ideal", "ls"];

function symbolFromBits(
  modulation: Modulation,
  bits: Uint8Array,
  n: number,
): Complex {
  const offset = 4 * n;
  if (modulation === "16QAM")
    return {
      i: QAM16_LEVELS[2 * bits[offset] + bits[offset + 1]] * QAM16_SCALE,
      q: QAM16_LEVELS[2 * bits[offset + 2] + bits[offset + 3]] * QAM16_SCALE,
    };
  return {
    i: 1 - 2 * bits[offset],
    q: modulation === "BPSK" ? 0 : 1 - 2 * bits[offset + 1],
  };
}

function bitErrors(modulation: Modulation, tx: Complex, out: Complex): number {
  if (modulation === "16QAM") {
    const hamming = [0, 1, 1, 2];
    return (
      hamming[decodeQam16Axis(tx.i) ^ decodeQam16Axis(out.i)] +
      hamming[decodeQam16Axis(tx.q) ^ decodeQam16Axis(out.q)]
    );
  }
  return (
    Number(tx.i >= 0 !== out.i >= 0) +
    (modulation === "QPSK" ? Number(tx.q >= 0 !== out.q >= 0) : 0)
  );
}

function accumulate(
  metric: MetricAccumulator,
  modulation: Modulation,
  width: number,
  tx: Complex,
  out: Complex | null,
  failure: string | null,
) {
  metric.bits += width;
  metric.signalEnergy += tx.i ** 2 + tx.q ** 2;
  if (failure === "zero-csi") {
    // Frozen existing-slicer ties at 0: BPSK 0, QPSK 00, 16QAM 1111.
    if (metric.errors !== null)
      metric.errors += bitErrors(modulation, tx, { i: 0, q: 0 });
    metric.failure ??= failure;
    metric.errorEnergy = null;
    return;
  }
  if (failure || !out || ![out.i, out.q].every(Number.isFinite)) {
    metric.errors = null;
    metric.errorEnergy = null;
    metric.failure = failure ?? "nonfinite-sample";
    return;
  }
  if (metric.errors !== null) metric.errors += bitErrors(modulation, tx, out);
  if (metric.errorEnergy !== null) {
    metric.errorEnergy += (out.i - tx.i) ** 2 + (out.q - tx.q) ** 2;
    if (!Number.isFinite(metric.errorEnergy)) {
      metric.errorEnergy = null;
      metric.failure = "nonfinite-error-energy";
    }
  }
}

function finishMetric(metric: MetricAccumulator): ChannelMetric {
  return {
    ...metric,
    ber: metric.errors === null ? null : metric.errors / metric.bits,
    evmRms:
      metric.errorEnergy === null
        ? null
        : Math.sqrt(metric.errorEnergy / metric.signalEnergy),
  };
}

/** Independent role streams are consumed by absolute symbol before selecting any cell. */
export async function simulateChannelTrial(
  plan: ChannelPlan,
  index: number,
): Promise<ChannelTrial> {
  const N = plan.frameSymbols,
    maxP = Math.max(...plan.pilotCounts);
  if (
    !Number.isSafeInteger(N) ||
    N < 2 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= plan.trials ||
    !plan.pilotCounts.length ||
    plan.pilotCounts.some((p) => !Number.isInteger(p) || p < 1 || p >= N) ||
    !["BPSK", "QPSK", "16QAM"].includes(plan.modulation) ||
    !["data-eb", "total-eb"].includes(plan.energyBasis)
  )
    throw new Error("单帧信道参数无效。");
  const [dataRandom, channelRandom, noiseRandom] = await Promise.all([
    createFadingRandom(plan.seed, index, "data"),
    createFadingRandom(plan.seed, index, "channel"),
    createFadingRandom(plan.seed, index, "noise"),
  ]);
  const width =
    plan.modulation === "BPSK" ? 1 : plan.modulation === "QPSK" ? 2 : 4;
  const bits = new Uint8Array(4 * N),
    hi = new Float64Array(N),
    hq = new Float64Array(N),
    zi = new Float64Array(N),
    zq = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    for (let bit = 0; bit < 4; bit++)
      bits[4 * n + bit] = dataRandom.uniform() < 0.5 ? 0 : 1;
    const h = channelRandom.complex(),
      z = noiseRandom.complex();
    hi[n] = h.i;
    hq[n] = h.q;
    zi[n] = z.i;
    zq[n] = z.q;
  }
  const frameCoefficient = { i: hi[0], q: hq[0] };
  const training: Complex =
    plan.modulation === "BPSK"
      ? { i: 1, q: 0 }
      : plan.modulation === "QPSK"
        ? { i: 1, q: 1 }
        : { i: Math.SQRT2, q: Math.SQRT2 };
  const previewCount = Math.min(32, N - maxP);
  const previewIndices = new Set(
    index === 0
      ? Array.from({ length: previewCount }, (_, slot) =>
          previewCount === 1
            ? maxP
            : maxP + Math.floor((slot * (N - maxP - 1)) / (previewCount - 1)),
        )
      : [],
  );
  const cells: ChannelCell[] = [];
  for (const model of plan.channels)
    for (const ebN0Db of plan.ebN0Db)
      for (const pilots of plan.pilotCounts) {
        if (!Number.isFinite(ebN0Db) || ebN0Db < -10 || ebN0Db > 20)
          throw new Error("Eb/N0 超出 -10 到 20 dB。");
        const noisePower = plan.noiseEnabled
          ? (plan.energyBasis === "total-eb" ? N / (N - pilots) : 1) /
            10 ** (ebN0Db / 10)
          : 0;
        const hAt = (n: number) =>
          sampleFlatChannel(model, { i: hi[n], q: hq[n] }, frameCoefficient);
        const receivedAt = (tx: Complex, n: number, h: Complex) =>
          applyFlatChannel(tx, h, { i: zi[n], q: zq[n] }, noisePower);
        const observations = Array.from({ length: pilots }, (_, n) => ({
          tx: training,
          received: receivedAt(training, n, hAt(n)),
        }));
        const fit = estimatePilotChannel(observations);
        const estimate = fit.status === "ok" ? fit.estimate : null;
        const metrics = {
          raw: { all: emptyMetric(), common: emptyMetric() },
          ideal: { all: emptyMetric(), common: emptyMetric() },
          ls: { all: emptyMetric(), common: emptyMetric() },
        };
        let hEnergy = 0,
          estimationError = 0,
          deepFadeSymbols = 0;
        const preview: ChannelCell["preview"] = [];
        for (let n = pilots; n < N; n++) {
          const tx = symbolFromBits(plan.modulation, bits, n),
            h = hAt(n),
            received = receivedAt(tx, n, h);
          const ideal = zeroForcingEqualize(received, h);
          const ls = estimate
            ? zeroForcingEqualize(received, estimate)
            : {
                sample: null,
                failure:
                  fit.status === "failed" ? fit.reason : "missing-estimate",
              };
          const outputs = {
            raw: { sample: received, failure: null },
            ideal,
            ls,
          };
          for (const method of methods) {
            const out = outputs[method];
            accumulate(
              metrics[method].all,
              plan.modulation,
              width,
              tx,
              out.sample,
              out.failure,
            );
            if (n >= maxP)
              accumulate(
                metrics[method].common,
                plan.modulation,
                width,
                tx,
                out.sample,
                out.failure,
              );
          }
          const power = h.i ** 2 + h.q ** 2;
          hEnergy += power;
          if (power < 0.01) deepFadeSymbols++;
          if (estimate)
            estimationError +=
              (estimate.i - h.i) ** 2 + (estimate.q - h.q) ** 2;
          if (previewIndices.has(n))
            preview.push({
              index: n,
              tx,
              h,
              received,
              ideal: ideal.sample,
              ls: ls.sample,
            });
        }
        const dataEnergy = metrics.raw.all.signalEnergy,
          pilotEnergy = pilots * width;
        cells.push({
          model,
          ebN0Db,
          pilots,
          noisePower,
          dataEnergy,
          pilotEnergy,
          totalEnergy: dataEnergy + pilotEnergy,
          commonDataEnergy: metrics.raw.common.signalEnergy,
          dataSymbols: N - pilots,
          commonSymbols: N - maxP,
          hMeanPower: hEnergy / (N - pilots),
          hFirst: hAt(0),
          estimate,
          estimationSquaredError:
            estimate && Number.isFinite(estimationError)
              ? estimationError / (N - pilots)
              : null,
          deepFadeSymbols,
          methods: {
            raw: {
              all: finishMetric(metrics.raw.all),
              common: finishMetric(metrics.raw.common),
            },
            ideal: {
              all: finishMetric(metrics.ideal.all),
              common: finishMetric(metrics.ideal.common),
            },
            ls: {
              all: finishMetric(metrics.ls.all),
              common: finishMetric(metrics.ls.common),
            },
          },
          preview,
        });
      }
  return { index, cells };
}
