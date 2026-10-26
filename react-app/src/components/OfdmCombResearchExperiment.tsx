import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultOfdmCombPlan,
  countPilots,
  spacedPilots,
  freezeOfdmCombPlan,
  workUnits,
  OFDM_COMB_ENGINE,
} from "../lib/ofdmCombProtocol";
import { energyBudget } from "../lib/ofdmCombEnergy";
import {
  ofdmCombSourceFingerprint,
  handshakeOfdmCombWorker,
  type OfdmCombIdentity,
} from "../lib/ofdmCombIdentity";
import {
  assertOfdmCombResumeIdentity,
  assertOfdmCombCompletedPrefix,
  serializeOfdmCombCheckpoint,
  makeOfdmCombCheckpoint,
  parseOfdmCombCheckpoint,
  validateOfdmCombTrial,
  OFDM_COMB_RECORD_BYTES,
  type OfdmCombCheckpoint,
  type OfdmCombRecord,
} from "../lib/ofdmCombResearchRecord";
import {
  readOfdmCombRawState,
  validateOfdmCombStoredState,
  saveOfdmCombCheckpoint,
  saveOfdmCombRecord,
} from "../lib/ofdmCombResearchStore";
import type {
  OfdmCombChannel,
  OfdmCombPlan,
  OfdmCombTrial,
} from "../lib/ofdmCombTypes";
import OfdmCombResearchCharts from "./OfdmCombResearchCharts";
import "./OfdmResearchExperiment.css";
interface Active {
  worker: Worker;
  runId: string;
  checkpoint: OfdmCombCheckpoint;
  trials: OfdmCombTrial[];
  identity: OfdmCombIdentity;
  started: number;
}
const numbers = (text: string) =>
  text.split(",").map((v) => {
    if (!v.trim() || !Number.isFinite(Number(v)))
      throw new Error("列表需使用逗号分隔的有限数。");
    return Number(v);
  });
const message = (e: unknown) =>
  e instanceof Error ? e.message : "OFDM 操作失败；请导出内存结果。";
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function OfdmCombResearchExperiment() {
  const [pilotMode, setPilotMode] = useState<"count" | "spacing" | "manual">(
    "count",
  );
  const [pilotSpec, setPilotSpec] = useState("4,8");
  const [form, setForm] = useState(() => defaultOfdmCombPlan());
  const [carriers, setCarriers] = useState("48"),
    [snr, setSnr] = useState("0,8,16"),
    [delays, setDelays] = useState("0,1,3,7"),
    [pdp, setPdp] = useState("0,-3,-6,-9"),
    [gains, setGains] = useState("1:0,0.2:0.1,0.1:-0.05,0.05:0");
  const [status, setStatus] = useState("正在读取本地 OFDM 历史…"),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<OfdmCombRecord | null>(null),
    [checkpoint, setCheckpoint] = useState<OfdmCombCheckpoint | null>(null),
    [history, setHistory] = useState<OfdmCombRecord[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const active = useRef<Active | null>(null),
    pending = useRef<{ worker: Worker; controller: AbortController } | null>(
      null,
    ),
    launch = useRef<symbol | null>(null),
    mounted = useRef(false),
    revision = useRef(0),
    blocked = useRef(false),
    serial = useRef<Promise<unknown>>(Promise.resolve()),
    rawStored = useRef<unknown>(null);
  const prepared = useMemo(() => {
    try {
      const carrierValues = numbers(carriers),
        a = carrierValues[0];
      if (
        carrierValues.length !== 1 ||
        !Number.isInteger(a) ||
        a < 1 ||
        a >= form.fftSize / 2
      )
        throw new Error("每侧活动载波需为 1 到 N/2−1 的整数。");
      const d = numbers(delays),
        powers = numbers(pdp),
        h = gains.split(",").map((pair) => {
          const v = pair.split(":");
          if (v.length !== 2) throw new Error("固定增益格式为 I:Q。");
          return v.map((x) => {
            if (!x.trim() || !Number.isFinite(Number(x)))
              throw new Error("固定增益必须有限。");
            return Number(x);
          });
        });
      if (d.length !== powers.length || d.length !== h.length)
        throw new Error("时延、PDP 与固定增益列表长度必须相同。");
      const plan: OfdmCombPlan = {
        ...form,
        activeBins: Array.from({ length: 2 * a }, (_, j) =>
          j < a ? j - a : j - a + 1,
        ),
        ebN0Db: numbers(snr),
        taps: d.map((delay, j) => ({
          delay,
          i: h[j][0],
          q: h[j][1],
          power: 10 ** (powers[j] / 10),
        })),
      };
      plan.pilotLayouts =
        pilotMode === "manual"
          ? pilotSpec.split(";").map(numbers)
          : numbers(pilotSpec).map((v) =>
              pilotMode === "count"
                ? countPilots(plan.activeBins, v)
                : spacedPilots(plan.activeBins, v),
            );
      return { plan, budget: energyBudget(plan), error: "" };
    } catch (e) {
      return { plan: null, budget: null, error: message(e) };
    }
  }, [form, carriers, snr, delays, pdp, gains, pilotMode, pilotSpec]);
  const persist = useCallback((value: OfdmCombCheckpoint) => {
    const job = serial.current.then(async () => {
      if (blocked.current)
        throw new Error("本地保存已暂停；请导出当前结果后重新加载。");
      try {
        revision.current =
          value.status === "complete"
            ? await saveOfdmCombRecord(
                value as OfdmCombRecord,
                revision.current,
              )
            : await saveOfdmCombCheckpoint(value, revision.current);
      } catch (e) {
        blocked.current = true;
        if (mounted.current) setShowOriginal(rawStored.current !== null);
        throw e;
      }
    });
    serial.current = job.catch(() => {});
    return job;
  }, []);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void (async () => {
      try {
        const raw = await readOfdmCombRawState();
        if (disposed) return;
        rawStored.current = raw ?? null;
        const state = validateOfdmCombStoredState(raw);
        revision.current = state.revision;
        const cp =
          state.checkpoint !== null
            ? await parseOfdmCombCheckpoint(state.checkpoint)
            : null;
        const records = await Promise.all(
          state.records.map(parseOfdmCombCheckpoint),
        );
        if (disposed) return;
        if (
          records.some((r) => r.status !== "complete") ||
          cp?.status === "complete"
        )
          throw new Error("OFDM 本地记录状态损坏，已保留原文。");
        setHistory(records as OfdmCombRecord[]);
        setCheckpoint(cp);
        if (cp)
          setStatus(
            `已恢复检查点：${cp.trials.length}/${cp.plan.trials} 帧；未发布统计区间。`,
          );
        else if (records.length) {
          setRecord(records[0] as OfdmCombRecord);
          setStatus("已恢复本地完整记录。");
        } else setStatus("就绪；OFDM 记录仅保存在本机。");
      } catch (e) {
        if (!disposed) {
          blocked.current = true;
          setShowOriginal(rawStored.current !== null);
          setError(message(e));
          setStatus("可在内存中运行并导出；原本地数据保持原样。");
        }
      } finally {
        if (!disposed) setLoaded(true);
      }
    })();
    return () => {
      disposed = true;
      mounted.current = false;
      launch.current = null;
      pending.current?.controller.abort();
      pending.current?.worker.terminate();
      pending.current = null;
      const run = active.current;
      if (run) {
        active.current = null;
        run.worker.terminate();
        void makeOfdmCombCheckpoint(run.checkpoint, run.trials, run.identity)
          .then(persist)
          .catch(() => {});
      }
    };
  }, [persist]);
  async function stop(reason: string) {
    if (pending.current) {
      launch.current = null;
      pending.current.controller.abort();
      pending.current.worker.terminate();
      pending.current = null;
      setRunning(false);
      setBusy(false);
      setStatus(`${reason}：初始化尚未发送数据；原检查点保留。`);
      return;
    }
    const run = active.current;
    if (!run) return;
    active.current = null;
    run.worker.terminate();
    setRunning(false);
    setBusy(true);
    setStatus(
      `正在保存已验证前缀：${run.trials.length}/${run.checkpoint.plan.trials} 帧。`,
    );
    try {
      const cp = await makeOfdmCombCheckpoint(
        run.checkpoint,
        run.trials,
        run.identity,
      );
      if (mounted.current) setCheckpoint(cp);
      await persist(cp);
      if (mounted.current)
        setStatus(
          `${reason}：检查点 ${cp.trials.length}/${cp.plan.trials} 帧已保存；未发布统计区间。`,
        );
    } catch (e) {
      if (mounted.current) {
        setError(message(e));
        setStatus(`${reason}；检查点仅保留在内存中，请导出。`);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function start(resume: boolean) {
    if (active.current || busy) return;
    const epoch = Symbol("ofdm-launch");
    launch.current = epoch;
    setBusy(true);
    setError("");
    let startingWorker: Worker | undefined;
    try {
      const sourceFingerprint = await ofdmCombSourceFingerprint();
      const frozen =
        resume && checkpoint
          ? await parseOfdmCombCheckpoint(checkpoint)
          : prepared.plan
            ? await freezeOfdmCombPlan(prepared.plan)
            : null;
      if (!frozen) throw new Error(prepared.error || "OFDM 方案无效。");
      if (!mounted.current || epoch !== launch.current) return;
      const worker = new Worker(
        new URL("../workers/ofdmCombResearch.worker.ts", import.meta.url),
        { type: "module" },
      );
      startingWorker = worker;
      const runId = crypto.randomUUID(),
        controller = new AbortController();
      pending.current = { worker, controller };
      setRunning(true);
      setStatus("正在初始化 OFDM 数值 Worker。");
      const identity = await handshakeOfdmCombWorker(
        worker,
        runId,
        sourceFingerprint,
        controller.signal,
      );
      if (resume && checkpoint)
        assertOfdmCombResumeIdentity(checkpoint, identity);
      const cp =
        resume && checkpoint
          ? checkpoint
          : await makeOfdmCombCheckpoint(frozen, [], identity);
      if (!mounted.current || epoch !== launch.current) return;
      pending.current = null;
      const run: Active = {
        worker,
        runId,
        checkpoint: cp,
        trials: [...cp.trials],
        identity,
        started: performance.now(),
      };
      active.current = run;
      setRecord(null);
      setCheckpoint(null);
      setRunning(true);
      setStatus(`计算中：${run.trials.length}/${cp.plan.trials} 帧。`);
      worker.onmessage = (event: MessageEvent<unknown>) => {
        void (async () => {
          if (active.current !== run) return;
          const v = event.data as {
            type?: unknown;
            runId?: unknown;
            protocolHash?: unknown;
            engineVersion?: unknown;
            sourceFingerprint?: unknown;
            runtimeFingerprint?: unknown;
            trials?: unknown[];
            completed?: unknown;
            record?: unknown;
            message?: unknown;
          };
          if (!v || v.runId !== run.runId) return;
          if (v.type === "ready") return;
          try {
            if (
              v.engineVersion !== OFDM_COMB_ENGINE ||
              v.sourceFingerprint !== identity.sourceFingerprint
            )
              throw new Error("OFDM Worker 源码或引擎身份不匹配。");
            if (v.runtimeFingerprint !== identity.runtimeFingerprint)
              throw new Error("OFDM Worker 数值运行时身份不匹配。");
            if (v.type === "error")
              throw new Error(
                typeof v.message === "string"
                  ? v.message
                  : "OFDM Worker 计算失败。",
              );
            if (v.protocolHash !== cp.protocolHash)
              throw new Error("OFDM Worker 协议身份不匹配。");
            if (v.type === "batch") {
              if (
                !Array.isArray(v.trials) ||
                !v.trials.length ||
                v.trials.length > cp.plan.trials - run.trials.length ||
                v.completed !== run.trials.length + v.trials.length
              )
                throw new Error("OFDM Worker 批次不连续。");
              v.trials.forEach((t, j) =>
                validateOfdmCombTrial(cp.plan, t, run.trials.length + j),
              );
              run.trials.push(...(v.trials as OfdmCombTrial[]));
              setStatus(`计算中：${run.trials.length}/${cp.plan.trials} 帧。`);
            } else if (v.type === "done") {
              const done = await parseOfdmCombCheckpoint(v.record);
              if (active.current !== run) return;
              if (
                done.status !== "complete" ||
                done.protocolHash !== cp.protocolHash ||
                done.trials.length !== run.trials.length
              )
                throw new Error("OFDM 完成消息无效。");
              assertOfdmCombResumeIdentity(done, identity);
              assertOfdmCombCompletedPrefix(done, run.trials);
              active.current = null;
              worker.terminate();
              setRunning(false);
              setBusy(true);
              setRecord(done as OfdmCombRecord);
              const elapsed = (performance.now() - run.started) / 1000;
              setStatus(
                `实验完成：${done.trials.length} 帧，用时 ${elapsed.toFixed(2)} 秒；正在保存。`,
              );
              try {
                await persist(done);
                if (mounted.current) {
                  setHistory((h) =>
                    [
                      done as OfdmCombRecord,
                      ...h.filter(
                        (x) => x.integrityHash !== done.integrityHash,
                      ),
                    ].slice(0, 2),
                  );
                  setStatus(
                    `实验完成：${done.trials.length} 帧，用时 ${elapsed.toFixed(2)} 秒；已保存本地。`,
                  );
                }
              } catch (e) {
                if (mounted.current) setError(message(e));
              } finally {
                if (mounted.current) setBusy(false);
              }
            } else
              throw new Error(
                typeof v.message === "string"
                  ? v.message
                  : "OFDM Worker 消息无效。",
              );
          } catch (e) {
            if (active.current === run) {
              setError(message(e));
              await stop("计算失败");
            }
          }
        })();
      };
      worker.onerror = () => {
        if (active.current !== run) return;
        setError("OFDM Worker 异常终止；保留已验证前缀。");
        void stop("计算失败");
      };
      worker.postMessage({ type: "start", runId: run.runId, checkpoint: cp });
    } catch (e) {
      if (mounted.current && epoch === launch.current) setError(message(e));
    } finally {
      if (startingWorker && pending.current?.worker === startingWorker) {
        pending.current.controller.abort();
        startingWorker.terminate();
        pending.current = null;
        if (mounted.current && epoch === launch.current) setRunning(false);
      }
      if (mounted.current && epoch === launch.current) setBusy(false);
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > OFDM_COMB_RECORD_BYTES)
        throw new Error("导入文件超过 8 MiB。");
      const text = await file.text();
      if (
        (JSON.parse(text) as { engineVersion?: unknown }).engineVersion ===
        "ofdm-v13.1"
      )
        throw new Error(
          "这是旧全训练记录，请切换到全训练基线模式导入；原文件未更改。",
        );
      const value = await parseOfdmCombCheckpoint(text);
      if (value.status === "complete") {
        setRecord(value as OfdmCombRecord);
        setCheckpoint(null);
      } else {
        setCheckpoint(value);
        setRecord(null);
      }
      await persist(value);
      setStatus(
        value.status === "complete"
          ? "已导入并保存完整 OFDM 记录。"
          : "已导入 OFDM 检查点；继续前将校验源码与运行时。",
      );
      if (value.status === "complete")
        setHistory((h) => [value as OfdmCombRecord, ...h].slice(0, 2));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const disabled = running || busy || !loaded,
    view = record ?? checkpoint;
  return (
    <section className="ofdm-research" aria-labelledby="ofdm-title">
      <h2 id="ofdm-title">OFDM 梳状导频与插值</h2>
      <p>
        v1.3 第二阶段 · 同帧比较 ideal、全训练 LS、梳状导频 LS +
        复数线性插值。单位酉 FFT，连续时域 FIR，帧内静态 SISO。
      </p>
      <details>
        <summary>数学约定与模型边界</summary>
        <p>
          Eb,data=1，Es=log₂M。全训练符号和每个数据符号内的梳状导频使用公开
          QPSK，Ep=Es；训练、导频、CP 全部计入 total Eb。每复采样噪声为
          CN(0,N0)。Rayleigh 只归一化 PDP，随机抽头不逐帧归一化。真值仅用于
          ideal CSI 和事后评价。
        </p>
        <p>
          同 CSI、增益感知硬判决下 ZF/MMSE BER 应一致；比较其原始输出 MSE
          与数值行为。固定多径使用输入的复增益，不自动归一化。每帧从零前史开始，帧内不重置信道。
        </p>
      </details>
      <fieldset disabled={disabled}>
        <legend>冻结实验方案</legend>
        <div className="ofdm-controls">
          <label>
            导频布局方式
            <select
              value={pilotMode}
              onChange={(e) => {
                const mode = e.target.value as typeof pilotMode;
                setPilotMode(mode);
                setPilotSpec(
                  mode === "count"
                    ? "4,8"
                    : mode === "spacing"
                      ? "14,7"
                      : "-48,-16,16,48",
                );
              }}
            >
              <option value="count">按数量</option>
              <option value="spacing">按有符号频率间隔</option>
              <option value="manual">手动位置</option>
            </select>
          </label>
          <label>
            {pilotMode === "count"
              ? "导频数量列表"
              : pilotMode === "spacing"
                ? "导频间隔列表"
                : "导频位置列表（分号分隔布局）"}
            <input
              value={pilotSpec}
              onChange={(e) => setPilotSpec(e.target.value)}
              maxLength={20000}
            />
          </label>
        </div>
        <p>
          最多三个布局；必须包含活动频带两端，保留共同数据位置。跨 DC
          使用真实频率距离；手动输入不补端点、不外推。
        </p>
        <div className="ofdm-controls">
          <label>
            OFDM FFT 长度
            <select
              value={form.fftSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                setForm({ ...form, fftSize: n });
                setCarriers(String((3 * n) / 8));
              }}
            >
              {[64, 128, 256, 512, 1024].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            OFDM CP 长度
            <input
              type="number"
              min="0"
              max={form.fftSize}
              value={Number.isFinite(form.cp) ? form.cp : ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  cp: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            OFDM 每侧活动载波
            <input
              value={carriers}
              onChange={(e) => setCarriers(e.target.value)}
              maxLength={4}
            />
          </label>
          <label>
            OFDM 数据符号数
            <input
              type="number"
              min="1"
              max="8"
              value={form.dataSymbols}
              onChange={(e) =>
                setForm({ ...form, dataSymbols: Number(e.target.value) })
              }
            />
          </label>
          <label>
            OFDM 调制
            <select
              value={form.modulation}
              onChange={(e) =>
                setForm({
                  ...form,
                  modulation: e.target.value as OfdmCombPlan["modulation"],
                })
              }
            >
              {["BPSK", "QPSK", "16QAM"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            OFDM 试验帧数
            <input
              type="number"
              min="2"
              max="4000"
              value={form.trials}
              onChange={(e) =>
                setForm({ ...form, trials: Number(e.target.value) })
              }
            />
          </label>
          <label>
            OFDM 种子
            <input
              type="number"
              min="0"
              max="4294967295"
              value={Number.isFinite(form.seed) ? form.seed : ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  seed: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            OFDM Eb/N0 列表
            <input
              value={snr}
              onChange={(e) => setSnr(e.target.value)}
              maxLength={100}
            />
          </label>
          <label>
            OFDM 能量口径
            <select
              value={form.energyBasis}
              onChange={(e) =>
                setForm({
                  ...form,
                  energyBasis: e.target.value as OfdmCombPlan["energyBasis"],
                })
              }
            >
              <option value="data-eb">data Eb/N0</option>
              <option value="total-eb">total Eb/N0（含训练、导频与 CP）</option>
            </select>
          </label>
          <label>
            OFDM 路径时延
            <input
              value={delays}
              onChange={(e) => setDelays(e.target.value)}
              maxLength={128}
            />
          </label>
          <label>
            OFDM 相对 PDP dB
            <input
              value={pdp}
              onChange={(e) => setPdp(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            OFDM 固定抽头 I:Q
            <input
              value={gains}
              onChange={(e) => setGains(e.target.value)}
              maxLength={256}
            />
          </label>
        </div>
        <div className="ofdm-actions">
          {(["awgn", "rayleigh", "fixed"] as OfdmCombChannel[]).map(
            (channel) => (
              <label key={channel}>
                <input
                  type="checkbox"
                  checked={form.channels.includes(channel)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      channels: e.target.checked
                        ? [...form.channels, channel]
                        : form.channels.filter((c) => c !== channel),
                    })
                  }
                />
                {channel}
              </label>
            ),
          )}
          <label>
            <input
              type="checkbox"
              checked={form.noiseEnabled}
              onChange={(e) =>
                setForm({ ...form, noiseEnabled: e.target.checked })
              }
            />
            OFDM 启用噪声
          </label>
        </div>
      </fieldset>
      {prepared.error && <p className="ofdm-warning">{prepared.error}</p>}
      {prepared.budget && prepared.plan && (
        <div className="ofdm-budget">
          {prepared.plan.pilotLayouts.map((positions, j) => {
            const b = energyBudget(prepared.plan!, j);
            return (
              <p key={j}>
                布局 {j + 1}：P={positions.length}，位置 [{positions.join(", ")}
                ]；实际间隔 [
                {positions
                  .slice(1)
                  .map((q, k) => q - positions[k])
                  .join(", ")}
                ]。数据有效比例 {(100 * b.dataFraction).toFixed(2)}
                %，数据符号内导频 {(100 * b.combPilotFraction).toFixed(2)}
                %，全帧训练+导频 RE {(100 * b.pilotReFraction).toFixed(2)}
                %；信息位 {b.informationBits}，Eb,total=
                {b.expectedEbTotal.toFixed(6)}，{b.bitsPerSample.toFixed(4)}{" "}
                bits/complex sample。
              </p>
            );
          })}
          <p>
            三种 CSI 共用同一发送帧：一个全训练符号 +
            含梳状导频的数据符号。所有分支均承担训练、导频和 CP
            开销；跨布局配对结果只使用共同数据载波。
          </p>
          <svg
            viewBox="0 0 740 80"
            role="img"
            aria-label="OFDM 训练与梳状导频资源栅格（布局一）"
            style={{ width: "100%", height: "auto" }}
          >
            {[0, 1].map((row) =>
              Array.from({ length: prepared.plan!.fftSize }, (_, k) => {
                const pilot = prepared.plan!.pilotLayouts[0].includes(
                  k - prepared.plan!.fftSize / 2,
                );
                const active = prepared.plan!.activeBins.includes(
                  k - prepared.plan!.fftSize / 2,
                );
                return (
                  <rect
                    key={`${row}-${k}`}
                    x={40 + (k * 650) / prepared.plan!.fftSize}
                    y={10 + row * 30}
                    width={650 / prepared.plan!.fftSize}
                    height="20"
                    fill={
                      active
                        ? row && !pilot
                          ? "#2196a0"
                          : "#dd8b31"
                        : "#abb3c0"
                    }
                  />
                );
              }),
            )}
            <text x="0" y="25" fill="currentColor" fontSize="10">
              训练
            </text>
            <text x="0" y="55" fill="currentColor" fontSize="10">
              数据
            </text>
            <text x="40" y="78" fill="currentColor" fontSize="10">
              负频率 → DC →
              正频率；灰色为空载波，橙色训练/导频，青色数据；此图为布局一
            </text>
          </svg>
          <p>
            N={prepared.plan.fftSize}，DC/保护载波为空；每帧 1 个全训练符号 +{" "}
            {prepared.plan.dataSymbols} 个数据符号，信息位{" "}
            {prepared.budget.informationBits}。计划{" "}
            {prepared.plan.trials *
              prepared.plan.channels.length *
              prepared.plan.ebN0Db.length *
              prepared.plan.pilotLayouts.length}{" "}
            cell-frame / {workUnits(prepared.plan).toLocaleString()} work-unit。
          </p>
          <p>
            多径声明的最大时延 Dmax={prepared.plan.taps.at(-1)!.delay}，CP=
            {prepared.plan.cp}。
            {prepared.plan.cp >= prepared.plan.taps.at(-1)!.delay
              ? "满足固定定时下的 CP 充分条件。"
              : "CP 可能不足；将保留连续卷积产生的 ISI/ICI。"}
          </p>
          <p>
            期望 useful 能量 {prepared.budget.expectedUsefulEnergy.toFixed(4)}
            ，CP 能量 {prepared.budget.expectedCpEnergy.toFixed(4)}（训练 CP{" "}
            {prepared.budget.trainingCpEnergy.toFixed(4)}），总能量{" "}
            {prepared.budget.expectedTotalEnergy.toFixed(4)}，Eb,total=
            {prepared.budget.expectedEbTotal.toFixed(6)}。
          </p>
          <p>
            CP 样本占比 {(100 * prepared.budget.cpSampleFraction).toFixed(2)}
            %；训练 RE 占比{" "}
            {(100 * prepared.budget.trainingReFraction).toFixed(
              2,
            )}%；空载波占比 {(100 * prepared.budget.nullFraction).toFixed(2)}%；
            {prepared.budget.bitsPerSample.toFixed(4)} bits/complex
            sample。比值的分母不同。
          </p>
        </div>
      )}
      <div className="ofdm-actions">
        <button
          type="button"
          disabled={disabled || !prepared.plan}
          onClick={() => void start(false)}
        >
          冻结 OFDM 协议并运行
        </button>
        <button
          type="button"
          disabled={!running}
          onClick={() => void stop("已取消")}
        >
          取消 OFDM 计算
        </button>
        <button
          type="button"
          disabled={disabled || !checkpoint}
          onClick={() => void start(true)}
        >
          继续 OFDM 检查点
        </button>
        <button
          type="button"
          disabled={running || busy || !view}
          onClick={() => {
            if (view)
              download(
                serializeOfdmCombCheckpoint(view),
                "signallab-ofdm-comb-v13.json",
              );
          }}
        >
          导出 OFDM JSON
        </button>
        <label className="ofdm-import">
          导入 OFDM JSON
          <input
            type="file"
            accept="application/json,.json"
            disabled={disabled}
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {showOriginal && (
          <button
            type="button"
            onClick={() =>
              download(
                JSON.stringify(rawStored.current),
                "ofdm-original-local.json",
              )
            }
          >
            导出原本地数据
          </button>
        )}
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && <p role="alert">{error}</p>}
      {history.length > 0 && (
        <details>
          <summary>本地完整历史（最多两条）</summary>
          {history.map((r, j) => (
            <button
              type="button"
              key={`${r.integrityHash}-${j}`}
              disabled={disabled}
              onClick={() => {
                setRecord(r);
                setStatus("已选择本地完整记录。");
              }}
            >
              {r.plan.modulation} / N{r.plan.fftSize} / seed {r.plan.seed} /{" "}
              {r.plan.trials} 帧
            </button>
          ))}
        </details>
      )}
      {view && (
        <p className="ofdm-fingerprint">
          当前记录：N{view.plan.fftSize} / CP{view.plan.cp} /{" "}
          {view.plan.modulation} / {view.plan.energyBasis} / seed{" "}
          {view.plan.seed}。协议 {view.protocolHash}；源码{" "}
          {view.sourceFingerprint}；运行时 {view.runtimeFingerprint}。OFDM
          独立本地库，不进入账号同步。
        </p>
      )}
      {record && (
        <>
          <p>
            首帧实测发送能量：useful{" "}
            {record.trials[0].cells[0].energy.useful.toFixed(4)} + CP{" "}
            {record.trials[0].cells[0].energy.cp.toFixed(4)} = total{" "}
            {record.trials[0].cells[0].energy.total.toFixed(4)}；训练含 CP{" "}
            {record.trials[0].cells[0].energy.training.toFixed(4)}。N0
            使用冻结的期望 Eb，不按该帧能量调整。
          </p>
          <OfdmCombResearchCharts key={record.integrityHash} record={record} />
        </>
      )}
    </section>
  );
}
