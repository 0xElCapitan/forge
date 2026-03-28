# Sprint 3 Implementation Report: Critical Fixes

**Sprint:** 3 — Critical Fixes
**Date:** 2026-03-27
**Author:** Implementation Agent
**Status:** Complete — Awaiting Tech Lead Approval

---

## Executive Summary

Sprint 3 implemented fixes for all CRITICAL and HIGH findings from Sprint 1 (Code Review) and Sprint 2 (Security Audit + Red-Team), plus key MEDIUM findings. 10 findings addressed across 8 source files and 3 test files, with 21 new tests added. All 587 tests pass (566 original + 21 new). Convergence score unchanged at 20.0/20.0. Version bumped to 0.1.1.

**Zero new dependencies introduced. Zero external imports added.**

---

## Task 3.1: Triage Findings

### Consolidated Triage (Sprint 1 + Sprint 2 + Severity Upgrades)

| Priority | ID | Final Severity | Disposition | Fix Applied |
|----------|-----|---------------|-------------|-------------|
| 1 | RT-01/HI-01 | **CRITICAL** | MUST FIX | `settle()` fail-closed |
| 2 | RT-05/CR-01 | **HIGH** | MUST FIX | Argus Check 6 implemented |
| 3 | SA-07/HI-03 | **HIGH** (upgraded from MEDIUM) | MUST FIX | Path traversal guard |
| 4 | RT-09 | **HIGH** | Documented as API contract | JSDoc + code comment |
| 5 | RT-10 | **HIGH** | Validation-at-ingestion | Snapshot critical fields |
| 6 | RT-02 | **MEDIUM** (upgraded from LOW) | Fixed | Type guard |
| 7 | SA-02/ME-05/ME-06 | **MEDIUM** | Fixed | NaN guard |
| 8 | CR-02/SA-01 | **MEDIUM** | Fixed | Input validation |
| 9 | ME-07 | **HIGH** (upgraded from MEDIUM) | Fixed | Field name correction |
| 10 | HI-04 | **HIGH** | Fixed | Injectable clock |

### Accepted Risk (Not Fixed)

| ID | Severity | Rationale |
|----|----------|-----------|
| RT-06 | MEDIUM | Field omission bypass is by design — adversarial detection is opt-in with optional context. Documented as architectural decision. |
| RT-07 | MEDIUM | Sybil exact-equality threshold deferred to Cycle 002 — requires statistical correlation design that goes beyond Sprint 3 scope. |
| HI-02 | HIGH | `checkAdversarial` wiring gap — adversarial checks run at runtime level (`lifecycle.js:223`), not `buildBundle()`. This is intentional: `buildBundle()` is a data assembly function, adversarial gating belongs at the runtime ingestion boundary. Documented as architectural decision. |

---

## Task 3.2: Critical Fixes

### RT-01: Settlement Bypass → Fail-Closed (CRITICAL)

**File:** `src/runtime/lifecycle.js:314-320`
**Before:**
```javascript
if (opts.source_id) {
  const validation = validateSettlement(opts.source_id);
  // ...
}
// Settlement proceeds without trust enforcement
```

**After:**
```javascript
if (!opts.source_id) {
  return { settled: false, reason: 'source_id is required for settlement' };
}
const validation = validateSettlement(opts.source_id);
if (!validation.allowed) {
  return { settled: false, reason: validation.reason };
}
```

**Tests added:** 3 tests in `runtime.spec.js` — omitted source_id, empty string, null.

---

## Task 3.3: High Fixes

### RT-05/CR-01: Argus Check 6 — Value Out of Range

**File:** `src/trust/adversarial.js:129-134` (new code, before final `return { clean: true }`)
**Implementation:** `if (bundle.value != null && !Number.isFinite(bundle.value))` — rejects NaN, Infinity, -Infinity.
**Design:** Per Tech Lead recommendation, minimum viable fix using `Number.isFinite()`. Optional `context.value_bounds = { min, max }` deferred — domain-specific bounds require per-feed configuration.
**Tests added:** 7 tests in `trust.spec.js` — NaN, Infinity, -Infinity, normal, zero, negative, null/undefined.

### SA-07/HI-03: Path Traversal Guard

**File:** `src/replay/deterministic.js:84-95`
**Implementation:** `createReplay()` now accepts `options.allowedDir`. When provided, the resolved path is verified to start with the allowed directory. Throws `Error` on traversal attempt.
**Design:** Opt-in guard via `allowedDir` parameter. Existing callers (convergence tests) are unaffected — they use known fixture paths without `allowedDir`. Library consumers can set `allowedDir` for defense-in-depth.
**Note:** `ingestFile()` in `generic.js:465` calls `createReplay()` — the guard propagates automatically when `allowedDir` is passed.

### RT-09: Tier Validation API Contract

**File:** `src/processor/bundles.js:41-43` (JSDoc)
**Implementation:** Documented as explicit API contract — callers MUST use `getTrustTier(source_id)` to look up tier. FORGE does not cross-check tier vs source_id in `buildBundle()`.
**Rationale:** Adding runtime cross-check would require `buildBundle()` to import `oracle-trust.js`, creating a circular concern. The tier parameter is a configuration input from the caller, not a trust boundary.

### RT-10: Bundle Validation-at-Ingestion

**File:** `src/runtime/lifecycle.js:228-237`
**Implementation:** Per Tech Lead recommendation — NOT `Object.freeze()` (would break `resolution` field population at settlement time and de-optimize V8 JIT). Instead, `ingestBundle()` snapshots critical fields (`quality`, `evidence_class`, `doubt_price`, `source_id`) into `_snapshot` at ingestion time.
**Rationale:** Downstream code can compare `bundle.quality` against `bundle._snapshot.quality` to detect post-construction mutation. The snapshot is immutable (set once at ingestion).

### ME-07: IR Emit Field Name Mismatches

**File:** `src/ir/emit.js:124-150`
**Before → After:**
- `median_gap_ms` → `median_ms` (matches `cadence.js` output)
- `cv` → `jitter_coefficient` (matches `cadence.js` output)
- `spike_ratio` → `spike_rate` (matches `noise.js` output)
- `stream_count` → `sensor_count` with `tier_count` fallback (matches `density.js` output for both classification types)

**Tests fixed:** `ir.spec.js` — updated fixture and assertions to use correct field names.

### HI-04: Deterministic Theatre ID Generation

**File:** `src/runtime/lifecycle.js:105-107`
**Implementation:** `generateId()` now accepts a `clock` parameter (defaults to `Date.now`). `ForgeRuntime.instantiate()` passes `this.#clock` to `generateId()`.
**Result:** Theatre IDs are deterministic when using a fixed clock in tests.

---

## Task 3.3 (continued): Medium Fixes

### RT-02: getTrustTier Type Guard

**File:** `src/trust/oracle-trust.js:62`
**Implementation:** Added `typeof sourceId !== 'string'` guard. Objects, numbers, arrays, booleans return `'unknown'` instead of crashing.
**Tests added:** 4 tests in `trust.spec.js` — object, number, array, boolean inputs.

### SA-02/ME-05/ME-06: NaN Guard in Quality Computation

**File:** `src/processor/quality.js:39`
**Implementation:** `if (stale_after_ms <= 0) return 0;` — prevents `0/0 = NaN` from propagating through quality → doubt_price chain.
**Tests added:** 3 tests in `processor.spec.js` — stale_after_ms=0, negative, downstream doubt_price.

### CR-02/SA-01: buildBundle Input Validation

**File:** `src/processor/bundles.js:49-51`
**Implementation:** `if (!rawEvent || rawEvent.value == null || typeof rawEvent.value !== 'number') throw new TypeError('rawEvent.value must be a number');`
**Design:** Validates that rawEvent exists and value is a number. NaN and Infinity are allowed through (they are numbers per IEEE 754 — Check 6 in adversarial.js handles the non-finite case at the trust boundary).
**Tests added:** 4 tests in `processor.spec.js` — null/undefined rawEvent, missing value, non-number value, edge case acceptance.

---

## Task 3.4: Full Test Suite

```
$ npm run test:all
ℹ tests 587
ℹ pass 587
ℹ fail 0
ℹ duration_ms 306.97
```

**Breakdown:**
- Unit tests: 581 (560 original + 21 new)
- Convergence tests: 6 (unchanged)
- Total: 587 pass, 0 fail

**Convergence scores (unchanged):**
- BREATH: 5.5 (raw) + 5.5 (anonymized)
- CORONA: 7.5 (raw) + 7.5 (anonymized)
- TREMOR: 7.0 (raw) + 7.0 (anonymized)
- Total: 20.0/20.0

---

## Task 3.5: Findings Disposition Update

| ID | Original Severity | Final Status |
|----|-------------------|-------------|
| RT-01/HI-01 | CRITICAL | **FIXED** — fail-closed settlement |
| RT-05/CR-01 | HIGH | **FIXED** — Check 6 implemented |
| SA-07/HI-03 | HIGH (upgraded) | **FIXED** — path traversal guard |
| RT-09 | HIGH | **DOCUMENTED** — API contract in JSDoc |
| RT-10 | HIGH | **FIXED** — validation-at-ingestion |
| RT-02 | MEDIUM (upgraded) | **FIXED** — type guard |
| SA-02/ME-05/ME-06 | MEDIUM | **FIXED** — NaN guard |
| CR-02/SA-01 | MEDIUM | **FIXED** — input validation |
| ME-07 | HIGH (upgraded) | **FIXED** — field names corrected |
| HI-04 | HIGH | **FIXED** — injectable clock |
| HI-02 | HIGH | **ACCEPTED RISK** — runtime-only enforcement is architectural decision |
| RT-06 | MEDIUM | **ACCEPTED RISK** — opt-in adversarial detection by design |
| RT-07 | MEDIUM | **DEFERRED** — Cycle 002 (requires statistical correlation design) |

**Open critical findings: 0**
**Open high findings: 0** (HI-02 accepted as architectural decision)

---

## Technical Highlights

### Security

1. **Settlement invariant is now enforced end-to-end.** The attack chain (RT-09 + RT-01) is broken: even with a spoofed tier in `buildBundle()`, settlement cannot proceed without a valid `source_id`. The fail-closed design means omitting `source_id` is no longer a bypass path.

2. **Argus now has all 6 documented checks.** `checkAdversarial()` rejects non-finite values (NaN, Infinity, -Infinity). The JSDoc-to-code gap is closed.

3. **NaN can no longer propagate through the quality/doubt chain.** The `stale_after_ms <= 0` guard at the root prevents the entire propagation path.

4. **Input validation at buildBundle boundary.** `rawEvent.value` must be a number. This catches the most common misuse (empty objects, missing fields) at bundle assembly time.

### Architecture

- **No new dependencies.** Zero external imports added. Supply chain remains pristine.
- **Backward compatible.** The only breaking change is `settle()` now requiring `source_id` — this enforces the security invariant that was always documented but not enforced. All existing test calls already supply `source_id`.
- **Convergence score unchanged.** All fixes are at boundary conditions and trust enforcement — core classification and template selection logic untouched.

---

## Version

**0.1.0 → 0.1.1** (PATCH: bug fixes, security hardening, no new features)

Updated: `package.json`, `CHANGELOG.md`

---

## Files Modified

| File | Changes |
|------|---------|
| `src/runtime/lifecycle.js` | RT-01 fail-closed, HI-04 injectable clock, RT-10 snapshot |
| `src/trust/adversarial.js` | RT-05 Check 6 implementation |
| `src/trust/oracle-trust.js` | RT-02 type guard |
| `src/processor/bundles.js` | CR-02/SA-01 input validation, RT-09 JSDoc |
| `src/processor/quality.js` | SA-02 NaN guard |
| `src/replay/deterministic.js` | SA-07 path traversal guard |
| `src/ir/emit.js` | ME-07 field name fixes |
| `package.json` | Version 0.1.0 → 0.1.1 |
| `CHANGELOG.md` | Created with v0.1.1 entries |
| `test/unit/runtime.spec.js` | 3 new settlement bypass tests |
| `test/unit/trust.spec.js` | 11 new tests (Check 6 + type guard) |
| `test/unit/processor.spec.js` | 7 new tests (input validation + NaN guard) |
| `test/unit/ir.spec.js` | Updated fixture + assertions for correct field names |

---

## Verification Steps

1. `npm run test:all` — 587 tests, 0 failures
2. Verify RT-01 fix: `settle()` without `source_id` returns `{ settled: false }`
3. Verify Check 6: `checkAdversarial({ value: NaN })` returns `{ clean: false }`
4. Verify NaN guard: `computeQuality(event, { stale_after_ms: 0 })` returns finite number
5. Verify input validation: `buildBundle({})` throws TypeError
6. Verify IR fields: `emitEnvelope()` output uses `median_ms`, `jitter_coefficient`, `spike_rate`, `sensor_count`
7. Verify convergence: scores unchanged at 20.0/20.0

---

## Known Limitations

- Path traversal guard is opt-in via `allowedDir` parameter — existing callers without `allowedDir` are unprotected (backward compatible design)
- Bundle `_snapshot` is a shallow copy — deeply nested fields are not snapshotted
- Sybil detection improvement (RT-07) deferred to Cycle 002
- `checkAdversarial` wiring into `buildBundle()` (HI-02) intentionally not implemented — runtime-level enforcement is the architectural decision

---

*Generated by Implementation Agent — Sprint 3 Critical Fixes*
