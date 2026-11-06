// Fixed public values; no experiment identity or research RNG.
const hex = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const logs = [Number.MIN_VALUE, 0.5, 1, 1 + 2 ** -52, 2, Number.MAX_VALUE].map(
  (x) => ({ op: "log", inputs: [hex(x)], result: hex(Math.log(x)) }),
);
const hypot = [
  [0, 0],
  [3, 4],
  [1, 1],
  [0.1, 0.2],
  [Number.MIN_VALUE, Number.MIN_VALUE],
  [1e300, 1e300],
].map(([x, y]) => ({
  op: "hypot",
  inputs: [hex(x), hex(y)],
  result: hex(Math.hypot(x, y)),
}));
console.log(
  JSON.stringify({
    runtime: { node: process.versions.node, v8: process.versions.v8 },
    cases: [...logs, ...hypot],
  }),
);
