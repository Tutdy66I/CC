/** Strict lexical layer only: this does not validate any protocol schema. */
export function parseCanonicalJson(input: Uint8Array): unknown {
  if (!(input instanceof Uint8Array) || input.length > 1_048_576)
    throw new Error("Invalid JSON bytes");
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    new Uint8Array(input),
  );
  if (!/^[\x20-\x7e]*\n$/.test(raw)) throw new Error("Invalid encoding");
  const value: unknown = JSON.parse(raw);
  const canonical = (v: unknown): string => {
    if (typeof v === "string") {
      if (!/^[A-Za-z0-9._:/+-]+$/.test(v)) throw new Error("Invalid string");
      return JSON.stringify(v);
    } else if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || Object.is(v, -0))
        throw new Error("Invalid integer");
      return String(v);
    } else if (typeof v === "boolean") return String(v);
    else if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    else if (v && typeof v === "object") {
      const keys = Object.keys(v).sort();
      return `{${keys.map((key) => `${canonical(key)}:${canonical((v as Record<string, unknown>)[key])}`).join(",")}}`;
    } else throw new Error("Invalid value");
  };
  if (raw !== `${canonical(value)}\n`) throw new Error("Noncanonical JSON");
  return value;
}
