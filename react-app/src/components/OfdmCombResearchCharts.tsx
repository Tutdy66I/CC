import { useState } from "react";
import type { OfdmCombRecord } from "../lib/ofdmCombResearchRecord";
import { commonDataBins } from "../lib/ofdmCombProtocol";
const fmt = (x: number | null) =>
  x === null ? "失效 / 不适用" : x.toExponential(3);
const colors = ["#2196a0", "#dd8b31", "#a56ee0"];
export default function OfdmCombResearchCharts({
  record,
}: {
  record: OfdmCombRecord;
}) {
  const [layout, setLayout] = useState(0),
    [scope, setScope] = useState<"all" | "common">("all"),
    [channel, setChannel] = useState(record.plan.channels[0]),
    [db, setDb] = useState(record.plan.ebN0Db[0]);
  const rows = record.summary.filter(
      (s) => s.layout === layout && s.scope === scope && s.channel === channel,
    ),
    cell = record.trials[0].cells.find(
      (c) =>
        c.layout === layout &&
        c.scope === "all" &&
        c.channel === channel &&
        c.ebN0Db === db,
    )!,
    v = cell.preview,
    min = Math.min(...record.plan.ebN0Db),
    max = Math.max(...record.plan.ebN0Db),
    x = (q: number) =>
      45 + ((q - v.bins[0]) / (v.bins.at(-1)! - v.bins[0])) * 650,
    sx = (s: number) => 45 + ((s - min) / Math.max(1, max - min)) * 650,
    sy = (ber: number) => 30 - Math.log10(Math.max(1e-6, ber)) * 25;
  return (
    <div className="ofdm-results">
      <p>
        95% 逐格 Hoeffding 区间使用 {record.plan.trials}{" "}
        个完整独立帧，不将相关载波、比特、布局或数据符号作为独立样本；未校正多重比较。检查点不发布区间。
      </p>
      <div className="ofdm-controls">
        <label>
          查看导频布局
          <select
            value={layout}
            onChange={(e) => setLayout(Number(e.target.value))}
          >
            {record.plan.pilotLayouts.map((p, j) => (
              <option key={j} value={j}>
                布局 {j + 1} / P{p.length}
              </option>
            ))}
          </select>
        </label>
        <label>
          数据统计范围
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="all">本布局全部数据位置</option>
            <option value="common">各布局共同数据位置</option>
          </select>
        </label>
        <label>
          查看信道
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            {record.plan.channels.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          首帧频响 Eb/N0
          <select value={db} onChange={(e) => setDb(Number(e.target.value))}>
            {record.plan.ebN0Db.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <p>
        本布局数据载波{" "}
        {record.plan.activeBins.length -
          record.plan.pilotLayouts[layout].length}{" "}
        个；共同数据 {commonDataBins(record.plan).length}{" "}
        个。全部数据与共同数据的结果分开计算；跨布局配对差仅在共同位置显示。三种
        CSI 使用相同发送帧和噪声，均承担全训练符号的开销。
      </p>
      {rows.some((s) => !s.cpSufficient) && (
        <p className="ofdm-warning">
          CP 不足：连续 FIR 保留 ISI/ICI；理想 CSI 只是已知对角 H
          的单抽头参考，标量 BER 及偏差/噪声分解不适用。
        </p>
      )}
      <figure>
        <figcaption>
          BER 对照：颜色依次为 ideal / 全训练 LS / comb LS。虚线 MMSE 与同 CSI
          的 ZF 硬判决重合。零值仅在图上放于 10⁻⁶，真实值及区间见表。
        </figcaption>
        <svg
          viewBox="0 0 740 220"
          role="img"
          aria-label="梳状导频三种 CSI BER 对照"
        >
          {[0, 2, 4, 6].map((t) => (
            <g key={t}>
              <line
                x1="45"
                x2="695"
                y1={30 + t * 25}
                y2={30 + t * 25}
                className="ofdm-axis"
              />
              <text x="2" y={35 + t * 25}>
                10⁻{t}
              </text>
            </g>
          ))}
          {(["ideal", "training", "comb"] as const).flatMap((prefix, j) =>
            (["zf", "mmse"] as const).map((eq) => (
              <polyline
                key={prefix + eq}
                fill="none"
                stroke={colors[j]}
                strokeWidth={eq === "zf" ? 3 : 1.5}
                strokeDasharray={eq === "mmse" ? "3 4" : undefined}
                points={rows
                  .filter(
                    (s) => s.method === `${prefix}-${eq}` && s.ber !== null,
                  )
                  .sort((a, b) => a.ebN0Db - b.ebN0Db)
                  .map((s) => `${sx(s.ebN0Db)},${sy(s.ber!)}`)
                  .join(" ")}
              />
            )),
          )}
          {record.plan.ebN0Db.map((s) => (
            <text key={s} x={sx(s) - 8} y="210">
              {s} dB
            </text>
          ))}
        </svg>
      </figure>
      <div className="ofdm-table">
        <table aria-label="梳状导频 BER 与完整帧区间">
          <thead>
            <tr>
              {[
                "dB / 接收器",
                "BER / 95% 区间",
                "误码 / 总位 / 擦除",
                "失败帧",
                "理想理论",
                "配对差 vs 全训练 ZF",
                "共同位置差 vs 布局一",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.ebN0Db + s.method}>
                <td>
                  {s.ebN0Db} / {s.method}
                </td>
                <td>
                  {fmt(s.ber)} / [
                  {s.interval.map((v) => v.toFixed(4)).join(", ")}]
                </td>
                <td>
                  {s.errors} / {s.bits} / {s.erasedBits}
                </td>
                <td>{s.failedFrames}</td>
                <td>
                  {s.method.startsWith("ideal") ? fmt(s.idealTheoryBer) : "—"}
                </td>
                <td>
                  {fmt(s.pairedDifference.mean)} [
                  {s.pairedDifference.interval
                    .map((v) => v.toFixed(4))
                    .join(", ")}
                  ]
                </td>
                <td>
                  {s.layoutDifference ? (
                    <>
                      {fmt(s.layoutDifference.mean)} [
                      {s.layoutDifference.interval
                        .map((v) => v.toFixed(4))
                        .join(", ")}
                      ]
                    </>
                  ) : (
                    "仅共同位置适用"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ofdm-table">
        <table aria-label="梳状导频 EVM 与信道估计误差">
          <thead>
            <tr>
              {[
                "dB / 接收器",
                "原始输出 MSE / EVM",
                "判决坐标 EVM",
                "帧 EVM P50/P90/P99/max",
                "有效 / 失败帧",
                "信道估计 MSE / NMSE",
                "条件插值偏差 / 导频噪声 MSE",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.ebN0Db + s.method}>
                <td>
                  {s.ebN0Db} / {s.method}
                </td>
                <td>
                  {fmt(s.rawMse)} / {fmt(s.rawEvmRms)}
                </td>
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
                <td>
                  {s.method.startsWith("comb")
                    ? `${fmt(s.interpolationBias)} / ${fmt(s.pilotNoise)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        偏差是无噪声真值经相同插值算子的事后误差；噪声项为 N0·Σw²/Ep，二者仅在
        CP 充分时适用，有限样本实测不必等于期望。信道 MSE
        对各数据符号/位置求平均。估计器只读取 noisy 导频与已知符号。
      </p>
      <p>
        MMSE 原始输出包含收缩偏差，判决坐标使用接收器已知增益；同 CSI
        的未编码硬判决不因此改善。plug-in MMSE 使用已知仿真 N0，Rayleigh ZF
        总体均方 EVM 可能发散。EVM 未套用 BER 区间。
      </p>
      <div className="ofdm-plots">
        {[0, 1].map((component) => {
          const curves = [v.truth, v.training, v.comb],
            peak = Math.max(
              1,
              ...curves.flatMap((a) =>
                a.filter((_, j) => j % 2 === component).map(Math.abs),
              ),
            ),
            y = (z: number) => 105 - (80 * z) / peak;
          return (
            <figure key={component}>
              <figcaption>
                首帧数据符号一频响{component ? "虚部" : "实部"}
                ：青色真值、橙色全训练 LS、紫色 comb 插值，圆点为 noisy 导频
                LS。横轴为真实有符号频率，跨 DC 保留距离。
              </figcaption>
              <svg
                viewBox="0 0 740 235"
                role="img"
                aria-label={`梳状导频信道频率响应${component ? "虚部" : "实部"}`}
              >
                <line
                  x1="45"
                  x2="695"
                  y1="105"
                  y2="105"
                  className="ofdm-axis"
                />
                {curves.map((a, j) => (
                  <polyline
                    key={j}
                    fill="none"
                    stroke={colors[j]}
                    strokeWidth={j === 2 ? 2.5 : 1.5}
                    strokeDasharray={j === 1 ? "3 4" : undefined}
                    points={v.bins
                      .map((q, k) => `${x(q)},${y(a[2 * k + component])}`)
                      .join(" ")}
                  />
                ))}
                {v.pilots.map((q, k) => (
                  <circle
                    key={q}
                    cx={x(q)}
                    cy={y(v.pilotLs[2 * k + component])}
                    r="3.5"
                    fill={colors[2]}
                  />
                ))}
                {[peak, 0, -peak].map((value) => (
                  <text
                    key={value}
                    x="1"
                    y={y(value) + 5}
                    style={{ fontSize: 16 }}
                  >
                    {value.toFixed(2)}
                  </text>
                ))}
                <text x="45" y="225" style={{ fontSize: 16 }}>
                  {v.bins[0]}
                </text>
                <text
                  x={x(0)}
                  y="225"
                  textAnchor="middle"
                  style={{ fontSize: 16 }}
                >
                  DC 0
                </text>
                <text x="695" y="225" textAnchor="end" style={{ fontSize: 16 }}>
                  {v.bins.at(-1)}
                </text>
              </svg>
            </figure>
          );
        })}
      </div>
      <p>
        首帧发送能量：data useful {cell.energy.dataUseful.toFixed(4)}，comb
        pilot useful {cell.energy.pilotUseful.toFixed(4)}；CP
        training/data/pilot/cross ={" "}
        {[
          cell.energy.trainingCp,
          cell.energy.dataCp,
          cell.energy.pilotCp,
          cell.energy.crossCp,
        ]
          .map((v) => v.toFixed(4))
          .join(" / ")}
        。该帧 N0={fmt(cell.noisePower)} 由冻结的期望能量决定。
      </p>
    </div>
  );
}
