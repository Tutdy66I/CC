import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ofdmDecode } from "../src/lib/ofdmModulation.js";
import { equalizeOfdm, fullTrainingLs } from "../src/lib/ofdmEqualizer.js";
import {
  estimateCfo,
  estimateTiming,
} from "../src/lib/ofdmSync/synchronizer.js";

test("public boundary inputs exercise production QPSK, ZF and LS failure paths", () => {
  for (const zero of [0, -0])
    assert.deepEqual(ofdmDecode(zero, zero, "QPSK"), [0, 0]);
  assert.deepEqual(
    ofdmDecode(-Number.MIN_VALUE, Number.MIN_VALUE, "QPSK"),
    [1, 0],
  );
  assert.throws(() => ofdmDecode(Infinity, 0, "QPSK"));
  assert.equal(equalizeOfdm([1, 0], [0, -0], 0, 2, "zf").failure, "zero-csi");
  assert.equal(
    equalizeOfdm([1, 0], [Number.MIN_VALUE, 0], 0, 2, "zf").failure,
    "nonfinite-coordinate",
  );
  assert.throws(() => fullTrainingLs([1, 0], [0, 0]));
});

test("public observations exercise production low-energy and earliest timing tie", () => {
  const emptyPower = new Float64Array([0, 0, 0, 0]);
  assert.equal(estimateCfo(emptyPower, 128, 0, 1, 1).status, "failed");
  const result = estimateTiming(
    new Float64Array([1, 0, 1, 0]),
    new Float64Array([1, 0]),
    0,
    1,
    0,
  );
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.peak, 0);
    assert.equal(result.score, 1);
  }
});
