import { useEffect, useRef, useState } from 'react'
import {
  defaultResearchPlan,
  validateResearchPlan,
  researchOperations,
  researchLayoutId,
  RESEARCH_ENGINE,
  RESEARCH_METHODS,
  type ResearchPlan,
  type ResearchSummary,
} from '../lib/carrierResearch'
import { RESEARCH_LAYOUTS, type PilotLayoutKind } from '../lib/pilotSearch'
import { MODULATIONS, COMPARISON_DB } from '../lib/modulationComparison'
import {
  RESEARCH_HISTORY_KEY,
  RESEARCH_DRAFT_KEY,
  makeResearchRecord,
  readResearchHistory,
  parseResearchCheckpoint,
  type ResearchCheckpoint,
  type ResearchRecord,
} from '../lib/carrierResearchRecord'
import './CarrierOffsetExperiment.css'
import './CarrierResearchExperiment.css'

function initialState() {
  let historyText: string | null = null,
    draftText: string | null = null,
    records: ResearchRecord[] = [],
    checkpoint: ResearchCheckpoint | null = null,
    rejected = 0
  try {
    historyText = localStorage.getItem(RESEARCH_HISTORY_KEY)
    const h = readResearchHistory(historyText)
    records = h.records
    rejected += h.rejected
    draftText = localStorage.getItem(RESEARCH_DRAFT_KEY)
    if (draftText !== null) {
      if (draftText.length > 12_000_000) throw new Error('large checkpoint')
      checkpoint = parseResearchCheckpoint(JSON.parse(draftText))
    }
  } catch {
    rejected++
  }
  return { historyText, draftText, records, checkpoint, rejected }
}
const kindName: Record<PilotLayoutKind, string> = {
  uniform: '等距',
  shifted: '错位',
  paired: '成对',
}
const fmt = (n: number | null) =>
  n === null ? '不可用' : n === 0 ? '0' : n.toExponential(4)
function ResearchCharts({ summary }: { summary: ResearchSummary[] }) {
  const first = summary[0]
  return (
    <div className="carrier-plots">
      <figure>
        <figcaption>获取失败率（所有评估帧）</figcaption>
        <svg
          role="img"
          aria-label="研究获取失败率对照"
          viewBox={`0 0 600 ${60 + summary.length * 54}`}
        >
          {summary.map((row, n) => (
            <g key={row.id}>
              <text x="0" y={20 + n * 54}>
                {row.id}
              </text>
              {RESEARCH_METHODS.map((method, m) => (
                <g key={method}>
                  <rect
                    x="145"
                    y={5 + n * 54 + m * 20}
                    width={
                      (370 * row.methods[method].failures) /
                      row.methods[method].total
                    }
                    height="14"
                    className={`research-${method}`}
                  />
                  <text x="525" y={17 + n * 54 + m * 20}>
                    {method}{' '}
                    {Math.round(
                      (100 * row.methods[method].failures) /
                        row.methods[method].total,
                    )}
                    %
                  </text>
                </g>
              ))}
            </g>
          ))}
        </svg>
      </figure>
      <figure>
        <figcaption>
          接收端诊断 ROC：{first.id}（阈值越小，告警越多）
        </figcaption>
        <svg role="img" aria-label="研究诊断ROC" viewBox="0 0 600 270">
          <line x1="50" x2="550" y1="230" y2="230" />
          <line x1="50" x2="50" y1="20" y2="230" />
          <text x="430" y="260">
            误报率 FPR
          </text>
          <text x="5" y="15">
            检出率 TPR
          </text>
          {RESEARCH_METHODS.map((method) => (
            <polyline
              key={method}
              className={`research-line-${method}`}
              points={first.methods[method].roc
                .filter((p) => p.fpr !== null && p.tpr !== null)
                .map((p) => `${50 + 500 * p.fpr!},${230 - 210 * p.tpr!}`)
                .join(' ')}
            />
          ))}
          <text x="80" y="30">
            蓝：OLS，红：近似 ML；缺少任一真值类别时曲线不可定义
          </text>
        </svg>
      </figure>
    </div>
  )
}
export default function CarrierResearchExperiment() {
  const [plan, setPlan] = useState(defaultResearchPlan),
    [seed, setSeed] = useState('42'),
    [phase, setPhase] = useState('37'),
    [frequency, setFrequency] = useState('0.001')
  const [initial] = useState(initialState),
    [records, setRecords] = useState(initial.records),
    [checkpoint, setCheckpoint] = useState(initial.checkpoint),
    [selected, setSelected] = useState(initial.records[0]?.id ?? '')
  const [running, setRunning] = useState(false),
    [status, setStatus] = useState('等待确认研究方案。'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(
      initial.rejected
        ? '研究历史或检查点无法校验；保留原存储，新结果仅在内存，请导出。'
        : '',
    )
  const workerRef = useRef<Worker | null>(null),
    active = useRef<ResearchCheckpoint | null>(null),
    historyText = useRef(initial.historyText),
    draftText = useRef(initial.draftText),
    blocked = useRef(initial.rejected > 0)
  const record = records.find((r) => r.id === selected) ?? records[0],
    result = record?.result
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )
  function edit(patch: Partial<ResearchPlan>) {
    setPlan((p) => ({ ...p, ...patch }))
    setError('')
    setStatus('方案已修改，等待确认；已有记录保持原快照。')
  }
  function persistCheckpoint(c: ResearchCheckpoint) {
    setCheckpoint(c)
    try {
      if (blocked.current) return
      if (localStorage.getItem(RESEARCH_DRAFT_KEY) !== draftText.current) {
        setNotice('另一页面已修改研究检查点；保留原存储，本轮可导出检查点。')
        return
      }
      const text = JSON.stringify(c)
      localStorage.setItem(RESEARCH_DRAFT_KEY, text)
      draftText.current = text
    } catch {
      setNotice('检查点保存失败，保留内存结果，请导出检查点。')
    }
  }
  function cancel() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    if (active.current) persistCheckpoint(active.current)
    setStatus('研究已取消，保留检查点；尚无本轮完整统计区间。')
  }
  function start(resume?: ResearchCheckpoint) {
    if (workerRef.current) return
    setError('')
    try {
      if (!resume && [seed, phase, frequency].some((v) => !v.trim()))
        throw new Error('请填写全部研究参数。')
      const c = parseResearchCheckpoint(
        resume ?? {
          engineVersion: RESEARCH_ENGINE,
          plan: {
            ...plan,
            seed: Number(seed),
            phaseDeg: Number(phase),
            frequency: Number(frequency),
          },
          trials: [],
        },
      )
      validateResearchPlan(c.plan)
      const frozen = c.plan,
        prefix = [...c.trials],
        worker = new Worker(
          new URL('../workers/carrierResearch.worker.ts', import.meta.url),
          { type: 'module' },
        )
      active.current = c
      workerRef.current = worker
      setRunning(true)
      setStatus(
        `研究计算中：${prefix.length}/${20 + frozen.trials}，校准20帧，评估${frozen.trials}帧。`,
      )
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setRunning(false)
      }
      const fail = (message: string) => {
        finish()
        if (active.current) persistCheckpoint(active.current)
        setError(message)
        setStatus('研究计算失败，未生成本轮完整记录。')
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (workerRef.current !== worker) return
        try {
          const m = event.data
          if (!m || typeof m !== 'object' || !('type' in m))
            throw new Error('研究Worker消息无效。')
          if (m.type === 'error') {
            fail(
              'message' in m && typeof m.message === 'string'
                ? m.message
                : '研究Worker消息无效。',
            )
            return
          }
          if (m.type === 'trial') {
            if (
              !('completed' in m) ||
              !('total' in m) ||
              !('trial' in m) ||
              m.completed !== prefix.length + 1 ||
              m.total !== 20 + frozen.trials
            )
              throw new Error('研究Worker进度无效。')
            const next = parseResearchCheckpoint({
              engineVersion: RESEARCH_ENGINE,
              plan: frozen,
              trials: [...prefix, m.trial],
            })
            prefix.push(next.trials.at(-1)!)
            active.current = next
            setStatus(
              `研究计算中：${prefix.length}/${20 + frozen.trials}；${prefix.length <= 20 ? '校准' : '评估'}阶段。`,
            )
            return
          }
          if (
            m.type !== 'done' ||
            !('result' in m) ||
            prefix.length !== 20 + frozen.trials
          )
            throw new Error('研究Worker完成消息无效。')
          const completed = makeResearchRecord(
            m.result,
            crypto.randomUUID(),
            new Date().toISOString(),
          )
          if (
            JSON.stringify(completed.result.plan) !== JSON.stringify(frozen) ||
            JSON.stringify([
              ...completed.result.calibration,
              ...completed.result.evaluation,
            ]) !== JSON.stringify(prefix)
          )
            throw new Error('研究完成快照不符合冻结方案或已完成试验。')
          finish()
          active.current = null
          setCheckpoint(null)
          const next = [completed, ...records].slice(0, 2)
          setRecords(next)
          setSelected(completed.id)
          setStatus('研究完成：校准与评估分域，完整固定样本统计可导出。')
          try {
            if (blocked.current) return
            if (
              localStorage.getItem(RESEARCH_HISTORY_KEY) !== historyText.current
            ) {
              setNotice(
                '另一页面已修改研究历史；原存储保留，本轮仅在内存，请导出。',
              )
              return
            }
            const text = JSON.stringify(next)
            localStorage.setItem(RESEARCH_HISTORY_KEY, text)
            historyText.current = text
            if (
              localStorage.getItem(RESEARCH_DRAFT_KEY) === draftText.current
            ) {
              localStorage.removeItem(RESEARCH_DRAFT_KEY)
              draftText.current = null
            }
          } catch {
            setNotice('研究历史保存失败；结果仍在内存，请导出 JSON。')
          }
        } catch (cause) {
          fail(cause instanceof Error ? cause.message : '研究结果校验失败。')
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current === worker) {
          event.preventDefault()
          fail('研究后台计算失败，请重试或恢复检查点。')
        }
      }
      worker.onmessageerror = () => {
        if (workerRef.current === worker) fail('研究Worker消息无法解码。')
      }
      worker.postMessage(c)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setRunning(false)
      setError(cause instanceof Error ? cause.message : '无法启动研究。')
    }
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: 'application/json;charset=utf-8',
        }),
      ),
      a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  let operations: number | null = null
  try {
    operations = researchOperations(plan)
  } catch {
    /* An incomplete layout is validated at confirmation. */
  }
  return (
    <section
      className="carrier-experiment research-experiment"
      aria-labelledby="research-title"
    >
      <h2 id="research-title">载波恢复可靠性研究</h2>
      <p>
        v1.1：比较顺序展开 OLS 与复数导频相关峰搜索（近似
        ML）。每个布局内使用同一接收帧；跨布局固定绝对索引噪声与虚拟数据，另统计公共数据位置。研究允许负结果，不保证低
        SNR 恢复成功。
      </p>
      <p>
        等距频偏歧义周期为 1/L。一般导频位置的差值最大公约数为 g 时，周期为
        1/g；g=1 仅代表无噪声可辨识，不保证低 SNR 选对峰。纯 2π
        相位跳变在复数样本中不可观察；这里研究展开分支错误，不是硬件 PLL 周跳。
      </p>
      <fieldset className="signal-controls" disabled={running}>
        <legend>冻结研究协议后运行</legend>
        <div className="signal-parameters">
          <label>
            研究调制方式
            <select
              value={plan.modulation}
              onChange={(e) =>
                edit({
                  modulation: e.target.value as ResearchPlan['modulation'],
                })
              }
            >
              {MODULATIONS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            研究帧长
            <select
              value={plan.frameSymbols}
              onChange={(e) => edit({ frameSymbols: Number(e.target.value) })}
            >
              {[257, 513, 1025, 2049].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            研究 Eb/N0 (dB)
            <select
              value={plan.ebN0Db}
              onChange={(e) => edit({ ebN0Db: Number(e.target.value) })}
            >
              {COMPARISON_DB.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            研究评估次数
            <select
              value={plan.trials}
              onChange={(e) => edit({ trials: Number(e.target.value) })}
            >
              <option value="20">20（筛查）</option>
              <option value="200">200（确认）</option>
            </select>
          </label>
          <label>
            研究随机种子
            <input
              type="number"
              step="1"
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value)
                edit({})
              }}
            />
          </label>
          <label>
            研究真实初相位（度）
            <input
              type="number"
              step="any"
              value={phase}
              onChange={(e) => {
                setPhase(e.target.value)
                edit({})
              }}
            />
          </label>
          <label>
            研究真实频偏
            <input
              type="number"
              step="any"
              value={frequency}
              onChange={(e) => {
                setFrequency(e.target.value)
                edit({})
              }}
            />
          </label>
        </div>
        <fieldset className="research-layouts">
          <legend>
            同帧长导频布局（等距为基线；错位保持数量；成对增加短基线导频）
          </legend>
          {RESEARCH_LAYOUTS.flatMap((kind) =>
            [8, 16, 32, 64].map((spacing) => {
              const layout = { kind, spacing },
                id = researchLayoutId(layout),
                checked = plan.layouts.some((l) => researchLayoutId(l) === id)
              return (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      edit({
                        layouts: e.target.checked
                          ? [...plan.layouts, layout]
                          : plan.layouts.filter(
                              (l) => researchLayoutId(l) !== id,
                            ),
                      })
                    }
                  />
                  {`布局：${kindName[kind]} L${spacing}`}
                </label>
              )
            }),
          )}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={plan.noiseEnabled}
            onChange={(e) => edit({ noiseEnabled: e.target.checked })}
          />
          研究信道启用噪声
        </label>
        <p>
          每个方案先校准20帧，再独立评估。计划搜索乘加上界：
          {operations === null ? '请选择布局' : operations.toLocaleString()}
          ；浏览器限制5000万，另计帧生成/评价成本。超预算不会自动减少种子数，可用离线脚本分块运行。
        </p>
        <button type="button" onClick={() => start()}>
          确认研究方案并运行
        </button>
      </fieldset>
      {running && (
        <button type="button" onClick={cancel}>
          取消并保存研究检查点
        </button>
      )}
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p className="carrier-notice">{notice}</p>}
      {checkpoint && !running && (
        <div>
          <p>
            检查点：{checkpoint.trials.length}/{20 + checkpoint.plan.trials}{' '}
            帧，尚未生成完整区间；恢复使用检查点原方案。
          </p>
          <button type="button" onClick={() => start(checkpoint)}>
            恢复研究检查点
          </button>
          <button
            type="button"
            onClick={() =>
              download(checkpoint, 'SignalLab-research-checkpoint.json')
            }
          >
            导出研究检查点 JSON
          </button>
        </div>
      )}
      <p>
        独立本地保存最近两次完整研究与取消时的检查点；登录后也不上传。运行中直接关闭页面不保证保存最新进度。损坏/并发存储保留原文，保存失败仍可导出内存结果。
      </p>
      {records.length > 0 && (
        <>
          <label>
            研究实验历史
            <select
              value={record?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.completedAt} · {r.result.plan.modulation} ·{' '}
                  {r.result.plan.trials}帧
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              record && download(record, `SignalLab-research-${record.id}.json`)
            }
          >
            导出研究记录 JSON
          </button>
        </>
      )}
      {result && (
        <>
          <p>
            完成协议：{result.plan.modulation}，{result.plan.frameSymbols}
            符号，Eb/N0 {result.plan.ebN0Db}dB，相位{result.plan.phaseDeg}
            °，频偏{fmt(result.plan.frequency)}，基础种子{result.plan.seed}
            ，校准20帧 / 评估{result.plan.trials}
            帧。阈值只取校准成功帧残差的90%分位，不用评估真值选阈值；若无校准成功帧，诊断阈值不可用。
          </p>
          <p>
            获取成功预定义：有效估计、累计频偏误差≤1/8周、初相位圆周误差≤22.5°。这是事后评价，不是接收端可观察的成功信号。下面区间以整帧为试验单位、逐点95%，不构成多场景同时保证。
          </p>
          <div className="carrier-table">
            <table aria-label="研究导频资源">
              <caption>固定帧长下的导频开销与公共数据</caption>
              <thead>
                <tr>
                  <th>布局</th>
                  <th>导频数</th>
                  <th>g / 歧义周期</th>
                  <th>开销</th>
                  <th>数据位</th>
                  <th>公共数据位</th>
                  <th>整帧 / 数据能量</th>
                </tr>
              </thead>
              <tbody>
                {result.evaluation[0].arms.map((a) => (
                  <tr key={a.id}>
                    <th>{a.id}</th>
                    <td>{a.pilots}</td>
                    <td>
                      {a.gcd} / {fmt(1 / a.gcd)}
                    </td>
                    <td>{(a.overhead * 100).toFixed(2)}%</td>
                    <td>{a.raw.all.bits}</td>
                    <td>{a.raw.common.bits}</td>
                    <td>{(a.totalEnergy / a.dataEnergy).toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="carrier-table">
            <table aria-label="研究获取失败率与性能">
              <caption>
                完整评估样本：所有有效拟合的性能，失败不计为零误差
              </caption>
              <thead>
                <tr>
                  <th>布局 / 算法</th>
                  <th>获取失败 / 总帧</th>
                  <th>失败率95%区间</th>
                  <th>有效拟合</th>
                  <th>数据BER</th>
                  <th>公共BER</th>
                  <th>EVM RMS</th>
                  <th>频偏RMSE</th>
                  <th>相位RMSE(°)</th>
                  <th>频偏绝对误差P95</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.flatMap((row) =>
                  RESEARCH_METHODS.map((method) => {
                    const s = row.methods[method]
                    return (
                      <tr key={`${row.id}-${method}`}>
                        <th>
                          {row.id} / {method}
                        </th>
                        <td>
                          {s.failures} / {s.total}
                        </td>
                        <td>
                          [{fmt(s.failureInterval.lower)},{' '}
                          {fmt(s.failureInterval.upper)}]
                        </td>
                        <td>
                          {s.valid} / {s.total}
                        </td>
                        <td>{fmt(s.meanBer)}</td>
                        <td>{fmt(s.meanCommonBer)}</td>
                        <td>
                          {s.meanEvm === null
                            ? '不可用'
                            : (s.meanEvm * 100).toFixed(3) + '%'}
                        </td>
                        <td>{fmt(s.frequencyRmse)}</td>
                        <td>{fmt(s.phaseRmseDeg)}</td>
                        <td>{fmt(s.p95FrequencyError)}</td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="carrier-table">
            <table aria-label="研究误报漏报">
              <caption>
                冻结接收端告警阈值与事后标签（TP=检出获取失败，FP=成功但告警）
              </caption>
              <thead>
                <tr>
                  <th>布局 / 算法</th>
                  <th>阈值</th>
                  <th>接受帧 / 总帧</th>
                  <th>接受后条件BER</th>
                  <th>TP / FP / FN / TN</th>
                  <th>展开错误帧（oracle）</th>
                  <th>别名错误帧（oracle）</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.flatMap((row) =>
                  RESEARCH_METHODS.map((method) => {
                    const s = row.methods[method]
                    return (
                      <tr key={`${row.id}-${method}`}>
                        <th>
                          {row.id} / {method}
                        </th>
                        <td>{fmt(s.threshold)}</td>
                        <td>
                          {s.accepted ?? '不可用'} / {s.total}
                        </td>
                        <td>{fmt(s.acceptedMeanBer)}</td>
                        <td>
                          {s.confusion
                            ? `${s.confusion.tp} / ${s.confusion.fp} / ${s.confusion.fn} / ${s.confusion.tn}`
                            : '无法校准'}
                        </td>
                        <td>
                          {s.branchErrorFrames ?? '不使用展开'}
                          {s.branchInterval && (
                            <>
                              {' '}
                              / {s.branchLabelled} [
                              {fmt(s.branchInterval.lower)},{' '}
                              {fmt(s.branchInterval.upper)}]
                            </>
                          )}
                        </td>
                        <td>
                          {s.aliasErrorFrames} / {s.aliasLabelled}
                          {s.aliasInterval && (
                            <>
                              {' '}
                              [{fmt(s.aliasInterval.lower)},{' '}
                              {fmt(s.aliasInterval.upper)}]
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="carrier-table">
            <table>
              <caption>
                ML−OLS 公共数据位配对差（完整帧均值；EVM无高斯有界区间）
              </caption>
              <thead>
                <tr>
                  <th>布局</th>
                  <th>平均BER差</th>
                  <th>逐点95% Hoeffding界</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.map((row) => (
                  <tr key={row.id}>
                    <th>{row.id}</th>
                    <td>{fmt(row.pairedCommonBerDifference?.mean ?? null)}</td>
                    <td>
                      {row.pairedCommonBerDifference
                        ? row.pairedCommonBerDifference.interval
                            .map(fmt)
                            .join(' 至 ')
                        : '存在无效拟合，未给固定样本配对界'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ResearchCharts summary={result.summary} />
          <p>
            所有试验、种子、数值预算、拟合诊断、条件性能和失败原因均在 JSON
            中保留。零失败不意味着总体失败率为零；200帧零失败的一侧95%上界仍约1.49%。
          </p>
        </>
      )}
    </section>
  )
}
