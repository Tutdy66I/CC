import type { ExperimentHistory } from '../lib/experimentHistory'
import { supabase } from '../lib/supabaseClient'
import { sameSnapshot } from '../lib/experimentSync'
import { fromCloud } from '../lib/experimentSync'
import './ExperimentAccount.css'

export default function ExperimentAccount({
  history,
  busy,
}: {
  history: ExperimentHistory
  busy: boolean
}) {
  const state = history.snapshot()
  if (!supabase)
    return (
      <p className="experiment-account">
        当前为本地实验模式；云端登录与同步尚未配置。
      </p>
    )
  return (
    <div className="experiment-account" aria-label="实验账号与同步">
      <p>
        {state.loading
          ? '正在恢复登录…'
          : state.owner
            ? `已登录：${state.label}`
            : '未登录，实验仍在本地运行。'}
      </p>
      <div className="signal-sweep-actions">
        <button
          type="button"
          disabled={busy || state.loading || state.authBusy}
          onClick={() => void history.login()}
        >
          GitHub 登录
        </button>
        {state.owner && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void history.logout()}
            >
              退出登录
            </button>
            <button
              type="button"
              disabled={busy || state.syncing}
              onClick={() => void history.retrySync()}
            >
              刷新云端记录
            </button>
            <button
              type="button"
              disabled={busy || state.syncing}
              onClick={() => void history.action(history.importGuest)}
            >
              将游客历史导入此账号
            </button>
          </>
        )}
      </div>
      {state.owner && (
        <p>
          实验记录将上传到当前账号；导入仅归属此账号，游客原始历史保留。待同步{' '}
          {
            state.entries.filter(
              (e) =>
                e.pending && !e.conflict && !(e.deleted && e.revision === null),
            ).length
          }{' '}
          条。{state.syncing ? '同步中…' : ''}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {state.owner && state.rejected.length > 0 && (
        <div role="status">
          <p>
            已隔离 {state.rejected.length}{' '}
            条云端记录，其他有效记录继续同步。原始记录未删除。
          </p>
          <p>诊断包含当前账号的原始实验数据，请妥善保存。</p>
          <button type="button" onClick={history.exportDiagnostics}>
            导出同步诊断 JSON
          </button>
        </div>
      )}
      {state.owner && state.importReport && <p>{state.importReport}</p>}
      {state.owner && state.persistenceNotice && (
        <p>{state.persistenceNotice}</p>
      )}
      {state.entries
        .filter((e) => e.conflict)
        .map((entry) => {
          const remote = entry.conflict!.remote
          const overwrite =
            !remote.deleted_at &&
            sameSnapshot(entry.record, fromCloud(remote, entry.owner)) &&
            entry.engineVersion === remote.engine_version
          return (
            <div key={entry.id} className="experiment-conflict">
              <p>
                记录 {entry.id}：{entry.conflict!.reason}
              </p>
              <p>本机分析：{entry.record.analysis || '（空）'}</p>
              <p>云端分析：{remote.analysis || '（空）'}</p>
              <button
                type="button"
                disabled={busy || !overwrite}
                onClick={() =>
                  void history.action(() => history.resolve(entry.id, 'local'))
                }
              >
                保留本机分析
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void history.action(() => history.resolve(entry.id, 'remote'))
                }
              >
                采用云端记录
              </button>
            </div>
          )
        })}
    </div>
  )
}
