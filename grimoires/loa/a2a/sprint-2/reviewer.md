# Sprint 2 Implementation Report: SHOULD ADDRESS

**Sprint:** 2 — Tobias Review Response (SHOULD ADDRESS)
**Date:** 2026-03-30
**Status:** Complete
**Tests:** 589 passing (0 failures)

---

## Executive Summary

Sprint 2 resolves all three SHOULD ADDRESS items from Tobias's sprint-10 review. One new file created (`spec/STABILITY.md`), three files modified with code and schema changes, two fixture files updated, one test file updated with 2 new tests. All 589 tests pass.

---

## Tasks Completed

### T-R04: Document IR schema stability policy

**Files Created:**
- `spec/STABILITY.md` — Full stability policy document

**Files Modified:**
- `spec/proposal-ir.json:5` — Top-level description extended with stability policy reference

**Approach:** Created comprehensive stability policy covering versioning (SemVer), breaking change definition, notice policy (1-sprint minimum), non-breaking additions, and Cycle 002 planned fields. Referenced from the schema's top-level description.

**Acceptance Criteria:**
- [x] `spec/STABILITY.md` exists with all required sections (commitment, versioning, breaking changes, notice policy, non-breaking changes, consumer guidance)
- [x] `spec/proposal-ir.json` description references stability policy
- [x] `npm run test:all` passes (589/589)

---

### T-R05: Fix usefulness scoring inconsistency

**Files Modified:**
- `src/ir/emit.js:82-101` — Added `usefulness_score: null` to proposal annotation; when `score_usefulness=true`, sets per-proposal score and envelope-level map
- `spec/proposal-ir.json:152,204-209` — Added `usefulness_score` to `Proposal.required` array and `Proposal.properties` with type `["number", "null"]`, min 0, max 1
- `fixtures/forge-snapshots-tremor.json` — Added `usefulness_score: 0.0594` to all 5 envelope proposals
- `fixtures/forge-snapshots-breath.json` — Added `usefulness_score: 0.34520625` to the 1 envelope proposal
- `test/unit/ir.spec.js` — Added 2 new tests: per-proposal usefulness_score assertions when scored, and null assertion when not scored

**Approach:**
1. In `emitEnvelope()`, initialized each proposal with `usefulness_score: null` during the `annotated` map step
2. In the `score_usefulness` block, assigned the computed score to `annotated[i].usefulness_score` in addition to the existing envelope-level map
3. Envelope-level `usefulness_scores` map preserved for backwards compatibility
4. Updated fixtures by copying the score values from the existing envelope-level `usefulness_scores` map to each proposal object — values match exactly

**Codebase Finding (SDD Section 3.2):** Confirmed — envelope-level `usefulness_scores` map was already consistent across all 3 fixtures (TREMOR: 5 entries for 5 proposals, BREATH: 1 for 1, CORONA: 0 for 0). The fix was adding `usefulness_score` on each `proposals[i]` object.

**Acceptance Criteria:**
- [x] Every proposal object in emitted envelopes has `usefulness_score` field
- [x] `usefulness_score` is a number (0-1) when economic filter invoked, null otherwise
- [x] Envelope-level `usefulness_scores` map retained (backwards compatibility)
- [x] `spec/proposal-ir.json` marks `usefulness_score` as required at proposal level
- [x] All 3 golden envelope snapshots updated with per-proposal `usefulness_score`
- [x] IR tests updated to assert field presence (2 new tests)
- [x] `npm run test:all` passes (589/589)

---

### T-R06: Document brier_type null rejection

**Files Modified:**
- `spec/proposal-ir.json:201-203` — Extended `brier_type` description with full template→type mapping and null rejection documentation
- `test/unit/ir.spec.js` — Added validation test iterating all 6 template types, asserting non-null brier_type and correct mapping (cascade→multi_class, all others→binary)

**Approach:** Documentation-only for the schema (no structural change needed — `brier_type` already has `enum: ["binary", "multi_class"]` with no null option and is in the required array). Added comprehensive validation test covering all 6 templates.

**Codebase Finding (SDD Section 3.1):** Confirmed — no schema change needed. `brier_type` already rejects null. Task reduced to docs + test.

**Acceptance Criteria:**
- [x] `brier_type` description documents cascade→multi_class mapping and null rejection
- [x] Validation test confirms all 6 templates produce valid non-null brier_type
- [x] `npm run test:all` passes (589/589)

---

## Testing Summary

| Metric | Value |
|--------|-------|
| Total tests | 589 |
| Passing | 589 |
| Failing | 0 |
| Suites | 162 |
| Duration | 300ms |
| Command | `npm run test:all` |
| New tests | 2 (usefulness_score null check, brier_type validation for all 6 templates) |

---

## Technical Highlights

- **1 code logic change** — `src/ir/emit.js` modified to add `usefulness_score` on each proposal (4 lines added to annotation, 3 lines modified in scoring loop)
- **Backwards compatible** — envelope-level `usefulness_scores` map retained alongside per-proposal field
- **Additive schema change** — `usefulness_score` added to Proposal; no fields removed, renamed, or type-changed
- **Stability policy** — `spec/STABILITY.md` documents the contract for Echelon's 163 bridge tests
- **Test count** increased from 587 to 589 (2 new tests)

---

## Known Limitations

1. **SDD Q1 remains open:** Six additional domain claims in `construct.yaml` may need renaming to match Echelon's vocabulary. Deferred to Tobias confirmation (same as Sprint 1).
2. **Fixture values hand-edited, not pipeline-regenerated.** No snapshot generation script exists. Values were copied from the existing envelope-level `usefulness_scores` map, which is the same computation path. Deterministic `proposal_id` values unchanged (confirmed by inspection — input parameters identical).

---

## Verification Steps

```bash
# 1. Verify STABILITY.md exists
test -f spec/STABILITY.md && echo "PASS" || echo "FAIL"

# 2. Verify stability reference in proposal-ir.json
grep "STABILITY.md" spec/proposal-ir.json
# Expected: description contains "spec/STABILITY.md"

# 3. Verify usefulness_score in Proposal schema
grep '"usefulness_score"' spec/proposal-ir.json
# Expected: in required array and properties

# 4. Verify usefulness_score on proposals in emit.js
grep 'usefulness_score' src/ir/emit.js
# Expected: null initialization + score assignment

# 5. Verify fixture updates
grep 'usefulness_score' fixtures/forge-snapshots-tremor.json | wc -l
# Expected: 5 (one per proposal)

grep 'usefulness_score' fixtures/forge-snapshots-breath.json | wc -l
# Expected: 1

# 6. Verify brier_type description updated
grep -c 'cascade.*multi_class' spec/proposal-ir.json
# Expected: 1

# 7. Run tests
npm run test:all
# Expected: 589 tests, 0 failures
```

---

*Generated by Sprint Implementer Agent*
