import { ascii, concat, hex, integer, sha256 } from "./publicCrypto.js";

const FILES = [
  "01-model.json",
  "02-random.json",
  "03-statistics.json",
  "04-numeric.json",
  "05-evidence.json",
  "06-dependencies.json",
] as const;

/** Hashes ONLY the six public mock files, never a real or candidate research protocol. */
export async function computePublicFixtureIdentity(
  input: readonly { name: string; bytes: Uint8Array }[],
) {
  if (!Array.isArray(input) || input.length !== FILES.length)
    throw new Error("Invalid public fixture");
  const captured = input.map((item) => {
    if (
      !item ||
      typeof item.name !== "string" ||
      !(item.bytes instanceof Uint8Array) ||
      item.bytes.length > 128
    )
      throw new Error("Invalid public fixture file");
    return { name: item.name, bytes: new Uint8Array(item.bytes) };
  });
  const names = captured.map((item) => item.name);
  if (
    new Set(names).size !== FILES.length ||
    FILES.some((name) => !names.includes(name))
  )
    throw new Error("Invalid public fixture names");
  const ordered = FILES.map(
    (name) => captured.find((item) => item.name === name)!,
  );
  for (const item of ordered) {
    if (hex(item.bytes) !== hex(ascii(`PUBLIC_TEST_ONLY:${item.name}\n`)))
      throw new Error("Only public mock content is accepted");
  }
  const entries = await Promise.all(
    ordered.map(async (item) => {
      const name = ascii(item.name);
      return concat(
        integer(BigInt(name.length), 2),
        name,
        integer(BigInt(item.bytes.length), 8),
        await sha256(item.bytes),
      );
    }),
  );
  const root = concat(ascii("SL15PROT03"), integer(6n, 2), ...entries);
  const protocol = await sha256(root);
  const manifest = concat(ascii("SL15MAN03"), root, protocol);
  return {
    rootBytesHex: hex(root),
    protocolHash: hex(protocol),
    manifestBytesHex: hex(manifest),
    manifestHash: hex(await sha256(manifest)),
  };
}

type PublicScalar = string | number | boolean;
/** Strict parser for a small public TEST schema, not the unfinished six-file formal schema. */
export function parsePublicTestCanonical(bytes: Uint8Array): {
  schema: string;
  values: PublicScalar[];
  version: number;
} {
  if (!(bytes instanceof Uint8Array) || bytes.length > 65536)
    throw new Error("Invalid public test document");
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    new Uint8Array(bytes),
  );
  const item: unknown = JSON.parse(raw);
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Invalid public test schema");
  const value = item as {
    schema?: unknown;
    values?: unknown;
    version?: unknown;
  };
  if (
    Object.keys(item).sort().join(",") !== "schema,values,version" ||
    value.schema !== "sl15-public-test-1" ||
    value.version !== 1 ||
    !Array.isArray(value.values) ||
    value.values.length > 16
  )
    throw new Error("Invalid public test schema");
  for (const entry of value.values) {
    if (typeof entry === "string") {
      if (!/^[A-Za-z0-9._:/+-]*$/.test(entry))
        throw new Error("Invalid test string");
    } else if (typeof entry === "number") {
      if (!Number.isSafeInteger(entry) || Object.is(entry, -0))
        throw new Error("Invalid test integer");
    } else if (typeof entry !== "boolean")
      throw new Error("Invalid test scalar");
  }
  const result = {
    schema: value.schema,
    values: value.values as PublicScalar[],
    version: value.version,
  };
  if (raw !== `${JSON.stringify(result)}\n`)
    throw new Error("Non-canonical test document");
  return result;
}
