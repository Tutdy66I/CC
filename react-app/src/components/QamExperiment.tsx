import { useMemo, useState } from 'react'
import { parseBits } from '../lib/signallab'
import {
  demodulateQam16,
  modulateQam16,
  simulateQam16,
  theoreticalQam16Ber,
  QAM16_SCALE,
} from '../lib/qam16'
import { measureEvm } from '../lib/evm'
import { comparisonBit } from '../lib/modulationComparison'
import AiTutor from './AiTutor'
import EvmReadout from './EvmReadout'
import './QamExperiment.css'

const initial = Array.from({ length: 64 }, (_, i) => comparisonBit(i))
const ideal = modulateQam16(initial)

export default function QamExperiment() {
  const [input, setInput] = useState(initial.join(''))
  const [db, setDb] = useState(0)
  const [seed, setSeed] = useState('42')
  const [noise, setNoise] = useState(true)
  const experiment = useMemo(() => {
    try {
      const bits = parseBits(input)
      if (bits.length > 10000) throw new Error('最多输入 10000 比特。')
      if (
        !seed.trim() ||
        !Number.isInteger(Number(seed)) ||
        Number(seed) < 0 ||
        Number(seed) > 0xffffffff
      )
        throw new Error('16QAM 随机种子必须是 0 到 4294967295 的整数。')
      const result = simulateQam16(bits, db, Number(seed), noise)
      return {
        bits,
        result,
        evm: measureEvm(result.symbols, result.received),
        error: null,
      }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : '无法运行 16QAM。',
      }
    }
  }, [input, db, seed, noise])
  const result = experiment.result
  const preview = result?.received.slice(0, 500) ?? []
  const limit = Math.ceil(
    Math.max(
      2.5,
      ...preview.flatMap(({ i, q }) => [Math.abs(i), Math.abs(q)]),
    ) + 0.5,
  )
  const x = (value: number) => 220 + (value / limit) * 175
  const y = (value: number) => 220 - (value / limit) * 175
  return (
    <section className="qam-experiment" aria-labelledby="qam-title">
      <h2 id="qam-title">16QAM 与星座图</h2>
      <p>
        每符号 4 比特，前两位控制 I、后两位控制 Q；默认输入均匀覆盖 16
        个点。参数独立于其他实验。
      </p>
      <div className="signal-controls">
        <label htmlFor="qam-bits">16QAM 输入比特流</label>
        <textarea
          id="qam-bits"
          rows={3}
          maxLength={30000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-describedby="qam-help"
          aria-invalid={Boolean(experiment.error)}
        />
        <p id="qam-help">
          允许空格和换行；需非空、4 的倍数长度，最多 10,000 比特，不自动补位。
        </p>
        <div className="signal-parameters">
          <label htmlFor="qam-db">
            16QAM Eb/N0：{db} dB
            <input
              id="qam-db"
              type="range"
              min="-10"
              max="15"
              step="0.5"
              value={db}
              disabled={!noise}
              onChange={(e) => setDb(Number(e.target.value))}
            />
          </label>
          <label htmlFor="qam-seed">
            16QAM 随机种子
            <input
              id="qam-seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
        </div>
        <label className="signal-checkbox">
          <input
            type="checkbox"
            checked={noise}
            onChange={(e) => setNoise(e.target.checked)}
          />
          启用 16QAM AWGN 噪声
        </label>
      </div>
      {experiment.error && (
        <p role="alert" className="signal-error">
          {experiment.error}
        </p>
      )}
      {result && experiment.bits && (
        <>
          <div aria-label="16QAM 实验结果" aria-live="polite">
            <dl className="signal-metrics">
              <div>
                <dt>传输比特</dt>
                <dd>{experiment.bits.length}</dd>
              </div>
              <div>
                <dt>符号数</dt>
                <dd>{result.symbols.length}</dd>
              </div>
              <div>
                <dt>误码数</dt>
                <dd>{result.errors}</dd>
              </div>
              <div>
                <dt>实测 BER</dt>
                <dd>{result.ber.toPrecision(4)}</dd>
              </div>
            </dl>
            <p>
              {noise
                ? `均匀 Gray 星座理论 BER：${theoreticalQam16Ber(db).toExponential(3)}；短输入未必均匀。`
                : '已关闭噪声：当前不使用 Eb/N0。'}
            </p>
            <EvmReadout
              modulation="16QAM"
              reference={result.symbols}
              received={result.received}
            />
            <p>恢复比特（前 32 位）：</p>
            <div className="signal-decoded" aria-label="16QAM 恢复比特">
              {result.decoded.slice(0, 32).map((bit, index) => (
                <span
                  key={index}
                  className={
                    bit !== experiment.bits![index]
                      ? 'signal-bit-error'
                      : undefined
                  }
                >
                  {bit}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
      {result && (
        <figure className="signal-chart qam-constellation">
          <figcaption>16QAM 星座图 · Gray 映射，平均 Es=4</figcaption>
          <svg
            viewBox="0 0 440 440"
            role="img"
            aria-label={`16QAM 星座图，16 个理想点与前 ${preview.length} 个接收符号，两轴等比例`}
          >
            {[-2 * QAM16_SCALE, 0, 2 * QAM16_SCALE].map((v) => (
              <g key={v}>
                <line
                  x1={x(v)}
                  x2={x(v)}
                  y1="45"
                  y2="395"
                  className="qam-boundary"
                />
                <line
                  x1="45"
                  x2="395"
                  y1={y(v)}
                  y2={y(v)}
                  className="qam-boundary"
                />
              </g>
            ))}
            <text x="405" y="224">
              I
            </text>
            <text x="216" y="28">
              Q
            </text>
            <text x="42" y="416">
              −{limit}
            </text>
            <text x="380" y="416">
              {limit}
            </text>
            {preview.map((p, index) => {
              const decoded = demodulateQam16([p]),
                original = experiment.bits!.slice(index * 4, index * 4 + 4)
              const error = decoded.some((bit, n) => bit !== original[n]),
                cx = x(p.i),
                cy = y(p.q)
              return error ? (
                <path
                  key={index}
                  className="qam-error"
                  d={`M${cx - 3},${cy - 3}l6,6m-6,0l6,-6`}
                />
              ) : (
                <circle
                  key={index}
                  className="qam-received"
                  cx={cx}
                  cy={cy}
                  r="2.5"
                />
              )
            })}
            {ideal.map((p, index) => (
              <g key={index}>
                <circle className="qam-ideal" cx={x(p.i)} cy={y(p.q)} r="6" />
                <text x={x(p.i) + 7} y={y(p.q) - 7} className="qam-label">
                  {index.toString(2).padStart(4, '0')}
                </text>
              </g>
            ))}
          </svg>
          <p>
            空心圆为理想点，蓝点为正确符号，红叉为至少一位误判；虚线为
            −2a、0、2a 判决边界，a=√(2/5)。显示前 {preview.length}/
            {result.symbols.length} 个符号，BER/EVM 使用全部输入。
          </p>
        </figure>
      )}
      {result && (
        <details>
          <summary>查看前 16 个 16QAM 符号采样</summary>
          <div
            className="qam-table-scroll"
            role="region"
            aria-label="16QAM 符号采样，可横向滚动"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>符号</th>
                  <th>发送比特</th>
                  <th>接收 I</th>
                  <th>接收 Q</th>
                  <th>恢复比特</th>
                </tr>
              </thead>
              <tbody>
                {result.received.slice(0, 16).map((p, index) => (
                  <tr key={index}>
                    <th scope="row">{index + 1}</th>
                    <td>
                      {experiment
                        .bits!.slice(index * 4, index * 4 + 4)
                        .join('')}
                    </td>
                    <td>{p.i.toFixed(4)}</td>
                    <td>{p.q.toFixed(4)}</td>
                    <td>
                      {result.decoded.slice(index * 4, index * 4 + 4).join('')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <AiTutor
        context={
          result && experiment.bits
            ? {
                experiment: '16QAM',
                data: {
                  bits: experiment.bits.length,
                  symbols: result.symbols.length,
                  ebN0Db: db,
                  seed: Number(seed),
                  noiseEnabled: noise,
                  errors: result.errors,
                  ber: result.ber,
                  theoretical: noise ? theoreticalQam16Ber(db) : null,
                  evmPercent: experiment.evm!.percent,
                  evmDb: experiment.evm!.db,
                },
              }
            : null
        }
        reportData={
          result
            ? {
                inputBits: experiment.bits!.join(''),
                decodedBits: result.decoded.join(''),
                samples: result.received.slice(0, 16).map((p, index) => ({
                  index: index + 1,
                  i: p.i,
                  q: p.q,
                  decoded: result.decoded
                    .slice(index * 4, index * 4 + 4)
                    .join(''),
                })),
              }
            : undefined
        }
      />
      <aside className="signal-notes">
        <h3>16QAM 能量与判决模型</h3>
        <p>
          每轴 Gray 电平：00→−3a、01→−a、11→+a、10→+3a，a=√(2/5)。均匀星座平均
          Es=4、Eb=1；短输入实际功率不强制调整。每轴噪声方差仍为
          1/(2×10^(Eb/N0[dB]/10))。边界相等归上侧区间。
        </p>
        <p>
          假设理想同步、相干硬判决、独立
          AWGN、均匀发送。高阶调制每符号承载更多比特，但同 Eb/N0
          下通常需要更高信噪比才能达到相同 BER；零误码不代表真实 BER 为零。
        </p>
      </aside>
    </section>
  )
}
