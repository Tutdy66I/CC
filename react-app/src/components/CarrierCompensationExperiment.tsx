import { useEffect, useRef, useState } from 'react'
import { COMPARISON_DB, MODULATIONS } from '../lib/modulationComparison'
import {
  defaultCarrierPlan,
  validateCarrierPlan,
  type CarrierPlan,
  type CarrierPreview,
} from '../lib/carrierOffset'
import { type CompensationMessage } from '../lib/carrierCompensation'
import {
  COMPENSATION_HISTORY_KEY,
  makeCompensationRecord,
  readCompensationRecords,
  type CompensationRecord,
} from '../lib/carrierCompensationRecord'
import './CarrierOffsetExperiment.css'

function initialHistory() {
  try {
    const text = localStorage.getItem(COMPENSATION_HISTORY_KEY)
    return { ...readCompensationRecords(text), text }
  } catch {
    return { records: [], rejected: 1, text: null }
  }
}
const number = (n: number) => (n === 0 ? '0' : n.toExponential(5))

function Constellation({
  samples,
  title,
  scale,
}: {
  samples: CarrierPreview[]
  title: string
  scale: number
}) {
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <svg viewBox="0 0 320 320" role="img" aria-label={title}>
        <line x1="20" x2="300" y1="160" y2="160" />
        <line x1="160" x2="160" y1="20" y2="300" />
        <text x="293" y="155">
          I
        </text>
        <text x="165" y="23">
          Q
        </text>
        {samples.map((p) => (
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
          蓝色：参考；红色：接收；两图相同轴范围 ±{scale.toFixed(2)}
        </text>
      </svg>
    </figure>
  )
}

export default function CarrierCompensationExperiment() {
  const [plan, setPlan] = useState<CarrierPlan>(() => ({
    ...defaultCarrierPlan(),
    offsets: [0, 30, 60],
  }))
  const [seed, setSeed] = useState('42'),
    [phase, setPhase] = useState('0'),
    [offsets, setOffsets] = useState('0,30,60')
  const [initial] = useState(initialHistory)
  const [records, setRecords] = useState<CompensationRecord[]>(initial.records)
  const [selected, setSelected] = useState(initial.records[0]?.id ?? '')
  const [previewIndex, setPreviewIndex] = useState(0),
    [running, setRunning] = useState(false)
  const [status, setStatus] = useState('等待确认补偿方案；尚未运行。')
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(
      initial.rejected
        ? '已有补偿记录无法校验；原始存储保留，新结果仅在内存，请导出。'
        : '',
    )
  const [progress, setProgress] = useState({ completed: 0, total: 1 })
  const workerRef = useRef<Worker | null>(null),
    storageText = useRef(initial.text),
    blocked = useRef(initial.rejected > 0)
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
    setPlan((p) => ({ ...p, ...patch }))
    setError('')
    setStatus('方案已修改，等待确认；已有结果保留原完成快照。')
  }
  function cancel() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setStatus('补偿实验已取消，未生成本轮记录。')
  }
  function start() {
    if (workerRef.current) return
    setError('')
    try {
      if (!seed.trim()) throw new Error('请输入补偿基础种子。')
      if (!phase.trim()) throw new Error('请输入补偿初相位。')
      const tokens = offsets.split(/[,，]/)
      if (tokens.some((t) => !t.trim()))
        throw new Error('请输入非空、逗号分隔的补偿扫描点。')
      const frozen = structuredClone({
        ...plan,
        seed: Number(seed),
        phaseDeg: Number(phase),
        offsets: tokens.map(Number),
      })
      validateCarrierPlan(frozen)
      const worker = new Worker(
        new URL('../workers/carrierCompensation.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRunning(true)
      setProgress({
        completed: 0,
        total: frozen.trials * frozen.offsets.length,
      })
      setStatus('补偿对照计算中，使用同批接收样本…')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setRunning(false)
      }
      const fail = (message: string) => {
        finish()
        setError(message)
        setStatus('补偿计算失败，未生成本轮记录。')
      }
      worker.onmessage = (event: MessageEvent<CompensationMessage>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (!message || typeof message !== 'object') {
          fail('补偿 Worker 返回无效消息。')
          return
        }
        if (message.type === 'progress') {
          if (
            !Number.isInteger(message.completed) ||
            message.completed < 0 ||
            message.total !== frozen.trials * frozen.offsets.length ||
            message.completed > message.total
          ) {
            fail('补偿 Worker 返回无效消息。')
            return
          }
          setProgress(message)
          return
        }
        if (message.type === 'error') {
          fail(
            typeof message.message === 'string'
              ? message.message
              : '补偿 Worker 返回无效消息。',
          )
          return
        }
        try {
          if (message.type !== 'done')
            throw new Error('补偿 Worker 返回无效消息。')
          const completed = makeCompensationRecord(
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
          setStatus('补偿对照实验完成；两路结果来自同批接收样本，可导出复现。')
          try {
            if (blocked.current) return
            if (
              localStorage.getItem(COMPENSATION_HISTORY_KEY) !==
              storageText.current
            ) {
              blocked.current = true
              setNotice(
                '另一页面已修改补偿历史；原存储保留，本轮结果仅在内存，请导出并刷新后核对。',
              )
              return
            }
            const text = JSON.stringify(next)
            localStorage.setItem(COMPENSATION_HISTORY_KEY, text)
            storageText.current = text
          } catch {
            setNotice('补偿记录保存失败；本轮结果仍在内存，请立即导出 JSON。')
          }
        } catch (cause) {
          fail(cause instanceof Error ? cause.message : '补偿结果校验失败。')
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        fail('补偿后台计算失败，请重试。')
      }
      worker.onmessageerror = () => {
        if (workerRef.current === worker) fail('补偿 Worker 返回无效消息。')
      }
      worker.postMessage(frozen)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setRunning(false)
      setError(cause instanceof Error ? cause.message : '无法启动补偿实验。')
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
    a.download = `SignalLab-compensation-${record.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const scale =
    Math.max(
      2.5,
      ...[
        ...(row?.before.preview ?? []),
        ...(row?.after.preview ?? []),
      ].flatMap((p) => [Math.abs(p.i), Math.abs(p.q)]),
    ) * 1.1
  return (
    <section
      className="carrier-experiment"
      aria-labelledby="compensation-title"
    >
      <h2 id="compensation-title">理想载波补偿对照实验</h2>
      <p>
        使用已知真实偏移的理想基准，不包含频偏估计或同步算法。对同一批接收样本
        r[n] 整体乘
        exp(−jθ[n])，信号与噪声一起旋转；不会重新生成噪声或取回干净发送符号。
      </p>
      <p>
        仅本地保存最近五次对照记录和导出 JSON，登录后也不上传；与 v0.8/v0.9
        历史分别保存。
      </p>
      <fieldset className="signal-controls" disabled={running}>
        <legend>确认补偿对照方案</legend>
        <div className="signal-parameters">
          <label>
            补偿实验类型
            <select
              value={plan.mode}
              onChange={(e) => {
                const mode = e.target.value as CarrierPlan['mode']
                edit({ mode, frequency: 0 })
                setOffsets(mode === 'phase' ? '0,30,60' : '-0.001,0,0.001')
              }}
            >
              <option value="phase">相位扫描（度）</option>
              <option value="frequency">频偏扫描（cycles/symbol）</option>
            </select>
          </label>
          <label>
            补偿调制方式
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
            补偿每次比特数
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
            补偿 Eb/N0 (dB)
            <select
              value={plan.ebN0Db}
              onChange={(e) => edit({ ebN0Db: Number(e.target.value) })}
            >
              {COMPARISON_DB.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            补偿重复次数
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
            补偿基础种子
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
            补偿初相位（度，仅频偏扫描使用）
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
          补偿扫描点
          <input
            type="text"
            maxLength={500}
            value={offsets}
            onChange={(e) => {
              setOffsets(e.target.value)
              edit({})
            }}
          />
        </label>
        <p>
          最多21个递增且不重复的点。相位 [−180,180] 度，频偏 [−0.5,0.5)
          cycles/symbol。真实偏移用于产生损伤，也直接用于理想逆旋转。
        </p>
        <label>
          <input
            type="checkbox"
            checked={plan.noiseEnabled}
            onChange={(e) => edit({ noiseEnabled: e.target.checked })}
          />
          补偿启用 AWGN
        </label>
      </fieldset>
      <div className="signal-sweep-actions">
        <button type="button" disabled={running} onClick={start}>
          确认补偿方案并运行
        </button>
        {running && (
          <button type="button" onClick={cancel}>
            取消补偿实验
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      {running && (
        <progress
          aria-label="补偿实验进度"
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
        补偿历史记录
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
          导出补偿记录 JSON
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
            setStatus('已载入补偿历史方案，等待确认后运行。')
          }}
        >
          载入补偿方案
        </button>
      </div>
      {record && (
        <>
          <p>
            完成快照 {record.id}；{record.plan.modulation}，N={record.plan.bits}
            ，重复 {record.plan.trials} 次，基础种子 {record.plan.seed}，Eb/N0=
            {record.plan.ebN0Db} dB，AWGN{' '}
            {record.plan.noiseEnabled ? '开启' : '关闭'}
            。表格和两图均绑定此记录。
          </p>
          <div
            className="carrier-table"
            role="region"
            aria-label="补偿前后数值对照，可横向滚动"
            tabIndex={0}
          >
            <table>
              <caption>成对结果；偏差=实测−理论，EVM 偏差单位为百分点</caption>
              <thead>
                <tr>
                  {[
                    '偏移',
                    '状态',
                    '误码数 / 总比特',
                    '实测 BER',
                    '理论 BER',
                    'BER 偏差',
                    '逐点95%区间',
                    '实测 EVM (%)',
                    '理论 EVM (%)',
                    'EVM 偏差',
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.rows.flatMap((pair) =>
                  [
                    {
                      data: pair.before,
                      name: '未补偿',
                      evm: pair.theoreticalEvmBefore,
                    },
                    {
                      data: pair.after,
                      name: '理想补偿',
                      evm: pair.theoreticalEvmAfter,
                    },
                  ].map(({ data, name, evm }) => (
                    <tr key={`${data.offset}-${name}`}>
                      <th scope="row">
                        {data.offset}{' '}
                        {record.plan.mode === 'phase' ? '°' : 'cycles/symbol'}
                      </th>
                      <td>{name}</td>
                      <td>
                        {data.totalErrors} / {data.totalBits}
                      </td>
                      <td>{number(data.ber)}</td>
                      <td>{number(data.theoretical)}</td>
                      <td>{number(data.ber - data.theoretical)}</td>
                      <td>
                        [{number(data.interval[0])}, {number(data.interval[1])}]
                      </td>
                      <td>{(100 * data.evmRms).toFixed(5)}</td>
                      <td>{(100 * evm).toFixed(5)}</td>
                      <td>{number(100 * (data.evmRms - evm))}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <label>
            补偿预览扫描点
            <select
              value={row?.before.offset ?? ''}
              onChange={(e) =>
                setPreviewIndex(
                  record.rows.findIndex(
                    (r) => r.before.offset === Number(e.target.value),
                  ),
                )
              }
            >
              {record.rows.map((r) => (
                <option key={r.before.offset} value={r.before.offset}>
                  {r.before.offset}
                </option>
              ))}
            </select>
          </label>
          {row && (
            <>
              <p>
                第一试验种子 {row.before.seeds[0]}，同一组{' '}
                {row.before.preview.length} 个跨帧采样位置。补偿后−补偿前：BER{' '}
                {number(row.after.ber - row.before.ber)}，EVM{' '}
                {number(100 * (row.after.evmRms - row.before.evmRms))}{' '}
                个百分点。
              </p>
              <div className="carrier-plots">
                <Constellation
                  title="未补偿星座图"
                  samples={row.before.preview}
                  scale={scale}
                />
                <Constellation
                  title="理想补偿星座图"
                  samples={row.after.preview}
                  scale={scale}
                />
              </div>
            </>
          )}
        </>
      )}
      <p>
        θ[n]=φ₀+2πεn，n 从零开始。Eb=1，每实轴噪声方差
        σ²=1/(2×10^(Eb/N0/10))。EVM
        使用原发送参考能量；理想补偿保留噪声误差，不要求含噪声时 EVM 为零。
      </p>
      <p>
        理论 EVM 显示 √E[EVM²]，不是 E[EVM]。补偿后参考为
        √(2Nsσ²/Σ|s|²)，补偿前另加入确定性偏移误差能量。补偿后 BER 使用理想同步
        AWGN 理论；未补偿 BER 使用有限帧偏移条件预测。无噪声时补偿后 BER=0，EVM
        在浮点容差内接近0。
      </p>
      <p>
        随机与64比特块区间沿用 v0.9：seed=(baseSeed+trial×10+完整十点网格索引)
        mod 2³²，BPSK Q 种子为 seed XOR
        0x9e3779b9。偏移点及补偿两路配对，有限样本不保证每次 BER 都改善；逐点95%
        Hoeffding
        区间不是同时置信带，假设理想块噪声独立，PRNG只是近似。种子标准差保存在
        JSON 中。该基准不代表实际频偏估计或环路性能。
      </p>
    </section>
  )
}
