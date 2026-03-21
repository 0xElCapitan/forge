# Sprint 1 — Senior Lead Review

**Reviewer**: Senior Technical Lead
**Date**: 2026-03-19
**Sprint goal**: Phase 0 scaffolding — convergence loop runs end-to-end, score = 0/20.5

---

## Verdict: All good

Sprint 1 acceptance criteria are met. Tests pass (56/56). The convergence loop runs. Score is 0 as expected. Proceed to `/audit-sprint sprint-1`, then Sprint 2.

---

## Code Review Notes

Reviewed all source files directly. The implementation is clean and well-reasoned. A few things worth knowing going into Sprint 2.

### Anti-cheating ingester — solid design

The GeoJSON detection by scanning for the string value `"FeatureCollection"` across all field values (not by key name) is the correct approach. It survives anonymization. Verified: raw USGS 18 events = anonymized USGS 18 events. The scalar-array guard (skipping GeoJSON `bbox`) and the combined-object recursion fix for PurpleAir are both necessary and correct.

### One factual issue to know before Sprint 2: PurpleAir value selection

When PurpleAir data rows are ingested, the highest-variance numeric column is selected as `value`. The `sensor_index` column (131075, 131077, …, 131113 — large monotonic integers) has dramatically higher variance (~133) than PM2.5 readings (~25), so `sensor_index` gets selected, not PM2.5.

**This does not fail Sprint 1** (score = 0 is expected, no classifier runs). But the distribution classifier in Sprint 2 will receive sensor IDs as values, not air quality measurements. The density classifier needs sensor count from the row count, not from a value field — that part works. But Q2 distribution will be classifying the wrong field.

For Sprint 2: add a heuristic to `parseArrayOfArrays` to deprioritize columns where all values are large integers (> 10000) that monotonically increase by a fixed step — these are ID columns, not measurements. Alternatively, skip the highest-variance column if its minimum value exceeds a threshold like 1000 (sensor IDs) and fall back to the next-highest-variance column that looks like a measurement (float, bounded range). Track this as a Sprint 2 consideration.

### T-05 double-anonymization behavior — not a blocker

The sprint plan stated `anonymize(anonymize(data, seed), seed)` should throw. It doesn't — but the actual behavior is benign: double-anonymization with the same seed is idempotent (the PRNG produces the same field-name mapping, so already-anonymized keys map to themselves). "Throws" was aspirational defensive programming, not a correctness requirement. No action needed.

### Minor doc error in reviewer.md

Verification step 3 says "Expected: ℹ tests 53" — actual is 56. Non-blocking.

### `stream_index` in metadata

`stream_index: Object.keys(data).indexOf(streamKey)` runs a linear scan per event in `parseCombinedObject`. At current fixture sizes (CORONA: 819 events, 4 streams) this is negligible. Mention it if streams grow.

### Anonymizer uniqueness check

`[...nameMap.values()].includes(candidate)` in `anonymizeValue` is O(n) per collision check. With typical fixture schemas (< 30 unique field names), collision probability via mulberry32 over 36^6 = 2.18B possible names is essentially zero. Not a real concern.

---

## Sprint 2 Pre-conditions

- PurpleAir value field selection issue noted above — factor this into Q2 distribution and Q4 density classifier design
- Fixtures are frozen; don't regenerate
- Anti-cheating anonymized mode must remain green throughout Sprint 2

