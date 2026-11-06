// Public fixed inputs only.
const hex = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
};
const trig = [0, -0, -1000, -10, -2, 2, 10, 1000, Number.MAX_VALUE].flatMap(
  (x) =>
    ["sin", "cos"].map((op) => ({
      op,
      inputs: [hex(x)],
      result: hex(Math[op](x)),
    })),
);
const atan = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [-0, -1],
  [0, 1],
  [-0, 1],
].map(([y, x]) => ({
  op: "atan2",
  inputs: [hex(y), hex(x)],
  result: hex(Math.atan2(y, x)),
}));
console.log(
  JSON.stringify({
    runtime: { node: process.versions.node, v8: process.versions.v8 },
    cases: [...trig, ...atan],
  }),
);
