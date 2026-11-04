import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  ofdmHash,
} from '../src/lib/ofdmCombProtocol.js'
import { simulateOfdmCombTrial } from '../src/lib/ofdmCombResearch.js'
import { makeOfdmCombRecord } from '../src/lib/ofdmCombResearchRecord.js'
import { validateOriginal } from '../src/ofdm-record-compat/v1/reader.js'
import 'fake-indexeddb/auto'
import {
  saveOriginal,
  listOriginals,
  loadOriginal,
  exportStoredOriginal,
} from '../src/ofdm-record-compat/v1/store.js'

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value))
async function fixture() {
  const p = {
    ...defaultOfdmCombPlan(),
    fftSize: 64,
    cp: 8,
    dataSymbols: 2,
    trials: 2,
    activeBins: [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6],
    pilotLayouts: [
      [-6, -2, 2, 6],
      [-6, -3, 3, 6],
    ],
    channels: ['awgn' as const],
    ebN0Db: [16],
  }
  const f = await freezeOfdmCombPlan(p)
  return makeOfdmCombRecord(
    f,
    [await simulateOfdmCombTrial(p, 0), await simulateOfdmCombTrial(p, 1)],
    { sourceFingerprint: 'a'.repeat(64), runtimeFingerprint: 'b'.repeat(64) },
  )
}
async function rehash(r: Awaited<ReturnType<typeof fixture>>) {
  const { integrityHash: _ignored, ...payload } = r
  void _ignored
  r.integrityHash = await ofdmHash(payload)
}

test('compatibility is restricted to the observed theory values and preserves original bytes', async () => {
  const r = await fixture()
  const originalTheory = r.summary[0].idealTheoryBer
  assert.ok(
    originalTheory === 2.267395844454416e-19 ||
      originalTheory === 2.2673958444544166e-19,
  )
  const alternate =
    originalTheory === 2.267395844454416e-19
      ? 2.2673958444544166e-19
      : 2.267395844454416e-19
  r.summary.forEach((row) => {
    row.idealTheoryBer = alternate
  })
  await rehash(r)
  const bytes = encode(r),
    result = await validateOriginal(bytes)
  assert.deepEqual(result.originalBytes, bytes)
  assert.equal(result.record.summary[0].idealTheoryBer, alternate)
  assert.equal(result.comparisons.length, r.summary.length)
  assert.equal(result.provenance, 'unverified-source')
})

test('tampering with hash, frame order, counts, identity, and summary is rejected', async () => {
  const cases = [
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.integrityHash = '0'.repeat(64)
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.trials[0].index = 1
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.trials[0].cells[0].methods['ideal-zf'].errors += 1
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.protocolHash = '0'.repeat(64)
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.sourceFingerprint = 'not-an-identity'
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.summary[0].bits += 1
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.summary[0].idealTheoryBer = 0
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.summary[0].idealTheoryBer = 2.267395844454417e-19
    },
    (r: Awaited<ReturnType<typeof fixture>>) => {
      r.summary[0].idealTheoryBer = null
    },
  ]
  for (let i = 0; i < cases.length; i++) {
    const r = await fixture()
    cases[i](r)
    if (i !== 0) await rehash(r)
    await assert.rejects(validateOriginal(encode(r)), `case ${i}`)
  }
})

test('duplicate JSON keys, invalid UTF-8 and unsupported state are rejected', async () => {
  const r = await fixture(),
    text = JSON.stringify(r)
  await assert.rejects(
    validateOriginal(
      new TextEncoder().encode(text.replace('{', '{"status":"complete",')),
    ),
  )
  await assert.rejects(validateOriginal(new Uint8Array([0xff])))
  const changed = { ...r, status: 'checkpoint' }
  await assert.rejects(validateOriginal(encode(changed)))
})

test('original bytes survive deduplication and revalidation on reload', async () => {
  const bytes = encode(await fixture())
  const value = await validateOriginal(bytes)
  assert.equal(await saveOriginal(value), 'saved')
  assert.equal(await saveOriginal(value), 'exists')
  assert.equal((await listOriginals()).length, 1)
  const loaded = await loadOriginal(value.fileSha256)
  assert.deepEqual(loaded.originalBytes, bytes)
  assert.deepEqual(await exportStoredOriginal(value.fileSha256), bytes)
  value.originalBytes[0] = 0
  await assert.rejects(saveOriginal(value))
  assert.deepEqual(await exportStoredOriginal(value.fileSha256), bytes)
})
