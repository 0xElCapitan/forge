# Security Audit: sprint-pre002-local-hardening

**Auditor**: Paranoid Cypherpunk Auditor
**Sprint**: sprint-pre002-local-hardening
**Date**: 2026-04-12
**Verdict**: APPROVED - LETS FUCKING GO

---

## Audit Summary

This sprint hardens the adversarial gate against NaN/non-finite inputs and fixes a rationale string bug. Both changes improve the security posture — the guards close a fail-open path where malformed numeric inputs could bypass adversarial detection.

---

## Security Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Secrets/Credentials | PASS | No hardcoded secrets, no credential handling |
| Input Validation | PASS | Core of this sprint — `Number.isFinite` guards on all 6 checks |
| Injection | PASS | No dynamic code execution, no SQL, no HTML rendering |
| Auth/Authz | N/A | Pure function, no auth surface |
| Data Privacy | PASS | No PII, no data persistence |
| Error Handling | PASS | Fail-closed early returns, no exceptions thrown |
| Information Disclosure | PASS | Reason strings are internal debugging, not user-facing |

---

## Findings

### S-1: Template literal with untrusted value (LOW, INFORMATIONAL)

**File**: `src/trust/adversarial.js:139`
**Code**: `` `invalid_peer_value: must be finite number, got ${context.peer_values[nonFiniteIdx]}` ``

The `peer_values` array element is interpolated into the `reason` string via template literal. If the array contained an object with a custom `toString()`, that method would execute during string interpolation.

**Risk**: LOW. `peer_values` is typed as `number[]`, comes from internal context (not external user input), and the `Number.isFinite()` check correctly rejects objects before this line could be reached with a well-formed object. The `findIndex` callback runs first, and objects fail `Number.isFinite()`, so the template literal only runs for values already identified as non-finite. The interpolated value is in an error reason string, not rendered as HTML or used in queries.

**Action**: None required. Documented for awareness.

### S-2: `now` parameter not guarded by NaN check (LOW, INFORMATIONAL)

**File**: `src/trust/adversarial.js:65`
**Code**: `const { now = Date.now() } = context;`

If `context.now` is `NaN` or `Infinity`, the clock drift check (lines 103-113) would produce incorrect results: `NaN - timestamp` is `NaN`, and comparisons with `NaN` are always `false`, so both drift checks would silently pass.

**Risk**: LOW. `now` is a runtime-zone parameter per SDD §4.1, not a bundle field. The hardening scope (H-3) explicitly targets bundle fields. Promoting `now` to receipt-critical (with enforcement) is documented as a future promotion path in the hermeticity contract (sprint-pre002-hermeticity). This is by design.

**Action**: None required for this sprint. Will be addressed by `deterministic: true` gate in sprint-pre002-hermeticity.

---

## Guard Coverage Verification

Verified every numeric field in `checkAdversarial()` has a `Number.isFinite` guard:

| Check | Field(s) | Guard Present | Test Coverage |
|-------|----------|---------------|---------------|
| 1 | `channel_a` | `adversarial.js:69` | NaN, Inf, -Inf, string |
| 1 | `channel_b` | `adversarial.js:72` | NaN, Inf, string (via channel_a tests) |
| 2 | `frozen_count` | `adversarial.js:89` | NaN, Inf, -Inf, string |
| 3 | `timestamp` | `adversarial.js:100` | NaN, Inf, -Inf, string |
| 4 | `lat` | `adversarial.js:116` | NaN, Inf, -Inf, string |
| 4 | `lon` | `adversarial.js:119` | NaN, Inf |
| 5 | `peer_values[i]` | `adversarial.js:137` | NaN, Inf, -Inf, undefined |
| 6 | `value` | `adversarial.js:152` | NaN, Inf, -Inf (pre-existing) |

All guards are fail-closed (return `{ clean: false }`). No guard uses `isNaN()` (which coerces strings) — all use `Number.isFinite()` (which rejects non-numbers). Correct.

---

## Rationale Fix Verification

**File**: `src/selector/template-selector.js:146`
**Fix**: `conditions_total` replaced with `conditions_met` in rationale string numerator.
**Security impact**: None. Cosmetic correctness fix. No behavior change for fired rules (where `met === total`).

---

## Code Quality (Security-Adjacent)

- No `eval()`, `Function()`, or dynamic `import()` — verified via grep
- No prototype manipulation (`__proto__`, `Object.defineProperty`)
- No filesystem access, no network calls
- Zero dependencies — no supply chain surface
- All changes are pure-function internal logic

---

## Verdict

APPROVED - LETS FUCKING GO

The implementation correctly closes a fail-open path in adversarial detection. All numeric fields now reject NaN/Infinity/non-finite inputs before reaching arithmetic operations. The `findIndex` approach for array scanning is unambiguous. No security vulnerabilities introduced. Two informational findings documented for awareness, neither requiring action.
