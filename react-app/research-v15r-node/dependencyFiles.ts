import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateDependencyGraph } from "../src/research-v15r/dependencyGraph.js";

/** Candidate inspection only: callers must make the input tree immutable against races. */
export function verifyCandidateDependencyFiles(
  root: string,
  files: readonly { path: string; sha256: string }[],
): void {
  validateDependencyGraph(
    files.map((item) => ({ path: item.path, dependencies: [] })),
  );
  if (lstatSync(root).isSymbolicLink()) throw new Error("Linked root");
  const base = realpathSync(root);
  for (const file of files) {
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error("Invalid digest");
    let current = base;
    for (const part of file.path.split("/")) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Linked dependency");
    }
    const actual = realpathSync(current),
      rel = relative(base, actual);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Escaped root");
    if (!lstatSync(current).isFile()) throw new Error("Not a file");
    const digest = createHash("sha256")
      .update(readFileSync(current))
      .digest("hex");
    if (digest !== file.sha256) throw new Error("Digest mismatch");
  }
}
