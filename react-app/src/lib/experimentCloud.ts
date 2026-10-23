import { supabase } from './supabaseClient'
import {
  cleanEntry,
  fromCloud,
  insertPayload,
  mergeRemote,
  type CloudRecord,
  type LocalExperiment,
} from './experimentSync'
import type { ExperimentStore } from './experimentStore'

export class SyncFailure extends Error {
  readonly retry: boolean
  readonly quota: boolean
  constructor(message: string, retry: boolean, quota = false) {
    super(message)
    this.retry = retry
    this.quota = quota
  }
}

export const QUOTA_NOTICE =
  '云端配额已满（每账号 1,000 条，含删除记录；载荷 20 MiB）；自动上传已暂停，本地记录已保留。请导出记录，处理额度后点击“刷新云端记录”重试。删除记录不会释放条数额度。'

function fail(
  error: { code?: string; message?: string },
  status: number,
): never {
  if (error.code === 'P0001' && error.message === 'SIGNALLAB_QUOTA_EXCEEDED')
    throw new SyncFailure(QUOTA_NOTICE, false, true)
  if (status === 401)
    throw new SyncFailure(
      '登录已失效，请重新登录；本地待同步记录已保留。',
      false,
    )
  if (status === 403 || error.code === '42501')
    throw new SyncFailure('云端权限未配置或已拒绝；本地记录已保留。', false)
  throw new SyncFailure(
    '云端同步失败；本地记录已保留，可重试。',
    status === 0 || status === 429 || status >= 500,
  )
}

/** One account per invocation. The caller aborts it on sign-out/account switch. */
export async function syncExperiments(
  store: ExperimentStore,
  owner: string,
  signal: AbortSignal,
  uploadsPaused = false,
): Promise<void> {
  const client = supabase
  if (!client) return
  const ensureOwner = async () => {
    signal.throwIfAborted()
    const { data } = await client.auth.getSession()
    if (data.session?.user.id !== owner)
      throw new SyncFailure('账号已变化，同步已停止。', false)
    signal.throwIfAborted()
  }
  const acknowledge = async (sent: LocalExperiment, row: CloudRecord) => {
    fromCloud(row, owner)
    await store.change(owner, sent.id, (current) => {
      if (!current) return cleanEntry(row, owner)
      if (current.token === sent.token || row.deleted_at)
        return cleanEntry(row, owner)
      // A new local edit happened while the request was in flight.
      return { ...current, revision: row.revision, pending: true }
    })
  }

  let quotaFailure: SyncFailure | undefined
  for (const entry of await store.list(owner)) {
    if (uploadsPaused && !entry.deleted) continue
    if (quotaFailure && entry.revision === null) continue
    if (!entry.pending || entry.conflict) continue
    try {
      await ensureOwner()
      if (entry.revision === null) {
        if (entry.deleted) continue
        const { data, error, status } = await client
          .from('experiment_records')
          .insert(insertPayload(entry))
          .select()
          .abortSignal(signal)
          .single()
        if (!error && data) {
          await acknowledge(entry, data)
          continue
        }
        if (error?.code !== '23505') fail(error ?? {}, status)
        // An earlier response may have been lost. Never overwrite the existing row.
      } else {
        const { data, error, status } = await client
          .from('experiment_records')
          .update(
            entry.deleted
              ? { deleted_at: new Date().toISOString() }
              : { analysis: entry.record.analysis },
          )
          .eq('user_id', owner)
          .eq('id', entry.id)
          .eq('revision', entry.revision)
          .is('deleted_at', null)
          .select()
          .abortSignal(signal)
          .maybeSingle()
        if (error) fail(error, status)
        if (data) {
          await acknowledge(entry, data)
          continue
        }
      }
      await ensureOwner()
      const { data, error, status } = await client
        .from('experiment_records')
        .select()
        .eq('user_id', owner)
        .eq('id', entry.id)
        .abortSignal(signal)
        .maybeSingle()
      if (error) fail(error, status)
      if (!data)
        throw new SyncFailure(
          '云端记录已移除或不可访问，已停止重试，请导出本地记录。',
          false,
        )
      await store.change(owner, entry.id, (current) =>
        mergeRemote(current, data, owner),
      )
    } catch (cause) {
      // A rejected new/increasing payload must not starve deletions or shrinking
      // existing analyses. Complete reconciliation before reporting the quota.
      if (cause instanceof SyncFailure && cause.quota) quotaFailure = cause
      else throw cause
    }
  }

  // Ordered, paginated full reconciliation includes tombstones. Repeated on focus.
  let lastId: string | undefined
  while (true) {
    await ensureOwner()
    let query = client
      .from('experiment_records')
      .select()
      .eq('user_id', owner)
      .order('id')
      .limit(100)
    if (lastId) query = query.gt('id', lastId)
    const { data, error, status } = await query.abortSignal(signal)
    if (error) fail(error, status)
    if (!data?.length) break
    for (const row of data) {
      signal.throwIfAborted()
      await store.change(owner, row.id, (current) =>
        mergeRemote(current, row, owner),
      )
    }
    lastId = data[data.length - 1].id
    if (data.length < 100) break
  }
  if (quotaFailure) throw quotaFailure
}
