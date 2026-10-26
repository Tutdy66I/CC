import { readFile, stat } from "node:fs/promises";
import {
  parseOfdmCheckpoint,
  sourceFingerprint,
  sha256,
} from "./ofdm-tooling.mjs";
const path = process.argv[2];
if (!path || process.argv.length !== 3)
  throw new Error("Provide exactly one OFDM JSON path.");
if ((await stat(path)).size > 8 * 1024 * 1024)
  throw new Error("Record exceeds 8 MiB.");
const text = await readFile(path, "utf8"),
  r = await parseOfdmCheckpoint(text);
process.stdout.write(
  JSON.stringify(
    {
      status: r.status,
      frames: r.trials.length,
      targetFrames: r.plan.trials,
      protocolHash: r.protocolHash,
      sourceMatchesCurrent: r.sourceFingerprint === sourceFingerprint(),
      sha256: sha256(text),
      summary: r.summary ?? null,
    },
    null,
    2,
  ) + "\n",
);
