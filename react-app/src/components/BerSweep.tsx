import { useEffect, useRef, useState } from 'react'
import AiTutor from './AiTutor'
import {
  SWEEP_DB,
  theoreticalBpskBer,
  validateSweepRequest,
  type BerPoint,
  type SweepMessage,
  type SweepRequest,
} from '../lib/berSweep'
import './BerSweep.css'

const formatRate = (value: number) =>
  value === 0 ? '0' : value.toExponential(3)
const theory = Array.from({ length: 113 }, (_, index) => {
  const db = -4 + index / 8
  return { db, ber: theoreticalBpskBer(db) }
})

function BerChart({ points }: { points: BerPoint[] }) {
  const x = (db: number) => 65 + ((db + 4) / 14) * 660
  const y = (ber: number) => 25 - (Math.log10(Math.max(1e-7, ber)) / 7) * 280
  const measuredPath = points
    .map((point, index) => {
      if (point.ber === 0) return ''
      const command = index > 0 && points[index - 1].ber > 0 ? 'L' : 'M'
      return `${command}${x(point.ebN0Db)},${y(point.ber)}`
    })
    .join(' ')
  return (
    <figure className="signal-chart signal-ber-chart">
      <figcaption>BER 与 Eb/N0 · 对数纵轴</figcaption>
      <div
        className="signal-ber-scroll"
        tabIndex={0}
        role="region"
        aria-label="BER 曲线，可横向滚动"
      >
        <svg
          viewBox="0 0 800 355"
          role="img"
          aria-label="相干 BPSK 理论 BER、实测 BER、逐点置信区间和零误码上限；详细数据见下表"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <g key={index}>
              <line
                x1="65"
                x2="725"
                y1={25 + index * 40}
                y2={25 + index * 40}
                className="signal-axis"
              />
              <text x="5" y={30 + index * 40}>
                1e−{index}
              </text>
            </g>
          ))}
          {SWEEP_DB.map((db) => (
            <text key={db} x={x(db) - 8} y="327">
              {db}
            </text>
          ))}
          <text x="355" y="349">
            Eb/N0 (dB)
          </text>
          <polyline
            points={theory
              .map((point) => `${x(point.db)},${y(point.ber)}`)
              .join(' ')}
            fill="none"
            className="signal-carrier"
            strokeDasharray="6 4"
            strokeWidth="2"
          />
          <path
            d={measuredPath}
            fill="none"
            className="signal-samples"
            strokeWidth="2"
          />
          {points.map((point) => (
            <g key={point.ebN0Db} className="signal-ber-point">
              <title>{`${point.ebN0Db} dB：${point.errors}/${point.bits} 误码，BER=${formatRate(point.ber)}，${point.errors === 0 ? '单侧95%上限' : '双侧95% Wilson区间'} [${formatRate(point.interval.lower)}, ${formatRate(point.interval.upper)}]`}</title>
              {point.errors === 0 ? (
                <path
                  d={`M${x(point.ebN0Db) - 6},${y(point.interval.upper) - 5} L${x(point.ebN0Db) + 6},${y(point.interval.upper) - 5} L${x(point.ebN0Db)},${y(point.interval.upper) + 5} Z`}
                />
              ) : (
                <>
                  <line
                    x1={x(point.ebN0Db)}
                    x2={x(point.ebN0Db)}
                    y1={y(point.interval.lower)}
                    y2={y(point.interval.upper)}
                  />
                  <line
                    x1={x(point.ebN0Db) - 4}
                    x2={x(point.ebN0Db) + 4}
                    y1={y(point.interval.lower)}
                    y2={y(point.interval.lower)}
                  />
                  <line
                    x1={x(point.ebN0Db) - 4}
                    x2={x(point.ebN0Db) + 4}
                    y1={y(point.interval.upper)}
                    y2={y(point.interval.upper)}
                  />
                  <circle cx={x(point.ebN0Db)} cy={y(point.ber)} r="4" />
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p>
        紫色虚线：理论值；蓝色圆点及竖线：实测值及双侧 95% Wilson
        区间；向下三角：零误码的单侧 95% 上限，不接入实测折线。
      </p>
    </figure>
  )
}

export default function BerSweep() {
  const [bits, setBits] = useState('100000')
  const [seed, setSeed] = useState('42')
  const [status, setStatus] = useState<
    'idle' | 'running' | 'done' | 'cancelled' | 'error'
  >('idle')
  const [points, setPoints] = useState<BerPoint[]>([])
  const [run, setRun] = useState<SweepRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const running = status === 'running'

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  function stop() {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('cancelled')
  }

  function start() {
    workerRef.current?.terminate()
    workerRef.current = null
    setPoints([])
    setRun(null)
    setError(null)
    try {
      if (!seed.trim()) throw new Error('请输入扫描种子。')
      const request = { bits: Number(bits), seed: Number(seed) }
      validateSweepRequest(request)
      const worker = new Worker(
        new URL('../workers/berSweep.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRun(request)
      setStatus('running')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
      }
      worker.onmessage = (event: MessageEvent<SweepMessage>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (message.type === 'point') {
          setPoints((previous) => [...previous, message.point])
        } else if (message.type === 'done') {
          finish()
          setStatus('done')
        } else {
          finish()
          setError(message.message)
          setStatus('error')
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return
        event.preventDefault()
        finish()
        setError('后台计算失败，请重试。')
        setStatus('error')
      }
      worker.postMessage(request)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setError(cause instanceof Error ? cause.message : '无法启动扫描。')
      setStatus('error')
    }
  }

  return (
    <section className="signal-sweep" aria-labelledby="signal-sweep-title">
      <h2 id="signal-sweep-title">BER 曲线实验</h2>
      <p>
        扫描 −4 到 10 dB，步长 2 dB。每点发送交替 01
        比特流，与上方手动输入独立；计算在后台运行。
      </p>
      <div className="signal-controls">
        <div className="signal-parameters">
          <label htmlFor="sweep-bits">
            每点比特数
            <select
              id="sweep-bits"
              value={bits}
              disabled={running}
              onChange={(event) => setBits(event.target.value)}
            >
              <option value="10000">10,000</option>
              <option value="100000">100,000</option>
              <option value="1000000">1,000,000</option>
            </select>
          </label>
          <label htmlFor="sweep-seed">
            扫描基础种子
            <input
              id="sweep-seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              disabled={running}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
        </div>
        <div className="signal-sweep-actions">
          <button type="button" disabled={running} onClick={start}>
            开始 BER 扫描
          </button>
          {running && (
            <button type="button" onClick={stop}>
              取消扫描
            </button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite">
        {status === 'idle' && '尚未运行，当前只显示理论曲线。'}
        {status === 'running' &&
          `计算中：${points.length}/${SWEEP_DB.length} 点`}
        {status === 'done' &&
          `扫描完成：${points.length}/${SWEEP_DB.length} 点`}
        {status === 'cancelled' &&
          `已取消：保留 ${points.length}/${SWEEP_DB.length} 个已完成点。`}
        {status === 'error' &&
          `扫描失败：已完成 ${points.length}/${SWEEP_DB.length} 点。`}
      </p>
      {running && (
        <progress
          value={points.length}
          max={SWEEP_DB.length}
          aria-label="BER 扫描进度"
        />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {run && (
        <p>
          本次参数：每点 {run.bits.toLocaleString()} 比特，基础种子 {run.seed}
          。第 i 点种子 = (基础种子 + i) mod 2³²，i 从 0 开始。
        </p>
      )}
      <BerChart points={points} />
      <AiTutor
        context={
          run
            ? {
                experiment: 'BER',
                data: { modulation: 'BPSK', status, run, points },
              }
            : null
        }
      />
      {points.length > 0 && (
        <div
          className="signal-ber-scroll"
          role="region"
          tabIndex={0}
          aria-label="BER 原始数据，可横向滚动"
        >
          <table className="signal-ber-table">
            <caption>
              本次扫描原始数据（区间为逐点 95%，不是整条曲线的同时置信带）
            </caption>
            <thead>
              <tr>
                <th scope="col">Eb/N0 (dB)</th>
                <th scope="col">种子</th>
                <th scope="col">比特数</th>
                <th scope="col">误码数</th>
                <th scope="col">实测 BER</th>
                <th scope="col">理论 BER</th>
                <th scope="col">统计区间 / 上限</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.ebN0Db}>
                  <th scope="row">{point.ebN0Db}</th>
                  <td>{point.seed}</td>
                  <td>{point.bits.toLocaleString()}</td>
                  <td>{point.errors}</td>
                  <td>{formatRate(point.ber)}</td>
                  <td>{formatRate(point.theoretical)}</td>
                  <td>
                    {point.interval.kind === 'zero-upper'
                      ? `零误码，单侧95%上限 ≤ ${formatRate(point.interval.upper)}`
                      : `双侧95% Wilson：[${formatRate(point.interval.lower)}, ${formatRate(point.interval.upper)}]`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        理论 BER = ½·erfc(√(10^(Eb/N0[dB]/10)))，假设相干检测、理想同步和
        AWGN。零误码的单侧 95% 上限为 1 − 0.05^(1/N)，不表示真实 BER
        为零。有限样本的曲线可能波动，增加样本量可提高精度。
      </p>
      <p>
        公式参考：
        <a href="https://www.mathworks.com/help/comm/ug/analytical-expressions-used-in-berawgn-function-and-bit-error-rate-analysis-app.html">
          MathWorks BPSK 理论
        </a>{' '}
        ·{' '}
        <a href="https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm">
          NIST 二项比例区间
        </a>
      </p>
    </section>
  )
}
