import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ExperimentHistory } from '../lib/experimentHistory'
import ExperimentAccount from './ExperimentAccount'
import { COMPARISON_DB } from '../lib/modulationComparison'
import {
  GUIDED_TEMPLATES,
  defaultGuidedPlan,
  parseGuidedProposal,
  validateGuidedPlan,
  type GuidedPlan,
  type GuidedRecord,
  type GuidedTemplate,
  type GuidedMessage,
} from '../lib/guidedExperiment'
import './GuidedExperiment.css'

const seedRule =
  'seed=(baseSeed+trial*10+snrIndex) mod 2^32; indices start at 0; snrIndex uses [-4,-2,0,2,4,6,8,10,12,14]'
const limitations =
  '理想 AWGN、硬判决、完整64比特星座周期。逐点95% Hoeffding保守区间假定块间理想噪声独立；PRNG近似，不是同时置信带。标准差描述种子波动。零误码不等于真实BER为零。BPSK/QPSK配对共用逐位噪声，sampling两种样本量共用前缀。EVM为参考辅助RMS值，不等同于BER。'
const number = (value: number) => (value === 0 ? '0' : value.toExponential(4))

export default function GuidedExperiment() {
  const [plan, setPlan] = useState(() => defaultGuidedPlan('equivalence'))
  const [seed, setSeed] = useState('42')
  const [history] = useState(() => new ExperimentHistory())
  const historyState = useSyncExternalStore(history.subscribe, history.snapshot)
  const records = historyState.records
  const [selected, setSelected] = useState(() => records[0]?.id ?? '')
  const [status, setStatus] = useState('等待确认方案；尚未执行本轮实验。')
  const [running, setRunning] = useState(false)
  const [aiStage, setAiStage] = useState<'plan' | 'analysis' | null>(null)
  const [progress, setProgress] = useState({ completed: 0, total: 1 })
  const [error, setError] = useState('')
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef<AbortController | null>(null)
  const busy = running || aiStage !== null
  const record = records.find((r) => r.id === selected) ?? records[0]
  const staticHost = import.meta.env.VITE_STATIC_HOST === 'true'
  useEffect(() => history.start(), [history])
  useEffect(() => {
    let owner = history.snapshot().owner
    return history.subscribe(() => {
      const next = history.snapshot().owner
      if (next === owner) return
      owner = next
      workerRef.current?.terminate()
      workerRef.current = null
      pending.current?.abort()
      pending.current = null
      setRunning(false)
      setAiStage(null)
      setSelected('')
      setStatus('账号已变化，未完成操作已取消；下一轮仍需确认。')
    })
  }, [history])
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      pending.current?.abort()
    },
    [],
  )

  function edit(patch: Partial<GuidedPlan>) {
    setPlan((previous) => ({
      ...previous,
      ...patch,
      rationale: '手动调整方案；请核对参数后确认运行。',
    }))
    setError('')
    setStatus('等待确认修改后的方案；尚未执行本轮实验。')
  }
  function currentPlan(): GuidedPlan {
    if (!seed.trim()) throw new Error('请输入引导基础种子。')
    const value = { ...plan, seed: Number(seed) }
    validateGuidedPlan(value)
    return structuredClone(value)
  }
  function start() {
    if (workerRef.current || pending.current) return
    setError('')
    try {
      const frozen = currentPlan()
      const worker = new Worker(
        new URL('../workers/guidedExperiment.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRunning(true)
      setProgress({ completed: 0, total: 1 })
      setStatus('正在运行已确认方案…')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setRunning(false)
      }
      worker.onmessage = (event: MessageEvent<GuidedMessage>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (message.type === 'progress') {
          setProgress(message)
          return
        }
        finish()
        if (message.type === 'error') {
          setError(message.message)
          setStatus('实验失败，未生成完成记录。')
          return
        }
        const completed: GuidedRecord = {
          version: 1,
          id: crypto.randomUUID(),
          completedAt: new Date().toISOString(),
          plan: frozen,
          rows: message.rows,
          analysis: '',
        }
        void history.action(() => history.save(completed))
        setSelected(completed.id)
        setStatus('实验完成，真实结果已记录；可以请求 AI 分析。')
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        finish()
        setError('引导实验后台计算失败，请重试。')
        setStatus('实验失败，未生成完成记录。')
      }
      worker.postMessage(frozen)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setRunning(false)
      setError(cause instanceof Error ? cause.message : '无法启动实验。')
    }
  }
  function cancelRun() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setStatus('本轮实验已取消，未生成完成记录；可以重新确认运行。')
  }
  async function ask(stage: 'plan' | 'analysis') {
    if (pending.current || workerRef.current || staticHost) return
    setError('')
    let data: Record<string, unknown>
    try {
      data =
        stage === 'plan'
          ? {
              stage,
              plan: currentPlan(),
              goal: GUIDED_TEMPLATES[plan.template].goal,
            }
          : record
            ? {
                stage,
                record: { ...record, analysis: '' },
                seedRule,
                limitations,
              }
            : {}
      if (stage === 'analysis' && !record) return
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setAiStage(stage)
    setStatus(
      stage === 'plan'
        ? 'AI 正在建议参数，尚未执行实验…'
        : 'AI 正在分析所选完成记录…',
    )
    try {
      const response = await fetch('/api/ai-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { experiment: 'GUIDED', data },
          messages: [
            {
              role: 'user',
              content:
                stage === 'plan'
                  ? '针对选定目标建议参数，遵守允许值，仅返回方案 JSON。不要运行实验。'
                  : '分析此完成快照中的理论与实测偏差，引用真实数据、解释统计限制，并提出下一轮可验证的调参建议。',
            },
          ],
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55000),
        ]),
      })
      const reply: { answer?: unknown; error?: string } = await response.json()
      if (pending.current !== controller) return
      if (
        !response.ok ||
        typeof reply.answer !== 'string' ||
        !reply.answer.trim() ||
        reply.answer.length > 12000
      )
        throw new Error(reply.error || 'AI 返回无效，请重试。')
      if (stage === 'plan') {
        const proposal = parseGuidedProposal(reply.answer, plan.template)
        setPlan(proposal)
        setSeed(String(proposal.seed))
        setStatus('AI 参数建议已校验，等待确认；尚未执行本轮实验。')
      } else if (record) {
        void history.action(() =>
          history.save({ ...record, analysis: reply.answer as string }),
        )
        setStatus('AI 分析已绑定所选完成记录；下一轮仍需确认后执行。')
      }
    } catch (cause) {
      if (pending.current !== controller) return
      setError(cause instanceof Error ? cause.message : 'AI 请求失败，请重试。')
      setStatus('AI 请求失败，参数和已有结果保留，可重试。')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setAiStage(null)
      }
    }
  }
  function cancelAI() {
    pending.current?.abort()
    pending.current = null
    setAiStage(null)
    setStatus('AI 请求已取消，参数和已有结果保留。')
  }
  function download() {
    if (!record) return
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...record,
              goal: GUIDED_TEMPLATES[record.plan.template].goal,
              seedRule,
              limitations,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json;charset=utf-8' },
      ),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `SignalLab-guided-${record.id}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="guided-experiment" aria-labelledby="guided-title">
      <h2 id="guided-title">AI 引导式实验</h2>
      <p>
        选择目标 → 建议参数 → 确认运行 → 记录真实结果 → 分析偏差 → 下一轮验证
      </p>
      <ExperimentAccount history={history} busy={busy} />
      <div className="signal-controls">
        <label htmlFor="guided-template">实验目标</label>
        <select
          id="guided-template"
          value={plan.template}
          disabled={busy}
          onChange={(e) => {
            setPlan(defaultGuidedPlan(e.target.value as GuidedTemplate))
            setSeed('42')
            setError('')
            setStatus('等待确认新目标的方案；尚未执行本轮实验。')
          }}
        >
          {Object.entries(GUIDED_TEMPLATES).map(([key, template]) => (
            <option value={key} key={key}>
              {template.title}
            </option>
          ))}
        </select>
        <p>{GUIDED_TEMPLATES[plan.template].goal}</p>
        <div className="signal-parameters">
          <label htmlFor="guided-bits">
            引导每次比特数 N
            <select
              id="guided-bits"
              value={plan.bits}
              disabled={busy}
              onChange={(e) => edit({ bits: Number(e.target.value) })}
            >
              {[16384, 65536, 131072].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="guided-trials">
            引导重复次数
            <select
              id="guided-trials"
              value={plan.trials}
              disabled={busy}
              onChange={(e) => edit({ trials: Number(e.target.value) })}
            >
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="guided-seed">
            引导基础种子
            <input
              id="guided-seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              disabled={busy}
              onChange={(e) => {
                setSeed(e.target.value)
                edit({})
              }}
            />
          </label>
        </div>
        <fieldset disabled={busy}>
          <legend>Eb/N0 扫描点（dB）</legend>
          <div className="guided-db">
            {COMPARISON_DB.map((db) => (
              <label key={db}>
                <input
                  type="checkbox"
                  checked={plan.dbValues.includes(db)}
                  onChange={(e) =>
                    edit({
                      dbValues: e.target.checked
                        ? [...plan.dbValues, db].sort((a, b) => a - b)
                        : plan.dbValues.filter((v) => v !== db),
                    })
                  }
                />
                {db} dB
              </label>
            ))}
          </div>
        </fieldset>
        <p className="guided-rationale">{plan.rationale}</p>
        {plan.template === 'sampling' && (
          <p>
            每个信噪比下比较 N/4={plan.bits / 4} 与 N={plan.bits} 比特，各重复{' '}
            {plan.trials} 次。
          </p>
        )}
        <div className="signal-sweep-actions">
          <button
            type="button"
            disabled={busy || staticHost}
            onClick={() => void ask('plan')}
          >
            AI 建议参数
          </button>
          <button type="button" disabled={busy} onClick={start}>
            确认方案并运行
          </button>
          {running && (
            <button type="button" onClick={cancelRun}>
              取消引导实验
            </button>
          )}
          {aiStage && (
            <button type="button" onClick={cancelAI}>
              取消引导 AI 请求
            </button>
          )}
        </div>
      </div>
      {staticHost && (
        <p>
          GitHub Pages 提供模板仿真、记录与导出；AI 规划和分析需要配置模型的
          Node 后端。
        </p>
      )}
      <p role="status">{status}</p>
      {running && (
        <progress
          aria-label="引导实验进度"
          value={progress.completed}
          max={progress.total}
        />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {!historyState.owner && historyState.notice && (
        <p>{historyState.notice}</p>
      )}
      <h3>已保存完成记录</h3>
      <p>
        {historyState.owner
          ? '仅记录完整运行；登录记录保存在当前账号并跨设备同步。'
          : '仅记录完整运行，浏览器本地保留最近五次。'}
        导出 JSON 可长期留存；本地存储可被修改，不是审计凭证。
      </p>
      <label htmlFor="guided-history">选择完成记录</label>
      <select
        id="guided-history"
        value={record?.id ?? ''}
        disabled={busy || !records.length}
        onChange={(e) => setSelected(e.target.value)}
      >
        {!records.length && <option value="">尚无完成记录</option>}
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.completedAt).toLocaleString()} ·{' '}
            {GUIDED_TEMPLATES[r.plan.template].title} · 种子 {r.plan.seed} ·{' '}
            {r.id.slice(0, 8)}
          </option>
        ))}
      </select>
      <div className="signal-sweep-actions">
        <button
          type="button"
          disabled={busy || !record || staticHost}
          onClick={() => void ask('analysis')}
        >
          AI 分析本次结果
        </button>
        <button type="button" disabled={!record} onClick={download}>
          导出实验记录 JSON
        </button>
        {historyState.owner && (
          <button
            type="button"
            disabled={busy || !record}
            onClick={() =>
              record && void history.action(() => history.remove(record.id))
            }
          >
            删除此云端记录
          </button>
        )}
        <button
          type="button"
          disabled={busy || !record}
          onClick={() => {
            if (!record) return
            setPlan(structuredClone(record.plan))
            setSeed(String(record.plan.seed))
            setError('')
            setStatus('已载入历史方案，等待确认后再次运行。')
          }}
        >
          载入此方案再实验
        </button>
      </div>
      {record && (
        <>
          <p>
            记录 {record.id}；已确认 N={record.plan.bits}，重复{' '}
            {record.plan.trials} 次，基础种子 {record.plan.seed}，Eb/N0=[
            {record.plan.dbValues.join(', ')}] dB。以下数据来自该完成记录。
          </p>
          <div
            className="guided-table"
            tabIndex={0}
            role="region"
            aria-label="引导实验结果，可横向滚动"
          >
            <table>
              <caption>
                {GUIDED_TEMPLATES[record.plan.template].title}
                ：真实计数、理论偏差与固定样本区间
              </caption>
              <thead>
                <tr>
                  {[
                    '调制',
                    'Eb/N0 (dB)',
                    '每次比特数',
                    '总误码数 / 总比特数',
                    '实测 BER',
                    '理论 BER',
                    '偏差（实测−理论）',
                    '种子样本标准差',
                    '逐点 95% 保守区间',
                    'RMS EVM (%)',
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.rows.map((r) => (
                  <tr key={`${r.modulation}-${r.ebN0Db}-${r.bitsPerTrial}`}>
                    <th scope="row">{r.modulation}</th>
                    <td>{r.ebN0Db}</td>
                    <td>{r.bitsPerTrial}</td>
                    <td>
                      {r.totalErrors} / {r.totalBits}
                    </td>
                    <td>{number(r.meanBer)}</td>
                    <td>{number(r.theoretical)}</td>
                    <td>{number(r.deviation)}</td>
                    <td>{number(r.sampleSd ?? 0)}</td>
                    <td>
                      {r.interval
                        ? `[${number(r.interval[0])}, ${number(r.interval[1])}]`
                        : '—'}
                    </td>
                    <td>{r.evmPercent.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>此记录的 AI 分析</h3>
          <p className="guided-analysis">
            {record.analysis ||
              '尚未请求分析。AI 将只收到此记录的已完成结果，后续调参不会改写该快照。'}
          </p>
        </>
      )}
      <details>
        <summary>复现方式与统计限制</summary>
        <p>{seedRule}</p>
        <p>{limitations}</p>
        <p>
          区间半宽=√(ln(40)/(2×总比特数/64))，裁剪到 [0,1]。EVM 按等长试验的平方
          RMS 聚合；BPSK 仅实轴，不能直接当作二维 RF EVM 比较。
        </p>
      </details>
    </section>
  )
}
