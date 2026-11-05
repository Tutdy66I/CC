import { ascii, concat, hex, integer, sha256, unhex } from "./publicCrypto.js";

// These identifiers and the key are public, fixed test vectors. No caller-supplied root is accepted.
const ROOT = unhex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);
const PROTOCOLS = [
  "bbe3dfe2acf6c620fceee82712af9e536f68bc6aefb34fbde6d2e74501ea7da1",
  "7071450d16649b3430fff410f2855306794032d52c408d3199605781f882fb54",
];
const EXPERIMENTS = [
  "00112233445566778899aabbccddeeff",
  "00112233445566778899aabbccddee00",
];
const SCENARIOS = [
  "d49e593c0f5867bf3222b99173b3a9c2e0cebdded71523682ae59733ea6b4258",
  "424d17633e5727115ef28615bcb083de4f20ac749505d14aea3f8cccbd7f58ad",
  "c3bfa3d09c7683d44a88d63da89f760cda942311c2bbce2b042ad8feb1537ee1",
  "3ecc2784d0e3d733e8b74ce9e7ae77c82fa2a09f542ae662968d98289e2f0ede",
];
async function hmac(
  key: Uint8Array,
  value: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", imported, new Uint8Array(value)),
  );
}

export async function encodePublicScenario(
  name: "s00" | "s10" | "s01" | "s11",
) {
  if (!["s00", "s10", "s01", "s11"].includes(name))
    throw new Error("Invalid public scenario");
  const cfo =
    name === "s10" || name === "s11" ? "3fc999999999999a" : "0000000000000000";
  const sto = name === "s01" || name === "s11" ? 4n : 0n;
  const taps = [
    [0n, "3fec9f25c5bfedd9"],
    [3n, "3fd8c97ef43f7248"],
    [7n, "3fcc9f25c5bfedd9"],
  ] as const;
  const result = concat(
    ascii("SL15SC02"),
    integer(128n, 2),
    new Uint8Array([4]),
    integer(16n, 2),
    unhex(cfo),
    integer(sto, 2),
    new Uint8Array(8),
    unhex("3f847ae147ae147b"),
    new Uint8Array([3]),
    ...taps.map(([delay, gain]) =>
      concat(integer(delay, 2), unhex(gain), new Uint8Array(8)),
    ),
    unhex("3fb999999999999a"),
    integer(2n, 2),
  );
  return { binaryHex: hex(result), scenarioId: hex(await sha256(result)) };
}

type PublicInput = {
  domain: number;
  protocolId: Uint8Array;
  scenarioId: Uint8Array;
  experimentId: Uint8Array;
  frameId: bigint;
  role: number;
  slot: number;
  block: number;
};
function capturedId(
  value: Uint8Array,
  expectedLength: number,
  allow: readonly string[],
) {
  if (
    !(value instanceof Uint8Array) ||
    value.length !== expectedLength ||
    (typeof SharedArrayBuffer !== "undefined" &&
      value.buffer instanceof SharedArrayBuffer)
  )
    throw new Error("Invalid public test identity");
  const copy = new Uint8Array(value);
  if (!allow.includes(hex(copy)))
    throw new Error("Only public test identities are permitted");
  return copy;
}
function binary64(value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return hex(bytes);
}
export function convertPublicUniform53(k1: bigint, k2: bigint) {
  const max = (1n << 53n) - 1n;
  if (
    typeof k1 !== "bigint" ||
    typeof k2 !== "bigint" ||
    k1 < 0n ||
    k1 > max ||
    k2 < 0n ||
    k2 > max
  )
    throw new Error("Invalid public uniform inputs");
  return {
    u1Binary64: binary64(Number(k1 + 1n) / 2 ** 53),
    u2Binary64: binary64(Number(k2) / 2 ** 53),
  };
}

/** Deliberately restricted to phase 0x7f, the public fixture key and public test identities. */
export async function derivePublicTestBlock(input: PublicInput) {
  if (
    !input ||
    Object.keys(input).sort().join(",") !==
      "block,domain,experimentId,frameId,protocolId,role,scenarioId,slot" ||
    input.domain !== 0x7f ||
    typeof input.frameId !== "bigint" ||
    input.frameId < 0n ||
    input.frameId > 34334n ||
    !Number.isSafeInteger(input.slot) ||
    input.block !== 0 ||
    ![1, 2].includes(input.role)
  )
    throw new Error("Invalid public test request");
  const k = input.slot % 128;
  if (
    (input.role === 1 &&
      (input.slot < 0 ||
        input.slot >= 512 ||
        !((k >= 1 && k <= 48) || (k >= 80 && k <= 127)))) ||
    (input.role === 2 && (input.slot < 0 || input.slot > 1046))
  )
    throw new Error("Invalid public test slot");
  // Snapshot every mutable identifier before the first asynchronous operation.
  const protocol = capturedId(input.protocolId, 32, PROTOCOLS),
    scenario = capturedId(input.scenarioId, 32, SCENARIOS),
    experiment = capturedId(input.experimentId, 16, EXPERIMENTS);
  const frameId = input.frameId,
    role = input.role,
    slot = input.slot;
  const key = await hmac(
    ROOT,
    concat(ascii("SL15KEY3"), new Uint8Array([0x7f]), protocol, experiment),
  );
  const address = concat(
    ascii("SL15RNG2"),
    new Uint8Array([0x7f]),
    protocol,
    scenario,
    integer(frameId, 8),
    new Uint8Array([role]),
    integer(BigInt(slot), 4),
    integer(0n, 4),
  );
  const digest = await hmac(key, address),
    view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const k1 = view.getBigUint64(0, false) >> 11n,
    k2 = view.getBigUint64(8, false) >> 11n;
  return {
    addressHex: hex(address),
    runKeyHex: hex(key),
    digestHex: hex(digest),
    bits2: digest[0] >> 6,
    k1: String(k1),
    k2: String(k2),
    ...convertPublicUniform53(k1, k2),
  };
}
