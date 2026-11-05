import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  computePublicFixtureIdentity,
  parsePublicTestCanonical,
} from "../src/research-v15r/publicTestIdentity.js";
import {
  convertPublicUniform53,
  derivePublicTestBlock,
  encodePublicScenario,
} from "../src/research-v15r/publicTestRandom.js";

type Vector = {
  name: string;
  scenarioId: string;
  experimentId: string;
  protocolId: string;
  frameId: string;
  role: number;
  slot: number;
  addressHex: string;
  runKeyHex: string;
  digestHex: string;
  bits2: number;
  k1: string;
  k2: string;
  u1Binary64: string;
  u2Binary64: string;
};
type Fixture = {
  testOnly: boolean;
  testPhaseHex: string;
  publicTestRootHex: string;
  scenarios: Record<string, { binaryHex: string; id: string }>;
  testOnlyManifest: {
    files: { name: string; contentHex: string; sha256: string }[];
    rootBytesHex: string;
    protocolHash: string;
    manifestBytesHex: string;
    manifestHash: string;
  };
  cases: Vector[];
};
const fixture = JSON.parse(
  readFileSync("tests/fixtures/v15r-public-vectors.json", "utf8"),
) as Fixture;
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const text = (s: string) => new TextEncoder().encode(s);

test("public mock manifest exactly matches independently computed identity", async () => {
  const m = fixture.testOnlyManifest;
  const files = m.files.map((f) => ({
    name: f.name,
    bytes: bytes(f.contentHex),
  }));
  assert.deepEqual(await computePublicFixtureIdentity(files), {
    rootBytesHex: m.rootBytesHex,
    protocolHash: m.protocolHash,
    manifestBytesHex: m.manifestBytesHex,
    manifestHash: m.manifestHash,
  });
  assert.equal(
    (await computePublicFixtureIdentity([...files].reverse())).protocolHash,
    m.protocolHash,
  );
  await assert.rejects(
    computePublicFixtureIdentity([...files.slice(0, 5), files[0]]),
  );
  await assert.rejects(computePublicFixtureIdentity(files.slice(0, 5)));
  const bad = files.map((f) => ({ name: f.name, bytes: f.bytes.slice() }));
  bad[0].bytes[0] ^= 1;
  await assert.rejects(computePublicFixtureIdentity(bad));
});

test("mock manifest snapshots its input before hashing", async () => {
  const m = fixture.testOnlyManifest;
  const files = m.files.map((f) => ({
    name: f.name,
    bytes: bytes(f.contentHex),
  }));
  const pending = computePublicFixtureIdentity(files);
  files[0].bytes.fill(0);
  files[1].name = "changed";
  assert.equal((await pending).protocolHash, m.protocolHash);
});

test("public uniform conversion retains both exact endpoints", () => {
  const min = convertPublicUniform53(0n, 0n),
    max = convertPublicUniform53((1n << 53n) - 1n, (1n << 53n) - 1n);
  assert.deepEqual(min, {
    u1Binary64: "3ca0000000000000",
    u2Binary64: "0000000000000000",
  });
  assert.deepEqual(max, {
    u1Binary64: "3ff0000000000000",
    u2Binary64: "3fefffffffffffff",
  });
  assert.throws(() => convertPublicUniform53(-1n, 0n));
  assert.throws(() => convertPublicUniform53(0n, 1n << 53n));
});

test("public canonical test parser rejects duplicate keys, alternate encodings and unsupported schema", () => {
  const valid =
    '{"schema":"sl15-public-test-1","values":["a",1,true],"version":1}\n';
  assert.deepEqual(parsePublicTestCanonical(text(valid)), {
    schema: "sl15-public-test-1",
    values: ["a", 1, true],
    version: 1,
  });
  for (const invalid of [
    valid.trimEnd(),
    valid.replace('"schema"', ' "schema"'),
    valid.replace('"version":1', '"version":1,"version":1'),
    '{"values":[],"schema":"sl15-public-test-1","version":1}\n',
    valid.replace('"version":1', '"version":1.0'),
    valid.replace('"version":1', '"version":-0'),
    valid.replace('"a"', '"中文"'),
    valid.replace("sl15-public-test-1", "sl15-formal-1"),
    valid.replace('"version":1', '"version":9007199254740992'),
  ])
    assert.throws(() => parsePublicTestCanonical(text(invalid)), invalid);
  assert.throws(() => parsePublicTestCanonical(new Uint8Array([0xff])));
  assert.throws(() =>
    parsePublicTestCanonical(
      Uint8Array.from([0xef, 0xbb, 0xbf, ...text(valid)]),
    ),
  );
});

test("four public scenario encodings match immutable independently reviewed vectors", async () => {
  for (const name of ["s00", "s10", "s01", "s11"] as const) {
    const s = fixture.scenarios[name];
    assert.deepEqual(await encodePublicScenario(name), {
      binaryHex: s.binaryHex,
      scenarioId: s.id,
    });
  }
});

test("eight public KDF/HMAC vectors match every field", async () => {
  for (const v of fixture.cases) {
    const actual = await derivePublicTestBlock({
      domain: 0x7f,
      protocolId: bytes(v.protocolId),
      scenarioId: bytes(v.scenarioId),
      experimentId: bytes(v.experimentId),
      frameId: BigInt(v.frameId),
      role: v.role,
      slot: v.slot,
      block: 0,
    });
    assert.deepEqual(
      actual,
      {
        addressHex: v.addressHex,
        runKeyHex: v.runKeyHex,
        digestHex: v.digestHex,
        bits2: v.bits2,
        k1: v.k1,
        k2: v.k2,
        u1Binary64: v.u1Binary64,
        u2Binary64: v.u2Binary64,
      },
      v.name,
    );
  }
});

test("public random adapter rejects production domains, secret roots and invalid coordinates", async () => {
  const v = fixture.cases[0];
  const a = {
    domain: 0x7f,
    protocolId: bytes(v.protocolId),
    scenarioId: bytes(v.scenarioId),
    experimentId: bytes(v.experimentId),
    frameId: 0n,
    role: 1,
    slot: 80,
    block: 0,
  };
  for (const bad of [
    { ...a, domain: 4 },
    { ...a, domain: 1 },
    { ...a, root: new Uint8Array(32) },
    { ...a, protocolId: new Uint8Array(32) },
    { ...a, scenarioId: new Uint8Array(32) },
    { ...a, experimentId: new Uint8Array(16) },
    { ...a, frameId: -1n },
    { ...a, frameId: 34335n },
    { ...a, role: 3 },
    { ...a, slot: 0 },
    { ...a, slot: 512 },
    { ...a, block: 1 },
  ])
    await assert.rejects(derivePublicTestBlock(bad));
  assert.equal(fixture.testOnly, true);
  assert.equal(fixture.testPhaseHex, "7f");
});

test("public IDs are snapshotted before asynchronous derivation", async () => {
  const v = fixture.cases[0],
    protocolId = bytes(v.protocolId),
    scenarioId = bytes(v.scenarioId),
    experimentId = bytes(v.experimentId);
  const pending = derivePublicTestBlock({
    domain: 0x7f,
    protocolId,
    scenarioId,
    experimentId,
    frameId: 0n,
    role: 1,
    slot: 80,
    block: 0,
  });
  protocolId.fill(0);
  scenarioId.fill(0);
  experimentId.fill(0);
  assert.equal((await pending).digestHex, v.digestHex);
});

test("independent Python implementation reproduces the entire public fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "signallab-v15r-test-")),
    file = join(dir, "reference.json");
  try {
    const p = spawnSync(
      "python",
      ["-I", "-B", "scripts/v15r-public-vectors.py", file],
      { encoding: "utf8" },
    );
    assert.equal(p.status, 0, p.stderr || String(p.error));
    const original = readFileSync(file);
    assert.deepEqual(JSON.parse(original.toString("utf8")), fixture);
    const second = spawnSync(
      "python",
      ["-I", "-B", "scripts/v15r-public-vectors.py", file],
      { encoding: "utf8" },
    );
    assert.notEqual(second.status, 0);
    assert.deepEqual(readFileSync(file), original);
  } finally {
    if (existsSync(file)) unlinkSync(file);
    rmdirSync(dir);
  }
});
