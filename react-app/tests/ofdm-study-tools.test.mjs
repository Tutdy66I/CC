import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import {
  app,
  identity,
  kernel,
  makeManifest,
  locationHash,
  frozenPlan,
  pairedWrite,
  durable,
  sha,
} from "../scripts/ofdm-study-common.mjs";
const python =
  process.env.SIGNALLAB_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
const auditScript = resolve(app, "scripts/ofdm-study-audit.py");
const tempPrefix = resolve(tmpdir(), "signallab-ofdm-study-");
function temporary(t) {
  const p = mkdtempSync(tempPrefix);
  t.after(() => {
    assert.ok(resolve(p).startsWith(tempPrefix));
    rmSync(p, { recursive: true, force: true });
  });
  return p;
}
const put = (p, v) => {
  const text = JSON.stringify(v);
  writeFileSync(p, text);
  writeFileSync(p + ".backup", text);
  return sha(text);
};
const get = (p) => JSON.parse(readFileSync(p, "utf8"));
const runAudit = (root, ...args) =>
  spawnSync(python, ["-I", "-B", auditScript, root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 ** 2,
  });

async function fixture(t) {
  const root = temporary(t);
  const id = {
    ...identity(),
    guardHost: "synthetic-test-host",
    auditRuntime: JSON.parse(
      spawnSync(
        python,
        [
          "-I",
          "-B",
          "-c",
          'import sys,hashlib,json,math;print(json.dumps(dict(version=sys.version,executableSha256=hashlib.sha256(open(sys.executable,"rb").read()).hexdigest(),probes=[math.sin(1),math.sqrt(2)],isolated=sys.flags.isolated,dontWriteBytecode=bool(sys.dont_write_bytecode))))',
        ],
        { encoding: "utf8", windowsHide: true },
      ).stdout,
    ),
  };
  const m = makeManifest("engineering", id, {
    studyId: "a".repeat(32),
    locationBinding: locationHash(root),
  });
  for (const e of [...id.sources, ...id.tools]) {
    const b = readFileSync(resolve(app, e.path));
    durable(root, resolve(root, "source", e.path), b, m.limits.diskBytes);
    durable(
      root,
      resolve(root, "source", e.path) + ".backup",
      b,
      m.limits.diskBytes,
    );
  }
  const mh = pairedWrite(
    root,
    resolve(root, "manifest.json"),
    m,
    m.limits.diskBytes,
  );
  durable(root, resolve(root, "manifest.sha256"), mh, m.limits.diskBytes);
  const group = resolve(root, "groups/000000");
  mkdirSync(group, { recursive: true });
  const k = await kernel(),
    files = [];
  for (const energy of ["data-eb", "total-eb"]) {
    const plan = frozenPlan(m, 0, energy),
      frozen = await k.freezeOfdmCombPlan(plan);
    const first = await k.simulateOfdmCombTrial(plan, 0);
    // Preserve actual numeric vectors plus one explicit erasure; all remaining trials are intentional test failures.
    for (const c of first.cells)
      for (const method of ["comb-zf", "comb-mmse"]) {
        c.methods[method].errors = 0;
        c.methods[method].erasedBits = 2;
        c.methods[method].rawErrorEnergy = c.methods[
          method
        ].decisionErrorEnergy = null;
      }
    const trials = Array.from({ length: 80 }, (_, index) =>
      index === 0
        ? { index, globalFrame: index, status: "ok", raw: first }
        : {
            index,
            globalFrame: index,
            status: "failed",
            rawAttempt: { nonFiniteNumber: "NaN" },
            error: "Synthetic test failure; not scientific evidence",
          },
    );
    const raw = {
      schema: "signallab-ofdm-study-batch-1",
      manifestSha256: mh,
      group: 0,
      energy,
      seed: plan.seed,
      plan,
      protocolHash: frozen.protocolHash,
      trials,
    };
    const name = energy + ".json",
      text = JSON.stringify(raw);
    files.push({
      name,
      sha256: pairedWrite(root, resolve(group, name), raw, m.limits.diskBytes),
      bytes: Buffer.byteLength(text),
    });
  }
  const ah = pairedWrite(
    root,
    resolve(group, "audit.json"),
    {
      session: "b".repeat(32),
      group: 0,
      seed: 3026102603,
      elapsedMs: 1,
      action: "preflight",
      result: "complete-paired-group",
    },
    m.limits.diskBytes,
  );
  const head = pairedWrite(
    root,
    resolve(group, "checkpoint.json"),
    {
      schema: "signallab-ofdm-study-checkpoint-1",
      manifestSha256: mh,
      group: 0,
      previous: null,
      completedTrialVectors: 80,
      nextGroup: 1,
      files,
      auditSha256: ah,
    },
    m.limits.diskBytes,
  );
  const receiptHash = pairedWrite(
    root,
    resolve(root, "receipts", "b".repeat(32) + ".json"),
    { session: "b".repeat(32), manifestSha256: mh, groups: 1, head },
    m.limits.diskBytes,
  );
  mkdirSync(resolve(root, "leases"), { recursive: true });
  const grant = {
    schema: 1,
    seq: 0,
    previous: null,
    session: "b".repeat(32),
    action: "preflight",
    kind: "grant",
    reservedMs: 30000,
    usedMs: 0,
    chargedMs: 30000,
    timeLimitMs: 120000,
    diskLimitBytes: 134217728,
    memoryBytes: 536870912,
    childPid: 0,
    hardWorkingSet: true,
    hardWorkingSetCeilingBytes: 535822336,
    hostRuntime: id.guardHost,
    peakWorkingSetBytes: 0,
  };
  const gh = put(resolve(root, "leases/000000.json"), grant);
  put(resolve(root, "leases/000001.json"), {
    ...grant,
    seq: 1,
    previous: gh,
    kind: "settle",
    reservedMs: 0,
    usedMs: 30000,
    chargedMs: 30000,
    result: "exited",
    childExit: 0,
    groups: 1,
    head,
    receiptSha256: receiptHash,
  });
  return root;
}
function copy(t, root) {
  const p = temporary(t);
  cpSync(root, p, { recursive: true });
  return p;
}
function reanchor(root) {
  const group = resolve(root, "groups/000000"),
    cpPath = resolve(group, "checkpoint.json"),
    cp = get(cpPath);
  for (const f of cp.files) {
    const b = readFileSync(resolve(group, f.name));
    f.sha256 = sha(b);
    f.bytes = b.length;
  }
  const head = put(cpPath, cp);
  const receiptPath = resolve(root, "receipts", "b".repeat(32) + ".json"),
    r = get(receiptPath);
  r.head = head;
  const rh = put(receiptPath, r),
    settlePath = resolve(root, "leases/000001.json"),
    s = get(settlePath);
  s.head = head;
  s.receiptSha256 = rh;
  put(settlePath, s);
}

test("independent audit retains failures/erasures and counts 80 vectors, never 160 arms or 2560 cells", async (t) => {
  const root = await fixture(t),
    result = runAudit(root, "--report");
  assert.equal(result.status, 0, result.stderr);
  const r = JSON.parse(result.stdout);
  assert.equal(r.independentTrialVectors, 80);
  assert.equal(r.physicalCellFrames, 2560);
  assert.equal(r.failedArmTrials, 158);
  assert.equal(r.familySize, 32);
  assert.equal(r.formalFixedHorizonComplete, false);
  assert.equal(r.primaryComparisons.length, 32);
  for (const c of r.primaryComparisons) {
    assert.equal(c.frameObservations, 80);
    assert.equal(c.simultaneous95Interval, null);
    assert.ok(c.unknownBits > 79 * 688);
    assert.equal(c.equivalenceTested, false);
  }
  assert.equal(r.descriptiveCommonDataMetrics.length, 192);
});

test("audit refuses corrupted bytes, missing files, duplicate batches and missing tail anchors", async (t) => {
  const original = await fixture(t);
  const cases = [
    (p) => writeFileSync(resolve(p, "groups/000000/data-eb.json"), "{}"),
    (p) => rmSync(resolve(p, "groups/000000/total-eb.json")),
    (p) =>
      cpSync(resolve(p, "groups/000000"), resolve(p, "groups/000001"), {
        recursive: true,
      }),
    (p) => {
      const q = resolve(p, "groups/000000");
      assert.ok(q.startsWith(tempPrefix));
      rmSync(q, { recursive: true });
    },
    (p) => writeFileSync(resolve(p, "manifest.sha256"), "0".repeat(64)),
    (p) =>
      writeFileSync(
        resolve(p, "source/scripts/ofdm-study-audit.py"),
        "corrupt",
      ),
  ];
  for (const corrupt of cases) {
    const p = copy(t, original);
    corrupt(p);
    const r = runAudit(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /AUDIT REJECTED/);
  }
  const changedRuntime = copy(t, original),
    mf = resolve(changedRuntime, "manifest.json"),
    m = get(mf);
  m.identity.auditRuntime.version = "different-python-runtime";
  const mh = put(mf, m);
  writeFileSync(resolve(changedRuntime, "manifest.sha256"), mh);
  const denied = runAudit(changedRuntime);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Python runtime\/options changed/);
});

test("even rehashed archives reject duplicate trial indices, changed seeds, CSI errors and protocol hashes", async (t) => {
  const original = await fixture(t);
  for (const mutate of [
    (r) => {
      r.trials[1].index = 0;
    },
    (r) => {
      r.seed++;
      r.plan.seed++;
    },
    (r) => {
      r.protocolHash = "a".repeat(64);
    },
    (r) => {
      r.trials[0].raw.cells[1].methods["comb-mmse"].errors++;
    },
    (r) => {
      r.trials[0].raw.cells[1].estimation.bias += 0.01;
    },
    (r) => {
      r.trials[0].raw.cells[1].methods["comb-zf"].bits++;
    },
    (r) => {
      for (const method of ["comb-zf", "comb-mmse"])
        r.trials[0].raw.cells[1].methods[method].errors = 1;
    },
    (r) => {
      r.trials[0].raw.cells[1].energy.dataCp += 1;
      r.trials[0].raw.cells[1].energy.crossCp -= 1;
    },
  ]) {
    const p = copy(t, original),
      f = resolve(p, "groups/000000/data-eb.json"),
      r = get(f);
    mutate(r);
    put(f, r);
    reanchor(p);
    const a = runAudit(p);
    assert.notEqual(a.status, 0, a.stdout);
    assert.match(a.stderr, /AUDIT REJECTED/);
  }
});

test("abandoned leases stay charged, and restarts cannot erase or exceed cumulative time", async (t) => {
  const original = await fixture(t);
  const p = copy(t, original),
    prior = get(resolve(p, "leases/000001.json"));
  let prev = sha(readFileSync(resolve(p, "leases/000001.json"))),
    charge = 30000;
  for (let i = 0; i < 4; i++) {
    charge += 30000;
    const e = {
      ...prior,
      kind: "grant",
      reservedMs: 30000,
      usedMs: 0,
      seq: i + 2,
      previous: prev,
      session: "c".repeat(32),
      chargedMs: charge,
    };
    delete e.groups;
    delete e.head;
    delete e.receiptSha256;
    prev = put(resolve(p, `leases/${String(i + 2).padStart(6, "0")}.json`), e);
    const a = runAudit(p);
    if (i < 3) {
      assert.equal(a.status, 0, a.stderr);
      assert.equal(JSON.parse(a.stdout).resourceLedger.chargedMs, charge);
    } else assert.notEqual(a.status, 0);
  }
  const q = copy(t, original),
    lease = resolve(q, "leases");
  assert.ok(lease.startsWith(tempPrefix));
  rmSync(lease, { recursive: true });
  mkdirSync(lease);
  assert.notEqual(runAudit(q).status, 0);
  const refunded = copy(t, original),
    f = resolve(refunded, "leases/000001.json"),
    s = get(f);
  s.usedMs = 1000;
  s.chargedMs = 1000;
  put(f, s);
  const rejected = runAudit(refunded);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /never be refunded/);
});

test("verified snapshot loader executes checked buffers despite later disk edits and rejects mismatched bytes", async (t) => {
  const root = temporary(t),
    dir = resolve(root, "src/lib");
  mkdirSync(dir, { recursive: true });
  const names = [
    "ofdmCombProtocol",
    "ofdmCombResearch",
    "ofdmCombResearchRecord",
  ];
  const entries = names.map((name, i) => {
    const text = `export const snapshot${i}: number = ${i + 17};`;
    writeFileSync(resolve(dir, name + ".ts"), text);
    return { path: "src/lib/" + name + ".ts", sha256: sha(text) };
  });
  const loading = kernel(root, entries);
  for (const name of names)
    writeFileSync(
      resolve(dir, name + ".ts"),
      'throw new Error("unverified changed disk code must not execute");',
    );
  const k = await loading;
  assert.equal(k.snapshot0, 17);
  assert.equal(k.snapshot1, 18);
  assert.equal(k.snapshot2, 19);
  await assert.rejects(
    () => kernel(root, entries),
    /snapshot source hash mismatch/,
  );
});

test("untrusted resource sessions and Windows absolute source paths are rejected before path use", async (t) => {
  const original = await fixture(t),
    p = copy(t, original),
    grantPath = resolve(p, "leases/000000.json"),
    grant = get(grantPath);
  grant.session = "../escape";
  const h = put(grantPath, grant);
  const settlePath = resolve(p, "leases/000001.json"),
    settle = get(settlePath);
  settle.session = "../escape";
  settle.previous = h;
  put(settlePath, settle);
  let r = runAudit(p);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unsafe resource session/);
  const q = copy(t, original),
    mf = resolve(q, "manifest.json"),
    m = get(mf);
  m.identity.sources[0].path = "C:/not-a-study-source.ts";
  const mh = put(mf, m);
  writeFileSync(resolve(q, "manifest.sha256"), mh);
  r = runAudit(q);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unsafe source snapshot path/);
});

test("simultaneous fixed-horizon intervals retain resolution limits and never assert equivalence at zero errors", () => {
  const code = `import importlib.util\ns=importlib.util.spec_from_file_location('audit',${JSON.stringify(auditScript)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr=m.hypothesis_rows()\nfor x in r:x['frameObservations']=36000\nm.intervals(r,36000,True)\nassert len(r)==32 and all(x['statisticalRadius']<.02 and x['equivalenceTested']==False and x['directionSupported']=='unresolved' for x in r)\nr[0]['sumUpperBits']=36000*688\nm.intervals(r,36000,True)\nassert not r[0]['precisionAchieved']\nr[0]['frameObservations']*=32\ntry:m.intervals(r,36000,True)\nexcept ValueError:pass\nelse:raise AssertionError('correlated observations accepted')\nprint('ok')`;
  const r = spawnSync(python, ["-c", code], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
});

test(
  "native preflight interrupt/resume matches uninterrupted raw trials, deduplicates and rejects unapproved formal start",
  { skip: process.platform !== "win32", timeout: 120000 },
  async (t) => {
    const base = resolve(app, "../output/signallab-v13-study-preparation");
    mkdirSync(base, { recursive: true });
    const interrupted = mkdtempSync(join(base, "interrupted-")),
      uninterrupted = mkdtempSync(join(base, "uninterrupted-"));
    const host = resolve(app, "scripts/ofdm-study-host.ps1");
    const args = (action, root, more = []) => [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      host,
      "-Action",
      action,
      "-Directory",
      root,
      ...more,
    ];
    const env = { ...process.env, SIGNALLAB_PYTHON: python };
    const run = (action, root, more = []) =>
      spawnSync("powershell.exe", args(action, root, more), {
        encoding: "utf8",
        env,
        windowsHide: true,
        timeout: 60000,
      });
    const child = spawn("powershell.exe", args("preflight", interrupted), {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const finished = new Promise((r) => child.once("exit", (code) => r(code)));
    const deadline = Date.now() + 20000;
    while (
      !existsSync(resolve(interrupted, "pending")) &&
      child.exitCode === null &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 40));
    assert.ok(
      existsSync(resolve(interrupted, "pending")),
      "simulation did not reach pending transaction",
    );
    const stopped = run("request-stop", interrupted);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(await finished, 0);
    const prefix = JSON.parse(runAudit(interrupted).stdout);
    assert.equal(prefix.groups, 0);
    assert.ok(prefix.pendingAttemptDirectories > 0);
    const resumed = run("resume", interrupted);
    assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
    const control = run("preflight", uninterrupted);
    assert.equal(control.status, 0, control.stdout + control.stderr);
    for (let group = 0; group < 2; group++)
      for (const energy of ["data-eb", "total-eb"]) {
        const p = `groups/${String(group).padStart(6, "0")}/${energy}.json`;
        assert.deepEqual(
          get(resolve(interrupted, p)).trials,
          get(resolve(uninterrupted, p)).trials,
        );
      }
    const before = get(resolve(interrupted, "groups/000001/checkpoint.json"));
    const repeated = run("resume", interrupted);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(
      before,
      get(resolve(interrupted, "groups/000001/checkpoint.json")),
    );
    const after = JSON.parse(runAudit(interrupted, "--report").stdout);
    assert.equal(after.independentTrialVectors, 160);
    assert.equal(after.groups, 2);
    assert.equal(after.formalFixedHorizonComplete, false);
    assert.ok(
      after.resourceLedger.chargedMs >= prefix.resourceLedger.chargedMs,
    );
    const formal = mkdtempSync(join(base, "prepared-"));
    const prepared = run("prepare", formal);
    assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    const denied = run("formal", formal);
    assert.notEqual(denied.status, 0);
    assert.equal(existsSync(resolve(formal, "groups")), false);
    const denialFile = resolve(temporary(t), "not-approved.json");
    writeFileSync(denialFile, JSON.stringify({ approved: false }));
    const explicitDenied = run("formal", formal, [
      "-AuthorizationPath",
      denialFile,
    ]);
    assert.notEqual(explicitDenied.status, 0);
    assert.equal(existsSync(resolve(formal, "groups")), false);
    for (const field of ["runtime", "tools"]) {
      const p = copy(t, formal),
        f = resolve(p, "manifest.json"),
        changed = get(f);
      if (field === "runtime") changed.identity.runtime.node = "different-node";
      else changed.identity.tools[0].sha256 = "0".repeat(64);
      changed.locationBinding = locationHash(p);
      const hash = put(f, changed);
      writeFileSync(resolve(p, "manifest.sha256"), hash);
      const rejected = run("prepare", p);
      assert.notEqual(rejected.status, 0);
      const session = JSON.parse(rejected.stdout.trim()).session;
      assert.match(
        readFileSync(resolve(p, "sessions", session + ".log"), "utf8"),
        /Source, tool or runtime identity changed/,
      );
    }
    const evidence = {
      interrupted,
      uninterrupted,
      prepared: formal,
      preflightUniqueVectors: 160,
      formalVectorsExecuted: 0,
      resumedNative: resumed.stdout,
      controlNative: control.stdout,
    };
    writeFileSync(
      resolve(base, "integration-" + Date.now() + ".json"),
      JSON.stringify(evidence, null, 2),
      { flag: "wx" },
    );
  },
);

test("disk writes refuse the next allocation before crossing a resource cap", (t) => {
  const root = temporary(t);
  assert.throws(
    () =>
      durable(
        root,
        resolve(root, "too-large.json"),
        "x".repeat(16384),
        32 * 1024 ** 2 + 8192,
      ),
    /Disk budget/,
  );
  assert.equal(existsSync(resolve(root, "too-large.json")), false);
});

test(
  "Windows native guard caps allocation and kills its own process tree on disposal",
  { skip: process.platform !== "win32", timeout: 20000 },
  (t) => {
    const root = temporary(t),
      childFile = resolve(root, "allocate.mjs"),
      log = resolve(root, "native.log");
    writeFileSync(
      childFile,
      "const a=[];for(let i=0;i<100;i++){const b=Buffer.alloc(16*1024*1024,1);a.push(b)};setInterval(()=>{},1000)",
    );
    const ps = resolve(root, "probe.ps1");
    const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
    writeFileSync(
      ps,
      `$ErrorActionPreference='Stop'\nAdd-Type -Path ${literal(resolve(app, "scripts/ofdm-study-guard.cs"))}\n$g=[OfdmStudyGuard]::Start(${literal(process.execPath)},@('--max-old-space-size=320',${literal(childFile)}),${literal(app)},${literal(log)})\ntry {$g.Resume();$w=[Diagnostics.Stopwatch]::StartNew();while(-not $g.Exited -and $w.ElapsedMilliseconds -lt 5000){Start-Sleep -Milliseconds 10};$peak=$g.PeakBytes;$commit=$g.PeakJobCommitBytes;$exit=$g.ExitCode;$pidOfChild=$g.Pid;$g.Dispose();Start-Sleep -Milliseconds 100;[pscustomobject]@{peak=$peak;commit=$commit;exit=$exit;alive=([bool](Get-Process -Id $pidOfChild -ErrorAction SilentlyContinue))}|ConvertTo-Json -Compress}finally{$g.Dispose()}`,
    );
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(r.stdout);
    t.diagnostic("native resource probe " + JSON.stringify(p));
    assert.ok(p.peak <= 512 * 1024 ** 2, JSON.stringify(p));
    assert.ok(p.commit <= 512 * 1024 ** 2);
    assert.equal(p.alive, false);
    assert.notEqual(p.exit, 0);
  },
);

test(
  "native finalizer seals only the exact fixed-horizon candidate; synthetic 32-row fixture runs no trials",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = temporary(t),
      candidate = resolve(root, "synthetic-candidate.json"),
      ps = resolve(root, "finalize.ps1");
    writeFileSync(
      candidate,
      JSON.stringify({
        testFixtureOnly: true,
        mode: "formal",
        familySize: 32,
        independentTrialVectors: 36000,
        formalFixedHorizonComplete: false,
        analysisProvisional: true,
        primaryComparisons: Array.from({ length: 32 }, () => ({
          frameObservations: 36000,
          candidateSimultaneous95Interval: [
            -0.01993686612634112, 0.01993686612634112,
          ],
          candidatePrecisionAchieved: true,
          candidateDirectionSupported: "unresolved",
          simultaneous95Interval: null,
          precisionAchieved: null,
          directionSupported: "not-tested",
          statisticalRadius: null,
        })),
      }),
    );
    const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
    writeFileSync(
      ps,
      `$ErrorActionPreference='Stop'\n$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${literal(resolve(app, "scripts/ofdm-study-host.ps1"))},[ref]$tokens,[ref]$errors)\n$f=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'FinalizeCandidate'},$true)\nInvoke-Expression $f.Extent.Text\n$c=Get-Content -LiteralPath ${literal(candidate)} -Raw|ConvertFrom-Json\n$r=FinalizeCandidate $c 'synthetic-test'\nif(-not $r.formalFixedHorizonComplete -or $r.analysisProvisional -or $r.primaryComparisons[0].statisticalRadius -gt 0.02){throw 'Finalization failed'}\n$r.primaryComparisons[0].frameObservations=80\ntry{FinalizeCandidate $r 'synthetic-test'|Out-Null;throw 'Wrong horizon accepted'}catch{if($_.Exception.Message -notmatch 'Missing independent analysis'){throw}}\n'fixture-finalization-ok'`,
    );
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fixture-finalization-ok/);
  },
);

test(
  "native absolute watchdog stops the job while the PowerShell main thread is blocked",
  { skip: process.platform !== "win32", timeout: 12000 },
  (t) => {
    const root = temporary(t),
      child = resolve(root, "idle.mjs"),
      ps = resolve(root, "deadline.ps1");
    writeFileSync(child, "setInterval(()=>{},100);");
    const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
    writeFileSync(
      ps,
      `$ErrorActionPreference='Stop'\nAdd-Type -Path ${literal(resolve(app, "scripts/ofdm-study-guard.cs"))}\n$g=[OfdmStudyGuard]::Start(${literal(process.execPath)},@(${literal(child)}),${literal(app)},${literal(resolve(root, "deadline.log"))})\ntry{$g.SetDeadlineMilliseconds(200,$false);$g.Resume();Start-Sleep -Milliseconds 1500;[pscustomobject]@{expired=$g.DeadlineExpired;exited=$g.Exited;code=$g.ExitCode}|ConvertTo-Json -Compress}finally{$g.Dispose()}`,
    );
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    assert.equal(r.status, 0, r.stderr);
    const v = JSON.parse(r.stdout);
    assert.equal(v.expired, true);
    assert.equal(v.exited, true);
    assert.equal(v.code, 137);
    const owner = resolve(root, "owner.ps1");
    writeFileSync(
      owner,
      `$ErrorActionPreference='Stop'\nAdd-Type -Path ${literal(resolve(app, "scripts/ofdm-study-guard.cs"))}\n$g=[OfdmStudyGuard]::Start(${literal(process.execPath)},@(${literal(child)}),${literal(app)},${literal(resolve(root, "owner.log"))})\n$g.SetDeadlineMilliseconds(200,$true);$g.Resume();Start-Sleep -Milliseconds 4000;throw 'Dedicated owner was not terminated'`,
    );
    const killed = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        owner,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    assert.equal(killed.status, 137, killed.stderr);
  },
);

test(
  "stop requests refuse invalid sessions and junctions without writing outside their control directory",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = temporary(t),
      target = temporary(t),
      leases = resolve(root, "leases");
    mkdirSync(leases);
    const file = resolve(leases, "000000.json");
    put(file, { seq: 0, previous: null, session: "../escape", kind: "grant" });
    const run = () =>
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(app, "scripts/ofdm-study-host.ps1"),
          "-Action",
          "request-stop",
          "-Directory",
          root,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    let r = run();
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(resolve(root, "escape.json")), false);
    put(file, {
      seq: 0,
      previous: null,
      session: "a".repeat(32),
      kind: "grant",
    });
    symlinkSync(target, resolve(root, "stop-requests"), "junction");
    r = run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /reparse point/);
    assert.equal(readdirSync(target).length, 0);
    const ancestor = resolve(root, "ancestor-link");
    symlinkSync(target, ancestor, "junction");
    const nested = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        resolve(app, "scripts/ofdm-study-host.ps1"), "-Action", "preflight",
        "-Directory", resolve(ancestor, "new-study")],
      { encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(nested.status, 0);
    assert.match(nested.stderr, /ancestors cannot be reparse points/);
    assert.equal(readdirSync(target).length, 0);
  },
);
