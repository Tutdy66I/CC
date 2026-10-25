// Reconstruct the archived v1.1 bytes without checking out or changing the active tree.
// Default: read-only verification. --write <new-directory> creates an isolated copy.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(appRoot, '..')
const commit = 'fa2ae0167e6d6eabcc1585c215c044dea97732c9'
const git = (...args) =>
  execFileSync('git', args, { cwd: appRoot, maxBuffer: 32 * 1024 * 1024 })
const sha = (data) => createHash('sha256').update(data).digest('hex')
const lfNames = new Set([
  'berSweep.ts',
  'carrierResearch.ts',
  'carrierResearchRecord.ts',
  'evm.ts',
  'guidedExperiment.ts',
  'modulationComparison.ts',
  'pilotSearch.ts',
  'qam16.ts',
  'reportExport.ts',
  'routes.ts',
  'seedStatistics.ts',
  'signallab.ts',
])
const notEmitted = new Set([
  'experimentCloud.ts',
  'experimentHistory.ts',
  'markdown.ts',
  'supabaseClient.ts',
])
const names = git(
  'ls-tree',
  '--full-tree',
  '-r',
  '--name-only',
  commit,
  'react-app/src/lib',
)
  .toString('utf8')
  .trimEnd()
  .split('\n')
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.split('/').at(-1))
  .sort()
const sources = names.map((name) => {
  const lf = git('show', `${commit}:react-app/src/lib/${name}`)
    .toString('utf8')
    .replaceAll('\r\n', '\n')
  const text =
    name === 'markdown.ts'
      ? lf.replace(/\n$/, '\r\n')
      : lfNames.has(name)
        ? lf
        : lf.replaceAll('\n', '\r\n')
  return { name, text, lf }
})
const executed = sources
  .filter(({ name }) => !notEmitted.has(name))
  .map(({ name, lf }) => ({
    name: name.replace(/\.ts$/, '.js'),
    text: ts.transpileModule(lf, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        verbatimModuleSyntax: true,
        strict: true,
        newLine: ts.NewLineKind.LineFeed,
      },
    }).outputText,
  }))
const script = git(
  'show',
  `${commit}:react-app/scripts/study-carrier-research.mjs`,
)
  .toString('utf8')
  .replaceAll('\r\n', '\n')
const snapshot = (rows) =>
  rows.map(({ name, text }) => `${name}\n${text}`).join('\n')
const sourceSha256 = sha(snapshot(sources))
const runtimeSha256 = sha(
  [
    process.version,
    process.platform,
    process.arch,
    snapshot(executed),
    script,
  ].join('\n'),
)
const archived = JSON.parse(
  git('show', `${commit}:docs/signallab-v11-study.json`).toString('utf8'),
)
const evidence = {
  commit,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  typescript: ts.version,
  sourceFiles: sources.length,
  executedFiles: executed.length,
  sourceSha256,
  runtimeSha256,
  sourceMatches: sourceSha256 === archived.sourceSha256,
  runtimeMatches: runtimeSha256 === archived.runtimeSha256,
  lfSourceFiles: [...lfNames].sort(),
  crlfSourceFiles: names.filter(
    (name) => !lfNames.has(name) && name !== 'markdown.ts',
  ),
  mixedSourceFiles: { 'markdown.ts': 'LF lines 1-72; final line 73 CRLF' },
  executedRule:
    '23 emitted lib modules, LF; study script LF; TypeScript ES2022/ESNext/Bundler verbatimModuleSyntax',
  notice:
    'An exact byte reconstruction, not an external authenticity certificate. Original archive remains unchanged.',
}
if (!evidence.sourceMatches || !evidence.runtimeMatches) {
  console.log(JSON.stringify(evidence, null, 2))
  throw new Error(
    'Archived bytes do not match this compiler/runtime. Expected Node v24.16.0 win32 x64 and the recorded emit output.',
  )
}
const writeIndex = process.argv.indexOf('--write')
if (writeIndex >= 0) {
  const argument = process.argv[writeIndex + 1]
  if (!argument || argument.startsWith('--'))
    throw new Error('--write requires a new destination directory.')
  const destination = resolve(argument)
  const within = relative(workspaceRoot, destination)
  if (
    !within ||
    within.startsWith('..') ||
    resolve(destination) === appRoot ||
    existsSync(destination)
  )
    throw new Error(
      'Destination must be a new directory inside this workspace.',
    )
  const put = (path, data) => {
    const file = resolve(destination, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data, { flag: 'wx' })
  }
  for (const row of sources) put(`react-app/src/lib/${row.name}`, row.text)
  for (const row of executed)
    put(`react-app/.test-build/src/lib/${row.name}`, row.text)
  put('react-app/scripts/study-carrier-research.mjs', script)
  put(
    'react-app/scripts/inspect-carrier-research.mjs',
    git('show', `${commit}:react-app/scripts/inspect-carrier-research.mjs`),
  )
  for (const name of [
    'signallab-v11-protocol.json',
    'signallab-v11-study.json',
    'signallab-v11-results.jsonl.gz',
  ])
    put(`docs/${name}`, git('show', `${commit}:docs/${name}`))
  put('restoration-evidence.json', JSON.stringify(evidence, null, 2) + '\n')
  evidence.destination = destination
}
console.log(JSON.stringify(evidence, null, 2))
