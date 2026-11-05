import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyCandidateDependencyFiles } from "../research-v15r-node/dependencyFiles.js";

test("dependency files require exact bytes and reject directory links", () => {
  const base = mkdtempSync(join(tmpdir(), "sl15-deps-"));
  try {
    const root = join(base, "root"),
      outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a"), "known");
    writeFileSync(join(outside, "secret"), "known");
    const sha = createHash("sha256").update("known").digest("hex");
    assert.doesNotThrow(() =>
      verifyCandidateDependencyFiles(root, [{ path: "src/a", sha256: sha }]),
    );
    assert.throws(() =>
      verifyCandidateDependencyFiles(root, [
        { path: "src/a", sha256: "0".repeat(64) },
      ]),
    );
    symlinkSync(outside, join(root, "link"), "junction");
    assert.throws(() =>
      verifyCandidateDependencyFiles(root, [
        { path: "link/secret", sha256: sha },
      ]),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
