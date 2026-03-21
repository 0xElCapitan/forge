# Sprint 7 — Security Audit

**Sprint**: Sprint 7 — Theatre Templates (global sprint-7)
**Date**: 2026-03-20
**Auditor**: Paranoid Cypherpunk Auditor
**Verdict**: APPROVED - LETS FUCKING GO

---

## Audit Scope

Sprint 7 delta: 6 new files under `src/theatres/`, 1 new test file. No modifications to existing files. All new files are pure computation modules.

---

## Security Checklist

### Secrets / Credentials
**PASS.** Grep for imports, credentials, and tokens across all six theatre files: zero matches. The only string literals are domain terms (`'b-value'`, `'automatic'`, `'oracle'`, `'expired'`, `'auto'`, etc.) and math constants. No API keys, tokens, env var references, or hardcoded credentials.

### Injection / Code Execution
**PASS.** No `eval()`, `new Function()`, `exec()`, `spawn()`, or dynamic code generation anywhere in the six files. All computation is arithmetic on number/string primitives from the bundle and params. There is no pathway from bundle data to code execution.

### Input Validation / Untrusted Data
**PASS.** Every `process*` function guards with `if (theatre.status !== 'open') return theatre` — cannot process a closed theatre. Key defensive patterns confirmed:

- `Array.isArray(bundle.sources)` checked before iteration in multi-input mode
- `bundle.doubt_price ?? 0` default for absent fields
- `Math.max(0, Math.min(1, probability))` clamp in threshold-gate
- `Math.max(0, 1 - sum(b0..b3))` residual guard in cascade bucket 4 — prevents float subtraction from going negative
- `baseline_values.shift()` called on a locally-spread new array, not on theatre.baseline_values — immutability preserved throughout

Note: `bundle.value` is used directly in arithmetic without type-checking. For NaN or non-numeric inputs, results would propagate NaN into `position_probability`. This is not a security vulnerability — it is the correct behaviour for an in-process computation library. Input validation at the feed boundary is Sprint 8 (processor pipeline). Callers are responsible for well-formed bundles. Documented in Known Limitations.

### Prototype Pollution
**PASS.** Zero `__proto__`, `prototype[`, or `constructor[` access. Confirmed by grep — no matches. Object spread (`{ ...theatre }`) creates clean prototype-free copies. Array spread (`[...theatre.position_history, ...]`) creates new arrays with no shared mutable state. There is no pathway from bundle data to property access on the theatre's prototype chain.

### Data Privacy / PII
**PASS.** Theatre state contains: numeric probabilities, timestamps (unix ms), distribution arrays, and domain term strings. `baseline_metric: 'b-value'` is a seismology domain constant. No user identifiers, location data, personal information, or anything resembling PII flows through any theatre.

### Math Safety
**PASS.** Specific cases verified:

| Case | Expected | Confirmed |
|------|----------|-----------|
| `poissonPmf(0, 0)` | 1 | `Math.exp(-0) = 1` ✓ |
| `poissonPmf(0, k>0)` | 0 | Early return ✓ |
| `computeStats([])` | `{mean:0, std:0}` | Early return ✓ |
| `computeStats([x])` | `{mean:x, std:0}` | `n===1` guard ✓ |
| `computeStats([x,x,...])` | std=0 | Variance=0, sqrt(0)=0 ✓ |
| `max(|a|, |b|, 1)` denominator | No div/0 | Always ≥1 ✓ |
| Cascade normalisation | Sum=1 | After blend + normalise ✓ |
| Anomaly uninformed prior | P=0.5 if n<3 or std=0 | Dual guard ✓ |

### Auth/Authz
**NOT APPLICABLE.** Pure in-process computation library. No authentication boundaries, no privilege levels, no access control surface.

### API Security
**NOT APPLICABLE.** No HTTP surface, no network I/O, no external calls.

---

## Findings

None.

---

## Notes

The position_history unbounded growth documented in Known Limitations is a memory management concern for long-running theatres, not a security issue. It is the processor pipeline's responsibility (Sprint 8) to manage theatre lifecycle and prune history when needed.

The `settlement_source` param is preserved in theatre state but not enforced here. Trust enforcement ("PurpleAir T3 must never settle") is implemented in `src/trust/oracle-trust.js` (Sprint 8). This is the correct layering — the template stores the required source, the trust module enforces it at settlement time.
