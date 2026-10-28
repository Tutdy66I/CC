import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEngineeringMode,
  assertRuntime,
  runtimeIdentity,
  digest,
  formalChunks,
} from "./v14-study-common.mjs";
import {
  checkFormalAuthorization,
  runResearchChunks,
} from "./v14-study-formal-core.mjs";
import { loadFrozenSnapshot } from "./v14-study-loader.mjs";

const CHUNK = 20;
export async function runPreflight({
  root,
  simulate,
  stopAfter = null,
  onChunk = null,
  onStaged = null,
  identity = "test-only",
  seedOffset = 0,
}) {
  if (!Number.isInteger(seedOffset) || seedOffset < 0 || seedOffset > 2)
    throw Error("Invalid preflight");
  const schedule = formalChunks()
    .filter((x) => x.scenario === 3 && x.batch === seedOffset)
    .slice(0, 5);
  const result = await runResearchChunks({
    root,
    schedule,
    simulate,
    mode: "engineering",
    identity,
    stopAfter: stopAfter === null ? null : stopAfter / CHUNK,
    onChunk,
    onStaged,
  });
  return { ...result, chunks: result.completedChunks };
}

async function main() {
  const [mode, root, offset, identityPath, authorizationPath] =
    process.argv.slice(2);
  if (mode !== "formal") assertEngineeringMode(mode);
  if (
    !root ||
    !/^[0-2]$/.test(offset || "") ||
    !identityPath ||
    process.argv.length !== (mode === "formal" ? 7 : 6) ||
    (mode === "formal" && (!authorizationPath || offset !== "0"))
  )
    throw Error(
      "Expected preflight ROOT OFFSET IDENTITY or formal ROOT 0 IDENTITY AUTHORIZATION",
    );
  const identity = JSON.parse(readFileSync(identityPath, "utf8"));
  const expectedRoot = resolve(
    process.cwd(),
    "..",
    "output",
    mode === "formal"
      ? "signallab-v14-study-formal"
      : "signallab-v14-study-preflight",
  );
  const target = resolve(root);
  if (
    !target.startsWith(expectedRoot + "\\") &&
    !target.startsWith(expectedRoot + "/")
  )
    throw Error("Study output must be in its dedicated directory");
  const snapshot = resolve(identity.snapshotRoot);
  if (
    resolve(identityPath) !== join(target, "identity.json") ||
    snapshot !== join(target, "source") ||
    realpathSync(snapshot) !== snapshot ||
    lstatSync(target).isSymbolicLink()
  )
    throw Error("Unsafe snapshot identity");
  if (
    identity.schema !== "signallab-v14-preflight-identity-1" ||
    !Array.isArray(identity.files) ||
    !Array.isArray(identity.tools)
  )
    throw Error("Invalid snapshot identity");
  assertRuntime(identity.runtime, runtimeIdentity());
  for (const tool of identity.tools) {
    if (
      !/^scripts\/[A-Za-z0-9_.-]+$/.test(tool.path) ||
      digest(readFileSync(resolve(process.cwd(), tool.path))) !== tool.sha256
    )
      throw Error("Study tool changed");
  }
  let authorization = null;
  if (mode === "formal") {
    if (
      process.env.SIGNALLAB_V14_TEST_KILL_AFTER_CHUNKS ||
      process.env.SIGNALLAB_V14_TEST_KILL_AFTER_STAGE
    )
      throw Error("Formal mode forbids engineering fault injection");
    authorization = JSON.parse(readFileSync(authorizationPath, "utf8"));
    checkFormalAuthorization(target, identity, authorization);
  }
  const { simulateJointTrial } = await loadFrozenSnapshot(
    snapshot,
    identity.files,
    "src/lib/ofdmSync/jointEngine.js",
  );
  const start = performance.now();
  const fault = process.env.SIGNALLAB_V14_TEST_KILL_AFTER_CHUNKS;
  const stageFault = process.env.SIGNALLAB_V14_TEST_KILL_AFTER_STAGE;
  if (fault && !/^[1-4]$/.test(fault))
    throw Error("Invalid preflight fault injection");
  if (stageFault && !/^[1-4]$/.test(stageFault))
    throw Error("Invalid staged preflight fault injection");
  const onChunk = fault
    ? (completed) => {
        if (completed === Number(fault) * CHUNK) {
          console.error("Injected preflight process termination");
          process.kill(process.pid, "SIGKILL");
        }
      }
    : null;
  const onStaged = stageFault
    ? (index) => {
        if (index + 1 === Number(stageFault)) {
          console.error("Injected termination before atomic publication");
          process.kill(process.pid, "SIGKILL");
        }
      }
    : null;
  const result =
    mode === "formal"
      ? await runResearchChunks({
          root: target,
          schedule: formalChunks(),
          simulate: simulateJointTrial,
          mode,
          identity,
          authorization,
        })
      : await runPreflight({
          root: target,
          simulate: simulateJointTrial,
          identity,
          seedOffset: Number(offset),
          onChunk,
          onStaged,
        });
  console.log(
    JSON.stringify({
      ...result,
      elapsedSeconds: (performance.now() - start) / 1000,
      peakRssKiB: process.resourceUsage().maxRSS,
      mode: mode === "formal" ? "formal" : "engineering",
      statisticalConclusion: false,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  });
