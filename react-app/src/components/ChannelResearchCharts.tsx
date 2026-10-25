import type { ChannelSummary } from '../lib/channelResearch'

interface Series {
  name: string
  color: string
  dashed?: boolean
  points: { x: number; y: number | null }[]
}

const colors = [
  '#438ad2',
  '#d95d5d',
  '#379572',
  '#b27716',
  '#9a69c6',
  '#168d9b',
]
const names = {
  awgn: 'AWGN',
  'rayleigh-block': '准静态 Rayleigh',
  'rayleigh-iid': '逐符号 iid（失配）',
}
const methodNames = { raw: '未均衡', ideal: '理想 CSI', ls: 'LS 估计 CSI' }

function Plot({
  label,
  series,
  logarithmic = false,
  yLabel,
}: {
  label: string
  series: Series[]
  logarithmic?: boolean
  yLabel: string
}) {
  const points = series
    .flatMap((s) => s.points)
    .filter((p) => p.y !== null && Number.isFinite(p.y))
  const xs = points.map((p) => p.x)
  const ys = points.map((p) =>
    logarithmic ? Math.log10(Math.max(p.y!, 1e-6)) : p.y!,
  )
  const xmin = Math.min(0, ...xs),
    xmax = Math.max(xmin + 1, ...xs)
  const ymin = logarithmic ? Math.min(-1, ...ys) : 0
  const ymax = logarithmic ? Math.max(0, ...ys) : Math.max(1e-12, ...ys) * 1.08
  const x = (v: number) => 58 + ((v - xmin) / (xmax - xmin)) * 475
  const y = (v: number) =>
    225 -
    (((logarithmic ? Math.log10(Math.max(v, 1e-6)) : v) - ymin) /
      (ymax - ymin)) *
      190
  return (
    <figure>
      <figcaption>{label}</figcaption>
      <svg role="img" aria-label={label} viewBox="0 0 570 275">
        <line x1="58" x2="533" y1="225" y2="225" />
        <line x1="58" x2="58" y1="35" y2="225" />
        {Array.from({ length: 5 }, (_, i) => {
          const value = ymin + ((ymax - ymin) * i) / 4
          return (
            <g key={i}>
              <text x="4" y={229 - (190 * i) / 4}>
                {logarithmic
                  ? `10^${value.toFixed(1)}`
                  : value.toExponential(1)}
              </text>
              <text x={58 + (475 * i) / 4} y="244" textAnchor="middle">
                {(xmin + ((xmax - xmin) * i) / 4).toFixed(1)}
              </text>
            </g>
          )
        })}
        <text x="58" y="17">
          {yLabel}
        </text>
        <text x="370" y="268">
          Eb/N0（dB，所选能量口径）
        </text>
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              stroke={s.color}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              points={s.points
                .filter((p) => p.y !== null)
                .map((p) => `${x(p.x)},${y(p.y!)}`)
                .join(' ')}
            />
            {s.points
              .filter((p) => p.y !== null)
              .map((p, i) => (
                <circle key={i} cx={x(p.x)} cy={y(p.y!)} r="2.5" fill={s.color}>
                  <title>
                    {s.name}：{p.x} dB，{p.y}
                  </title>
                </circle>
              ))}
          </g>
        ))}
      </svg>
      <div className="channel-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ backgroundColor: s.color }} />
            {s.name}
            {s.dashed ? '（虚线）' : ''}
          </span>
        ))}
      </div>
      {logarithmic && (
        <p className="channel-caption">
          零值绘于 10⁻⁶ 显示底线，精确值见表；不可用值不绘制。
        </p>
      )}
    </figure>
  )
}

export default function ChannelResearchCharts({
  summary,
}: {
  summary: ChannelSummary[]
}) {
  const groups = [...new Set(summary.map((r) => `${r.model}/${r.pilots}`))].map(
    (id) =>
      summary
        .filter((r) => `${r.model}/${r.pilots}` === id)
        .sort((a, b) => a.ebN0Db - b.ebN0Db),
  )
  const ber = groups.flatMap((rows) => {
    const prefix = `${names[rows[0].model]} P${rows[0].pilots}`
    return [
      ...(['raw', 'ideal', 'ls'] as const).map((method, i) => ({
        name: `${prefix} ${methodNames[method]}`,
        color: colors[i],
        dashed: rows[0].model !== 'awgn',
        points: rows.map((r) => ({ x: r.ebN0Db, y: r.methods[method].ber })),
      })),
      {
        name: `${prefix} 理想 CSI 理论`,
        color: colors[3],
        dashed: true,
        points: rows.map((r) => ({ x: r.ebN0Db, y: r.theoreticalBer })),
      },
    ]
  })
  const mse = groups.flatMap((rows, i) => [
    {
      name: `${names[rows[0].model]} P${rows[0].pilots} 实测`,
      color: colors[i % colors.length],
      points: rows.map((r) => ({ x: r.ebN0Db, y: r.mse })),
    },
    {
      name: `${names[rows[0].model]} P${rows[0].pilots} 模型参考`,
      color: colors[i % colors.length],
      dashed: true,
      points: rows.map((r) => ({ x: r.ebN0Db, y: r.expectedLsMse })),
    },
  ])
  const evm = groups.flatMap((rows) =>
    (['median', 'p90', 'p99'] as const).map((quantile, i) => ({
      name: `${names[rows[0].model]} P${rows[0].pilots} ${quantile}`,
      color: colors[i],
      dashed: rows[0].model !== 'awgn',
      points: rows.map((r) => ({ x: r.ebN0Db, y: r.methods.ls.evm[quantile] })),
    })),
  )
  const resources = [...new Map(summary.map((r) => [r.pilots, r])).values()]
  return (
    <div className="channel-plots">
      <Plot
        label="信道BER与理想CSI理论参考"
        series={ber}
        logarithmic
        yLabel="数据位 BER（对数）"
      />
      <Plot
        label="LS信道估计MSE与模型参考"
        series={mse}
        logarithmic
        yLabel="E[|估计 h − h|²]"
      />
      <Plot
        label="LS均衡每帧EVM分位数"
        series={evm}
        yLabel="每帧 RMS EVM（比值）"
      />
      <figure>
        <figcaption>导频开销与能量资源</figcaption>
        <svg
          role="img"
          aria-label="信道导频开销与能量资源"
          viewBox={`0 0 570 ${80 + resources.length * 55}`}
        >
          {resources.map((r, i) => (
            <g key={r.pilots}>
              <text x="0" y={25 + i * 55}>
                P{r.pilots}
              </text>
              <rect
                x="55"
                y={10 + i * 55}
                width={400 * r.pilotOverhead}
                height="18"
                fill={colors[1]}
              />
              <rect
                x={55 + 400 * r.pilotOverhead}
                y={10 + i * 55}
                width={400 * (1 - r.pilotOverhead)}
                height="18"
                fill={colors[0]}
              />
              <text x="55" y={44 + i * 55}>
                导频 {(100 * r.pilotOverhead).toFixed(2)}%；总能量/信息比特{' '}
                {r.expectedTotalEb.toFixed(4)}
              </text>
            </g>
          ))}
          <text x="55" y={65 + resources.length * 55}>
            红：导频；蓝：数据。参考 data Eb = 1。
          </text>
        </svg>
        <p className="channel-caption">
          相同 data Eb/N0 下，增加导频也增加每信息比特总能量；固定 total Eb/N0
          时重新计算 N0。
        </p>
      </figure>
    </div>
  )
}
