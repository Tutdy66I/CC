import {
  bitsPerSymbol,
  validateOfdmCombPlan,
  commonDataBins,
} from "./ofdmCombProtocol.js";
import { binIndex, demodulateOfdm } from "./ofdm.js";
import { assembleCombFrame, energyBudget } from "./ofdmCombEnergy.js";
import { convolve, frequencyResponse } from "./multipathChannel.js";
import { createOfdmRandom } from "./ofdmRandom.js";
import { fullTrainingLs, equalizeOfdm } from "./ofdmEqualizer.js";
import {
  estimateComb,
  interpolateComplex,
  interpolationWeights,
} from "./ofdmCombPilots.js";
import { publicPilot } from "./ofdmPilots.js";
import { ofdmModulate, ofdmDecode } from "./ofdmModulation.js";
import { channelBer } from "./channelSimulation.js";
import {
  OFDM_COMB_METHODS,
  type OfdmCombPlan,
  type OfdmCombTrial,
  type OfdmMetric,
  type OfdmCombCell,
  type FrozenOfdmCombPlan,
  type OfdmCombMethod,
} from "./ofdmCombTypes.js";
const emptyMetric = (): OfdmMetric => ({
  bits: 0,
  errors: 0,
  erasedBits: 0,
  deepFadeSymbols: 0,
  signalEnergy: 0,
  rawErrorEnergy: 0,
  decisionErrorEnergy: 0,
});
/** All layouts consume exactly the same virtual bits and standard noise, including null/pilot bins. */
export async function combFrameInputs(p: OfdmCombPlan, index: number) {
  const virtual: Float64Array[] = [],
    payloads: number[][] = [],
    n = p.fftSize,
    b = bitsPerSymbol(p.modulation);
  for (let m = 0; m < p.dataSymbols; m++) {
    const random = await createOfdmRandom(p.seed, index, "data", m),
      g = new Float64Array(2 * n),
      payload: number[] = [];
    for (let k = 0; k < n; k++) {
      const bits = Array.from({ length: 4 }, () =>
        random.uniform() < 0.5 ? 0 : 1,
      ).slice(0, b);
      g.set(ofdmModulate(bits, p.modulation), 2 * k);
      payload[k] = bits.reduce<number>((v, x) => (v << 1) | x, 0);
    }
    virtual.push(g);
    payloads.push(payload);
  }
  const standardNoise = new Float64Array(2 * (p.dataSymbols + 1) * (n + p.cp));
  for (let m = 0; m <= p.dataSymbols; m++) {
    const body = await createOfdmRandom(
        p.seed,
        index,
        m === 0 ? "training-body" : "data-body",
        m === 0 ? 0 : m - 1,
      ),
      prefix = await createOfdmRandom(
        p.seed,
        index,
        m === 0 ? "training-prefix" : "data-prefix",
        m === 0 ? 0 : m - 1,
      );
    for (let t = 0; t < n + p.cp; t++)
      standardNoise.set(
        (t < p.cp ? prefix : body).complex(),
        2 * (m * (n + p.cp) + t),
      );
  }
  const random = await createOfdmRandom(p.seed, index, "channel", 0),
    pdp = p.taps.reduce((s, t) => s + t.power, 0);
  const rayleigh = p.taps.map((t) => {
    const [i, q] = random.complex(),
      a = Math.sqrt(t.power / pdp);
    return { delay: t.delay, i: i * a, q: q * a };
  });
  return { virtual, payloads, standardNoise, rayleigh };
}
/** Complete independent block-static frame; truth is used only by ideal CSI and post-hoc diagnostics. */
export async function simulateOfdmCombTrial(
  p: OfdmCombPlan,
  index: number,
): Promise<OfdmCombTrial> {
  validateOfdmCombPlan(p);
  if (!Number.isInteger(index) || index < 0 || index >= p.trials)
    throw new Error("帧序号无效。");
  const n = p.fftSize,
    c = p.cp,
    b = bitsPerSymbol(p.modulation),
    slots = p.dataSymbols + 1,
    bins = p.activeBins.map((q) => binIndex(q, n)),
    common = new Set(commonDataBins(p)),
    inputs = await combFrameInputs(p, index),
    cells: OfdmCombCell[] = [];
  for (let layout = 0; layout < p.pilotLayouts.length; layout++) {
    const positions = p.pilotLayouts[layout],
      pilots = new Set(positions),
      frame = assembleCombFrame(p, layout, inputs.virtual),
      budget = energyBudget(p, layout),
      known = positions.flatMap((q) => publicPilot(binIndex(q, n), b));
    for (const channel of p.channels) {
      const taps =
          channel === "awgn"
            ? [{ delay: 0, i: 1, q: 0 }]
            : channel === "fixed"
              ? p.taps
              : inputs.rayleigh,
        truth = frequencyResponse(n, taps),
        clean = convolve(frame.wave, taps),
        cpSufficient =
          c >=
          Math.max(
            ...taps.filter((t) => t.i !== 0 || t.q !== 0).map((t) => t.delay),
            0,
          );
      const slice = (x: Float64Array, m: number) =>
        demodulateOfdm(
          x.subarray(2 * m * (n + c), 2 * (m + 1) * (n + c)),
          c,
          n,
        );
      const diagonalResidual = Array.from({ length: slots }, (_, m) => {
        const g = slice(clean, m);
        return bins.reduce((s, k) => {
          const re =
              truth[2 * k] * frame.grids[m][2 * k] -
              truth[2 * k + 1] * frame.grids[m][2 * k + 1],
            im =
              truth[2 * k] * frame.grids[m][2 * k + 1] +
              truth[2 * k + 1] * frame.grids[m][2 * k];
          return s + (g[2 * k] - re) ** 2 + (g[2 * k + 1] - im) ** 2;
        }, 0);
      });
      for (const db of p.ebN0Db) {
        const n0 = p.noiseEnabled
            ? (p.energyBasis === "data-eb" ? 1 : budget.expectedEbTotal) /
              10 ** (db / 10)
            : 0,
          received = Float64Array.from(
            frame.wave,
            (_, j) => clean[j] + Math.sqrt(n0) * inputs.standardNoise[j],
          ),
          rx = Array.from({ length: slots }, (_, m) => slice(received, m));
        const training = fullTrainingLs(
            bins.flatMap((k) => [rx[0][2 * k], rx[0][2 * k + 1]]),
            bins.flatMap((k) => [
              frame.grids[0][2 * k],
              frame.grids[0][2 * k + 1],
            ]),
          ),
          comb = rx.slice(1).map((g) =>
            estimateComb(
              positions,
              positions.flatMap((q) => {
                const k = binIndex(q, n);
                return [g[2 * k], g[2 * k + 1]];
              }),
              known,
              p.activeBins,
            ),
          );
        const scopes = (["all", "common"] as const).map(
          (scope) =>
            ({
              layout,
              scope,
              channel,
              ebN0Db: db,
              noisePower: n0,
              cpSufficient,
              energy: frame.energy,
              estimation: {
                trainingError: 0,
                combError: 0,
                channelEnergy: 0,
                tones: 0,
                bias: cpSufficient ? 0 : null,
                noise: cpSufficient ? 0 : null,
              },
              diagonalResidual,
              methods: Object.fromEntries(
                OFDM_COMB_METHODS.map((m) => [m, emptyMetric()]),
              ) as OfdmCombCell["methods"],
              preview: {
                bins: [],
                truth: [],
                training: [],
                comb: [],
                pilots: [],
                pilotLs: [],
              },
            }) as OfdmCombCell,
        );
        const truePilots = positions.flatMap((q) => {
            const k = binIndex(q, n);
            return [truth[2 * k], truth[2 * k + 1]];
          }),
          biasCurve = interpolateComplex(positions, truePilots, p.activeBins),
          weights = interpolationWeights(positions, p.activeBins);
        for (let j = 0; j < bins.length; j++) {
          const k = bins[j],
            q = p.activeBins[j],
            h = [truth[2 * k], truth[2 * k + 1]],
            ht = training.slice(2 * j, 2 * j + 2),
            w = weights[j],
            bias =
              (biasCurve[2 * j] - h[0]) ** 2 +
              (biasCurve[2 * j + 1] - h[1]) ** 2,
            variance = (n0 * (w.a * w.a + w.b * w.b)) / b;
          if (index === 0) {
            const v = scopes[0].preview;
            v.bins.push(q);
            v.truth.push(...h);
            v.training.push(...ht);
            v.comb.push(...comb[0].estimate.slice(2 * j, 2 * j + 2));
          }
          if (pilots.has(q)) continue;
          const targets = common.has(q) ? scopes : [scopes[0]];
          for (let m = 1; m < slots; m++) {
            const hc = comb[m - 1].estimate.slice(2 * j, 2 * j + 2),
              tx = [frame.grids[m][2 * k], frame.grids[m][2 * k + 1]],
              y = [rx[m][2 * k], rx[m][2 * k + 1]];
            for (const cell of targets) {
              const e = cell.estimation;
              e.trainingError += (ht[0] - h[0]) ** 2 + (ht[1] - h[1]) ** 2;
              e.combError += (hc[0] - h[0]) ** 2 + (hc[1] - h[1]) ** 2;
              e.channelEnergy += h[0] ** 2 + h[1] ** 2;
              e.tones++;
              if (e.bias !== null) e.bias += bias;
              if (e.noise !== null) e.noise += variance;
            }
            for (const method of OFDM_COMB_METHODS) {
              const csi = method.startsWith("ideal")
                  ? h
                  : method.startsWith("training")
                    ? ht
                    : hc,
                eq = equalizeOfdm(
                  y,
                  csi,
                  n0,
                  b,
                  method.endsWith("mmse") ? "mmse" : "zf",
                ),
                decoded = eq.decision
                  ? ofdmDecode(eq.decision[0], eq.decision[1], p.modulation)
                  : null,
                code = inputs.payloads[m - 1][k],
                errors =
                  decoded?.reduce(
                    (s, x, t) =>
                      s + (x !== ((code >> (b - 1 - t)) & 1) ? 1 : 0),
                    0,
                  ) ?? 0,
                err = (v: readonly number[]) =>
                  (v[0] - tx[0]) ** 2 + (v[1] - tx[1]) ** 2;
              for (const cell of targets) {
                const metric = cell.methods[method];
                metric.bits += b;
                metric.signalEnergy += tx[0] ** 2 + tx[1] ** 2;
                if (Math.hypot(...csi) < 1e-6) metric.deepFadeSymbols++;
                if (!eq.decision) {
                  metric.erasedBits += b;
                  metric.rawErrorEnergy = null;
                  metric.decisionErrorEnergy = null;
                  continue;
                }
                metric.errors += errors;
                for (const [field, value] of [
                  ["rawErrorEnergy", eq.raw ? err(eq.raw) : NaN],
                  ["decisionErrorEnergy", err(eq.decision)],
                ] as const)
                  if (metric[field] !== null) {
                    const v = metric[field] + value;
                    metric[field] = Number.isFinite(v) ? v : null;
                  }
              }
            }
          }
        }
        if (index === 0) {
          scopes[0].preview.pilots = [...positions];
          scopes[0].preview.pilotLs = [...comb[0].pilotLs];
        }
        cells.push(...scopes);
      }
    }
  }
  return { index, cells };
}

export interface OfdmCombSummary {
  layout: number;
  scope: "all" | "common";
  channel: OfdmCombCell["channel"];
  ebN0Db: number;
  method: OfdmCombMethod;
  frames: number;
  bits: number;
  errors: number;
  erasedBits: number;
  failedFrames: number;
  ber: number | null;
  interval: [number, number];
  intervalRadius: number;
  pairedDifference: { mean: number | null; interval: [number, number] };
  layoutDifference: { mean: number | null; interval: [number, number] } | null;
  rawMse: number | null;
  rawEvmRms: number | null;
  decisionEvmRms: number | null;
  frameEvm: {
    p50: number | null;
    p90: number | null;
    p99: number | null;
    max: number | null;
    valid: number;
    failed: number;
  };
  channelNmse: number | null;
  lsMse: number;
  interpolationBias: number | null;
  pilotNoise: number | null;
  idealTheoryBer: number | null;
  cpSufficient: boolean;
}
/** Independent frames, not bits/tones/layouts, determine the confidence interval denominator. */
export function summarizeOfdmComb(
  f: FrozenOfdmCombPlan,
  trials: OfdmCombTrial[],
): OfdmCombSummary[] {
  const p = f.plan,
    F = p.trials;
  if (trials.length !== F || trials.some((t, j) => t.index !== j))
    throw new Error("仅完整独立帧批次可发布统计区间。");
  const radius = Math.sqrt(Math.log(40) / (2 * F)),
    pairRadius = Math.sqrt((2 * Math.log(40)) / F),
    finite = (v: number) => (Number.isFinite(v) ? v : null);
  return trials[0].cells.flatMap((first, j) =>
    OFDM_COMB_METHODS.map((method) => {
      const cells = trials.map((t) => t.cells[j]),
        metrics = cells.map((c) => c.methods[method]),
        average = (g: (c: OfdmCombCell) => number) =>
          cells.reduce((s, c) => s + g(c) / F, 0),
        sum = (key: "bits" | "errors" | "erasedBits") =>
          metrics.reduce((s, m) => s + m[key], 0),
        bits = sum("bits"),
        errors = sum("errors"),
        erasedBits = sum("erasedBits"),
        low = average((c) => c.methods[method].errors / c.methods[method].bits),
        high = average(
          (c) =>
            (c.methods[method].errors + c.methods[method].erasedBits) /
            c.methods[method].bits,
        ),
        signal = average((c) => c.methods[method].signalEnergy);
      const pooled = (key: "rawErrorEnergy" | "decisionErrorEnergy") =>
        metrics.some((m) => m[key] === null)
          ? null
          : average((c) => c.methods[method][key]!);
      const raw = pooled("rawErrorEnergy"),
        decision = pooled("decisionErrorEnergy"),
        evms = metrics
          .filter((m) => m.decisionErrorEnergy !== null)
          .map(
            (m) =>
              Math.sqrt(m.decisionErrorEnergy!) / Math.sqrt(m.signalEnergy),
          )
          .filter(Number.isFinite)
          .sort((a, b) => a - b),
        quantile = (q: number) =>
          evms.length ? evms[Math.ceil(q * (evms.length - 1))] : null;
      const pair = (reference: OfdmMetric[]) => {
        if (metrics.some((m, i) => m.erasedBits || reference[i].erasedBits))
          return { mean: null, interval: [-1, 1] as [number, number] };
        const mean = metrics.reduce(
          (s, m, i) =>
            s +
            (m.errors / m.bits - reference[i].errors / reference[i].bits) / F,
          0,
        );
        return {
          mean,
          interval: [
            Math.max(-1, mean - pairRadius),
            Math.min(1, mean + pairRadius),
          ] as [number, number],
        };
      };
      const baselineIndex = trials[0].cells.findIndex(
          (c) =>
            c.layout === 0 &&
            c.scope === "common" &&
            c.channel === first.channel &&
            c.ebN0Db === first.ebN0Db,
        ),
        error = method.startsWith("ideal")
          ? 0
          : average((c) =>
              method.startsWith("training")
                ? c.estimation.trainingError
                : c.estimation.combError,
            ),
        energy = average((c) => c.estimation.channelEnergy);
      return {
        layout: first.layout,
        scope: first.scope,
        channel: first.channel,
        ebN0Db: first.ebN0Db,
        method,
        frames: F,
        bits,
        errors,
        erasedBits,
        failedFrames: metrics.filter((m) => m.erasedBits > 0).length,
        ber: erasedBits ? null : errors / bits,
        interval: [Math.max(0, low - radius), Math.min(1, high + radius)] as [
          number,
          number,
        ],
        intervalRadius: radius,
        pairedDifference: pair(cells.map((c) => c.methods["training-zf"])),
        layoutDifference:
          first.scope === "common"
            ? pair(trials.map((t) => t.cells[baselineIndex].methods[method]))
            : null,
        rawMse:
          raw === null
            ? null
            : finite(raw / (bits / F / bitsPerSymbol(p.modulation))),
        rawEvmRms:
          raw === null ? null : finite(Math.sqrt(raw) / Math.sqrt(signal)),
        decisionEvmRms:
          decision === null
            ? null
            : finite(Math.sqrt(decision) / Math.sqrt(signal)),
        frameEvm: {
          p50: quantile(0.5),
          p90: quantile(0.9),
          p99: quantile(0.99),
          max: evms.at(-1) ?? null,
          valid: evms.length,
          failed: F - evms.length,
        },
        channelNmse: energy === 0 ? null : finite(error / energy),
        lsMse: error / first.estimation.tones,
        interpolationBias: cells.some((c) => c.estimation.bias === null)
          ? null
          : average((c) => c.estimation.bias!) / first.estimation.tones,
        pilotNoise: cells.some((c) => c.estimation.noise === null)
          ? null
          : average((c) => c.estimation.noise!) / first.estimation.tones,
        idealTheoryBer:
          !cells.every((c) => c.cpSufficient) ||
          !p.noiseEnabled ||
          first.channel === "fixed"
            ? null
            : channelBer(
                p.modulation,
                first.channel === "awgn" ? "awgn" : "rayleigh-block",
                first.ebN0Db -
                  (p.energyBasis === "total-eb"
                    ? 10 * Math.log10(first.energy.expectedEbTotal)
                    : 0),
              ),
        cpSufficient: cells.every((c) => c.cpSufficient),
      };
    }),
  );
}
