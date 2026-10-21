import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { simulateBpsk } from '../.test-build/src/lib/signallab.js'
import {
  berInterval,
  simulateBerPoint,
  SWEEP_DB,
  theoreticalBpskBer,
} from '../.test-build/src/lib/berSweep.js'

// Keep the original array pipeline as a reproducible reference after optimization.
function referencePoint(db, bits, seed) {
  const transmitted = Array.from({ length: bits }, (_, index) => index % 2)
  const { errors, ber } = simulateBpsk(transmitted, db, seed)
  return {
    ebN0Db: db,
    bits,
    seed,
    errors,
    ber,
    theoretical: theoreticalBpskBer(db),
    interval: berInterval(errors, bits),
  }
}

const seed = 0xfffffffc // Also exercises seed wraparound in each full scan.
const repetitions = 5
const warmups = 2

if (process.argv[2] === '--child') {
  const variant = process.argv[3]
  const bits = Number(process.argv[4])
  const point = variant === 'reference' ? referencePoint : simulateBerPoint
  const scan = () =>
    SWEEP_DB.map((db, index) => point(db, bits, (seed + index) >>> 0))
  for (let i = 0; i < warmups; i++) scan()
  const durations = []
  const heapDeltas = []
  let output
  for (let i = 0; i < repetitions; i++) {
    global.gc()
    const before = process.memoryUsage().heapUsed
    const start = performance.now()
    output = scan()
    durations.push(performance.now() - start)
    heapDeltas.push(Math.max(0, process.memoryUsage().heapUsed - before))
  }
  const sorted = [...durations].sort((a, b) => a - b)
  process.send({
    variant,
    bits,
    durationsMs: durations,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    maxHeapDeltaBytes: Math.max(...heapDeltas),
    // Node reports maxRSS in KiB on all supported platforms; includes warmups/runtime.
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    output,
  })
} else {
  const run = (variant, bits) =>
    new Promise((resolve, reject) => {
      const child = fork(
        fileURLToPath(import.meta.url),
        ['--child', variant, String(bits)],
        {
          execArgv: ['--expose-gc'],
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      )
      let result
      child.on('message', (message) => {
        result = message
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code !== 0 || !result)
          reject(new Error(`benchmark child exited ${code}`))
        else resolve(result)
      })
    })
  const cases = []
  for (const bits of [10000, 100000, 1000000]) {
    const reference = await run('reference', bits)
    const candidate = await run('candidate', bits)
    assert.deepEqual(candidate.output, reference.output)
    cases.push({
      bits,
      reference,
      candidate,
      speedup: reference.medianMs / candidate.medianMs,
    })
  }
  const report = `${JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      timestamp: new Date().toISOString(),
      seed,
      warmups,
      repetitions,
      pointsPerScan: SWEEP_DB.length,
      exactParity: true,
      cases,
    },
    null,
    2,
  )}\n`
  const outputIndex = process.argv.indexOf('--output')
  if (outputIndex >= 0) {
    assert.ok(process.argv[outputIndex + 1], '--output requires a file path')
    writeFileSync(process.argv[outputIndex + 1], report, 'utf8')
  } else {
    process.stdout.write(report)
  }
}
