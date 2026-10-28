import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  batchPlan,
  assertDiskBudget,
  canonical,
  digest,
  formalChunks,
  manifest,
  publish,
  requireSpace,
  scanUsage,
  summarize,
  writeNew,
} from "./v14-study-common.mjs";

export function checkFormalAuthorization(root, identity, approval) {
  const directory = resolve(root);
  const boundDirectory =
    process.platform === "win32" ? directory.toLowerCase() : directory;
  if (
    !approval ||
    approval.schema !== "signallab-v14-formal-authorization-1" ||
    approval.protocolSha256 !== manifest().protocolSha256 ||
    approval.identitySha256 !== digest(canonical(identity)) ||
    approval.directorySha256 !== digest(boundDirectory) ||
    approval.scenarioFrames !== 101504 ||
    approval.statement !==
      "I authorize the exact SignalLab v1.4 101504-frame study under its frozen limits."
  )
    throw Error("Invalid formal authorization");
}
export function shouldPauseSession(mode, elapsedMs) {
  return mode === "formal" && elapsedMs >= 45000;
}

/** Low-level stream core. Formal mode requires a separately approved, guarded host session. */
export async function runResearchChunks({
  root,
  schedule,
  simulate,
  mode = "fixture",
  identity = "test-only",
  stopAfter = null,
  onChunk = null,
  onStaged = null,
  authorization = null,
}) {
  const expected = formalChunks();
  if (
    !Array.isArray(schedule) ||
    !schedule.length ||
    schedule.length > expected.length
  )
    throw Error("Invalid schedule");
  if (
    mode === "fixture" &&
    (identity !== "test-only" ||
      schedule.some((v, i) => canonical(v) !== canonical(expected[i])))
  )
    throw Error("Invalid test fixture");
  if (
    mode === "engineering" &&
    (schedule.length !== 5 ||
      schedule.some(
        (v, i) =>
          v.scenario !== 3 ||
          v.batch !== schedule[0].batch ||
          v.start !== i * 20 ||
          v.count !== 20 ||
          v.seed !== 3140000000 + v.batch,
      ) ||
      schedule[0].batch < 0 ||
      schedule[0].batch > 2)
  )
    throw Error("Invalid engineering schedule");
  if (mode === "formal") {
    checkFormalAuthorization(root, identity, authorization);
    if (
      process.platform !== "win32" ||
      !/^[a-f0-9]{32}$/.test(process.env.SIGNALLAB_V14_GUARD_SESSION || "") ||
      identity?.schema !== "signallab-v14-preflight-identity-1"
    )
      throw Error("Formal execution requires the native guarded host");
    if (
      schedule.length !== expected.length ||
      schedule.some((v, i) => canonical(v) !== canonical(expected[i])) ||
      stopAfter !== null ||
      onStaged ||
      onChunk
    )
      throw Error("Formal schedule or callbacks invalid");
    const leaseDir = join(resolve(root), "leases");
    const leases = readdirSync(leaseDir).filter((name) =>
      /^\d{6}\.json$/.test(name),
    );
    if (!leases.length) throw Error("Missing guarded resource lease");
    const last = JSON.parse(
      readFileSync(join(leaseDir, leases.sort().at(-1)), "utf8"),
    );
    if (last.session !== process.env.SIGNALLAB_V14_GUARD_SESSION)
      throw Error("Guarded resource session mismatch");
  } else if (!["fixture", "engineering"].includes(mode))
    throw Error("Unknown study mode");
  if (typeof simulate !== "function") throw Error("Missing simulation");
  const base = resolve(root);
  mkdirSync(base, { recursive: true });
  requireSpace(base);
  for (const name of ["batches", "pending", "coordination"])
    mkdirSync(join(base, name), { recursive: true });
  const plan = {
    ...batchPlan(schedule[0].scenario, schedule[0].batch),
    trials: mode === "formal" ? 1000 : 100,
  };
  const definition = {
    schema: "signallab-v14-research-stream-1",
    mode,
    protocol: manifest(),
    identity,
    schedule,
    plan,
    frames: schedule.reduce((n, s) => n + s.count, 0),
    chunkFrames: 20,
    inference: false,
    ...(mode === "formal" ? { authorization } : {}),
  };
  const definitionText = canonical(definition),
    definitionPath = join(base, "manifest.json");
  if (!existsSync(definitionPath)) {
    writeNew(definitionPath, definitionText);
    writeNew(join(base, "manifest.sha256"), digest(definitionText));
  }
  if (
    readFileSync(definitionPath, "utf8") !== definitionText ||
    readFileSync(join(base, "manifest.sha256"), "utf8") !==
      digest(definitionText)
  )
    throw Error("Research identity changed");
  const names = readdirSync(join(base, "batches")).sort();
  if (
    names.length > schedule.length ||
    names.some((name, i) => name !== String(i).padStart(6, "0"))
  )
    throw Error("Missing, reordered or duplicate chunks");
  let previous = null,
    completedChunks = 0,
    bookedBytes = scanUsage(base);
  function validateChunk(folder) {
    if (lstatSync(folder).isSymbolicLink()) throw Error("Unsafe staged chunk");
    if (readdirSync(folder).sort().join(",") !== "batch.json,batch.sha256")
      throw Error("Unexpected chunk files");
    const bytes = readFileSync(join(folder, "batch.json"));
    if (digest(bytes) !== readFileSync(join(folder, "batch.sha256"), "utf8"))
      throw Error("Chunk hash mismatch");
    const chunk = JSON.parse(bytes),
      expectedChunk = schedule[completedChunks];
    if (
      chunk.schema !== "signallab-v14-research-chunk-1" ||
      chunk.sequence !== completedChunks ||
      chunk.previous !== previous ||
      chunk.protocolSha256 !== definition.protocol.protocolSha256 ||
      canonical(chunk.parameters) !== canonical(expectedChunk) ||
      !Array.isArray(chunk.frames) ||
      chunk.frames.length !== expectedChunk.count ||
      chunk.frames.some((f, i) => f.index !== expectedChunk.start + i)
    )
      throw Error("Invalid chunk or checkpoint chain");
    summarize(chunk.frames);
    return digest(bytes);
  }
  for (const name of names) {
    previous = validateChunk(join(base, "batches", name));
    completedChunks++;
  }
  const pending = readdirSync(join(base, "pending"));
  if (pending.length) {
    if (
      pending.length !== 1 ||
      completedChunks >= schedule.length ||
      !/^stage-[A-Za-z0-9]+$/.test(pending[0])
    )
      throw Error("Unresolved staged evidence; preserve for inspection");
    const stage = join(base, "pending", pending[0]);
    const stagedHash = validateChunk(stage);
    publish(base, stage, completedChunks);
    previous = stagedHash;
    completedChunks++;
  }
  const sessionStart = performance.now();
  while (completedChunks < schedule.length) {
    if (shouldPauseSession(mode, performance.now() - sessionStart)) break;
    requireSpace(base);
    const parameters = schedule[completedChunks],
      batch = batchPlan(parameters.scenario, parameters.batch),
      frames = [];
    if (mode === "engineering") batch.trials = 100;
    for (
      let index = parameters.start;
      index < parameters.start + parameters.count;
      index++
    )
      frames.push(await simulate(batch, index));
    summarize(frames);
    const text = canonical({
      schema: "signallab-v14-research-chunk-1",
      sequence: completedChunks,
      previous,
      protocolSha256: definition.protocol.protocolSha256,
      parameters,
      frames,
    });
    const allocated = Math.ceil(Buffer.byteLength(text) / 4096) * 4096 + 65536;
    assertDiskBudget(bookedBytes, allocated);
    bookedBytes += allocated;
    const stage = mkdtempSync(join(base, "pending", "stage-"));
    writeNew(join(stage, "batch.json"), text);
    writeNew(join(stage, "batch.sha256"), digest(text));
    if (onStaged) onStaged(completedChunks, stage);
    publish(base, stage, completedChunks);
    previous = digest(text);
    completedChunks++;
    if (onChunk) onChunk(completedChunks * 20);
    if (stopAfter !== null && completedChunks >= stopAfter)
      throw Error("injected interruption after committed chunk");
  }
  return {
    completedChunks,
    frames: schedule.slice(0, completedChunks).reduce((n, s) => n + s.count, 0),
    complete: completedChunks === schedule.length,
    head: previous,
    diskBytes: scanUsage(base),
    pendingEntries: readdirSync(join(base, "pending")).length,
  };
}
