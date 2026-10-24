// Offline deterministic study; compile with tsc -p tsconfig.test.json first.
import { writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import {
  defaultEstimationPlan,
  runEstimation,
} from '../.test-build/src/lib/carrierEstimation.js'
import { statisticsSeed } from '../.test-build/src/lib/seedStatistics.js'
const trials = []
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length
for (const modulation of ['BPSK', 'QPSK', '16QAM'])
  for (const ebN0Db of [-4, 8, 14])
    for (let trial = 0; trial < 20; trial++) {
      const snrIndex = [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14].indexOf(ebN0Db)
      const plan = {
        ...defaultEstimationPlan(),
        modulation,
        ebN0Db,
        seed: statisticsSeed(42, trial, snrIndex),
      }
      const r = runEstimation(plan)
      trials.push({
        plan,
        trial,
        frequencyError: r.frequencyError,
        phaseErrorDeg: r.phaseErrorDeg,
        fitStatus: r.fit.status,
        warnings: r.fit.status === 'ok' ? r.fit.warnings : [],
        residualRms: r.fit.status === 'ok' ? r.fit.residualRms : null,
        halfCycleDrift:
          Math.abs(r.frequencyError ?? Infinity) * (r.totalSymbols - 1) > 0.5,
        raw: { ber: r.raw.ber, evm: r.raw.evmRms },
        estimated: r.estimated
          ? { ber: r.estimated.ber, evm: r.estimated.evmRms }
          : null,
        ideal: { ber: r.ideal.ber, evm: r.ideal.evmRms },
      })
    }
const summaries = []
for (const modulation of ['BPSK', 'QPSK', '16QAM'])
  for (const ebN0Db of [-4, 8, 14]) {
    const group = trials.filter(
      (r) => r.plan.modulation === modulation && r.plan.ebN0Db === ebN0Db,
    )
    summaries.push({
      modulation,
      ebN0Db,
      trials: group.length,
      failed: group.filter((r) => r.fitStatus === 'failed').length,
      warned: group.filter((r) => r.warnings.length).length,
      halfCycleDrift: group.filter((r) => r.halfCycleDrift).length,
      frequencyRmse: Math.sqrt(
        mean(group.map((r) => (r.frequencyError ?? NaN) ** 2)),
      ),
      phaseRmseDeg: Math.sqrt(
        mean(group.map((r) => (r.phaseErrorDeg ?? NaN) ** 2)),
      ),
      ...Object.fromEntries(
        ['raw', 'estimated', 'ideal'].map((branch) => [
          branch,
          {
            meanBer: mean(group.map((r) => r[branch]?.ber ?? NaN)),
            meanEvm: mean(group.map((r) => r[branch]?.evm ?? NaN)),
          },
        ]),
      ),
    })
  }
const maximumFrames = []
for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
  const plan = {
    ...defaultEstimationPlan(),
    modulation,
    spacing: 128,
    pilots: 1024,
  }
  runEstimation(plan)
  runEstimation(plan)
  const durationsMs = []
  for (let n = 0; n < 7; n++) {
    const start = performance.now()
    runEstimation(plan)
    durationsMs.push(performance.now() - start)
  }
  maximumFrames.push({
    plan,
    totalSymbols: 130945,
    durationsMs,
    medianMs: [...durationsMs].sort((a, b) => a - b)[3],
    sampledProcessMemory: process.memoryUsage(),
  })
}
const result = {
  node: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  timestamp: new Date().toISOString(),
  method:
    '20 fixed seeds per modulation/SNR; frequency drift diagnostic is posthoc, not a cycle-slip detector; single-frame measurements, no universal guarantee; memoryUsage is sampled process memory, not peak allocation',
  summaries,
  trials,
  maximumFrames,
}
await writeFile(
  '../docs/signallab-v1-estimation-study.json',
  JSON.stringify(result, null, 2) + '\n',
)
console.log(
  JSON.stringify(
    {
      summaries,
      maximumFrameMedians: maximumFrames.map((r) => ({
        modulation: r.plan.modulation,
        medianMs: r.medianMs,
      })),
    },
    null,
    2,
  ),
)
