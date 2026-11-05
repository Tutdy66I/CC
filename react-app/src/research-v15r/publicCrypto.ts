// Public-fixture helpers only; this module does not obtain or create random keys.
export const ascii = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value);

export function concat(
  ...parts: readonly Uint8Array[]
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, p) => size + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function integer(
  value: bigint,
  bytes: 2 | 4 | 8,
): Uint8Array<ArrayBuffer> {
  if (value < 0n || value >= 1n << BigInt(bytes * 8))
    throw new Error("Integer out of range");
  const result = new Uint8Array(bytes);
  for (let index = bytes - 1; index >= 0; index--) {
    result[index] = Number(value & 255n);
    value >>= 8n;
  }
  return result;
}

export const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("Invalid hexadecimal");
  return Uint8Array.from(value.match(/../g)!, (pair) =>
    Number.parseInt(pair, 16),
  );
}

export async function sha256(
  value: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(value)),
  );
}
