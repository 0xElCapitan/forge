# Sprint 2 Review: Senior Tech Lead Feedback

**Sprint:** 2 — Security Audit + Red-Team
**Reviewer:** Senior Tech Lead
**Date:** 2026-03-27
**Verdict:** All good (with noted concerns)

---

## Overall Assessment

Sprint 2 delivered a thorough, well-structured security audit and red-team report covering all 7 tasks across 3 attack surfaces. The findings register is accurate — I spot-checked RT-01, RT-05, RT-07, RT-09, RT-10, SA-02, and SA-07 against actual source code and all check out. Severity ratings are appropriate with one upgrade recommendation. The attack chain analysis (RT-09 + RT-01) is particularly strong — identifying the composition of two findings that individually are concerning but together constitute a full invariant bypass.

**Approved for the following reasons:**
1. All 7 tasks completed with structured findings per target
2. All 11 acceptance criteria addressed (4 PASS, 7 with documented findings)
3. Supply chain verified clean — zero external dependencies
4. Red-team covered all 3 targets with false-negative and false-positive test vectors
5. No code was changed (correct — this is an audit sprint, not a fix sprint)
6. 566/566 tests verified passing

---

## Verification of Key Findings

| Finding | Spot-Check Result |
|---------|-------------------|
| RT-01 (settle bypass) | **CONFIRMED** — `lifecycle.js:315` has `if (opts.source_id)` guard. Omitting source_id skips `validateSettlement()` entirely. Fail-open. |
| RT-05 (Check 6 missing) | **CONFIRMED** — `adversarial.js:129` returns `{ clean: true }` after Check 5. Check 6 code absent despite JSDoc documentation at line 12. |
| RT-09 (tier not validated) | **CONFIRMED** — `bundles.js:51` defaults `tier` to `'T3'` but any caller can pass `'T0'`. No cross-check against `getTrustTier(source_id)`. |
| RT-10 (mutable bundles) | **CONFIRMED** — `bundles.js:81` returns plain object. `Object.freeze()` not called. Post-construction mutation undetectable. |
| SA-02 (NaN propagation) | **CONFIRMED** — `quality.js:42` computes `1 - age_ms / stale_after_ms`. When `stale_after_ms=0`: `1 - 0/0 = NaN`. `Math.max(0, NaN) = NaN`. |
| SA-07 (path traversal) | **CONFIRMED** — `deterministic.js:87` calls `readFileSync(fixturePath, 'utf8')` with zero path validation. Publicly exported via `src/index.js:169`. |

---

## Adversarial Analysis

### Concerns Identified

1. **SA-07 is under-rated at MEDIUM — should be HIGH.** Path traversal in publicly exported functions (`createReplay` at `src/index.js:169`, `ingestFile` at `src/index.js:154`) is CWE-22 (Improper Limitation of a Pathname to a Restricted Directory). These are the public API surface of FORGE — any consumer of the library inherits this vulnerability. The "FORGE is a library, not a server" mitigation reduces exploitability but does not reduce severity of the API design flaw. npm packages with path traversal in public APIs have been CVE'd before. **Recommend upgrading to HIGH for Sprint 3 triage.**

2. **The report does not assess `checkAdversarial` wiring gap from a red-team perspective.** Sprint 1 (HI-02) identified that `checkAdversarial()` runs only at `lifecycle.js:223` (runtime-level), NOT in `buildBundle()`. The Sprint 2 red-team should have explicitly tested: "Can an attacker bypass adversarial detection by calling `buildBundle()` directly instead of going through `ForgeRuntime.ingestBundle()`?" The answer is yes — direct `buildBundle()` callers bypass all adversarial checks. This should appear as a finding in the red-team report for completeness, even though it was already documented in Sprint 1.

3. **RT-02 (`getTrustTier()` crash on object input) is under-rated at LOW — should be MEDIUM.** `getTrustTier({})` throws `TypeError: {}.toLowerCase is not a function`. If `source_id` can be influenced by external data (e.g., a JSON payload with `source_id: {}` instead of a string), this becomes a crash vector in the trust enforcement hot path. CWE-20 (Improper Input Validation). The fix is trivial (`typeof sourceId !== 'string'` guard), and the severity should reflect that the crash occurs in the trust boundary code.

### Assumptions Challenged

- **Assumption**: "Bundle immutability (RT-10) is a HIGH finding requiring `Object.freeze()`."
- **Risk if wrong**: `Object.freeze()` is shallow — nested objects within bundles (e.g., `metadata`, `resolution`) would still be mutable. A freeze also changes the API contract for any code that sets `bundle.resolution` at settlement time (`lifecycle.js:329` spreads theatre state which includes resolution). Additionally, in V8, `Object.freeze()` on hot objects can de-optimize JIT compilation.
- **Recommendation**: Before implementing `Object.freeze()` in Sprint 3, verify that no downstream code mutates bundles legitimately. The `resolution: null` field is explicitly populated later at settlement time — freezing would break this. Consider a validation-at-ingestion approach instead: `ingestBundle()` could snapshot the bundle's critical fields (quality, evidence_class, doubt_price) at ingestion time rather than relying on immutability.

### Alternatives Not Considered

- **Alternative**: The red-team could have run dynamic adversarial tests — actually calling `checkAdversarial()` with the false-negative vectors (NaN, Infinity, extreme values, jittered Sybil) and capturing the output, rather than performing static-only analysis.
- **Tradeoff**: Dynamic testing would have produced executable test vectors that could be added directly to the test suite in Sprint 3. Static analysis provides the same findings but requires the Sprint 3 implementer to write the tests from scratch.
- **Verdict**: Current approach is correct for Sprint 2 scope (per sprint plan: "this sprint IS the security review"). Sprint 3 should convert the false-negative vectors from the report into actual test cases.

---

## Documentation Verification

| Item | Status |
|------|--------|
| CHANGELOG entry | N/A — no code changes in Sprint 2 |
| sprint-plan.md update | Deferred to approval |
| NOTES.md update | Not required |

---

## Summary

The security audit is thorough, accurate, and well-structured. The findings register provides Sprint 3 with a clear, actionable triage list. The attack chain analysis (RT-09 + RT-01) is the strongest contribution — it identifies the compositional vulnerability that makes the settlement invariant bypass possible. The two upgrade recommendations (SA-07 → HIGH, RT-02 → MEDIUM) strengthen the prioritization.

Sprint 2 is **approved**. Proceed to Sprint 3 (Critical Fixes).
