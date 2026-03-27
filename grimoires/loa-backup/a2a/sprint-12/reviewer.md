# Sprint 12 — Implementation Report

**Sprint**: sprint-12 (global 12)
**Label**: Composer: proposeComposedTheatre
**Status**: Ready for review
**Implemented**: 2026-03-20

---

## Summary

Sprint 12 completes the `src/composer/compose.js` module with `proposeComposedTheatre` — the three-rule composition engine that proposes Theatre templates from two classified feeds. The canonical test case passes: PurpleAir AQI + wind direction → smoke plume arrival `threshold_gate`. 25 new tests, 0 failures.

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `src/composer/compose.js` | Modified | Added `proposeComposedTheatre` (T-36) + updated module docstring |
| `test/unit/composer.spec.js` | Created | 25 tests, 7 suites (T-37) |
| `src/index.js` | Modified | Added `proposeComposedTheatre` to Composer exports (T-38) |
| `BUTTERFREEZONE.md` | Modified | Added capability entry + `interfaces.core` entry + API table row (T-38) |

---

## T-36: proposeComposedTheatre (`src/composer/compose.js:118`)

### Three composition rules

**Rule 1: `threshold_with_arrival_predictor`** (confidence 0.78)

The canonical smoke plume rule. Conditions:
- `feedA.distribution.type === 'bounded_numeric'` — bounded metric with a ceiling
- `feedA.thresholds.type === 'regulatory'` — EPA/NOAA-class regulatory breakpoints
- `feedB.cadence.classification === 'seconds' || 'minutes'` — continuous directional feed
- `feedB.distribution.type === 'bounded_numeric'`
- `causalOrder.leader === 'B'` — directional feed precedes the outcome
- `causalOrder.lag_ms > 0`

Returns `threshold_gate` with:
- `arrival_window_ms = lag_ms` (raw lag preserved for downstream use)
- `window_hours = Math.ceil(lag_ms / 3_600_000)` (rounds up)
- `input_mode: 'multi'` (always multi for two-feed compositions)
- `threshold_type: 'regulatory'`
- `settlement_source: null` — caller must supply T0/T1 source; FORGE never presumes

**Rule 2: `co_bounded_divergence`** (confidence 0.65)

Two bounded feeds at concurrent cadence with sufficient temporal overlap. Conditions:
- Both `distribution.type === 'bounded_numeric'`
- `leader === 'concurrent'`
- `alignedPairs.length >= 5`

Returns `divergence` with `resolution_mode: 'expiry'`.

**Rule 3: `cascade_amplifier`** (confidence 0.60)

Spike-driven event feed paired with a bounded precursor that leads it. Conditions:
- `feedA.noise.classification === 'spike_driven'`
- `feedB.distribution.type === 'bounded_numeric'`
- `leader === 'B'`, `lag_ms > 0`

Returns `cascade` with `window_hours = Math.ceil(lag_ms / 3_600_000) * 2` — twice the lag ceiling to give the market room to resolve.

### Return shape

Compatible with `Proposal` from `src/selector/template-selector.js` plus `composition_basis` field:
```js
{
  template: 'threshold_gate',
  params: { threshold, window_hours, arrival_window_ms, base_rate, input_mode, threshold_type, settlement_source },
  confidence: 0.78,
  composition_basis: { feed_a_role, feed_b_role, causal_leader, lag_ms, rule_fired },
}
```

### Guard clauses

Throws `TypeError` when:
- `feedProfileA` / `feedProfileB` is not an object
- Either profile is missing `distribution`, `cadence`, `noise`, or `thresholds` fields
- `alignedPairs` is not an array
- `causalOrder` is missing `leader` (string) or `lag_ms` (number)

Function is pure: no side effects, no date/random, deterministic output.

---

## T-37: Tests (`test/unit/composer.spec.js`)

### Results

```
ℹ tests 25
ℹ suites 7
ℹ pass 25
ℹ fail 0
```

### Test coverage

| Suite | Tests | What it covers |
|-------|-------|----------------|
| Rule 1: threshold_with_arrival_predictor | 5 | Happy path, window_hours ceil, empty pairs, wrong leader, wrong thresholds type |
| Rule 2: co_bounded_divergence | 3 | Happy path, pairs < 5 blocks, leader ≠ concurrent |
| Rule 3: cascade_amplifier | 4 | Happy path, window_hours doubling, non-spike feedA, wrong leader |
| Null return | 2 | seismic+seismic concurrent, seismic+wind leader=A |
| Guard clauses | 7 | null feedA, undefined feedB, missing fields, non-array pairs, missing leader, string lag_ms |
| Determinism | 3 | Rule 1 same→same, Rule 3 same→same, null deterministic |
| Integration: canonical smoke plume | 1 | PurpleAir AQI + wind → smoke plume arrival threshold_gate |

### Full unit suite regression check

```
Before sprint-12: 503 tests, 140 suites
After sprint-12:  528 tests, 147 suites
Delta:            +25 tests, +7 suites, 0 failures
```

---

## T-38: Export + BUTTERFREEZONE.md patch

`src/index.js` Composer export line:
```js
export { alignFeeds, detectCausalOrdering, proposeComposedTheatre } from './composer/compose.js';
```
Verified: `import('./src/index.js').then(m => typeof m.proposeComposedTheatre)` → `'function'`.

`BUTTERFREEZONE.md` updated:
- Key Capabilities: added `proposeComposedTheatre` entry with `file:line` (`src/composer/compose.js:118`)
- AGENT-CONTEXT `interfaces.core`: added `proposeComposedTheatre # src/composer/compose.js:118`
- Construct API table: added row
- `ground-truth-meta` capabilities count: updated `17-entries` → `18-entries`

---

## Acceptance Criteria Check

| Criterion | Status |
|-----------|--------|
| Rule 1 fires: AQI + wind, leader=B, lag_ms=3600000 → threshold_gate with arrival_window_ms=3600000 | ✓ |
| Rule 2 fires: two bounded + concurrent + ≥5 pairs → divergence | ✓ |
| seismic + AQI, leader=A → null (no rule fires) | ✓ |
| Empty pairs + rule-1-valid inputs → rule 1 fires (pair count not required) | ✓ |
| TypeError on missing feedProfileA fields | ✓ |
| TypeError on missing causalOrder.leader | ✓ |
| Function is pure / deterministic | ✓ |
| +8 tests minimum (actual: +25) | ✓ |
| `proposeComposedTheatre` exported from src/index.js | ✓ |
| BUTTERFREEZONE.md interfaces.core updated with file:line | ✓ |
