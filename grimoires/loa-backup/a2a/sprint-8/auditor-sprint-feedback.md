# Sprint 8 — Security Audit

**Sprint**: Sprint 8 — Processor Pipeline + Trust Model (global sprint-8)
**Date**: 2026-03-20
**Auditor**: Paranoid Cypherpunk Auditor
**Verdict**: APPROVED - LETS FUCKING GO

---

## Audit Scope

Sprint 8 delta: 6 new files — `src/processor/quality.js`, `src/processor/uncertainty.js`, `src/processor/settlement.js`, `src/processor/bundles.js`, `src/trust/oracle-trust.js`, `src/trust/adversarial.js`. 2 new test files. No modifications to existing files. All new files are pure computation modules with zero external dependencies.

---

## Security Checklist

### Secrets / Credentials
**PASS.** Grep for credentials across all six files: zero matches. The only string literals are source identifiers (`'purpleair'`, `'airnow'`, `'epa_aqs'`, etc.), trust tier labels (`'T0'`–`'T3'`), evidence class names, and reason message fragments. No API keys, tokens, passwords, env var references, or hardcoded credentials anywhere.

### Injection / Code Execution
**PASS.** No `eval()`, `new Function()`, `exec()`, `spawn()`, or dynamic code generation in any of the six files. Template literal interpolation in adversarial.js reason strings (lines 77, 111, 86, 95, 99, 124) interpolates numbers (`.toFixed(3)`, integer literals, `first`) and static constant values — no pathway from bundle data to code execution. There is no HTTP surface, no shell command execution, no file system access.

### Input Validation / Untrusted Data
**PASS.** All six processor and trust functions guard against closed/absent inputs appropriately for a pure in-process computation library. Key defensive patterns confirmed:

- `getTrustTier`: `if (!sourceId) return 'unknown'` guards null/undefined/empty before `toLowerCase()`. ✓
- `assignEvidenceClass`: `TIER_CLASS[tier] ?? 'provisional'` — unknown tier defaults to most restrictive class. ✓
- `computeQuality`: `event.timestamp ?? now` fallback, final `Math.max(0, Math.min(1, ...))` clamp ensures [0,1] output regardless of blend arithmetic. ✓
- `computeDoubtPrice`: `Math.max(0, Math.min(1, 1 - quality))` — clamped. ✓
- `checkAdversarial`: All checks are gated on `!= null` — absent fields are silently skipped, not treated as violations. ✓
- Channel A/B denominator: `Math.max(|a|, |b|, 1)` floor — div/0 impossible for zero-value channels. ✓

**NaN propagation note**: `computeQuality` with `event.timestamp = NaN` → `quality: NaN` → `doubt: NaN`. Both are produced by the clamp `Math.max(0, Math.min(1, NaN))` = NaN (IEEE 754 comparison semantics). This is the same in-process NaN propagation behavior accepted in Sprint 7 for `bundle.value`. Input validation at the feed boundary (ingester) is Sprint 9 scope. For this computation library, NaN-in → NaN-out is correct: downstream systems can detect NaN and reject the bundle. Not a security vulnerability.

**NaN timestamp in adversarial.js**: `now - NaN = NaN` → `NaN > MAX_AGE_MS` = false → clock drift check skipped. Clock drift detection is a defense-in-depth layer; the primary settlement gate (`canSettle`) is independent and unaffected. Known Limitation documented in reviewer.md.

### Prototype Pollution
**PASS.** Zero `__proto__`, `prototype[`, or `constructor[` assignments confirmed by grep — zero matches. Object spread not used in these files (all modules return primitive values or new objects built with object literals).

**`TRUST_REGISTRY` key quirk**: `TRUST_REGISTRY['__proto__']` returns the inherited prototype object rather than undefined, so `getTrustTier('__proto__')` returns `{}` (truthy) rather than `'unknown'`. The `??` nullish coalescing does not catch this. However: `canSettle({})` → `{} === 'T0'` = false → false. The critical settlement invariant is preserved for this input. Verified by probe:

```
getTrustTier('__proto__') → [Object: null prototype] {}
canSettle({}) → false  ✓
```

`JSON.parse` prototype pollution attack probe: TRUST_REGISTRY values for `'epa_aqs'` unchanged after `JSON.parse('{"__proto__":{"T0":"hacked"}}')`. TRUST_REGISTRY is a module-level const initialized at import time — runtime prototype manipulation cannot affect its already-assigned key/value pairs. ✓

Fix note (Low priority): Using `Object.create(null)` for the registry dict would eliminate the `'__proto__'` key quirk entirely. Not required for approval since the invariant holds.

### Data Privacy / PII
**PASS.** Data flowing through these modules: numeric quality/doubt scores, string tier/class labels, source identifiers (system names like `'purpleair'`), and numeric sensor coordinates (public IoT sensor GPS positions, not personal addresses). `validateSettlement` reason string includes sourceId — a system identifier, not personal data. No user identifiers, no email addresses, no names, no location data traceable to individuals.

### Math Safety
**PASS.** Specific cases verified:

| Case | Expected | Confirmed |
|------|----------|-----------|
| `computeDoubtPrice(1.0)` | 0.0 | `1 - 1.0 = 0, clamped` ✓ |
| `computeDoubtPrice(0.0)` | 1.0 | `1 - 0 = 1, clamped` ✓ |
| `checkChannelConsistency(0, 0)` | divergence=0 | `0/1 = 0` ✓ |
| `frozen_count = Infinity` | flagged | `Infinity >= 5 = true` ✓ |
| `frozen_count = -1` | clean | `-1 >= 5 = false` ✓ |
| T0 fresh quality | 1.0 | `0.8*1.0 + 0.2*1.0 = 1.0` ✓ |
| Stale T1 quality (3h, 1h threshold) | ~0.72 | `0.8*0.9 + 0.2*0 = 0.72` ✓ |

### Auth/Authz — Critical Invariant
**PASS.** The critical invariant is structurally enforced:

```
getTrustTier('purpleair') === 'T3'       ✓
canSettle('T3') === false                ✓  (one boolean expression, no branches)
validateSettlement('purpleair').allowed === false  ✓
```

Verified by running all trust unit tests (43/43 pass) including the explicitly-named critical invariant test at `trust.spec.js:55`.

There is no code path in the six Sprint 8 files — or anywhere reachable from them — that allows a T3 source to settle a theatre. `canSettle` is a single `||`-expression: `tier === 'T0' || tier === 'T1'`. Any input not strictly equal to the string `'T0'` or `'T1'` returns false. This includes the `'__proto__'` object probe, `null`, `undefined`, `'T3'`, and all unknown tiers.

### API Security
**NOT APPLICABLE.** Pure in-process computation library. No HTTP surface, no network I/O, no external calls.

---

## Findings

None.

---

## Notes

Two Known Limitations documented in reviewer.md are confirmed accurate and not security vulnerabilities:

1. **TRUST_REGISTRY `'__proto__'` key quirk**: `canSettle` returns false for the prototype object, so the invariant holds. Low-priority fix: `Object.create(null)` for the registry. Not a blocker.

2. **NaN timestamp bypasses clock drift check**: Clock drift is defense-in-depth; the settlement gate is independent. Same category as the Sprint 7 NaN propagation finding. Input validation at feed boundary is Sprint 9 scope. Not a blocker.

77 new tests (34 processor + 43 trust), 459 total unit tests, 6 convergence tests — all pass. Zero security regressions from prior sprints.
