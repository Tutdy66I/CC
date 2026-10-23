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
  constructor(message: string, retry: boolean) {
    super(message)
    this.retry = retry
  }
}

function fail(error: { code?: string }, status: number): never {
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

  for (const entry of await store.list(owner)) {
    if (!entry.pending || entry.conflict) continue
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
}
