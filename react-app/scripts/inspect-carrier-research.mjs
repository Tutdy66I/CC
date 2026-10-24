// Validate the published compressed raw measurements without replaying or modifying experiments.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import {
  parseResearchRecord,
  parseResearchCheckpoint,
} from '../.test-build/src/lib/carrierResearchRecord.js'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const files = (directory, extension) =>
  readdirSync(directory)
    .filter((file) => file.endsWith(extension))
    .sort()
    .map((file) => `${file}\n${readFileSync(join(directory, file), 'utf8')}`)
    .join('\n')
const runtimeSha256 = sha(
  [
    process.version,
    process.platform,
    process.arch,
    files('.test-build/src/lib', '.js'),
    readFileSync(
      new URL('./study-carrier-research.mjs', import.meta.url),
      'utf8',
    ),
  ].join('\n'),
)
const sourceSha256 = sha(files('src/lib', '.ts'))
const manifest = JSON.parse(
  readFileSync('../docs/signallab-v11-protocol.json', 'utf8'),
)
const { protocolSha256, registeredAt, registration, ...protocol } = manifest
if (
  !registeredAt ||
  !registration ||
  sha(JSON.stringify(protocol)) !== protocolSha256
)
  throw new Error('Protocol digest mismatch.')
const summary = JSON.parse(
    readFileSync('../docs/signallab-v11-study.json', 'utf8'),
  ),
  archive = readFileSync('../docs/signallab-v11-results.jsonl.gz')
if (
  !summary.complete ||
  summary.protocolSha256 !== protocolSha256 ||
  summary.rawArchiveSha256 !== sha(archive)
)
  throw new Error('Archive/summary digest mismatch.')
const seen = new Set()
let calibration = 0,
  evaluation = 0
for (const line of gunzipSync(archive).toString('utf8').trimEnd().split('\n')) {
  const row = JSON.parse(line),
    expected = manifest.cases.find((c) => c.id === row.id)
  if (
    !expected ||
    seen.has(row.id) ||
    row.sourceSha256 !== manifest.sourceSha256 ||
    row.runtimeSha256 !== manifest.runtimeSha256 ||
    row.phase !== expected.phase
  )
    throw new Error('Case/version mismatch.')
  const record = parseResearchRecord(row.record),
    canonical = parseResearchCheckpoint({
      engineVersion: manifest.engineVersion,
      plan: expected.plan,
      trials: [],
    }).plan
  if (
    JSON.stringify(canonical) !== JSON.stringify(record.result.plan) ||
    record.id !== row.id
  )
    throw new Error('Case plan mismatch.')
  const published = summary.cases.find((c) => c.id === row.id)
  if (
    JSON.stringify(published.summary) !== JSON.stringify(record.result.summary)
  )
    throw new Error('Summary does not match raw trials.')
  seen.add(row.id)
  calibration += record.result.calibration.length
  evaluation += record.result.evaluation.length
}
if (seen.size !== manifest.cases.length || summary.cases.length !== seen.size)
  throw new Error('Incomplete study.')
console.log(
  JSON.stringify(
    {
      cases: seen.size,
      calibrationFrames: calibration,
      evaluationFrames: evaluation,
      rawArchiveSha256: sha(archive),
      sourceMatches: sourceSha256 === manifest.sourceSha256,
      runtimeMatches: runtimeSha256 === manifest.runtimeSha256,
      notice:
        'Integrity/structural/math validation is not external authenticity certification; runtime matching is platform/build specific.',
    },
    null,
    2,
  ),
)
