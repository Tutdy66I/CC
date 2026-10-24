import { readGuidedHistory, type GuidedRecord } from './guidedExperiment.js'

export const ENGINE_VERSION = 'guided-awgn-v1'
export const GUEST_HISTORY_KEY = 'signallab-guided-v1'

export class RecordValidationError extends Error {}

export interface CloudRecord {
  user_id: string
  id: string
  experiment_type: 'guided'
  template: GuidedRecord['plan']['template']
  schema_version: 1
  engine_version: string
  parameters: GuidedRecord['plan']
  results: GuidedRecord['rows']
  analysis: string
  completed_at: string
  created_at: string
  updated_at: string
  revision: number
  deleted_at: string | null
}

export interface LocalExperiment {
  owner: string
  id: string
  record: GuidedRecord
  engineVersion: string
  revision: number | null
  pending: boolean
  deleted: boolean
  token: string
  conflict?: { remote: CloudRecord; reason: string }
}

export function parseRecord(value: unknown): GuidedRecord {
  const record = readGuidedHistory(JSON.stringify([value]))[0]
  if (!record)
    throw new RecordValidationError('实验记录格式或统计一致性校验失败。')
  return {
    version: record.version,
    id: record.id,
    completedAt: record.completedAt,
    plan: structuredClone(record.plan),
    rows: structuredClone(record.rows),
    analysis: record.analysis,
  }
}

export function fromCloud(row: CloudRecord, owner: string): GuidedRecord {
  if (
    !row ||
    row.user_id !== owner ||
    row.experiment_type !== 'guided' ||
    row.schema_version !== 1 ||
    row.template !== row.parameters?.template ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !row.engine_version ||
    !Number.isFinite(Date.parse(row.updated_at)) ||
    (row.deleted_at !== null && !Number.isFinite(Date.parse(row.deleted_at)))
  )
    throw new RecordValidationError('云端记录归属或版本无效，已停止同步。')
  return parseRecord({
    version: row.schema_version,
    id: row.id,
    completedAt: row.completed_at,
    plan: row.parameters,
    rows: row.results,
    analysis: row.analysis,
  })
}

// PostgreSQL JSONB does not preserve object key order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameSnapshot(
  local: GuidedRecord,
  remote: GuidedRecord,
): boolean {
  return (
    local.id === remote.id &&
    Date.parse(local.completedAt) === Date.parse(remote.completedAt) &&
    canonical(local.plan) === canonical(remote.plan) &&
    canonical(local.rows) === canonical(remote.rows)
  )
}

export function cleanEntry(row: CloudRecord, owner: string): LocalExperiment {
  return {
    owner,
    id: row.id,
    record: fromCloud(row, owner),
    engineVersion: row.engine_version,
    revision: row.revision,
    deleted: row.deleted_at !== null,
    pending: false,
    token: crypto.randomUUID(),
  }
}

/** Pure conflict policy; client clocks never determine the winner. */
export function mergeRemote(
  local: LocalExperiment | undefined,
  row: CloudRecord,
  owner: string,
): LocalExperiment {
  const remote = cleanEntry(row, owner)
  if (!local) return remote
  if (local.owner !== owner || local.id !== row.id)
    throw new Error('同步账号不匹配。')
  if (
    (local.revision !== null && local.revision > row.revision) ||
    (local.deleted && !local.pending && !remote.deleted)
  )
    return local
  if (
    !sameSnapshot(local.record, remote.record) ||
    local.engineVersion !== remote.engineVersion
  ) {
    return {
      ...local,
      conflict: {
        remote: row,
        reason: '同一 ID 的实验快照不同；保留本地数据，请导出后处理。',
      },
    }
  }
  // A tombstone is terminal. An old offline copy must never resurrect it.
  if (remote.deleted) return remote
  if (!local.pending) return remote
  if (local.conflict) return local
  if (!local.deleted && local.record.analysis === remote.record.analysis)
    return remote
  if (local.revision === row.revision) return local
  return {
    ...local,
    conflict: {
      remote: row,
      reason: '另一台设备已更新此记录，请选择要保留的分析。',
    },
  }
}

/** An acknowledgement may arrive after another tab has reconciled a newer row. */
export function acknowledgeRemote(
  current: LocalExperiment | undefined,
  sent: LocalExperiment,
  row: CloudRecord,
): LocalExperiment {
  const remote = cleanEntry(row, sent.owner)
  if (!current) return remote
  if (current.owner !== sent.owner || current.id !== row.id)
    throw new Error('同步账号不匹配。')
  if (
    (current.revision !== null && current.revision > row.revision) ||
    (current.deleted && !current.pending && !remote.deleted)
  )
    return current
  if (current.token === sent.token || remote.deleted)
    return mergeRemote({ ...current, pending: false }, row, sent.owner)
  return { ...current, revision: row.revision, pending: true }
}

export function insertPayload(entry: LocalExperiment) {
  return {
    user_id: entry.owner,
    id: entry.id,
    experiment_type: 'guided' as const,
    template: entry.record.plan.template,
    schema_version: 1 as const,
    engine_version: entry.engineVersion,
    parameters: entry.record.plan,
    results: entry.record.rows,
    analysis: entry.record.analysis,
    completed_at: entry.record.completedAt,
  }
}
