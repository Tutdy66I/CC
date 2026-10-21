import { useEffect, useRef, useState } from 'react'
import { MODULATIONS } from '../lib/modulationComparison'
import {
  validateStatisticsRequest,
  type SeedSummary,
  type StatisticsMessage,
  type StatisticsRequest,
} from '../lib/seedStatistics'
import './SeedStatistics.css'

const number = (value: number | null) =>
  value === null ? '—' : value === 0 ? '0' : value.toExponential(4)
const colors = { BPSK: '#2289c4', QPSK: '#9152c9', '16QAM': '#b86b12' }

export default function SeedStatistics() {
  const [bits, setBits] = useState('65536')
  const [seed, setSeed] = useState('42')
  const [trials, setTrials] = useState('10')
  const [run, setRun] = useState<StatisticsRequest | null>(null)
  const [summaries, setSummaries] = useState<SeedSummary[]>([])
  const [status, setStatus] = useState<
    'idle' | 'running' | 'done' | 'cancelled' | 'error'
  >('idle')
  const [error, setError] = useState('')
  const workerRef = useRef<Worker | null>(null)
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )
  const running = status === 'running'
  const completed = summaries.reduce((sum, item) => sum + item.completed, 0)
  const total = (run?.trials ?? Number(trials)) * 30
  function stop() {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('cancelled')
  }
  function start() {
    workerRef.current?.terminate()
    workerRef.current = null
    setRun(null)
    setSummaries([])
    setError('')
    try {
      if (!seed.trim()) throw new Error('请输入统计基础种子。')
      const request = {
        bits: Number(bits),
        seed: Number(seed),
        trials: Number(trials),
      }
      validateStatisticsRequest(request)
      const worker = new Worker(
        new URL('../workers/seedStatistics.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRun(request)
      setStatus('running')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
      }
      worker.onmessage = (event: MessageEvent<StatisticsMessage>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (message.type === 'summary') {
          setSummaries((previous) => {
            const index = previous.findIndex(
              (p) =>
                p.modulation === message.summary.modulation &&
                p.ebN0Db === message.summary.ebN0Db,
            )
            if (index < 0) return [...previous, message.summary]
            return previous.map((p, i) => (i === index ? message.summary : p))
          })
        } else {
          finish()
          setStatus(message.type === 'done' ? 'done' : 'error')
          if (message.type === 'error') setError(message.message)
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        finish()
        setStatus('error')
        setError('多种子统计后台计算失败，请重试。')
      }
      worker.postMessage(request)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setStatus('error')
      setError(cause instanceof Error ? cause.message : '无法启动统计。')
    }
  }
  function download() {
    if (!run) return
    const rows = [
      [
        'SignalLab v0.7 seed statistics',
        `status=${status}`,
        `bits=${run.bits}`,
        `baseSeed=${run.seed}`,
        `plannedTrials=${run.trials}`,
      ],
      ['seed=(base+trial*10+snrIndex) mod 2^32; zero-based indices'],
      [
        'SD is seed spread; final pointwise 95% Hoeffding bounds assume independent 64-bit noise blocks; not simultaneous; PRNG approximation',
      ],
      [
        'modulation',
        'EbN0_dB',
        'completed',
        'totalBits',
        'totalErrors',
        'meanBER',
        'minBER',
        'maxBER',
        'sampleSD',
        'theoreticalBER',
        'lower95',
        'upper95',
      ],
      ...summaries.map((p) => [
        p.modulation,
        p.ebN0Db,
        p.completed,
        p.totalBits,
        p.totalErrors,
        p.meanBer,
        p.minBer,
        p.maxBer,
        p.sampleSd ?? '',
        p.theoretical,
        ...(p.interval ?? ['', '']),
      ]),
    ]
    const csv =
      '\ufeff' +
      rows
        .map((row) =>
          row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','),
        )
        .join('\r\n')
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `SignalLab-statistics-${run.seed}.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section className="seed-statistics" aria-labelledby="statistics-title">
      <h2 id="statistics-title">多种子 BER 统计验证</h2>
      <p>
        独立重复相同的完整星座比特流，比较均值与种子间波动。三种调制配对共用种子，BPSK/QPSK
        实测重合；跨调制结果并非独立样本。
      </p>
      <div className="signal-controls">
        <div className="signal-parameters">
          <label htmlFor="statistics-bits">
            统计每次比特数
            <select
              id="statistics-bits"
              value={bits}
              disabled={running}
              onChange={(e) => setBits(e.target.value)}
            >
              {[16384, 65536, 131072].map((count) => (
                <option key={count} value={count}>
                  {count.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="statistics-trials">
            统计重复次数
            <select
              id="statistics-trials"
              value={trials}
              disabled={running}
              onChange={(e) => setTrials(e.target.value)}
            >
              {[5, 10, 20].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="statistics-seed">
            统计基础种子
            <input
              id="statistics-seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              disabled={running}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
        </div>
        <div className="signal-sweep-actions">
          <button type="button" disabled={running} onClick={start}>
            开始多种子统计
          </button>
          {running && (
            <button type="button" onClick={stop}>
              取消多种子统计
            </button>
          )}
          <button
            type="button"
            disabled={!summaries.length || running}
            onClick={download}
          >
            导出统计 CSV
          </button>
        </div>
      </div>
      <p role="status">
        {status === 'idle'
          ? '尚未运行统计。'
          : `统计${status === 'running' ? '计算中' : status === 'done' ? '完成' : status === 'cancelled' ? '已取消' : '失败'}：${completed}/${total} 次调制试验`}
      </p>
      {running && (
        <progress aria-label="多种子统计进度" value={completed} max={total} />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {run && (
        <p>
          本次每次 {run.bits.toLocaleString()} 比特，预定 {run.trials}{' '}
          次，基础种子 {run.seed}。第 j 次、第 i 个信噪比种子=(基础种子+j×10+i)
          mod 2³²，i/j 均从 0 起。
        </p>
      )}
      <figure className="signal-chart">
        <figcaption>平均 BER 与种子间最小/最大值（竖线），线性纵轴</figcaption>
        <div
          className="comparison-scroll"
          tabIndex={0}
          role="region"
          aria-label="多种子均值曲线，可横向滚动"
        >
          <svg
            viewBox="0 0 800 300"
            role="img"
            aria-label="蓝色 BPSK、紫色虚线 QPSK、橙色 16QAM；竖线表示样本极差，不是置信区间"
          >
            {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((value) => (
              <g key={value}>
                <line
                  x1="60"
                  x2="750"
                  y1={255 - 460 * value}
                  y2={255 - 460 * value}
                  className="signal-axis"
                />
                <text x="12" y={260 - 460 * value}>
                  {value.toFixed(1)}
                </text>
              </g>
            ))}
            {[-4, -2, 0, 2, 4, 6, 8, 10, 12, 14].map((db) => (
              <text key={db} x={60 + (db + 4) * 38 - 6} y="275">
                {db}
              </text>
            ))}
            <text x="355" y="296">
              Eb/N0 (dB)
            </text>
            {MODULATIONS.map((modulation) => {
              const series = summaries.filter(
                (p) => p.modulation === modulation,
              )
              return (
                <g
                  key={modulation}
                  stroke={colors[modulation]}
                  fill={colors[modulation]}
                >
                  <polyline
                    fill="none"
                    strokeWidth="2"
                    strokeDasharray={modulation === 'QPSK' ? '6 4' : undefined}
                    points={series
                      .map(
                        (p) =>
                          `${60 + (p.ebN0Db + 4) * 38},${255 - 460 * p.meanBer}`,
                      )
                      .join(' ')}
                  />
                  {series.map((p) => (
                    <g key={p.ebN0Db}>
                      <title>{`${modulation} ${p.ebN0Db} dB，${p.completed} 次，平均 BER ${p.meanBer}`}</title>
                      <line
                        x1={60 + (p.ebN0Db + 4) * 38}
                        x2={60 + (p.ebN0Db + 4) * 38}
                        y1={255 - 460 * p.maxBer}
                        y2={255 - 460 * p.minBer}
                      />
                      <circle
                        cx={60 + (p.ebN0Db + 4) * 38}
                        cy={255 - 460 * p.meanBer}
                        r="3"
                      />
                    </g>
                  ))}
                </g>
              )
            })}
          </svg>
        </div>
      </figure>
      {summaries.length > 0 && (
        <div
          className="comparison-scroll"
          tabIndex={0}
          role="region"
          aria-label="多种子统计数据，可横向滚动"
        >
          <table>
            <caption>
              仅含实际完成试验；标准差描述种子波动，区间仅对完成预定次数的行显示
            </caption>
            <thead>
              <tr>
                {[
                  '调制',
                  'Eb/N0 (dB)',
                  '已完成次数',
                  '总误码数',
                  '平均 BER',
                  '最小 BER',
                  '最大 BER',
                  '样本标准差',
                  '理论 BER',
                  '逐点 95% 保守区间',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map((p) => (
                <tr key={`${p.modulation}-${p.ebN0Db}`}>
                  <th scope="row">{p.modulation}</th>
                  <td>{p.ebN0Db}</td>
                  <td>{p.completed}</td>
                  <td>{p.totalErrors}</td>
                  <td>{number(p.meanBer)}</td>
                  <td>{number(p.minBer)}</td>
                  <td>{number(p.maxBer)}</td>
                  <td>{number(p.sampleSd)}</td>
                  <td>{number(p.theoretical)}</td>
                  <td>
                    {p.interval
                      ? `[${number(p.interval[0])}, ${number(p.interval[1])}]`
                      : '等待完整重复次数'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <aside className="signal-notes">
        <h3>统计解释与限制</h3>
        <p>
          均值=总误码数/总比特数；每次长度相同。样本标准差以 n−1
          为分母，不是均值置信区间。一次完整的 64 比特周期作为 [0,1]
          有界误码比例样本，允许同符号内比特相关；N=总比特数/64，Hoeffding
          半宽=√(ln(40)/(2N))，裁剪至 [0,1]。
        </p>
        <p>
          逐点 95%
          保守区间假定不同块的理想噪声独立；确定性伪随机种子只是该模型的近似，换种子不构成独立性的证明。区间不是整条曲线的同时置信带，低
          BER
          时可能很宽。仅在预定重复全部完成时显示，不对提前取消的未完成行作固定样本置信声明。零误码仍有正上界；极差也不是置信区间。
        </p>
      </aside>
    </section>
  )
}
