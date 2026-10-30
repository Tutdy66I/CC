# OFDM record compatibility reader v1

The independent compatibility entry reads complete `ofdm-v13.2` schema 1 records. It keeps the original bytes in a separate local IndexedDB database and revalidates them when opened. The existing OFDM research interface, its strict import, checkpoint recovery, data and fingerprints remain unchanged. This entry does not run or resume research.

Validation checks the original canonical integrity hash, the frozen protocol hash, record structure, contiguous trials, actual statistics and recomputed summary. File SHA-256 identifies the original bytes; neither hash authenticates the origin of a record. Source and runtime identity fields are checked for format, and provenance is explicitly unverified.

The only relaxed comparison is `idealTheoryBer` for QPSK, AWGN, 16 dB, data-Eb, noise enabled and CP sufficient. The only accepted unequal pair is `2.267395844454416e-19` and `2.2673958444544166e-19` in either direction, a one-ULP difference. All other fields and scenarios remain strict. Zero, null, non-finite and unknown values do not gain a general ULP or epsilon allowance. The original value and bytes are never replaced. The UI reports every compatibility comparison.

This deliberately narrow policy does not promise that every valid historical record will be portable across every runtime. Unknown versions, other numerical discrepancies and malformed or tampered records fail closed. If a stored record later fails validation, its bytes remain available for export without presenting it as validated. Exact duplicate bytes are not stored twice; different byte representations are preserved separately.

The locally preserved historical regression sample remains private and is not committed. Synthetic fixtures cover the policy and negative cases in automated tests. Future protocol or compatibility policy extensions require independent versioning, evidence and review.
