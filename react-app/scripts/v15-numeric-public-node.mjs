// Fixed public inputs only. This is not a research runner.
import { performance } from "node:perf_hooks";

const bits = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const start = performance.now();
const basics = [
  ["add", 1, 2 ** -53],
  ["add", 1, 2 ** -52],
  ["sub", 1, 1],
  ["mul", Number.MIN_VALUE, 0.5],
  ["mul", Number.MIN_VALUE, 1.5],
  ["div", 1, 3],
  ["div", 1, 2],
  ["div", -1, 3],
].map(([op, a, b]) => ({
  op,
  a: bits(a),
  b: bits(b),
  result: bits(
    op === "add" ? a + b : op === "sub" ? a - b : op === "mul" ? a * b : a / b,
  ),
}));
const transcendentals = [
  ...[0, -0, 0.5, 1, -0.5, -1].flatMap((x) =>
    ["sin", "cos"].map((op) => ({
      op,
      input: bits(x),
      result: bits(Math[op](x)),
    })),
  ),
  ...[0, -0, Number.MIN_VALUE, 0.5, 1, 2, Number.MAX_VALUE].map((x) => ({
    op: "sqrt",
    input: bits(x),
    result: bits(Math.sqrt(x)),
  })),
];
const boundaries = [-Number.MIN_VALUE, -0, 0, Number.MIN_VALUE].map((x) => ({
  input: bits(x),
  decision: x >= 0 ? 0 : 1,
}));
const threshold = [1e-24, 0.1].flatMap((t) => {
  const tbits = BigInt(`0x${bits(t)}`);
  return [-1n, 0n, 1n].map((delta) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(tbits + delta);
    const x = b.readDoubleBE();
    return {
      threshold: bits(t),
      input: b.toString("hex"),
      gt: x > t,
      lt: x < t,
    };
  });
});
console.log(
  JSON.stringify({
    basics,
    transcendentals,
    boundaries,
    threshold,
    metrics: {
      elapsedMs: performance.now() - start,
      rssBytes: process.memoryUsage().rss,
    },
    runtime: {
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
  }),
);
