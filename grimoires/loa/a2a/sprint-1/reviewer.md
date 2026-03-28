# Sprint 1 Implementation Report: Code Review

**Sprint:** 1 — Code Review
**Date:** 2026-03-27
**Author:** Implementation Agent
**Status:** Complete — Awaiting Tech Lead Approval

---

## Executive Summary

Sprint 1 conducted a formal code review of FORGE Cycle 001 across all 30 source files, with heightened attention to the 5 priority targets specified in the PRD (FR-1 through FR-5). The review was executed in parallel across 5 specialized review agents covering: (1) oracle trust model, (2) adversarial gate, (3) evidence bundle pipeline, (4) usefulness/compose/replay, and (5) full codebase sweep.

**Result: 2 CRITICAL, 4 HIGH, 11 MEDIUM, 9 LOW, 12 INFO findings.**

The two CRITICAL findings are input validation gaps. The four HIGH findings span trust enforcement bypass, adversarial gate wiring, path traversal, and non-deterministic ID generation. The codebase is well-structured, well-documented, and follows clean patterns throughout — the findings are concentrated at boundary conditions and architectural wiring, not in the core logic.

---

## Findings Register

### CRITICAL (2)

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| CR-01 | Argus Check 6 not implemented | `adversarial.js:11` (doc) / absent from body | JSDoc documents 6 checks but only 5 are implemented. Check 6 ("value out of range — reading outside physically plausible bounds") has no code. Sensors reporting impossible values (negative AQI, PM2.5 of 99999) pass all checks. |
| CR-02 | rawEvent.value not validated | `bundles.js:64` | `buildBundle()` assigns `rawEvent.value` directly with no validation. `undefined`, `NaN`, `Infinity`, `-0`, `null` all propagate into bundles and downstream into theatre position updates. |

### HIGH (4)

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| HI-01 | Missing source_id bypasses settlement gate | `lifecycle.js:315` | `settle()` guards trust enforcement on `if (opts.source_id)`. Omitting source_id bypasses `validateSettlement()` entirely. The public API (`forge.getRuntime().settle()`) does not enforce its presence. Fail-open design. |
| HI-02 | checkAdversarial not wired into buildBundle | `bundles.js:49-82` | PRD FR-1 requires "`checkAdversarial()` wired into `buildBundle()` and cannot be bypassed." It is NOT. Adversarial checks only run at `lifecycle.js:223` (runtime level). Direct `buildBundle()` callers bypass all adversarial detection. |
| HI-03 | Path traversal in createReplay/ingestFile | `deterministic.js:87` | `readFileSync(fixturePath)` with no path validation. Exported publicly via `src/index.js`. A path like `../../../etc/passwd` would be read. Current usage is hardcoded fixtures, but the API surface is unprotected. |
| HI-04 | Non-deterministic theatre ID generation | `lifecycle.js:106` | `generateId()` uses `Date.now()` directly, bypassing the injectable clock that `ForgeRuntime` accepts in its constructor. Theatre IDs are non-deterministic even in test mode with a fixed clock. |

### MEDIUM (11)

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| ME-01 | Early-return: only first adversarial check reported | `adversarial.js:64-129` | Multiple simultaneous violations only surface the first. Limits forensic analysis. |
| ME-02 | All adversarial checks skippable via field omission | `adversarial.js:68,83,91,104,118` | Every check is gated on `!= null`. A bundle with only `{ value: 42 }` passes all checks. |
| ME-03 | Sybil check only detects exact equality | `adversarial.js:117-127` | Trivially varied values (42.0, 42.001, 42.002) evade the check. |
| ME-04 | Empty/malformed rawEvent not rejected | `bundles.js:49` | `buildBundle({})` produces a bundle with `value: undefined`. No guard clause. |
| ME-05 | NaN from computeQuality when stale_after_ms=0 | `quality.js:42` | `1 - 0/0 = NaN` when `age_ms=0` and `stale_after_ms=0`. Propagates through doubt_price. |
| ME-06 | computeDoubtPrice NaN passthrough | `uncertainty.js:27` | `Math.max(0, Math.min(1, 1 - NaN))` = `NaN`. Clamp does not protect against NaN. |
| ME-07 | IR emit field name mismatches (4 fields) | `emit.js:128-143` | `serializeProfile()` uses wrong field names: `median_gap_ms` (should be `median_ms`), `cv` (should be `jitter_coefficient`), `spike_ratio` (should be `spike_rate`), `stream_count` (should be `sensor_count`/`tier_count`). All serialize as `null`. |
| ME-08 | Unused `proposal` parameter in actionability | `usefulness.js:92` | `actionability(feedProfile, proposal, sourceTier)` accepts `proposal` but never uses it. Dead parameter. |
| ME-09 | Rule 1/Rule 3 shadow case undocumented | `compose.js:156-258` | When feedA is both bounded-regulatory AND spike-driven, Rule 1 fires and Rule 3 is never evaluated. Likely intentional but not documented. |
| ME-10 | USGS adapter dedup is O(n*m) with unbounded growth | `usgs-live.js:195` | Converts Set to array for linear scan on every feature. No eviction for old entries. |
| ME-11 | Theatre process functions use Date.now() | `threshold-gate.js:109`, `cascade.js:146` | Fall back to `Date.now()` instead of injectable clock when `bundle.timestamp` is absent. |

### LOW (9)

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| LO-01 | validateSettlement omits reason on success path | `oracle-trust.js:90` | Optional field, correct per JSDoc. No impact. |
| LO-02 | Location spoofing defaults lon to 0 | `adversarial.js:106` | Missing lon defaults to 0 via `??`. Could false-positive/negative for sensors near lon=0. |
| LO-03 | NaN from undefined factor in actionability (theoretical) | `usefulness.js:97` | If `TIER_ACTIONABILITY` lost its `unknown` key, `tierMod` would be undefined. Currently safe. |
| LO-04 | Clamping in computeUsefulness is correct but redundant | `usefulness.js:121` | All current table values are in (0,1]. Defensive and appropriate. |
| LO-05 | alignFeeds no guard on missing timestamp | `compose.js:35-50` | Degrades gracefully (NaN fails check), but no diagnostic. |
| LO-06 | O(n*m) alignment algorithm | `compose.js:35-50` | Fine for current event counts. Document for future. |
| LO-07 | Dead branch in createReplay | `deterministic.js:92-95` | `speedFactor !== 0` branch has no implementation. Documented as Sprint 1 decision. |
| LO-08 | readFileSync throws on missing data files | `thresholds.js:51` | No graceful fallback at module load time. |
| LO-09 | Math.min/max spread risk for large arrays | `thresholds.js:77,90-108` | Stack overflow for >100k elements. Use loop-based approach. |

### INFO (12)

| ID | Finding | Location | Summary |
|----|---------|----------|---------|
| IN-01 | canSettle whitelist is safe by design | `oracle-trust.js:76` | Strict equality, no bypass path |
| IN-02 | No prototype pollution risk | `oracle-trust.js:63` | `canSettle` only matches exact string literals |
| IN-03 | toLowerCase normalization is sound | `oracle-trust.js:62-63` | Null guard runs first |
| IN-04 | TRUST_REGISTRY is complete | `oracle-trust.js:31-50` | All codebase source IDs registered |
| IN-05 | settlement.js dual-gate is consistent | `settlement.js:25-30` | canSettle and canSettleByClass agree for all tiers |
| IN-06 | Test coverage is thorough for trust model | `test/unit/trust.spec.js` | All tiers, case-insensitivity, null/undefined tested |
| IN-07 | checkChannelConsistency duplicates Check 1 logic | `adversarial.js:140-144` | Intentional convenience wrapper |
| IN-08 | checkAdversarial properly called in runtime | `lifecycle.js:223` | Confirmed correct at ingestion time |
| IN-09 | No non-deterministic APIs in replay | `deterministic.js` | Pure file I/O + JSON parse |
| IN-10 | feed-grammar.js is clean orchestrator | `feed-grammar.js` | No issues found |
| IN-11 | All 5 dimension classifiers are deterministic | `classifier/*.js` | No Date.now() or Math.random() |
| IN-12 | RLMF certificates are correct | `rlmf/certificates.js` | Brier scoring formulas verified |

---

## Acceptance Criteria Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| All 5 priority review targets examined | PASS | oracle-trust, adversarial, bundles, usefulness, compose all reviewed |
| `getTrustTier()` handles unrecognized IDs safely | PASS | Returns `'unknown'` via `??` operator (IN-03) |
| `canSettle()` returns false for T2, T3, unknown | PASS | Whitelist pattern, strict equality (IN-01) |
| `validateSettlement()` populates reason for rejections | PASS | All rejection paths have reason (LO-01: success path omits, correct per JSDoc) |
| `checkAdversarial()` wiring assessed | **FINDING** | NOT in buildBundle (HI-02). IS in lifecycle.ingestBundle (IN-08). Architecture decision needed. |
| Dual-gate agreement verified | PASS | canSettle and canSettleByClass agree for all tiers (IN-05) |
| computeQuality/computeDoubtPrice edge cases | **FINDING** | NaN propagation when stale_after_ms=0 (ME-05, ME-06) |
| proposeComposedTheatre null return | PASS | Returns null when no rule fires (compose.js:260) |
| No non-deterministic patterns in replay | PASS | Confirmed deterministic (IN-09) |
| Usefulness composite is true [0,1] | PASS | Math.max(0, Math.min(1, ...)) clamping correct (LO-04) |

---

## Technical Highlights

### Architecture Observations

1. **Trust enforcement is sound at its core.** `canSettle` is a pure whitelist — impossible to accidentally allow T2/T3 settlement through this function. The vulnerability is in the caller (`lifecycle.js:settle()`) not enforcing the call.

2. **Adversarial gate is well-designed but incomplete.** 5 of 6 documented checks work correctly. The missing Check 6 and the wiring gap are the significant issues.

3. **IR emit has 4 field name mismatches** (ME-07) that cause profile metrics to serialize as `null`. This doesn't break the pipeline but means Echelon receives structurally valid but informationally empty profile data. This should be fixed before Cycle 002.

4. **NaN propagation chain** from quality.js through uncertainty.js is a subtle but real risk path (ME-05 → ME-06 → CR-02). The linear `1 - quality` formula is appropriate but unguarded against invalid input.

### Positive Observations

- Zero external runtime dependencies confirmed
- All 566 tests passing (verified at sprint start)
- Convergence score 20.5/20.5
- Clean code patterns throughout — JSDoc on all exports, consistent naming, clear module boundaries
- Zero tech debt markers (no TODO, FIXME, HACK)
- Dual-gate settlement logic is correct and consistent

---

## Testing Summary

This sprint is a code review — no new code was written and no tests were modified. All existing tests were verified passing:

```
npm run test:all
# ℹ tests 566
# ℹ pass 566
# ℹ fail 0
# ℹ duration_ms 334.133
```

---

## Recommendations for Sprint 3 (Critical Fixes)

### Must Fix (CRITICAL)
1. **CR-01:** Implement Argus Check 6 (value out of range) — at minimum, reject `!Number.isFinite(bundle.value)`
2. **CR-02:** Add input validation guard in `buildBundle()` for `rawEvent.value`

### Should Fix (HIGH)
3. **HI-01:** Change `settle()` to fail-closed when `source_id` is missing
4. **HI-02:** Either wire `checkAdversarial` into `buildBundle` or formally document runtime-only enforcement as architectural decision
5. **HI-03:** Add path traversal guard to `createReplay`/`ingestFile`
6. **HI-04:** Pass injectable clock to `generateId()` in lifecycle.js

### Consider Fixing (MEDIUM — Top 3)
7. **ME-07:** Fix IR emit field name mismatches (4 fields) — important for Cycle 002 Echelon integration
8. **ME-05/ME-06:** Guard against NaN in quality/doubt computation
9. **ME-04:** Add guard clause for empty/malformed rawEvent in buildBundle

---

## Verification Steps

1. `node --test test/unit/*.spec.js test/convergence/*.spec.js` — all 566 pass
2. Review this findings register for completeness
3. Verify each CRITICAL/HIGH finding against source code at cited locations
4. Assess which findings require code fixes vs. documentation vs. accepted-risk

---

## Known Limitations

- Review was conducted by AI agents, not human reviewers
- Static analysis only — no dynamic testing, fuzzing, or adversarial execution was performed (that's Sprint 2)
- Some findings overlap between review agents (deduplicated in this report)
- The full codebase sweep covered all modules but with less depth than the priority targets

---

*Generated by Implementation Agent — Sprint 1 Code Review*
