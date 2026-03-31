# Sprint Plan: FORGE Tobias Review Response Sprint

**Version:** 1.0
**Date:** 2026-03-30
**Author:** Sprint Planner Agent
**PRD Reference:** grimoires/loa/prd.md
**SDD Reference:** grimoires/loa/sdd.md

---

## Executive Summary

This sprint resolves 6 items from Tobias's sprint-10 review of FORGE, split into 2 sprints: MUST FIX first (blocking integration issues), then SHOULD ADDRESS (friction reducers). No new features. All changes additive to the IR schema.

**Total Sprints:** 2
**Sprint Duration:** Variable (no hard deadlines — runs until complete or interrupted by Cycle 002 inputs)

---

## Sprint Overview

| Sprint | Theme | Key Deliverables | Dependencies |
|--------|-------|------------------|--------------|
| 1 | MUST FIX | entry_point fix, tier key docs, domain vocab fix | None |
| 2 | SHOULD ADDRESS | stability policy, usefulness scoring fix, brier_type docs | Sprint 1 stable |

---

## Sprint 1: MUST FIX

**Goal:** Resolve all three blocking integration issues so Echelon's policy normaliser and admission gate operate without errors or tier-cap penalties.

**Scope:** 3 tasks (T-R01, T-R02, T-R03) — all independent, no inter-task dependencies.

---

### Task T-R01: Fix construct.json entry_point

**Priority:** P0 — MUST FIX
**Effort:** XS
**Goals:** G-1, G-4
**File:** `spec/construct.json`

**Description:** `entry_point` and `context_files[0]` reference `BUTTERFREEZONE.md` which does not exist. Change both to `README.md`.

**Implementation:**
1. Edit `spec/construct.json` line 42: `"entry_point": "BUTTERFREEZONE.md"` → `"entry_point": "README.md"`
2. Edit `spec/construct.json` `context_files[0]`: `"BUTTERFREEZONE.md"` → `"README.md"`
3. Verify `README.md` exists at repo root
4. Run `npm run test:all` — expect ≥ 566 tests passing

**Acceptance Criteria:**
- [ ] `spec/construct.json` references `README.md` as entry_point
- [ ] `context_files[0]` updated to `README.md`
- [ ] All other construct.json fields unchanged
- [ ] `npm run test:all` passes

---

### Task T-R02: Document settlement tier key distinction

**Priority:** P0 — MUST FIX
**Effort:** XS
**Goals:** G-1, G-3, G-4
**Files:** `src/trust/oracle-trust.js`, `spec/proposal-ir.json`

**Description:** Document that FORGE's string keys ("T0"–"T3") are oracle identity tiers, orthogonal to TREMOR's numeric data maturity levels. Add the Echelon provenance mapping.

**Implementation:**
1. Add comment block above `TRUST_REGISTRY` in `src/trust/oracle-trust.js` (after line 25):
   - Document string key format and why it differs from TREMOR numeric levels
   - List Echelon provenance mapping:
     - T0 → signal_initiated (high confidence)
     - T1 → signal_initiated (Brier-discounted confidence)
     - T2 → suggestion_promoted (needs corroborating signals)
     - T3 → suggestion_unlinked (no settlement evidence, never settles)
2. Update `trust_tier` field description in `spec/proposal-ir.json` to document string format and Echelon mapping
3. Run `npm run test:all` — expect ≥ 566 tests passing

**Acceptance Criteria:**
- [ ] Comment block in `src/trust/oracle-trust.js` above tier definitions
- [ ] Echelon provenance mapping documented in source
- [ ] `spec/proposal-ir.json` trust_tier description updated
- [ ] Tier format (string keys) unchanged
- [ ] `npm run test:all` passes

---

### Task T-R03: Verify domain claim vocabulary

**Priority:** P0 — MUST FIX
**Effort:** S
**Goals:** G-1, G-3, G-4
**Files:** `spec/construct.json`, `spec/construct.yaml`

**Description:** Verify all domain claims against Echelon's v15 vocabulary. Replace `feed_characterization` with `feed_classification`. Conservative scope — only change the explicitly flagged term.

**Implementation:**
1. Edit `spec/construct.json` skills array: `"feed-characterization"` → `"feed-classification"`
2. Edit `spec/construct.yaml` domain_claims: `feed_characterization` → `feed_classification`
3. Edit `spec/construct.yaml` skill_manifest entries: `domain: feed_characterization` → `domain: feed_classification`
4. Document the change (comment or changelog note)
5. **Do NOT rename** other potential vocabulary mismatches (prediction_markets, rlmf_export, theatre_management, oracle_verification, settlement_verification, calibration_analysis) — flag for Tobias confirmation
6. Run `npm run test:all` — expect ≥ 566 tests passing

**Acceptance Criteria:**
- [ ] All `feed_characterization` references replaced with `feed_classification`
- [ ] Original and replacement documented
- [ ] Other domain claims flagged but not changed (conservative scope)
- [ ] `npm run test:all` passes

**Open Question (SDD Q1):** Should other domain claims align to Echelon vocabulary? Candidates documented in SDD Section 9. Defer to Tobias confirmation.

---

## Sprint 2: SHOULD ADDRESS

**Goal:** Establish IR schema stability commitment, fix usefulness scoring consistency across all golden envelopes, and document brier_type null rejection with validation test.

**Scope:** 3 tasks (T-R04, T-R05, T-R06). T-R05 is the largest item (code change + fixture regeneration). T-R04 and T-R06 are independent.

**Dependency:** Sprint 1 must be stable before T-R05 begins (it modifies fixtures that depend on pipeline correctness).

---

### Task T-R04: Document IR schema stability policy

**Priority:** P1 — SHOULD ADDRESS
**Effort:** XS
**Goals:** G-2, G-3, G-4
**Files:** `spec/STABILITY.md` (new), `spec/proposal-ir.json`

**Description:** Create stability policy document for the IR schema. Tobias has 163 bridge tests locked to the current schema and needs semver commitments.

**Implementation:**
1. Create `spec/STABILITY.md` documenting:
   - Current version: 0.1.0
   - Stability status: stabilising — no breaking changes without prior notice
   - Breaking change definition: removing fields, changing field types, changing required/optional status
   - Non-breaking definition: adding optional fields, adding enum values, adding optional sections
   - Notice policy: breaking changes flagged in changelog + communicated to Echelon with minimum 1-sprint notice
   - Cycle 002 additive fields: normalization_trace, negative_policy_flags, original_hash (non-breaking)
   - This sprint: `usefulness_score` added to Proposal (additive, non-breaking)
2. Add stability policy reference to `spec/proposal-ir.json` top-level description
3. Run `npm run test:all` — expect ≥ 566 tests passing

**Acceptance Criteria:**
- [ ] `spec/STABILITY.md` exists with all required sections
- [ ] `spec/proposal-ir.json` description references stability policy
- [ ] `npm run test:all` passes

---

### Task T-R05: Fix usefulness scoring inconsistency

**Priority:** P1 — SHOULD ADDRESS
**Effort:** S (largest item in sprint)
**Goals:** G-2, G-3, G-4
**Files:** `src/ir/emit.js`, `spec/proposal-ir.json`, `fixtures/forge-snapshots-tremor.json`, `fixtures/forge-snapshots-breath.json`, `fixtures/forge-snapshots-corona.json`, `test/unit/ir.spec.js`

**Description:** Add `usefulness_score` to each proposal object in the IR envelope. The envelope-level `usefulness_scores` map is already consistent — the gap is that individual proposal objects lack the field. Make it required in the schema. Regenerate all golden snapshots.

**Codebase Finding (SDD Section 3.2):** The envelope-level `usefulness_scores` map is already per-proposal across all 3 fixtures. TREMOR has 5 entries for 5 proposals, BREATH has 1 for 1, CORONA has 0 for 0. The actual fix is adding `usefulness_score` on each `proposals[i]` object.

**Implementation:**
1. In `src/ir/emit.js` `emitEnvelope()`:
   - Initialize each proposal in `annotated` array with `usefulness_score: null`
   - When `score_usefulness=true`, set `annotated[i].usefulness_score = score`
   - Envelope-level `usefulness_scores` map continues to be populated as before (backwards compat)
2. In `spec/proposal-ir.json`:
   - Add `usefulness_score` to `$defs.Proposal.properties` with type `["number", "null"]`, min 0, max 1
   - Add `"usefulness_score"` to `$defs.Proposal.required` array
3. Regenerate all 3 golden envelope snapshots by running the actual FORGE pipeline (not hand-editing)
4. Update `test/unit/ir.spec.js`:
   - Assert `usefulness_score` exists on each proposal when `score_usefulness=true`
   - Assert `usefulness_score` is `null` on each proposal when `score_usefulness=false`
5. Run `npm run test:all` — expect ≥ 566 tests passing
6. Diff old vs new fixtures to confirm only `usefulness_score` field added (no structural changes)

**Acceptance Criteria:**
- [ ] Every proposal object in emitted envelopes has `usefulness_score` field
- [ ] `usefulness_score` is a number (0-1) when economic filter invoked, null otherwise
- [ ] Envelope-level `usefulness_scores` map retained (backwards compatibility)
- [ ] `spec/proposal-ir.json` marks `usefulness_score` as required at proposal level
- [ ] All 3 golden envelope snapshots regenerated with per-proposal `usefulness_score`
- [ ] IR tests updated to assert field presence
- [ ] `npm run test:all` passes

**Key Risk:** Fixture regeneration could change `proposal_id` values. Mitigation: `proposal_id` is deterministic from `feed_id + template + params` — inputs unchanged, IDs will be identical.

---

### Task T-R06: Document brier_type null rejection

**Priority:** P1 — SHOULD ADDRESS
**Effort:** XS
**Goals:** G-2, G-3
**Files:** `spec/proposal-ir.json`, `test/unit/ir.spec.js`

**Description:** The schema already rejects null for `brier_type` (`enum: ["binary", "multi_class"]`, field is required). This task adds documentation and a validation test.

**Codebase Finding (SDD Section 3.1):** No schema change needed — `brier_type` already has no null in enum and is in the required array.

**Implementation:**
1. Update `brier_type` description in `spec/proposal-ir.json` to document:
   - Mapping: cascade → multi_class, all other templates → binary
   - Null is not valid — all proposals must have a brier_type
2. Add test in `test/unit/ir.spec.js`:
   - Iterate all 6 template types
   - For each, emit an envelope and assert `brier_type` is non-null and is one of `["binary", "multi_class"]`
   - Assert cascade produces `multi_class`, others produce `binary`
3. Run `npm run test:all` — expect ≥ 567 tests passing (1 new test)

**Acceptance Criteria:**
- [ ] `brier_type` description documents cascade→multi_class mapping
- [ ] Validation test confirms all templates produce valid non-null brier_type
- [ ] `npm run test:all` passes

---

## E2E Goal Validation

After all 6 tasks complete, validate all goals:

| Goal | Validation | Method |
|------|-----------|--------|
| G-1 | All MUST FIX items resolved | T-R01, T-R02, T-R03 committed with passing tests |
| G-2 | All SHOULD ADDRESS items resolved | T-R04, T-R05, T-R06 committed with passing tests |
| G-3 | IR compatibility preserved | Diff `spec/proposal-ir.json` — no fields removed, renamed, or type-changed |
| G-4 | Fork-syncable | No IR field removals; all changes additive |

---

## Goal Mapping

| Goal ID | Contributing Tasks | Sprint |
|---------|-------------------|--------|
| G-1 | T-R01, T-R02, T-R03 | Sprint 1 |
| G-2 | T-R04, T-R05, T-R06 | Sprint 2 |
| G-3 | T-R02, T-R03, T-R04, T-R05, T-R06 | Both |
| G-4 | T-R01, T-R02, T-R03, T-R04, T-R05 | Both |

All 4 goals have contributing tasks. No orphan tasks.

---

## Definition of Done

This sprint is complete when:

1. All three MUST FIX items (T-R01, T-R02, T-R03) are resolved and committed
2. All three SHOULD ADDRESS items (T-R04, T-R05, T-R06) are resolved and committed
3. `npm run test:all` passes with ≥ 566 tests (558 unit + 6 convergence + any new tests)
4. No IR schema fields have been removed or renamed (additive changes only)
5. Changes are ready to communicate back to Tobias so he can sync his fork

---

*Generated by Sprint Planner Agent*
