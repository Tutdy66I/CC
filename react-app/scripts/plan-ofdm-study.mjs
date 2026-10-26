// A fixed statistical/resource plan. There is deliberately no formal-study execution path.
import { readFileSync, writeFileSync, mkdirSync, statfsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  simulateOfdmCombTrial,
  makeOfdmCombRecord,
  parseOfdmCombCheckpoint,
  serializeOfdmCombCheckpoint,
  sourceFingerprint,
  identity,
} from "./ofdm-comb-tooling.mjs";
import {
  workUnits,
  commonDataBins,
} from "../.test-build/src/lib/ofdmCombProtocol.js";
import { canonicalOfdm } from "../.test-build/src/lib/ofdmProtocol.js";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(app);
if (
  process.argv.slice(2).some((x) => x !== "--preflight") ||
  process.argv.length > 3
)
  throw new Error(
    "Only the fixed --preflight option is supported; formal execution is not implemented.",
  );
const out = resolve(app, "../output/signallab-v13-release-acceptance");
mkdirSync(out, { recursive: true });
const plan = { ...defaultOfdmCombPlan(), trials: 80, ebN0Db: [0, 8, 16, 24] },
  alpha = 0.05,
  epsilon = 0.02,
  hypotheses = 32,
  F = 36000,
  batches = F / 80;
const manifest = {
  version: "signallab-ofdm-comb-study-budget-1",
  status: "statistical/resource protocol only; execution not started",
  engine: "ofdm-v13.2",
  sourceFingerprint: sourceFingerprint(),
  primaryScope: {
    modulation: "QPSK",
    channels: ["awgn", "rayleigh"],
    taps: plan.taps,
    fftSize: 128,
    cp: 16,
    dataSymbols: 4,
    activeBins: plan.activeBins,
    pilotLayouts: plan.pilotLayouts,
    commonDataBins: commonDataBins(plan),
    ebN0Db: plan.ebN0Db,
    energyBases: ["data-eb", "total-eb"],
  },
  contrasts: [
    {
      left: "comb-zf/layout-P8",
      right: "training-zf/layout-P8",
      scope: "common",
    },
    { left: "comb-zf/layout-P4", right: "comb-zf/layout-P8", scope: "common" },
  ],
  precision: {
    parameter: "complete-frame paired BER difference",
    absoluteHalfWidth: epsilon,
    familyConfidence: 1 - alpha,
    familySize: hypotheses,
    method:
      "two-sided Hoeffding for difference in [-1,1], Bonferroni across 32 prespecified hypotheses",
    formula: "F >= 2*ln(2*M/alpha)/epsilon^2",
    minimumFrames: Math.ceil(
      (2 * Math.log((2 * hypotheses) / alpha)) / epsilon ** 2,
    ),
    fixedFrames: F,
    simultaneousHalfWidth: Math.sqrt(
      (2 * Math.log((2 * hypotheses) / alpha)) / F,
    ),
    unit: "independent complete trial vectors, not bits/tones/layouts/energy arms",
  },
  seedSchedule: {
    formalBaseSeed: 2026102603,
    batchFrames: 80,
    batchesPerEnergy: batches,
    globalFrame: "80*batchId + localIndex",
    seed: "2026102603 + batchId; batchId=0..449",
    trialIndex: "localIndex=0..79",
    pairing:
      "same seed/index across both layouts and energy bases; channels/noisy standard samples shared by production role domains; no pooling correlated cells as independent frames",
    preflightSeed: 3026102603,
    preflightAdmission: "excluded from formal inference",
  },
  resourceBudget: {
    totalBatchRecords: 2 * batches,
    physicalCellFrames: F * 2 * 4 * 2 * 2,
    perBatchCellFrames: 80 * 2 * 4 * 2,
    perBatchWorkUnits: workUnits(plan),
    maxCompactBytesPerRecord: 8 * 1024 ** 2,
    rawHardBoundGiB: (2 * batches * 8) / 1024,
    wallLimitSeconds: 7200,
    nodeProcessPeakLimitMiB: 512,
    totalDiskCapGiB: 16,
    minimumFreeDiskGiB: 20,
    backupCopies: 1,
    ioReserveRule:
      "allow 1.5 times measured compute/parse projection plus 600 seconds for manifests, checkpoint I/O and archiving",
  },
  failureRules: [
    "Never remove deep fades, erasures, numerical failures or incomplete frames from denominators.",
    "For erasures, use paired lower/upper error bounds; the resulting interval may be wider than the target. Do not claim achieved precision in that case.",
    "No stopping on error counts or observed significance. Time/memory/disk stop saves a verified prefix and publishes no fixed-horizon interval; resume only under matching manifest/source/runtime.",
    "ZF/MMSE hard-decision identity is a deterministic check, not extra independent hypotheses. Unbounded EVM/ZF MSE use descriptive quantiles and failure counts, not the BER Hoeffding bound.",
  ],
  deferred: [
    "BPSK/16QAM formal inference",
    "CP-insufficient formal inference",
    "other PDP/delay profiles and pilot layouts",
    "streaming orchestration and independent archive auditor must be implemented/tested before an explicitly authorized formal start",
  ],
};
const protocolSha256 = createHash("sha256")
  .update(canonicalOfdm(manifest))
  .digest("hex");
writeFileSync(
  resolve(out, "research-budget-protocol.json"),
  JSON.stringify({ protocolSha256, ...manifest }, null, 2),
);
console.log(
  JSON.stringify(
    { protocolSha256, ...manifest.precision, ...manifest.resourceBudget },
    null,
    2,
  ),
);
if (process.argv.includes("--preflight")) {
  const results = [],
    id = await identity();
  for (const energyBasis of ["data-eb", "total-eb"]) {
    const p = { ...plan, seed: 3026102603, energyBasis },
      f = await freezeOfdmCombPlan(p),
      trials = [],
      start = performance.now();
    for (let j = 0; j < 80; j++) trials.push(await simulateOfdmCombTrial(p, j));
    const record = await makeOfdmCombRecord(f, trials, id),
      text = serializeOfdmCombCheckpoint(record),
      parsed = await parseOfdmCombCheckpoint(text);
    if (parsed.integrityHash !== record.integrityHash)
      throw new Error("Preflight roundtrip mismatch");
    results.push({
      energyBasis,
      frames: 80,
      cellFrames: 1280,
      elapsedMs: performance.now() - start,
      recordBytes: Buffer.byteLength(text),
      protocolHash: f.protocolHash,
      integrityHash: record.integrityHash,
    });
  }
  const projectedSeconds =
      (results.reduce((s, x) => s + x.elapsedMs, 0) / 1000) * batches,
    reservedSeconds = projectedSeconds * 1.5 + 600,
    estimatedRawGiB =
      (results.reduce((s, x) => s + x.recordBytes, 0) * batches) / 1024 ** 3,
    disk = statfsSync(".."),
    freeGiB = (disk.bavail * disk.bsize) / 1024 ** 3;
  let nodeNative = null;
  if (process.platform === "win32")
    nodeNative = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(app, "scripts/ofdm-process-memory.ps1"),
          "-ProbeIds",
          String(process.pid),
        ],
        { encoding: "utf8" },
      ),
    )[0];
  const report = {
    protocolSha256,
    admittedToFormalResearch: false,
    results,
    projectedSeconds,
    reservedSeconds,
    estimatedRawGiB,
    freeGiB,
    nodeNative,
    timeWithinBudget: reservedSeconds <= 7200,
    diskWithinBudget:
      freeGiB >= 20 &&
      estimatedRawGiB <= manifest.resourceBudget.rawHardBoundGiB,
    nodeMemoryWithinBudget: nodeNative
      ? nodeNative.peakWorkingSetBytes <= 512 * 1024 ** 2
      : null,
    limitation:
      "Two engineering batch measurements only; throughput forecast is not a runtime guarantee or formal research result.",
  };
  writeFileSync(
    resolve(out, "research-budget-preflight.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.timeWithinBudget ||
    !report.diskWithinBudget ||
    report.nodeMemoryWithinBudget === false
  )
    process.exitCode = 1;
}
