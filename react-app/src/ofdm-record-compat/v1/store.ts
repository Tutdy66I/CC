import { validateOriginal, type Validation } from './reader.js'

const DATABASE = 'signallab-ofdm-record-compat-v1'
type Stored = {
  fileSha256: string
  originalBytes: Uint8Array
  importedAt: string
  policyVersion: string
  integrityHash: string
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1)
    req.onupgradeneeded = () =>
      req.result.createObjectStore('records', { keyPath: 'fileSha256' })
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('兼容记录库被其他页面阻塞。'))
    req.onsuccess = () => resolve(req.result)
  })
}
export async function saveOriginal(
  result: Validation,
): Promise<'saved' | 'exists'> {
  // The public result is mutable; verify the bytes again immediately before storage.
  const checked = await validateOriginal(result.originalBytes)
  if (checked.fileSha256 !== result.fileSha256)
    throw new Error('原件在保存前发生变化。')
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'),
        store = tx.objectStore('records'),
        get = store.get(checked.fileSha256)
      let outcome: 'saved' | 'exists' = 'saved',
        failure: unknown
      get.onsuccess = () => {
        const old = get.result as Stored | undefined
        if (old) {
          if (
            !(old.originalBytes instanceof Uint8Array) ||
            old.originalBytes.length !== checked.originalBytes.length ||
            old.originalBytes.some((b, i) => b !== checked.originalBytes[i])
          ) {
            failure = new Error('文件摘要冲突，未覆盖记录。')
            tx.abort()
            return
          }
          outcome = 'exists'
        } else
          store.add({
            fileSha256: checked.fileSha256,
            originalBytes: checked.originalBytes,
            importedAt: new Date().toISOString(),
            policyVersion: checked.policyVersion,
            integrityHash: checked.record.integrityHash,
          } satisfies Stored)
      }
      tx.oncomplete = () => resolve(outcome)
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('本地保存失败。'))
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
export async function listOriginals(): Promise<
  { fileSha256: string; importedAt: string }[]
> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'),
        request = tx.objectStore('records').getAll()
      tx.oncomplete = () =>
        resolve(
          (request.result as Stored[]).map(({ fileSha256, importedAt }) => ({
            fileSha256,
            importedAt,
          })),
        )
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
export async function loadOriginal(id: string): Promise<Validation> {
  const db = await open()
  let stored: Stored | undefined
  try {
    stored = await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'),
        req = tx.objectStore('records').get(id)
      tx.oncomplete = () => resolve(req.result as Stored | undefined)
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
  if (!stored || !(stored.originalBytes instanceof Uint8Array))
    throw new Error('本地原件不存在或数据损坏。')
  const checked = await validateOriginal(stored.originalBytes)
  if (checked.fileSha256 !== id) throw new Error('本地原件文件摘要不匹配。')
  return checked
}
// This is deliberately separate from validated reading: damaged originals remain exportable.
export async function exportStoredOriginal(id: string): Promise<Uint8Array> {
  const db = await open()
  try {
    const stored = await new Promise<Stored | undefined>((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'),
        req = tx.objectStore('records').get(id)
      tx.oncomplete = () => resolve(req.result as Stored | undefined)
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
    if (!stored || !(stored.originalBytes instanceof Uint8Array))
      throw new Error('本地原件不可读取。')
    return new Uint8Array(stored.originalBytes)
  } finally {
    db.close()
  }
}
