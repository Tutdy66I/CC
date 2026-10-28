import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import {
  digest,
  canonical,
  runtimeIdentity,
  requireSpace,
  scanUsage,
  manifest,
  writeNew,
} from "./v14-study-common.mjs";

if (
  !/^[0-2]$/.test(process.argv[2] || "") ||
  ![3, 4].includes(process.argv.length) ||
  (process.argv[3] && process.argv[3] !== "formal-prepare")
)
  throw Error(
    "Use preflight offset 0, 1, or 2; optional formal-prepare creates no data",
  );
const formal = process.argv[3] === "formal-prepare";
const app = process.cwd(),
  out = resolve(
    app,
    "..",
    "output",
    formal ? "signallab-v14-study-formal" : "signallab-v14-study-preflight",
  );
for (let current = out; ; current = dirname(current)) {
  if (existsSync(current) && lstatSync(current).isSymbolicLink())
    throw Error("Study path cannot contain a symbolic link or junction");
  if (dirname(current) === current) break;
}
mkdirSync(out, { recursive: true });
requireSpace(out);
const root = mkdtempSync(join(out, formal ? "study-" : "preflight-")),
  snapshotRoot = join(root, "source");
const started = performance.now();
execFileSync(
  process.execPath,
  [resolve(app, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.test.json"],
  { cwd: app, stdio: "inherit" },
);
const buildSeconds = (performance.now() - started) / 1000;
mkdirSync(join(snapshotRoot, "src"), { recursive: true });
cpSync(resolve(app, ".test-build/src/lib"), join(snapshotRoot, "src/lib"), {
  recursive: true,
  errorOnExist: true,
});
mkdirSync(join(snapshotRoot, "original/src"), { recursive: true });
cpSync(resolve(app, "src/lib"), join(snapshotRoot, "original/src/lib"), {
  recursive: true,
  errorOnExist: true,
});
writeNew(join(snapshotRoot, "package.json"), '{"type":"module"}');
function files(base, dir = base) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error("Source symlinks forbidden");
      if (entry.isDirectory()) return files(base, path);
      if (!entry.isFile()) throw Error("Invalid source entry");
      return [
        {
          path: relative(base, path).replaceAll("\\", "/"),
          sha256: digest(readFileSync(path)),
        },
      ];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
const toolNames = [
  "v14-study-common.mjs",
  "v14-study-runner.mjs",
  "v14-study-loader.mjs",
  "v14-study-formal-core.mjs",
  "v14-study-audit.py",
  "v14-study-prepare.mjs",
  "v14-study-preflight.ps1",
  "ofdm-study-guard.cs",
];
mkdirSync(join(snapshotRoot, "study-tools"));
const tools = toolNames.map((name) => {
  const data = readFileSync(join(app, "scripts", name));
  writeNew(join(snapshotRoot, "study-tools", name), data);
  return { path: "scripts/" + name, sha256: digest(data) };
});
const identity = {
  schema: "signallab-v14-preflight-identity-1",
  snapshotRoot,
  files: files(snapshotRoot),
  tools,
  runtime: runtimeIdentity(),
  buildSeconds,
};
if (!existsSync(join(snapshotRoot, "src/lib/ofdmSync/jointEngine.js")))
  throw Error("Compiled joint engine absent");
writeNew(join(root, "identity.json"), JSON.stringify(identity));
if (scanUsage(root) + 32 * 1024 ** 2 > manifest().limits.diskBytes)
  throw Error("Snapshot exceeds disk budget");
console.log(
  JSON.stringify({
    root,
    identity: join(root, "identity.json"),
    seedOffset: Number(process.argv[2]),
    buildSeconds,
    mode: formal ? "formal-preparation-only" : "engineering",
    protocolSha256: manifest().protocolSha256,
    identitySha256: digest(canonical(identity)),
    directorySha256: digest(
      process.platform === "win32" ? root.toLowerCase() : root,
    ),
  }),
);
