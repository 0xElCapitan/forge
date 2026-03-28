# Sprint 3 Security Audit

**Sprint:** 3 — Critical Fixes
**Auditor:** Paranoid Cypherpunk Auditor
**Date:** 2026-03-27
**Verdict:** APPROVED - LETS FUCKING GO

---

## Executive Summary

Sprint 3 fixes 10 findings (1 CRITICAL, 5 HIGH, 4 MEDIUM) from Sprints 1 and 2. All fixes are sound. No new attack surfaces introduced. The critical settlement bypass (RT-01) is properly closed. Zero new dependencies. 587/587 tests pass.

Three advisory findings documented below for future hardening — none are blocking.

---

## Audit Methodology

1. Read all 8 modified source files (not just the report)
2. Traced attack chains through call paths
3. Verified agent-reported "CRITICAL" findings — 3 of 4 were false positives (see Triage below)
4. Ran full test suite: 587 pass, 0 fail
5. Checked for secrets, eval(), injection vectors

---

## Finding Triage: Agent Claims vs Reality

Several audit sub-agents flagged findings at inflated severity. Triage results:

| Agent Claim | Claimed Severity | Actual Severity | Reason |
|-------------|-----------------|-----------------|--------|
| settle() type coercion bypass (source_id: {}) | CRITICAL | **FALSE POSITIVE** | `validateSettlement({})` → `getTrustTier({})` → type guard rejects → 'unknown' → canSettle returns false. Settlement blocked by downstream validation. |
| Check 6 valueOf() bypass | CRITICAL | **FALSE POSITIVE** | `Number.isFinite()` does NOT coerce (unlike global `isFinite()`). `Number.isFinite({valueOf: () => 42})` returns `false`. Object values are correctly rejected. |
| TRUST_REGISTRY prototype pollution | CRITICAL | **LOW** | `getTrustTier('__proto__')` returns `Object.prototype` (not 'unknown'), but `canSettle(Object.prototype)` fails strict equality — no privilege escalation possible. |
| Snapshot not immutable | HIGH | **INFO** | Spread operator creates new object. `bundle.quality = 'tampered'` after ingestion does NOT affect `ingested.quality`. Snapshot fields are primitives. |
| Clock injection unsafe | HIGH | **INFO** | Clock is injected via constructor (internal API). Malicious clock is self-inflicted, not an external attack vector. |
| emit.js field names vs spec | HIGH | **NOT SPRINT 3 SCOPE** | ME-07 aligned emit.js with classifier output (correct). If proposal-ir.json expects different names, that's a pre-existing spec/code divergence — not a Sprint 3 regression. |

---

## Advisory Findings (Non-Blocking)

### A-01: NaN as stale_after_ms bypasses guard (MEDIUM)

**File:** `src/processor/quality.js:40`
**Issue:** `NaN <= 0` evaluates to `false`, so `stale_after_ms = NaN` bypasses the guard and produces NaN output.
**Attack surface:** Low — `stale_after_ms` comes from internal config, not user input.
**Recommendation:** Change guard to `if (!Number.isFinite(stale_after_ms) || stale_after_ms <= 0) return 0;`
**Disposition:** Cycle 002 hardening. Not blocking.

### A-02: getTrustTier('__proto__') returns Object.prototype (LOW)

**File:** `src/trust/oracle-trust.js:63`
**Issue:** Plain object literal lookup with `'__proto__'` key returns `Object.prototype` instead of `undefined`. The `??` operator doesn't catch it (Object.prototype is truthy).
**Attack surface:** None — downstream `canSettle()` uses strict equality, so no privilege escalation. But the return type contract (`'T0'|'T1'|'T2'|'T3'|'unknown'`) is violated.
**Recommendation:** Use `Object.hasOwn(TRUST_REGISTRY, key) ? TRUST_REGISTRY[key] : 'unknown'` or `Object.create(null)` for the registry.
**Disposition:** Cycle 002 hardening. Not blocking.

### A-03: Path traversal startsWith without separator suffix (LOW)

**File:** `src/replay/deterministic.js:93`
**Issue:** `startsWith(normalAllowed)` without appending path separator means `/tmp/safe` matches `/tmp/safeX/../../etc/passwd`.
**Attack surface:** Low — guard is opt-in, used for fixture replay only. No public API surface currently passes `allowedDir`.
**Recommendation:** Change to `!normalize(resolved).startsWith(normalAllowed + sep)` with `sep` from `node:path`.
**Disposition:** Cycle 002 hardening. Not blocking.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No hardcoded secrets | PASS | No credentials, tokens, or keys in code or tests |
| No eval/Function/dynamic code | PASS | Clean across all modified files |
| Input validation at boundaries | PASS | buildBundle validates rawEvent.value; settle validates source_id |
| Auth/authz enforcement | PASS | Settlement requires valid source_id + tier check (fail-closed) |
| No injection vectors | PASS | No string concatenation in queries; template literals in error messages only |
| Error messages safe | PASS | No user input reflected in TypeError messages |
| No new dependencies | PASS | Zero external imports added |
| Test coverage adequate | PASS | 21 new tests covering all 10 fixes |

---

## Critical Attack Chain Analysis

**Pre-Sprint 3:** RT-09 (tier spoofing in buildBundle) + RT-01 (source_id omission in settle) = complete settlement invariant bypass. A T3 source could settle a theatre.

**Post-Sprint 3:** Chain is broken at two points:
1. `settle()` requires `source_id` (fail-closed) — line 327-329
2. `validateSettlement()` checks tier via `getTrustTier()` — line 330-333
3. `canSettle()` whitelist rejects T2/T3/unknown — lines 76-78

Even if an attacker spoofs tier in buildBundle, settlement is independently gated by source_id → tier lookup → canSettle whitelist. **The invariant holds.**

---

## Verdict

All CRITICAL and HIGH findings from Sprints 1-2 are properly fixed. The settlement invariant is enforced end-to-end. No new attack surfaces. Three advisory findings documented for Cycle 002 hardening.

**APPROVED - LETS FUCKING GO**

---

*Security audit by Paranoid Cypherpunk Auditor — Sprint 3 Critical Fixes*
