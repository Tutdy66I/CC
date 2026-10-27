import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  lstatSync,
  statSync,
  statfsSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import os from "node:os";

export const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sha = (x) => createHash("sha256").update(x).digest("hex");
export const canonical = (x) => {
  if (typeof x === "number" && !Number.isFinite(x))
    throw Error("Non-finite JSON");
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(x)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
      .join(",") +
    "}"
  );
};
export const budgetPath = resolve(
  app,
  "../docs/signallab-v13-study-budget.json",
);
export const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
export const protocolHash =
  "e9654ff6b2dcd4e733afccc543af3bc99fdc03431a19e13399d637389b0ddaf4";
export function checkBudget() {
  const { protocolSha256, ...payload } = budget;
  if (
    protocolSha256 !== protocolHash ||
    sha(canonical(payload)) !== protocolHash
  )
    throw Error("Frozen budget changed");
}
export const toolFiles = [
  "ofdm-study-common.mjs",
  "ofdm-study-runner.mjs",
  "ofdm-study-audit.py",
  "ofdm-study-host.ps1",
  "ofdm-study-guard.cs",
];
export function identity() {
  const names = [
    ...readdirSync(resolve(app, "src/lib"))
      .filter((x) => x.endsWith(".ts"))
      .map((x) => "src/lib/" + x),
    "src/workers/ofdmResearch.worker.ts",
    "src/workers/ofdmCombResearch.worker.ts",
  ].sort();
  const h = createHash("sha256");
  const sources = names.map((path) => {
    const b = readFileSync(resolve(app, path));
    h.update(path + "\0")
      .update(b)
      .update("\0");
    return { path, sha256: sha(b) };
  });
  const tools = toolFiles.map((path) => ({
    path: "scripts/" + path,
    sha256: sha(readFileSync(resolve(app, "scripts", path))),
  }));
  return {
    kernelFingerprint: h.digest("hex"),
    sources,
    tools,
    runtime: {
      node: process.version,
      execArgv: process.execArgv,
      nodeOptionsSha256: sha(process.env.NODE_OPTIONS || ""),
      uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || "default",
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model,
      endian: os.endianness(),
      executableSha256: sha(readFileSync(process.execPath)),
      probes: [Math.sin(1), Math.cos(1), Math.sqrt(2)],
    },
    execution: "verified-snapshot-typescript-strip-v2",
  };
}
let hooked = false;
const frozenModules = new Map();
export async function kernel(
  sourceRoot = app,
  expectedSources = identity().sources,
) {
  const prefix = pathToFileURL(resolve(sourceRoot, "src/lib") + "/").href;
  for (const entry of expectedSources.filter((e) =>
    e.path.startsWith("src/lib/"),
  )) {
    if (!/^src\/lib\/[A-Za-z0-9_-]+\.ts$/.test(entry.path))
      throw Error("Unsafe executed source path");
    const url = pathToFileURL(resolve(sourceRoot, entry.path)).href;
    const bytes = readFileSync(new URL(url));
    if (sha(bytes) !== entry.sha256)
      throw Error("Executed snapshot source hash mismatch");
    if (
      frozenModules.has(url) &&
      frozenModules.get(url).sha256 !== entry.sha256
    )
      throw Error("Loaded snapshot identity changed");
    frozenModules.set(url, {
      sha256: entry.sha256,
      source: bytes.toString("utf8"),
      prefix,
    });
  }
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, next) {
        if (
          frozenModules.has(context.parentURL) &&
          specifier.startsWith(".") &&
          specifier.endsWith(".js")
        ) {
          const p = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
          if (!frozenModules.has(p.href))
            throw Error("Untracked executed TS dependency");
          return { url: p.href, shortCircuit: true };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        const frozen = frozenModules.get(url);
        if (!frozen) return next(url, context);
        // Execute the exact buffer whose hash was checked, even if disk changes after verification.
        return {
          format: "module",
          source: stripTypeScriptTypes(frozen.source, { mode: "strip" }),
          shortCircuit: true,
        };
      },
    });
    hooked = true;
  }
  return Object.assign(
    {},
    ...(await Promise.all(
      ["ofdmCombProtocol", "ofdmCombResearch", "ofdmCombResearchRecord"].map(
        (p) =>
          import(pathToFileURL(resolve(sourceRoot, "src/lib", p + ".ts")).href),
      ),
    )),
  );
}
export function usage(root) {
  let bytes = 32 * 1024 ** 2; // conservative directory/ledger/report reserve; counted, never spent twice
  const walk = (dir) => {
    for (const x of readdirSync(dir, { withFileTypes: true })) {
      // The transient marker is covered by the fixed metadata reserve. Skipping it
      // before stat prevents an independent archive scan racing its removal.
      if (dir === resolve(root, "coordination") && x.name === "publication.lock") {
        try {
          const marker = lstatSync(resolve(dir, x.name));
          if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 1024) throw Error("Unsafe publication marker");
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        continue;
      }
      if (x.isSymbolicLink()) throw Error("Symlinks are not study data");
      const p = resolve(dir, x.name);
      if (x.isDirectory()) walk(p);
      else bytes += Math.ceil(statSync(p).size / 4096) * 4096;
    }
  };
  walk(root);
  return bytes;
}
const bookedUsage = new Map();
export function durable(root, path, text, cap) {
  const bytes = Buffer.byteLength(text);
  // Initial full scan includes prior attempts. The 32 MiB reserve covers this session's
  // bounded native journal/compiler/log writes; data writes are booked before allocation.
  const used = bookedUsage.has(root) ? bookedUsage.get(root) : usage(root);
  const allocated = Math.ceil(bytes / 4096) * 4096;
  if (used + allocated > cap)
    throw Error("Disk budget: safe stop before write");
  bookedUsage.set(root, used + allocated);
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function pairedWrite(root, path, value, cap) {
  const text = JSON.stringify(value);
  durable(root, path, text, cap);
  durable(root, path + ".backup", text, cap);
  return sha(text);
}
export function readManifest(root) {
  const b = readFileSync(resolve(root, "manifest.json"));
  if (!b.equals(readFileSync(resolve(root, "manifest.json.backup"))))
    throw Error("Manifest backup mismatch");
  const m = JSON.parse(b);
  if (readFileSync(resolve(root, "manifest.sha256"), "utf8") !== sha(b))
    throw Error("Manifest hash mismatch");
  return { manifest: m, manifestSha256: sha(b) };
}
export const locationHash = (root) =>
  sha(
    process.platform === "win32"
      ? realpathSync(root).toLowerCase()
      : realpathSync(root),
  );
export function makeManifest(mode, id, binding) {
  checkBudget();
  if (!["engineering", "formal"].includes(mode)) throw Error("Unknown mode");
  if (mode === "formal" && id.kernelFingerprint !== budget.sourceFingerprint)
    throw Error("Published numerical byte fingerprint differs");
  if (
    !binding ||
    !/^[a-f0-9]{32}$/.test(binding.studyId) ||
    !/^[a-f0-9]{64}$/.test(binding.locationBinding)
  )
    throw Error("Unique study and original-directory binding required");
  return {
    schema: "signallab-ofdm-study-1",
    ...binding,
    mode,
    formalAdmission: mode === "formal",
    budget,
    identity: id,
    schedule: {
      groups: mode === "formal" ? 450 : 2,
      batchFrames: 80,
      seedBase: mode === "formal" ? 2026102603 : 3026102603,
      energies: ["data-eb", "total-eb"],
    },
    limits: {
      activeMs: mode === "formal" ? 7200000 : 120000,
      memoryBytes: 512 * 1024 ** 2,
      diskBytes: (mode === "formal" ? 16 * 1024 : 128) * 1024 ** 2,
      minimumFreeBytes: 20 * 1024 ** 3,
    },
    meaning:
      "Atomic paired 80-trial groups; complete fixed horizon only. Engineering data never admitted to formal inference.",
  };
}
export function frozenPlan(m, group, energy) {
  const s = m.budget.primaryScope;
  return {
    fftSize: s.fftSize,
    cp: s.cp,
    dataSymbols: s.dataSymbols,
    modulation: s.modulation,
    activeBins: s.activeBins,
    taps: s.taps,
    channels: s.channels,
    ebN0Db: s.ebN0Db,
    pilotLayouts: s.pilotLayouts,
    energyBasis: energy,
    trials: 80,
    seed: m.schedule.seedBase + group,
    noiseEnabled: true,
  };
}
export function requireSpace(root) {
  const s = statfsSync(root);
  if (process.platform === "win32" && s.bsize !== 4096)
    throw Error(
      "Fixed disk accounting requires 4 KiB allocation units; unsupported filesystem refused",
    );
  if (s.bavail * s.bsize < 20 * 1024 ** 3)
    throw Error("At least 20 GiB free required at every start");
}
// The host uses this same exclusive marker while enumerating disk usage.
export function commitDirectory(root, stage, group, session) {
  if (!/^[a-f0-9]{32}$/.test(session)) throw Error("Invalid publication session");
  const dest = resolve(root, "groups", String(group).padStart(6, "0"));
  mkdirSync(dirname(dest), { recursive: true });
  const coordination = resolve(root, "coordination");
  mkdirSync(coordination, { recursive: true });
  const coordStat = lstatSync(coordination);
  if (coordStat.isSymbolicLink() || !coordStat.isDirectory()) throw Error("Unsafe coordination directory");
  const lock = resolve(coordination, "publication.lock");
  const deadline = Date.now() + 15000;
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try { if (lstatSync(lock).isSymbolicLink()) throw Error("Publication lock is a symlink"); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
      if (Date.now() >= deadline) throw Error("Publication lock timeout; preserve archive");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ schema: 1, session, pid: process.pid }));
    fsyncSync(fd);
    if (existsSync(dest)) throw Error("Duplicate committed group");
    renameSync(stage, dest); // same-volume atomic directory publication; no overwriting data
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
export function safeRelative(root, p) {
  const r = relative(root, p);
  if (r.startsWith("..") || resolve(root, r) !== p)
    throw Error("Path escaped study");
  return r.replaceAll("\\", "/");
}
