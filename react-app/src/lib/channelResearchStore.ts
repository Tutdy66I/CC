const DATABASE = 'signallab-channel-research-v12'
export interface ChannelStoredState {
  revision: number
  checkpoint: unknown | null
  records: unknown[]
}
const empty = (): ChannelStoredState => ({
  revision: 0,
  checkpoint: null,
  records: [],
})
let connection: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      let blocked = false
      request.onupgradeneeded = () => request.result.createObjectStore('state')
      request.onerror = () =>
        reject(request.error ?? new Error('信道本地存储不可用；请导出JSON。'))
      request.onblocked = () => {
        blocked = true
        reject(new Error('请关闭旧的信道研究页面后重试。'))
      }
      request.onsuccess = () => {
        const db = request.result
        if (blocked) {
          db.close()
          return
        }
        db.onversionchange = () => {
          db.close()
          connection = undefined
        }
        resolve(db)
      }
    }).catch((cause) => {
      connection = undefined
      throw cause
    })
  return connection
}
function validateState(value: unknown): ChannelStoredState {
  if (value === undefined) return empty()
  const v = value as ChannelStoredState
  if (
    !v ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.records) ||
    v.records.length > 2 ||
    !('checkpoint' in v)
  )
    throw new Error('信道本地数据损坏；已保留原文。')
  return v
}
export async function readChannelState(): Promise<ChannelStoredState> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readonly'),
      request = tx.objectStore('state').get('current')
    tx.oncomplete = () => {
      try {
        resolve(validateState(request.result))
      } catch (cause) {
        reject(cause)
      }
    }
    tx.onabort = () => reject(tx.error ?? new Error('读取信道记录失败。'))
    tx.onerror = () => reject(tx.error)
  })
}
async function change(
  expected: number,
  update: (v: ChannelStoredState) => ChannelStoredState,
): Promise<number> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite'),
      store = tx.objectStore('state'),
      get = store.get('current')
    let failure: unknown,
      revision = 0
    get.onsuccess = () => {
      try {
        const v = validateState(get.result)
        if (v.revision !== expected)
          throw new Error('另一页面已修改信道记录；保留原文，请导出当前结果。')
        revision = expected + 1
        if (!Number.isSafeInteger(revision)) throw new Error('本地修订号溢出。')
        store.put({ ...update(v), revision }, 'current')
      } catch (cause) {
        failure = cause
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve(revision)
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('保存失败；请导出内存结果。'))
    tx.onerror = () => reject(tx.error)
  })
}
export const saveChannelCheckpoint = (
  checkpoint: unknown,
  expectedRevision: number,
) => change(expectedRevision, (v) => ({ ...v, checkpoint }))
export const saveChannelRecord = (record: unknown, expectedRevision: number) =>
  change(expectedRevision, (v) => ({
    ...v,
    checkpoint: null,
    records: [
      record,
      ...v.records.filter((previous) => {
        const nextHash = (record as { protocolHash?: unknown } | null)
          ?.protocolHash
        return (
          typeof nextHash !== 'string' ||
          (previous as { protocolHash?: unknown } | null)?.protocolHash !==
            nextHash
        )
      }),
    ].slice(0, 2),
  }))
export const clearChannelCheckpoint = (expectedRevision: number) =>
  change(expectedRevision, (v) => ({ ...v, checkpoint: null }))
