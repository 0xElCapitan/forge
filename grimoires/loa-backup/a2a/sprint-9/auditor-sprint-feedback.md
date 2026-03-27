# Sprint 9 — Security Audit

**Verdict**: APPROVED - LETS FUCKING GO

**Auditor**: Paranoid Cypherpunk Auditor
**Date**: 2026-03-20
**Sprint**: sprint-9 (global 9)

---

## Audit Scope

Four modules: `src/rlmf/certificates.js`, `src/filter/usefulness.js`, `src/composer/compose.js`, `src/index.js`.

Probes executed: prototype pollution, NaN propagation, out-of-range inputs, mutation safety, reference sharing, path traversal, constructor injection.

---

## Security Checklist

| Category | Result |
|----------|--------|
| Hardcoded secrets / credentials | ✅ None |
| Injection vulnerabilities | ✅ None |
| Auth/authz bypass | ✅ N/A (library, no network surface) |
| PII exposure | ✅ None |
| API security | ✅ N/A |
| Prototype pollution | ✅ Object prototype unpolluted |
| Input mutation | ✅ `exportCertificate` does not mutate input theatre |
| `getCertificates()` isolation | ✅ Returns defensive copy — external mutation cannot affect internal state |

---

## Findings

### LOW: `__proto__` key in lookup tables produces NaN (pre-existing pattern)

**Affected**: `src/filter/usefulness.js` — `DENSITY_IMPACT`, `THRESHOLD_RELEVANCE`, `CADENCE_PREDICTABILITY`, `TIER_ACTIONABILITY`.

**Reproduction**:
```js
computeUsefulness({}, { density: { classification: '__proto__' } }, { source_tier: 'T1' })
// → NaN (not 0 or 1)
```

`DENSITY_IMPACT['__proto__']` returns `Object.prototype` (an object, not a number). Nullish coalescing `??` does not catch it (only catches null/undefined). Arithmetic on an object produces NaN, which propagates through the formula. `Math.max(0, Math.min(1, NaN))` = NaN.

**Context**: This is the same `__proto__` key family documented in Sprint 8 for `oracle-trust.js`. The library has no network-facing surface — classification strings come from internal classifier output, not untrusted user input. Object prototype is not mutated. No security breach; caller receives NaN rather than a bounded score.

**Mitigation**: Same remediation path as Sprint 8 — `Object.create(null)` for lookup tables or `Object.hasOwn()` guard. Deferred to post-Loop 5 hardening (no regression, no new attack surface introduced in this sprint).

---

### LOW: `position_history` and `params` in certificates are shared references

**Affected**: `src/rlmf/certificates.js:113–124` — `exportCertificate`.

**Reproduction**:
```js
const cert = exportCertificate(theatre);
cert.position_history.push({ injected: true });
// theatre.position_history now has length 2 — same reference
```

`position_history: theatre.position_history ?? []` passes the array reference directly. Same for `params`. Caller mutation of certificate fields mutates the source theatre object.

**Context**: RLMF certificates are intended as export snapshots for downstream training pipelines. In practice, certs are consumed read-only by serializers. This is not an active exploitation path. `getCertificates()` correctly returns a defensive *array* copy (the outer container), but individual certificate field objects are not deep-copied. Consistent with TREMOR/CORONA/BREATH certificate design.

**Recommendation**: Document in JSDoc that `cert.position_history` is a reference (callers should not mutate). Low urgency — library context.

---

### INFO: `brierScoreBinary` does not clamp probability input

**Observation**: `brierScoreBinary(true, 2.0)` = 1, `brierScoreBinary(false, -0.5)` = 0.25. Out-of-range probabilities produce mathematically valid outputs (the formula `(p - o)²` is defined for all reals). No overflow, no NaN.

**Assessment**: Not a bug. The Brier formula is correct. Callers supplying out-of-range probabilities get sensible (if unusual) scores. No action needed.

---

### INFO: `detectCausalOrdering` with NaN timestamps produces `lag_ms: NaN`

**Observation**: When event timestamps are NaN, mean diff is NaN. `Math.round(Math.abs(NaN))` = NaN. JSON serialization converts NaN to `null`. Result: `{ leader: 'A', lag_ms: NaN }` (appears as `null` in JSON payloads).

**Assessment**: Edge case with no current exploitation path. Callers passing NaN timestamps are misusing the API — upstream ingestion ensures numeric timestamps. No action needed.

---

## Summary

No CRITICAL or HIGH findings. Two LOW observations (both pre-existing design patterns with no new attack surface introduced in Sprint 9). Two INFO observations (no action needed).

The implementation is secure for its intended use case: an internal library consumed by trusted callers with no direct network exposure.

APPROVED - LETS FUCKING GO
