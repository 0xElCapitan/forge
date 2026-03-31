# Product Requirements Document: FORGE Tobias Review Response Sprint

**Version:** 1.0
**Date:** 2026-03-30
**Author:** PRD Architect Agent
**Status:** Draft
**Cycle:** tobias-review

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Goals & Success Metrics](#goals--success-metrics)
4. [User Personas & Use Cases](#user-personas--use-cases)
5. [Functional Requirements](#functional-requirements)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Technical Considerations](#technical-considerations)
8. [Scope & Prioritization](#scope--prioritization)
9. [Success Criteria](#success-criteria)
10. [Risks & Mitigation](#risks--mitigation)
11. [Timeline & Milestones](#timeline--milestones)
12. [Appendix](#appendix)

---

## Executive Summary

Tobias (Echelon) ran a sprint-10 review of FORGE from his fork at AITOBIAS04/echelon-core. He identified three MUST FIX items and three SHOULD ADDRESS items. This sprint resolves all six before Cycle 002 begins.

FORGE Cycle 001 is complete: 12 sprints, 20.5/20.5 convergence score, 566 tests passing, zero external dependencies. The classification engine, selector, theatre templates, trust model, and RLMF pipeline are all implemented and validated. The IR design is correct — six divergences found in Tobias's review were all bridge updates on his side, zero design disagreements.

This sprint is integration hygiene: fix broken references, document undocumented mappings, make scoring consistent, and add stability commitments. No new features. No new architecture. Clear the friction so Tobias can sync his fork and Cycle 002 starts clean.

> Sources: FORGE_REVIEW_SPRINT.md:1-11, FORGE_LEARNINGS_updated2.md:45, Phase 1 confirmation

---

## Problem Statement

### The Problem

Tobias's sprint-10 review identified six items that will cause friction at Echelon's integration boundary. Three are blocking (MUST FIX) — they break Echelon's policy normaliser or cause tier-cap penalties. Three are non-blocking but create integration friction (SHOULD ADDRESS) — inconsistent scoring, undocumented schema policies, and schema drift between forks.

> Sources: FORGE_REVIEW_SPRINT.md:3-5

### Integration Pain Points

- `spec/construct.json` references `BUTTERFREEZONE.md` as entry_point — file does not exist, breaks Echelon's policy normaliser
- Settlement tier key format (string vs numeric) is undocumented — causes confusion at admission gate mapping
- Domain claim vocabulary may not match Echelon's taxonomy — wrong vocabulary = tier-cap penalties on calibration certificate
- IR schema has no stability commitment — Tobias's 163 bridge tests have no guarantee against breaking changes
- Usefulness scores are inconsistent across golden envelopes — DEPTH has per-proposal, BREATH has envelope-level, CORONA has none
- `brier_type: null` is rejected on master but Tobias's fork still allows it — undocumented schema drift

> Sources: FORGE_REVIEW_SPRINT.md:17-186

### Current State

- FORGE Cycle 001 complete: 25K LOC, 30 source files, 566 tests, zero drift between code and documentation
- Tobias's fork is 3 commits behind master with 163 bridge tests locked to the current IR contract
- Six review items identified, none addressed yet

> Sources: FORGE_REVIEW_SPRINT.md:7-8, project-description.md:8

### Desired State

- All six review items resolved and committed
- Tobias can sync his fork without conflict
- IR schema extended (not broken) with consistent scoring and documented stability policy
- FORGE ready to begin Cycle 002 against a clean baseline on both sides

> Sources: FORGE_REVIEW_SPRINT.md:190-199, Phase 1 confirmation

---

## Goals & Success Metrics

### Primary Goals

| ID | Goal | Measurement | Validation Method |
|----|------|-------------|-------------------|
| G-1 | Resolve all MUST FIX items | T-R01, T-R02, T-R03 committed with passing tests | `npm run test:all` ≥ 566 tests |
| G-2 | Resolve all SHOULD ADDRESS items | T-R04, T-R05, T-R06 committed with passing tests | `npm run test:all` ≥ 566 tests |
| G-3 | Preserve IR compatibility | No fields removed, renamed, or type-changed | Diff review of `spec/proposal-ir.json` — additive only |
| G-4 | Enable fork sync | Changes mergeable into Tobias's fork without conflict | No IR field removals; additive changes only |

> Sources: FORGE_REVIEW_SPRINT.md:190-199, Phase 2 confirmation

### Key Performance Indicators (KPIs)

| Metric | Current Baseline | Target | Goal ID |
|--------|------------------|--------|---------|
| Test count | 566 (558 unit + 6 convergence + 2 IR) | ≥ 566 (may add new tests) | G-1, G-2 |
| IR schema fields removed | 0 | 0 | G-3 |
| Golden envelopes with per-proposal usefulness | 1/3 (TREMOR only) | 3/3 | G-2 |
| construct.json valid entry_point | No (BUTTERFREEZONE.md missing) | Yes (README.md exists) | G-1 |

### Constraints

- Zero external runtime dependencies — Node.js 20+ built-ins only
- Deterministic output — same input, same output, every time
- IR schema is the integration boundary — additive changes only, no breaking changes without notice
- All existing 566 tests must remain passing after every task
- String tier keys ("T0"–"T3") must not change format — document, don't redesign

> Sources: FORGE_REVIEW_SPRINT.md:8,11, project-description.md:52-56, FORGE_REVIEW_SPRINT.md:51-52

---

## User Personas & Use Cases

### Persona 1: FORGE Maintainer (el capitan)

**Role:** FORGE owner and sole maintainer
**Goals:** Clear Tobias's review findings, maintain test health, prepare clean baseline for Cycle 002
**Context:** Has full codebase access and architectural authority

### Persona 2: Tobias (Echelon Integration Consumer)

**Role:** Echelon developer, FORGE fork maintainer at AITOBIAS04/echelon-core
**Goals:** Sync his fork cleanly, have stable IR contract for his 163 bridge tests, get accurate calibration certificates from Echelon's policy normaliser
**Context:** 3 commits behind master, runs sprint-level reviews against FORGE output

> Sources: FORGE_LEARNINGS_updated2.md:107, FORGE_THESIS_updated.md:126, Phase 3 confirmation

### Use Cases

#### UC-1: Fork Sync After Review Sprint

**Actor:** Tobias
**Preconditions:** All 6 review items resolved, tests passing
**Flow:**
1. Tobias pulls upstream changes from FORGE master
2. Merges into his fork without conflict
3. Runs his 163 bridge tests against updated IR
4. All bridge tests pass (additive changes only)

**Postconditions:** Fork is synced, bridge tests pass, Echelon can proceed to Cycle 002 integration
**Acceptance Criteria:**
- [ ] No IR fields removed or renamed
- [ ] Per-proposal `usefulness_score` field name matches existing convention
- [ ] `construct.json` entry_point resolves to an existing file

#### UC-2: Echelon Certificate Issuance

**Actor:** Echelon's policy normaliser (automated)
**Preconditions:** construct.json fixed, domain claims match vocabulary
**Flow:**
1. Policy normaliser reads `spec/construct.json`
2. Resolves `entry_point` to `README.md` (exists)
3. Validates domain claims against Echelon v15 vocabulary
4. Issues calibration certificate without tier-cap penalties

**Postconditions:** FORGE receives correct calibration certificate tier
**Acceptance Criteria:**
- [ ] `entry_point` references existing file
- [ ] All domain claims use Echelon-recognised vocabulary

---

## Functional Requirements

### FR-01: Fix construct.json entry_point (T-R01)

**Priority:** P0 — MUST FIX
**Effort:** XS
**Description:** `spec/construct.json` has `entry_point` and `context_files[0]` referencing `BUTTERFREEZONE.md`. That file does not exist. This breaks Echelon's policy normaliser. Change both to `README.md`.

**Acceptance Criteria:**
- [ ] `spec/construct.json` references `README.md` as entry_point
- [ ] `context_files[0]` updated to `README.md`
- [ ] All other construct.json fields unchanged
- [ ] `npm run test:all` passes

**Dependencies:** None

> Sources: FORGE_REVIEW_SPRINT.md:17-32

---

### FR-02: Document settlement tier key distinction (T-R02)

**Priority:** P0 — MUST FIX
**Effort:** XS
**Description:** FORGE uses string keys ("T0"–"T3") for oracle identity tiers. TREMOR uses numeric tier keys for data maturity levels. These are orthogonal concepts but the inconsistency causes friction at Echelon's admission gate. Do NOT change the key format — document the distinction and add the Echelon provenance mapping.

**Acceptance Criteria:**
- [ ] Comment block in `src/trust/oracle-trust.js` above tier definitions documenting string key format and why it differs from TREMOR numeric levels
- [ ] Echelon provenance mapping documented as constant or comment: T0→signal_initiated (high confidence), T1→signal_initiated (Brier-discounted), T2→suggestion_promoted, T3→suggestion_unlinked
- [ ] Note in `spec/proposal-ir.json` under trust_tier field documenting string format and Echelon mapping
- [ ] Tier format (string keys) is unchanged
- [ ] `npm run test:all` passes

**Dependencies:** None

> Sources: FORGE_REVIEW_SPRINT.md:37-69

---

### FR-03: Verify domain claim vocabulary (T-R03)

**Priority:** P0 — MUST FIX
**Effort:** S
**Description:** `spec/construct.json` includes domain claims that must match Echelon's v15 construct class taxonomy. Echelon recognises check families: `settlement_accuracy`, `functional_correctness`, `oracle_consistency`, `calibration_validity`. Broader vocabulary: `feed_classification`, `oracle_trust`, `market_proposal`, `evidence_bundle`, `rlmf_certificate`, `theatre_lifecycle`. If `feed_characterization` is not in Echelon's vocabulary, replace with `feed_classification`.

**Acceptance Criteria:**
- [ ] All domain claims in construct.json verified against Echelon's v15 vocabulary
- [ ] `feed_characterization` replaced with `feed_classification` if mismatched
- [ ] Original and replacement documented (comment or changelog note)
- [ ] `npm run test:all` passes

**Dependencies:** None

> Sources: FORGE_REVIEW_SPRINT.md:73-98

---

### FR-04: Document IR schema stability policy (T-R04)

**Priority:** P1 — SHOULD ADDRESS
**Effort:** XS
**Description:** `spec/proposal-ir.json` is at version 0.1.0 with no documented stability commitment or semver policy. Tobias has 163 bridge tests locked to the current schema. Add a `spec/STABILITY.md` documenting version policy, breaking/non-breaking change definitions, and notice commitment.

**Acceptance Criteria:**
- [ ] `spec/STABILITY.md` exists documenting:
  - Current version: 0.1.0
  - Stability status: stabilising — no breaking changes without prior notice
  - Breaking change definition: removing fields, changing field types, changing required/optional status
  - Non-breaking definition: adding optional fields, adding enum values, adding optional sections
  - Notice policy: breaking changes flagged in changelog + communicated to Echelon with minimum 1-sprint notice
  - Cycle 002 additive fields (normalization_trace, negative_policy_flags, original_hash) are non-breaking
- [ ] `spec/proposal-ir.json` header/description references the stability policy

**Dependencies:** None

> Sources: FORGE_REVIEW_SPRINT.md:104-128

---

### FR-05: Fix usefulness scoring inconsistency (T-R05)

**Priority:** P1 — SHOULD ADDRESS
**Effort:** S (largest item in sprint)
**Description:** Usefulness scores are inconsistent across the three golden envelope snapshots: TREMOR has per-proposal scores, BREATH has a single envelope-level score (0.345), CORONA has none. Fix the emitter to compute per-proposal scores, make `usefulness_score` required at proposal level in the IR schema, and regenerate all three golden snapshots.

**Acceptance Criteria:**
- [ ] `src/ir/emit.js` computes `usefulness_score` at individual proposal level for every proposal
- [ ] Envelope-level `usefulness_scores` map retained for backwards compatibility
- [ ] `spec/proposal-ir.json` marks `usefulness_score` as required at proposal level
- [ ] All three golden envelope snapshots regenerated with consistent per-proposal scores:
  - `fixtures/forge-snapshots-tremor.json`
  - `fixtures/forge-snapshots-corona.json`
  - `fixtures/forge-snapshots-breath.json`
- [ ] `npm run test:all` passes
- [ ] Per-proposal field name is `usefulness_score` (consistent with existing naming)

**Dependencies:** FR-01, FR-02, FR-03 should be stable before this work begins

> Sources: FORGE_REVIEW_SPRINT.md:131-162, Phase 5 confirmation (field name)

---

### FR-06: Document brier_type null rejection (T-R06)

**Priority:** P1 — SHOULD ADDRESS
**Effort:** XS
**Description:** Tobias's fork still allows `null` for `brier_type`. FORGE master requires `"binary"` or `"multi_class"`. The IR spec needs to make this explicit. Document the mapping (cascade→multi_class, all others→binary) and add a validation test confirming null rejection.

**Acceptance Criteria:**
- [ ] `spec/proposal-ir.json` brier_type field does not allow null and is marked required
- [ ] Description/comment documents the mapping: cascade→multi_class, all other templates→binary
- [ ] Validation test exists confirming proposal with `brier_type: null` fails schema validation
- [ ] `npm run test:all` passes

**Dependencies:** None

> Sources: FORGE_REVIEW_SPRINT.md:166-186

---

## Non-Functional Requirements

### Test Regression Gate

- `npm run test:all` must pass with ≥ 566 tests after every task
- New tests may be added (T-R06 validation test) — count may increase
- No existing test may be removed or skipped

> Sources: FORGE_REVIEW_SPRINT.md:11, project-description.md:55

### IR Compatibility

- Additive changes only to `spec/proposal-ir.json` — no field removals, no type changes, no required→optional flips
- String tier keys ("T0"–"T3") must not change format
- All changes must be mergeable into Tobias's fork without breaking his 163 bridge tests

> Sources: FORGE_REVIEW_SPRINT.md:8, project-description.md:56

### Determinism

- Same input, same output, every time
- Regenerated golden envelopes must be reproducible from pipeline execution, not hand-edited

> Sources: project-description.md:53

### Zero External Dependencies

- Node.js 20+ built-ins only — no new runtime dependencies
- This sprint should not introduce any new `dependencies` in package.json

> Sources: project-description.md:52

---

## Technical Considerations

### Architecture Notes

No architectural changes in this sprint. All work is within existing module boundaries:
- `spec/construct.json` — metadata fix (FR-01, FR-03)
- `src/trust/oracle-trust.js` — documentation addition (FR-02)
- `spec/proposal-ir.json` — schema tightening and documentation (FR-02, FR-04, FR-05, FR-06)
- `src/ir/emit.js` — usefulness score computation fix (FR-05)
- `fixtures/forge-snapshots-*.json` — regeneration (FR-05)
- `spec/STABILITY.md` — new file (FR-04)

### Integrations

| System | Integration Type | Impact |
|--------|------------------|--------|
| Echelon policy normaliser | Reads `construct.json` | FR-01, FR-03 fix broken inputs |
| Echelon admission gate | Consumes IR envelopes | FR-02, FR-05, FR-06 improve consistency |
| Tobias's bridge tests (163) | Validates IR schema | All changes must be additive-only |

### Dependencies

- None external. All work is FORGE-internal.
- No Tobias input required — all fix instructions are documented in his review.

---

## Scope & Prioritization

### In Scope

- T-R01: Fix construct.json entry_point (P0, XS)
- T-R02: Document settlement tier key distinction (P0, XS)
- T-R03: Verify domain claim vocabulary (P0, S)
- T-R04: Document IR stability policy (P1, XS)
- T-R05: Fix usefulness scoring inconsistency (P1, S)
- T-R06: Document brier_type null rejection (P1, XS)

### Explicitly Out of Scope

- **New features** — this is a fix sprint, not a feature sprint
- **Cycle 002 IR hardening** (normalization_trace, negative_policy_flags, original_hash) — deferred to Cycle 002
- **Usefulness weight tuning** — weights are documented as probably wrong but premature to optimize
- **Shadow mode implementation** — deferred to Cycle 002 SDD
- **Live adapter work** (retry logic, second adapter) — Cycle 002 scope
- **Negative Policy Registry implementation** — Cycle 002, pending Tobias confirmation on ownership boundary
- **Trust tier source list alignment** against Echelon's Settlement Authority Registry — Cycle 002

> Sources: FORGE_REVIEW_SPRINT.md:1-2, FORGE_LEARNINGS_updated2.md:55, cycle-002-echelon-integration.md:88

### Priority Matrix

| Requirement | Priority | Effort | Impact | Order |
|-------------|----------|--------|--------|-------|
| FR-01 (entry_point) | P0 | XS | High — breaks policy normaliser | 1 |
| FR-02 (tier keys) | P0 | XS | High — admission gate confusion | 2 |
| FR-03 (domain vocab) | P0 | S | High — tier-cap penalty risk | 3 |
| FR-04 (stability policy) | P1 | XS | Medium — bridge test confidence | 4 |
| FR-05 (usefulness scores) | P1 | S | Medium — IR consistency | 5 |
| FR-06 (brier_type null) | P1 | XS | Medium — schema drift | 6 |

---

## Success Criteria

### Sprint Complete When

- [ ] All three MUST FIX items (FR-01, FR-02, FR-03) resolved and committed
- [ ] All three SHOULD ADDRESS items (FR-04, FR-05, FR-06) resolved and committed
- [ ] `npm run test:all` passes with ≥ 566 tests
- [ ] No IR schema fields removed or renamed (additive changes only)
- [ ] Changes are ready to communicate to Tobias for fork sync

> Sources: FORGE_REVIEW_SPRINT.md:190-199

### Post-Sprint Validation

- [ ] Tobias syncs fork successfully (external — confirmed by Tobias)
- [ ] Echelon policy normaliser processes updated construct.json without errors
- [ ] Echelon bridge tests pass against updated IR envelopes

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| FR-05 fixture regeneration breaks Tobias's bridge tests | Low | High | `usefulness_score` field name matches existing convention; additive only; Tobias can run bridge tests post-sync |
| FR-03 domain vocabulary still mismatched after fix | Low | High | Cross-reference against full Echelon v15 taxonomy list provided in FORGE_REVIEW_SPRINT.md:83-88 |
| Golden envelope snapshots diverge from actual pipeline output | Low | Medium | Regenerate by running actual pipeline, not hand-editing fixtures |
| FR-05 changes envelope structure in unexpected way | Low | Medium | Retain envelope-level `usefulness_scores` map for backwards compatibility |

> Sources: FORGE_REVIEW_SPRINT.md:148-151, 159-160

### Assumptions

- `feed_characterization` → `feed_classification` is the correct vocabulary fix (FORGE_REVIEW_SPRINT.md:89)
- Tobias's 163 bridge tests will not break from additive-only changes
- `usefulness_score` is the correct field name at proposal level (Phase 5 confirmation)

### Dependencies on External Factors

- None. All fix instructions are fully documented. No Tobias input required for this sprint.

---

## Timeline & Milestones

| Milestone | Target | Deliverables |
|-----------|--------|--------------|
| MUST FIX complete | Variable | FR-01, FR-02, FR-03 committed, tests passing |
| SHOULD ADDRESS complete | Variable | FR-04, FR-05, FR-06 committed, tests passing |
| Sprint complete | Variable | All 6 items resolved, ready for Tobias fork sync |

**Duration:** Variable — no hard deadlines. Runs until complete or interrupted by Cycle 002 inputs from Tobias.

> Sources: Phase 2 confirmation

---

## Appendix

### A. Stakeholder Context

**Tobias (Echelon):**
- Fork: AITOBIAS04/echelon-core, 3 commits behind master
- 163 bridge tests locked to current IR contract
- Echelon System Bible v14/v15, Cycle 037+ complete, 468+ tests
- FORGE maps to Echelon's Theatre Factory component (Cycle 040 scope)

> Sources: FORGE_LEARNINGS_updated2.md:79-83, 107

### B. Echelon v15 Domain Vocabulary Reference

**Check family categories for theatre constructs:**
`settlement_accuracy`, `functional_correctness`, `oracle_consistency`, `calibration_validity`

**Broader domain vocabulary:**
`feed_classification`, `oracle_trust`, `market_proposal`, `evidence_bundle`, `rlmf_certificate`, `theatre_lifecycle`

> Sources: FORGE_REVIEW_SPRINT.md:83-88, FORGE_LEARNINGS_updated2.md:81

### C. Echelon Provenance Mapping

| FORGE Tier | Echelon Provenance | Description |
|------------|-------------------|-------------|
| T0 | signal_initiated | High confidence |
| T1 | signal_initiated | Brier-discounted confidence |
| T2 | suggestion_promoted | Needs corroborating signals |
| T3 | suggestion_unlinked | No settlement evidence, never settles |

> Sources: FORGE_REVIEW_SPRINT.md:45-49

### D. Source Documents

| Document | Path | Purpose |
|----------|------|---------|
| Tobias Review Sprint | `grimoires/loa/context/FORGE_REVIEW_SPRINT.md` | Primary — 6 review items with acceptance criteria |
| FORGE Learnings | `grimoires/pub/FORGE/FORGE_LEARNINGS_updated2.md` | Operational intelligence and collaboration context |
| FORGE Thesis | `grimoires/pub/FORGE/FORGE_THESIS_updated.md` | Strategic positioning and Echelon integration context |
| Project Description | `grimoires/loa/context/project-description.md` | Codebase state and constraints |
| Cycle 002 Context | `grimoires/loa/context/cycle-002-echelon-integration.md` | Future cycle scope (out of scope for this sprint) |

### E. Glossary

| Term | Definition |
|------|------------|
| IR | Intermediate Representation — the `ProposalEnvelope` JSON contract between FORGE and Echelon |
| Golden envelope | Snapshot fixture files (`fixtures/forge-snapshots-*.json`) used as test baselines |
| Bridge tests | Tobias's 163 tests that consume FORGE's IR output in his Echelon fork |
| Policy normaliser | Echelon component that reads `construct.json` to compile evaluation contracts |
| Tier-cap penalty | Reduced calibration certificate tier caused by vocabulary mismatches |
| Theatre Factory | Echelon's Cycle 040 component that admits/rejects FORGE proposals |

---

*Generated by PRD Architect Agent*
