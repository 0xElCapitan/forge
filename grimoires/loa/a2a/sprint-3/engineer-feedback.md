# Sprint 3 Code Review: Engineer Feedback

**Sprint:** 3 — Critical Fixes
**Reviewer:** Senior Tech Lead
**Date:** 2026-03-27
**Verdict:** All good (with noted concerns)

---

## Overall Assessment

All 10 findings addressed. 587/587 tests pass. Convergence unchanged at 20.0/20.0. Zero new dependencies. The critical attack chain (RT-09 + RT-01) is broken. Code quality is production-ready.

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Zero open critical findings | PASS |
| Every HIGH has code fix or accepted-risk rationale | PASS |
| `npm run test:all` passes (587 tests, 0 failures) | PASS — verified locally |
| Convergence tests pass in raw and anonymized modes | PASS |
| No new dependencies | PASS |

---

## Code Review: Spot-Check Results

| Fix | File:Lines | Verified | Notes |
|-----|-----------|----------|-------|
| RT-01 fail-closed | lifecycle.js:327-329 | PASS | Returns before settlement logic |
| RT-05 Check 6 | adversarial.js:129-135 | PASS | `Number.isFinite()`, positioned before final return |
| SA-07 path traversal | deterministic.js:86-95 | PASS | `resolve()` + `normalize()` + `startsWith()` |
| RT-09 API contract | bundles.js:39-49 | PASS | JSDoc documents caller responsibility |
| RT-10 snapshot | lifecycle.js:229-239 | PASS | `_snapshot` captures 4 critical fields at ingestion |
| RT-02 type guard | oracle-trust.js:62 | PASS | `typeof sourceId !== 'string'` guard |
| SA-02 NaN guard | quality.js:40 | PASS | `stale_after_ms <= 0` returns 0 |
| CR-02 input validation | bundles.js:52-54 | PASS | TypeError on invalid rawEvent.value |
| ME-07 field names | emit.js:128-143 | PASS | All 4 fields corrected |
| HI-04 injectable clock | lifecycle.js:105-107 | PASS | Clock parameter with Date.now default |

---

## Test Coverage Assessment

| Test File | New Tests | Assertions Quality |
|-----------|-----------|-------------------|
| runtime.spec.js | 3 (RT-01) | Meaningful — checks settled=false AND reason string |
| trust.spec.js | 7 (Check 6) + 4 (RT-02) | Meaningful — tests rejection, acceptance, and opt-in semantics |
| processor.spec.js | 4 (input) + 3 (NaN) | Meaningful — tests TypeError throws and finite output |
| ir.spec.js | Fixture + assertions updated | Correct field names in both fixture and null-field test |

---

## Adversarial Analysis

### Concerns Identified (3)

1. **Path traversal guard is opt-in** (deterministic.js:86-95): Existing callers without `allowedDir` are unprotected. This is documented as a backward-compatible design decision — acceptable for a library, but any future public API surface that calls `createReplay()` must remember to pass `allowedDir`. Non-blocking: documented in Known Limitations.

2. **`_snapshot` is shallow** (lifecycle.js:233-238): If any snapshotted field is an object reference, mutation of the inner object would bypass the snapshot. Currently all 4 fields (`quality`, `evidence_class`, `doubt_price`, `source_id`) are primitives, so this is safe today. If future fields are added to the snapshot, this assumption must be revisited. Non-blocking: documented in Known Limitations.

3. **`buildBundle()` accepts NaN via typeof check** (bundles.js:52): `typeof NaN === 'number'` means NaN passes input validation. This is mitigated by Check 6 in adversarial.js at the trust boundary. The two-layer design is intentional (separation of concerns), but a developer reading only `bundles.js` might assume NaN is rejected. Non-blocking: the mitigation is verified and tested.

### Assumptions Challenged (1)

- **Assumption**: `_snapshot` fields will always be primitives.
- **Risk if wrong**: Object mutation would bypass snapshot detection.
- **Recommendation**: Add a code comment at the snapshot site noting this constraint, or use `structuredClone()` for future-proofing if object fields are ever added.

### Alternatives Not Considered (1)

- **Alternative**: `Object.freeze()` for bundle immutability instead of `_snapshot`.
- **Tradeoff**: Would be stronger (prevents mutation entirely) but breaks `resolution` field population at settlement time and de-optimizes V8 JIT.
- **Verdict**: Current approach is justified — Tech Lead explicitly recommended against `Object.freeze()` for these reasons. The snapshot pattern is the right call.

---

## Complexity Analysis

### Functions Reviewed
- `settle()`: OK (18 lines, 3 params, nesting 2)
- `ingestBundle()`: OK (35 lines, 2 params, nesting 2)
- `checkAdversarial()`: OK (40 lines, 2 params, nesting 2) — 6 sequential checks, linear flow
- `buildBundle()`: OK (30 lines, 2 params, nesting 1)
- `createReplay()`: OK (20 lines, 2 params, nesting 2)

### Duplication Found
- None detected

### Dead Code
- None detected

---

## Karpathy Principles Check

| Principle | Status |
|-----------|--------|
| Think Before Coding | PASS — Triage documented in reviewer.md with clear rationale for each disposition |
| Simplicity First | PASS — Minimal fixes, no over-engineering. Check 6 is 6 lines. NaN guard is 1 line. |
| Surgical Changes | PASS — Only modified lines necessary for each fix. No drive-by improvements. |
| Goal-Driven | PASS — Each fix maps to a specific finding ID with test verification. |

---

## Documentation Verification

| Item | Status |
|------|--------|
| CHANGELOG entry for v0.1.1 | PASS |
| Version bumped in package.json | PASS |
| Accepted risks documented | PASS (RT-06, RT-07, HI-02) |
| SemVer correct (PATCH for bug fixes) | PASS |

---

## Previous Feedback

No previous engineer-feedback.md existed for Sprint 3. First review.

---

Concerns documented but non-blocking. See Adversarial Analysis above.
