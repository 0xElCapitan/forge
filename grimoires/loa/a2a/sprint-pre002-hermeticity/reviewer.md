# Implementation Report: sprint-pre002-hermeticity

**Sprint**: sprint-pre002-hermeticity
**FR**: H-2 (Hermeticity contract)
**Date**: 2026-04-12
**Status**: COMPLETE — all 5 tasks implemented, 731 tests pass (0 fail)

---

## Executive Summary

This sprint establishes FORGE's hermeticity contract: a formal specification documenting every allowed input to the receipt-critical pipeline, a two-zone enforcement model, a `deterministic: true` validation gate, and receipt-level replay tests proving byte-identical output under fixed clocks. The sprint is validation-only — no output behavior changes.

---

## Tasks Completed

### Task 2.1: Create `spec/HERMETICITY.md`

**Files**: `spec/HERMETICITY.md` (new, 123 lines)
**Approach**: Documented the full hermeticity contract with 8 sections:

1. **Purpose** — formal backing for determinism claim
2. **Two-Zone Model** — receipt-critical (enforced, fail-closed) vs runtime (documented, injectable, promotable)
3. **Allowed Inputs** — 6 inputs enumerated: raw feed data, timestampBase, now, RULES, regulatory tables, code identity
4. **Hidden Input Risks** — all `Date.now()` locations across `src/`, categorized by zone with file:line references
5. **Enforcement** — `deterministic: true` option behavior
6. **Replay Constants** — `REPLAY_TIMESTAMP_BASE = 1700000000000`, `REPLAY_NOW = 1700000001000`
7. **Promotion Path** — 4-step promotion process for runtime → receipt-critical
8. **`computed_at` Note** — metadata-only, excluded from signed payload, not determinism-critical

Key language: *"The two-zone boundary is a current operational boundary, not a forever boundary."* (spec/HERMETICITY.md:L23)

### Task 2.2: Add `deterministic: true` validation gate

**Files**: `src/index.js:82-101`
**Approach**: Added `deterministic = false` to `analyze()` options destructuring. When `deterministic: true`, validates that both `timestampBase` and `now` are explicitly provided before pipeline execution.

```js
// src/index.js:99-101
if (deterministic && (timestampBase == null || now === undefined)) {
  throw new Error('deterministic mode requires explicit timestampBase and now');
}
```

This is validation only — no output change. It enforces that callers explicitly provide clocks rather than silently falling back to `Date.now()`.

**JSDoc**: Added `@param {boolean} [options.deterministic=false]` at line 82.

### Task 2.3: Receipt-level deterministic replay gate test

**Files**: `test/unit/determinism-gate.spec.js:211-252`
**Approach**: Two runs with fixed `timestampBase` and `now` through the full pipeline (ingest → classify → selectTemplates → emitEnvelope → buildReceipt). Canonicalizes the signed payload (excluding `computed_at`) and asserts byte-identical output via `assert.strictEqual`.

The canonicalized payload includes: `schema`, `input_hash`, `input_canonicalization`, `code_version`, `policy_hash`, `rule_set_hash`, `policy_version_tag`, `output_hash`, `http_transcript_receipts`, `signer`.

`computed_at` is correctly excluded — it uses `new Date().toISOString()` which is intentionally non-deterministic metadata (see spec/HERMETICITY.md §8).

### Task 2.4: Test `deterministic: true` enforcement

**Files**: `test/unit/determinism-gate.spec.js:254-292`
**Approach**: 4 tests covering the enforcement gate:

| Test | Condition | Expected |
|------|-----------|----------|
| 1 | `deterministic: true`, `timestampBase` missing | Throws with descriptive error |
| 2 | `deterministic: true`, `now` missing | Throws with descriptive error |
| 3 | `deterministic: true`, both missing | Throws with descriptive error |
| 4 | `deterministic: true`, both provided | Succeeds, produces envelope + proposals |

### Task 2.5: Document replay constants

**Files**: `spec/HERMETICITY.md:89-98` (Section 6)
**Approach**: Documented canonical replay injection values:

| Constant | Value | Purpose |
|----------|-------|---------|
| `REPLAY_TIMESTAMP_BASE` | `1700000000000` | Epoch-ms base for event timestamps during replay |
| `REPLAY_NOW` | `1700000001000` | Wall-clock for `emitted_at` during replay |

Cross-referenced to test constants: `FIXED_TIMESTAMP_BASE` and `FIXED_NOW` in `test/unit/determinism-gate.spec.js:32-33`.

---

## Technical Highlights

### Two-Zone Hermeticity Model

The contract distinguishes receipt-critical functions (enforced via `deterministic: true`, fail-closed) from runtime functions (documented, injectable, promotable). This reflects pragmatic reality: not every `Date.now()` needs fail-closed enforcement, but every one needs documentation and an injection path.

### Validation-Only Gate

The `deterministic: true` gate changes zero output. It ensures callers explicitly inject clocks rather than relying on `Date.now()` fallbacks. This means existing non-deterministic usage is unaffected — the gate is opt-in.

### Null vs Undefined Asymmetry

The gate checks `timestampBase == null` (catches both `null` and `undefined`) but checks `now === undefined` (allows `now: 0` which is falsy but valid). This matches the existing destructuring defaults: `timestampBase = null` vs `now = undefined`.

---

## Testing Summary

**Test file**: `test/unit/determinism-gate.spec.js`
**New tests**: 5 (1 receipt replay + 4 enforcement)
**Total in file**: 11 tests
**Full suite**: 731 pass, 0 fail

### How to run

```bash
npm run test:all                                    # Full suite
node --test test/unit/determinism-gate.spec.js      # Just this file
```

### Test scenarios

| Scenario | Type | Assertion |
|----------|------|-----------|
| Receipt replay with fixed clocks | Determinism | Byte-identical canonicalized receipts |
| `deterministic: true` + missing timestampBase | Enforcement | Throws descriptive error |
| `deterministic: true` + missing now | Enforcement | Throws descriptive error |
| `deterministic: true` + both missing | Enforcement | Throws descriptive error |
| `deterministic: true` + both provided | Enforcement | Succeeds with envelope + proposals |

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `spec/HERMETICITY.md` exists with two-zone model and allowed inputs table | DONE | spec/HERMETICITY.md §2-3 |
| `forge.analyze(fixture, { deterministic: true })` throws descriptive error | DONE | src/index.js:99-101, test L274-280 |
| `forge.analyze(fixture, { deterministic: true, timestampBase: X, now: Y })` succeeds | DONE | test L282-292 |
| Two runs with identical fixed clocks produce byte-identical canonicalized receipt | DONE | test L215-252 |
| Promotion path language explicitly states two-zone boundary is pragmatic, not permanent | DONE | spec/HERMETICITY.md:L23 |
| `npm run test:all` green | DONE | 731 pass, 0 fail |

---

## Known Limitations

1. **`computed_at` not injectable**: Intentional — it's metadata-only, excluded from signed payload. Documented in HERMETICITY.md §8 with promotion path if future requirements demand it.
2. **Live adapters not injectable**: `usgs-live.js` and `swpc-live.js` use `Date.now()` without injection. Documented in HERMETICITY.md §4 as live-only, not receipt-critical.
3. **Runtime zone not enforced**: Theatre/processor/adversarial `Date.now()` defaults are injectable but not fail-closed. This is by design — the two-zone model promotes functions to receipt-critical as needed.

---

## Verification Steps

1. Read `spec/HERMETICITY.md` — verify 8 sections, two-zone model, allowed inputs table
2. Read `src/index.js:86-101` — verify `deterministic` option and validation gate
3. Read `test/unit/determinism-gate.spec.js:211-292` — verify 5 new tests
4. Run `npm run test:all` — verify 731 pass, 0 fail
5. Grep for `REPLAY_TIMESTAMP_BASE` in spec — verify replay constants documented
