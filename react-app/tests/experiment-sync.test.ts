import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import {
  defaultGuidedPlan,
  runGuidedExperiment,
  type GuidedRecord,
} from '../src/lib/guidedExperiment.js'
import {
  canonical,
  cleanEntry,
  fromCloud,
  mergeRemote,
  parseRecord,
  acknowledgeRemote,
  type CloudRecord,
} from '../src/lib/experimentSync.js'
import { ExperimentStore } from '../src/lib/experimentStore.js'

const plan = { ...defaultGuidedPlan('qam'), dbValues: [4] }
const record: GuidedRecord = {
  version: 1,
  id: 'run',
  completedAt: '2026-10-23T00:00:00.000Z',
  plan,
  rows: runGuidedExperiment(plan, () => {}),
  analysis: 'original',
}
const cloud: CloudRecord = {
  user_id: 'A',
  id: record.id,
  experiment_type: 'guided',
  template: 'qam',
  schema_version: 1,
  engine_version: 'guided-awgn-v1',
  parameters: plan,
  results: record.rows,
  analysis: record.analysis,
  completed_at: record.completedAt,
  created_at: record.completedAt,
  updated_at: record.completedAt,
  revision: 1,
  deleted_at: null,
}

test('cloud validation rejects account mismatch, unsupported versions and corrupt counts', () => {
  assert.deepEqual(fromCloud(cloud, 'A'), record)
  assert.throws(() => fromCloud(cloud, 'B'))
  assert.throws(() => fromCloud({ ...cloud, revision: 0 }, 'A'))
  assert.throws(() =>
    fromCloud({ ...cloud, schema_version: 2 } as unknown as CloudRecord, 'A'),
  )
  const invalid = structuredClone(record)
  invalid.rows[0].totalErrors++
  assert.throws(() => parseRecord(invalid))
})

test('late cloud responses cannot roll back a newer clean revision or confirmed tombstone', () => {
  const newer = cleanEntry({ ...cloud, revision: 3, analysis: 'newer' }, 'A')
  assert.deepEqual(mergeRemote(newer, { ...cloud, revision: 2 }, 'A'), newer)
  const tombstone = cleanEntry(
    { ...cloud, revision: 4, deleted_at: cloud.updated_at },
    'A',
  )
  assert.deepEqual(
    mergeRemote(tombstone, { ...cloud, revision: 3 }, 'A'),
    tombstone,
  )
  const pending = {
    ...newer,
    pending: true,
    record: { ...newer.record, analysis: 'unsent' },
  }
  assert.deepEqual(
    mergeRemote(pending, { ...cloud, revision: 2 }, 'A'),
    pending,
  )
})

test('late acknowledgements preserve newer revisions and edits made while sending', () => {
  const sent = { ...cleanEntry(cloud, 'A'), pending: true }
  const newer = cleanEntry({ ...cloud, revision: 3, analysis: 'newer' }, 'A')
  assert.deepEqual(
    acknowledgeRemote(newer, sent, { ...cloud, revision: 2 }),
    newer,
  )
  const editing = {
    ...sent,
    token: 'new-edit',
    record: { ...record, analysis: 'unsent' },
  }
  const acknowledged = acknowledgeRemote(editing, sent, {
    ...cloud,
    revision: 2,
  })
  assert.equal(acknowledged.record.analysis, 'unsent')
  assert.equal(acknowledged.pending, true)
  assert.equal(acknowledged.revision, 2)
})

test('JSONB key order and equivalent timestamp formatting do not cause conflicts', () => {
  const local = { ...cleanEntry(cloud, 'A'), revision: null, pending: true }
  const reversed = Object.fromEntries(
    Object.entries(plan).reverse(),
  ) as unknown as typeof plan
  const remote = {
    ...cloud,
    parameters: reversed,
    completed_at: '2026-10-23T00:00:00+00:00',
  }
  assert.equal(mergeRemote(local, remote, 'A').pending, false)
  assert.equal(canonical({ b: 1, a: [2, 3] }), canonical({ a: [2, 3], b: 1 }))
})

test('pending analysis updates use revisions and preserve both conflicting analyses', () => {
  const local = {
    ...cleanEntry(cloud, 'A'),
    pending: true,
    record: { ...record, analysis: 'offline A' },
  }
  assert.equal(mergeRemote(local, cloud, 'A'), local)
  const merged = mergeRemote(
    local,
    { ...cloud, analysis: 'device B', revision: 2 },
    'A',
  )
  assert.equal(merged.record.analysis, 'offline A')
  assert.equal(merged.conflict?.remote.analysis, 'device B')
  assert.equal(merged.pending, true)
  assert.equal(
    mergeRemote(local, { ...cloud, analysis: 'offline A', revision: 2 }, 'A')
      .pending,
    false,
  )
})

test('tombstones beat stale offline edits; immutable snapshot collisions never overwrite', () => {
  const local = {
    ...cleanEntry(cloud, 'A'),
    pending: true,
    record: { ...record, analysis: 'offline' },
  }
  const deleted = mergeRemote(
    local,
    { ...cloud, revision: 2, deleted_at: cloud.updated_at },
    'A',
  )
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.pending, false)
  const changed = {
    ...cloud,
    parameters: { ...plan, rationale: 'different snapshot' },
  }
  const conflict = mergeRemote(local, changed, 'A')
  assert.ok(conflict.conflict)
  assert.deepEqual(conflict.record, local.record)
})

test('IndexedDB atomically retains more than five pending experiments and separates owners/projects', async () => {
  const store = new ExperimentStore(crypto.randomUUID())
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      store.change('A', String(i), () => ({
        ...cleanEntry(cloud, 'A'),
        id: String(i),
        pending: true,
      })),
    ),
  )
  assert.equal((await store.list('A')).length, 8)
  assert.equal((await store.list('B')).length, 0)
  assert.equal(
    (await new ExperimentStore(crypto.randomUUID()).list('A')).length,
    0,
  )
  await assert.rejects(
    store.change('A', '0', () => {
      throw new Error('transaction failure')
    }),
  )
  assert.equal((await store.list('A')).length, 8)
  await assert.rejects(
    store.change('A', '0', (entry) => ({ ...entry!, owner: 'B' })),
  )
  assert.equal((await store.list('B')).length, 0)
})

test('IndexedDB transactions serialize concurrent local edits without stale read overwrites', async () => {
  const store = new ExperimentStore(crypto.randomUUID())
  await store.change('A', 'run', () => cleanEntry(cloud, 'A'))
  await Promise.all(
    Array.from({ length: 10 }, () =>
      store.change('A', 'run', (entry) => ({
        ...entry!,
        revision: entry!.revision! + 1,
      })),
    ),
  )
  assert.equal((await store.list('A'))[0].revision, 11)
})
