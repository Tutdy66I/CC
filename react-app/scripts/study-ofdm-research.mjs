import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  defaultOfdmPlan,
  freezeOfdmPlan,
  simulateOfdmTrial,
  makeOfdmRecord,
  identity,
  sha256,
} from "./ofdm-tooling.mjs";
const args = process.argv.slice(2);
if (
  args.some((x) => !["--register", "--screen"].includes(x)) ||
  args.length > 1
)
  throw new Error(
    "Use --register (default) or --screen. Formal studies require a separately approved protocol and budget.",
  );
const plans = ["BPSK", "QPSK", "16QAM"].map((modulation) => ({
  ...defaultOfdmPlan(),
  modulation,
  trials: 20,
}));
const frozen = await Promise.all(plans.map(freezeOfdmPlan));
const manifest = {
  version: 1,
  purpose:
    "fixed engineering screening; no model selection or formal inference",
  runtime: process.version,
  identity: await identity(),
  cellFrames: 360,
  plans: frozen,
};
if (!args.includes("--screen")) {
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  process.exit(0);
}
const output = resolve(
  "../output/signallab-v13-screen",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true });
const evidence = [];
for (const f of frozen) {
  const started = performance.now(),
    trials = [];
  for (let i = 0; i < f.plan.trials; i++)
    trials.push(await simulateOfdmTrial(f.plan, i));
  const record = await makeOfdmRecord(f, trials, manifest.identity),
    text = JSON.stringify(record),
    name = `${f.plan.modulation}.json`;
  await writeFile(join(output, name), text, { flag: "wx" });
  const allScalarDecisionsMatch = trials.every((t) =>
    t.cells.every((c) =>
      ["ideal", "ls"].every((prefix) => {
        const a = c.methods[`${prefix}-zf`],
          b = c.methods[`${prefix}-mmse`];
        return a.errors === b.errors && a.erasedBits === b.erasedBits;
      }),
    ),
  );
  if (!allScalarDecisionsMatch)
    throw new Error("Scalar hard decisions diverged.");
  evidence.push({
    allScalarDecisionsMatch,
    file: name,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    elapsedMs: performance.now() - started,
    frames: trials.length,
    summary: record.summary,
  });
}
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify({ ...manifest, evidence }, null, 2),
  { flag: "wx" },
);
process.stdout.write(
  JSON.stringify(
    {
      output,
      cellFrames: manifest.cellFrames,
      evidence: evidence.map(({ summary, ...v }) => ({
        ...v,
      })),
    },
    null,
    2,
  ) + "\n",
);
