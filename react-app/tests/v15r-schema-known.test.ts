import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { inspectCandidateJson } from "../src/research-v15r/candidateSchema.js";

const bytes = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const random = {
  domain_codes: [
    "diagnostic:01",
    "exploratory:02",
    "preflight:03",
    "confirmatory:04",
    "test:7f",
  ],
  experiment_id_bytes: 16,
  kdf: "hmac-sha256-sl15key3",
  message_encoding: "sl15rng2-90byte-be",
  roles: ["01:payload", "02:noise"],
  schema: "sl15-random-03",
  state_mapping: "direct-hmac-v1",
  version: 3,
};
test("fixed random fields validate but do not freeze the protocol", () => {
  assert.deepEqual(inspectCandidateJson("02-random.json", bytes(random)), {
    validKnownFields: true,
    frozen: false,
  });
});
test("fixed fields, order, unexpected keys and missing keys fail closed", () => {
  for (const altered of [
    { ...random, experiment_id_bytes: 15 },
    { ...random, roles: ["02:noise", "01:payload"] },
    { ...random, version: 4 },
    { ...random, schema: "wrong" },
    { ...random, unknown: 1 },
    { domain_codes: random.domain_codes, schema: random.schema, version: 3 },
  ])
    assert.throws(() => inspectCandidateJson("02-random.json", bytes(altered)));
});

test("every random field is required and its exact candidate value is checked", () => {
  for (const key of Object.keys(random)) {
    const mutation = { ...random, [key]: false };
    assert.throws(
      () => inspectCandidateJson("02-random.json", bytes(mutation)),
      key,
    );
    const missing: Record<string, unknown> = { ...random };
    delete missing[key];
    assert.throws(
      () => inspectCandidateJson("02-random.json", bytes(missing)),
      key,
    );
  }
  assert.throws(() => inspectCandidateJson("01-model.json", bytes(random)));
  assert.throws(() =>
    inspectCandidateJson("03-statistics.json", bytes(random)),
  );
});

test("numeric, evidence and dependency documents never validate as completed protocol", () => {
  const numeric = {
    decision: "qpsk-axis-ge0-zf",
    float: "ieee754-binary64",
    nonfinite: "nonfinite",
    operations: "frozen-js-order-v1",
    runtime: "runtime-node-lock-01",
    schema: "sl15-numeric-03",
    tolerances: ["test"],
    version: 3,
  };
  const evidence = {
    audit: "test",
    checkpoints: "test",
    failures: "test",
    frame_bits: 768,
    hash: "sha256",
    records: "test",
    recovery: "test",
    schema: "sl15-evidence-03",
    version: 3,
  };
  const dependencies = {
    files: [["src/a.ts", "0".repeat(64)]],
    runtimes: [["runtime/node", "0".repeat(64)]],
    schema: "sl15-dependencies-03",
    version: 3,
  };
  assert.throws(
    () => inspectCandidateJson("04-numeric.json", bytes(numeric)),
    /Unresolved candidate fields/,
  );
  assert.throws(
    () => inspectCandidateJson("05-evidence.json", bytes(evidence)),
    /Unresolved candidate fields/,
  );
  assert.throws(
    () => inspectCandidateJson("06-dependencies.json", bytes(dependencies)),
    /Unresolved candidate fields/,
  );
});

test("model locks all four scenario binary64 bit patterns", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/v15r-public-vectors.json", "utf8"),
  ) as { scenarios: Record<string, { binaryHex: string }> };
  const model = {
    active_bins: [
      ...Array.from({ length: 48 }, (_, i) => i - 48),
      ...Array.from({ length: 48 }, (_, i) => i + 1),
    ],
    cp: 16,
    data_symbols: 4,
    fft_size: 128,
    frame_bits: 768,
    mapping: "qpsk-pm1-v1",
    preamble_sha256:
      "05f462881587382993e5eb5241992665a78e753b98d10cf0922e780848183a99",
    scenarios: ["s00", "s10", "s01", "s11"].map(
      (s) => fixture.scenarios[s].binaryHex,
    ),
    schema: "sl15-model-03",
    training_sha256:
      "c26af8b3562d32329721c8cf6d19df6e6f1148b65153a98eea9403a432ddc24a",
    version: 3,
  };
  assert.equal(
    inspectCandidateJson("01-model.json", bytes(model)).frozen,
    false,
  );
  for (const key of Object.keys(model)) {
    assert.throws(
      () =>
        inspectCandidateJson(
          "01-model.json",
          bytes({ ...model, [key]: false }),
        ),
      key,
    );
  }
  const changed = [...model.scenarios];
  changed[0] = changed[0].slice(0, 26) + "80" + changed[0].slice(28);
  assert.throws(() =>
    inspectCandidateJson(
      "01-model.json",
      bytes({ ...model, scenarios: changed }),
    ),
  );
  assert.throws(() =>
    inspectCandidateJson(
      "01-model.json",
      bytes({ ...model, scenarios: [...model.scenarios].reverse() }),
    ),
  );
});

test("statistics fixes the twelve comparisons, order and endpoint contract", () => {
  const statistics = {
    alpha: "1/20",
    comparisons: ["S00", "S10", "S01", "S11"].flatMap((s) => [
      `${s}:G:POS`,
      `${s}:R:NEG`,
      `${s}:I:NONZERO`,
    ]),
    endpoints: "partial-24-two-sided-hoeffding-bonferroni",
    n_per_scenario: 34335,
    range: [-1, 1, -2, 2],
    schema: "sl15-statistics-03",
    stopping: "fixed-n-no-optional",
    version: 3,
  };
  assert.equal(
    inspectCandidateJson("03-statistics.json", bytes(statistics)).frozen,
    false,
  );
  for (const key of Object.keys(statistics)) {
    assert.throws(
      () =>
        inspectCandidateJson(
          "03-statistics.json",
          bytes({ ...statistics, [key]: false }),
        ),
      key,
    );
  }
  assert.throws(() =>
    inspectCandidateJson(
      "03-statistics.json",
      bytes({
        ...statistics,
        comparisons: [...statistics.comparisons].reverse(),
      }),
    ),
  );
  assert.throws(() =>
    inspectCandidateJson(
      "03-statistics.json",
      bytes({ ...statistics, range: [-1, 1, -1, 1] }),
    ),
  );
});
