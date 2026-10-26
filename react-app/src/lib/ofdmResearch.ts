import { bitsPerSymbol, validateOfdmPlan } from "./ofdmProtocol.js";
import { binIndex, modulateOfdm, demodulateOfdm } from "./ofdm.js";
import { complexEnergy, energyBudget, trainingGrid } from "./ofdmEnergy.js";
import { convolve, frequencyResponse } from "./multipathChannel.js";
import { createOfdmRandom } from "./ofdmRandom.js";
import { fullTrainingLs, equalizeOfdm } from "./ofdmEqualizer.js";
import { ofdmModulate, ofdmDecode } from "./ofdmModulation.js";
import { channelBer } from "./channelSimulation.js";
import {
  OFDM_METHODS,
  type OfdmPlan,
  type OfdmTrial,
  type OfdmMetric,
  type OfdmCell,
  type FrozenOfdmPlan,
} from "./ofdmTypes.js";

const emptyMetric = (): OfdmMetric => ({
  bits: 0,
  errors: 0,
  erasedBits: 0,
  deepFadeSymbols: 0,
  signalEnergy: 0,
  rawErrorEnergy: 0,
  decisionErrorEnergy: 0,
});
/** A complete independent block-static frame. All cells share data and standard noise. */
export async function simulateOfdmTrial(
  plan: OfdmPlan,
  index: number,
): Promise<OfdmTrial> {
  validateOfdmPlan(plan);
  if (!Number.isInteger(index) || index < 0 || index >= plan.trials)
    throw new Error("帧序号无效。");
  const n = plan.fftSize,
    c = plan.cp,
    b = bitsPerSymbol(plan.modulation),
    slots = plan.dataSymbols + 1;
  const bins = plan.activeBins.map((q) => binIndex(q, n)),
    budget = energyBudget(plan);
  const grids: Float64Array[] = [trainingGrid(plan)],
    payloads: number[][] = [[]];
  for (let m = 0; m < plan.dataSymbols; m++) {
    const random = await createOfdmRandom(plan.seed, index, "data", m),
      grid = new Float64Array(2 * n),
      payload: number[] = [];
    for (let k = 0; k < n; k++) {
      const bits = Array.from({ length: 4 }, () =>
        random.uniform() < 0.5 ? 0 : 1,
      );
      if (bins.includes(k)) {
        grid.set(ofdmModulate(bits.slice(0, b), plan.modulation), 2 * k);
        payload[k] = bits.slice(0, b).reduce<number>((v, x) => (v << 1) | x, 0);
      }
    }
    grids.push(grid);
    payloads.push(payload);
  }
  const symbols = grids.map((g) => modulateOfdm(g, c)),
    wave = Float64Array.from(symbols.flatMap((x) => [...x]));
  const useful = grids.reduce((s, g) => s + complexEnergy(g), 0),
    total = complexEnergy(wave);
  const standardNoise = new Float64Array(wave.length);
  for (let m = 0; m < slots; m++) {
    const body = await createOfdmRandom(
      plan.seed,
      index,
      m === 0 ? "training-body" : "data-body",
      m === 0 ? 0 : m - 1,
    );
    const prefix = await createOfdmRandom(
      plan.seed,
      index,
      m === 0 ? "training-prefix" : "data-prefix",
      m === 0 ? 0 : m - 1,
    );
    for (let t = 0; t < n + c; t++)
      standardNoise.set(
        (t < c ? prefix : body).complex(),
        2 * (m * (n + c) + t),
      );
  }
  const channelRandom = await createOfdmRandom(plan.seed, index, "channel", 0),
    pdp = plan.taps.reduce((s, t) => s + t.power, 0);
  const rayleigh = plan.taps.map((t) => {
    const [i, q] = channelRandom.complex(),
      a = Math.sqrt(t.power / pdp);
    return { delay: t.delay, i: i * a, q: q * a };
  });
  const cells: OfdmCell[] = [];
  for (const channel of plan.channels) {
    const taps =
      channel === "awgn"
        ? [{ delay: 0, i: 1, q: 0 }]
        : channel === "fixed"
          ? plan.taps
          : rayleigh;
    const truth = frequencyResponse(n, taps),
      clean = convolve(wave, taps);
    const cpSufficient =
      c >=
      Math.max(
        ...taps.filter((t) => t.i !== 0 || t.q !== 0).map((t) => t.delay),
        0,
      );
    const cleanGrids = Array.from({ length: slots }, (_, m) =>
      demodulateOfdm(
        clean.subarray(2 * m * (n + c), 2 * (m + 1) * (n + c)),
        c,
        n,
      ),
    );
    const diagonalResidual = cleanGrids.map((g, m) =>
      bins.reduce((s, k) => {
        const re =
            truth[2 * k] * grids[m][2 * k] -
            truth[2 * k + 1] * grids[m][2 * k + 1],
          im =
            truth[2 * k] * grids[m][2 * k + 1] +
            truth[2 * k + 1] * grids[m][2 * k];
        return s + (g[2 * k] - re) ** 2 + (g[2 * k + 1] - im) ** 2;
      }, 0),
    );
    for (const db of plan.ebN0Db) {
      const n0 = plan.noiseEnabled
        ? (plan.energyBasis === "data-eb" ? 1 : budget.expectedEbTotal) /
          10 ** (db / 10)
        : 0;
      const received = Float64Array.from(
        wave,
        (_, j) => clean[j] + Math.sqrt(n0) * standardNoise[j],
      );
      const rx = Array.from({ length: slots }, (_, m) =>
        demodulateOfdm(
          received.subarray(2 * m * (n + c), 2 * (m + 1) * (n + c)),
          c,
          n,
        ),
      );
      // Receiver entry has only noisy observations and known public training.
      const estimate = fullTrainingLs(
        bins.flatMap((k) => [rx[0][2 * k], rx[0][2 * k + 1]]),
        bins.flatMap((k) => [grids[0][2 * k], grids[0][2 * k + 1]]),
      );
      const methods = Object.fromEntries(
        OFDM_METHODS.map((m) => [m, emptyMetric()]),
      ) as OfdmCell["methods"];
      const preview: OfdmCell["preview"] = {
        bins: [],
        truth: [],
        estimate: [],
        tx: [],
        received: [],
        ls: [],
      };
      for (let j = 0; j < bins.length; j++) {
        const k = bins[j],
          h = [truth[2 * k], truth[2 * k + 1]],
          hhat = estimate.slice(2 * j, 2 * j + 2);
        if (
          index === 0 &&
          j % Math.max(1, Math.ceil(bins.length / 512)) === 0
        ) {
          preview.bins.push(plan.activeBins[j]);
          preview.truth.push(...h);
          preview.estimate.push(...hhat);
        }
        for (let m = 1; m < slots; m++) {
          const tx = [grids[m][2 * k], grids[m][2 * k + 1]],
            y = [rx[m][2 * k], rx[m][2 * k + 1]];
          for (const method of OFDM_METHODS) {
            const metric = methods[method],
              csi = method.startsWith("ideal") ? h : hhat;
            const eq = equalizeOfdm(
              y,
              csi,
              n0,
              b,
              method.endsWith("mmse") ? "mmse" : "zf",
            );
            metric.bits += b;
            metric.signalEnergy += tx[0] ** 2 + tx[1] ** 2;
            if (Math.hypot(...csi) < 1e-6) metric.deepFadeSymbols++;
            if (!eq.decision) {
              metric.erasedBits += b;
              metric.rawErrorEnergy = null;
              metric.decisionErrorEnergy = null;
              continue;
            }
            const code = payloads[m][k],
              decoded = ofdmDecode(
                eq.decision[0],
                eq.decision[1],
                plan.modulation,
              );
            metric.errors += decoded.reduce(
              (s, x, t) => s + (x !== ((code >> (b - 1 - t)) & 1) ? 1 : 0),
              0,
            );
            const err = (v: readonly number[]) =>
              (v[0] - tx[0]) ** 2 + (v[1] - tx[1]) ** 2;
            if (metric.decisionErrorEnergy !== null) {
              const v = metric.decisionErrorEnergy + err(eq.decision);
              metric.decisionErrorEnergy = Number.isFinite(v) ? v : null;
            }
            if (metric.rawErrorEnergy !== null) {
              const v = eq.raw ? metric.rawErrorEnergy + err(eq.raw) : NaN;
              metric.rawErrorEnergy = Number.isFinite(v) ? v : null;
            }
            if (index === 0 && method === "ls-zf" && preview.tx.length < 512) {
              preview.tx.push(...tx);
              preview.received.push(...y);
              preview.ls.push(...eq.decision);
            }
          }
        }
      }
      const channelErrorEnergy = bins.reduce(
        (s, k, j) =>
          s +
          (estimate[2 * j] - truth[2 * k]) ** 2 +
          (estimate[2 * j + 1] - truth[2 * k + 1]) ** 2,
        0,
      );
      cells.push({
        channel,
        ebN0Db: db,
        noisePower: n0,
        cpSufficient,
        energy: {
          useful,
          cp: total - useful,
          training: complexEnergy(symbols[0]),
          total,
          expectedEbTotal: budget.expectedEbTotal,
        },
        channelErrorEnergy,
        channelEnergy: bins.reduce(
          (s, k) => s + truth[2 * k] ** 2 + truth[2 * k + 1] ** 2,
          0,
        ),
        lsToneCount: bins.length,
        diagonalResidual,
        methods,
        preview,
      });
    }
  }
  return { index, cells };
}

export interface OfdmSummary {
  channel: OfdmCell["channel"];
  ebN0Db: number;
  method: (typeof OFDM_METHODS)[number];
  frames: number;
  bits: number;
  errors: number;
  erasedBits: number;
  failedFrames: number;
  ber: number | null;
  interval: [number, number];
  intervalRadius: number;
  pairedDifference: { mean: number | null; interval: [number, number] };
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
  idealTheoryBer: number | null;
  cpSufficient: boolean;
}
/** Primary bounded intervals use complete independent frames, never correlated bits. */
export function summarizeOfdm(
  frozen: FrozenOfdmPlan,
  trials: OfdmTrial[],
): OfdmSummary[] {
  const p = frozen.plan;
  if (trials.length !== p.trials || trials.some((t, i) => t.index !== i))
    throw new Error("仅完整独立帧批次可发布统计区间。");
  const radius = Math.sqrt(Math.log(40) / (2 * p.trials)),
    pairedRadius = Math.sqrt((2 * Math.log(40)) / p.trials);
  return trials[0].cells.flatMap((first, j) =>
    OFDM_METHODS.map((method) => {
      const cells = trials.map((t) => t.cells[j]),
        metrics = cells.map((c) => c.methods[method]),
        ideal = cells.map((c) => c.methods["ideal-zf"]);
      const sum = (key: "bits" | "errors" | "erasedBits" | "signalEnergy") =>
        metrics.reduce((s, v) => s + v[key], 0);
      const bits = sum("bits"),
        errors = sum("errors"),
        erasedBits = sum("erasedBits"),
        signal = sum("signalEnergy");
      const low = metrics.reduce((s, m) => s + m.errors / m.bits, 0) / p.trials,
        high =
          metrics.reduce((s, m) => s + (m.errors + m.erasedBits) / m.bits, 0) /
          p.trials;
      const evms = metrics
        .filter((m) => m.decisionErrorEnergy !== null)
        .map((m) => Math.sqrt(m.decisionErrorEnergy! / m.signalEnergy))
        .sort((a, b) => a - b);
      const quantile = (q: number) =>
        evms.length ? evms[Math.ceil(q * (evms.length - 1))] : null;
      const pooled = (key: "rawErrorEnergy" | "decisionErrorEnergy") =>
        metrics.some((m) => m[key] === null)
          ? null
          : metrics.reduce((s, m) => s + m[key]!, 0);
      const raw = pooled("rawErrorEnergy"),
        decision = pooled("decisionErrorEnergy");
      const missingPair = metrics.some(
          (m, i) => m.erasedBits || ideal[i].erasedBits,
        ),
        diff =
          metrics.reduce(
            (s, m, i) =>
              s + m.errors / m.bits - ideal[i].errors / ideal[i].bits,
            0,
          ) / p.trials;
      const channelEnergy = cells.reduce((s, c) => s + c.channelEnergy, 0),
        channelError = cells.reduce((s, c) => s + c.channelErrorEnergy, 0);
      return {
        channel: first.channel,
        ebN0Db: first.ebN0Db,
        method,
        frames: p.trials,
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
        pairedDifference: {
          mean: missingPair ? null : diff,
          interval: missingPair
            ? ([-1, 1] as [number, number])
            : ([
                Math.max(-1, diff - pairedRadius),
                Math.min(1, diff + pairedRadius),
              ] as [number, number]),
        },
        rawMse:
          raw === null ? null : raw / (bits / bitsPerSymbol(p.modulation)),
        rawEvmRms: raw === null ? null : Math.sqrt(raw / signal),
        decisionEvmRms: decision === null ? null : Math.sqrt(decision / signal),
        frameEvm: {
          p50: quantile(0.5),
          p90: quantile(0.9),
          p99: quantile(0.99),
          max: evms.at(-1) ?? null,
          valid: evms.length,
          failed: p.trials - evms.length,
        },
        channelNmse: channelEnergy === 0 ? null : channelError / channelEnergy,
        lsMse: channelError / (p.trials * first.lsToneCount),
        idealTheoryBer:
          !first.cpSufficient || !p.noiseEnabled || first.channel === "fixed"
            ? null
            : channelBer(
                p.modulation,
                first.channel === "awgn" ? "awgn" : "rayleigh-block",
                first.ebN0Db -
                  (p.energyBasis === "total-eb"
                    ? 10 * Math.log10(first.energy.expectedEbTotal)
                    : 0),
              ),
        cpSufficient: first.cpSufficient,
      };
    }),
  );
}
