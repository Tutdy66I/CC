import { useEffect, useRef, useState } from 'react'
import {
  COMPARISON_DB,
  MODULATIONS,
  type Modulation,
} from '../lib/modulationComparison'
import {
  defaultEstimationPlan,
  validateEstimationPlan,
  type EstimationPlan,
  type EstimationPreview,
} from '../lib/carrierEstimation'
import {
  ESTIMATION_HISTORY_KEY,
  makeEstimationRecord,
  readEstimationRecords,
  type EstimationRecord,
} from '../lib/carrierEstimationRecord'
import { wrapPhase } from '../lib/pilotEstimator'
import './CarrierOffsetExperiment.css'
import './CarrierEstimationExperiment.css'

function initialHistory() {
  try {
    const text = localStorage.getItem(ESTIMATION_HISTORY_KEY)
    return { ...readEstimationRecords(text), text }
  } catch {
    return { records: [], rejected: 1, text: null }
  }
}
const numericKeys = [
  'ebN0Db',
  'phaseDeg',
  'frequency',
  'spacing',
  'pilots',
  'seed',
] as const
type Fields = Record<(typeof numericKeys)[number], string>
function fieldsFor(p: EstimationPlan): Fields {
  return {
    ebN0Db: String(p.ebN0Db),
    phaseDeg: String(p.phaseDeg),
    frequency: String(p.frequency),
    spacing: String(p.spacing),
    pilots: String(p.pilots),
    seed: String(p.seed),
  }
}
const format = (n: number | null) =>
  n === null ? '不可用' : n === 0 ? '0' : n.toExponential(5)
function Constellation({
  samples,
  title,
  scale,
}: {
  samples: EstimationPreview[]
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
          蓝：数据参考；红：接收；共同轴 ±{scale.toFixed(2)}
        </text>
      </svg>
    </figure>
  )
}
function PhasePlot({
  title,
  values,
  reference,
}: {
  title: string
  values: { index: number; value: number }[]
  reference?: number[]
}) {
  const all = [...values.map((p) => p.value), ...(reference ?? [])],
    low = Math.min(0, ...all),
    high = Math.max(1, ...all),
    span = high - low
  const x = (n: number) => 40 + (520 * n) / (values.at(-1)?.index || 1),
    y = (v: number) => 170 - (140 * (v - low)) / span
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <svg viewBox="0 0 600 210" role="img" aria-label={title}>
        <line x1="40" x2="560" y1="170" y2="170" />
        <text x="5" y="24">
          {high.toFixed(1)}
        </text>
        <text x="5" y="170">
          {low.toFixed(1)}
        </text>
        <polyline
          points={values.map((p) => `${x(p.index)},${y(p.value)}`).join(' ')}
        />
        {reference && (
          <polyline
            className="estimation-fit"
            points={values
              .map((p, m) => `${x(p.index)},${y(reference[m])}`)
              .join(' ')}
          />
        )}
        <text x="40" y="195">
          0
        </text>
        <text x="400" y="195">
          符号索引 {values.at(-1)?.index}
        </text>
      </svg>
    </figure>
  )
}
export default function CarrierEstimationExperiment() {
  const [fields, setFields] = useState(() => fieldsFor(defaultEstimationPlan()))
  const [modulation, setModulation] = useState<Modulation>('QPSK'),
    [noiseEnabled, setNoiseEnabled] = useState(true)
  const [initial] = useState(initialHistory),
    [records, setRecords] = useState<EstimationRecord[]>(initial.records)
  const [selected, setSelected] = useState(initial.records[0]?.id ?? ''),
    [running, setRunning] = useState(false)
  const [status, setStatus] = useState('等待确认估计方案；尚未运行。'),
    [error, setError] = useState('')
  const [notice, setNotice] = useState(
    initial.rejected
      ? '估计历史无法校验；原始存储保留，新结果仅在内存，请导出。'
      : '',
  )
  const workerRef = useRef<Worker | null>(null),
    storageText = useRef(initial.text),
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
  function changed() {
    setError('')
    setStatus('方案已修改，等待确认；已有结果仍为原完成快照。')
  }
  function cancel() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setStatus('估计实验已取消，未生成本轮记录。')
  }
  function start() {
    if (workerRef.current) return
    setError('')
    try {
      if (numericKeys.some((k) => !fields[k].trim()))
        throw new Error('请输入所有估计参数，不能留空。')
      const plan = structuredClone({
        modulation,
        noiseEnabled,
        ...Object.fromEntries(numericKeys.map((k) => [k, Number(fields[k])])),
      })
      validateEstimationPlan(plan)
      const frozen: EstimationPlan = plan
      const worker = new Worker(
        new URL('../workers/carrierEstimation.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRunning(true)
      setStatus('载波估计计算中，使用同批接收样本…')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setRunning(false)
      }
      const fail = (message: string) => {
        finish()
        setError(message)
        setStatus('估计计算失败，未生成本轮记录。')
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        try {
          if (!message || typeof message !== 'object' || !('type' in message))
            throw new Error('估计 Worker 返回无效消息。')
          if (message.type === 'error') {
            fail(
              'message' in message && typeof message.message === 'string'
                ? message.message
                : '估计 Worker 返回无效消息。',
            )
            return
          }
          if (message.type !== 'done' || !('result' in message))
            throw new Error('估计 Worker 返回无效消息。')
          // Validate the unknown result before it can enter UI/history.
          const completed = makeEstimationRecord(
            frozen,
            message.result,
            crypto.randomUUID(),
            new Date().toISOString(),
          )
          finish()
          const next = [completed, ...records].slice(0, 5)
          setRecords(next)
          setSelected(completed.id)
          setStatus('估计实验完成；三路结果来自同批接收样本。')
          try {
            if (blocked.current) return
            if (
              localStorage.getItem(ESTIMATION_HISTORY_KEY) !==
              storageText.current
            ) {
              blocked.current = true
              setNotice(
                '另一页面已修改估计历史；保留原存储，本轮仅在内存，请导出并刷新。',
              )
              return
            }
            const text = JSON.stringify(next)
            localStorage.setItem(ESTIMATION_HISTORY_KEY, text)
            storageText.current = text
          } catch {
            setNotice('估计历史保存失败；结果仍在内存，请导出 JSON。')
          }
        } catch (cause) {
          fail(cause instanceof Error ? cause.message : '估计结果校验失败。')
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        fail('估计后台计算失败，请重试。')
      }
      worker.onmessageerror = () => {
        if (workerRef.current === worker) fail('估计 Worker 消息无法解码。')
      }
      worker.postMessage(frozen)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setRunning(false)
      setError(cause instanceof Error ? cause.message : '无法启动估计实验。')
    }
  }
  function download() {
    if (!record) return
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(record, null, 2)], {
          type: 'application/json;charset=utf-8',
        }),
      ),
      a = document.createElement('a')
    a.href = url
    a.download = `SignalLab-estimation-${record.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const scale =
    Math.max(
      2.5,
      ...[
        ...(result?.raw.preview ?? []),
        ...(result?.estimated?.preview ?? []),
        ...(result?.ideal.preview ?? []),
      ].flatMap((p) => [Math.abs(p.i), Math.abs(p.q)]),
    ) * 1.1
  const fit = result?.fit.status === 'ok' ? result.fit : null
  return (
    <section
      className="carrier-experiment estimation-experiment"
      aria-labelledby="estimation-title"
    >
      <h2 id="estimation-title">载波估计与恢复实验</h2>
      <p>
        v1.0：公开导频去调制 → 相位展开 →
        线性最小二乘。估计器只读取含噪导频；真实偏移仅用于信道、理想参考和事后误差评价。
      </p>
      <p>
        等间距导频 n=mL，无歧义范围严格为 |ε| &lt;
        1/(2L)。边界、低信噪比可能发生周跳；诊断通过也不保证恢复正确。理想同步是性能参考，不保证每次有限样本的
        BER/EVM 都最小。
      </p>
      <fieldset className="signal-controls" disabled={running}>
        <legend>确认导频估计方案</legend>
        <div className="signal-parameters">
          <label>
            估计调制方式
            <select
              value={modulation}
              onChange={(e) => {
                setModulation(e.target.value as Modulation)
                changed()
              }}
            >
              {MODULATIONS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            估计 Eb/N0 (dB)
            <select
              value={fields.ebN0Db}
              onChange={(e) => {
                setFields({ ...fields, ebN0Db: e.target.value })
                changed()
              }}
            >
              {COMPARISON_DB.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          {(
            [
              ['phaseDeg', '估计真实初相位（度）'],
              ['frequency', '估计真实频偏（cycles/symbol）'],
              ['spacing', '导频间距 L（符号）'],
              ['pilots', '导频数量 P'],
              ['seed', '估计随机种子'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step={['spacing', 'pilots', 'seed'].includes(key) ? '1' : 'any'}
                value={fields[key]}
                onChange={(e) => {
                  setFields({ ...fields, [key]: e.target.value })
                  changed()
                }}
              />
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={noiseEnabled}
            onChange={(e) => {
              setNoiseEnabled(e.target.checked)
              changed()
            }}
          />
          估计信道启用噪声
        </label>
        <p>
          L=2–128，P=8–1024。首尾为导频，N=(P−1)L+1≤131072；导频间为数据。Eb/N0
          按数据位 Eb=1 定义，插入导频不降低噪声。
        </p>
        <p>
          固定导频：BPSK 为 1，QPSK 为 1+j，16QAM 为
          √2+j√2（公开训练符号，不属于数据星座）；导频能量等于该调制的平均数据符号能量。
        </p>
        <button type="button" onClick={start}>
          确认估计方案并运行
        </button>
      </fieldset>
      {running && (
        <button type="button" onClick={cancel}>
          取消估计实验
        </button>
      )}
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p className="carrier-notice">{notice}</p>}
      <p>
        独立本地保存最近五次完整实验，可导出
        JSON；登录后也不上传，不改写旧版历史。
      </p>
      {records.length > 0 && (
        <>
          <label>
            估计实验历史
            <select
              value={record?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.completedAt} · {r.plan.modulation} · seed {r.plan.seed}
                </option>
              ))}
            </select>
          </label>
          <div className="signal-actions">
            <button type="button" onClick={download}>
              导出估计记录 JSON
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => {
                if (record) {
                  setFields(fieldsFor(record.plan))
                  setModulation(record.plan.modulation)
                  setNoiseEnabled(record.plan.noiseEnabled)
                  changed()
                }
              }}
            >
              载入估计历史方案
            </button>
          </div>
        </>
      )}
      {record && result && (
        <>
          <p>
            完成快照：{record.plan.modulation}，Eb/N0 {record.plan.ebN0Db}{' '}
            dB，种子 {record.plan.seed}，L={record.plan.spacing}，P=
            {record.plan.pilots}，噪声
            {record.plan.noiseEnabled ? '开启' : '关闭'}。总符号{' '}
            {result.totalSymbols}，数据位 {result.dataBits}，导频开销{' '}
            {(result.overhead * 100).toFixed(2)}%。
          </p>
          <p>
            实际整帧能量 / 数据参考能量 = {result.payloadEnergyRatio.toFixed(5)}
            ；含导频的每载荷位能量 ={' '}
            {(
              (result.dataEnergy * result.payloadEnergyRatio) /
              result.dataBits
            ).toFixed(5)}
            。BER/EVM 只统计数据；EVM
            使用原始发送参考能量，不额外拟合增益/相位。
          </p>
          <div className="carrier-table">
            <table>
              <caption>真实值与导频估计值（完成快照）</caption>
              <thead>
                <tr>
                  <th>参数</th>
                  <th>真实</th>
                  <th>估计</th>
                  <th>估计−真实</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>初相位（度）</th>
                  <td>{record.plan.phaseDeg}</td>
                  <td>{format(fit ? (fit.phaseRad * 180) / Math.PI : null)}</td>
                  <td>{format(result.phaseErrorDeg)}（圆周差）</td>
                </tr>
                <tr>
                  <th>频偏（cycles/symbol）</th>
                  <td>{format(record.plan.frequency)}</td>
                  <td>{format(fit?.frequency ?? null)}</td>
                  <td>{format(result.frequencyError)}（直接差）</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            此快照无歧义范围：|ε| &lt; {format(1 / (2 * record.plan.spacing))}{' '}
            cycles/symbol；初相位仅模 360° 可辨识。
          </p>
          {result.outsideRange && (
            <p className="carrier-notice">
              真实频偏超出或位于无歧义范围边界：等间距导频无法区分相差 1/L
              的频偏。此提示使用事后真值，不参与估计。
            </p>
          )}
          {fit ? (
            <>
              <p>
                导频残差 RMS {format(fit.residualRms)} rad；最小归一化幅度{' '}
                {format(fit.minMagnitude)}；最大相邻增量{' '}
                {format(fit.maxIncrement)} rad；展开边界裕量{' '}
                {format(fit.boundaryMargin)} rad。
              </p>
              <p className="carrier-notice">
                {fit.warnings.length
                  ? fit.warnings.join(' ')
                  : '启发式诊断未触发警告；这不能证明正确锁定或排除周跳。'}
              </p>
            </>
          ) : (
            <p className="carrier-notice">
              {result.fit.status === 'failed' ? result.fit.reason : ''}{' '}
              估计补偿不可用，没有回退到真值。
            </p>
          )}
          <div className="carrier-table">
            <table>
              <caption>同一接收帧的数据 BER / EVM 对照</caption>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>错误位 / 数据位</th>
                  <th>BER</th>
                  <th>EVM RMS</th>
                  <th>BER−无补偿</th>
                  <th>EVM−无补偿</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['无补偿', result.raw],
                    ['估计补偿', result.estimated],
                    ['理想补偿', result.ideal],
                  ] as const
                ).map(([label, m]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{m ? `${m.errors} / ${result.dataBits}` : '不可用'}</td>
                    <td>{format(m?.ber ?? null)}</td>
                    <td>{m ? `${(100 * m.evmRms).toFixed(4)}%` : '不可用'}</td>
                    <td>{format(m ? m.ber - result.raw.ber : null)}</td>
                    <td>{format(m ? m.evmRms - result.raw.evmRms : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            单次结果不能作为普遍保证。频偏误差随索引累积，相位误差则使星座整体旋转；两者共同影响
            BER/EVM，且 BER 还取决于判决边界与噪声方向。
          </p>
          <div className="carrier-plots estimation-constellations">
            <Constellation
              title="无补偿数据星座"
              samples={result.raw.preview}
              scale={scale}
            />
            <Constellation
              title="估计补偿数据星座"
              samples={result.estimated?.preview ?? []}
              scale={scale}
            />
            <Constellation
              title="理想补偿数据星座"
              samples={result.ideal.preview}
              scale={scale}
            />
          </div>
          <p>
            三图显示相同的最多128个分层抽样数据位置，全部数据用于统计；不包含导频点。误差图也使用这些数据位置，避免只看导频而隐藏混叠。
          </p>
          {fit && (
            <div className="carrier-plots">
              <PhasePlot
                title="导频展开相位与拟合（rad，蓝：观测，红：拟合）"
                values={fit.phases.map((p) => ({
                  index: p.index,
                  value: p.phase,
                }))}
                reference={fit.phases.map((p) => p.fitted)}
              />
              <PhasePlot
                title="剩余相位误差（rad，使用事后真值，圆周差）"
                values={result.raw.preview.map((p) => ({
                  index: p.index,
                  value: wrapPhase(
                    (record.plan.phaseDeg * Math.PI) / 180 -
                      fit.phaseRad +
                      2 *
                        Math.PI *
                        (record.plan.frequency - fit.frequency) *
                        p.index,
                  ),
                }))}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
