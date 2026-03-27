# Sprint 7 — Senior Lead Review

**Sprint**: Sprint 7 — Theatre Templates (global sprint-7)
**Date**: 2026-03-20
**Reviewer**: Senior Technical Lead
**Verdict**: All good

---

## Review Summary

All six theatre templates implemented correctly. Pure functions, injectable clock, null-safe handling throughout, consistent create/process/expire/resolve API across all templates. 80 tests cover all lifecycle phases and edge cases.

---

## T-24: threshold-gate.js ✅

`crossingProbability` (line 37): correctly handles three threshold types:
- `null` → direct probability passthrough (clamped to [0,1])
- `number` → step function with doubt discount
- `string` → categorical equality with doubt discount

Multi-input mode (line 111): averages crossing probabilities across `bundle.sources[]`, falls back to single-source if absent. Fallback is safe — no panic, no silent wrong answer.

`expireThresholdGate` (line 139): idempotent. `resolveThresholdGate` (line 157): idempotent. Both guarded by `status !== 'open'`.

Note on string threshold: `String(value) === String(threshold)` uses equality, not ordering. This is correct for a generalized template — categorical ordering (e.g., flare class hierarchy M1.0 < M5.0 < X1.0) is domain-specific and belongs in a future per-domain adapter, not in the generalized template itself.

---

## T-25: cascade.js ✅

`poissonPmf` (line 56): log-space to avoid underflow for large k. Handles `lambda=0` as a special case (`k===0 → 1, else → 0`). Clean.

Bucket 4 (line 80): computed as residual `max(0, 1 - sum(b0..b3))`. Floating-point safe — no accumulated error escapes.

Blend at `processCascade:133`: 70% Poisson posterior + 30% prior, then normalise. Normalisation prevents any accumulated float drift from affecting downstream computation.

Prior model dispatch (line 116): unrecognised models (including null) fall back to uniform. Defensive and correct.

---

## T-25: divergence.js ✅

Routing logic (line 87): `bundle.source_id === source_b_type` evaluates false when `source_id` is absent (undefined !== string). Routes to source A as documented. Safe.

Self-resolving path (line 106): `processDivergence` calls `resolveDivergence(updated, false, 'self-resolving', { now: ts })` after building `updated`. At that point `updated.status` is still `'open'` (we haven't closed it yet) so `resolveDivergence`'s guard passes correctly. The `now: ts` uses the bundle timestamp — consistent with the rest of the position history. Good.

Null divergence_threshold (line 55): normalised relative difference `min(1, |a - b| / max(|a|, |b|, 1))`. The `max(..., 1)` in the denominator prevents division by zero when both sources report 0. Correct.

---

## T-26: regime-shift.js ✅

Null state_boundary path (line 79): appends to `position_history` but leaves `position_probability` unchanged at zone_prior. This is exactly right for the TREMOR regime_shift spec where both core params are null — the theatre is instantiated and tracked, it just can't compute a crossing probability. The scorer already knows this and gives 0.5 templateScore for type match only.

---

## T-26: persistence.js ✅

Auto-resolve (line 100): calls `resolvePersistence(updated, true, 'auto', { now: ts })` where `updated` is the already-incremented state with `status: 'open'`. The guard in `resolvePersistence` passes. `resolution.consecutive_seen` captures the final streak value from `updated`. Correct.

`expirePersistence` sets `outcome: false` — the streak was not completed. Semantically correct.

---

## T-26: anomaly.js ✅

`computeStats` (line 29): Bessel correction (`n-1` denominator). Single-value case returns `std=0` rather than NaN. Correct.

Uninformed prior guard (line 116): `baseline_values.length >= 3 && std > 0` — dual condition prevents both insufficient data and the degenerate std=0 case (all values identical). `position_probability` stays at 0.5 (uninformed) rather than returning a misleading number.

`sigma_threshold ?? 2.0` (line 113): null default applied correctly.

Baseline window cap at 200 (line 27): prevents unbounded growth. The `shift()` call removes the oldest value when at capacity.

---

## Testing

80 tests, 21 suites. Coverage includes:
- All prior models (omori/wheatland/uniform/null) verified on create
- Poisson distribution shift verified on multiple trigger events
- Self-resolving auto-close tested with exact-match sources (diff=0)
- Persistence streak break tested explicitly (one miss resets to 0)
- Anomaly uninformed prior guard tested with 1 and 2 observations
- Closed-theatre idempotency tested for all templates

No gaps found.

---

## Architecture

All 6 files in `src/theatres/` as specified in SDD file tree and FORGE_PROGRAM build list. No external dependencies. ES module exports. Injectable clock for determinism.

388 total tests (382 unit + 6 convergence), zero failures. No convergence regressions.
