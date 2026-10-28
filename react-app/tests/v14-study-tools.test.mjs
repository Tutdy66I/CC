import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const tool = await import("../scripts/v14-study-common.mjs");

test("frozen study has four fixed comparisons, fixed sample size, paired seeds and budgets", () => {
  const m = tool.manifest();
  assert.equal(m.schedule.framesPerScenario, 25376);
  assert.equal(m.schedule.totalScenarioFrames, 101504);
  assert.equal(m.scenarios.length, 4);
  assert.deepEqual(
    m.scenarios.map((s) => [s.channel, s.ebN0Db]),
    [
      ["awgn", 0],
      ["awgn", 8],
      ["multipath", 0],
      ["multipath", 8],
    ],
  );
  assert.equal(tool.batchPlan(0, 0).seed, tool.batchPlan(3, 0).seed);
  assert.equal(tool.batchPlan(0, 25).trials, 376);
  assert.equal(m.limits.timeMs, 3600000);
  assert.equal(m.limits.memoryBytes, 536870912);
  assert.equal(m.limits.diskBytes, 4294967296);
  assert.equal(m.limits.minimumFreeBytes, 8589934592);
  assert.throws(() => tool.batchPlan(0, 26));
});

test("formal execution is refused, including alternative arguments", () => {
  assert.throws(() => tool.assertEngineeringMode("formal"), /formal/i);
  assert.throws(() => tool.assertEngineeringMode("101504"), /formal/i);
  assert.doesNotThrow(() => tool.assertEngineeringMode("preflight"));
});

test("resume refuses a different runtime or executable", () => {
  const expected = {
    node: "v24.0.0",
    platform: "win32",
    arch: "x64",
    nodeExecutableSha256: "a".repeat(64),
  };
  assert.doesNotThrow(() => tool.assertRuntime(expected, { ...expected }));
  assert.throws(
    () =>
      tool.assertRuntime(expected, {
        ...expected,
        nodeExecutableSha256: "b".repeat(64),
      }),
    /runtime/i,
  );
  assert.throws(
    () => tool.assertRuntime(expected, { ...expected, node: "v25.0.0" }),
    /runtime/i,
  );
});

test("verified module loader executes checked bytes even if source changes before import", async () => {
  const { loadFrozenSnapshot } =
    await import("../scripts/v14-study-loader.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-loader-test-"));
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  const main = join(root, "src", "lib", "main.js"),
    dep = join(root, "src", "lib", "dep.js");
  writeFileSync(main, "import { value } from './dep.js'; export { value }");
  writeFileSync(dep, "export const value = 17");
  const files = [
    { path: "src/lib/main.js", sha256: tool.digest(readFileSync(main)) },
    { path: "src/lib/dep.js", sha256: tool.digest(readFileSync(dep)) },
  ];
  const loaded = await loadFrozenSnapshot(root, files, "src/lib/main.js", () =>
    writeFileSync(dep, "export const value = 99"),
  );
  assert.equal(loaded.value, 17);
  await assert.rejects(
    loadFrozenSnapshot(root, files, "src/lib/main.js"),
    /hash mismatch/i,
  );
});

test("formal streaming cannot start without explicit approval and native guard", async () => {
  const { runResearchChunks } =
    await import("../scripts/v14-study-formal-core.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-no-formal-test-"));
  let invoked = false;
  await assert.rejects(
    runResearchChunks({
      root,
      schedule: tool.formalChunks(),
      mode: "formal",
      simulate: async () => {
        invoked = true;
      },
    }),
    /formal|approv|guard/i,
  );
  assert.equal(invoked, false);
  assert.deepEqual((await import("node:fs")).readdirSync(root), []);
});

test("formal authorization is bound to frozen protocol, source, destination and fixed horizon", async () => {
  const { checkFormalAuthorization } =
    await import("../scripts/v14-study-formal-core.mjs");
  const identity = { schema: "test-identity", files: [] },
    root = "C:/test-only-v14";
  const approval = {
    schema: "signallab-v14-formal-authorization-1",
    protocolSha256: tool.manifest().protocolSha256,
    identitySha256: tool.digest(tool.canonical(identity)),
    directorySha256: tool.digest(
      process.platform === "win32"
        ? resolve(root).toLowerCase()
        : resolve(root),
    ),
    scenarioFrames: 101504,
    statement:
      "I authorize the exact SignalLab v1.4 101504-frame study under its frozen limits.",
  };
  assert.doesNotThrow(() => checkFormalAuthorization(root, identity, approval));
  assert.throws(
    () =>
      checkFormalAuthorization(root, identity, {
        ...approval,
        scenarioFrames: 100,
      }),
    /authorization/i,
  );
  assert.throws(
    () =>
      checkFormalAuthorization(
        root,
        { ...identity, files: ["different"] },
        approval,
      ),
    /authorization/i,
  );
});

test("even a syntactically valid fixture authorization cannot start without the native session", async () => {
  const { runResearchChunks } =
    await import("../scripts/v14-study-formal-core.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-no-guard-test-"));
  const identity = { schema: "signallab-v14-preflight-identity-1", files: [] };
  const normalized =
    process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  const authorization = {
    schema: "signallab-v14-formal-authorization-1",
    protocolSha256: tool.manifest().protocolSha256,
    identitySha256: tool.digest(tool.canonical(identity)),
    directorySha256: tool.digest(normalized),
    scenarioFrames: 101504,
    statement:
      "I authorize the exact SignalLab v1.4 101504-frame study under its frozen limits.",
  };
  let calls = 0;
  await assert.rejects(
    runResearchChunks({
      root,
      schedule: tool.formalChunks(),
      mode: "formal",
      identity,
      authorization,
      simulate: async () => {
        calls++;
      },
    }),
    /guarded host/i,
  );
  assert.equal(calls, 0);
});

test("formal schedule maps all four fixed horizons to unique consecutive chunks without executing frames", () => {
  const chunks = tool.formalChunks();
  assert.equal(chunks.length, 5076);
  for (let scenario = 0; scenario < 4; scenario++) {
    const local = chunks.filter((c) => c.scenario === scenario);
    assert.equal(
      local.reduce((sum, c) => sum + c.count, 0),
      25376,
    );
    assert.equal(local[0].batch, 0);
    assert.equal(local[0].start, 0);
    assert.equal(local.at(-1).batch, 25);
    assert.equal(local.at(-1).start, 360);
    assert.equal(local.at(-1).count, 16);
  }
  assert.equal(chunks[0].seed, chunks[1269].seed);
});

test("formal sessions pause at a chunk boundary without reducing the fixed schedule", async () => {
  const { shouldPauseSession } =
    await import("../scripts/v14-study-formal-core.mjs");
  assert.equal(shouldPauseSession("formal", 44999), false);
  assert.equal(shouldPauseSession("formal", 45000), true);
  assert.equal(shouldPauseSession("engineering", 90000), false);
});

test("formal-style chunks bind scenario, batch, seed and local frame identity across interruption", async () => {
  const { runResearchChunks } =
    await import("../scripts/v14-study-formal-core.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-formal-fixture-"));
  const schedule = tool.formalChunks().slice(0, 3);
  const calls = [];
  const simulate = async (plan, index) => {
    calls.push([plan.seed, index]);
    const metric = { bits: 768, errors: 0, erasedBits: 0 };
    return {
      index,
      raw: metric,
      ideal: metric,
      estimated: { status: "ok", metric },
    };
  };
  await assert.rejects(
    runResearchChunks({ root, schedule, simulate, stopAfter: 2 }),
    /injected/,
  );
  const a = await runResearchChunks({ root, schedule, simulate });
  assert.equal(a.completedChunks, 3);
  assert.equal(calls.length, 60);
  assert.deepEqual(calls[0], [3140000000, 0]);
  assert.deepEqual(calls.at(-1), [3140000000, 59]);
  const python = process.env.SIGNALLAB_PYTHON || "python3";
  const audit = spawnSync(
    python,
    ["-I", "-B", "scripts/v14-study-audit.py", root],
    { encoding: "utf8" },
  );
  assert.equal(audit.status, 0, audit.stderr);
  const result = JSON.parse(audit.stdout);
  assert.equal(result.frames, 60);
  assert.equal(result.perScenario[0].frames, 60);
  assert.equal(result.perScenario[0].raw.bits, 60 * 768);
  assert.equal(result.perScenario[1].frames, 0);
  assert.equal(result.confidenceInterval, null);
  assert.equal(result.formalConclusion, false);
});

test("a complete staged chunk is reused after a publication failure without rerunning frames", async () => {
  const { runResearchChunks } =
    await import("../scripts/v14-study-formal-core.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-staged-recovery-"));
  const schedule = tool.formalChunks().slice(0, 1),
    calls = [];
  const simulate = async (_plan, index) => {
    calls.push(index);
    const metric = { bits: 768, errors: 0, erasedBits: 0 };
    return {
      index,
      raw: metric,
      ideal: metric,
      estimated: { status: "ok", metric },
    };
  };
  await assert.rejects(
    runResearchChunks({
      root,
      schedule,
      simulate,
      onStaged: () => {
        throw Error("injected publication failure");
      },
    }),
    /injected/,
  );
  assert.equal(
    (await import("node:fs")).readdirSync(join(root, "pending")).length,
    1,
  );
  const result = await runResearchChunks({ root, schedule, simulate });
  assert.equal(result.completedChunks, 1);
  assert.equal(calls.length, 20);
  assert.equal(
    (await import("node:fs")).readdirSync(join(root, "pending")).length,
    0,
  );
});

test("failed acquisition and erasure bits stay in the paired denominator", () => {
  const one = (errors, erasedBits) => ({ bits: 768, errors, erasedBits });
  const rows = [
    {
      raw: one(30, 0),
      ideal: one(2, 0),
      estimated: {
        status: "failed",
        reason: "low-energy",
        metric: one(0, 768),
      },
    },
    {
      raw: one(20, 0),
      ideal: one(0, 0),
      estimated: { status: "ok", metric: one(4, 2) },
    },
  ];
  const r = tool.summarize(rows);
  assert.equal(r.frames, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.estimated.bits, 1536);
  assert.equal(r.estimated.erasures, 770);
  assert.equal(r.estimated.errors, 4);
  assert.equal(r.pairedLower, (4 - 50) / 1536);
  assert.equal(r.pairedUpper, (4 + 770 - 50) / 1536);
});

test("disk and free-space limits fail closed before publication", () => {
  assert.doesNotThrow(() => tool.assertFreeSpace(8589934592));
  assert.throws(() => tool.assertFreeSpace(8589934591), /8 GiB/);
  assert.doesNotThrow(() => tool.assertDiskBudget(0, 4096));
  assert.throws(
    () => tool.assertDiskBudget(4294967296 - 32 * 1024 ** 2, 4096),
    /disk limit/i,
  );
});

test("publication is atomic and a duplicate never replaces existing evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "v14-publish-test-"));
  mkdirSync(join(root, "pending"), { recursive: true });
  const a = join(root, "pending", "a");
  mkdirSync(a);
  writeFileSync(join(a, "batch.json"), "first");
  tool.publish(root, a, 0);
  const b = join(root, "pending", "b");
  mkdirSync(b);
  writeFileSync(join(b, "batch.json"), "second");
  assert.throws(() => tool.publish(root, b, 0), /duplicate/i);
  assert.equal(
    readFileSync(join(root, "batches", "000000", "batch.json"), "utf8"),
    "first",
  );
  assert.equal(existsSync(join(b, "batch.json")), true);
});

test("interrupted preflight resumes only after verifying committed chunks and preserves failed staging", async () => {
  const { runPreflight } = await import("../scripts/v14-study-runner.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-resume-test-"));
  const calls = [];
  const simulate = async (_plan, index) => {
    calls.push(index);
    const metric = {
      bits: 768,
      errors: 0,
      erasedBits: 0,
      signalEnergy: 768,
      errorEnergy: 0,
    };
    return {
      index,
      raw: metric,
      ideal: metric,
      estimated: { status: "ok", metric },
    };
  };
  await assert.rejects(
    runPreflight({ root, simulate, stopAfter: 20 }),
    /injected/,
  );
  assert.equal(existsSync(join(root, "batches", "000000", "batch.json")), true);
  const before = readFileSync(
    join(root, "batches", "000000", "batch.json"),
    "utf8",
  );
  const result = await runPreflight({ root, simulate });
  assert.equal(result.frames, 100);
  assert.equal(
    readFileSync(join(root, "batches", "000000", "batch.json"), "utf8"),
    before,
  );
  assert.deepEqual(
    calls,
    Array.from({ length: 100 }, (_, i) => i),
  );
  assert.throws(
    () => tool.publish(root, join(root, "pending", "unused"), 0),
    /duplicate/i,
  );
});

test("independent Python audit reconstructs failures and rejects modified raw bytes", async () => {
  const { runPreflight } = await import("../scripts/v14-study-runner.mjs");
  const root = mkdtempSync(join(tmpdir(), "v14-audit-test-"));
  const simulate = async (_plan, index) => {
    const metric = (errors, erasedBits) => ({
      bits: 768,
      errors,
      erasedBits,
      signalEnergy: 768,
      errorEnergy: erasedBits ? null : 1,
    });
    return {
      index,
      raw: metric(10, 0),
      ideal: metric(2, 0),
      estimated:
        index % 2
          ? { status: "ok", metric: metric(5, 0) }
          : {
              status: "failed",
              reason: "low-coherence",
              metric: metric(0, 768),
            },
    };
  };
  await runPreflight({ root, simulate });
  const python = process.env.SIGNALLAB_PYTHON || "python3";
  const audit = () =>
    spawnSync(python, ["-I", "-B", "scripts/v14-study-audit.py", root], {
      encoding: "utf8",
    });
  const result = audit();
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.frames, 100);
  assert.equal(summary.failed, 50);
  assert.equal(summary.estimated.erasures, 38400);
  assert.equal(summary.estimated.bits, 76800);
  assert.equal(summary.formalConclusion, false);
  const file = join(root, "batches", "000000", "batch.json");
  writeFileSync(file, readFileSync(file, "utf8") + " ");
  assert.notEqual(audit().status, 0);
  await assert.rejects(runPreflight({ root, simulate }), /hash mismatch/i);
});

test("independent fixed-horizon confidence calculation uses the prespecified bound", () => {
  const python = process.env.SIGNALLAB_PYTHON || "python3";
  const code = `import importlib.util\ns=importlib.util.spec_from_file_location('audit','scripts/v14-study-audit.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\na,b,r=m.simultaneous_interval(-100,100,25376)\nassert abs(r-0.0199999484063683)<1e-14 and a<0<b\ntry:m.simultaneous_interval(2,1,100)\nexcept ValueError:pass\nelse:raise AssertionError('invalid bounds accepted')`;
  const run = spawnSync(python, ["-I", "-B", "-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test(
  "concurrent directory scan waits for the same lock as atomic publication",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "v14-race-test-"));
    const stage = join(root, "pending", "stage");
    mkdirSync(stage, { recursive: true });
    mkdirSync(join(root, "batches"));
    writeFileSync(join(stage, "batch.json"), "evidence");
    const common = pathToFileURL(resolve("scripts/v14-study-common.mjs")).href;
    const release = join(root, "release");
    const holderCode = `import {withPublicationLock} from ${JSON.stringify(common)}; import {existsSync,renameSync} from 'node:fs'; withPublicationLock(${JSON.stringify(root)},()=>{console.log('LOCKED'); while(!existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); renameSync(${JSON.stringify(stage)},${JSON.stringify(join(root, "batches", "000000"))});});`;
    const holder = spawn(
      process.execPath,
      ["--input-type=module", "-e", holderCode],
      { windowsHide: true },
    );
    let output = "";
    holder.stdout.on("data", (b) => {
      output += b;
    });
    const wait = async (check) => {
      const until = Date.now() + 8000;
      while (!check() && Date.now() < until)
        await new Promise((r) => setTimeout(r, 20));
      assert.ok(check());
    };
    await wait(() => output.includes("LOCKED"));
    const scanCode = `import {scanUsage} from ${JSON.stringify(common)}; console.log(scanUsage(${JSON.stringify(root)}));`;
    const scanner = spawn(
      process.execPath,
      ["--input-type=module", "-e", scanCode],
      { windowsHide: true },
    );
    let scanned = "";
    scanner.stdout.on("data", (b) => {
      scanned += b;
    });
    const holderExit = new Promise((r) => holder.once("exit", r)),
      scanExit = new Promise((r) => scanner.once("exit", r));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(scanned, "");
    writeFileSync(release, "release");
    assert.equal(await holderExit, 0);
    assert.equal(await scanExit, 0);
    assert.ok(Number(scanned.trim()) >= 4096);
    assert.equal(
      readFileSync(join(root, "batches", "000000", "batch.json"), "utf8"),
      "evidence",
    );
  },
);
