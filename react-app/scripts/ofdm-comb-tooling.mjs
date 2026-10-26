import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { ofdmCombIdentity } from "../.test-build/src/lib/ofdmCombIdentity.js";
export {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
} from "../.test-build/src/lib/ofdmCombProtocol.js";
export { simulateOfdmCombTrial } from "../.test-build/src/lib/ofdmCombResearch.js";
export {
  makeOfdmCombRecord,
  parseOfdmCombCheckpoint,
  serializeOfdmCombCheckpoint,
} from "../.test-build/src/lib/ofdmCombResearchRecord.js";
export function sourceFingerprint() {
  const h = createHash("sha256");
  for (const name of [
    ...readdirSync("src/lib")
      .filter((x) => x.endsWith(".ts"))
      .map((x) => `src/lib/${x}`),
    "src/workers/ofdmResearch.worker.ts",
    "src/workers/ofdmCombResearch.worker.ts",
  ].sort())
    h.update(name + "\0")
      .update(readFileSync(name))
      .update("\0");
  return h.digest("hex");
}
export async function identity() {
  return {
    ...(await ofdmCombIdentity()),
    sourceFingerprint: sourceFingerprint(),
  };
}
