import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex')
export const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`
}

export function checkpointChunk(payload) {
  return {
    ...payload,
    chunkVersion: 1,
    chunkSha256: sha256(canonical({ ...payload, chunkVersion: 1 })),
  }
}

export function readCheckpointChain(chunks, identity) {
  const trials = []
  let previousSha256 = null
  for (const chunk of chunks) {
    const { chunkSha256, ...payload } = chunk
    if (
      payload.chunkVersion !== 1 ||
      sha256(canonical(payload)) !== chunkSha256 ||
      payload.previousSha256 !== previousSha256 ||
      !Array.isArray(payload.trials) ||
      payload.trials.length !== 10 ||
      payload.completed !== trials.length + payload.trials.length ||
      Object.keys(identity).some((key) => payload[key] !== identity[key])
    )
      throw new Error(
        'Checkpoint chunk identity, digest, chain or frame count mismatch.',
      )
    for (const trial of payload.trials) {
      if (!trial || trial.index !== trials.length)
        throw new Error(
          'Checkpoint chunks contain duplicate, missing or reordered frames.',
        )
      trials.push(trial)
    }
    previousSha256 = chunkSha256
  }
  return { trials, previousSha256 }
}

let sourceHook
export async function loadChannelEngine() {
  const useSource =
    process.env.SIGNALLAB_CHANNEL_SOURCE === '1' ||
    !existsSync(resolve(appRoot, '.test-build/src/lib/channelResearch.js'))
  if (useSource && !sourceHook)
    sourceHook = registerHooks({
      resolve(specifier, context, next) {
        try {
          return next(specifier, context)
        } catch (error) {
          if (
            specifier.startsWith('.') &&
            specifier.endsWith('.js') &&
            context.parentURL
          ) {
            const candidate = new URL(
              specifier.slice(0, -3) + '.ts',
              context.parentURL,
            )
            if (existsSync(fileURLToPath(candidate)))
              return { url: candidate.href, shortCircuit: true }
          }
          throw error
        }
      },
    })
  const directory = useSource ? 'src/lib' : '.test-build/src/lib'
  const extension = useSource ? 'ts' : 'js'
  const modules = await Promise.all(
    ['channelResearch', 'channelSimulation', 'channelResearchRecord'].map(
      (name) =>
        import(
          pathToFileURL(resolve(appRoot, directory, `${name}.${extension}`))
            .href
        ),
    ),
  )
  return {
    ...Object.assign({}, ...modules),
    executionMode: useSource ? 'node-typescript-strip' : 'compiled-javascript',
  }
}

function closure(entryPaths) {
  const visited = new Set()
  const visit = (filename) => {
    filename = resolve(filename)
    if (visited.has(filename)) return
    if (
      !filename.startsWith(appRoot + '/') &&
      !filename.startsWith(appRoot + '\\')
    )
      throw new Error('Dependency outside application root.')
    visited.add(filename)
    const source = readFileSync(filename, 'utf8')
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g,
    )) {
      let dependency = resolve(dirname(filename), match[1])
      if (
        !existsSync(dependency) &&
        filename.endsWith('.ts') &&
        dependency.endsWith('.js')
      )
        dependency = dependency.slice(0, -3) + '.ts'
      if (!existsSync(dependency))
        throw new Error(
          `Missing executed dependency: ${relative(appRoot, dependency)}`,
        )
      visit(dependency)
    }
  }
  entryPaths.forEach(visit)
  return [...visited].sort().map((filename) => ({
    path: relative(appRoot, filename).replaceAll('\\', '/'),
    sha256: sha256(readFileSync(filename)),
  }))
}

export function buildFingerprint(executionMode) {
  const entries = [
    'channelResearch',
    'channelSimulation',
    'channelResearchRecord',
  ]
  const sources = closure(
    entries.map((name) => resolve(appRoot, 'src/lib', `${name}.ts`)),
  )
  const executed =
    executionMode === 'compiled-javascript'
      ? closure(
          entries.map((name) =>
            resolve(appRoot, '.test-build/src/lib', `${name}.js`),
          ),
        )
      : sources
  const scripts = [
    'channel-study-manifest.mjs',
    'study-channel-research.mjs',
    'inspect-channel-research.mjs',
    'channel-reference.py',
  ].map((name) => ({
    path: `scripts/${name}`,
    sha256: sha256(readFileSync(resolve(appRoot, 'scripts', name))),
  }))
  return {
    executionMode,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256: sha256(canonical(sources)),
    runtimeSha256: sha256(
      canonical({
        executed,
        scripts,
        executionMode,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }),
    ),
    sources,
    executed,
    scripts,
  }
}

export function matrix(quick = false) {
  const cases = []
  const base = {
    frameSymbols: quick ? 128 : 1024,
    pilotCounts: quick ? [4, 16] : [4, 16, 64],
    trials: quick ? 20 : 10000,
    seed: 42,
    noiseEnabled: true,
  }
  const modulations = quick ? ['QPSK'] : ['BPSK', 'QPSK', '16QAM']
  for (const modulation of modulations)
    for (const db of quick ? [0, 8] : [-4, 0, 4, 8, 12, 16, 20])
      for (const model of ['awgn', 'rayleigh-block'])
        cases.push({
          id: `main-${modulation}-${db}-${model}`,
          phase: 'primary',
          plan: {
            ...base,
            modulation,
            ebN0Db: [db],
            channels: [model],
            energyBasis: 'data-eb',
          },
        })
  for (const modulation of quick ? ['QPSK'] : ['QPSK', '16QAM'])
    for (const db of quick ? [8] : [0, 8, 16])
      for (const model of ['awgn', 'rayleigh-block'])
        cases.push({
          id: `total-${modulation}-${db}-${model}`,
          phase: 'overhead',
          plan: {
            ...base,
            modulation,
            ebN0Db: [db],
            channels: [model],
            energyBasis: 'total-eb',
          },
        })
  for (const modulation of modulations)
    for (const db of quick ? [8] : [0, 8, 16])
      cases.push({
        id: `iid-${modulation}-${db}`,
        phase: 'negative-control',
        plan: {
          ...base,
          modulation,
          ebN0Db: [db],
          channels: ['rayleigh-iid'],
          energyBasis: 'data-eb',
        },
      })
  return cases
}
