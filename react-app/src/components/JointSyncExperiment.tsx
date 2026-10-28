import { useEffect, useRef, useState } from "react";
import {
  defaultJointPlan,
  freezeJointPlan,
  type JointPlan,
  type JointTrial,
} from "../lib/ofdmSync/jointEngine";
import {
  createJointRecord,
  readJointState,
  saveJointRecord,
  type JointRecord,
} from "../lib/ofdmSync/jointRecord";
import type { SyncMetric } from "../lib/ofdmSync/engine";
import {
  jointSourceFingerprint,
  matchesJointIdentity,
} from "../lib/ofdmSync/jointIdentity";
import "./JointSyncExperiment.css";

type Identity = {
  protocolHash: string;
  sourceFingerprint: string;
  runtimeFingerprint: string;
};
interface Active {
  worker: Worker;
  runId: string;
  plan: JointPlan;
  hash: string;
  source: string;
  identity: Identity | null;
  trials: JointTrial[];
  committing: boolean;
}
function bounds(metrics: SyncMetric[]) {
  const bits = metrics.reduce((s, m) => s + m.bits, 0),
    errors = metrics.reduce((s, m) => s + m.errors, 0),
    erasures = metrics.reduce((s, m) => s + m.erasedBits, 0);
  return {
    bits,
    errors,
    erasures,
    lower: bits ? errors / bits : 0,
    upper: bits ? (errors + erasures) / bits : 0,
  };
}
function download(record: JointRecord) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "signallab-v14-sync-record.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function JointSyncExperiment() {
  const [plan, setPlan] = useState(defaultJointPlan),
    [multipath, setMultipath] = useState(false);
  const [record, setRecord] = useState<JointRecord | null>(null),
    [status, setStatus] = useState("读取本地同步记录中…");
  const [error, setError] = useState(""),
    [running, setRunning] = useState(false),
    [saving, setSaving] = useState(false),
    [loaded, setLoaded] = useState(false);
  const revision = useRef(0),
    active = useRef<Active | null>(null),
    mounted = useRef(false),
    pending = useRef<symbol | null>(null);
  useEffect(() => {
    mounted.current = true;
    void readJointState()
      .then((state) => {
        if (!mounted.current) return;
        revision.current = state.revision;
        setRecord(state.record);
        setStatus(state.record ? "已恢复本地记录" : "尚无本地同步记录");
        setLoaded(true);
      })
      .catch((cause) => {
        if (!mounted.current) return;
        setError(
          cause instanceof Error ? cause.message : "无法读取本地同步记录",
        );
        setStatus("本地记录读取失败，已保留原数据");
        setLoaded(false);
      });
    return () => {
      mounted.current = false;
      pending.current = null;
      active.current?.worker.terminate();
      active.current = null;
    };
  }, []);
  const stop = () => {
    if (active.current?.committing) return;
    pending.current = null;
    active.current?.worker.terminate();
    active.current = null;
    setRunning(false);
    setStatus("计算已取消；未保存不完整记录");
  };
  async function run() {
    if (running || saving || !loaded || pending.current || active.current)
      return;
    setError("");
    setRunning(true);
    setStatus("正在冻结同步协议…");
    const token = Symbol("joint-run");
    pending.current = token;
    try {
      const frozen = await freezeJointPlan({
        ...plan,
        taps: multipath
          ? [
              { delay: 0, i: 0.8, q: 0.1 },
              { delay: 3, i: 0.2, q: -0.1 },
              { delay: 7, i: 0.1, q: 0.05 },
            ]
          : [{ delay: 0, i: 1, q: 0 }],
      });
      const source = await jointSourceFingerprint();
      if (!mounted.current || pending.current !== token) return;
      const worker = new Worker(
        new URL("../workers/jointSync.worker.ts", import.meta.url),
        { type: "module" },
      );
      const runId = crypto.randomUUID(),
        run: Active = {
          worker,
          runId,
          plan: frozen.plan,
          hash: frozen.protocolHash,
          source,
          identity: null,
          trials: [],
          committing: false,
        };
      active.current = run;
      pending.current = null;
      const fail = (cause: unknown) => {
        if (active.current !== run) return;
        worker.terminate();
        active.current = null;
        setRunning(false);
        setSaving(false);
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("计算或保存失败；已有记录保持不变");
      };
      worker.onerror = () => fail(new Error("同步 Worker 运行失败。"));
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (active.current !== run || run.committing) return;
        const v = event.data as {
          type?: unknown;
          runId?: unknown;
          engineVersion?: unknown;
          protocolHash?: unknown;
          sourceFingerprint?: unknown;
          runtimeFingerprint?: unknown;
          trials?: unknown;
          completed?: unknown;
          message?: unknown;
        };
        if (!v || v.runId !== runId) return;
        if (v.type === "error") {
          fail(
            new Error(
              typeof v.message === "string" ? v.message : "同步 Worker 错误",
            ),
          );
          return;
        }
        if (
          !matchesJointIdentity(v, run.source, run.hash) ||
          typeof v.sourceFingerprint !== "string" ||
          typeof v.runtimeFingerprint !== "string"
        ) {
          fail(new Error("同步 Worker 身份不匹配。"));
          return;
        }
        const identity = {
          protocolHash: run.hash,
          sourceFingerprint: v.sourceFingerprint,
          runtimeFingerprint: v.runtimeFingerprint,
        };
        if (v.type === "ready") {
          if (run.identity) {
            fail(new Error("同步 Worker 重复初始化。"));
            return;
          }
          run.identity = identity;
          setStatus("同步计算中…");
          return;
        }
        if (
          !run.identity ||
          run.identity.sourceFingerprint !== identity.sourceFingerprint ||
          run.identity.runtimeFingerprint !== identity.runtimeFingerprint
        ) {
          fail(new Error("同步 Worker 身份变化。"));
          return;
        }
        if (v.type === "batch") {
          if (
            !Array.isArray(v.trials) ||
            !v.trials.length ||
            v.trials.some((t, i) => !t || t.index !== run.trials.length + i) ||
            v.completed !== run.trials.length + v.trials.length ||
            Number(v.completed) > run.plan.trials
          ) {
            fail(new Error("同步帧序列无效。"));
            return;
          }
          run.trials.push(...(v.trials as JointTrial[]));
          setStatus(`同步计算中：${run.trials.length}/${run.plan.trials} 帧`);
          return;
        }
        if (v.type === "done") {
          if (
            v.completed !== run.plan.trials ||
            run.trials.length !== run.plan.trials
          ) {
            fail(new Error("同步结果不完整。"));
            return;
          }
          run.committing = true;
          setSaving(true);
          setStatus("正在校验并保存完整结果…");
          void (async () => {
            try {
              const result = await createJointRecord(
                run.plan,
                run.trials,
                identity,
              );
              if (active.current !== run) return;
              setRecord(result);
              try {
                revision.current = await saveJointRecord(
                  result,
                  revision.current,
                );
                if (active.current === run) setStatus("同步完成，已保存本地");
              } catch (cause) {
                if (active.current === run) {
                  setError(
                    cause instanceof Error ? cause.message : "本地保存失败",
                  );
                  setStatus("同步完成，保存失败；可导出当前结果");
                }
              }
              if (active.current === run) {
                worker.terminate();
                active.current = null;
                setRunning(false);
                setSaving(false);
              }
            } catch (cause) {
              fail(cause);
            }
          })();
        }
      };
      try {
        worker.postMessage({ type: "start", runId, plan: frozen.plan });
      } catch (cause) {
        fail(cause);
      }
    } catch (cause) {
      if (mounted.current && pending.current === token) {
        pending.current = null;
        setRunning(false);
        setError(cause instanceof Error ? cause.message : "同步计划无效");
        setStatus("同步计划未运行");
      }
    }
  }
  const rows = record
    ? [
        { name: "未同步", metrics: record.trials.map((t) => t.raw) },
        { name: "理想同步", metrics: record.trials.map((t) => t.ideal) },
        {
          name: "估计同步",
          metrics: record.trials.map((t) => t.estimated.metric),
        },
      ]
    : [];
  const acquired =
    record?.trials.filter((t) => t.estimated.status === "ok") ?? [];
  const cfoMean = acquired.length
    ? acquired.reduce(
        (sum, t) => sum + (t.estimated.status === "ok" ? t.estimated.cfo : 0),
        0,
      ) / acquired.length
    : null;
  const cfoRmse = acquired.length
    ? Math.sqrt(
        acquired.reduce(
          (sum, t) => sum + (t.evaluation.cfoError ?? 0) ** 2,
          0,
        ) / acquired.length,
      )
    : null;
  return (
    <section className="joint-sync" aria-labelledby="joint-sync-title">
      <h2 id="joint-sync-title">OFDM 接收同步</h2>
      <p>
        同一接收波形对照 CFO
        与整数定时偏移；估计器只使用接收采样和公开训练。N=128、QPSK、4
        个数据符号。
      </p>
      <div className="joint-sync-controls">
        <label>
          归一化频偏{" "}
          <input
            type="number"
            min="-1"
            max="1"
            step="0.05"
            value={plan.cfo}
            disabled={running}
            onChange={(e) => setPlan({ ...plan, cfo: Number(e.target.value) })}
          />
        </label>
        <label>
          初始相位（弧度）{" "}
          <input
            type="number"
            min={-Math.PI}
            max={Math.PI}
            step="0.1"
            value={plan.phase}
            disabled={running}
            onChange={(e) =>
              setPlan({ ...plan, phase: Number(e.target.value) })
            }
          />
        </label>
        <label>
          整数定时偏移{" "}
          <input
            type="number"
            min="-16"
            max="16"
            step="1"
            value={plan.sto}
            disabled={running}
            onChange={(e) => setPlan({ ...plan, sto: Number(e.target.value) })}
          />
        </label>
        <label>
          循环前缀长度{" "}
          <input
            type="number"
            min="0"
            max="32"
            step="1"
            value={plan.cp}
            disabled={running}
            onChange={(e) => setPlan({ ...plan, cp: Number(e.target.value) })}
          />
        </label>
        <label>
          同步 Eb/N0 (dB){" "}
          <input
            type="number"
            min="-10"
            max="40"
            step="1"
            value={plan.ebN0Db}
            disabled={running}
            onChange={(e) =>
              setPlan({ ...plan, ebN0Db: Number(e.target.value) })
            }
          />
        </label>
        <label>
          同步试验帧数{" "}
          <input
            type="number"
            min="2"
            max="1000"
            step="1"
            value={plan.trials}
            disabled={running}
            onChange={(e) =>
              setPlan({ ...plan, trials: Number(e.target.value) })
            }
          />
        </label>
        <label>
          同步随机种子{" "}
          <input
            type="number"
            min="0"
            max="4294967295"
            step="1"
            value={plan.seed}
            disabled={running}
            onChange={(e) => setPlan({ ...plan, seed: Number(e.target.value) })}
          />
        </label>
        <label>
          同步信道{" "}
          <select
            value={multipath ? "multipath" : "awgn"}
            disabled={running}
            onChange={(e) => setMultipath(e.target.value === "multipath")}
          >
            <option value="awgn">AWGN</option>
            <option value="multipath">固定三径</option>
          </select>
        </label>
        <label>
          能量口径{" "}
          <select
            value={plan.energyBasis}
            disabled={running}
            onChange={(e) =>
              setPlan({
                ...plan,
                energyBasis: e.target.value as JointPlan["energyBasis"],
              })
            }
          >
            <option value="data-eb">数据 Eb/N0</option>
            <option value="total-eb">总发送 Eb/N0（含前导）</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={plan.noiseEnabled}
            disabled={running}
            onChange={(e) =>
              setPlan({ ...plan, noiseEnabled: e.target.checked })
            }
          />{" "}
          添加噪声
        </label>
      </div>
      <p>
        频偏主值范围为 [−1,1)，可能出现别名；短
        CP、噪声或多径可能导致捕获失败或错误，估计同步不保证改善 BER。
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || saving || !loaded}
      >
        运行同步对照
      </button>{" "}
      <button type="button" onClick={stop} disabled={!running || saving}>
        取消同步计算
      </button>{" "}
      <button
        type="button"
        onClick={() => record && download(record)}
        disabled={!record}
      >
        导出同步记录
      </button>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {record && (
        <div className="joint-sync-results">
          <p>
            完成 {record.trials.length} 帧；方案 CFO={record.plan.cfo}、STO=
            {record.plan.sto}，协议 {record.protocolHash.slice(0, 12)}…
          </p>
          <table>
            <thead>
              <tr>
                <th>接收分支</th>
                <th>误码 / 总位</th>
                <th>擦除位</th>
                <th>BER 下界–上界</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const v = bounds(row.metrics);
                return (
                  <tr key={row.name}>
                    <th>{row.name}</th>
                    <td>
                      {v.errors} / {v.bits}
                    </td>
                    <td>{v.erasures}</td>
                    <td>
                      {v.lower.toFixed(5)}–{v.upper.toFixed(5)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            采集失败{" "}
            {
              record.trials.filter((t) => t.estimated.status === "failed")
                .length
            }{" "}
            / {record.trials.length}{" "}
            帧。安全窗口统计使用仿真真值，仅用于事后评价：
            {
              record.trials.filter(
                (t) => t.evaluation.estimatedWindowSafe === true,
              ).length
            }{" "}
            / {record.trials.length} 帧。
          </p>
          <p>
            频偏估计均值：{cfoMean === null ? "不可用" : cfoMean.toFixed(5)}；
            频偏误差 RMSE：{cfoRmse === null ? "不可用" : cfoRmse.toFixed(5)}。
            上述指标仅针对 {acquired.length}{" "}
            个采集成功帧，误差使用真值事后评价。
          </p>
        </div>
      )}
    </section>
  );
}
