# Sprint 3 — Senior Lead Review

**Reviewer**: Senior Technical Lead
**Date**: 2026-03-20
**Sprint goal**: Q3 Noise + Q4 Density classifiers; GrammarScore from 1.0 → 2.0 per spec (×3 specs)

---

## Verdict: All good — proceed to audit

All acceptance criteria met. 179 unit tests pass, 0 fail. All 6 convergence iterations pass with `noise=match` and `density=match` for all 3 specs in both raw and anonymized modes. GrammarScore = 2.0 per spec as required. No regressions from Sprint 2.

Two minor documentation–code discrepancies are noted below. They are latent (no current spec exercises the affected paths) but must be resolved before Sprint 5 selector rules are written. No blocking changes required for Sprint 4.

---

## Code Review

### MAD=0 fix — correct, constant-baseline case safe

`src/classifier/noise.js:91-94`

The fix is correct. When `rollingMAD === 0` and `rollingMedian > 0`, `effectiveMAD = rollingMedian * 0.1` is used as a floor. Scrutinized the one edge case the reviewer.md highlights: a truly constant signal.

- All values constant at e.g. 100: every value in the window equals the median. Deviation is 0. `0 > 2 × 10` is false. No false positive.
- Constant baseline at 0: `effectiveMAD = 0 * 0.1 = 0`. The guard `effectiveMAD > 0` is false. No spike flagged. Correct.
- Constant baseline at 100, value at 121: deviation = 21, threshold = 2 × 10 = 20. Flagged as spike. This is the intended behavior — 21% above a constant baseline is a real spike.

The fix does not introduce false positives on constant data. Correct.

### Q3 independence from cadence output — confirmed

Sprint 2 pre-condition was: Q3 should not depend on correct cadence output. Confirmed. `classifyNoise` in `src/classifier/noise.js` reads only `e.value`, `e.timestamp`, and `e.metadata.stream_index`. No reference to cadence classification anywhere in the call path. The secondary cadence heuristic misfire risk (single-stream periodic feeds with large gaps) is fully isolated from Q3.

### Density anonymized-mode path — correct

`src/classifier/density.js:102-109` (`detectMultiTier`)

Dual-signal design is sound. For BREATH anonymized: PurpleAir stream 0 has `col_count: 9` (set by ingester's `parseArrayOfArrays`, positional metadata, not a field name). `hasSensorGridStream` returns true → `multi_tier` confirmed. The anonymized fixture tests in `density.spec.js:386-396` validate this path with the real fixture. CORONA anonymized correctly falls through to `single_point` because it has no `sensor_count` and its array_row stream (Kp) has `col_count: 4 < 6`.

### Anti-cheating boundary — clean

All classifier logic uses only fields from the ingester boundary. Verified `noise.js` and `density.js` in full: `timestamp`, `value`, `metadata.stream_index`, `metadata.shape`, `metadata.col_count`, `metadata.sensor_count`, `metadata.has_coords`. No source field names in logic. JSDoc `@param` references to field names are documentation only — confirmed.

### Documentation–code discrepancies (latent, must fix before Sprint 5)

Two thresholds in the reviewer.md table do not match the code. Neither path is exercised by any of the 3 backing specs (CORONA/BREATH are multi-stream → `mixed` before reaching these branches; TREMOR is `spike_driven`). They are dormant for Sprint 4. However, Sprint 5 selector rules will be authored against the spec — if they are written from the reviewer.md table instead of the actual code, rules keying off `trending` or `cyclical` will be calibrated to the wrong thresholds.

**Issue 1: trending t-stat threshold**

- `src/classifier/noise.js:318`: `Math.abs(tStat) > 3.0`
- `grimoires/loa/a2a/sprint-3/reviewer.md:41` (table): `|trend t-stat| > 2.0`

Code threshold is 3.0; documentation says 2.0. The unit test at `noise.spec.js:130` asserts `t > 3.0` for the helper, which is consistent with the code but does not test the classification boundary. A data series with `|tStat|` between 2.0 and 3.0 would be documented as `trending` but classified as `white_noise` by the code.

Fix required before Sprint 5: update reviewer.md table to `|trend t-stat| > 3.0`, OR change code to `> 2.0` and update the unit test assertion. Given neither value has theoretical grounding from the sprint plan (which only says "large |t-statistic|"), use 3.0 (the code value) as the canonical value — it is the safer boundary against false `trending` classifications.

**Issue 2: cyclical lag-1 threshold**

- `src/classifier/noise.js:324`: `lag1 > 0.7`
- `grimoires/loa/a2a/sprint-3/reviewer.md:41` (table): `Autocorrelation > 0.8`

Code threshold is 0.7; documentation says 0.8. Same consequence: selector rules written from the table would miss feeds with lag-1 in [0.7, 0.8).

Fix required before Sprint 5: update reviewer.md table to `Autocorrelation > 0.7`.

**Action**: Update reviewer.md table (documentation-only change, no code or test impact) before Sprint 5 begins. Not a Sprint 4 blocker.

### Test coverage — solid

62 noise tests, 45 density tests. All classification paths covered with synthetic data. Edge cases covered: empty array, single event, all-constant values, all-NaN values. Real fixture tests for all 3 specs in both modes. The soft assertions in white_noise classification (`white_noise || spike_driven`) are appropriate — the test documents an ambiguous boundary honestly.

One minor observation: `noise.spec.js:279` assigns the timestamp-sorted event array to a variable named `sorted` — this is the events array sorted by timestamp, not a sorted values array. This causes momentary confusion when reading alongside `rawValues` sorting later in the function. Not a bug. Not worth a code change at this stage.

### CORONA `single_point` path — verified correct by design

As noted in reviewer.md, CORONA has 4+ stream indices but no `sensor_count` and no `col_count >= 6` stream. `detectMultiTier` returns false. No GeoJSON features, no `has_coords`. Falls through to `single_point`. This is semantically correct: CORONA represents satellite instruments, not a distributed ground network. Confirmed against `density.spec.js:344-351`.

---

## Sprint 4 Pre-conditions

- The two documentation–code threshold discrepancies (trending: 3.0 vs 2.0; cyclical: 0.7 vs 0.8) must be reconciled in reviewer.md before Sprint 5 selector rules are authored. Sprint 4 (Q5 Thresholds) does not consume Q3 output, so no Sprint 4 blocker.
- `computeHaversineDistance` is exported and unit-tested but unused in classification logic. That's fine — the reviewer.md correctly documents this as a future-sprint hook. No action needed.
- The 200-event sparse/dense threshold in `density.js:167` is arbitrary and undocumented in the sprint plan. Current specs are all well below 200 (TREMOR: 18 events). If Sprint 4+ brings a new fixture with event counts near that boundary, revisit. Not a current issue.
- No regressions. All 72 Sprint 1+2 tests continue to pass alongside the 107 Sprint 3 tests.
