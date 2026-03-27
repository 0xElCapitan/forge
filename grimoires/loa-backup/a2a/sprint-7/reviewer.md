# Sprint 7 — Implementation Report

**Sprint**: Sprint 7 — Theatre Templates (global sprint-7)
**Date**: 2026-03-20
**Status**: Awaiting review

---

## Executive Summary

Sprint 7 delivers all six generalized theatre templates. Every template follows the consistent `create → process → expire/resolve` lifecycle from TREMOR/CORONA/BREATH. All functions are pure (return new state, never mutate). Clock is injectable in all `create*` and `expire*`/`resolve*` functions for deterministic testing.

80 new unit tests pass across 21 suites. No regressions: 382 unit + 6 convergence = 388 total, all passing.

---

## Tasks Completed

### T-24: threshold-gate.js

**File**: `src/theatres/threshold-gate.js`

**Exports**: `createThresholdGate`, `processThresholdGate`, `expireThresholdGate`, `resolveThresholdGate`

**Design**:
- `crossingProbability(value, threshold, doubt_price)` handles three threshold types:
  - `null` — bundle.value is already a probability (used by CORONA CME gate where threshold=null)
  - `number` — numeric crossing: `crossed ? (1 - doubt/2) : (doubt/2)`
  - `string` — categorical equality (e.g. 'M1.0' flare class)
- `input_mode='multi'`: averages crossing probabilities across `bundle.sources[]`; falls back to single-source if `sources` absent
- `base_rate` (or 0.5 if null) sets initial `position_probability`
- `expireThresholdGate` is idempotent on already-closed theatres

**Param support**: `threshold`, `window_hours`, `base_rate`, `input_mode`, `threshold_type`, `settlement_source` (all params preserved in state, settlement_source is metadata for upstream trust enforcement)

### T-25: cascade.js + divergence.js

#### cascade.js

**File**: `src/theatres/cascade.js`

**Exports**: `createCascade`, `processCascade`, `expireCascade`, `resolveCascade`

**Prior distributions** (5 buckets: [0, 1–2, 3–5, 6–10, 11+]):
| Model | Distribution |
|-------|-------------|
| `omori` | [0.15, 0.35, 0.30, 0.15, 0.05] — front-loaded (aftershock decay) |
| `wheatland` | [0.25, 0.30, 0.25, 0.15, 0.05] — moderate (ETAS-like) |
| `uniform` | [0.20, 0.20, 0.20, 0.20, 0.20] — flat |
| `null` | falls back to uniform |

**Bayesian update**: on each trigger-crossing event, computes Poisson PMF with rate `λ = ((count + 1) / (elapsed_hours + 1)) × window_hours`, blends 70% Poisson + 30% prior. Distribution normalised after blend.

`poissonPmf(lambda, k)` — log-space computation to avoid underflow. Bucket 4 (11+) is the residual: `max(0, 1 - sum(buckets 0–3))`.

`resolveCascade(theatre, final_count)` assigns outcome bucket and sets `position_distribution[bucket] = 1`.

#### divergence.js

**File**: `src/theatres/divergence.js`

**Exports**: `createDivergence`, `processDivergence`, `expireDivergence`, `resolveDivergence`

**Bundle routing**: `bundle.source_id === source_b_type` → source B; otherwise → source A. No source_id → treated as source A (safe default).

**Probability**: computed only when both sources have readings.
- `divergence_threshold` set: crossing probability using same `(1 - doubt/2) : (doubt/2)` model
- `divergence_threshold = null`: normalised relative difference `min(1, |a - b| / max(|a|, |b|, 1))`

**Self-resolving**: when `resolution_mode === 'self-resolving'` and both sources seen and `P < 0.1`, `processDivergence` auto-calls `resolveDivergence` with `outcome=false`, `settlement_class='self-resolving'`.

### T-26: regime-shift.js + persistence.js + anomaly.js

#### regime-shift.js

**File**: `src/theatres/regime-shift.js`

**Exports**: `createRegimeShift`, `processRegimeShift`, `expireRegimeShift`, `resolveRegimeShift`

**Binary**: P(state A) = P(value < state_boundary). When `state_boundary=null` (TREMOR spec — both regime_shift params are null), probability is locked at `zone_prior` (or 0.5). History is still appended.

`zone_prior` is the initial prior and the fallback when boundary is null. This is correct for TREMOR's DepthRegime where the scorer skips null params — the theatre can still be created and tracked, it just can't compute a meaningful crossing probability.

#### persistence.js

**File**: `src/theatres/persistence.js`

**Exports**: `createPersistence`, `processPersistence`, `expirePersistence`, `resolvePersistence`

**Streak logic**: `value >= condition_threshold` → increment; else reset to 0. `position_probability = min(1, streak / consecutive_count)`.

**Auto-resolve**: when streak reaches `consecutive_count`, `processPersistence` calls `resolvePersistence` internally with `outcome=true`, `settlement_class='auto'`. Timestamp is the bundle timestamp.

`expirePersistence` sets `outcome=false` (streak not completed).

#### anomaly.js

**File**: `src/theatres/anomaly.js`

**Exports**: `createAnomaly`, `processAnomaly`, `expireAnomaly`, `resolveAnomaly`

**Baseline**: rolling window, max 200 values. Mean and population std (Bessel correction: `n-1`).

**Z-score**: `(value - mean) / std`. Compared to `sigma_threshold` (defaults to 2.0 when null).

**Uninformed prior**: with fewer than 3 observations, std is unreliable — `position_probability` stays at 0.5. Activates after 3+ values.

`position_history` entries include `zscore` alongside `timestamp` and `probability` for downstream diagnostics.

---

## Technical Highlights

### Consistent Theatre state shape

All binary theatres share: `{ template, params, status, created_at, expires_at, position_probability, position_history, resolution }`. Cascade uses `position_distribution` in place of `position_probability`, and adds `observed_count`.

### Immutability

All functions use object spread (`{ ...theatre }`) and array spread (`[...arr]`) — no in-place mutation. The `params` object is not deep-copied (assumed read-only by callers). The `position_history` array grows without cap (persistence responsibility is upstream; bounding it is a Sprint 8+ concern).

### Injectable clock

All `create*`, `expire*`, and `resolve*` functions accept `{ now = Date.now() }` as an optional second argument. Tests use a fixed `NOW = 1_000_000_000_000` ms clock. `process*` functions use `bundle.timestamp ?? Date.now()`.

### Null-safe handling

`state_boundary=null` in regime-shift (TREMOR spec) — probability stays at prior, no computation attempted. `sigma_threshold=null` in anomaly — defaults to 2.0. `divergence_threshold=null` in divergence — uses normalised relative difference.

### No external dependencies

All six files use only built-in JS. Zero imports.

---

## Testing Summary

**File**: `test/unit/theatres.spec.js` — 80 tests, 21 suites

```
node --test test/unit/theatres.spec.js
# ℹ tests 80 | ℹ pass 80 | ℹ fail 0
```

| Template | Suites | Tests | Key scenarios |
|----------|--------|-------|---------------|
| threshold-gate | 5 | 26 | numeric/null/string threshold, single/multi input, doubt adjustment, idempotent expire |
| cascade | 3 | 14 | all prior models, Poisson update, bucket assignment, sub-threshold no-op |
| divergence | 4 | 12 | routing by source_id, both-seen requirement, self-resolving auto-close |
| regime-shift | 3 | 9 | null boundary, above/below boundary, doubt adjustment |
| persistence | 3 | 10 | streak increment/reset, auto-resolve, idempotent closed-theatre |
| anomaly | 3 | 9 | uninformed prior (<3 obs), outlier detection, null sigma_threshold |

**Full suite** (no regressions):
```
node --test test/unit/*.spec.js
# ℹ tests 382 | ℹ pass 382 | ℹ fail 0

node --test test/convergence/*.spec.js
# ℹ tests 6 | ℹ pass 6 | ℹ fail 0
```

Grand total: **388 tests, 0 failures**.

---

## Known Limitations

1. **`position_history` is unbounded**: Arrays grow without cap. For long-running theatres processing many events, this is a memory concern. Addressed in Sprint 8 when processor pipeline is implemented.

2. **Cascade blending weight is fixed**: The 70% Poisson / 30% prior blend is hardcoded. A well-tuned implementation might adjust the weight as confidence grows. Acceptable for Phase 3.

3. **Divergence null-threshold uses a heuristic**: `min(1, |a - b| / max(|a|, |b|, 1))` is a reasonable normalised difference but not derived from any statistical model. Sufficient for TREMOR OracleDivergence and BREATH SensorDivergence where the divergence_threshold param is also null in the spec.

4. **Anomaly requires ≥3 observations**: For feeds with very low event rates, the theatre stays uninformed for longer. This matches the TREMOR SwarmWatch pattern where b-value computation requires at least a few events.

---

## Verification Steps

```bash
# Theatre unit tests
node --test test/unit/theatres.spec.js
# Expected: 80 tests, 0 fail

# Full unit suite (no regressions)
node --test test/unit/*.spec.js
# Expected: 382 tests, 0 fail

# Convergence suite (no regressions)
node --test test/convergence/*.spec.js
# Expected: 6 tests, 0 fail
```

---

## File Changes

| File | Change | Delta |
|------|--------|-------|
| `src/theatres/threshold-gate.js` | New | +145 lines |
| `src/theatres/cascade.js` | New | +195 lines |
| `src/theatres/divergence.js` | New | +165 lines |
| `src/theatres/regime-shift.js` | New | +130 lines |
| `src/theatres/persistence.js` | New | +125 lines |
| `src/theatres/anomaly.js` | New | +145 lines |
| `test/unit/theatres.spec.js` | New | +430 lines |
