import { useEffect, useRef, useState } from 'react'
import {
  COMPARISON_DB,
  MODULATIONS,
  validateComparisonRequest,
  type ComparisonPoint,
  type ComparisonMessage,
} from '../lib/modulationComparison'
import { theoreticalBpskBer, type SweepRequest } from '../lib/berSweep'
import { theoreticalQam16Ber } from '../lib/qam16'
import AiTutor from './AiTutor'
import './ModulationComparison.css'

const TOTAL = MODULATIONS.length * COMPARISON_DB.length
const colors = { BPSK: '#2289c4', QPSK: '#9152c9', '16QAM': '#b86b12' }
const format = (value: number) => (value === 0 ? '0' : value.toExponential(3))
const x = (db: number) => 65 + ((db + 4) / 18) * 660
const y = (ber: number) => 25 - Math.log10(Math.max(1e-14, ber)) * 20

function ComparisonChart({ points }: { points: ComparisonPoint[] }) {
  return (
    <figure className="signal-chart comparison-chart">
      <figcaption>BPSK / QPSK / 16QAM BER 对比 · 相同 Eb/N0</figcaption>
      <div
        className="comparison-scroll"
        tabIndex={0}
        role="region"
        aria-label="三调制 BER 曲线，可横向滚动"
      >
        <svg
          viewBox="0 0 800 355"
          role="img"
          aria-label="三种调制的理论和实测 BER，对数纵轴，零误码在底部用叉号标记"
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
              <text x="4" y={30 + index * 40}>
                1e−{index * 2}
              </text>
            </g>
          ))}
          {COMPARISON_DB.map((db) => (
            <text key={db} x={x(db) - 8} y="328">
              {db}
            </text>
          ))}
          <text x="350" y="350">
            Eb/N0 (dB)
          </text>
          {['BPSK', '16QAM'].map((modulation) => (
            <polyline
              key={modulation}
              fill="none"
              stroke={modulation === 'BPSK' ? colors.BPSK : colors['16QAM']}
              strokeWidth="1.5"
              strokeDasharray="3 5"
              points={Array.from({ length: 145 }, (_, index) => {
                const db = -4 + index / 8
                return `${x(db)},${y(modulation === '16QAM' ? theoreticalQam16Ber(db) : theoreticalBpskBer(db))}`
              }).join(' ')}
            />
          ))}
          {MODULATIONS.map((modulation) => {
            const series = points.filter(
              (point) => point.modulation === modulation,
            )
            const path = series
              .map((point, index) =>
                point.ber === 0
                  ? ''
                  : `${index > 0 && series[index - 1].ber > 0 ? 'L' : 'M'}${x(point.ebN0Db)},${y(point.ber)}`,
              )
              .join(' ')
            return (
              <g
                key={modulation}
                stroke={colors[modulation]}
                fill={colors[modulation]}
              >
                <path
                  d={path}
                  fill="none"
                  strokeWidth="2"
                  strokeDasharray={modulation === 'QPSK' ? '7 4' : undefined}
                />
                {series.map((point) => (
                  <g key={point.ebN0Db}>
                    <title>{`${modulation} ${point.ebN0Db} dB：${point.errors}/${point.bits}误码，BER=${format(point.ber)}，EVM=${point.evm.percent.toFixed(3)}%`}</title>
                    {point.ber === 0 ? (
                      <path d={`M${x(point.ebN0Db) - 3},307l6,6m-6,0l6,-6`} />
                    ) : modulation === 'QPSK' ? (
                      <rect
                        x={x(point.ebN0Db) - 3}
                        y={y(point.ber) - 3}
                        width="6"
                        height="6"
                        fill="none"
                      />
                    ) : (
                      <circle cx={x(point.ebN0Db)} cy={y(point.ber)} r="3" />
                    )}
                  </g>
                ))}
              </g>
            )
          })}
        </svg>
      </div>
      <p>
        蓝色实线/圆点 BPSK；紫色虚线/方框 QPSK；橙色实线/圆点
        16QAM。细点线为理论，BPSK/QPSK
        理论共线。零误码在底部标叉，不当作有限对数 BER 或置信上限。
      </p>
    </figure>
  )
}

export default function ModulationComparison() {
  const [bits, setBits] = useState('131072')
  const [seed, setSeed] = useState('42')
  const [points, setPoints] = useState<ComparisonPoint[]>([])
  const [run, setRun] = useState<SweepRequest | null>(null)
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
    setError('')
    try {
      if (!seed.trim()) throw new Error('请输入对比种子。')
      const request = { bits: Number(bits), seed: Number(seed) }
      validateComparisonRequest(request)
      const worker = new Worker(
        new URL('../workers/modulationComparison.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker
      setRun(request)
      setStatus('running')
      const finish = () => {
        worker.terminate()
        workerRef.current = null
      }
      worker.onmessage = (event: MessageEvent<ComparisonMessage>) => {
        if (workerRef.current !== worker) return
        if (event.data.type === 'point') {
          const point = event.data.point
          setPoints((previous) => [...previous, point])
        } else {
          const message = event.data
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
        setError('调制对比后台计算失败，请重试。')
      }
      worker.postMessage(request)
    } catch (cause) {
      workerRef.current?.terminate()
      workerRef.current = null
      setStatus('error')
      setError(cause instanceof Error ? cause.message : '无法启动对比。')
    }
  }
  const running = status === 'running'
  return (
    <section
      className="modulation-comparison"
      aria-labelledby="comparison-title"
    >
      <h2 id="comparison-title">三调制 BER 与性能对比</h2>
      <p>
        每种调制在 −4 到 14 dB 发送相同比特数。每 64 位依次发送 0000 至
        1111，均匀覆盖 16QAM 全星座；与各手动实验和原 BPSK 扫描独立。
      </p>
      <div className="signal-controls">
        <div className="signal-parameters">
          <label htmlFor="comparison-bits">
            对比每点比特数
            <select
              id="comparison-bits"
              value={bits}
              disabled={running}
              onChange={(e) => setBits(e.target.value)}
            >
              {[16384, 131072, 1000000].map((count) => (
                <option key={count} value={count}>
                  {count.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="comparison-seed">
            对比基础种子
            <input
              id="comparison-seed"
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
            开始三调制对比
          </button>
          {running && (
            <button type="button" onClick={stop}>
              取消三调制对比
            </button>
          )}
        </div>
      </div>
      <p role="status">
        {status === 'idle'
          ? '尚未运行对比。'
          : status === 'running'
            ? `对比计算中：${points.length}/${TOTAL} 点`
            : status === 'done'
              ? `对比完成：${points.length}/${TOTAL} 点`
              : status === 'cancelled'
                ? `对比已取消：保留 ${points.length}/${TOTAL} 点。`
                : `对比失败：保留 ${points.length}/${TOTAL} 点。`}
      </p>
      {running && (
        <progress
          aria-label="三调制对比进度"
          value={points.length}
          max={TOTAL}
        />
      )}
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
      {run && (
        <p>
          本次每点 {run.bits.toLocaleString()} 比特，基础种子 {run.seed}。第 i
          个信噪比种子=(基础种子+i) mod 2³²。
        </p>
      )}
      <ComparisonChart points={points} />
      {points.length > 0 && (
        <div
          className="comparison-scroll"
          role="region"
          aria-label="三调制对比原始数据，可横向滚动"
          tabIndex={0}
        >
          <table>
            <caption>实测/理论 BER 与参考辅助 RMS EVM；仅列实际完成点</caption>
            <thead>
              <tr>
                <th>调制</th>
                <th>Eb/N0 (dB)</th>
                <th>种子</th>
                <th>比特数</th>
                <th>误码数</th>
                <th>实测 BER</th>
                <th>理论 BER</th>
                <th>EVM (%)</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={`${point.modulation}-${point.ebN0Db}`}>
                  <th scope="row">{point.modulation}</th>
                  <td>{point.ebN0Db}</td>
                  <td>{point.seed}</td>
                  <td>{point.bits.toLocaleString()}</td>
                  <td>{point.errors}</td>
                  <td>{format(point.ber)}</td>
                  <td>{format(point.theoretical)}</td>
                  <td>{point.evm.percent.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <aside className="signal-notes">
        <h3>如何解释性能差异</h3>
        <p>
          BPSK/QPSK/16QAM 每符号分别传输 1/2/4 比特，平均 Es 分别为
          1/2/4，均使用
          Eb=1。对比固定比特数，不代表相同符号数或实际带宽；高阶调制提高每符号信息量，同时缩小相对点间距。
        </p>
        <p>
          BPSK/QPSK 共用逐位随机噪声，因此实测 BER
          完全重合，这是预期行为，不是独立试验重复性证据。16QAM
          的每符号两轴各消费一次噪声。EVM 分母为实际发送能量，16QAM 的 EVM
          较低不代表同 Eb/N0 下 BER 更低。
        </p>
        <p>
          本比较不提供置信带：16QAM 同符号内比特错误可能相关，不能把比特独立的
          Wilson 区间直接当作精确区间。零误码不代表真实 BER 为零。BPSK
          仅测实轴，三种 EVM 不用于射频标准合规判断。
        </p>
      </aside>
      <AiTutor
        context={
          run
            ? { experiment: 'COMPARISON', data: { status, run, points } }
            : null
        }
      />
    </section>
  )
}
