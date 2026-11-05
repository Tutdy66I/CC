import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateDependencyGraph } from "../src/research-v15r/dependencyGraph.js";

for (const path of [
  "01-model.json",
  "02-random.json",
  "03-statistics.json",
  "04-numeric.json",
  "05-evidence.json",
  "06-dependencies.json",
  "manifest",
  "manifest.json",
  "spec/01-model.json",
  "spec/manifest.json",
  "nested/spec/06-dependencies.json",
  "SPEC/01-MODEL.JSON",
  "spec/MANIFEST.JSON",
  "spec/MANIFEST.BIN",
]) {
  test(`rejects reserved nested dependency ${path}`, () => {
    assert.throws(() => validateDependencyGraph([{ path, dependencies: [] }]));
  });
}

test("accepts ordinary dependency filenames without reserving unrelated nested names", () => {
  for (const path of [
    "src/model.ts",
    "spec/01-not-protocol.json",
    "spec/manifest-helper.ts",
    "src/01-model.json.ts",
  ]) {
    assert.doesNotThrow(() =>
      validateDependencyGraph([{ path, dependencies: [] }]),
    );
  }
});

test("dependency graph accepts sorted unique relative names and acyclic links", () => {
  assert.doesNotThrow(() =>
    validateDependencyGraph([
      { path: "src/a.ts", dependencies: ["src/b.ts"] },
      { path: "src/b.ts", dependencies: [] },
    ]),
  );
});

test("dependency graph rejects escapes, ambiguous paths and reference cycles", () => {
  for (const path of [
    "/src/a",
    "C:/a",
    "../a",
    "src/../a",
    "src//a",
    "src/",
    "src/./a",
    "src\\a",
    "01-model.json",
    "manifest.bin",
    "CON",
    "src/a.",
  ]) {
    assert.throws(
      () => validateDependencyGraph([{ path, dependencies: [] }]),
      path,
    );
  }
  assert.throws(() =>
    validateDependencyGraph([
      { path: "a", dependencies: [] },
      { path: "a", dependencies: [] },
    ]),
  );
  assert.throws(() =>
    validateDependencyGraph([
      { path: "A", dependencies: [] },
      { path: "a", dependencies: [] },
    ]),
  );
  assert.throws(() =>
    validateDependencyGraph([{ path: "a", dependencies: ["a"] }]),
  );
  assert.throws(() =>
    validateDependencyGraph([
      { path: "a", dependencies: ["b"] },
      { path: "b", dependencies: ["a"] },
    ]),
  );
  assert.throws(() =>
    validateDependencyGraph([{ path: "a", dependencies: ["missing"] }]),
  );
  assert.throws(() =>
    validateDependencyGraph([
      { path: "a", dependencies: ["b", "b"] },
      { path: "b", dependencies: [] },
    ]),
  );
});
