# Security Audit: sprint-pre002-hermeticity

**Auditor**: Paranoid Cypherpunk Auditor
**Date**: 2026-04-12
**Verdict**: APPROVED - LETS FUCKING GO

---

## Pre-flight Verification

| Check | Status |
|-------|--------|
| Sprint directory exists | PASS |
| `reviewer.md` present | PASS |
| `engineer-feedback.md` contains "All good" | PASS |
| No `COMPLETED` marker pre-existing | PASS |
| `npm run test:all` — 731 pass, 0 fail | PASS |

---

## Security Checklist

### 1. Secrets / Credentials

**Verdict**: CLEAN

No hardcoded secrets introduced. The `sign.js` module reads `FORGE_SIGNING_KEY` from `process.env` but this is pre-existing (not touched by this sprint). The `REPLAY_TIMESTAMP_BASE` and `REPLAY_NOW` constants are intentionally public replay values — they contain no secret material. They are canonical verifier constants analogous to a well-known test vector. Safe to document.

### 2. Input Validation — `deterministic: true` Gate

**Verdict**: SOUND

The gate at `src/index.js:99-101`:

```js
if (deterministic && (timestampBase == null || now === undefined)) {
  throw new Error('deterministic mode requires explicit timestampBase and now');
}
```

**Verified properties**:
- **Fail-closed**: When `deterministic: true`, pipeline CANNOT proceed without both clocks. The throw occurs before any pipeline execution (before `ingest`, `classify`, or `emitEnvelope`).
- **Operator correctness**: `timestampBase == null` catches both `null` (default) and `undefined`. `now === undefined` catches `undefined` (default) but allows `0` (falsy but valid epoch). This is correct — `timestampBase` defaults to `null` in destructuring, `now` defaults to `undefined`. The asymmetry is intentional and well-documented.
- **No bypass via type coercion**: `deterministic` uses truthiness (`if (deterministic && ...)`), which means only explicit `true` or truthy values activate the gate. Passing `deterministic: 0`, `deterministic: false`, `deterministic: null`, or omitting it entirely all skip the gate. This is the correct opt-in behavior.
- **Validation-only**: The gate adds zero code paths to the pipeline. It is pure pre-condition checking.

### 3. Gate Bypass via Granular Exports

**Verdict**: ACKNOWLEDGED RISK — ACCEPTABLE FOR v0

The granular exports at `src/index.js:186-241` export `ingest`, `classify`, `selectTemplates`, `emitEnvelope`, and other pipeline functions. A caller can compose:

```js
import { ingest, classify, selectTemplates, emitEnvelope } from 'forge';
// No deterministic gate — Date.now() fallbacks are silently used
```

Critically, `buildReceipt` is NOT directly exported from `src/index.js`. It is only reachable through `emitEnvelope({ receipt: true, ... })`. However, `emitEnvelope` IS exported, and it defaults `now = Date.now()` in its own parameter destructuring (`src/ir/emit.js:89`). So a caller can produce a non-deterministic receipt via:

```js
emitEnvelope({ ..., receipt: true, rawInput })  // now defaults to Date.now()
```

This bypass is:
- **Documented**: HERMETICITY.md section 5 explicitly scopes enforcement to `ForgeConstruct.analyze()`.
- **Acknowledged by reviewer**: Engineer feedback concern #2 identifies this exact path.
- **Mitigated by design**: The two-zone model explicitly treats this as acceptable for v0. The promotion path (section 7) defines how to extend enforcement.

No action required for this sprint. The risk is documented, acknowledged, and has a defined promotion path.

### 4. Injection Attacks

**Verdict**: CLEAN

No dynamic code execution (`eval`, `Function`, `import()`) introduced. No SQL. No HTML rendering. No template interpolation with user input. The error message is a static string literal — no user input is interpolated into it.

### 5. Error Message Information Disclosure

**Verdict**: CLEAN

The error message `'deterministic mode requires explicit timestampBase and now'` discloses:
- That a `deterministic` mode exists
- That it requires `timestampBase` and `now`

This is acceptable. These are documented public API parameters (JSDoc at line 82). The error reveals no internal state, no file paths, no version information, and no stack traces beyond what Node.js provides by default. An attacker gains nothing exploitable from this message.

### 6. `computed_at` Exclusion from Signed Payload

**Verdict**: CORRECT

Verified at `src/receipt/receipt-builder.js:67-78`: the signed payload object is constructed by explicitly including only these fields: `schema`, `input_hash`, `input_canonicalization`, `code_version`, `policy_hash`, `rule_set_hash`, `policy_version_tag`, `output_hash`, `http_transcript_receipts`, `signer`.

`computed_at` appears in the receipt object (line 57) but is explicitly excluded from the signed payload construction (line 67-78). This is allowlist construction (not denylist) — new fields added to the receipt object will NOT automatically enter the signed payload. This is the correct security posture.

The test at `determinism-gate.spec.js:233-244` independently constructs the same field set for canonicalization, confirming the test is testing the actual signed payload contract.

### 7. HERMETICITY.md Attack Surface

**Verdict**: ACCEPTABLE

The document exposes:
- File paths and line numbers of `Date.now()` usage across the codebase
- The two-zone model distinguishing enforced vs. non-enforced paths
- Replay constants

**Assessment**: This information is useful to an attacker who has source access — but if they have source access, they can `grep` for `Date.now()` themselves. The document does not expose anything beyond what the source code already reveals. The replay constants are intentionally public (verifier constants). The two-zone model documentation actually IMPROVES security by making the enforcement boundary explicit rather than implicit.

### 8. Null/Undefined Asymmetry

**Verdict**: NOT A SECURITY CONCERN

The `timestampBase == null` (loose equality) vs `now === undefined` (strict equality) difference is:
- Matched to destructuring defaults (`timestampBase = null` vs `now = undefined`)
- Both correctly allow `0` as a valid value (important: epoch 0 is falsy but valid)
- Neither creates a bypass path — in both cases, the default value triggers the gate correctly

The only scenario where asymmetry matters is `timestampBase: undefined` — this passes the `== null` check (since `undefined == null` is true in JS). This is the CORRECT behavior: an explicitly-passed `undefined` should be treated as "not provided."

### 9. Pre-existing Observations (NOT in sprint scope)

For completeness, the `sign.js` module at `src/receipt/sign.js:26,49` reads `FORGE_SIGNING_KEY` and `FORGE_KEY_ID` from `process.env`. The error at line 38 includes `e.message` from a crypto error, which could theoretically leak key format details. These are pre-existing, not introduced by this sprint, and are out of scope. Noting for future audit.

---

## Acceptance Criteria Cross-Check

| Criterion | Verified |
|-----------|----------|
| `spec/HERMETICITY.md` exists with two-zone model and allowed inputs table | YES — 8 sections, tables in sections 2-4 |
| `forge.analyze(fixture, { deterministic: true })` throws descriptive error | YES — `src/index.js:99-101`, tested at L258-280 |
| `forge.analyze(fixture, { deterministic: true, timestampBase: X, now: Y })` succeeds | YES — tested at L282-292 |
| Two runs with identical fixed clocks produce byte-identical canonicalized receipt | YES — tested at L215-252 |
| Promotion path language explicitly states two-zone boundary is pragmatic | YES — `spec/HERMETICITY.md:23` |
| `npm run test:all` green | YES — 731 pass, 0 fail |

---

## Summary

This sprint is clean. The implementation is minimal (3 lines of validation code), the spec is thorough (123 lines documenting every clock injection point), and the tests are correct (5 new tests covering both replay and enforcement). The known risk (gate bypass via granular exports) is documented, acknowledged by the engineer, and has a defined promotion path. No secrets, no injection vectors, no information disclosure, no auth issues. The `computed_at` exclusion uses allowlist construction, which is the right pattern for signed payloads.

The null/undefined asymmetry is not a bug — it is a deliberate match to the destructuring defaults and is the most defensible choice given JavaScript's type semantics.

**Verdict: APPROVED - LETS FUCKING GO**
