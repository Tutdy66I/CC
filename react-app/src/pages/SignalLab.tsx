import { useMemo, useState } from 'react'
import { parseBits, simulateBpsk } from '../lib/signallab'
import BerSweep from '../components/BerSweep'
import QpskExperiment from '../components/QpskExperiment'
import AiTutor from '../components/AiTutor'
import './SignalLab.css'

const MAX_BITS = 10000
const PREVIEW_BITS = 32

function Waveform({
  values,
  carrier = false,
  title,
}: {
  values: readonly number[]
  carrier?: boolean
  title: string
}) {
  const preview = values.slice(0, PREVIEW_BITS)
  const scale = Math.max(1.5, ...preview.map(Math.abs))
  const x = (time: number) => 35 + (time / preview.length) * 730
  const y = (value: number) => 90 - (value / scale) * 60
  const points = preview
    .flatMap((value, index) =>
      Array.from({ length: carrier ? 33 : 2 }, (_, sample) => {
        const fraction = sample / (carrier ? 32 : 1)
        const amplitude = carrier
          ? value * Math.cos(2 * Math.PI * fraction)
          : value
        return `${x(index + fraction)},${y(amplitude)}`
      }),
    )
    .join(' ')
  return (
    <figure className="signal-chart">
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 800 180"
        role="img"
        aria-label={`${title}，前 ${preview.length} 比特`}
      >
        <line x1="35" x2="765" y1="90" y2="90" className="signal-axis" />
        <text x="0" y="35">
          {scale.toFixed(1)}
        </text>
        <text x="8" y="95">
          0
        </text>
        <text x="0" y="155">
          −{scale.toFixed(1)}
        </text>
        <polyline
          points={points}
          fill="none"
          className={carrier ? 'signal-carrier' : 'signal-samples'}
          strokeWidth="2"
        />
        <text x="35" y="174">
          0
        </text>
        <text x="700" y="174">
          {preview.length} Tb
        </text>
      </svg>
    </figure>
  )
}

export default function SignalLab() {
  const [input, setInput] = useState('01001101 10110010 01010101 11000011')
  const [ebN0Db, setEbN0Db] = useState(0)
  const [seed, setSeed] = useState('42')
  const [noiseEnabled, setNoiseEnabled] = useState(true)
  const experiment = useMemo(() => {
    try {
      const bits = parseBits(input)
      if (bits.length > MAX_BITS) throw new Error(`最多输入 ${MAX_BITS} 比特。`)
      if (!seed.trim()) throw new Error('请输入随机种子。')
      const numericSeed = Number(seed)
      if (
        !Number.isInteger(numericSeed) ||
        numericSeed < 0 ||
        numericSeed > 0xffffffff
      ) {
        throw new Error('随机种子必须是 0 到 4294967295 的整数。')
      }
      const result = simulateBpsk(bits, ebN0Db, numericSeed, noiseEnabled)
      return { bits, result, error: null }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '无法运行实验。',
      }
    }
  }, [input, ebN0Db, seed, noiseEnabled])

  return (
    <main className="signal-lab">
      <header>
        <p className="signal-version">通信实验 · v0.4</p>
        <h1>SignalLab AI</h1>
        <p>从比特到波形与星座图，观察 BPSK、QPSK 在高斯白噪声信道中的传输。</p>
      </header>
      <section className="signal-controls" aria-label="实验参数">
        <label htmlFor="signal-bits">输入比特流</label>
        <textarea
          id="signal-bits"
          rows={3}
          value={input}
          maxLength={30000}
          onChange={(event) => setInput(event.target.value)}
          aria-describedby="signal-input-help"
          aria-invalid={Boolean(experiment.error)}
        />
        <p id="signal-input-help">
          仅支持 0、1、空格和换行，最多 {MAX_BITS.toLocaleString()}{' '}
          比特。修改参数后自动重新计算。
        </p>
        <div className="signal-parameters">
          <label htmlFor="signal-ebn0">
            Eb/N0：{ebN0Db} dB
            <input
              id="signal-ebn0"
              type="range"
              min="-10"
              max="15"
              step="0.5"
              value={ebN0Db}
              disabled={!noiseEnabled}
              onChange={(event) => setEbN0Db(Number(event.target.value))}
            />
          </label>
          <label htmlFor="signal-seed">
            随机种子
            <input
              id="signal-seed"
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
          启用 AWGN 噪声（取消勾选可验证无噪声恢复）
        </label>
      </section>
      {experiment.error && (
        <p className="signal-error" role="alert">
          {experiment.error}
        </p>
      )}
      {experiment.result && experiment.bits && (
        <>
          <section aria-label="实验结果" aria-live="polite">
            <dl className="signal-metrics">
              <div>
                <dt>传输比特</dt>
                <dd>{experiment.bits.length.toLocaleString()}</dd>
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
              恢复比特（前 {Math.min(experiment.bits.length, PREVIEW_BITS)}{' '}
              位，红色表示误码）：
            </p>
            <div className="signal-decoded" aria-label="恢复比特">
              {experiment.result.decoded
                .slice(0, PREVIEW_BITS)
                .map((bit, index) => (
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
          </section>
          <section aria-label="波形可视化">
            <p>
              波形显示前 {Math.min(experiment.bits.length, PREVIEW_BITS)}{' '}
              比特；BER 使用全部输入比特计算。横轴为比特周期
              Tb，纵轴为归一化幅度。
            </p>
            <Waveform
              values={experiment.result.symbols}
              title="发送符号 · 0 → +1，1 → −1"
            />
            <Waveform
              values={experiment.result.symbols}
              carrier
              title="BPSK 载波示意 · 每比特一个周期，相位相差 π"
            />
            <Waveform
              values={experiment.result.received}
              title="接收判决采样 · AWGN 后的匹配滤波输出，阈值为 0"
            />
          </section>
        </>
      )}
      <AiTutor
        reportData={
          experiment.result && experiment.bits
            ? {
                inputBits: experiment.bits.join(''),
                decodedBits: experiment.result.decoded.join(''),
                samples: experiment.result.received
                  .slice(0, 32)
                  .map((received, index) => ({
                    index: index + 1,
                    sent: experiment.bits[index],
                    received,
                    decoded: experiment.result.decoded[index],
                  })),
              }
            : undefined
        }
        context={
          experiment.result && experiment.bits
            ? {
                experiment: 'BPSK',
                data: {
                  bits: experiment.bits.length,
                  ebN0Db,
                  seed: Number(seed),
                  noiseEnabled,
                  errors: experiment.result.errors,
                  ber: experiment.result.ber,
                },
              }
            : null
        }
      />
      <BerSweep />
      <aside className="signal-notes">
        <h2>BPSK 实验模型</h2>
        <p>
          单位比特能量 Eb = 1，接收采样 r = s + n，n ∼ N(0, σ²)，σ² = 1 / (2 ×
          10^(Eb/N0[dB] / 10))。r ≥ 0 判为 0，否则判为 1。
        </p>
        <p>
          载波图为无噪声相位示意，幅度归一化为
          1；接收图显示每比特一个匹配滤波采样，以阶梯线连接，不是射频时域噪声波形。
        </p>
        <p>
          BER = 误码数 /
          总比特数。所有结果均在浏览器本地计算；相同比特、参数和种子可复现。短序列的零误码不代表理论
          BER 为零；有限样本的 BER 不保证每次随 Eb/N0 严格下降。
        </p>
      </aside>
      <QpskExperiment />
    </main>
  )
}
