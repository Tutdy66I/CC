import { fullTrainingLs } from "./ofdmEqualizer.js";
export interface InterpolationWeight {
  left: number;
  right: number;
  a: number;
  b: number;
}
/** Coordinate-only operator; targets may cross DC but must be inside the pilot hull. */
export function interpolationWeights(
  positions: number[],
  targets: number[],
): InterpolationWeight[] {
  if (
    positions.length < 2 ||
    positions.some(
      (q, j) => !Number.isInteger(q) || (j > 0 && q <= positions[j - 1]),
    ) ||
    targets.some(
      (q, j) =>
        !Number.isInteger(q) ||
        q < positions[0] ||
        q > positions.at(-1)! ||
        (j > 0 && q <= targets[j - 1]),
    )
  )
    throw new Error("插值坐标需排序互异，目标不得超出导频边界。");
  let j = 0;
  return targets.map((q) => {
    while (j < positions.length - 2 && positions[j + 1] < q) j++;
    const b = (q - positions[j]) / (positions[j + 1] - positions[j]);
    return { left: j, right: j + 1, a: 1 - b, b };
  });
}
export function interpolateComplex(
  positions: number[],
  values: readonly number[],
  targets: number[],
): number[] {
  if (
    values.length !== 2 * positions.length ||
    values.some((v) => !Number.isFinite(v))
  )
    throw new Error("复数导频估计无效。");
  return interpolationWeights(positions, targets).flatMap((w) => [
    w.a * values[2 * w.left] + w.b * values[2 * w.right],
    w.a * values[2 * w.left + 1] + w.b * values[2 * w.right + 1],
  ]);
}
/** Receiver API deliberately has no channel coefficients or noiseless samples. */
export function estimateComb(
  positions: number[],
  observed: readonly number[],
  known: readonly number[],
  targets: number[],
) {
  if (
    observed.length !== positions.length * 2 ||
    known.length !== observed.length
  )
    throw new Error("导频观测长度无效。");
  const pilotLs = fullTrainingLs([...observed], [...known]);
  return { pilotLs, estimate: interpolateComplex(positions, pilotLs, targets) };
}
