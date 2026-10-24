import { useEffect, useRef, useState } from 'react'
import { COMPARISON_DB, MODULATIONS } from '../lib/modulationComparison'
import {
  defaultCarrierPlan,
  validateCarrierPlan,
  type CarrierMessage,
  type CarrierPlan,
} from '../lib/carrierOffset'
import {
  CARRIER_HISTORY_KEY,
  makeCarrierRecord,
  readCarrierRecords,
  type CarrierRecord,
} from '../lib/carrierOffsetRecord'
import './CarrierOffsetExperiment.css'

function initialHistory() {
  try {
    const text = localStorage.getItem(CARRIER_HISTORY_KEY)
    return { ...readCarrierRecords(text), text }
  } catch {
    return { records: [], rejected: 1, text: null }
  }
}
const display = (n: number) => (n === 0 ? '0' : n.toExponential(5))

export default function CarrierOffsetExperiment() {
  const [plan, setPlan] = useState(defaultCarrierPlan)
  const [seed, setSeed] = useState('42')
  const [phase, setPhase] = useState('0')
  const [offsets, setOffsets] = useState('-60,-30,-15,0,15,30,60')
  const [initial] = useState(initialHistory)
  const [records, setRecords] = useState<CarrierRecord[]>(initial.records)
  const [selected, setSelected] = useState(initial.records[0]?.id ?? '')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('等待确认偏移方案；尚未运行。')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(
    initial.rejected
      ? '已有记录无法校验；原始存储保留，新结果仅保留在内存，请导出。'
      : '',
  )
  const [progress, setProgress] = useState({ completed: 0, total: 1 })
  const workerRef = useRef<Worker | null>(null)
  const storageText = useRef(initial.text)
  const persistenceBlocked = useRef(initial.rejected > 0)
  const record = records.find((r) => r.id === selected) ?? records[0]
  const row = record?.rows[previewIndex] ?? record?.rows[0]
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  function edit(patch: Partial<CarrierPlan>) {
    setPlan((previous) => ({ ...previous, ...patch }))
    setError('')
    setStatus('方案已修改，等待确认；已有结果仍属于原完成记录。')
  }
  function cancel() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setStatus('偏移实验已取消，未生成本轮记录。')
  }
  function start() {
    if (workerRef.current) return
    setError('')
    try {
      if (!seed.trim()) throw new Error('请输入偏移基础种子。')
      if (!phase.trim()) throw new Error('请输入偏移初相位。')
      const tokens = offsets.split(/[,，]/)
      if (tokens.some((token) => !token.trim()))
        throw new Error('请输入逗号分隔的非空扫描点。')
      const frozen = structuredClone({
        ...plan,
        seed: Number(seed),
        phaseDeg: Number(phase),
        offsets: tokens.map(Number),
      })
      validateCarrierPlan(frozen)
      const worker = new Worker(
        new URL('../workers/carrierOffset.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRunning(true)
      setProgress({
        completed: 0,
        total: frozen.offsets.length * frozen.trials,
      })
      setStatus('偏移实验计算中，使用已确认参数…')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setRunning(false)
      }
      const failed = (message: string) => {
        finish()
        setError(message)
        setStatus('偏移计算失败，未生成本轮记录。')
      }
      worker.onmessage = (event: MessageEvent<CarrierMessage>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (!message || typeof message !== 'object') {
          failed('偏移 Worker 返回无效消息。')
          return
        }
        if (message.type === 'progress') {
          if (
            !Number.isInteger(message.completed) ||
            message.completed < 0 ||
            message.total !== frozen.offsets.length * frozen.trials ||
            message.completed > message.total
          ) {
            failed('偏移 Worker 返回无效消息。')
            return
          }
          setProgress(message)
          return
        }
        if (message.type === 'error') {
          failed(
            typeof message.message === 'string'
              ? message.message
              : '偏移 Worker 返回无效消息。',
          )
          return
        }
        try {
          if (message.type !== 'done')
            throw new Error('偏移 Worker 返回无效消息。')
          const completed = makeCarrierRecord(
            frozen,
            message.rows,
            crypto.randomUUID(),
            new Date().toISOString(),
          )
          finish()
          const next = [completed, ...records].slice(0, 5)
          setRecords(next)
          setSelected(completed.id)
          setPreviewIndex(0)
          setStatus('偏移实验完成；结果来自已确认方案，可导出复现。')
          try {
            if (persistenceBlocked.current) return
            if (
              localStorage.getItem(CARRIER_HISTORY_KEY) !== storageText.current
            ) {
              persistenceBlocked.current = true
              setNotice(
                '另一页面已修改历史；原始存储保留，本轮结果仅在内存，请导出并刷新后核对。',
              )
              return
            }
            const text = JSON.stringify(next)
            localStorage.setItem(CARRIER_HISTORY_KEY, text)
            storageText.current = text
          } catch {
            setNotice('本地保存失败；本轮结果仍在内存，请立即导出 JSON。')
          }
        } catch (cause) {
          failed(cause instanceof Error ? cause.message : '偏移结果校验失败。')
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        failed('偏移后台计算失败，请重试。')
      }
      worker.onmessageerror = () => {
        if (workerRef.current === worker) failed('偏移 Worker 返回无效消息。')
      }
      worker.postMessage(frozen)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setRunning(false)
      setError(cause instanceof Error ? cause.message : '无法启动偏移实验。')
    }
  }
  function download() {
    if (!record) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `SignalLab-carrier-${record.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const preview = row?.preview ?? []
  const scale =
    Math.max(2.5, ...preview.flatMap((p) => [Math.abs(p.i), Math.abs(p.q)])) *
    1.1
  const phaseScale = Math.max(1, ...preview.map((p) => Math.abs(p.phaseDeg)))
  const lastSymbol = preview.at(-1)?.index ?? 1
  return (
    <section className="carrier-experiment" aria-labelledby="carrier-title">
      <h2 id="carrier-title">相位与频率偏移实验</h2>
      <p>
        每符号一个复数采样：r[n] = s[n] exp(j(φ₀ + 2πεn)) + w[n]，n 从 0 开始。ε
        = Δf/Rs，单位 cycles/symbol；未补偿、未模拟脉冲成形或符号间干扰。
      </p>
      <p>
        本实验保存在当前浏览器，最近五次；登录后也不会上传到云端。旧引导实验、账号同步及备份保持各自原有范围。JSON
        导出可长期留存，本地记录不是审计凭证。
      </p>
      <fieldset className="signal-controls" disabled={running}>
        <legend>确认偏移方案</legend>
        <div className="signal-parameters">
          <label>
            偏移实验类型
            <select
              value={plan.mode}
              onChange={(e) => {
                const mode = e.target.value as CarrierPlan['mode']
                edit({ mode, frequency: 0 })
                setOffsets(
                  mode === 'phase'
                    ? '-60,-30,-15,0,15,30,60'
                    : '-0.001,-0.0005,0,0.0005,0.001',
                )
              }}
            >
              <option value="phase">相位扫描（度）</option>
              <option value="frequency">频偏扫描（cycles/symbol）</option>
            </select>
          </label>
          <label>
            偏移调制方式
            <select
              value={plan.modulation}
              onChange={(e) =>
                edit({
                  modulation: e.target.value as CarrierPlan['modulation'],
                })
              }
            >
              {MODULATIONS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            偏移每次比特数
            <select
              value={plan.bits}
              onChange={(e) => edit({ bits: Number(e.target.value) })}
            >
              {[16384, 65536, 131072].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            偏移 Eb/N0 (dB)
            <select
              value={plan.ebN0Db}
              onChange={(e) => edit({ ebN0Db: Number(e.target.value) })}
            >
              {COMPARISON_DB.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </label>
          <label>
            偏移重复次数
            <select
              value={plan.trials}
              onChange={(e) => edit({ trials: Number(e.target.value) })}
            >
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            偏移基础种子
            <input
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value)
                edit({})
              }}
            />
          </label>
          <label>
            偏移初相位（度，仅频偏扫描使用）
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              disabled={plan.mode === 'phase'}
              value={phase}
              onChange={(e) => {
                setPhase(e.target.value)
                edit({})
              }}
            />
          </label>
        </div>
        <label>
          偏移扫描点
          <input
            type="text"
            value={offsets}
            maxLength={500}
            onChange={(e) => {
              setOffsets(e.target.value)
              edit({})
            }}
            aria-describedby="carrier-offset-help"
          />
        </label>
        <p id="carrier-offset-help">
          逗号分隔，递增且不重复，最多21点。相位范围 [−180,180] 度；频偏范围
          [−0.5,0.5)。频偏按符号累计，帧长会影响结果。
        </p>
        <label>
          <input
            type="checkbox"
            checked={plan.noiseEnabled}
            onChange={(e) => edit({ noiseEnabled: e.target.checked })}
          />
          偏移启用 AWGN
        </label>
      </fieldset>
      <div className="signal-sweep-actions">
        <button type="button" disabled={running} onClick={start}>
          确认偏移方案并运行
        </button>
        {running && (
          <button type="button" onClick={cancel}>
            取消偏移实验
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      {running && (
        <progress
          aria-label="偏移实验进度"
          value={progress.completed}
          max={progress.total}
        />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {notice && <p className="carrier-notice">{notice}</p>}
      <label>
        偏移历史记录
        <select
          disabled={running || !records.length}
          value={record?.id ?? ''}
          onChange={(e) => {
            setSelected(e.target.value)
            setPreviewIndex(0)
          }}
        >
          {!records.length && <option value="">尚无完成记录</option>}
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.completedAt).toLocaleString()} · {r.plan.modulation} ·{' '}
              {r.plan.mode === 'phase' ? '相位' : '频偏'} · 种子 {r.plan.seed} ·{' '}
              {r.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <div className="signal-sweep-actions">
        <button type="button" disabled={!record} onClick={download}>
          导出偏移记录 JSON
        </button>
        <button
          type="button"
          disabled={running || !record}
          onClick={() => {
            if (!record) return
            setPlan(structuredClone(record.plan))
            setSeed(String(record.plan.seed))
            setPhase(String(record.plan.phaseDeg))
            setOffsets(record.plan.offsets.join(','))
            setError('')
            setStatus('历史方案已载入，等待确认后运行。')
          }}
        >
          载入偏移方案
        </button>
      </div>
      {record && (
        <>
          <p>
            完成记录 {record.id}；{record.plan.modulation}，N={record.plan.bits}
            ，每帧{' '}
            {record.plan.bits /
              (record.plan.modulation === 'BPSK'
                ? 1
                : record.plan.modulation === 'QPSK'
                  ? 2
                  : 4)}{' '}
            符号，{record.plan.trials} 次，基础种子 {record.plan.seed}，Eb/N0=
            {record.plan.ebN0Db} dB，AWGN{' '}
            {record.plan.noiseEnabled ? '开启' : '关闭'}
            。以下结果属于此完成快照。
          </p>
          <div
            className="carrier-table"
            role="region"
            aria-label="偏移数值结果，可横向滚动"
            tabIndex={0}
          >
            <table>
              <caption>有限帧结果：预测使用实际序列和逐符号相位</caption>
              <thead>
                <tr>
                  {[
                    '偏移',
                    '误码数 / 总比特',
                    '实测 BER',
                    '当前模型预测 BER',
                    '种子标准差',
                    '逐点95%保守区间',
                    'I/Q RMS EVM (%)',
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.rows.map((r) => (
                  <tr key={r.offset}>
                    <th scope="row">
                      {r.offset}{' '}
                      {record.plan.mode === 'phase' ? '°' : 'cycles/symbol'}
                    </th>
                    <td>
                      {r.totalErrors} / {r.totalBits}
                    </td>
                    <td>{display(r.ber)}</td>
                    <td>{display(r.theoretical)}</td>
                    <td>{display(r.sampleSd)}</td>
                    <td>
                      [{display(r.interval[0])}, {display(r.interval[1])}]
                    </td>
                    <td>{(r.evmRms * 100).toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            查看扫描点
            <select
              value={row?.offset ?? ''}
              onChange={(e) =>
                setPreviewIndex(
                  record.rows.findIndex(
                    (r) => r.offset === Number(e.target.value),
                  ),
                )
              }
            >
              {record.rows.map((r) => (
                <option key={r.offset} value={r.offset}>
                  {r.offset}
                </option>
              ))}
            </select>
          </label>
          <p>
            预览为第一试验种子 {row?.seeds[0]}、跨整帧均匀抽取的{' '}
            {preview.length} 个符号；统计使用全部样本。末符号累计相位{' '}
            {preview.at(-1)?.phaseDeg.toFixed(3)}°。
          </p>
          <div className="carrier-plots">
            <figure>
              <figcaption>参考星座与接收 I/Q</figcaption>
              <svg viewBox="0 0 320 320" role="img" aria-label="偏移星座图">
                <line x1="20" x2="300" y1="160" y2="160" />
                <line x1="160" x2="160" y1="20" y2="300" />
                <text x="294" y="155">
                  I
                </text>
                <text x="165" y="23">
                  Q
                </text>
                {preview.map((p) => (
                  <g key={p.index}>
                    <circle
                      className="carrier-reference"
                      cx={160 + (p.si / scale) * 130}
                      cy={160 - (p.sq / scale) * 130}
                      r="3"
                    />
                    <circle
                      className="carrier-received"
                      cx={160 + (p.i / scale) * 130}
                      cy={160 - (p.q / scale) * 130}
                      r="2"
                    />
                  </g>
                ))}
                <text x="15" y="312">
                  蓝色：参考；红色：接收；轴范围 ±{scale.toFixed(2)}
                </text>
              </svg>
            </figure>
            <figure>
              <figcaption>相位随符号变化（未取模）</figcaption>
              <svg viewBox="0 0 320 320" role="img" aria-label="偏移相位轨迹">
                <line x1="25" x2="300" y1="160" y2="160" />
                <line x1="25" x2="25" y1="25" y2="285" />
                <polyline
                  points={preview
                    .map(
                      (p) =>
                        `${25 + (p.index / lastSymbol) * 270},${160 - (p.phaseDeg / phaseScale) * 125}`,
                    )
                    .join(' ')}
                />
                <text x="30" y="20">
                  ±{phaseScale.toFixed(1)}°
                </text>
                <text x="25" y="310">
                  n=0 → {lastSymbol}
                </text>
              </svg>
            </figure>
          </div>
        </>
      )}
      <p>
        Eb=1，噪声每轴方差 1/(2×10^(Eb/N0/10))。EVM
        使用实际参考能量且不校正相位；复数 BPSK 的 I/Q EVM 不等于旧实验的实轴
        EVM。QPSK/16QAM 保留旧 I、Q 随机顺序；BPSK 保留旧 I 流，Q 流种子为 seed
        XOR 0x9e3779b9。
      </p>
      <p>
        试验种子=(基础种子+trial×10+完整十点网格索引) mod
        2³²。偏移点共享噪声，属于配对比较。逐点95%
        Hoeffding区间以64比特块估计有限帧平均期望，假设理想噪声块独立、允许均值不同；PRNG只是近似。不是同时置信带，种子标准差不是均值区间，零误码不代表真实BER为零。无噪声时预测为确定性判决结果。
      </p>
    </section>
  )
}
