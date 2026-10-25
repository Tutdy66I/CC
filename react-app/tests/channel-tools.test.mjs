import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import {
  appRoot,
  canonical,
  matrix,
  sha256,
  buildFingerprint,
  loadChannelEngine,
  checkpointChunk,
  readCheckpointChain,
} from '../scripts/channel-study-manifest.mjs'

test('offline matrix freezes all 189 cells in 63 bounded paired-layout groups', () => {
  const plans = matrix()
  assert.equal(plans.length, 63)
  const count = (phase) =>
    plans
      .filter((c) => c.phase === phase)
      .reduce(
        (sum, c) =>
          sum +
          c.plan.channels.length *
            c.plan.ebN0Db.length *
            c.plan.pilotCounts.length,
        0,
      )
  assert.equal(count('primary'), 126)
  assert.equal(count('overhead'), 36)
  assert.equal(count('negative-control'), 27)
  assert.equal(new Set(plans.map((c) => c.id)).size, plans.length)
  for (const { plan } of plans) {
    assert.equal(plan.frameSymbols, 1024)
    assert.equal(plan.trials, 10000)
    assert.deepEqual(plan.pilotCounts, [4, 16, 64])
    assert.equal(plan.channels.length, 1)
    assert.equal(plan.ebN0Db.length, 1)
  }
})

test('manifest canonical digest ignores object order but preserves frozen array order', () => {
  assert.equal(canonical({ a: 1, b: [2, 3] }), canonical({ b: [2, 3], a: 1 }))
  assert.notEqual(
    sha256(canonical({ a: [2, 3] })),
    sha256(canonical({ a: [3, 2] })),
  )
  assert.ok(
    matrix(true).every(
      ({ plan }) => plan.trials === 20 && plan.frameSymbols === 128,
    ),
  )
})

test('incremental checkpoint chunks reject altered chains, duplicate frames and gaps', () => {
  const identity = {
    protocolSha256: 'p',
    caseId: 'case',
    protocolHash: 'c',
    sourceSha256: 's',
    runtimeSha256: 'r',
  }
  const first = checkpointChunk({
    ...identity,
    previousSha256: null,
    completed: 10,
    trials: Array.from({ length: 10 }, (_, index) => ({ index })),
  })
  const second = checkpointChunk({
    ...identity,
    previousSha256: first.chunkSha256,
    completed: 20,
    trials: Array.from({ length: 10 }, (_, n) => ({ index: n + 10 })),
  })
  assert.equal(readCheckpointChain([first, second], identity).trials.length, 20)
  assert.throws(
    () => readCheckpointChain([{ ...first, completed: 9 }], identity),
    /digest/,
  )
  assert.throws(() => readCheckpointChain([second], identity), /chain/)
  assert.throws(() => readCheckpointChain([first, first], identity), /chain/)
  const brokenChain = checkpointChunk({
    ...identity,
    previousSha256: 'wrong',
    completed: 20,
    trials: second.trials,
  })
  assert.throws(
    () => readCheckpointChain([first, brokenChain], identity),
    /chain/,
  )
  const duplicate = checkpointChunk({
    ...identity,
    previousSha256: first.chunkSha256,
    completed: 20,
    trials: second.trials.map((trial, n) => (n === 0 ? { index: 9 } : trial)),
  })
  assert.throws(
    () => readCheckpointChain([first, duplicate], identity),
    /duplicate/,
  )
})

test(
  'archived v1.1 source and executed byte reconstruction exactly matches published hashes',
  {
    skip:
      process.version !== 'v24.16.0' ||
      process.platform !== 'win32' ||
      process.arch !== 'x64',
  },
  () => {
    const child = spawnSync(
      process.execPath,
      ['scripts/restore-v11-reference.mjs'],
      { cwd: appRoot, encoding: 'utf8', timeout: 20000 },
    )
    assert.equal(child.status, 0, child.stderr)
    const evidence = JSON.parse(child.stdout)
    assert.equal(evidence.sourceFiles, 27)
    assert.equal(evidence.executedFiles, 23)
    assert.equal(evidence.sourceMatches, true)
    assert.equal(evidence.runtimeMatches, true)
    assert.equal(
      evidence.sourceSha256,
      'ac6924c19dae956fbc8d9faaf7d40d619d5f4579101f746cabab371c8cd52dc4',
    )
    assert.equal(
      evidence.runtimeSha256,
      'caef009297e0791b3b2300024c27efd5e8be98070b66a1565da35234d94bc6a5',
    )
  },
)

test('dependency fingerprint binds the actual engine closure and executable tools', async () => {
  const engine = await loadChannelEngine()
  const fingerprint = buildFingerprint(engine.executionMode)
  assert.ok(
    fingerprint.sources.some((entry) =>
      entry.path.endsWith('channelSimulation.ts'),
    ),
  )
  assert.ok(
    fingerprint.scripts.some((entry) =>
      entry.path.endsWith('channel-reference.py'),
    ),
  )
  assert.equal(fingerprint.runtimeSha256.length, 64)
  assert.equal(fingerprint.sourceSha256.length, 64)
})

test('independent Python decision integrals agree with Rayleigh closed form', (context) => {
  const python = process.env.SIGNALLAB_PYTHON
  if (!python)
    return context.skip(
      'Set SIGNALLAB_PYTHON to a Python 3 executable for independent reference validation.',
    )
  const child = spawnSync(
    python,
    [resolve(appRoot, 'scripts/channel-reference.py'), '--self-test'],
    { cwd: appRoot, encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
  assert.equal(JSON.parse(child.stdout).ok, true)
})

test('TypeScript oracle reference agrees with independent Python decision integrals', async (context) => {
  const python = process.env.SIGNALLAB_PYTHON
  if (!python)
    return context.skip(
      'Set SIGNALLAB_PYTHON for the independent cross-language oracle check.',
    )
  const child = spawnSync(
    python,
    [resolve(appRoot, 'scripts/channel-reference.py')],
    { cwd: appRoot, encoding: 'utf8', timeout: 20000 },
  )
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
  const engine = await loadChannelEngine()
  for (const row of JSON.parse(child.stdout).rows) {
    for (const [model, expected] of [
      ['awgn', row.awgnBer],
      ['rayleigh-block', row.rayleighIdealBer],
      ['rayleigh-iid', row.rayleighIdealBer],
    ]) {
      const actual = engine.channelBer(row.modulation, model, row.ebN0Db)
      assert.ok(
        Math.abs(actual - expected) <=
          2e-10 * Math.max(1e-15, Math.abs(expected)),
        `${row.modulation}/${model}/${row.ebN0Db}: ${actual} != ${expected}`,
      )
    }
  }
})

test('offline partial chunks resume to a fully audited fixed matrix without double counting', () => {
  const root = mkdtempSync(join(tmpdir(), 'signallab-channel-tools-'))
  const run = (script, args) =>
    spawnSync(process.execPath, [`scripts/${script}`, ...args], {
      cwd: appRoot,
      env: { ...process.env, SIGNALLAB_CHANNEL_SOURCE: '1' },
      encoding: 'utf8',
      timeout: 30000,
    })
  try {
    const partial = run('study-channel-research.mjs', [
      '--quick',
      '--out',
      root,
      '--stop-after-checkpoints',
      '1',
    ])
    assert.equal(partial.status, 0, partial.stderr)
    assert.equal(JSON.parse(partial.stdout).complete, false)
    assert.equal(existsSync(join(root, 'summary.json')), false)
    const complete = run('study-channel-research.mjs', [
      '--quick',
      '--out',
      root,
    ])
    assert.equal(complete.status, 0, complete.stderr)
    const summary = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8'))
    assert.equal(summary.complete, true)
    assert.equal(summary.groups, 7)
    assert.equal(summary.cells, 14)
    assert.ok(summary.cases.every((item) => item.trials === 20))
    const audit = run('inspect-channel-research.mjs', [root])
    assert.equal(audit.status, 0, audit.stderr)
    assert.equal(JSON.parse(audit.stdout).valid, true)
    const reused = run('study-channel-research.mjs', ['--quick', '--out', root])
    assert.equal(reused.status, 0, reused.stderr)
    const altered = JSON.parse(
      readFileSync(join(root, 'protocol.json'), 'utf8'),
    )
    altered.cases[0].frozen.plan.seed++
    // A changed protocol must never reuse the otherwise valid complete cases.
    writeFileSync(join(root, 'protocol.json'), JSON.stringify(altered))
    const mismatched = run('study-channel-research.mjs', [
      '--quick',
      '--out',
      root,
    ])
    assert.notEqual(mismatched.status, 0)
    assert.match(mismatched.stderr, /Protocol\/source\/execution changed/)
  } finally {
    const within = relative(resolve(tmpdir()), resolve(root))
    if (
      within &&
      !within.startsWith('..') &&
      within.startsWith('signallab-channel-tools-')
    )
      rmSync(root, { recursive: true, force: true })
  }
})
