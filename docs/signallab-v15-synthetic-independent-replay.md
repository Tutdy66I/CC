# Independent replay of fixed synthetic evidence

This candidate preserves a public fixed synthetic ZIP, its original manifest and its separately supplied digest anchor, as bytes in a 14-day CI artifact. The producer is the merged PR #32 fixture. The independent verifier uses only Python standard-library code and does not import the producer or its verifier. No research records or confirmation roots are used.

To verify downloaded objects in an otherwise empty temporary directory, run:

```text
python3 -I -B v15-synthetic-independent-verify.py synthetic.zip synthetic.manifest.json synthetic.anchor.json --anchor-sha256 70e0a3aa17a7cfa38a1ecbfa4490b237b4bd1a5ba31e0603a0f8aebcf5d60777
```

The verifier reads inputs only and checks the independently supplied expected anchor digest, anchor references to the exact ZIP and manifest bytes, the manifest inside the ZIP, exact names and order, duplicate entries, unsafe paths and links, sizes, per-file hashes, synthetic marker, expected fixed input, audit result and uncertainty status. This is a bounded fixed-vector check, not a general archive verifier or a complete restore system.

The expected anchor digest must be obtained through a separately trusted channel for a meaningful identity comparison. A party who replaces the entire ZIP and anchor **and** supplies a new expected digest can produce a consistent replacement; the negative tests intentionally demonstrate both rejection against the original digest and acceptance when the replacement digest is trusted. The result explicitly reports `originAuthenticated: false`. No signature, trusted publisher, independent anchor custody, offsite backup, race-safe filesystem, long-term storage or cross-machine recovery is established. CI artifacts are temporary and expire after 14 days; they are not independent long-term backups. None of `04-numeric`, `05-evidence` or `06-dependencies` is frozen.

The artifact additionally contains raw verifier/test stdout, stderr and exit codes, runtime executable identities, source SHA-256 values and a SHA-256 file manifest. CI reports for two runs can differ in test-duration stderr, workflow timestamps and artifact ZIP packaging; the three synthetic objects must match byte-for-byte. Artifact manifests cover the raw output, including those differences, rather than excluding or changing it.
