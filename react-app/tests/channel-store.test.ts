import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import {
  readChannelState,
  saveChannelCheckpoint,
  saveChannelRecord,
} from '../src/lib/channelResearchStore.js'

test('independent channel store atomically rejects concurrent revisions and clears checkpoint with completed record', async () => {
  const first = await readChannelState()
  assert.deepEqual(first, { revision: 0, checkpoint: null, records: [] })
  const writes = await Promise.allSettled([
    saveChannelCheckpoint({ prefix: 'A' }, 0),
    saveChannelCheckpoint({ prefix: 'B' }, 0),
  ])
  assert.equal(writes.filter((v) => v.status === 'fulfilled').length, 1)
  const current = await readChannelState()
  assert.equal(current.revision, 1)
  assert.deepEqual(current.checkpoint, { prefix: 'A' })
  await assert.rejects(saveChannelRecord({ complete: true }, 0), /另一页面/)
  assert.deepEqual(await readChannelState(), current)
  await saveChannelRecord({ complete: true }, 1)
  const done = await readChannelState()
  assert.equal(done.revision, 2)
  assert.equal(done.checkpoint, null)
  assert.deepEqual(done.records, [{ complete: true }])
  await saveChannelRecord({ protocolHash: 'A' }, 2)
  await saveChannelRecord({ protocolHash: 'B' }, 3)
  await saveChannelRecord({ protocolHash: 'A' }, 4)
  await saveChannelRecord({ protocolHash: 'A' }, 5)
  assert.deepEqual((await readChannelState()).records, [
    { protocolHash: 'A' },
    { protocolHash: 'B' },
  ])
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const q = indexedDB.open('signallab-channel-research-v12', 1)
    q.onsuccess = () => resolve(q.result)
    q.onerror = () => reject(q.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite')
    tx.objectStore('state').put({ revision: 'broken', records: [] }, 'current')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  await assert.rejects(readChannelState(), /损坏/)
  await assert.rejects(saveChannelCheckpoint({}, 2), /损坏/)
  db.close()
})
