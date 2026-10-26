import type { OfdmRecord } from "../lib/ofdmResearchRecord";
const fmt = (x: number | null) =>
  x === null ? "失效 / 不适用" : x.toExponential(3);
export default function OfdmResearchCharts({ record }: { record: OfdmRecord }) {
  const summary = record.summary,
    preview = record.trials[0].cells[0].preview;
  const min = Math.min(...record.plan.ebN0Db),
    max = Math.max(...record.plan.ebN0Db);
  const x = (db: number) => 50 + ((db - min) / Math.max(1, max - min)) * 640;
  const y = (ber: number) => 35 - Math.log10(Math.max(1e-6, ber)) * 27;
  const methods = ["ideal-zf", "ideal-mmse", "ls-zf", "ls-mmse"] as const;
  const amplitude = (values: number[]) =>
    Array.from({ length: values.length / 2 }, (_, j) =>
      Math.hypot(values[2 * j], values[2 * j + 1]),
    );
  const truth = amplitude(preview.truth),
    estimate = amplitude(preview.estimate),
    peak = Math.max(1, ...truth, ...estimate);
  const freqX = (j: number) =>
    40 +
    ((preview.bins[j] - preview.bins[0]) /
      Math.max(1, preview.bins.at(-1)! - preview.bins[0])) *
      660;
  const constellationScale = Math.max(
    2,
    ...preview.ls.map(Math.abs),
    ...preview.tx.map(Math.abs),
  );
  return (
    <div className="ofdm-results">
      <p>
        95% 逐格 Hoeffding 区间，以 {record.plan.trials}{" "}
        个完整独立帧为样本；不是逐比特区间，也未校正多重比较。深衰落与擦除保留在分母中。
      </p>
      {summary.some((s) => !s.cpSufficient) && (
        <p className="ofdm-warning">
          CP 不足：存在连续波形的 ISI/ICI。“理想 CSI”仅为已知对角 H
          的单抽头参考，标量理论不适用。
        </p>
      )}
      <figure>
        <figcaption>
          BER：ZF/MMSE 同 CSI 的硬判决重合；零 BER 仅在图上显示于
          10⁻⁶，真实值见表。
        </figcaption>
        <svg
          viewBox="0 0 740 240"
          role="img"
          aria-label="OFDM BER 与理想 CSI 理论参考"
        >
          {[0, 2, 4, 6].map((t) => (
            <g key={t}>
              <line
                x1="50"
                x2="690"
                y1={35 + t * 27}
                y2={35 + t * 27}
                className="ofdm-axis"
              />
              <text x="2" y={40 + t * 27}>
                10⁻{t}
              </text>
            </g>
          ))}
          {record.plan.channels.flatMap((channel, c) =>
            methods.map((method, m) => {
              const points = summary
                .filter(
                  (s) =>
                    s.channel === channel &&
                    s.method === method &&
                    s.ber !== null,
                )
                .sort((a, b) => a.ebN0Db - b.ebN0Db);
              return (
                <polyline
                  key={`${channel}-${method}`}
                  points={points
                    .map((s) => `${x(s.ebN0Db)},${y(s.ber!)}`)
                    .join(" ")}
                  fill="none"
                  stroke={["#2196a0", "#dd8b31", "#a56ee0"][c]}
                  strokeWidth={m < 2 ? 3 : 1.5}
                  strokeDasharray={m % 2 ? "2 5" : m === 2 ? "8 4" : undefined}
                />
              );
            }),
          )}
          {record.plan.ebN0Db.map((db) => (
            <text key={db} x={x(db) - 8} y="225">
              {db} dB
            </text>
          ))}
        </svg>
        <p>
          颜色按信道：{record.plan.channels.join(" / ")}。粗线 ideal CSI，细线
          LS；虚线 MMSE，实线 ZF。理论值见表，仅用于 CP 充分的 noisy ideal
          分支。
        </p>
      </figure>
      <div className="ofdm-table">
        <table aria-label="OFDM BER 与完整帧区间">
          <thead>
            <tr>
              {[
                "信道 / dB",
                "接收器",
                "BER",
                "95% 区间",
                "误码 / 总比特",
                "擦除 / 失败帧",
                "理想理论",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={`${s.channel}-${s.ebN0Db}-${s.method}`}>
                <td>
                  {s.channel} / {s.ebN0Db}
                </td>
                <td>{s.method}</td>
                <td>{fmt(s.ber)}</td>
                <td>[{s.interval.map((v) => v.toFixed(4)).join(", ")}]</td>
                <td>
                  {s.errors} / {s.bits}
                </td>
                <td>
                  {s.erasedBits} / {s.failedFrames}
                </td>
                <td>{fmt(s.idealTheoryBer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ofdm-table">
        <table aria-label="OFDM EVM 与信道估计误差">
          <thead>
            <tr>
              {[
                "信道 / dB / 方法",
                "原始输出 MSE",
                "原始 EVM",
                "判决坐标 EVM",
                "帧 EVM P50/P90/P99/max",
                "有效 / 失败帧",
                "LS MSE / NMSE",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={`${s.channel}-${s.ebN0Db}-${s.method}`}>
                <td>
                  {s.channel} / {s.ebN0Db} / {s.method}
                </td>
                <td>{fmt(s.rawMse)}</td>
                <td>{fmt(s.rawEvmRms)}</td>
                <td>{fmt(s.decisionEvmRms)}</td>
                <td>
                  {[
                    s.frameEvm.p50,
                    s.frameEvm.p90,
                    s.frameEvm.p99,
                    s.frameEvm.max,
                  ]
                    .map(fmt)
                    .join(" / ")}
                </td>
                <td>
                  {s.frameEvm.valid} / {s.frameEvm.failed}
                </td>
                <td>
                  {fmt(s.lsMse)} / {fmt(s.channelNmse)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        MMSE 原始输出包含收缩偏差；判决坐标按接收器已知增益处理。LS-MMSE 为
        plug-in 标量方法，N0 为已知仿真参数。EVM 未套用 BER 区间；Rayleigh ZF
        的总体均方 EVM 可能发散。
      </p>
      <div className="ofdm-plots">
        <figure>
          <figcaption>
            首帧 / 首格真实与 LS 频响幅值；最多 512 点，指标使用全部载波。
          </figcaption>
          <svg viewBox="0 0 740 230" role="img" aria-label="OFDM 信道频率响应">
            <line x1="40" x2="700" y1="190" y2="190" className="ofdm-axis" />
            {[truth, estimate].map((values, j) => (
              <polyline
                key={j}
                points={values
                  .map((v, i) => `${freqX(i)},${190 - (v / peak) * 160}`)
                  .join(" ")}
                fill="none"
                stroke={j ? "#dd8b31" : "#2196a0"}
                strokeWidth="2"
              />
            ))}
            <text x="40" y="220">
              有符号载波 {preview.bins[0]} … {preview.bins.at(-1)}；青色真值 /
              橙色 LS
            </text>
          </svg>
        </figure>
        <figure>
          <figcaption>
            首帧 / 首格星座预览：青色发送，橙色 LS-ZF；最多 256
            点，擦除不伪造成零点。
          </figcaption>
          <svg viewBox="0 0 360 300" role="img" aria-label="OFDM 星座图">
            <line x1="20" x2="340" y1="140" y2="140" className="ofdm-axis" />
            <line x1="180" x2="180" y1="10" y2="270" className="ofdm-axis" />
            {[preview.tx, preview.ls].map((values, k) =>
              Array.from({ length: values.length / 2 }, (_, j) => (
                <circle
                  key={`${k}-${j}`}
                  cx={180 + (values[2 * j] / constellationScale) * 125}
                  cy={140 - (values[2 * j + 1] / constellationScale) * 125}
                  r={k ? 2 : 3}
                  fill={k ? "#dd8b31" : "#2196a0"}
                  opacity=".65"
                />
              )),
            )}
            <text x="20" y="294">
              坐标范围 ±{constellationScale.toPrecision(4)}；深衰落可扩大范围
            </text>
          </svg>
        </figure>
      </div>
    </div>
  );
}
