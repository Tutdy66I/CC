import { useEffect, useRef, useState } from 'react'
import {
  CHANNEL_ENGINE,
  channelOperations,
  defaultChannelPlan,
  freezeChannelPlan,
  validateChannelPlan,
  validateChannelTrial,
} from '../lib/channelResearch'
import {
  makeChannelCheckpoint,
  makeChannelRecord,
  parseChannelCheckpoint,
  parseChannelRecord,
} from '../lib/channelResearchRecord'
import {
  readChannelState,
  saveChannelCheckpoint,
  saveChannelRecord,
} from '../lib/channelResearchStore'
import type { ChannelModel, ChannelPlan } from '../lib/channelTypes'
import ChannelResearchCharts from './ChannelResearchCharts'
import './ChannelResearchExperiment.css'

type Checkpoint = Awaited<ReturnType<typeof parseChannelCheckpoint>>
type ChannelRecord = Awaited<ReturnType<typeof parseChannelRecord>>
const modelNames: Record<ChannelModel, string> = {
  awgn: 'AWGN 基准',
  'rayleigh-block': '准静态 Rayleigh',
  'rayleigh-iid': '逐符号 iid Rayleigh（失配）',
}
const methodNames = {
  raw: '未均衡',
  ideal: '理想 CSI + ZF',
  ls: 'LS 估计 CSI + ZF',
}
const fmt = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? '不可用'
    : v === 0
      ? '0'
      : v.toExponential(4)
const interval = (v: readonly [number, number] | null) =>
  v === null ? '不可用' : `[${fmt(v[0])}, ${fmt(v[1])}]`
const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ChannelResearchExperiment() {
  const [plan, setPlan] = useState(defaultChannelPlan)
  const [frameText, setFrameText] = useState('512')
  const [pilotText, setPilotText] = useState('16')
  const [snrText, setSnrText] = useState('0,4,8,12')
  const [trialsText, setTrialsText] = useState('200')
  const [seedText, setSeedText] = useState('42')
  const [records, setRecords] = useState<ChannelRecord[]>([])
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null)
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('正在读取本地信道研究记录。')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unparsed, setUnparsed] = useState<unknown | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const runRef = useRef<string | null>(null)
  const active = useRef<Checkpoint | null>(null)
  const revision = useRef(0)
  const blocked = useRef(false)
  const storageQueue = useRef<Promise<void>>(Promise.resolve())
  const lastProgress = useRef(0)
  const record = records.find((r) => r.protocolHash === selected) ?? records[0]

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const state = await readChannelState()
        const parsedRecords = await Promise.all(
          state.records.map((r) => parseChannelRecord(r)),
        )
        const parsedCheckpoint =
          state.checkpoint === null
            ? null
            : await parseChannelCheckpoint(state.checkpoint)
        if (!mounted) return
        revision.current = state.revision
        setRecords(parsedRecords)
        setSelected(parsedRecords[0]?.protocolHash ?? '')
        setCheckpoint(parsedCheckpoint)
        setStatus(
          parsedCheckpoint
            ? '发现信道检查点；请主动恢复冻结方案。'
            : '等待冻结信道研究方案。',
        )
      } catch (reason) {
        if (!mounted) return
        blocked.current = true
        try {
          setUnparsed(await readChannelState())
        } catch {
          /* The storage is unavailable; memory results remain usable. */
        }
        setNotice(
          `本地信道记录无法校验，保留原存储；新结果仅在内存，可导出。${reason instanceof Error ? reason.message : ''}`,
        )
        setStatus('本地存储不可用；仍可进行内存实验。')
      } finally {
        if (mounted) setLoaded(true)
      }
    })()
    return () => {
      mounted = false
      workerRef.current?.terminate()
      workerRef.current = null
      runRef.current = null
    }
  }, [])

  function persist(
    kind: 'checkpoint' | 'record',
    value: Checkpoint | ChannelRecord,
  ) {
    const task = storageQueue.current.then(async () => {
      if (blocked.current) return
      try {
        revision.current =
          kind === 'record'
            ? await saveChannelRecord(value as ChannelRecord, revision.current)
            : await saveChannelCheckpoint(value as Checkpoint, revision.current)
      } catch (reason) {
        blocked.current = true
        setNotice(
          `信道记录保存失败或另一页面已修改数据；保留原存储，当前结果可导出。${reason instanceof Error ? reason.message : ''}`,
        )
      }
    })
    storageQueue.current = task
    return task
  }

  function currentPlan(): ChannelPlan {
    if (!seedText.trim()) throw new Error('请填写信道研究随机种子。')
    if (![frameText, trialsText, pilotText, snrText].every((v) => v.trim()))
      throw new Error('请填写全部信道研究参数。')
    const list = (value: string) =>
      value
        .trim()
        .split(/[,，\s]+/)
        .map(Number)
    const next = {
      ...plan,
      frameSymbols: Number(frameText),
      pilotCounts: list(pilotText),
      ebN0Db: list(snrText),
      trials: Number(trialsText),
      seed: Number(seedText),
    }
    validateChannelPlan(next)
    return next
  }

  function cancel() {
    workerRef.current?.terminate()
    workerRef.current = null
    runRef.current = null
    setRunning(false)
    if (active.current) {
      setCheckpoint(active.current)
      void persist('checkpoint', active.current)
    }
    setStatus('信道研究已取消，保留已验证前缀；未生成本轮完整统计区间。')
  }

  async function start(resume?: Checkpoint) {
    if (runRef.current) return
    const runId = crypto.randomUUID()
    runRef.current = runId
    setError('')
    setRunning(true)
    setStatus('正在冻结并校验信道研究协议。')
    active.current = null
    try {
      const c = resume
        ? await parseChannelCheckpoint(resume)
        : makeChannelCheckpoint(await freezeChannelPlan(currentPlan()), [])
      if (runRef.current !== runId) return
      validateChannelPlan(c.plan)
      const frozen = {
        engineVersion: c.engineVersion,
        protocolHash: c.protocolHash,
        plan: c.plan,
      }
      active.current = c
      setCompleted(c.trials.length)
      setTotal(c.plan.trials)
      const worker = new Worker(
        new URL('../workers/channelResearch.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setStatus(`信道研究计算中：${c.trials.length}/${c.plan.trials} 帧。`)
      const finishWorker = () => {
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
      const fail = (message: string) => {
        if (runRef.current !== runId) return
        finishWorker()
        runRef.current = null
        setRunning(false)
        if (active.current) {
          setCheckpoint(active.current)
          void persist('checkpoint', active.current)
        }
        setError(message)
        setStatus('信道研究计算失败，保留已验证前缀；未发布完整统计区间。')
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (workerRef.current !== worker || runRef.current !== runId) return
        void (async () => {
          try {
            const message = event.data
            if (!isObject(message) || typeof message.runId !== 'string')
              throw new Error('信道 Worker 消息缺少运行标识。')
            if (message.runId !== runId) return
            if (
              message.protocolHash !== frozen.protocolHash ||
              message.engineVersion !== CHANNEL_ENGINE
            )
              throw new Error('信道 Worker 协议或引擎版本不匹配。')
            if (message.type === 'error')
              throw new Error(
                typeof message.message === 'string'
                  ? message.message
                  : '信道 Worker 失败。',
              )
            if (message.type === 'batch') {
              const prefix = active.current
              if (
                !prefix ||
                !Array.isArray(message.trials) ||
                message.trials.length === 0 ||
                message.completed !==
                  prefix.trials.length + message.trials.length ||
                message.total !== frozen.plan.trials ||
                Number(message.completed) > frozen.plan.trials
              )
                throw new Error('信道 Worker 增量前缀或进度无效。')
              const next = message.trials
              for (let index = 0; index < next.length; index++)
                validateChannelTrial(
                  frozen.plan,
                  next[index],
                  prefix.trials.length + index,
                )
              active.current = makeChannelCheckpoint(frozen, [
                ...prefix.trials,
                ...next,
              ])
              const now = performance.now()
              if (
                now - lastProgress.current >= 100 ||
                message.completed === frozen.plan.trials
              ) {
                lastProgress.current = now
                setCompleted(Number(message.completed))
                setStatus(
                  `信道研究计算中：${message.completed}/${frozen.plan.trials} 帧；尚无完整统计区间。`,
                )
              }
              return
            }
            if (message.type !== 'done')
              throw new Error('信道 Worker 消息类型无效。')
            const prefix = active.current
            if (!prefix || prefix.trials.length !== frozen.plan.trials)
              throw new Error('信道 Worker 未提供完整已验证前缀。')
            finishWorker()
            const received = await parseChannelRecord(message.record)
            const canonicalPrefix = await parseChannelCheckpoint(prefix)
            if (runRef.current !== runId) return
            if (
              received.protocolHash !== frozen.protocolHash ||
              JSON.stringify(received.plan) !== JSON.stringify(frozen.plan) ||
              JSON.stringify(received.trials) !==
                JSON.stringify(canonicalPrefix.trials)
            )
              throw new Error('信道 Worker 完成记录与已验证前缀不一致。')
            const complete = makeChannelRecord(frozen, prefix.trials)
            runRef.current = null
            setRunning(false)
            setRecords((previous) =>
              [
                complete,
                ...previous.filter(
                  (r) => r.protocolHash !== complete.protocolHash,
                ),
              ].slice(0, 2),
            )
            setSelected(complete.protocolHash)
            setCheckpoint(null)
            setCompleted(frozen.plan.trials)
            setStatus(
              `信道研究完成：${frozen.plan.trials} 个独立试验帧，全部结果和失败案例可导出。`,
            )
            void persist('record', complete)
          } catch (reason) {
            fail(
              reason instanceof Error
                ? reason.message
                : '信道 Worker 输出校验失败。',
            )
          }
        })()
      }
      worker.onerror = () => fail('信道 Worker 无法启动或运行中发生错误。')
      worker.postMessage({ runId, checkpoint: c })
    } catch (reason) {
      if (runRef.current !== runId) return
      workerRef.current?.terminate()
      workerRef.current = null
      runRef.current = null
      setRunning(false)
      setError(reason instanceof Error ? reason.message : '信道研究无法启动。')
      setStatus('信道方案校验失败，请修改参数后重试。')
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || running) return
    setError('')
    try {
      if (file.size > 32_000_000)
        throw new Error('导入文件超过 32 MB，请使用离线研究工具。')
      const value: unknown = JSON.parse(await file.text())
      if (
        !isObject(value) ||
        !['complete', 'checkpoint'].includes(String(value.status))
      )
        throw new Error('信道 JSON 缺少明确的 complete 或 checkpoint 状态。')
      if (value.status === 'complete') {
        const parsed = await parseChannelRecord(value)
        setRecords((previous) =>
          [
            parsed,
            ...previous.filter((r) => r.protocolHash !== parsed.protocolHash),
          ].slice(0, 2),
        )
        setSelected(parsed.protocolHash)
        setCheckpoint(null)
        await persist('record', parsed)
        setStatus('信道完成记录已校验并导入，汇总已重新计算。')
      } else {
        const parsed = await parseChannelCheckpoint(value)
        setCheckpoint(parsed)
        await persist('checkpoint', parsed)
        setStatus('信道检查点已校验并导入；请主动恢复冻结方案。')
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '信道 JSON 无法导入。',
      )
    }
  }

  let operations: number | null = null
  try {
    operations = channelOperations(currentPlan())
  } catch {
    /* Invalid drafts are explained when the user confirms. */
  }

  return (
    <section className="channel-experiment" aria-labelledby="channel-title">
      <h2 id="channel-title">无线衰落与信道估计研究</h2>
      <p>
        比较 AWGN 与 Rayleigh 平坦衰落、理想 CSI 与导频 LS
        估计，以及均衡误码率、估计误差和训练开销。完整实验在浏览器 Worker
        本地运行。
      </p>
      <fieldset disabled={running || !loaded} className="channel-fields">
        <legend>冻结实验参数</legend>
        <label>
          信道研究调制
          <select
            value={plan.modulation}
            onChange={(e) =>
              setPlan({
                ...plan,
                modulation: e.target.value as ChannelPlan['modulation'],
              })
            }
          >
            {['BPSK', 'QPSK', '16QAM'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          信道研究帧长
          <input
            type="number"
            value={frameText}
            onChange={(e) => setFrameText(e.target.value)}
          />
        </label>
        <label>
          信道研究导频数列表
          <input
            type="text"
            value={pilotText}
            onChange={(e) => setPilotText(e.target.value)}
            placeholder="4,16,64"
          />
        </label>
        <label>
          信道研究 Eb/N0 列表
          <input
            type="text"
            value={snrText}
            onChange={(e) => setSnrText(e.target.value)}
          />
        </label>
        <label>
          信道研究试验帧数
          <input
            type="number"
            value={trialsText}
            onChange={(e) => setTrialsText(e.target.value)}
          />
        </label>
        <label>
          信道研究随机种子
          <input
            type="number"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
          />
        </label>
        <label>
          信道研究能量口径
          <select
            value={plan.energyBasis}
            onChange={(e) =>
              setPlan({
                ...plan,
                energyBasis: e.target.value as ChannelPlan['energyBasis'],
              })
            }
          >
            <option value="data-eb">固定 data Eb/N0（数据 Eb = 1）</option>
            <option value="total-eb">固定 total Eb/N0（含导频能量）</option>
          </select>
        </label>
      </fieldset>
      <fieldset disabled={running || !loaded} className="channel-models">
        <legend>信道模型（分别统计）</legend>
        {(Object.keys(modelNames) as ChannelModel[]).map((model) => (
          <label key={model}>
            <input
              type="checkbox"
              checked={plan.channels.includes(model)}
              onChange={(e) =>
                setPlan({
                  ...plan,
                  channels: e.target.checked
                    ? [...plan.channels, model]
                    : plan.channels.filter((v) => v !== model),
                })
              }
            />
            {modelNames[model]}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            aria-label="信道研究启用噪声"
            checked={plan.noiseEnabled}
            onChange={(e) =>
              setPlan({ ...plan, noiseEnabled: e.target.checked })
            }
          />
          启用复数 AWGN 噪声
        </label>
      </fieldset>
      <p className="channel-caption">
        预计路径评价：
        {operations === null ? '草案尚未通过校验' : operations.toLocaleString()}
        ；浏览器预算 50,000,000，最多 4,000
        个场景帧。超预算会拒绝启动，不自动缩减样本；长研究请使用离线工具。
      </p>
      <div className="channel-actions">
        <button disabled={running || !loaded} onClick={() => void start()}>
          冻结信道协议并运行
        </button>
        <button disabled={!running} onClick={cancel}>
          取消并保存信道检查点
        </button>
        <button
          disabled={running || !checkpoint || !loaded}
          onClick={() => checkpoint && void start(checkpoint)}
        >
          恢复信道检查点
        </button>
        <button
          disabled={!checkpoint || running}
          onClick={() =>
            checkpoint && download(checkpoint, 'signallab-v12-checkpoint.json')
          }
        >
          导出信道检查点 JSON
        </button>
        <button
          disabled={!record || running}
          onClick={() =>
            record && download(record, 'signallab-v12-research.json')
          }
        >
          导出信道研究 JSON
        </button>
        {unparsed !== null && (
          <button
            onClick={() =>
              download(unparsed, 'signallab-v12-unparsed-storage.json')
            }
          >
            导出未解析信道存储 JSON
          </button>
        )}
        <label className="channel-import">
          导入信道记录或检查点
          <input
            type="file"
            accept=".json,application/json"
            disabled={running || !loaded}
            onChange={(e) => {
              void importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p role="status">{status}</p>
      {running && (
        <progress
          aria-label="信道研究进度"
          value={completed}
          max={Math.max(1, total)}
        />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {notice && <p className="channel-notice">{notice}</p>}
      <p className="channel-caption">
        信道研究使用独立
        IndexedDB；不进入云同步。取消或计算失败只保留检查点，固定样本置信区间在完整研究后发布。直接关闭页面不保证保存最后进度。
      </p>
      {records.length > 0 && (
        <label className="channel-history">
          信道研究历史
          <select
            value={record?.protocolHash ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {records.map((r) => (
              <option key={r.protocolHash} value={r.protocolHash}>
                {r.plan.modulation} · N{r.plan.frameSymbols} · {r.plan.trials}{' '}
                帧 · {r.protocolHash.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
      )}
      {record && (
        <>
          <p className="channel-protocol">
            引擎：{record.engineVersion}；协议 SHA-256：{record.protocolHash}
          </p>
          <p>
            当前展示记录：{record.plan.modulation}，N={record.plan.frameSymbols}
            ，
            {record.plan.energyBasis === 'data-eb'
              ? '固定 data Eb/N0'
              : '固定 total Eb/N0'}
            ，噪声{record.plan.noiseEnabled ? '启用' : '关闭'}
            。修改草案不会更改历史快照。
          </p>
          <ChannelResearchCharts summary={record.summary} />
          <div className="channel-table">
            <table aria-label="信道 BER 与统计区间">
              <caption>所有试验帧的数据位 BER；导频不计入 BER 分母</caption>
              <thead>
                <tr>
                  {[
                    '信道',
                    'Eb/N0',
                    '导频 P',
                    '接收方法',
                    '全部数据 BER',
                    '数值失败上下界',
                    '逐帧 95% 区间',
                    '公共数据 BER',
                    'BER 有效/失败帧',
                    'EVM 有效/失败帧',
                    '有限样本 pooled EVM',
                    '每帧 EVM 中位/P90/P99',
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.summary.flatMap((row) =>
                  (['raw', 'ideal', 'ls'] as const).map((method) => {
                    const m = row.methods[method]
                    return (
                      <tr
                        key={`${row.model}/${row.ebN0Db}/${row.pilots}/${method}`}
                      >
                        <td>{modelNames[row.model]}</td>
                        <td>{row.ebN0Db} dB</td>
                        <td>{row.pilots}</td>
                        <td>{methodNames[method]}</td>
                        <td>{fmt(m.ber)}</td>
                        <td>{interval(m.berBounds)}</td>
                        <td>{interval(m.berInterval)}</td>
                        <td>{fmt(m.commonBer)}</td>
                        <td>
                          {m.validFrames}/{m.failedFrames}
                        </td>
                        <td>
                          {m.evm.validFrames}/{row.frames - m.evm.validFrames}
                        </td>
                        <td>{fmt(m.evm.pooledRms)}</td>
                        <td>
                          {fmt(m.evm.median)} / {fmt(m.evm.p90)} /{' '}
                          {fmt(m.evm.p99)}
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="channel-table">
            <table aria-label="信道估计误差与导频资源">
              <caption>LS 估计误差、资源和配对差异</caption>
              <thead>
                <tr>
                  {[
                    '信道',
                    'Eb/N0',
                    'P / 帧数',
                    'MSE / 模型参考',
                    'NMSE',
                    '深衰落比例',
                    '实测数据/导频/总能量',
                    '名义总 Eb',
                    'LS−ideal 公共 BER 差',
                    '逐帧保守区间',
                    '近似配对 bootstrap',
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.summary.map((row) => (
                  <tr key={`${row.model}/${row.ebN0Db}/${row.pilots}`}>
                    <td>{modelNames[row.model]}</td>
                    <td>{row.ebN0Db} dB</td>
                    <td>
                      {row.pilots} / {row.frames}
                    </td>
                    <td>
                      {fmt(row.mse)} / {fmt(row.expectedLsMse)}
                    </td>
                    <td>{fmt(row.nmse)}</td>
                    <td>{fmt(row.deepFadeRate)}</td>
                    <td>
                      {fmt(row.meanDataEnergy)} / {fmt(row.meanPilotEnergy)} /{' '}
                      {fmt(row.meanTotalEnergy)}
                    </td>
                    <td>{fmt(row.expectedTotalEb)}</td>
                    <td>{fmt(row.pairedDifference.mean)}</td>
                    <td>{interval(row.pairedDifference.interval)}</td>
                    <td>{interval(row.pairedDifference.bootstrap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="channel-caption">
            区间为逐点 95%，不是同时置信带。帧是独立统计单位；配对 bootstrap
            是近似区间。未检出显著差异不等于算法等效。跨导频数量的公共数据集合由冻结方案决定。
          </p>
        </>
      )}
      <details className="channel-model-note">
        <summary>数学模型、配对协议与适用边界</summary>
        <p>
          复基带 y = hx + w，w ∼ CN(0,N0)，I/Q 方差各 N0/2；包括 BPSK
          的复数接收观测。BPSK/QPSK/16QAM 的平均 Es 分别为 1/2/4，均匀数据
          Eb=1；SNR 指 Es/N0。噪声不按本帧实际信道增益或数据能量重新归一化。
        </p>
        <p>
          准静态 h ∼ CN(0,1)，帧内恒定、帧间独立；逐符号 iid
          模型每个符号独立变化，单独标为失配压力实验，不能用稀疏导频恢复独立数据位置的
          CSI。本版假设定时与载波同步完美，不包含 OFDM、多径时延或多普勒标定。
        </p>
        <p>
          前 P 个符号为已知导频，Ep=Es。LS 仅使用导频：估计 h = Σconj(p)y /
          Σ|p|²；准静态参考 MSE=N0/Σ|p|²。固定 total Eb 包含导频，总
          Eb=N/(N−P)。同一帧的 raw/ideal/LS 共用接收样本，跨 P
          使用绝对位置生成数据和噪声；公共数据从最大 P 开始。
        </p>
        <p>
          ZF 在深衰落时放大噪声。Rayleigh 的 E[1/|h|²] 发散，非零噪声下均方 EVM
          没有有限总体均值；pooled RMS 仅描述本次有限样本。分位数按有效帧 RMS
          EVM 统计，失败计数同时保留，不删去巨大有限误差。EVM 为
          data-aided，无事后最佳增益或相位拟合。
        </p>
        <p>
          实验保存失败原因、数值失败 BER
          上下界、全部逐帧结果和协议。随机种子、PRNG/流域、引擎版本和 SHA-256
          协议共同决定复现；哈希是完整性标识，不是外部注册时间戳或真实性认证。旧版载波研究和云记录保留各自原模型。
        </p>
      </details>
    </section>
  )
}
