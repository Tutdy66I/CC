import { useEffect, useMemo, useRef, useState } from "react";
import {
  P1cController,
  type State,
  type WorkerLike,
} from "../research-v15/p1cController.js";
import {
  P1C_VERSION,
  snapshotJob,
  type Batch,
} from "../research-v15/p1cProtocol.js";
import "./V15SyncComparison.css";

const show = (n: number | null) =>
  n === null ? "不可用" : Number.isFinite(n) ? n.toPrecision(6) : "不可用";
const bounds = (b: { lower: number; upper: number }) =>
  `[${show(b.lower)}, ${show(b.upper)}]`;
type MetricView = {
  metric: { bits: number; errors: number; erasedBits: number };
  ber: { lower: number; upper: number };
};
function BerBar({ name, value }: { name: string; value: MetricView }) {
  const { lower, upper } = value.ber;
  return (
    <svg
      role="img"
      aria-label={`${name} BER 界 ${bounds(value.ber)}`}
      viewBox="0 0 100 12"
      className="v15-bar"
    >
      <rect x="0" y="5" width="100" height="2" fill="#ccd5dc" />
      {lower === upper ? (
        <line
          x1={lower * 100}
          x2={lower * 100}
          y1="2"
          y2="10"
          stroke="#176a8f"
          strokeWidth="0.5"
        />
      ) : (
        <rect
          x={lower * 100}
          y="3"
          width={(upper - lower) * 100}
          height="6"
          fill="#176a8f"
        />
      )}
    </svg>
  );
}
function Table({ result }: { result: Batch }) {
  const summary = result.summary;
  const branches = [
    ["raw", summary.raw],
    ["estimated", summary.estimated],
    ["ideal", summary.ideal],
  ] as const;
  const points = [
    ["(e,d)", summary.controlled.ed],
    ["(e,0)", summary.controlled.e0],
    ["(0,d)", summary.controlled.zD],
    ["(0,0)", summary.controlled.z0],
  ] as const;
  return (
    <>
      <p>
        本次结果快照：CP {result.config.cp}，CFO {result.config.cfo}，STO{" "}
        {result.config.sto}， 相位 {result.config.phase}，信道抽头能量{" "}
        {show(
          result.config.taps.reduce((s, t) => s + t.i * t.i + t.q * t.q, 0),
        )}
        ， 噪声功率 {result.config.noisePower}；干预 e={result.intervention.e}
        ，d={result.intervention.delta}。
      </p>
      <h3>累计接收结果</h3>
      <div className="v15-scroll">
        <table>
          <thead>
            <tr>
              <th>分支</th>
              <th>位数</th>
              <th>误码</th>
              <th>擦除位</th>
              <th>BER 下界 / 上界</th>
              <th>区间</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(([name, v]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{v.metric.bits}</td>
                <td>{v.metric.errors}</td>
                <td>{v.metric.erasedBits}</td>
                <td>{bounds(v.ber)}</td>
                <td>
                  <BerBar name={name} value={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>逐帧状态与事后误差</h3>
      <div className="v15-scroll">
        <table>
          <thead>
            <tr>
              <th>帧 ID</th>
              <th>分支</th>
              <th>状态</th>
              <th>原因</th>
              <th>CFO 误差</th>
              <th>定时误差</th>
              <th>安全窗口</th>
              <th>位 / 错 / 擦除</th>
              <th>BER 界</th>
            </tr>
          </thead>
          <tbody>
            {result.results.flatMap((frame) =>
              (
                [
                  ["raw", frame.raw],
                  ["estimated", frame.estimated],
                  ["ideal", frame.ideal],
                ] as const
              ).map(([name, v]) => (
                <tr key={`${frame.frameId}-${name}`}>
                  <td>{frame.frameId}</td>
                  <th>{name}</th>
                  <td>{v.receiver.status}</td>
                  <td>
                    {v.receiver.status === "ok" ? "—" : v.receiver.reason}
                  </td>
                  <td>{show(v.cfoError)}</td>
                  <td>{show(v.timingError)}</td>
                  <td>
                    {v.windowSafe === null
                      ? "未知"
                      : v.windowSafe
                        ? "安全"
                        : "不安全"}
                  </td>
                  <td>
                    {v.metric.bits} / {v.metric.errors} / {v.metric.erasedBits}
                  </td>
                  <td>{bounds(v.ber)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <h3>四点受控干预</h3>
      <p>
        e 为残余 CFO，d 为相对真实 useful FFT 起点的采样偏移。零 e 或 d
        会使点位重合。
      </p>
      <div className="v15-scroll">
        <table>
          <thead>
            <tr>
              <th>点位</th>
              <th>位数</th>
              <th>误码</th>
              <th>擦除位</th>
              <th>BER 界</th>
              <th>区间</th>
            </tr>
          </thead>
          <tbody>
            {points.map(([name, v]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{v.metric.bits}</td>
                <td>{v.metric.errors}</td>
                <td>{v.metric.erasedBits}</td>
                <td>{bounds(v.ber)}</td>
                <td>
                  <BerBar name={name} value={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>逐帧干预状态</summary>
        <div className="v15-scroll">
          <table>
            <thead>
              <tr>
                <th>帧</th>
                <th>点位</th>
                <th>状态</th>
                <th>安全窗口</th>
                <th>位 / 错 / 擦除</th>
                <th>BER 界</th>
              </tr>
            </thead>
            <tbody>
              {result.results.flatMap((frame) =>
                (
                  [
                    ["(e,d)", frame.controlled.ed],
                    ["(e,0)", frame.controlled.e0],
                    ["(0,d)", frame.controlled.zD],
                    ["(0,0)", frame.controlled.z0],
                  ] as const
                ).map(([name, v]) => (
                  <tr key={`${frame.frameId}-${name}`}>
                    <td>{frame.frameId}</td>
                    <th>{name}</th>
                    <td>{v.status}</td>
                    <td>
                      {v.windowSafe === null
                        ? "未知"
                        : v.windowSafe
                          ? "安全"
                          : "不安全"}
                    </td>
                    <td>
                      {v.metric.bits} / {v.metric.errors} /{" "}
                      {v.metric.erasedBits}
                    </td>
                    <td>{bounds(v.ber)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      <h3>累计配对差及交互界</h3>
      <ul>
        {Object.entries(summary.paired).map(([name, value]) => (
          <li key={name}>
            {name}：{bounds(value)}
          </li>
        ))}
        <li>
          交互 B(e,d) − B(e,0) − B(0,d) + B(0,0)：{bounds(summary.interaction)}
        </li>
      </ul>
      <p>区间仅表示擦除引起的取值范围；各帧为配对工程结果。</p>
    </>
  );
}

export default function V15SyncComparison() {
  const [cp, setCp] = useState("16"),
    [cfo, setCfo] = useState("0.1"),
    [sto, setSto] = useState("0"),
    [phase, setPhase] = useState("0"),
    [noise, setNoise] = useState("0.01"),
    [residual, setResidual] = useState("0.1"),
    [delta, setDelta] = useState("0"),
    [ids, setIds] = useState("101"),
    [taps, setTaps] = useState('[{"delay":0,"i":1,"q":0}]');
  const [status, setStatus] = useState<State>({ state: "idle" }),
    [error, setError] = useState("");
  const controller = useRef<P1cController | null>(null);
  useEffect(
    () => () => {
      controller.current?.dispose();
      controller.current = null;
    },
    [],
  );
  const energy = useMemo(() => {
    try {
      const a: unknown = JSON.parse(taps);
      if (
        !Array.isArray(a) ||
        a.some(
          (x) =>
            !x ||
            typeof x.i !== "number" ||
            typeof x.q !== "number" ||
            !Number.isFinite(x.i) ||
            !Number.isFinite(x.q),
        )
      )
        return null;
      return a.reduce((s, x) => s + x.i * x.i + x.q * x.q, 0) as number;
    } catch {
      return null;
    }
  }, [taps]);
  function run() {
    if (controller.current?.state.state === "running") return;
    setError("");
    setStatus({ state: "idle" });
    try {
      if ([cp, cfo, sto, phase, noise, residual, delta].some((x) => !x.trim()))
        throw new Error("数值参数不能为空。");
      const parsed = ids.split(",").map((x) => x.trim());
      if (parsed.some((x) => !/^\d+$/.test(x)))
        throw new Error("帧 ID 必须是逗号分隔的非负整数。");
      const job = snapshotJob({
        type: "start",
        version: P1C_VERSION,
        runId: crypto.randomUUID(),
        config: {
          cp: Number(cp),
          cfo: Number(cfo),
          sto: Number(sto),
          phase: Number(phase),
          taps: JSON.parse(taps),
          noisePower: Number(noise),
        },
        frameIds: parsed.map(Number),
        intervention: {
          residualCfo: Number(residual),
          timingOffset: Number(delta),
        },
      });
      controller.current ??= new P1cController(
        () =>
          new Worker(
            new URL("../research-v15/p1c.worker.ts", import.meta.url),
            { type: "module" },
          ) as unknown as WorkerLike,
        setStatus,
      );
      controller.current.start(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const running = status.state === "running";
  return (
    <section className="v15-sync" aria-labelledby="v15-sync-title">
      <h2 id="v15-sync-title">v1.5 同步误差工程对照</h2>
      <p>
        engineering-test-only：测试随机域，结果仅供工程验证。ideal
        为真值辅助同步，不使用真实信道，也不校正真实相位。
      </p>
      <p>
        CFO 单位为子载波间隔；STO
        和定时偏移单位为采样点。不同信道能量下不能直接将 BER 差异归因于同步。
      </p>
      <div className="v15-controls">
        <label>
          注入 CFO
          <input
            type="number"
            min="-1"
            max="1"
            step="0.01"
            value={cfo}
            onChange={(e) => setCfo(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          注入 STO
          <input
            type="number"
            min="-16"
            max="16"
            step="1"
            value={sto}
            onChange={(e) => setSto(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          CP 长度
          <input
            type="number"
            min="0"
            max="32"
            step="1"
            value={cp}
            onChange={(e) => setCp(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          初始相位
          <input
            type="number"
            min={-Math.PI}
            max={Math.PI}
            step="0.01"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          噪声功率
          <input
            type="number"
            min="0"
            max="1000000"
            step="any"
            value={noise}
            onChange={(e) => setNoise(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          残余 CFO e
          <input
            type="number"
            min="-2"
            max="2"
            step="0.01"
            value={residual}
            onChange={(e) => setResidual(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          定时偏移 d
          <input
            type="number"
            step="1"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          工程帧 ID（1–16 个）
          <input
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          信道抽头 JSON
          <textarea
            value={taps}
            onChange={(e) => setTaps(e.target.value)}
            disabled={running}
          />
        </label>
      </div>
      <p>
        当前输入的信道抽头能量：{show(energy)}；噪声功率：{noise}
      </p>
      <button type="button" onClick={run} disabled={running}>
        运行工程对照
      </button>{" "}
      <button
        type="button"
        onClick={() => controller.current?.cancel()}
        disabled={!running}
      >
        取消工程对照
      </button>
      <p role="status">
        {status.state === "idle"
          ? "就绪"
          : status.state === "running"
            ? `计算中：${status.completed}/${status.total} 帧`
            : status.state === "completed"
              ? "工程对照完成"
              : status.state === "cancelled"
                ? "已取消；未发布部分批次结果"
                : "计算失败；未发布部分批次结果"}
      </p>
      {(error || status.state === "failed") && (
        <p role="alert">
          {error || (status.state === "failed" ? status.message : "")}
        </p>
      )}
      {status.state === "completed" && <Table result={status.result} />}
    </section>
  );
}
