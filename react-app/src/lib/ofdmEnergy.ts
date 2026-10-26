import { bitsPerSymbol, validateOfdmPlan } from "./ofdmProtocol.js";
import type { OfdmPlan } from "./ofdmTypes.js";
import { fft } from "./fft.js";
import { binIndex } from "./ofdm.js";
import { publicPilot } from "./ofdmPilots.js";
export const complexEnergy = (x: Float64Array) =>
  x.reduce((s, v) => s + v * v, 0);
export function trainingGrid(p: OfdmPlan): Float64Array {
  const grid = new Float64Array(2 * p.fftSize),
    es = bitsPerSymbol(p.modulation);
  for (const q of p.activeBins) {
    const k = binIndex(q, p.fftSize);
    grid.set(publicPilot(k, es), 2 * k);
  }
  return grid;
}
export function energyBudget(p: OfdmPlan) {
  validateOfdmPlan(p);
  const es = bitsPerSymbol(p.modulation),
    a = p.activeBins.length,
    bits = es * a * p.dataSymbols;
  const body = fft(trainingGrid(p), true),
    trainingCp = complexEnergy(body.subarray(body.length - 2 * p.cp));
  const useful = (1 + p.dataSymbols) * a * es,
    cp = trainingCp + ((p.dataSymbols * p.cp) / p.fftSize) * a * es;
  return {
    informationBits: bits,
    expectedUsefulEnergy: useful,
    expectedCpEnergy: cp,
    trainingCpEnergy: trainingCp,
    expectedTotalEnergy: useful + cp,
    expectedEbTotal: (useful + cp) / bits,
    cpSampleFraction: p.cp / (p.fftSize + p.cp),
    trainingReFraction: 1 / (1 + p.dataSymbols),
    nullFraction: 1 - a / p.fftSize,
    bitsPerSample: bits / ((1 + p.dataSymbols) * (p.fftSize + p.cp)),
  };
}
