# Implementation Report: sprint-pre002-contract-tests

**Sprint**: sprint-pre002-contract-tests
**Cycle**: pre-002
**FR**: H-5 (Docs/code contract verification)
**Date**: 2026-04-12

---

## Executive Summary

Sprint-pre002-contract-tests completes the Pre-002 Hardening cycle. Four tasks deliver schema validation tests, doc count updates, learnings entries, and end-to-end goal validation. Additionally, all 5 non-blocking review concerns and 1 audit concern from sprint-pre002-attestation were addressed.

**Result**: 750 tests passing (up from 699 at cycle start), all 5 PRD goals (G-1 through G-5) validated, zero failures.

---

## Tasks Completed

### Task 4.1: Add schema validation tests

**File**: `test/unit/schema-validation.spec.js` (new, 225 lines)
**Tests**: 7

Created a lightweight JSON Schema validator (`validateAgainstSchema`) that checks:
- Required fields
- Const values
- Type checks (including JSON Schema `integer` mapping to JS `Number.isInteger`)
- Pattern constraints
- Nested object recursion
- `additionalProperties: false` enforcement

Test cases:
1. `emitEnvelope()` output validates against `spec/proposal-ir.json`
2. `buildReceipt()` output validates against `spec/receipt-v0.json`
3. Receipt has no additional properties at any nesting level (root, subject, materials, policy, builder)
4. `toInTotoStatement(null)` throws TypeError
5. `toInTotoStatement({ materials, builder })` (missing subject) throws TypeError
6. `toInTotoStatement({ subject, builder })` (missing materials) throws TypeError
7. `toInTotoStatement({ subject, materials })` (missing builder) throws TypeError

**Bugs found and fixed during implementation**:
- `integer` type: JSON Schema `"type": "integer"` doesn't map to JS `typeof` (always `"number"`). Added `Number.isInteger()` check.
- `undefined` handling: Envelope sets `source_metadata` key with value `undefined`. `key in obj` returns `true` but value is undefined. Added `obj[key] === undefined` skip.

### Task 4.2: Update docs with final counts

**Files**: `README.md`, `BUTTERFREEZONE.md`

| Location | Old Value | New Value |
|----------|-----------|-----------|
| README.md:9 | 699 tests | 750 tests |
| README.md:104 | 684 tests | 735 tests |
| README.md:110 | 699 tests | 750 tests |
| BUTTERFREEZONE.md:351 | 23 files, 684 tests | 26 files, 735 tests |
| BUTTERFREEZONE.md:359 | 684 unit, 699 total | 735 unit, 750 total |
| BUTTERFREEZONE.md:365 | pass 684 | pass 735 |
| BUTTERFREEZONE.md:385 | 684 tests | 735 tests |
| BUTTERFREEZONE.md:425 | 699-tests | 750-tests |

### Task 4.3: Append learnings log entries

**File**: `grimoires/loa/context/FORGE/FORGE_LEARNINGS_updated2.md`

Appended 3 dated entries (preserved existing log format):
1. `[2026-04-12] TECHNICAL: SLSA/in-toto lesson borrowed` — attestation field discipline
2. `[2026-04-12] TECHNICAL: Bazel/Nix lesson borrowed` — hermeticity contract
3. `[2026-04-12] TECHNICAL: Pre-002 discipline sets up 002` — receipt shape cleanup

### Task 4.E2E: End-to-end goal validation

All 5 PRD goals validated:

| Goal | Validation | Result |
|------|-----------|--------|
| G-1 | `toInTotoStatement(buildReceipt(...))` produces valid in-toto v1: correct `_type`, subject array with bare hex digest, predicateType, materials array, builder.id | PASS |
| G-2 | `spec/HERMETICITY.md` exists; determinism gate tests pass (11/11); replay identical | PASS |
| G-3 | `npm run test:all` = 750; README = 750; BUTTERFREEZONE = 750; schema-validation tests pass (7/7) | PASS |
| G-4 | All 6 adversarial checks reject NaN, Infinity, -Infinity (checks 1-5 via bundle/context) | PASS |
| G-5 | Rationale strings show `conditions_met/conditions_total` (sample: "3/3 conditions") | PASS |

---

## Review/Audit Concerns Addressed

### From engineer-feedback.md (5 non-blocking concerns)

| # | Concern | Fix |
|---|---------|-----|
| 1 | `builder.uri` missing from `spec/receipt-v0.json` required array | Added `"uri"` to `builder.required` in `spec/receipt-v0.json` |
| 2 | `toInTotoStatement` should validate input | Added guard clause throwing TypeError for null/missing subject/materials/builder |
| 3 | `sign.spec.js:19` has stale flat payload | Changed `{ schema: 'forge-receipt/v0', input_hash: 'sha256:abc123' }` to `{ schema: 'forge-receipt/v0', subject: { digest: 'sha256:abc123' } }` |
| 4 | `emit.js:75` JSDoc mentions old field name | Changed "receipt input_hash" to "receipt materials.digest" |
| 5 | `echelon-integration.md:37` references `receipt.output_hash` | Changed to `receipt.subject.digest`; added clarification at L95 about diagnostic labels |

### From auditor-sprint-feedback.md (1 concern)

| # | Concern | Fix |
|---|---------|-----|
| 1 | `docs/retention-policy.md:44,46` references old flat fields | Changed `input_hash` to `materials.digest`, `output_hash` to `subject.digest` |

---

## Testing Summary

| Test File | Tests | Status |
|-----------|-------|--------|
| `test/unit/schema-validation.spec.js` | 7 | PASS |
| `test/unit/receipt-builder.spec.js` | (existing) | PASS |
| `test/unit/to-intoto.spec.js` | (existing) | PASS |
| `test/unit/sign.spec.js` | (existing, fixed) | PASS |
| `test/unit/determinism-gate.spec.js` | 11 | PASS |
| **Total unit** | **735** | **PASS** |
| **Total (unit + convergence + integration)** | **750** | **PASS** |

```bash
node --test test/unit/*.spec.js test/convergence/*.spec.js test/integration/*.spec.js
# i tests 750
# i pass 750
# i fail 0
```

---

## Known Limitations

1. The lightweight JSON Schema validator in `schema-validation.spec.js` does not implement full JSON Schema (no `$ref`, `oneOf`, `allOf`, `if/then/else`). It is sufficient for the contract tests here.
2. Receipt shape documentation in `echelon-integration.md` now shows updated field paths but the code examples are illustrative, not tested.

---

## Verification Steps

```bash
# Run all tests
node --test test/unit/*.spec.js test/convergence/*.spec.js test/integration/*.spec.js

# Run schema validation tests specifically
node --test test/unit/schema-validation.spec.js

# Verify doc counts match
grep -c "750" README.md        # Should find matches
grep -c "735" README.md        # Should find matches
grep "684\|699" README.md      # Should find NO matches
```
