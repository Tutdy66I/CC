import { lazy, Suspense, useState } from "react";
import OfdmResearchExperiment from "./OfdmResearchExperiment";
const Comb = lazy(() => import("./OfdmCombResearchExperiment"));
export default function OfdmResearchPanel() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem("signallab-ofdm-mode") === "comb"
        ? "comb"
        : "training";
    } catch {
      return "training";
    }
  });
  return (
    <>
      <label>
        OFDM 实验模式{" "}
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            setMode(next);
            try {
              localStorage.setItem("signallab-ofdm-mode", next);
            } catch {
              /* mode remains usable */
            }
          }}
        >
          <option value="training">全训练基线 v13.1（含旧历史）</option>
          <option value="comb">梳状导频与插值 v13.2</option>
        </select>
      </label>
      <p>
        切换模式会停止当前计算；两种模式各有独立本地记录库，旧记录可在全训练模式识别和导出。
      </p>
      {mode === "comb" ? (
        <Suspense fallback={<p>正在加载梳状导频…</p>}>
          <Comb />
        </Suspense>
      ) : (
        <OfdmResearchExperiment />
      )}
    </>
  );
}
