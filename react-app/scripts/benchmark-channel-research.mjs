import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  appRoot,
  loadChannelEngine,
  buildFingerprint,
  sha256,
} from './channel-study-manifest.mjs'

const engine = await loadChannelEngine()
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const maximumFramePlan = {
  frameSymbols: 4096,
  modulation: 'QPSK',
  ebN0Db: [8],
  pilotCounts: [4, 16, 64],
  channels: ['awgn', 'rayleigh-block', 'rayleigh-iid'],
  trials: 1,
  seed: 42,
  energyBasis: 'data-eb',
  noiseEnabled: true,
}
if (process.argv.includes('--memory-child')) {
  for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
    const trial = await engine.simulateChannelTrial(
      { ...maximumFramePlan, modulation },
      0,
    )
    assert.equal(trial.cells.length, 9)
  }
  console.log(
    JSON.stringify({
      valid: true,
      sampledMemory: process.memoryUsage(),
      boundary:
        '32 MiB V8 old-space; sampled process values are not peak allocations or browser memory',
    }),
  )
  process.exit(0)
}
const cases = []
for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
  const plan = { ...maximumFramePlan, modulation }
  for (let warmup = 0; warmup < 2; warmup++)
    await engine.simulateChannelTrial(plan, 0)
  const durationsMs = []
  for (let repetition = 0; repetition < 7; repetition++) {
    const start = performance.now()
    await engine.simulateChannelTrial(plan, 0)
    durationsMs.push(performance.now() - start)
  }
  cases.push({ plan, durationsMs, medianMs: median(durationsMs) })
}
const defaultPlan = engine.defaultChannelPlan()
const start = performance.now()
const frozen = await engine.freezeChannelPlan(defaultPlan)
const trials = []
for (let index = 0; index < defaultPlan.trials; index++)
  trials.push(await engine.simulateChannelTrial(defaultPlan, index))
const record = engine.makeChannelRecord(frozen, trials)
await engine.parseChannelRecord(record)
const defaultEndToEndMs = performance.now() - start
const child = spawnSync(
  process.execPath,
  ['--max-old-space-size=32', fileURLToPath(import.meta.url), '--memory-child'],
  { cwd: appRoot, encoding: 'utf8', timeout: 30000 },
)
assert.equal(child.status, 0, child.stderr)
const extension = engine.executionMode === 'compiled-javascript' ? 'js' : 'ts'
const directory =
  engine.executionMode === 'compiled-javascript'
    ? '.test-build/src/lib'
    : 'src/lib'
const legacy = await import(
  pathToFileURL(resolve(appRoot, directory, `berSweep.${extension}`)).href
)
const archived = JSON.parse(
  readFileSync(
    resolve(appRoot, '../docs/signallab-v11-ber-benchmark.json'),
    'utf8',
  ),
)
const baseline = archived.cases.find((item) => item.bits === 1000000).candidate
const scan = () =>
  legacy.SWEEP_DB.map((db, index) =>
    legacy.simulateBerPoint(db, 1000000, (0xfffffffc + index) >>> 0),
  )
for (let warmup = 0; warmup < 2; warmup++) scan()
const oldDurations = []
for (let repetition = 0; repetition < 7; repetition++) {
  const before = performance.now()
  const output = scan()
  oldDurations.push(performance.now() - before)
  assert.deepEqual(output, baseline.output)
}
const legacyMedianMs = median(oldDurations)
const comparable =
  archived.node === process.version &&
  archived.platform === process.platform &&
  archived.cpu === cpus()[0]?.model
const oldRegressionRatio = comparable
  ? legacyMedianMs / baseline.medianMs
  : null
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  fingerprint: buildFingerprint(engine.executionMode),
  benchmarkScriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  method:
    'two warmups; seven kernel measurements; default Node end-to-end includes generation/summary/record validation, excludes Worker startup/UI/storage',
  cases,
  defaultPlan,
  defaultEndToEndMs,
  defaultNodeUnder5Seconds: defaultEndToEndMs <= 5000,
  memoryChild: JSON.parse(child.stdout),
  legacy: {
    bits: 1000000,
    exactParity: true,
    durationsMs: oldDurations,
    medianMs: legacyMedianMs,
    archivedMedianMs: baseline.medianMs,
    comparable,
    regressionRatio: oldRegressionRatio,
    under10PercentRegression:
      oldRegressionRatio === null ? null : oldRegressionRatio <= 1.1,
  },
}
const text = JSON.stringify(report, null, 2) + '\n'
const out = process.argv.indexOf('--out')
if (out >= 0) {
  if (!process.argv[out + 1])
    throw new Error('--out requires a report filename.')
  writeFileSync(resolve(process.argv[out + 1]), text)
}
console.log(text)
if (
  !report.defaultNodeUnder5Seconds ||
  report.legacy.under10PercentRegression === false
)
  process.exitCode = 1
