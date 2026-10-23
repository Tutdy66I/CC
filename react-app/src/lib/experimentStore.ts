import { type LocalExperiment } from './experimentSync.js'

// Account cache and outbox share one transaction and have no five-record eviction.
export class ExperimentStore {
  private connection?: Promise<IDBDatabase>

  private readonly namespace: string
  constructor(namespace = 'test') {
    this.namespace = namespace
  }

  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        let blocked = false
        const request = indexedDB.open(
          `signallab-cloud-v1:${this.namespace}`,
          1,
        )
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('experiments', {
            keyPath: ['owner', 'id'],
          })
          store.createIndex('owner', 'owner')
        }
        request.onsuccess = () => {
          if (blocked) {
            request.result.close()
            return
          }
          request.result.onversionchange = () => {
            request.result.close()
            this.connection = undefined
          }
          resolve(request.result)
        }
        request.onerror = () => {
          this.connection = undefined
          reject(request.error)
        }
        request.onblocked = () => {
          blocked = true
          this.connection = undefined
          reject(new Error('请关闭其他旧版本页面后重试。'))
        }
      }).catch((cause) => {
        this.connection = undefined
        throw cause
      })
    }
    return this.connection
  }

  async list(owner: string): Promise<LocalExperiment[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('experiments', 'readonly')
      const request = tx.objectStore('experiments').index('owner').getAll(owner)
      tx.oncomplete = () => resolve(request.result as LocalExperiment[])
      tx.onabort = () => reject(tx.error ?? new Error('读取本地记录失败。'))
      tx.onerror = () => reject(tx.error)
    })
  }

  async change(
    owner: string,
    id: string,
    change: (
      current: LocalExperiment | undefined,
    ) => LocalExperiment | undefined,
  ): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('experiments', 'readwrite')
      const store = tx.objectStore('experiments')
      const request = store.get([owner, id])
      let failure: unknown
      request.onsuccess = () => {
        try {
          const next = change(request.result as LocalExperiment | undefined)
          if (next) {
            if (next.owner !== owner || next.id !== id)
              throw new Error('本地记录归属不匹配。')
            store.put(next)
          }
        } catch (cause) {
          failure = cause
          tx.abort()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('本地保存失败；请导出 JSON。'))
      tx.onerror = () => reject(tx.error)
    })
  }
}
