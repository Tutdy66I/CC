import { useMemo, useState } from 'react'
import AiTutor from './AiTutor'
import EvmReadout from './EvmReadout'
import { measureEvm } from '../lib/evm'
import { theoreticalBpskBer } from '../lib/berSweep'
import { modulateQpsk, simulateQpsk, type QpskSymbol } from '../lib/qpsk'
import { parseBits } from '../lib/signallab'
import './QpskExperiment.css'

const MAX_BITS = 10000
const PREVIEW_SYMBOLS = 500
const IDEAL = modulateQpsk([0, 0, 0, 1, 1, 1, 1, 0])
const LABELS = ['00', '01', '11', '10']

function Constellation({
  symbols,
  received,
}: {
  symbols: readonly QpskSymbol[]
  received: readonly QpskSymbol[]
}) {
  const preview = received.slice(0, PREVIEW_SYMBOLS)
  const limit =
    Math.ceil(
      (Math.max(
        2,
        ...preview.flatMap(({ i, q }) => [Math.abs(i), Math.abs(q)]),
      ) +
        0.25) *
        2,
    ) / 2
  const x = (i: number) => 220 + (i / limit) * 175
  const y = (q: number) => 220 - (q / limit) * 175
  return (
    <figure className="signal-chart qpsk-constellation">
      <figcaption>QPSK 星座图 · I/Q 匹配滤波采样</figcaption>
      <svg
        viewBox="0 0 440 440"
        role="img"
        aria-label={`QPSK 星座图，四个理想点与前 ${preview.length} 个接收符号，虚线为零阈值判决边界`}
      >
        <line x1="45" x2="395" y1="220" y2="220" className="qpsk-boundary" />
        <line x1="220" x2="220" y1="45" y2="395" className="qpsk-boundary" />
        <text x="402" y="224">
          I
        </text>
        <text x="216" y="30">
          Q
        </text>
        <text x="227" y="235">
          0
        </text>
        <text x="45" y="240">
          −{limit}
        </text>
        <text x="375" y="240">
          {limit}
        </text>
        <text x="230" y="51">
          {limit}
        </text>
        <text x="230" y="395">
          −{limit}
        </text>
        {preview.map((point, index) => {
          const original = symbols[index]
          const error =
            point.i >= 0 !== original.i >= 0 || point.q >= 0 !== original.q >= 0
          const cx = x(point.i)
          const cy = y(point.q)
          return error ? (
            <path
              key={index}
              className="qpsk-error-point"
              d={`M${cx - 3},${cy - 3} l6,6 m-6,0 l6,-6`}
            />
          ) : (
            <circle
              key={index}
              className="qpsk-received-point"
              cx={cx}
              cy={cy}
              r="2.5"
            />
          )
        })}
        {IDEAL.map((point, index) => (
          <g key={LABELS[index]}>
            <circle
              className="qpsk-ideal-point"
              cx={x(point.i)}
              cy={y(point.q)}
              r="7"
            />
            <text
              className="qpsk-ideal-label"
              x={x(point.i) + 11}
              y={y(point.q) - 11}
            >
              {LABELS[index]}
            </text>
          </g>
        ))}
      </svg>
      <p>
        紫色空心圆：理想点；蓝色实点：正确接收符号；红色叉号：至少一位误判。横轴为
        I，纵轴为 Q，虚线是 I=0、Q=0 的判决边界，两轴等比例。
      </p>
      <p>
        显示前 {preview.length} / {received.length.toLocaleString()}{' '}
        个符号；坐标范围随采样调整，BER 使用全部输入比特。下方可展开数值表。
      </p>
    </figure>
  )
}

export default function QpskExperiment() {
  const [input, setInput] = useState('00011110 00011110 00011110 00011110')
  const [ebN0Db, setEbN0Db] = useState(0)
  const [seed, setSeed] = useState('42')
  const [noiseEnabled, setNoiseEnabled] = useState(true)
  const experiment = useMemo(() => {
    try {
      const bits = parseBits(input)
      if (bits.length > MAX_BITS) throw new Error(`最多输入 ${MAX_BITS} 比特。`)
      if (!seed.trim()) throw new Error('请输入 QPSK 随机种子。')
      const numericSeed = Number(seed)
      if (
        !Number.isInteger(numericSeed) ||
        numericSeed < 0 ||
        numericSeed > 0xffffffff
      ) {
        throw new Error('随机种子必须是 0 到 4294967295 的整数。')
      }
      return {
        bits,
        result: simulateQpsk(bits, ebN0Db, numericSeed, noiseEnabled),
        error: null,
      }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : '无法运行 QPSK 实验。',
      }
    }
  }, [input, ebN0Db, seed, noiseEnabled])

  return (
    <section className="qpsk-experiment" aria-labelledby="qpsk-title">
      <h2 id="qpsk-title">QPSK 与星座图</h2>
      <p>
        每个符号传输 2 比特，通过 I/Q 两个正交分量观察 Gray
        编码与噪声。参数与上方 BPSK、BER 扫描独立。
      </p>
      <div className="signal-controls">
        <label htmlFor="qpsk-bits">QPSK 输入比特流</label>
        <textarea
          id="qpsk-bits"
          rows={3}
          value={input}
          maxLength={30000}
          onChange={(event) => setInput(event.target.value)}
          aria-describedby="qpsk-input-help"
        />
        <p id="qpsk-input-help">
          仅支持 0、1、空格和换行；需偶数个比特，最多 10,000
          比特，不自动补位。修改参数后自动计算。
        </p>
        <div className="signal-parameters">
          <label htmlFor="qpsk-ebn0">
            QPSK Eb/N0：{ebN0Db} dB
            <input
              id="qpsk-ebn0"
              type="range"
              min="-10"
              max="15"
              step="0.5"
              value={ebN0Db}
              disabled={!noiseEnabled}
              onChange={(event) => setEbN0Db(Number(event.target.value))}
            />
          </label>
          <label htmlFor="qpsk-seed">
            QPSK 随机种子
            <input
              id="qpsk-seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
        </div>
        <label className="signal-checkbox">
          <input
            type="checkbox"
            checked={noiseEnabled}
            onChange={(event) => setNoiseEnabled(event.target.checked)}
          />
          启用 QPSK AWGN 噪声
        </label>
      </div>
      {experiment.error && (
        <p className="signal-error" role="alert">
          {experiment.error}
        </p>
      )}
      {experiment.result && experiment.bits && (
        <>
          <div aria-live="polite" aria-label="QPSK 实验结果">
            <EvmReadout
              modulation="QPSK"
              reference={experiment.result.symbols}
              received={experiment.result.received}
            />
            <dl className="signal-metrics qpsk-metrics">
              <div>
                <dt>传输比特</dt>
                <dd>{experiment.bits.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt>符号数</dt>
                <dd>{experiment.result.symbols.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt>误码数</dt>
                <dd>{experiment.result.errors}</dd>
              </div>
              <div>
                <dt>实测 BER</dt>
                <dd>{experiment.result.ber.toPrecision(4)}</dd>
              </div>
            </dl>
            <p>
              {noiseEnabled
                ? `理想相干 QPSK 理论 BER：${theoreticalBpskBer(ebN0Db).toExponential(3)}（当前 Eb/N0）`
                : '已关闭噪声：验证比特恢复，当前不使用 Eb/N0。'}
            </p>
            <p>
              恢复比特（前 {Math.min(experiment.bits.length, 32)}{' '}
              位，下划线标出误码）：
            </p>
            <div className="signal-decoded" aria-label="QPSK 恢复比特">
              {experiment.result.decoded.slice(0, 32).map((bit, index) => (
                <span
                  key={index}
                  className={
                    bit !== experiment.bits[index]
                      ? 'signal-bit-error'
                      : undefined
                  }
                  title={`第 ${index + 1} 位：发送 ${experiment.bits[index]}，恢复 ${bit}`}
                >
                  {bit}
                </span>
              ))}
            </div>
          </div>
          <Constellation
            symbols={experiment.result.symbols}
            received={experiment.result.received}
          />
          <details>
            <summary>查看前 16 个 QPSK 符号采样</summary>
            <div
              className="qpsk-table-scroll"
              role="region"
              aria-label="QPSK 符号采样，可横向滚动"
              tabIndex={0}
            >
              <table>
                <caption>
                  接收采样与硬判决（显示前{' '}
                  {Math.min(experiment.result.symbols.length, 16)} 个符号）
                </caption>
                <thead>
                  <tr>
                    <th scope="col">符号</th>
                    <th scope="col">发送比特</th>
                    <th scope="col">接收 I</th>
                    <th scope="col">接收 Q</th>
                    <th scope="col">恢复比特</th>
                    <th scope="col">判决</th>
                  </tr>
                </thead>
                <tbody>
                  {experiment.result.received
                    .slice(0, 16)
                    .map((point, index) => {
                      const sent = experiment.bits
                        .slice(index * 2, index * 2 + 2)
                        .join('')
                      const decoded = experiment.result.decoded
                        .slice(index * 2, index * 2 + 2)
                        .join('')
                      return (
                        <tr key={index}>
                          <th scope="row">{index + 1}</th>
                          <td>{sent}</td>
                          <td>{point.i.toFixed(4)}</td>
                          <td>{point.q.toFixed(4)}</td>
                          <td>{decoded}</td>
                          <td>{sent === decoded ? '正确' : '误判'}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <AiTutor
        reportData={
          experiment.result && experiment.bits
            ? {
                inputBits: experiment.bits.join(''),
                decodedBits: experiment.result.decoded.join(''),
                samples: experiment.result.received
                  .slice(0, 16)
                  .map((point, index) => ({
                    index: index + 1,
                    sent: experiment.bits
                      .slice(index * 2, index * 2 + 2)
                      .join(''),
                    i: point.i,
                    q: point.q,
                    decoded: experiment.result.decoded
                      .slice(index * 2, index * 2 + 2)
                      .join(''),
                  })),
              }
            : undefined
        }
        context={
          experiment.result && experiment.bits
            ? {
                experiment: 'QPSK',
                data: {
                  bits: experiment.bits.length,
                  symbols: experiment.result.symbols.length,
                  ebN0Db,
                  seed: Number(seed),
                  noiseEnabled,
                  errors: experiment.result.errors,
                  ber: experiment.result.ber,
                  evmPercent: measureEvm(
                    experiment.result.symbols,
                    experiment.result.received,
                  ).percent,
                  theoretical: noiseEnabled ? theoreticalBpskBer(ebN0Db) : null,
                },
              }
            : null
        }
      />
      <aside className="signal-notes">
        <h3>QPSK 实验模型</h3>
        <p>
          Gray 映射：00 → (+1,+1)，01 → (+1,−1)，11 → (−1,−1)，10 →
          (−1,+1)。第一位控制 I，第二位控制 Q；每轴 ≥ 0 判为 0，否则判为 1。
        </p>
        <p>
          每比特能量 Eb=1，每符号能量 Es=2。I/Q 噪声相互独立且均为 N(0,
          σ²)，σ²=1/(2×10^(Eb/N0[dB]/10))。星座点是复基带匹配滤波采样，不是射频时域波形。
        </p>
        <p>
          理想同步、相干检测和 AWGN 下，Gray 编码 QPSK 的理论比特误码率与同
          Eb/N0 的 BPSK
          相同：BER=½·erfc(√(10^(Eb/N0[dB]/10)))。短输入的实测值可能明显偏离理论，零误码不代表真实
          BER 为零。相同输入、参数和种子可复现。
        </p>
        <p>
          参考：
          <a href="https://www.mathworks.com/help/comm/ug/phase-modulation.html">
            MathWorks 相位调制与 Gray 编码 QPSK
          </a>
        </p>
      </aside>
    </section>
  )
}
