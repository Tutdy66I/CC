import { readGuidedHistory, type GuidedRecord } from './guidedExperiment'
import { ExperimentStore } from './experimentStore'
import { syncExperiments, SyncFailure } from './experimentCloud'
import {
  authRedirect,
  cloudNamespace,
  cloudRetryDelay,
  signInWithGitHub,
  supabase,
} from './supabaseClient'
import {
  cleanEntry,
  ENGINE_VERSION,
  GUEST_HISTORY_KEY,
  parseRecord,
  RecordValidationError,
  sameSnapshot,
  type LocalExperiment,
} from './experimentSync'

interface HistoryState {
  owner: string | null
  label: string
  loading: boolean
  syncing: boolean
  authBusy: boolean
  notice: string
  importReport: string
  persistenceNotice: string
  records: GuidedRecord[]
  entries: LocalExperiment[]
}

function guestHistory(): GuidedRecord[] {
  try {
    return readGuidedHistory(localStorage.getItem(GUEST_HISTORY_KEY))
  } catch {
    return []
  }
}

export class ExperimentHistory {
  private store = new ExperimentStore(cloudNamespace)
  private listeners = new Set<() => void>()
  private state: HistoryState = {
    owner: null,
    label: '',
    loading: Boolean(supabase),
    syncing: false,
    authBusy: false,
    notice: '',
    importReport: '',
    persistenceNotice: '',
    records: guestHistory(),
    entries: [],
  }
  private alive = false
  private generation = 0
  private lifecycle = 0
  private volatile = new Map<string, { record: GuidedRecord; token: string }>()
  private request?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private retry = 0
  private again = false
  private unsubscribe?: () => void
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<HistoryState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private same(owner: string, generation: number) {
    return (
      this.alive && this.state.owner === owner && this.generation === generation
    )
  }
  private async load(owner: string, generation: number) {
    const entries = await this.store.list(owner)
    if (!this.same(owner, generation)) return
    this.publish({
      entries,
      persistenceNotice: [...this.volatile.keys()].some((key) =>
        key.startsWith(`${owner}:`),
      )
        ? '本次结果尚未持久化，请导出 JSON。'
        : '',
      records: [
        ...new Map([
          ...entries
            .filter((e) => !e.deleted)
            .map((e) => [e.id, e.record] as const),
          ...[...this.volatile]
            .filter(([key]) => key.startsWith(`${owner}:`))
            .map(([, entry]) => [entry.record.id, entry.record] as const),
        ]).values(),
      ].sort(
        (a, b) =>
          Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
          a.id.localeCompare(b.id),
      ),
    })
  }
  private async account(owner: string | null, label: string) {
    if (!this.alive) return
    if (this.state.owner === owner && !this.state.loading) return
    this.request?.abort()
    this.request = undefined
    clearTimeout(this.timer)
    this.retry = 0
    const generation = ++this.generation
    this.publish({
      owner,
      label,
      loading: false,
      syncing: false,
      authBusy: false,
      notice: '',
      importReport: '',
      persistenceNotice: '',
      entries: [],
      records: owner ? [] : guestHistory(),
    })
    if (owner) {
      try {
        await this.load(owner, generation)
      } catch {
        if (this.same(owner, generation))
          this.publish({
            notice: '本地缓存不可用；可继续实验并导出 JSON，尚未保存到云端。',
          })
      }
      if (this.same(owner, generation)) void this.sync()
    }
  }
  start = () => {
    this.alive = true
    const lifecycle = ++this.lifecycle
    const current = () => this.alive && lifecycle === this.lifecycle
    const client = supabase
    if (client) {
      const subscription = client.auth.onAuthStateChange((_event, session) => {
        // Never await another auth operation inside the SDK's locked callback.
        queueMicrotask(() => {
          if (current())
            void this.account(
              session?.user.id ?? null,
              session?.user.email ?? 'GitHub 用户',
            )
        })
      })
      this.unsubscribe = () => subscription.data.subscription.unsubscribe()
      void authRedirect()
        .then(async (notice) => {
          if (!current()) return
          const { data, error } = await client.auth.getSession()
          if (!current()) return
          await this.account(
            data.session?.user.id ?? null,
            data.session?.user.email ?? 'GitHub 用户',
          )
          if (!current()) return
          if (notice || error)
            this.publish({ notice: notice || '登录恢复失败，请重新登录。' })
          if (this.state.owner) void this.sync()
        })
        .catch(() => {
          if (current())
            this.publish({
              loading: false,
              notice: '登录恢复失败，本地实验仍可使用。',
            })
        })
    }
    window.addEventListener('online', this.resume)
    window.addEventListener('focus', this.resume)
    document.addEventListener('visibilitychange', this.visible)
    return () => {
      this.alive = false
      this.generation++
      this.unsubscribe?.()
      this.request?.abort()
      this.request = undefined
      clearTimeout(this.timer)
      window.removeEventListener('online', this.resume)
      window.removeEventListener('focus', this.resume)
      document.removeEventListener('visibilitychange', this.visible)
    }
  }
  private resume = () => {
    void this.sync()
  }
  private visible = () => {
    if (document.visibilityState === 'visible') this.resume()
  }
  login = async () => {
    if (this.state.authBusy || !supabase) return
    this.publish({ authBusy: true })
    try {
      await signInWithGitHub()
    } catch {
      this.publish({ authBusy: false, notice: 'GitHub 登录失败，请重试。' })
    }
  }
  logout = async () => {
    this.request?.abort()
    if (!supabase) return
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      this.publish({ notice: '退出登录失败，请重试。' })
      return
    }
    await this.account(null, '')
  }

  save = async (record: GuidedRecord, engineVersion = ENGINE_VERSION) => {
    const owner = this.state.owner
    const parsed = parseRecord(record)
    if (!owner) {
      const records = [
        parsed,
        ...this.state.records.filter((r) => r.id !== parsed.id),
      ].slice(0, 5)
      this.publish({ records })
      try {
        localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(records))
        this.publish({ notice: '' })
      } catch {
        this.publish({
          notice: '浏览器无法保存记录；本页仍可查看，请导出 JSON。',
        })
      }
      return
    }
    const generation = this.generation
    const token = crypto.randomUUID()
    this.volatile.set(`${owner}:${parsed.id}`, { record: parsed, token })
    // Preserve the real completed result even if IndexedDB is unavailable.
    this.publish({
      records: [
        parsed,
        ...this.state.records.filter((r) => r.id !== parsed.id),
      ],
    })
    try {
      await this.store.change(owner, parsed.id, (current) => {
        if (current?.deleted) throw new Error('此记录已删除，请导出当前结果。')
        if (current && !sameSnapshot(current.record, parsed))
          throw new Error('实验快照不可覆盖，请导出当前结果。')
        return {
          ...current,
          owner,
          id: parsed.id,
          record: parsed,
          engineVersion: current?.engineVersion ?? engineVersion,
          revision: current?.revision ?? null,
          pending: true,
          deleted: false,
          token,
        }
      })
      if (this.volatile.get(`${owner}:${parsed.id}`)?.token === token)
        this.volatile.delete(`${owner}:${parsed.id}`)
      if (this.same(owner, generation)) {
        await this.load(owner, generation)
        void this.sync()
      }
    } catch (cause) {
      if (this.same(owner, generation))
        this.publish({
          persistenceNotice:
            cause instanceof Error
              ? `${cause.message}；本次结果尚未持久化，请导出 JSON。`
              : '本地保存失败，请导出 JSON。',
        })
    }
  }
  importGuest = async () => {
    const owner = this.state.owner
    if (!owner) return
    const generation = this.generation
    let count = 0
    let guests: GuidedRecord[]
    let rejected: number
    try {
      const text = localStorage.getItem(GUEST_HISTORY_KEY)
      const raw: unknown = JSON.parse(text ?? '[]')
      if (!Array.isArray(raw) || (text?.length ?? 0) > 1_000_000)
        throw new Error('invalid')
      guests = readGuidedHistory(text)
      rejected = Math.min(raw.length, 5) - guests.length
    } catch {
      throw new Error('游客历史损坏，未导入；原始数据保留，请先导出可读记录。')
    }
    for (const record of guests) {
      if (!this.same(owner, generation)) return
      await this.store.change(owner, record.id, (existing) => {
        // Repeated import may not overwrite newer cloud analyses or tombstones.
        if (existing) {
          if (!sameSnapshot(existing.record, record))
            throw new Error('导入 ID 冲突，请先导出游客记录。')
          return existing
        }
        count++
        return {
          owner,
          id: record.id,
          record,
          engineVersion: 'legacy-unknown',
          revision: null,
          pending: true,
          deleted: false,
          token: crypto.randomUUID(),
        }
      })
    }
    if (this.same(owner, generation)) {
      await this.load(owner, generation)
      this.publish({
        importReport: `已导入 ${count} 条记录到本机待同步队列；跳过 ${rejected} 条格式或统计不一致的记录。游客原始历史保留。`,
      })
      void this.sync()
    }
  }
  remove = async (id: string) => {
    const owner = this.state.owner
    if (!owner) return
    const generation = this.generation
    await this.store.change(
      owner,
      id,
      (current) =>
        current && {
          ...current,
          deleted: true,
          pending: true,
          token: crypto.randomUUID(),
        },
    )
    if (this.same(owner, generation)) {
      await this.load(owner, generation)
      void this.sync()
    }
  }
  resolve = async (id: string, choice: 'local' | 'remote') => {
    const owner = this.state.owner
    if (!owner) return
    const generation = this.generation
    await this.store.change(owner, id, (entry) => {
      if (!entry?.conflict) return entry
      const remote = cleanEntry(entry.conflict.remote, owner)
      if (choice === 'remote') return remote
      if (
        !sameSnapshot(entry.record, remote.record) ||
        entry.engineVersion !== remote.engineVersion ||
        remote.deleted
      ) {
        throw new Error('快照冲突不能覆盖，请先导出本地记录，再采用云端版本。')
      }
      return {
        ...entry,
        revision: remote.revision,
        conflict: undefined,
        pending: true,
        token: crypto.randomUUID(),
      }
    })
    if (this.same(owner, generation)) {
      await this.load(owner, generation)
      void this.sync()
    }
  }
  action = async (operation: () => Promise<void>) => {
    try {
      await operation()
    } catch (cause) {
      this.publish({
        notice:
          cause instanceof Error ? cause.message : '操作失败，本地记录已保留。',
      })
    }
  }
  sync = async () => {
    const owner = this.state.owner
    if (!owner || !this.alive) return
    if (this.request) {
      this.again = true
      return
    }
    if (cloudRetryDelay() > 0) {
      clearTimeout(this.timer)
      this.timer = setTimeout(
        () => {
          void this.sync()
        },
        Math.min(2147483647, cloudRetryDelay()),
      )
      this.publish({ notice: '云端要求稍后重试；本地记录已保留。' })
      return
    }
    const generation = this.generation
    const controller = new AbortController()
    this.request = controller
    this.again = false
    clearTimeout(this.timer)
    this.publish({ syncing: true })
    let delay: number | undefined
    try {
      await syncExperiments(this.store, owner, controller.signal)
      if (!this.same(owner, generation)) return
      await this.load(owner, generation)
      this.retry = 0
      this.publish({
        notice: [...this.volatile.keys()].some((key) =>
          key.startsWith(`${owner}:`),
        )
          ? '部分结果尚未本地保存，请导出 JSON。'
          : this.state.entries.some((e) => e.conflict)
            ? '存在同步冲突，请选择要保留的分析。'
            : this.state.entries.some(
                  (e) => e.pending && !(e.deleted && e.revision === null),
                )
              ? '本地结果已保存，仍有记录等待同步。'
              : '云端同步完成。',
      })
    } catch (cause) {
      if (!this.same(owner, generation) || controller.signal.aborted) return
      this.publish({
        notice:
          cause instanceof SyncFailure || cause instanceof RecordValidationError
            ? cause.message
            : '网络或本地缓存不可用；待同步记录保留，请稍后重试。',
      })
      if (
        !(cause instanceof RecordValidationError) &&
        (!(cause instanceof SyncFailure) || cause.retry)
      )
        delay = Math.min(60000, 1000 * 2 ** Math.min(this.retry++, 6))
    } finally {
      if (this.request === controller) {
        this.request = undefined
        if (this.same(owner, generation)) {
          this.publish({ syncing: false })
          if (this.again || delay !== undefined)
            this.timer = setTimeout(
              () => {
                void this.sync()
              },
              this.again ? 0 : delay,
            )
        }
      }
    }
  }
}
