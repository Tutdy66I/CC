// Engineering acceptance only: one actual production Worker in a minimal owner page.
// OS counters are whole-renderer native upper bounds, never per-thread attribution.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  sourceFingerprint,
} from "./ofdm-comb-tooling.mjs";
import { makeOfdmCombCheckpoint } from "../.test-build/src/lib/ofdmCombResearchRecord.js";
if (process.platform !== "win32")
  throw new Error(
    "Native PeakWorkingSet64 acceptance requires Windows; JS heap is not a substitute.",
  );
if (process.argv.length > 2)
  throw new Error(
    "Fixed protocol: three fresh instances, default workload, 256 MiB absolute renderer limit.",
  );
const here = dirname(fileURLToPath(import.meta.url)),
  app = resolve(here, ".."),
  out = resolve(
    app,
    "../output/signallab-v13-release-acceptance/native-" +
      new Date().toISOString().replaceAll(":", "-"),
  );
mkdirSync(out, { recursive: true });
process.chdir(app);
const require = createRequire(resolve(app, "package.json")),
  { chromium } = require("playwright");
const workerFile = readdirSync("dist/assets").find((x) =>
  /^ofdmCombResearch\.worker-.+\.js$/.test(x),
);
if (!workerFile) throw new Error("Production comb Worker missing");
const workerBytes = readFileSync(resolve("dist/assets", workerFile));
const server = createServer((req, res) => {
  if (req.url === `/${workerFile}`) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(workerBytes);
  } else if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>single Worker native probe</title>',
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const counters = (ids) =>
  JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(here, "ofdm-process-memory.ps1"),
        "-ProbeIds",
        ids.join(","),
      ],
      { encoding: "utf8" },
    ),
  );
const frozen = await freezeOfdmCombPlan(defaultOfdmCombPlan()),
  results = [];
try {
  const repeats = 3,
    firstRun = 1;
  writeFileSync(
    resolve(out, "policy.json"),
    JSON.stringify(
      {
        policyVersion: "signallab-v13-native-renderer-1",
        thresholdMiB: 256,
        runs: 3,
        workload: frozen.plan,
        sourceFingerprint: sourceFingerprint(),
        workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
        scriptSha256: createHash("sha256")
          .update(readFileSync(fileURLToPath(import.meta.url)))
          .digest("hex"),
        original64MiBGoal: "not verified",
        metric:
          "absolute Windows renderer PeakWorkingSet64 including minimal owner, native process overhead, tracing and production Worker handoff; no forced GC/trim",
      },
      null,
      2,
    ),
  );
  for (let run = firstRun; run < firstRun + repeats; run++) {
    const browserServer = await chromium.launchServer({ headless: true }),
      browser = await chromium.connect(browserServer.wsEndpoint());
    try {
      const cdp = await browser.newBrowserCDPSession(),
        events = [];
      cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
      await cdp.send("Tracing.start", {
        categories: "devtools.timeline,disabled-by-default-devtools.timeline",
        transferMode: "ReportEvents",
      });
      const context = await browser.newContext(),
        page = await context.newPage();
      await page.goto(origin);
      const ready = await page.evaluate(
        async ({ workerFile, run }) => {
          const w = new globalThis.Worker("/" + workerFile),
            state = {
              ready: null,
              done: null,
              error: null,
              seen: 0,
              runId: "native-" + run,
            };
          globalThis.nativeProbe = { w, state };
          return await new Promise((resolve, reject) => {
            w.onerror = (e) => {
              state.error = e.message;
              reject(new Error(e.message));
            };
            w.onmessage = (e) => {
              const m = e.data;
              if (m.type === "ready") {
                state.ready = m;
                resolve(m);
              } else if (m.type === "batch") {
                state.seen += m.trials.length;
              } else if (m.type === "error") {
                state.error = m.message;
              } else if (m.type === "done") {
                state.done = {
                  status: m.record.status,
                  frames: m.record.trials.length,
                  summaryRows: m.record.summary.length,
                  integrityHash: m.record.integrityHash,
                  protocolHash: m.record.protocolHash,
                  sourceFingerprint: m.sourceFingerprint,
                };
              }
            };
            w.postMessage({ type: "init", runId: state.runId });
          });
        },
        { workerFile, run },
      );
      if (ready.sourceFingerprint !== sourceFingerprint())
        throw new Error("Bundled/source fingerprint mismatch");
      const processes = await cdp.send("SystemInfo.getProcessInfo"),
        ids = processes.processInfo
          .filter((p) => p.type === "renderer")
          .map((p) => Number(p.id));
      if (!ids.length) throw new Error("No renderer process candidates");
      const baseline = counters(ids),
        cp = await makeOfdmCombCheckpoint(frozen, [], {
          sourceFingerprint: ready.sourceFingerprint,
          runtimeFingerprint: ready.runtimeFingerprint,
        });
      const started = performance.now();
      await page.evaluate((cp) => {
        const p = globalThis.nativeProbe;
        p.w.postMessage({
          type: "start",
          runId: p.state.runId,
          checkpoint: cp,
        });
      }, cp);
      await page.waitForFunction(
        () =>
          globalThis.nativeProbe.state.done ||
          globalThis.nativeProbe.state.error,
        {},
        { timeout: 30000 },
      );
      const elapsedMs = performance.now() - started,
        state = await page.evaluate(() => globalThis.nativeProbe.state);
      if (state.error) throw new Error(state.error);
      if (
        state.seen !== 100 ||
        state.done.frames !== 100 ||
        state.done.protocolHash !== frozen.protocolHash
      )
        throw new Error("Incomplete production Worker workload");
      const after = counters(ids);
      const traceComplete = new Promise((r) =>
        cdp.once("Tracing.tracingComplete", r),
      );
      await cdp.send("Tracing.end");
      await traceComplete;
      const workerThreads = events.filter(
        (e) =>
          e.name === "thread_name" &&
          /DedicatedWorker/i.test(e.args?.name || ""),
      );
      const workerEvents = events.filter((e) =>
        /TracingSessionIdForWorker|WorkerThread|workerStart/i.test(e.name),
      );
      const peaks = after
        .filter((x) => !x.exited)
        .map((x) => x.peakWorkingSetBytes / 1024 ** 2);
      const result = {
        run,
        browser: browser.version(),
        browserPid: browserServer.process().pid,
        workerFile,
        sourceFingerprint: ready.sourceFingerprint,
        runtimeFingerprint: ready.runtimeFingerprint,
        protocolHash: frozen.protocolHash,
        plan: frozen.plan,
        elapsedMs,
        baseline,
        after,
        workerThreads,
        workerEvents: workerEvents.slice(0, 20),
        maxCandidateRendererPeakMiB: Math.max(...peaks),
        allCandidatesSurvived: after.every((x) => !x.exited),
        workload: state.done,
        interpretation:
          "Windows PeakWorkingSet64 for fresh candidate renderer processes hosting a minimal page and one production Worker, including native process overhead and tracing. Absolute process upper bound; baseline delta is not an exact Worker working set. No forced GC or working-set trimming.",
      };
      writeFileSync(
        resolve(out, `native-worker-run-${run}.json`),
        JSON.stringify(result, null, 2),
      );
      writeFileSync(
        resolve(out, `native-worker-trace-${run}.json`),
        JSON.stringify({ traceEvents: events }),
      );
      result.pass =
        result.maxCandidateRendererPeakMiB <= 256 &&
        result.allCandidatesSurvived &&
        result.workerThreads.length === 1 &&
        result.after.some(
          (p) => !p.exited && p.id === result.workerThreads[0].pid,
        );
      results.push(result);
      console.log(
        JSON.stringify({
          run,
          elapsedMs,
          baseline,
          after,
          workerThreads,
          maxCandidateRendererPeakMiB: result.maxCandidateRendererPeakMiB,
        }),
      );
    } finally {
      await browser.close();
      await browserServer.close();
    }
  }
} finally {
  await new Promise((r) => server.close(r));
}
const summary = {
  pass: results.length === 3 && results.every((r) => r.pass),
  thresholdMiB: 256,
  maximumObservedMiB: Math.max(
    ...results.map((r) => r.maxCandidateRendererPeakMiB),
  ),
  runs: results.map((r) => ({
    run: r.run,
    peakMiB: r.maxCandidateRendererPeakMiB,
    elapsedMs: r.elapsedMs,
    pass: r.pass,
  })),
  scope:
    "Windows Chromium renderer upper bound; not per-thread attribution or iPad native memory",
  original64MiBGoal: "not verified",
};
writeFileSync(
  resolve(out, "native-worker-summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify({ out, ...summary }, null, 2));
if (!summary.pass) process.exitCode = 1;
