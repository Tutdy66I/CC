// Validate every frozen case and recompute summaries, reading one case at a time.
import { readFileSync, createReadStream } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import {
  appRoot,
  canonical,
  sha256,
  loadChannelEngine,
  buildFingerprint,
} from './channel-study-manifest.mjs'

const root = resolve(
  process.argv[2] ?? join(appRoot, '..', 'output', 'signallab-v12-study'),
)
const engine = await loadChannelEngine()
const fingerprint = buildFingerprint(engine.executionMode)
const manifest = JSON.parse(readFileSync(join(root, 'protocol.json'), 'utf8'))
const { protocolSha256, frozenAt, registration, ...protocol } = manifest
if (
  !frozenAt ||
  !registration ||
  sha256(canonical(protocol)) !== protocolSha256
)
  throw new Error('Frozen protocol digest mismatch.')
if (canonical(fingerprint) !== canonical(protocol.fingerprint))
  throw new Error(
    'Current source/runtime differs from frozen study; inspect using its original execution closure.',
  )
const summary = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8'))
if (
  !summary.complete ||
  summary.protocolSha256 !== protocolSha256 ||
  summary.sourceSha256 !== fingerprint.sourceSha256 ||
  summary.runtimeSha256 !== fingerprint.runtimeSha256 ||
  summary.cases.length !== manifest.cases.length
)
  throw new Error('Summary is incomplete or from a different study.')
const hash = createHash('sha256')
for await (const chunk of createReadStream(join(root, 'results.jsonl.gz')))
  hash.update(chunk)
if (hash.digest('hex') !== summary.rawArchiveSha256)
  throw new Error('Raw compressed archive digest mismatch.')
const seen = new Set()
let frames = 0
const lines = createInterface({
  input: createReadStream(join(root, 'results.jsonl.gz')).pipe(createGunzip()),
  crlfDelay: Infinity,
})
for await (const line of lines) {
  if (!line) throw new Error('Unexpected empty raw record.')
  const wrapper = JSON.parse(line)
  const item = manifest.cases.find((entry) => entry.id === wrapper.caseId)
  const published = summary.cases.find((entry) => entry.id === wrapper.caseId)
  if (
    !item ||
    !published ||
    seen.has(item.id) ||
    wrapper.phase !== item.phase ||
    wrapper.protocolSha256 !== protocolSha256 ||
    wrapper.sourceSha256 !== fingerprint.sourceSha256 ||
    wrapper.runtimeSha256 !== fingerprint.runtimeSha256
  )
    throw new Error('Raw case identity/fingerprint mismatch.')
  const caseHash = createHash('sha256')
  for await (const chunk of createReadStream(join(root, published.file)))
    caseHash.update(chunk)
  if (caseHash.digest('hex') !== published.fileSha256)
    throw new Error('Individual compressed case digest mismatch.')
  const plainHash = createHash('sha256')
  for await (const chunk of createReadStream(join(root, published.file)).pipe(
    createGunzip(),
  ))
    plainHash.update(chunk)
  if (plainHash.digest('hex') !== sha256(line))
    throw new Error('Individual case differs from the combined raw archive.')
  const record = await engine.parseChannelRecord(wrapper.record, Infinity)
  if (
    record.protocolHash !== item.frozen.protocolHash ||
    canonical(record.plan) !== canonical(item.frozen.plan) ||
    canonical(record.summary) !== canonical(published.summary) ||
    record.trials.length !== item.frozen.plan.trials ||
    published.trials !== record.trials.length
  )
    throw new Error('Raw case differs from frozen plan or recomputed summary.')
  seen.add(item.id)
  frames += record.trials.length
}
const cells = manifest.cases.reduce(
  (count, item) =>
    count +
    item.frozen.plan.ebN0Db.length *
      item.frozen.plan.pilotCounts.length *
      item.frozen.plan.channels.length,
  0,
)
if (
  seen.size !== manifest.cases.length ||
  summary.groups !== seen.size ||
  summary.cells !== cells
)
  throw new Error('Frozen case matrix is incomplete.')
console.log(
  JSON.stringify(
    {
      valid: true,
      groups: seen.size,
      cells,
      groupedFrames: frames,
      sourceMatches: true,
      runtimeMatches: true,
      protocolSha256,
      rawArchiveSha256: summary.rawArchiveSha256,
      notice:
        'Structural/math/integrity checks are not external authenticity certification or independent simulation validation.',
    },
    null,
    2,
  ),
)
