# Sprint 8 — Senior Lead Review

**Sprint**: Sprint 8 — Processor Pipeline + Trust Model (global sprint-8)
**Date**: 2026-03-20
**Reviewer**: Senior Technical Lead
**Verdict**: All good

---

## Review Summary

Six files across `src/processor/` and `src/trust/` implemented correctly. Pure functions, injectable clocks, no mutation, zero external dependencies. Consistent API style with prior sprint modules. 77 tests cover all acceptance criteria. Critical invariant (PurpleAir T3 cannot settle) tested explicitly.

---

## T-27: quality.js ✅

`freshnessScore` (line 39): three cases handled correctly — future timestamp → 0.9 (slight penalty), fresh → linear decay from 1.0 to 0.0 over `stale_after_ms`, fully stale → floored at 0. `event.timestamp ?? now` fallback at line 67 gives freshness=1.0 when event has no timestamp. Final `Math.max(0, Math.min(1, ...))` clamp at line 70 ensures [0,1] invariant regardless of blend arithmetic. Unknown tiers default to 0.50 (T3 equivalent). Correct.

## T-27: uncertainty.js ✅

`computeDoubtPrice` (line 26): `1 - quality`, clamped. Single expression, no edge cases. Consistent with theatre templates where doubt_price=0 means high confidence. Correct.

## T-27: settlement.js ✅

T0 and T1 both map to `'ground_truth'` — correct per FORGE_PROGRAM.md "T1 — Official source, Yes (Brier discount)": T1 settles, the Brier discount is applied at scoring time. T2 → `'corroboration'`, T3/unknown → `'provisional'`. The comment distinguishing labelling (settlement.js) from enforcement (oracle-trust.js) is architecturally important and correctly placed.

`canSettleByClass` (line 54): Labelled explicitly as secondary/convenience relative to oracle-trust.js `canSettle`. This delineation prevents future implementers from treating settlement.js as the enforcement gate.

## T-27: bundles.js ✅

Optional passthrough fields (channel_a, channel_b, lat, lon, frozen_count) use `!= null` guard (lines 75–79) — absent fields don't appear on the bundle as `undefined`. This keeps the bundle shape minimal and adversarial.js checks safe (all use `!= null` on their inputs).

Import chain: bundles.js → quality.js + uncertainty.js + settlement.js. No circular dependencies. Correct layering.

## T-28: oracle-trust.js ✅

`getTrustTier` (line 61): lowercase normalisation handles 'PurpleAir', 'AIRNOW', 'EPA_AQS' case variants correctly. Empty string `''` is falsy → returns `'unknown'`. Single registry lookup, no branches.

`canSettle` (line 75): `tier === 'T0' || tier === 'T1'` — one line, unambiguous. Any tier not explicitly T0 or T1 returns false. PurpleAir ('purpleair' → 'T3') → false. The critical invariant is structurally enforced by this function; there is no code path that allows T3 to return true.

`validateSettlement` (line 86): Structured result with `reason` string on rejection. The reason includes the tier, which is the right information for a caller enforcing settlement gates.

## T-28: adversarial.js ✅

Channel A/B check (line 72): `max(|a|, |b|, 1)` denominator floor — matches divergence.js Sprint 7 pattern. Prevents division by zero when both channels report 0. Correct.

Clock drift future (line 97): `-age_ms > MAX_FUTURE_MS` is equivalent to `bundle.timestamp - now > MAX_FUTURE_MS`. Correct.

Location check (line 106): `bundle.lon ?? 0` and `context.registered_lon ?? 0` fallbacks — if either side is missing, lon diff is 0, so the check degrades to lat-only, which is more lenient but safe. Correct for a generalized implementation.

Sybil check (line 120): `peer_values.every(v => v === first)` uses strict equality. For floating-point sensor readings this is a simplified first gate (documented in Known Limitations). Correct for the sprint scope.

`checkChannelConsistency` (line 140): Standalone PurpleAir A/B wrapper. Consistent logic with the inlined check — same denominator formula, same threshold. The `consistent: divergence <= CHANNEL_DIVERGENCE_THRESHOLD` boundary condition (≤ not <) is intentional: exactly at threshold passes, consistent with the test case at trust.spec.js:88.

---

## Testing

77 tests, 15 suites. Float precision handled with `Math.abs(x - expected) < 1e-10` throughout. Boundary conditions tested at all thresholds. Critical invariant explicitly named at trust.spec.js:55 with a two-step assertion (PurpleAir → T3 → canSettle false).

6/6 convergence tests pass. 459 total unit tests pass. Zero regressions.

No gaps found.

---

## Architecture

All six files in `src/processor/` and `src/trust/` as specified in SDD file tree. No external dependencies. ES module exports. Injectable clock propagated through buildBundle config. Adversarial check designed for stateless per-bundle use with optional context for comparative checks — correct layering for a library that doesn't own session state.
