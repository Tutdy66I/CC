import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const canonical = (value) => {
  if (typeof value === "number" && !Number.isFinite(value))
    throw Error("Non-finite value");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",") +
    "}"
  );
};
const scenarios = [
  { id: "awgn-0", channel: "awgn", ebN0Db: 0 },
  { id: "awgn-8", channel: "awgn", ebN0Db: 8 },
  { id: "multipath-0", channel: "multipath", ebN0Db: 0 },
  { id: "multipath-8", channel: "multipath", ebN0Db: 8 },
];
export function manifest() {
  const specification = {
    schema: "signallab-v14-sync-study-protocol-1",
    engine: "ofdm-sync-v14-joint-1",
    random: "signallab-ofdm-sync-joint-rng-v1",
    primaryComparison:
      "estimated-minus-raw frame BER, paired by scenario batch and frame",
    frame: {
      fftSize: 128,
      cp: 16,
      modulation: "QPSK",
      bits: 768,
      cfo: 0.25,
      sto: 8,
      phase: 0,
      noiseEnabled: true,
      energyBasis: "data-eb",
    },
    scenarios,
    schedule: {
      framesPerScenario: 25376,
      totalScenarioFrames: 101504,
      batchesPerScenario: 26,
      batchFrames: 1000,
      lastBatchFrames: 376,
      seedBase: 3140000000,
      seedRule:
        "seedBase+batch; same seed and local frame index across scenarios",
    },
    intervals: {
      simultaneousConfidence: 0.95,
      comparisons: 4,
      halfWidth: 0.02,
      method:
        "two-sided Hoeffding and Bonferroni on independent paired frame differences in [-1,1]",
    },
    missing:
      "failed acquisition is 768 erased bits; BER bounds and paired difference bounds include every frame",
    limits: {
      timeMs: 3600000,
      memoryBytes: 512 * 1024 ** 2,
      diskBytes: 4 * 1024 ** 3,
      minimumFreeBytes: 8 * 1024 ** 3,
    },
  };
  const protocolSha256 = digest(canonical(specification));
  if (
    protocolSha256 !==
    "838c09680a471a05c96b79fee70fe3cdb447f9af1894e4c698b069234449c6b6"
  )
    throw Error("Frozen research protocol changed");
  return { ...specification, protocolSha256 };
}
export function batchPlan(scenario, batch) {
  if (
    !Number.isInteger(scenario) ||
    scenario < 0 ||
    scenario >= 4 ||
    !Number.isInteger(batch) ||
    batch < 0 ||
    batch >= 26
  )
    throw Error("Invalid scenario or batch");
  const s = scenarios[scenario];
  return {
    cp: 16,
    cfo: 0.25,
    sto: 8,
    phase: 0,
    ebN0Db: s.ebN0Db,
    energyBasis: "data-eb",
    noiseEnabled: true,
    seed: 3140000000 + batch,
    trials: batch === 25 ? 376 : 1000,
    taps:
      s.channel === "awgn"
        ? [{ delay: 0, i: 1, q: 0 }]
        : [
            { delay: 0, i: 0.8, q: 0.1 },
            { delay: 3, i: 0.2, q: -0.1 },
            { delay: 7, i: 0.1, q: 0.05 },
          ],
  };
}
export function formalChunks() {
  const chunks = [];
  for (let scenario = 0; scenario < 4; scenario++)
    for (let batch = 0; batch < 26; batch++) {
      const plan = batchPlan(scenario, batch);
      for (let start = 0; start < plan.trials; start += 20)
        chunks.push({
          scenario,
          batch,
          start,
          count: Math.min(20, plan.trials - start),
          seed: plan.seed,
        });
    }
  return chunks;
}
export function assertEngineeringMode(mode) {
  if (mode !== "preflight")
    throw Error("Formal study is not authorized or enabled");
}
export function assertRuntime(expected, actual) {
  if (!expected || !actual || canonical(expected) !== canonical(actual))
    throw Error("Study runtime identity changed; preserve evidence");
}
export function runtimeIdentity() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model || "unknown",
    endian: os.endianness(),
    nodeOptionsSha256: digest(process.env.NODE_OPTIONS || ""),
    nodeExecutableSha256: digest(readFileSync(process.execPath)),
    probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
  };
}
export function summarize(trials) {
  const result = {
    frames: 0,
    failed: 0,
    cfoFailures: 0,
    timingFailures: 0,
    raw: { bits: 0, errors: 0, erasures: 0 },
    ideal: { bits: 0, errors: 0, erasures: 0 },
    estimated: { bits: 0, errors: 0, erasures: 0 },
    pairedLower: 0,
    pairedUpper: 0,
  };
  for (const trial of trials) {
    result.frames++;
    const estimated = trial.estimated;
    if (!estimated || !["ok", "failed"].includes(estimated.status))
      throw Error("Invalid acquisition status");
    if (estimated.status === "failed") {
      result.failed++;
      if (["low-energy", "low-coherence"].includes(estimated.reason))
        result.cfoFailures++;
      else if (estimated.reason === "low-correlation") result.timingFailures++;
      else throw Error("Unknown acquisition failure");
      if (estimated.metric.erasedBits !== 768 || estimated.metric.errors !== 0)
        throw Error("Failed acquisition must erase the whole frame");
    }
    for (const [name, metric] of [
      ["raw", trial.raw],
      ["ideal", trial.ideal],
      ["estimated", estimated.metric],
    ]) {
      if (
        !metric ||
        metric.bits !== 768 ||
        !Number.isInteger(metric.errors) ||
        !Number.isInteger(metric.erasedBits) ||
        metric.errors < 0 ||
        metric.erasedBits < 0 ||
        metric.errors + metric.erasedBits > metric.bits
      )
        throw Error("Invalid metric denominator");
      result[name].bits += metric.bits;
      result[name].errors += metric.errors;
      result[name].erasures += metric.erasedBits;
    }
  }
  if (result.frames) {
    const raw = result.raw,
      est = result.estimated;
    result.pairedLower = (est.errors - raw.errors - raw.erasures) / est.bits;
    result.pairedUpper = (est.errors + est.erasures - raw.errors) / est.bits;
  }
  return result;
}
export function withPublicationLock(root, callback) {
  const folder = join(root, "coordination");
  mkdirSync(folder, { recursive: true });
  if (lstatSync(folder).isSymbolicLink()) throw Error("Unsafe lock directory");
  const lock = join(folder, "publication.lock"),
    until = performance.now() + 15000;
  let fd;
  while (fd === undefined) {
    try {
      fd = openSync(lock, "wx");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (performance.now() >= until)
        throw Error("Publication lock timeout; preserve evidence");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    fsyncSync(fd);
    return callback();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
export function scanUsage(root) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const path = join(dir, entry.name);
      if (path === join(root, "coordination", "publication.lock")) return sum;
      if (entry.isSymbolicLink()) throw Error("Symlink in study directory");
      return (
        sum +
        (entry.isDirectory()
          ? walk(path)
          : Math.ceil(statSync(path).size / 4096) * 4096)
      );
    }, 0);
  return withPublicationLock(root, () => walk(root));
}
export function requireSpace(root) {
  const s = statfsSync(root);
  if (process.platform === "win32" && s.bsize !== 4096)
    throw Error("Disk accounting requires a 4 KiB allocation unit");
  assertFreeSpace(s.bavail * s.bsize);
}
export function assertFreeSpace(bytes) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < manifest().limits.minimumFreeBytes
  )
    throw Error("At least 8 GiB free is required");
}
export function assertDiskBudget(booked, next) {
  if (
    !Number.isSafeInteger(booked) ||
    !Number.isSafeInteger(next) ||
    booked < 0 ||
    next < 0 ||
    booked + next + 32 * 1024 ** 2 > manifest().limits.diskBytes
  )
    throw Error("Disk limit reached; preserve evidence");
}
export function writeNew(path, data) {
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function publish(root, stage, index) {
  if (!Number.isInteger(index) || index < 0) throw Error("Invalid batch index");
  const base = resolve(root),
    source = resolve(stage);
  if (
    !source.startsWith(join(base, "pending") + "\\") &&
    !source.startsWith(join(base, "pending") + "/")
  )
    throw Error("Unsafe staging path");
  mkdirSync(join(base, "batches"), { recursive: true });
  return withPublicationLock(base, () => {
    const dest = join(base, "batches", String(index).padStart(6, "0"));
    if (existsSync(dest))
      throw Error("Duplicate committed batch; preserve evidence");
    renameSync(source, dest);
  });
}
