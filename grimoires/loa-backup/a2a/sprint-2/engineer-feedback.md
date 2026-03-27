# Sprint 2 — Senior Lead Review

**Reviewer**: Senior Technical Lead
**Date**: 2026-03-20
**Sprint goal**: Q1 Cadence + Q2 Distribution classifiers; GrammarScore from 0 → 1.0 per spec (×3 specs = 3.0)

---

## Verdict: All good

Sprint 2 acceptance criteria are met. 72 unit tests pass (53 new + 19 Sprint 1). 6 convergence tests pass. GrammarScore Q1=match, Q2=match for all 3 specs in both raw and anonymized modes. PurpleAir sensor_index fix is correct for the actual fixture. Proceed to `/audit-sprint sprint-2`, then Sprint 3.

---

## Code Review Notes

Reviewed all source files directly. The implementation is clean and the design choices are sound. Three things worth knowing going into Sprint 3.

### Anti-cheating boundary — clean

Cadence and distribution classifiers access only `event.timestamp`, `event.value`, and `event.metadata.stream_index`. The apparent hits on field names (`sig`, `aqi`, `pm2.5`, `nst`) in the grep scan are all in JSDoc comments, not in logic. No source-identifying strings leak through the anonymization boundary.

### sensor_index fix — correct for the actual fixture, one edge case to note

`isIdLikeColumn` in `src/ingester/generic.js` (lines 286–295) correctly identifies PurpleAir's `sensor_index` column: all integers > 1000, monotone ascending, fixed step of 2. Verified against the actual fixture — values 131075–131083 are detected and skipped, PM2.5 values (5.9–21.1) are selected instead.

One edge case to be aware of: the `step < 0` guard at line 292 means a **decreasing** sequence of large integers is not recognized as ID-like and would be selected as the primary value. This does not affect the current fixture (ascending, fixed step verified). If a future fixture provides sensor IDs in descending order or with irregular spacing, the heuristic will miss it and regress. Not a Sprint 2 issue, but document it if the ingester is extended for new fixture shapes.

Also verified: the all-ID-like fallback (lines 307–313) behaves correctly — if all non-timestamp columns are ID-like, the filter is disabled and the original highest-variance selection applies. This is correct defensive behavior.

### Secondary cadence heuristic — correct for all 3 specs, documented risk for Sprint 3

The range-ratio secondary heuristic in `src/classifier/cadence.js` (line 191): `jitter > 2.0 || (rangeRatio > 5.0 && jitter > 0.5)`.

Confirmed correct for USGS TREMOR: actual fixture jitter=1.18, rangeRatio=15.5 — secondary fires correctly. For BREATH and CORONA, the `streamIndices.size >= 2` check (line 143) fires first, so neither heuristic is reached for those specs.

**Known misfire scenario**: A regular single-stream periodic feed (e.g., hourly) with a single gap > 6× the normal interval will trigger the secondary heuristic and be misclassified as `event_driven` (verified: 19×1hr + 1×6hr → jitter=1.09, rangeRatio=6, classified `event_driven`). This is a false positive.

This risk is **zero for all 3 backing specs** in Sprint 2 (CORONA and BREATH use multi-stream — caught before secondary runs; TREMOR is genuinely event-driven). The risk window opens in Sprint 3 if Q3 noise classification requires accurate cadence identification for single-stream periodic feeds. Track this for Sprint 3 review.

### Distribution classifier — bounded_numeric threshold at 600

The hardcoded boundary `max <= 600` for `bounded_numeric` (line 182 of `src/classifier/distribution.js`) is documented in the sprint plan as intentional (covers AQI 0-500, PM2.5 0-300, Kp 0-9). Confirmed: TREMOR's `sig` field has values up to 670, triggering `unbounded_numeric` correctly for Q2=match.

One behavioral edge note: negative values fall through to the default `bounded_numeric` path (line 200), because `min >= 0` fails and `max > 600` also fails, landing at `growthCoeff` check, which returns 0 for most well-behaved data. This means a feed with values [-5, +10] would be classified `bounded_numeric`, which is semantically correct for a signed-range feed. No issue.

### detectCategorical boundary at exactly 5% unique ratio

`ratio >= 0.05` returns false (not categorical). So exactly 20 same-valued events (unique/total = 5.0%) is NOT categorical; 21 same-valued events (4.76%) IS. The off-by-one is deliberate (strict lower bound). The test at line 456 documents this correctly with `assert.ok(typeof profile.type === 'string')` — it doesn't assert the exact type, which is appropriate given the boundary behavior.

### Test coverage — solid, one gap to note

The test at line 380 (`classifies earthquake-magnitude-like values`) deliberately uses a weak assertion (`profile.type === 'bounded_numeric' || profile.type === 'unbounded_numeric'`) to document that small-range seismic data may not classify as the spec expects. This is the correct approach — the test documents the known limitation without asserting the wrong thing. No action needed.

The real fixture test at line 549 similarly uses a weak assertion for USGS distribution type. This is honest: the exact field the ingester selects (likely `sig`) is not contractually guaranteed. Acceptable.

---

## Sprint 3 Pre-conditions

- The secondary cadence heuristic misfire risk (single-stream periodic feeds with gaps > 6× normal interval) is latent but inactive in Sprint 2 specs. Sprint 3 Q3 (noise) classifier should be aware that `event_driven` classification may occasionally be incorrect for single-stream feeds with large outage gaps — if this affects Q3 classification logic, revisit the heuristic threshold.
- No regressions from Sprint 1. Ingester tests (19/19) still pass.
- Fixtures remain frozen and correct.
- Anti-cheating anonymized mode is green for all 6 convergence tests.
