import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { ofdmIdentity } from "../.test-build/src/lib/ofdmIdentity.js";
export {
  defaultOfdmPlan,
  freezeOfdmPlan,
  workUnits,
} from "../.test-build/src/lib/ofdmProtocol.js";
export { simulateOfdmTrial } from "../.test-build/src/lib/ofdmResearch.js";
export {
  makeOfdmRecord,
  parseOfdmCheckpoint,
} from "../.test-build/src/lib/ofdmResearchRecord.js";
export function sourceFingerprint() {
  const h = createHash("sha256");
  for (const name of [
    ...readdirSync("src/lib")
      .filter((x) => x.endsWith(".ts"))
      .map((x) => `src/lib/${x}`),
    "src/workers/ofdmResearch.worker.ts",
  ].sort())
    h.update(name + "\0")
      .update(readFileSync(name))
      .update("\0");
  return h.digest("hex");
}
export async function identity() {
  return { ...(await ofdmIdentity()), sourceFingerprint: sourceFingerprint() };
}
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
