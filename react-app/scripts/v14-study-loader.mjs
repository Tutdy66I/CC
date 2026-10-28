import { readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "./v14-study-common.mjs";

const modules = new Map();
let hooked = false;

export async function loadFrozenSnapshot(
  root,
  files,
  entry,
  afterVerification = null,
) {
  const snapshot = resolve(root),
    seen = new Set(),
    checked = new Map();
  for (const file of files) {
    const path = resolve(snapshot, file.path);
    if (
      !/^[A-Za-z0-9_./-]+$/.test(file.path) ||
      (!path.startsWith(snapshot + "\\") && !path.startsWith(snapshot + "/")) ||
      realpathSync(path) !== path ||
      seen.has(file.path)
    )
      throw Error("Unsafe snapshot file");
    seen.add(file.path);
    const bytes = readFileSync(path);
    if (digest(bytes) !== file.sha256) throw Error("Snapshot hash mismatch");
    if (file.path.startsWith("src/lib/") && file.path.endsWith(".js"))
      checked.set(pathToFileURL(path).href, bytes.toString("utf8"));
  }
  const url = pathToFileURL(resolve(snapshot, entry)).href;
  if (!checked.has(url))
    throw Error("Entry is not in verified source snapshot");
  for (const [key, source] of checked) {
    if (modules.has(key) && modules.get(key) !== source)
      throw Error("Frozen module identity changed");
    modules.set(key, source);
  }
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, next) {
        if (modules.has(context.parentURL)) {
          if (!specifier.startsWith("."))
            throw Error("Untracked numerical module dependency");
          const target = new URL(specifier, context.parentURL).href;
          if (!modules.has(target))
            throw Error("Untracked numerical module dependency");
          return { url: target, shortCircuit: true };
        }
        return next(specifier, context);
      },
      load(moduleUrl, context, next) {
        if (modules.has(moduleUrl))
          return {
            format: "module",
            source: modules.get(moduleUrl),
            shortCircuit: true,
          };
        return next(moduleUrl, context);
      },
    });
    hooked = true;
  }
  if (afterVerification) afterVerification();
  return import(url);
}
