// Offline fixed-sample study. No network, AI, cloud writes, or database access.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  createReadStream,
  createWriteStream,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { gzipSync, gunzipSync, createGzip, createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  appRoot,
  canonical,
  sha256,
  matrix,
  buildFingerprint,
  loadChannelEngine,
  checkpointChunk,
  readCheckpointChain,
} from './channel-study-manifest.mjs'

const args = process.argv.slice(2)
const quick = args.includes('--quick')
const outIndex = args.indexOf('--out')
if (
  outIndex >= 0 &&
  (!args[outIndex + 1] || args[outIndex + 1].startsWith('--'))
)
  throw new Error('--out requires a directory.')
const root = resolve(
  outIndex >= 0
    ? args[outIndex + 1]
    : join(
        appRoot,
        '..',
        'output',
        quick ? 'signallab-v12-quick' : 'signallab-v12-study',
      ),
)
const stopIndex = args.indexOf('--stop-after-checkpoints')
const stopAfterCheckpoints =
  stopIndex < 0 ? Infinity : Number(args[stopIndex + 1])
if (
  stopIndex >= 0 &&
  (!Number.isSafeInteger(stopAfterCheckpoints) || stopAfterCheckpoints < 1)
)
  throw new Error('--stop-after-checkpoints requires a positive integer.')
let writtenCheckpoints = 0
const engine = await loadChannelEngine()
const fingerprint = buildFingerprint(engine.executionMode)
const cases = []
for (const item of matrix(quick))
  cases.push({
    id: item.id,
    phase: item.phase,
    frozen: await engine.freezeChannelPlan(item.plan, Infinity),
  })
const protocol = {
  protocolVersion: 'channel-study-v12.1',
  quick,
  fingerprint,
  inference:
    'Fixed complete samples; independent frame unit; paired methods/layouts; no error-based stopping or case selection; pointwise intervals.',
  cases,
}
const protocolSha256 = sha256(canonical(protocol))
const manifest = {
  ...protocol,
  protocolSha256,
  frozenAt: new Date().toISOString(),
  registration:
    'Local freeze before computation; not an external timestamp registration.',
}
mkdirSync(root, { recursive: true })
function immutable(path, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes))
      throw new Error(`Immutable artifact differs: ${path}`)
    return
  }
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, bytes, { flag: 'wx' })
  renameSync(temporary, path)
}
const manifestPath = join(root, 'protocol.json')
if (existsSync(manifestPath)) {
  const old = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const {
    protocolSha256: oldHash,
    frozenAt: _date,
    registration: _registration,
    ...oldProtocol
  } = old
  if (
    oldHash !== protocolSha256 ||
    sha256(canonical(oldProtocol)) !== protocolSha256
  )
    throw new Error(
      'Protocol/source/execution changed; use a new output directory.',
    )
} else immutable(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
if (args.includes('--register-only')) {
  console.log(
    JSON.stringify(
      {
        registered: true,
        root,
        protocolSha256,
        groups: cases.length,
        cells: cases.reduce(
          (n, c) =>
            n +
            c.frozen.plan.ebN0Db.length *
              c.frozen.plan.pilotCounts.length *
              c.frozen.plan.channels.length,
          0,
        ),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}
const summaryRows = []
for (const item of cases) {
  const file = `${item.id}.json.gz`
  const path = join(root, file)
  let wrapper
  if (existsSync(path)) {
    wrapper = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'))
    if (
      wrapper.protocolSha256 !== protocolSha256 ||
      wrapper.caseId !== item.id ||
      wrapper.runtimeSha256 !== fingerprint.runtimeSha256 ||
      wrapper.sourceSha256 !== fingerprint.sourceSha256
    )
      throw new Error('Completed case fingerprint mismatch.')
    wrapper.record = await engine.parseChannelRecord(wrapper.record, Infinity)
    if (
      canonical(wrapper.record.plan) !== canonical(item.frozen.plan) ||
      wrapper.record.protocolHash !== item.frozen.protocolHash
    )
      throw new Error('Completed case plan mismatch.')
  } else {
    let prefix = []
    let previousSha256 = null
    const identity = {
      protocolSha256,
      caseId: item.id,
      protocolHash: item.frozen.protocolHash,
      sourceSha256: fingerprint.sourceSha256,
      runtimeSha256: fingerprint.runtimeSha256,
    }
    const checkpoints = readdirSync(root)
      .filter(
        (name) =>
          name.startsWith(item.id + '.checkpoint-') &&
          /^\d{6}\.json$/.test(name.slice((item.id + '.checkpoint-').length)),
      )
      .sort()
    if (checkpoints.length) {
      const chain = readCheckpointChain(
        checkpoints.map((name) =>
          JSON.parse(readFileSync(join(root, name), 'utf8')),
        ),
        identity,
      )
      previousSha256 = chain.previousSha256
      const checkpoint = await engine.parseChannelCheckpoint(
        engine.makeChannelCheckpoint(item.frozen, chain.trials),
        Infinity,
      )
      if (
        canonical(checkpoint.plan) !== canonical(item.frozen.plan) ||
        checkpoint.protocolHash !== item.frozen.protocolHash
      )
        throw new Error('Checkpoint plan mismatch.')
      prefix = checkpoint.trials
    }
    const resumedTrials = prefix.length
    for (let index = prefix.length; index < item.frozen.plan.trials; index++) {
      const trial = await engine.simulateChannelTrial(item.frozen.plan, index)
      prefix.push(trial)
      if (prefix.length % 10 === 0) {
        const chunk = checkpointChunk({
          ...identity,
          previousSha256,
          completed: prefix.length,
          trials: prefix.slice(-10),
        })
        immutable(
          join(
            root,
            `${item.id}.checkpoint-${String(prefix.length).padStart(6, '0')}.json`,
          ),
          JSON.stringify(chunk),
        )
        previousSha256 = chunk.chunkSha256
        writtenCheckpoints++
        if (writtenCheckpoints >= stopAfterCheckpoints) {
          console.log(
            JSON.stringify(
              {
                complete: false,
                checkpointOnly: true,
                root,
                caseId: item.id,
                completed: prefix.length,
                protocolSha256,
              },
              null,
              2,
            ),
          )
          process.exit(0)
        }
      }
    }
    const record = engine.makeChannelRecord(item.frozen, prefix)
    await engine.parseChannelRecord(record, Infinity)
    wrapper = {
      protocolSha256,
      caseId: item.id,
      phase: item.phase,
      sourceSha256: fingerprint.sourceSha256,
      runtimeSha256: fingerprint.runtimeSha256,
      resumedTrials,
      record,
    }
    immutable(path, gzipSync(JSON.stringify(wrapper), { level: 9 }))
  }
  summaryRows.push({
    id: item.id,
    phase: item.phase,
    protocolHash: item.frozen.protocolHash,
    trials: wrapper.record.trials.length,
    file,
    fileSha256: sha256(readFileSync(path)),
    summary: wrapper.record.summary,
  })
  console.log(`completed ${item.id}: ${wrapper.record.trials.length} frames`)
}
// Keep only one compressed case stream in flight; never collect the raw study in memory.
const archivePath = join(root, 'results.jsonl.gz')
const temporaryArchive = archivePath + '.' + randomUUID() + '.tmp'
async function* rawCases() {
  for (const item of summaryRows) {
    const input = createReadStream(join(root, item.file)).pipe(createGunzip())
    for await (const chunk of input) yield chunk
    yield '\n'
  }
}
await pipeline(
  Readable.from(rawCases()),
  createGzip({ level: 9 }),
  createWriteStream(temporaryArchive, { flags: 'wx' }),
)
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const rawArchiveSha256 = await fileHash(temporaryArchive)
if (existsSync(archivePath)) {
  if ((await fileHash(archivePath)) !== rawArchiveSha256)
    throw new Error(
      'Existing raw archive differs; preserve both and inspect the output directory.',
    )
  unlinkSync(temporaryArchive)
} else renameSync(temporaryArchive, archivePath)
const summary = {
  protocolVersion: protocol.protocolVersion,
  protocolSha256,
  sourceSha256: fingerprint.sourceSha256,
  runtimeSha256: fingerprint.runtimeSha256,
  complete: summaryRows.length === cases.length,
  groups: cases.length,
  cells: cases.reduce(
    (n, c) =>
      n +
      c.frozen.plan.ebN0Db.length *
        c.frozen.plan.pilotCounts.length *
        c.frozen.plan.channels.length,
    0,
  ),
  rawArchiveSha256,
  cases: summaryRows,
}
immutable(join(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      complete: summary.complete,
      root,
      groups: summary.groups,
      cells: summary.cells,
      protocolSha256,
      rawArchiveSha256,
    },
    null,
    2,
  ),
)
