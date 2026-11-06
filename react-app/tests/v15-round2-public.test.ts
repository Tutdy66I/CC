import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const python =
  process.env.SIGNALLAB_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
function run(script: string): string {
  const result = spawnSync(python, ["-I", "-B", `scripts/${script}`], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

test("public round-two interval self-tests run independently", () => {
  run("v15-round2-public-selftest.py");
});

test("public transcendental bounds retain uncertified cases", () => {
  const envelopes = JSON.parse(run("v15-envelopes-public-audit.py")) as {
    results: { status: string }[];
  };
  const angles = JSON.parse(run("v15-angle-public-audit.py")) as {
    results: { status: string; case: { op: string; inputs: string[] } }[];
  };
  assert.equal(envelopes.results.length, 12);
  assert.ok(envelopes.results.every((row) => row.status === "pass"));
  assert.equal(angles.results.length, 28);
  assert.equal(
    angles.results.filter((row) => row.status === "pass").length,
    26,
  );
  assert.deepEqual(
    angles.results
      .filter((row) => row.status === "uncertified")
      .map((row) => [row.case.op, row.case.inputs]),
    [
      ["sin", ["7fefffffffffffff"]],
      ["cos", ["7fefffffffffffff"]],
    ],
  );
});

test("fixed small DSP graph retains a boundary-uncertified decision", () => {
  const graph = JSON.parse(run("v15-interval-public-audit.py")) as {
    results: {
      id: string;
      nodeCount: number;
      mismatch: string[];
      decision: string[];
    }[];
  };
  assert.deepEqual(
    graph.results.map((row) => row.id),
    ["ordinary", "cancel", "near", "zf-boundary"],
  );
  assert.ok(
    graph.results.every(
      (row) => row.nodeCount === 47 && row.mismatch.length === 0,
    ),
  );
  assert.deepEqual(graph.results[3].decision, [
    "boundary-uncertified",
    "certified",
  ]);
});

test("instrumented public ZF path matches production and remains fail-closed after refinement", () => {
  const data = JSON.parse(run("v15-zf-public-audit.py")) as {
    firstStrictCrossing: string;
    baselineDecision: string[];
    refinedDecision: string[];
    checks: { withinBaseline: boolean; withinRefined: boolean }[];
    conditionalRounding: { matches: boolean }[];
    syntheticMismatchProbe: {
      source: string;
      status: string;
      detectedNodes: string[];
    };
  };
  assert.equal(data.firstStrictCrossing, "zf.re.numerator");
  assert.deepEqual(data.baselineDecision, [
    "boundary-uncertified",
    "certified",
  ]);
  assert.deepEqual(data.refinedDecision, ["boundary-uncertified", "certified"]);
  assert.equal(data.checks.length, 16);
  assert.ok(
    data.checks.every((row) => row.withinBaseline && row.withinRefined),
  );
  assert.equal(data.conditionalRounding.length, 15);
  assert.ok(data.conditionalRounding.every((row) => row.matches));
  assert.equal(
    data.syntheticMismatchProbe.source,
    "deliberately-altered-public-test",
  );
  assert.equal(data.syntheticMismatchProbe.status, "mismatch");
  assert.ok(data.syntheticMismatchProbe.detectedNodes.includes("fft[0]"));
});
