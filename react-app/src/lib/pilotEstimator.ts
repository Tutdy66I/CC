/** This module has no channel plan, truth, data decisions or simulation dependency. */
export interface PilotObservation {
  index: number
  pi: number
  pq: number
  i: number
  q: number
}
export interface PilotFit {
  status: 'ok'
  phaseRad: number
  frequency: number
  residualRms: number
  minMagnitude: number
  maxIncrement: number
  boundaryMargin: number
  range: number
  warnings: string[]
  phases: { index: number; phase: number; fitted: number }[]
}
export type PilotEstimate = PilotFit | { status: 'failed'; reason: string }
export function wrapPhase(value: number): number {
  const wrapped = Math.atan2(Math.sin(value), Math.cos(value))
  return wrapped >= Math.PI ? wrapped - 2 * Math.PI : wrapped
}

/** Uniform known pilots; unwrap followed by centered, unweighted phase OLS. */
export function estimatePilots(
  samples: readonly PilotObservation[],
): PilotEstimate {
  const failed = (): PilotEstimate => ({
    status: 'failed',
    reason: '导频无效、幅度为零或拟合退化，无法估计。',
  })
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 1024)
    return failed()
  if (
    samples.some(
      (p) =>
        !p ||
        ![p.index, p.pi, p.pq, p.i, p.q].every(Number.isFinite) ||
        !Number.isSafeInteger(p.index) ||
        p.index < 0,
    )
  )
    return failed()
  const spacing = samples[1].index - samples[0].index
  if (
    spacing <= 0 ||
    samples.some((p, m) => p.index !== samples[0].index + m * spacing)
  )
    return failed()
  const angles: number[] = [],
    phases: number[] = []
  let minMagnitude = Infinity,
    maxIncrement = 0
  for (const p of samples) {
    const energy = p.pi * p.pi + p.pq * p.pq
    if (!(energy > 0) || !Number.isFinite(energy)) return failed()
    const zi = (p.i * p.pi + p.q * p.pq) / energy,
      zq = (p.q * p.pi - p.i * p.pq) / energy
    const magnitude = Math.hypot(zi, zq)
    if (!(magnitude > 0) || !Number.isFinite(magnitude)) return failed()
    minMagnitude = Math.min(minMagnitude, magnitude)
    const angle = Math.atan2(zq, zi),
      m = angles.length
    const increment = m ? wrapPhase(angle - angles[m - 1]) : 0
    angles.push(angle)
    phases.push(m ? phases[m - 1] + increment : angle)
    maxIncrement = Math.max(maxIncrement, Math.abs(increment))
  }
  const xbar = samples.reduce((s, p) => s + p.index, 0) / samples.length
  const ybar = phases.reduce((a, b) => a + b, 0) / phases.length
  let numerator = 0,
    denominator = 0
  samples.forEach((p, m) => {
    numerator += (p.index - xbar) * (phases[m] - ybar)
    denominator += (p.index - xbar) ** 2
  })
  if (!(denominator > 0)) return failed()
  const slope = numerator / denominator,
    intercept = ybar - slope * xbar
  const trace = samples.map((p, m) => ({
    index: p.index,
    phase: phases[m],
    fitted: intercept + slope * p.index,
  }))
  const residualRms = Math.sqrt(
    trace.reduce((s, p) => s + (p.phase - p.fitted) ** 2, 0) / trace.length,
  )
  if (![slope, intercept, residualRms].every(Number.isFinite)) return failed()
  const warnings: string[] = []
  if (residualRms > 0.5)
    warnings.push('导频相位拟合残差较大，可能存在噪声或周跳。')
  if (maxIncrement >= 0.9 * Math.PI)
    warnings.push('相邻导频相位接近展开边界，估计可能不可靠。')
  if (minMagnitude < 0.1) warnings.push('存在低幅度导频，相位观测不稳定。')
  return {
    status: 'ok',
    phaseRad: wrapPhase(intercept),
    frequency: slope / (2 * Math.PI),
    residualRms,
    minMagnitude,
    maxIncrement,
    boundaryMargin: Math.PI - maxIncrement,
    range: 1 / (2 * spacing),
    warnings,
    phases: trace,
  }
}
