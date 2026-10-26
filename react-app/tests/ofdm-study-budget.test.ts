import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  defaultOfdmCombPlan,
  validateOfdmCombPlan,
  workUnits,
} from "../src/lib/ofdmCombProtocol.js";
import { canonicalOfdm } from "../src/lib/ofdmProtocol.js";
const budget = JSON.parse(
  readFileSync("../docs/signallab-v13-study-budget.json", "utf8"),
);
test("formal paired BER budget independently satisfies simultaneous tail probability and minimum sample bound", () => {
  const p = budget.precision,
    s = budget.primaryScope,
    M =
      s.channels.length *
      s.ebN0Db.length *
      s.energyBases.length *
      budget.contrasts.length;
  assert.equal(M, 32);
  assert.equal(p.familySize, M);
  assert.equal(p.fixedFrames, 36000);
  const bound = (n: number) =>
    2 * M * Math.exp((-n * p.absoluteHalfWidth ** 2) / 2);
  assert.ok(bound(p.fixedFrames) <= 1 - p.familyConfidence);
  assert.ok(bound(p.minimumFrames) <= 1 - p.familyConfidence);
  assert.ok(bound(p.minimumFrames - 1) > 1 - p.familyConfidence);
  assert.ok(p.simultaneousHalfWidth <= 0.02);
  assert.equal(p.parameter, "complete-frame paired BER difference");
});
test("formal stream schedule has 36000 distinct seed/index pairs and bounded record/disk resources", () => {
  const s = budget.seedSchedule,
    r = budget.resourceBudget,
    p = budget.precision,
    keys = new Set<string>();
  assert.equal(s.batchFrames * s.batchesPerEnergy, p.fixedFrames);
  for (let i = 0; i < p.fixedFrames; i++) {
    const seed = s.formalBaseSeed + Math.floor(i / s.batchFrames),
      index = i % s.batchFrames;
    assert.ok(seed >= 0 && seed <= 0xffffffff);
    assert.notEqual(seed, s.preflightSeed);
    keys.add(`${seed}/${index}`);
  }
  assert.equal(keys.size, p.fixedFrames);
  assert.equal(r.totalBatchRecords, 900);
  assert.equal(r.physicalCellFrames, 1152000);
  assert.equal(
    (r.totalBatchRecords * r.maxCompactBytesPerRecord) / 1024 ** 3,
    r.rawHardBoundGiB,
  );
  assert.ok(r.rawHardBoundGiB * (1 + r.backupCopies) + 1 < r.totalDiskCapGiB);
  assert.equal(r.wallLimitSeconds, 7200);
  assert.equal(r.nodeProcessPeakLimitMiB, 512);
  assert.equal(r.minimumFreeDiskGiB, 20);
});
test("budget batches fit unchanged browser protocol and the planning artifact hash is intact", () => {
  const s = budget.primaryScope,
    r = budget.resourceBudget,
    p = {
      ...defaultOfdmCombPlan(),
      ...s,
      energyBasis: "data-eb" as const,
      trials: budget.seedSchedule.batchFrames,
      seed: budget.seedSchedule.formalBaseSeed,
    };
  validateOfdmCombPlan(p);
  assert.equal(workUnits(p), r.perBatchWorkUnits);
  assert.equal(r.perBatchCellFrames, 1280);
  const { protocolSha256, ...payload } = budget;
  assert.equal(
    createHash("sha256").update(canonicalOfdm(payload)).digest("hex"),
    protocolSha256,
  );
});
