import { trainingGrid, complexEnergy } from "./ofdmEnergy.js";
import { bitsPerSymbol, validateOfdmCombPlan } from "./ofdmCombProtocol.js";
import type { OfdmCombPlan } from "./ofdmCombTypes.js";
import { publicPilot } from "./ofdmPilots.js";
import { binIndex, modulateOfdm } from "./ofdm.js";
import { fft } from "./fft.js";
export function combPilotGrid(p: OfdmCombPlan, positions: number[]) {
  const g = new Float64Array(2 * p.fftSize);
  for (const q of positions) {
    const k = binIndex(q, p.fftSize);
    g.set(publicPilot(k, bitsPerSymbol(p.modulation)), 2 * k);
  }
  return g;
}
export function energyBudget(p: OfdmCombPlan, layout = 0) {
  validateOfdmCombPlan(p);
  const positions = p.pilotLayouts[layout];
  if (!positions) throw new Error("导频布局序号无效。");
  const es = bitsPerSymbol(p.modulation),
    a = p.activeBins.length,
    d = a - positions.length;
  const training = fft(trainingGrid(p), true),
    pilot = fft(combPilotGrid(p, positions), true);
  const tail = (x: Float64Array) =>
    complexEnergy(x.subarray(x.length - 2 * p.cp));
  const trainingCpEnergy = tail(training),
    pilotCpEnergy = p.dataSymbols * tail(pilot),
    dataCpEnergy = ((p.dataSymbols * p.cp) / p.fftSize) * d * es;
  const useful = (1 + p.dataSymbols) * a * es,
    cp = trainingCpEnergy + pilotCpEnergy + dataCpEnergy,
    bits = es * d * p.dataSymbols;
  return {
    informationBits: bits,
    expectedUsefulEnergy: useful,
    expectedCpEnergy: cp,
    trainingCpEnergy,
    pilotCpEnergy,
    dataCpEnergy,
    expectedTotalEnergy: useful + cp,
    expectedEbTotal: (useful + cp) / bits,
    cpSampleFraction: p.cp / (p.fftSize + p.cp),
    trainingReFraction: 1 / (1 + p.dataSymbols),
    pilotReFraction:
      (a + p.dataSymbols * positions.length) / ((1 + p.dataSymbols) * a),
    combPilotFraction: positions.length / a,
    dataFraction: d / a,
    nullFraction: 1 - a / p.fftSize,
    bitsPerSample: bits / ((1 + p.dataSymbols) * (p.fftSize + p.cp)),
  };
}
/** Deterministic assembly also accepts independent reference grids; inactive virtual bins are ignored. */
export function assembleCombFrame(
  p: OfdmCombPlan,
  layout: number,
  virtual: Float64Array[],
) {
  const positions = p.pilotLayouts[layout],
    pilots = new Set(positions),
    n = p.fftSize;
  if (
    !positions ||
    virtual.length !== p.dataSymbols ||
    virtual.some(
      (x) => x.length !== 2 * n || x.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("虚拟载荷维度无效。");
  const pg = combPilotGrid(p, positions),
    data = virtual.map((v) => {
      const g = new Float64Array(2 * n);
      for (const q of p.activeBins)
        if (!pilots.has(q)) {
          const k = binIndex(q, n);
          g.set(v.subarray(2 * k, 2 * k + 2), 2 * k);
        }
      return g;
    });
  const grids = [
      trainingGrid(p),
      ...data.map((g) => Float64Array.from(g, (v, j) => v + pg[j])),
    ],
    symbols = grids.map((g) => modulateOfdm(g, p.cp)),
    wave = Float64Array.from(symbols.flatMap((x) => [...x]));
  const tail = (g: Float64Array) => modulateOfdm(g, p.cp).subarray(0, 2 * p.cp),
    px = tail(pg),
    dx = data.map(tail),
    trainingCp = complexEnergy(symbols[0].subarray(0, 2 * p.cp)),
    dataCp = dx.reduce((s, x) => s + complexEnergy(x), 0),
    pilotCp = p.dataSymbols * complexEnergy(px),
    crossCp = dx.reduce(
      (s, x) => s + x.reduce((a, v, j) => a + 2 * v * px[j], 0),
      0,
    ),
    useful = grids.reduce((s, g) => s + complexEnergy(g), 0),
    cp = symbols.reduce(
      (s, x) => s + complexEnergy(x.subarray(0, 2 * p.cp)),
      0,
    );
  return {
    grids,
    wave,
    energy: {
      useful,
      cp,
      training: complexEnergy(symbols[0]),
      total: complexEnergy(wave),
      expectedEbTotal: energyBudget(p, layout).expectedEbTotal,
      trainingCp,
      dataCp,
      pilotCp,
      crossCp,
      dataUseful: data.reduce((s, g) => s + complexEnergy(g), 0),
      pilotUseful: p.dataSymbols * complexEnergy(pg),
    },
  };
}
