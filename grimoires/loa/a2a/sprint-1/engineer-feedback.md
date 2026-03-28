# Sprint 1 Review: Senior Tech Lead Feedback

**Sprint:** 1 — Code Review
**Reviewer:** Senior Tech Lead
**Date:** 2026-03-27
**Verdict:** All good (with noted concerns)

---

## Overall Assessment

Sprint 1 delivered a thorough, well-structured code review of all 30 FORGE source files. The findings register is accurate — I spot-checked CR-01, CR-02, HI-01, HI-02, HI-04, and ME-07 against the actual source code and all check out. The severity ratings are appropriate. The acceptance criteria from the sprint plan are met.

**Approved for the following reasons:**
1. All 5 priority review targets examined with detailed findings
2. All acceptance criteria addressed (8 PASS, 2 with documented findings)
3. Finding severity ratings are well-calibrated
4. Recommendations for Sprint 3 are actionable and correctly prioritized
5. No code was changed (correct — this is a review sprint, not an implementation sprint)

---

## Verification of Key Findings

| Finding | Spot-Check Result |
|---------|-------------------|
| CR-01 (Check 6 missing) | **CONFIRMED** — `adversarial.js:129` returns `{ clean: true }` after Check 5. No Check 6 code exists. |
| HI-01 (settle bypass) | **CONFIRMED** — `lifecycle.js:315` has `if (opts.source_id)` guard. All 13 test calls supply `source_id` — the bypass path is completely untested. |
| HI-04 (non-deterministic ID) | **CONFIRMED** — `lifecycle.js:106` uses `Date.now()` directly, not `this.#clock()`. |
| ME-07 (IR field mismatches) | **CONFIRMED** — `emit.js:128` uses `median_gap_ms` but `cadence.js` returns `median_ms`. Test at `ir.spec.js:14` masks this by constructing mock profiles with emit.js field names. |

---

## Adversarial Analysis

### Concerns Identified

1. **ME-07 is under-rated at MEDIUM.** The IR emit field name mismatches cause the `feed_profile` in the Proposal IR envelope to contain all `null` metrics for cadence, distribution, noise, and density. The convergence tests pass because they score on template matching and grammar classification, not on envelope metric values. The IR unit tests pass because they use mock profiles with emit.js field names (`ir.spec.js:14-17`), not real classifier output. **This means Echelon receives structurally valid but informationally empty profile data.** For a Cycle 002 integration dependency, this should be HIGH — it is the only finding that directly breaks the Echelon contract. Recommend upgrading to HIGH for Sprint 3 triage.

2. **HI-01 bypass path has zero test coverage.** Every test call to `settle()` in `runtime.spec.js` supplies `source_id`. There is no test asserting that settlement is rejected when `source_id` is omitted. This means the fix in Sprint 3 could introduce a regression without any test catching it. Sprint 3 must add a test for the bypass case alongside the fix.

3. **The review did not assess the interaction between `buildBundle()` default tier and trust enforcement.** `buildBundle()` defaults `tier` to `'T3'` (`bundles.js:51`). This means any caller that omits `tier` in the config object gets a T3 bundle, which correctly cannot settle. But the default also means quality is computed with `TIER_BASELINE.T3 = 0.50` even when the source is actually T0. This is a silent downgrade, not a safety issue, but it means callers must always explicitly pass the tier. The review would benefit from noting this as a correctness concern.

### Assumptions Challenged

- **Assumption**: "CR-01 (missing Check 6) is CRITICAL severity."
- **Risk if wrong**: Check 6 targets "physically implausible bounds" — but bounds are domain-specific (AQI 0-500, Richter 0-10, X-ray flux 1e-9 to 1e-3). Without per-domain configuration, any implementation would either be too loose (useless) or too tight (false positives). The missing check is a gap, but calling it CRITICAL implies it's exploitable — in practice, T2/T3 sources with impossible values still can't settle theatres (trust enforcement blocks that).
- **Recommendation**: Keep as CRITICAL in the register for documentation completeness, but Sprint 3 should implement with `context.value_bounds = { min, max }` as optional, not hardcoded per-domain. The minimum viable fix (`!Number.isFinite(bundle.value)`) is correct and should be the Sprint 3 scope.

### Alternatives Not Considered

- **Alternative**: The review could have run the actual FORGE pipeline end-to-end with adversarial inputs (e.g., crafted fixtures with NaN values, impossible coordinates, Sybil patterns) rather than performing static-only analysis.
- **Tradeoff**: Dynamic testing would have caught issues like ME-07 earlier (since a real pipeline run would produce nulls in the envelope). But static review is the correct scope for Sprint 1 — dynamic adversarial testing belongs in Sprint 2 (Red-Team).
- **Verdict**: Current approach is correct for Sprint 1. Sprint 2 should include dynamic adversarial testing with crafted fixtures.

---

## Documentation Verification

| Item | Status |
|------|--------|
| CHANGELOG entry | N/A — no code changes in Sprint 1 |
| sprint-plan.md update | Deferred to approval |
| NOTES.md update | Not required |

---

## Summary

The code review is thorough, accurate, and well-prioritized. The findings register provides Sprint 3 with a clear, actionable triage list. The one upgrade recommendation (ME-07 → HIGH) strengthens the prioritization for Cycle 002 readiness.

Sprint 1 is **approved**. Proceed to Sprint 2 (Security Audit + Red-Team).
