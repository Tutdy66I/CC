import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  app,
  sha,
  canonical,
  identity,
  kernel,
  makeManifest,
  readManifest,
  frozenPlan,
  pairedWrite,
  durable,
  requireSpace,
  commitDirectory,
  usage,
  locationHash,
} from "./ofdm-study-common.mjs";

const [action, directory, session, stopText = "0", authPath = ""] =
  process.argv.slice(2);
const invocationStarted = performance.now();
const timings = {
  startupAuditMs: 0,
  groups: [],
  finalAuditMs: 0,
  reportAnalysisMs: 0,
};
if (
  !["prepare", "preflight", "resume", "formal"].includes(action) ||
  !directory ||
  !/^[a-f0-9]{32}$/.test(session || "")
)
  throw Error(
    "Use ofdm-study-host.ps1; direct unsupervised execution is refused",
  );
const root = resolve(directory),
  stopAfter = Number(stopText);
const leases = readdirSync(resolve(root, "leases"))
  .filter((x) => /^\d{6}\.json$/.test(x))
  .sort();
const grant = JSON.parse(
  readFileSync(resolve(root, "leases", leases.at(-1)), "utf8"),
);
if (
  process.platform !== "win32" ||
  grant.kind !== "grant" ||
  grant.session !== session ||
  grant.childPid !== process.pid ||
  grant.memoryBytes !== 512 * 1024 ** 2 ||
  grant.hardWorkingSet !== true
)
  throw Error("Native suspended-launch guard attestation missing");
requireSpace(root);
const python = process.env.SIGNALLAB_PYTHON || "python";
const auditRuntime = JSON.parse(
  execFileSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      'import sys,hashlib,json,math;print(json.dumps(dict(version=sys.version,executableSha256=hashlib.sha256(open(sys.executable,"rb").read()).hexdigest(),probes=[math.sin(1),math.sqrt(2)],isolated=sys.flags.isolated,dontWriteBytecode=bool(sys.dont_write_bytecode))))',
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
const id = { ...identity(), guardHost: grant.hostRuntime, auditRuntime };
let m, mh;
if (!existsSync(resolve(root, "manifest.json"))) {
  if (!["prepare", "preflight"].includes(action))
    throw Error("Prepare a new study explicitly");
  m = makeManifest(action === "prepare" ? "formal" : "engineering", id, {
    studyId: randomUUID().replaceAll("-", ""),
    locationBinding: locationHash(root),
  });
  for (const entry of [...id.sources, ...id.tools]) {
    const bytes = readFileSync(resolve(app, entry.path));
    durable(
      root,
      resolve(root, "source", entry.path),
      bytes,
      m.limits.diskBytes,
    );
    durable(
      root,
      resolve(root, "source", entry.path) + ".backup",
      bytes,
      m.limits.diskBytes,
    );
  }
  mh = pairedWrite(root, resolve(root, "manifest.json"), m, m.limits.diskBytes);
  durable(root, resolve(root, "manifest.sha256"), mh, m.limits.diskBytes);
} else ({ manifest: m, manifestSha256: mh } = readManifest(root));
if (canonical(m.identity) !== canonical(id))
  throw Error("Source, tool or runtime identity changed; refuse resume");
if (
  canonical(m) !==
  canonical(
    makeManifest(m.mode, id, {
      studyId: m.studyId,
      locationBinding: locationHash(root),
    }),
  )
)
  throw Error(
    "Manifest schedule, original directory or resource limits changed",
  );
if (action === "formal") {
  if (m.mode !== "formal" || !authPath)
    throw Error("Formal execution requires separate explicit authorization");
  const a = JSON.parse(readFileSync(resolve(authPath), "utf8"));
  if (
    a.approved !== true ||
    a.manifestSha256 !== mh ||
    a.protocolSha256 !== m.budget.protocolSha256 ||
    a.fixedTrialVectors !== 36000 ||
    a.statement !==
      "I authorize this exact 36000-trial study within its frozen resource limits."
  )
    throw Error("Authorization does not match exact manifest");
  const p = resolve(root, "authorizations", sha(canonical(a)) + ".json");
  if (!existsSync(p)) pairedWrite(root, p, a, m.limits.diskBytes);
} else if (action !== "prepare" && m.mode !== "engineering")
  throw Error("Engineering command cannot execute formal seeds");
if (stopAfter && (m.mode !== "engineering" || stopAfter !== 1))
  throw Error("Only fixed engineering stop-after-one-group is supported");
const audit = () =>
  JSON.parse(
    execFileSync(
      python,
      ["-I", "-B", resolve(app, "scripts/ofdm-study-audit.py"), root],
      {
        encoding: "utf8",
        maxBuffer: 2 * 1024 ** 2,
        windowsHide: true,
      },
    ),
  );
const stopped = () =>
  existsSync(resolve(root, "stop-requests", session + ".json"));
let auditStarted = performance.now();
let state = audit();
timings.startupAuditMs = performance.now() - auditStarted;
timings.initializationMs = performance.now() - invocationStarted;
const receipt = (result) => {
  pairedWrite(
    root,
    resolve(root, "receipts", session + ".json"),
    {
      session,
      manifestSha256: mh,
      groups: result.groups,
      head: result.head,
      action,
      timings,
      ...(timings.candidateReport
        ? {
            candidateReport: timings.candidateReport,
            candidateReportSha256: timings.candidateReportSha256,
          }
        : {}),
      diskBytes: usage(root),
      stopped: result.groups < m.schedule.groups,
    },
    m.limits.diskBytes,
  );
};
if (action === "prepare") {
  receipt(state);
  console.log(
    JSON.stringify({
      prepared: true,
      root,
      manifestSha256: mh,
      formalExecutionStarted: false,
    }),
  );
} else {
  const k = await kernel(resolve(root, "source"), m.identity.sources);
  let committedHere = 0;
  for (let group = state.groups; group < m.schedule.groups; group++) {
    if (stopped()) break;
    const stage = resolve(root, "pending", session + "-" + randomUUID());
    mkdirSync(stage, { recursive: true });
    const files = [],
      began = performance.now();
    let cancelled = false;
    for (const energy of m.schedule.energies) {
      const plan = frozenPlan(m, group, energy),
        frozen = await k.freezeOfdmCombPlan(plan),
        trials = [];
      for (let index = 0; index < 80; index++) {
        if (stopped()) {
          cancelled = true;
          break;
        }
        let attempt = null;
        try {
          const raw = await k.simulateOfdmCombTrial(plan, index);
          attempt = raw;
          k.validateOfdmCombTrial(plan, raw, index);
          trials.push({
            index,
            globalFrame: group * 80 + index,
            status: "ok",
            raw,
          });
        } catch (e) {
          // Retain the attempted vector in the denominator as fully unknown, with its original error.
          const rawAttempt = JSON.parse(
            JSON.stringify(attempt, (_, value) =>
              typeof value === "number" && !Number.isFinite(value)
                ? { nonFiniteNumber: String(value) }
                : value === undefined
                  ? { unsupportedValue: "undefined" }
                  : value,
            ),
          );
          trials.push({
            index,
            globalFrame: group * 80 + index,
            status: "failed",
            rawAttempt,
            error: String(e?.stack || e).slice(0, 4096),
          });
        }
      }
      const name = energy + ".json";
      const raw = {
        schema: "signallab-ofdm-study-batch-1",
        manifestSha256: mh,
        group,
        energy,
        seed: plan.seed,
        protocolHash: frozen.protocolHash,
        plan,
        trials,
      };
      const text = JSON.stringify(raw);
      if (Buffer.byteLength(text) > 8388608)
        throw Error("Raw batch exceeded frozen 8 MiB cap");
      const hash = pairedWrite(
        root,
        resolve(stage, name),
        raw,
        m.limits.diskBytes,
      );
      files.push({ name, sha256: hash, bytes: Buffer.byteLength(text) });
      if (cancelled) break;
    }
    if (cancelled) break; // pending attempts stay archived; no partial paired vector is counted
    const log = {
      session,
      group,
      seed: m.schedule.seedBase + group,
      elapsedMs: performance.now() - began,
      action,
      result: "complete-paired-group",
    };
    const logHash = pairedWrite(
      root,
      resolve(stage, "audit.json"),
      log,
      m.limits.diskBytes,
    );
    const checkpoint = {
      schema: "signallab-ofdm-study-checkpoint-1",
      manifestSha256: mh,
      group,
      previous: state.head,
      completedTrialVectors: (group + 1) * 80,
      nextGroup: group + 1,
      files,
      auditSha256: logHash,
    };
    const head = pairedWrite(
      root,
      resolve(stage, "checkpoint.json"),
      checkpoint,
      m.limits.diskBytes,
    );
    // Independent parser validates every staged trial, both energy arms and the exact predeclared hypotheses.
    const stageAuditStarted = performance.now();
    execFileSync(
      python,
      [
        "-I",
        "-B",
        resolve(app, "scripts/ofdm-study-audit.py"),
        root,
        "--stage",
        stage,
      ],
      { encoding: "utf8", maxBuffer: 1024 ** 2, windowsHide: true },
    );
    commitDirectory(root, stage, group, session);
    timings.groups.push({
      group,
      generateAndWriteMs: log.elapsedMs,
      stageAuditMs: performance.now() - stageAuditStarted,
      rawBytes: files.reduce((s, f) => s + f.bytes, 0),
    });
    state = { groups: group + 1, head };
    committedHere++;
    if (stopAfter && committedHere === stopAfter) break;
  }
  auditStarted = performance.now();
  const final = audit();
  timings.finalAuditMs = performance.now() - auditStarted;
  const reportPath = resolve(root, "reports", session);
  const reportStarted = performance.now();
  const report = execFileSync(
    python,
    ["-I", "-B", resolve(app, "scripts/ofdm-study-audit.py"), root, "--report"],
    { encoding: "utf8", maxBuffer: 2 * 1024 ** 2, windowsHide: true },
  );
  timings.reportAnalysisMs = performance.now() - reportStarted;
  const reportHash = pairedWrite(
    root,
    reportPath + ".json",
    JSON.parse(report),
    m.limits.diskBytes,
  );
  timings.candidateReport = "reports/" + session + ".json";
  timings.candidateReportSha256 = reportHash;
  const parsed = JSON.parse(report);
  const markdown = [
    "# OFDM study audit report",
    "",
    `Mode: ${m.mode}; independent complete trial vectors: ${parsed.independentTrialVectors}.`,
    "",
    parsed.formalFixedHorizonComplete
      ? "Fixed-horizon inference verified."
      : "No final formal inference: engineering/prefix or native settlement pending.",
    "",
    "| Energy | Channel | dB | Contrast | Observed difference bounds | Simultaneous 95% interval |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...parsed.primaryComparisons.map(
      (r) =>
        `| ${r.energy} | ${r.channel} | ${r.ebN0Db} | ${r.contrast} | ${JSON.stringify(r.observedDifferenceBounds)} | ${JSON.stringify(r.simultaneous95Interval)} |`,
    ),
    "",
    ...parsed.interpretation.map((x) => "- " + x),
    "",
  ].join("\n");
  durable(root, reportPath + ".md", markdown, m.limits.diskBytes);
  durable(root, reportPath + ".md.backup", markdown, m.limits.diskBytes);
  receipt(final);
  console.log(
    JSON.stringify({
      root,
      groups: final.groups,
      completeTrialVectors: final.groups * 80,
      complete: final.groups === m.schedule.groups,
      formal: m.mode === "formal",
      manifestSha256: mh,
      report: reportPath + ".json",
    }),
  );
}
