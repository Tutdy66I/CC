// Offline, resumable study. Run tsc -p tsconfig.test.json first. No network/AI/database access.
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import {
  defaultResearchPlan,
  runCarrierResearch,
  researchOperations,
  RESEARCH_ENGINE,
  RESEARCH_SEED_RULE,
} from '../.test-build/src/lib/carrierResearch.js'
import {
  makeResearchRecord,
  parseResearchRecord,
  parseResearchCheckpoint,
  OFFLINE_RESEARCH_BUDGET,
} from '../.test-build/src/lib/carrierResearchRecord.js'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const fileSnapshot = (directory, extension) =>
  readdirSync(directory)
    .filter((file) => file.endsWith(extension))
    .sort()
    .map((file) => `${file}\n${readFileSync(join(directory, file), 'utf8')}`)
    .join('\n')
// Conservative dependency closure: every library module, both source and actual executed JS.
const sourceSha256 = sha(fileSnapshot('src/lib', '.ts'))
const runtimeSha256 = sha(
  [
    process.version,
    process.platform,
    process.arch,
    fileSnapshot('.test-build/src/lib', '.js'),
    readFileSync(new URL(import.meta.url), 'utf8'),
  ].join('\n'),
)
const root = resolve(
  process.argv[2] ?? '../output/signallab-v11-study-verified',
)
mkdirSync(root, { recursive: true })
const base = { ...defaultResearchPlan(), frameSymbols: 2049, seed: 42 },
  cases = []
for (const ebN0Db of [-4, 0, 4, 8])
  for (const frequency of [0.001, 0.025, 0.0375])
    cases.push({
      id: `screen-QPSK-${ebN0Db}-${frequency}`,
      phase: 'screening',
      plan: {
        ...base,
        ebN0Db,
        frequency,
        layouts: [{ kind: 'uniform', spacing: 16 }],
      },
    })
const layouts = [
  { kind: 'uniform', spacing: 8 },
  { kind: 'uniform', spacing: 16 },
  { kind: 'uniform', spacing: 32 },
  { kind: 'uniform', spacing: 64 },
  { kind: 'shifted', spacing: 16 },
  { kind: 'paired', spacing: 16 },
]
for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
  for (const ebN0Db of [-4, 8])
    cases.push({
      id: `confirm-${modulation}-${ebN0Db}-nominal`,
      phase: 'confirmation',
      plan: { ...base, modulation, ebN0Db, trials: 200, layouts },
    })
  for (const [frequency, phaseDeg, label] of [
    [-0.0375, -180, 'negative-alias'],
    [1 / 32, 0, 'boundary'],
    [0.0375, 180, 'positive-alias'],
  ])
    cases.push({
      id: `confirm-${modulation}-8-${label}`,
      phase: 'confirmation',
      plan: {
        ...base,
        modulation,
        ebN0Db: 8,
        frequency,
        phaseDeg,
        trials: 200,
        layouts,
      },
    })
}
const protocol = {
  engineVersion: RESEARCH_ENGINE,
  seedRule: RESEARCH_SEED_RULE,
  sourceSha256,
  runtimeSha256,
  calibrationTrials: 20,
  policy:
    'Good calibration frames: nearest-rank 90th percentile coherence deficit; freeze before evaluation. Acquisition: abs(df)*(N-1)<=1/8 and abs(circular phase error)<=22.5 degrees. Full fixed sample sizes. No screening-driven case selection.',
  cases,
}
const protocolSha256 = sha(JSON.stringify(protocol)),
  manifestPath = join(root, 'protocol.json')
if (existsSync(manifestPath)) {
  if (
    JSON.parse(readFileSync(manifestPath, 'utf8')).protocolSha256 !==
    protocolSha256
  )
    throw new Error(
      'Protocol/source changed: use a fresh output directory; do not mix results.',
    )
} else
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...protocol,
        protocolSha256,
        registeredAt: new Date().toISOString(),
        registration:
          'Local protocol freeze before computation, not external timestamp registration.',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
const atomic = (path, data) => {
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, data, { flag: 'wx' })
  renameSync(temporary, path)
}
const stored = []
for (const item of cases) {
  const completePath = join(root, item.id + '.json.gz'),
    checkpointPath = join(root, item.id + '.checkpoint.json')
  if (existsSync(completePath)) {
    const old = JSON.parse(
      gunzipSync(readFileSync(completePath)).toString('utf8'),
    )
    if (
      old.sourceSha256 !== sourceSha256 ||
      old.runtimeSha256 !== runtimeSha256 ||
      JSON.stringify(old.record.result.plan) !==
        JSON.stringify(
          parseResearchCheckpoint({
            engineVersion: RESEARCH_ENGINE,
            plan: item.plan,
            trials: [],
          }).plan,
        )
    )
      throw new Error('Completed case does not match frozen source/plan.')
    parseResearchRecord(old.record)
    stored.push(old)
    console.log(`reused ${item.id}`)
    continue
  }
  let prefix = []
  const versioned = readdirSync(root)
    .filter(
      (name) =>
        name.startsWith(item.id + '.checkpoint-') &&
        /^\d{3}\.json$/.test(name.slice((item.id + '.checkpoint-').length)),
    )
    .sort()
  const resumePath = versioned.length
    ? join(root, versioned.at(-1))
    : checkpointPath
  if (existsSync(resumePath)) {
    const old = JSON.parse(readFileSync(resumePath, 'utf8'))
    if (
      old.sourceSha256 !== sourceSha256 ||
      old.runtimeSha256 !== runtimeSha256
    )
      throw new Error('Checkpoint source changed.')
    const checkpoint = parseResearchCheckpoint(old)
    if (
      JSON.stringify(checkpoint.plan) !==
      JSON.stringify(
        parseResearchCheckpoint({
          engineVersion: RESEARCH_ENGINE,
          plan: item.plan,
          trials: [],
        }).plan,
      )
    )
      throw new Error('Checkpoint plan changed.')
    prefix = checkpoint.trials
  }
  const start = performance.now(),
    resume = [...prefix]
  const result = runCarrierResearch(
    item.plan,
    (message) => {
      if (message.type === 'trial') {
        prefix.push(message.trial)
        if (prefix.length % 10 === 0)
          atomic(
            join(
              root,
              item.id +
                '.checkpoint-' +
                String(prefix.length).padStart(3, '0') +
                '.json',
            ),
            JSON.stringify({
              engineVersion: RESEARCH_ENGINE,
              sourceSha256,
              runtimeSha256,
              plan: item.plan,
              trials: prefix,
            }),
          )
      }
    },
    { resume, maxOperations: OFFLINE_RESEARCH_BUDGET },
  )
  const wrapper = {
    sourceSha256,
    runtimeSha256,
    phase: item.phase,
    id: item.id,
    operationsUpperBound: researchOperations(item.plan),
    elapsedMs: performance.now() - start,
    resumedTrials: resume.length,
    record: makeResearchRecord(result, item.id, new Date().toISOString()),
  }
  atomic(completePath, gzipSync(JSON.stringify(wrapper), { level: 9 }))
  for (const path of [
    ...versioned.map((name) => join(root, name)),
    checkpointPath,
  ])
    if (existsSync(path))
      try {
        unlinkSync(path)
      } catch {
        console.log(`retained checkpoint: ${path}`)
      }
  stored.push(wrapper)
  console.log(
    `completed ${item.id}: ${result.evaluation.length} evaluation frames, ${wrapper.elapsedMs.toFixed(0)} ms`,
  )
}
const archive = gzipSync(
  stored.map((row) => JSON.stringify(row)).join('\n') + '\n',
  { level: 9 },
)
const summary = {
  engineVersion: RESEARCH_ENGINE,
  sourceSha256,
  runtimeSha256,
  protocolSha256,
  node: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  complete: stored.length === cases.length,
  rawArchiveSha256: sha(archive),
  cases: stored.map((row) => ({
    id: row.id,
    phase: row.phase,
    elapsedMs: row.elapsedMs,
    resumedTrials: row.resumedTrials ?? 0,
    operationsUpperBound: row.operationsUpperBound,
    plan: row.record.result.plan,
    summary: row.record.result.summary,
  })),
}
writeFileSync('../docs/signallab-v11-protocol.json', readFileSync(manifestPath))
writeFileSync('../docs/signallab-v11-results.jsonl.gz', archive)
writeFileSync(
  '../docs/signallab-v11-study.json',
  JSON.stringify(summary, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    complete: summary.complete,
    cases: stored.length,
    rawArchiveBytes: archive.length,
    rawArchiveSha256: summary.rawArchiveSha256,
  }),
)
