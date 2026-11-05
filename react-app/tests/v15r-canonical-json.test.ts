import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseCanonicalJson } from "../src/research-v15r/canonicalJson.js";

const bytes = (text: string) => new TextEncoder().encode(text);

test("canonical restricted JSON accepts sorted objects and arrays", () => {
  assert.deepEqual(parseCanonicalJson(bytes('{"a":[1,-2,true],"b":"abc"}\n')), {
    a: [1, -2, true],
    b: "abc",
  });
});

test("ASCII key order applies even to integer-like property names and nested objects", () => {
  assert.deepEqual(
    parseCanonicalJson(bytes('{"10":1,"2":2,"a":{"10":3,"2":4}}\n')),
    { "2": 2, "10": 1, a: { "2": 4, "10": 3 } },
  );
  assert.throws(() => parseCanonicalJson(bytes('{"2":2,"10":1}\n')));
});

test("canonical JSON rejects duplicate keys, alternate spellings and unsafe values", () => {
  for (const bad of [
    '{"a":1,"a":2}\n',
    '{"a":{"x":1,"x":1}}\n',
    '{"a":[{"z":0,"y":1}]}\n',
    '{"a":[[1,-0]]}\n',
    '{"a":["\\u0061"]}\n',
    '{"a":{"x":null}}\n',
    '{"b":1,"a":2}\n',
    '{ "a":1}\n',
    '{"a":-0}\n',
    '{"a":1.0}\n',
    '{"a":1e0}\n',
    '{"a":null}\n',
    '{"a":"é"}\n',
    '{"a":"\\u0061"}\n',
    '{"a":""}\n',
    '{"a":9007199254740992}\n',
    '{"a":1}',
    '{"a":1}\r\n',
  ])
    assert.throws(() => parseCanonicalJson(bytes(bad)), bad);
  assert.throws(() =>
    parseCanonicalJson(new Uint8Array([0xef, 0xbb, 0xbf, 123, 125, 10])),
  );
  assert.throws(() => parseCanonicalJson(new Uint8Array([0xff])));
});
