import { parseCanonicalJson } from "./canonicalJson.js";

const names = [
  "01-model.json",
  "02-random.json",
  "03-statistics.json",
  "04-numeric.json",
  "05-evidence.json",
  "06-dependencies.json",
] as const;
type Name = (typeof names)[number];
const keys = [
  "active_bins,cp,data_symbols,fft_size,frame_bits,mapping,preamble_sha256,scenarios,schema,training_sha256,version",
  "domain_codes,experiment_id_bytes,kdf,message_encoding,roles,schema,state_mapping,version",
  "alpha,comparisons,endpoints,n_per_scenario,range,schema,stopping,version",
  "decision,float,nonfinite,operations,runtime,schema,tolerances,version",
  "audit,checkpoints,failures,frame_bits,hash,records,recovery,schema,version",
  "files,runtimes,schema,version",
];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const requireValue = (condition: boolean) => {
  if (!condition) throw new Error("Invalid known candidate field");
};
const scenario = (cfo: string, sto: string) =>
  `534c3135534330320080040010${cfo}${sto}00000000000000003f847ae147ae147b0300003fec9f25c5bfedd9000000000000000000033fd8c97ef43f7248000000000000000000073fcc9f25c5bfedd900000000000000003fb999999999999a0002`;

/** Validates only settled structural fields. A result is never protocol approval. */
export function inspectCandidateJson(
  name: Name,
  bytes: Uint8Array,
): { validKnownFields: true; frozen: false } {
  const index = names.indexOf(name);
  if (index < 0) throw new Error("Invalid candidate file");
  const value: unknown = parseCanonicalJson(bytes);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new Error("Invalid candidate object");
  const x = value as Record<string, unknown>;
  requireValue(Object.keys(x).join(",") === keys[index]);
  const schemas = [
    "sl15-model-03",
    "sl15-random-03",
    "sl15-statistics-03",
    "sl15-numeric-03",
    "sl15-evidence-03",
    "sl15-dependencies-03",
  ];
  requireValue(x.schema === schemas[index] && x.version === 3);
  if (index === 0) {
    const bins = [
      ...Array.from({ length: 48 }, (_, i) => i - 48),
      ...Array.from({ length: 48 }, (_, i) => i + 1),
    ];
    const z = "0000000000000000",
      c = "3fc999999999999a";
    requireValue(
      eq(x.active_bins, bins) &&
        x.cp === 16 &&
        x.data_symbols === 4 &&
        x.fft_size === 128 &&
        x.frame_bits === 768 &&
        x.mapping === "qpsk-pm1-v1" &&
        x.preamble_sha256 ===
          "05f462881587382993e5eb5241992665a78e753b98d10cf0922e780848183a99" &&
        x.training_sha256 ===
          "c26af8b3562d32329721c8cf6d19df6e6f1148b65153a98eea9403a432ddc24a" &&
        eq(x.scenarios, [
          scenario(z, "0000"),
          scenario(c, "0000"),
          scenario(z, "0004"),
          scenario(c, "0004"),
        ]),
    );
  } else if (index === 1) {
    requireValue(
      eq(x.domain_codes, [
        "diagnostic:01",
        "exploratory:02",
        "preflight:03",
        "confirmatory:04",
        "test:7f",
      ]) &&
        x.experiment_id_bytes === 16 &&
        x.kdf === "hmac-sha256-sl15key3" &&
        x.message_encoding === "sl15rng2-90byte-be" &&
        eq(x.roles, ["01:payload", "02:noise"]) &&
        x.state_mapping === "direct-hmac-v1",
    );
  } else if (index === 2) {
    const comparisons = ["S00", "S10", "S01", "S11"].flatMap((s) => [
      `${s}:G:POS`,
      `${s}:R:NEG`,
      `${s}:I:NONZERO`,
    ]);
    requireValue(
      x.alpha === "1/20" &&
        eq(x.comparisons, comparisons) &&
        x.endpoints === "partial-24-two-sided-hoeffding-bonferroni" &&
        x.n_per_scenario === 34335 &&
        eq(x.range, [-1, 1, -2, 2]) &&
        x.stopping === "fixed-n-no-optional",
    );
  } else {
    // No schema decision has been approved for numerical proof, evidence bytes, or closure.
    throw new Error(
      "Unresolved candidate fields: numeric, evidence and dependency closure require review",
    );
  }
  return { validKnownFields: true, frozen: false };
}
