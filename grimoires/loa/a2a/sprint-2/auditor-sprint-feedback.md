# Sprint 2 Security Audit: Paranoid Cypherpunk Auditor

**Sprint:** 2 — Tobias Review Response (SHOULD ADDRESS)
**Auditor:** Paranoid Cypherpunk Auditor
**Date:** 2026-03-31
**Verdict:** APPROVED - LETS FUCKING GO

---

## Audit Summary

Sprint 2 modifies 1 code file (`src/ir/emit.js` — 7 lines changed), 1 schema file, 2 fixture files, 1 test file, and creates 1 new documentation file. The only runtime behavior change is adding a `usefulness_score` field to proposal objects — a field that is initialized to `null` and conditionally set to a number. Attack surface delta: **near-zero** (one new field on an internal data structure).

---

## Security Checklist

| Check | Result | Notes |
|-------|--------|-------|
| Hardcoded secrets | PASS | No secrets introduced. No API keys, tokens, or credentials in any changed file. |
| Input validation | PASS | `usefulness_score` is computed by existing `computeUsefulness()` — no new input paths. Schema constrains to `["number", "null"]`, min 0, max 1. |
| Injection vectors | N/A | No new string interpolation, no user input handling, no dynamic evaluation. |
| Auth/Authz changes | N/A | Trust tier logic (`canSettle()`, `getTrustTier()`) unchanged. |
| Dependency changes | PASS | Zero new dependencies. `package.json` untouched. |
| Data exposure | PASS | No PII, no credentials. `usefulness_score` is a computed economic metric (0-1 float). |
| Error handling | PASS | No new error paths. `computeUsefulness()` already handles edge cases; emit.js just assigns its return value. |
| Code execution paths | PASS | One new runtime path: `annotated[i].usefulness_score = score` inside existing `if (score_usefulness)` block. No new branches, no new async operations. |

---

## Diff Analysis

**6 files changed (1 new, 5 modified):**

1. **`spec/STABILITY.md` (NEW):** Documentation only. No code. No secrets. Describes IR stability policy — appropriate for public visibility.

2. **`src/ir/emit.js:82-103`:**
   - Line 89: Added `usefulness_score: null` to proposal annotation object literal. **Safe** — static null assignment.
   - Line 101: `annotated[i].usefulness_score = score` where `score` comes from `computeUsefulness()`. **Safe** — existing function, no new trust boundary crossed.
   - Line 102: `usefulness_scores[String(i)] = score` — pre-existing line, just reindented. **No behavior change.**

3. **`spec/proposal-ir.json`:**
   - Line 5: Description extended with STABILITY.md reference. String-only change.
   - Line 152: `usefulness_score` added to `required` array. Schema-only.
   - Lines 204-209: New `usefulness_score` property definition. Type-constrained.
   - Lines 201-202: `brier_type` description extended. String-only change.

4. **`fixtures/forge-snapshots-tremor.json`:** 5 `usefulness_score` fields added to proposal objects. Values match existing envelope-level map. No structural changes.

5. **`fixtures/forge-snapshots-breath.json`:** 1 `usefulness_score` field added. Value matches existing envelope-level map.

6. **`test/unit/ir.spec.js`:** 2 new test cases added. Tests execute `emitEnvelope()` with controlled inputs — no external calls, no file system access, no network.

---

## Adversarial Assessment

### Could these changes introduce a vulnerability?

**No.** The code change is:
- Adding a field to a data structure (`usefulness_score: null`)
- Conditionally assigning a number to that field from an existing computation

No new input paths. No new trust boundaries. No new external interactions. The `computeUsefulness()` function was already called in the pre-existing code path; the only change is that its return value is now also stored on the proposal object (it was previously only stored in the envelope-level map).

### Could the schema change cause harm?

The `usefulness_score` field is type-constrained to `["number", "null"]` with min 0, max 1. If a malicious producer tried to inject a non-numeric value, JSON Schema validation would reject it. The field cannot contain strings, objects, or arrays.

### Could STABILITY.md leak sensitive information?

No. It describes versioning policy and planned field names. No implementation details, no endpoints, no credentials.

### Trust model integrity check

The `TRUST_REGISTRY` object, `canSettle()` function, and `validateSettlement()` function are byte-identical to their pre-sprint state. The T3 settlement prohibition invariant is preserved.

---

## Test Verification

589 tests passing, 0 failures. Test suite covers:
- Per-proposal `usefulness_score` when scored (number, 0-1, matches envelope map)
- Per-proposal `usefulness_score` when not scored (null)
- All 6 template types produce valid non-null `brier_type`
- All pre-existing trust enforcement, adversarial, and IR emission tests pass

---

## Verdict

**APPROVED - LETS FUCKING GO**

Near-zero attack surface change. One runtime behavior change (assigning a computed number to a new field on an internal data object). All modifications are additive — no fields removed, no types changed, no dependencies added. Trust model invariants preserved byte-for-byte.

All sprints complete. Ready for Tobias sync.
