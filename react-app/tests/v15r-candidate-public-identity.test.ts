import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const names = [
  "01-model.json",
  "02-random.json",
  "03-statistics.json",
  "04-numeric.json",
  "05-evidence.json",
  "06-dependencies.json",
];
const hash = (input: Buffer) => createHash("sha256").update(input).digest();
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
function publicFixture(index: number, revision: number) {
  const entries = names.map((name, i) => {
    const n = Buffer.from(name, "ascii");
    const data = Buffer.from(
      `{"fixture":"public-only","revision":${i === index ? revision : 0}}\n`,
      "ascii",
    );
    return Buffer.concat([u16(n.length), n, u64(data.length), hash(data)]);
  });
  const root = Buffer.concat([Buffer.from("SL15PROT03"), u16(6), ...entries]);
  const protocol = hash(root),
    manifest = Buffer.concat([Buffer.from("SL15MAN03"), root, protocol]);
  return {
    root: root.toString("hex"),
    protocol: protocol.toString("hex"),
    manifest: manifest.toString("hex"),
    manifestHash: hash(manifest).toString("hex"),
  };
}
test("public-only identity independently matches Python and binds every file", () => {
  const base = publicFixture(0, 0);
  for (let index = 0; index < 6; index++)
    for (const revision of [0, 1]) {
      const actual = publicFixture(index, revision);
      const p = spawnSync(
        "python",
        [
          "-I",
          "-B",
          "scripts/v15r-candidate-public-identity.py",
          String(index),
          String(revision),
        ],
        { encoding: "utf8" },
      );
      assert.equal(p.status, 0, p.stderr || p.error?.message);
      assert.deepEqual(actual, JSON.parse(p.stdout));
      if (revision) {
        assert.notEqual(actual.protocol, base.protocol);
        assert.notEqual(actual.manifestHash, base.manifestHash);
      }
    }
});
