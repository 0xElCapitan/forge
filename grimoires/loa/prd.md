# Product Requirements Document: FORGE Pre-002 Holding Sprint

**Version:** 1.0
**Date:** 2026-03-27
**Author:** PRD Architect Agent
**Status:** Draft
**Cycle:** pre-002

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

FORGE Cycle 001 is complete: 12 sprints, 20.5/20.5 convergence score, 566 tests passing, zero external dependencies. The classification engine, selector, theatre templates, trust model, and RLMF pipeline are all implemented and validated against three backing specifications (TREMOR, CORONA, BREATH).

Cycle 002 (Echelon integration) is blocked pending Tobias's delivery of canvas redesign docs and potential new IR requirements. This holding sprint uses the wait productively by running a full code review, security audit with adversarial red-teaming, and economic usefulness heuristic iteration — all purely FORGE-internal work that clears technical debt and security unknowns before the integration complexity of Cycle 002.

The sprint is conditionally blocking: if critical or high findings emerge from review or audit, they must be resolved before Cycle 002 begins. Otherwise, the sprint is interruptible if Tobias delivers early.

> Sources: FORGE_PRE_002.md:1-18, cycle-002-echelon-integration.md:1-3, Phase 1 Q1 (priority: depends on findings)

---

## Problem Statement

### The Problem

Cycle 001 code has been built iteratively through a convergence loop — each change was scored and kept or discarded based on TotalScore improvement. This process optimizes for convergence but does not guarantee security, code quality, or economic soundness. The trust model (T0-T3 oracle tiers), adversarial detection (Argus), and economic usefulness heuristic have not been subjected to formal review or adversarial testing.

> Sources: FORGE_PROGRAM.md:296 ("Echelon runs structured prediction markets..."), FORGE_PRE_002.md:7-8

### Current State

- Cycle 001 complete: 25K LOC, 30 source files, 566 tests, zero drift between code and documentation
- Trust model implemented with T0-T3 tiers and settlement enforcement [CODE:src/trust/oracle-trust.js:61+]
- Argus adversarial checks implemented (6 checks) [CODE:src/trust/oracle-trust.js]
- Usefulness heuristic implemented with equal weights across 4 dimensions [CODE:src/filter/usefulness.js]
- No formal code review, security audit, or adversarial testing has been performed

> Sources: /ride enriched analysis (drift score: 0), FORGE_PRE_002.md:34-36

### Desired State

- Code reviewed by Tech Lead persona with formal approval
- Security audited by Paranoid Cypherpunk Auditor persona with formal approval
- Trust model and adversarial gates stress-tested through red-teaming with all findings documented and dispositioned
- Usefulness heuristic weights interrogated against backing spec intuitions, with findings documented for future live-market calibration
- FORGE ready to begin Cycle 002 without carrying forward unreviewed technical debt

> Sources: FORGE_PRE_002.md:310-323 (Definition of Done)

---

## Goals & Success Metrics

### Primary Goals

| ID | Goal | Measurement | Validation Method |
|----|------|-------------|-------------------|
| G-1 | Formal code review approval for Cycle 001 | `/review-sprint` produces approval | Tech Lead review pass with no open critical/high findings |
| G-2 | Formal security audit approval for Cycle 001 | `/audit-sprint` produces approval | Security Auditor pass with all critical/high dispositioned |
| G-3 | Red-teaming findings documented with dispositions | Structured report for 3 targets | Every finding has severity + attack path + defense + disposition |
| G-4 | Usefulness heuristic interrogated and documented | `FORGE_USEFULNESS_FINDINGS.md` exists | All 4 sections present, self-contained, honest over optimistic |
| G-5 | Critical trust model vulnerabilities fixed immediately | Zero open critical findings at sprint end | All critical findings resolved in code, not deferred |

> Sources: FORGE_PRE_002.md:310-323, Phase 1 Q1 (conditional priority), Phase 7 Q1 (fix immediately)

### Constraints

- DO NOT begin SWPC space weather work (Cycle 002 scope)
- DO NOT begin Echelon economic conversation prep (post-002)
- DO NOT modify `spec/proposal-ir.json` or golden envelope fixtures
- DO NOT modify `BUTTERFREEZONE.md` unless a finding requires correction
- All existing tests (566) must remain passing throughout

> Sources: FORGE_PRE_002.md:15-18, cycle-002-echelon-integration.md:78

---

## User Personas & Use Cases

### Primary Persona: Solo Developer

**Demographics:**
- Role: Sole developer and maintainer of FORGE
- Technical Proficiency: Expert — built the entire codebase through Cycle 001
- Goals: Ensure code quality and security before Echelon integration complexity

> Sources: FORGE_PRE_002.md:9, Phase 3 Q1 (internal primarily)

### Secondary Stakeholder: Tobias (Echelon)

**Role:** Echelon platform owner; will consume FORGE output via Proposal IR
**Relationship:** Selective sharing — relevant trust model and settlement boundary findings shared before Cycle 002
**Not involved in:** This sprint's execution; will see findings selectively

> Sources: cycle-002-echelon-integration.md:29, Phase 3 Q1 (selectively shared)

### Use Cases

#### UC-1: Code Review of Cycle 001

**Actor:** Tech Lead (AI agent persona)
**Preconditions:** All 566 tests passing, Cycle 001 code complete
**Flow:**
1. Run `/review-sprint` across Sprints 1-12
2. Apply heightened attention to 5 priority targets
3. Produce findings with severity and recommended fixes
4. Iterate until all critical/high findings resolved
5. Issue formal approval

**Postconditions:** Review approval document exists; no open critical/high findings
**Acceptance Criteria:**
- [ ] All 5 priority review targets examined
- [ ] Findings documented with severity ratings
- [ ] No path exists where `canSettle()` returns true for T2, T3, or unknown
- [ ] `checkAdversarial` cannot be bypassed by caller

> Sources: FORGE_PRE_002.md:34-69

#### UC-2: Security Audit + Red-Teaming

**Actor:** Security Auditor (AI agent persona) + Red Team
**Preconditions:** Phase 1 review approved; no open critical/high findings
**Flow:**
1. Run `/audit-sprint` (standard security pass)
2. Run `/red-teaming` against 3 targets (trust model, Argus, evidence bundles)
3. Document all findings with severity, attack path, defense, fix, scope
4. Disposition all critical/high findings (fix or accepted risk)

**Postconditions:** Audit approval + red-teaming report with all findings dispositioned
**Acceptance Criteria:**
- [ ] Zero external runtime dependencies confirmed
- [ ] Input boundary handling verified (malformed JSON, circular refs, Infinity, NaN, -0)
- [ ] Path traversal impossible in `ingestFile()` and `createReplay()`
- [ ] All 6 Argus checks verified present and documented
- [ ] Trust model tier bypass scenarios tested
- [ ] Evidence bundle immutability verified

> Sources: FORGE_PRE_002.md:73-173

#### UC-3: Usefulness Heuristic Iteration

**Actor:** Solo Developer + AI agent
**Preconditions:** Phase 2 audit approved
**Flow:**
1. T-H01: Audit current weight implementation (read-only)
2. T-H02: Score all 13 proposals against current weights (baseline table)
3. T-H03: Interrogate weight assumptions (reasoning, no code changes)
4. T-H04: Propose revised weights, implement, compare, keep or revert
5. T-H05: Document all findings in `FORGE_USEFULNESS_FINDINGS.md`

**Postconditions:** Findings document exists, self-contained, all 4 sections present
**Acceptance Criteria:**
- [ ] Baseline table covers all 13 proposals with per-dimension breakdown
- [ ] At least one proposal flagged as "score feels wrong" with reason
- [ ] Weight interrogation covers all 4 dimensions
- [ ] Before/after comparison produced (even if weights reverted)
- [ ] Findings doc is self-contained for a cold reader

> Sources: FORGE_PRE_002.md:177-305

---

## Functional Requirements

### FR-1: Code Review — Oracle Trust Model
**Priority:** Must Have
**Description:** Review `src/trust/oracle-trust.js` with focus on `getTrustTier()` gap handling, `canSettle()` boolean correctness, `validateSettlement()` reason field population, and adversarial check wiring.

**Acceptance Criteria:**
- [ ] `getTrustTier()` handles unrecognized source IDs safely; `'unknown'` fallback consumed correctly everywhere
- [ ] `canSettle()` returns `false` for T2, T3, and `'unknown'` — no exception path
- [ ] `validateSettlement()` populates `reason` field for all rejection paths
- [ ] `checkAdversarial()` wired into `buildBundle()` and cannot be bypassed

**Dependencies:** None

> Sources: FORGE_PRE_002.md:44-49

### FR-2: Code Review — Evidence Bundle Pipeline
**Priority:** Must Have
**Description:** Review `src/processor/bundles.js` for trust enforcement consistency, edge case handling in quality/doubt computation, and evidence class agreement with trust tiers.

**Acceptance Criteria:**
- [ ] Adversarial checks and trust enforcement run on every `buildBundle()` call path
- [ ] Edge cases handled: empty event, malformed event, missing config fields
- [ ] `assignEvidenceClass()` and `canSettleByClass()` consistent with `canSettle()` — no dual-gate disagreement
- [ ] `computeQuality()` and `computeDoubtPrice()` handle zero variance, single-event, all-identical values

**Dependencies:** FR-1

> Sources: FORGE_PRE_002.md:51-55

### FR-3: Code Review — Usefulness Filter
**Priority:** Must Have
**Description:** Review `src/filter/usefulness.js` for structural issues that inform Phase 3 iteration.

**Acceptance Criteria:**
- [ ] All 4 dimensions computed (`market_depth`, `settlement_clarity`, `temporal_fitness`, `novelty`)
- [ ] Composite is true 0-1 score with no silent clamping or NaN propagation
- [ ] Structural issues noted for Phase 3

**Dependencies:** None

> Sources: FORGE_PRE_002.md:57-59

### FR-4: Code Review — Composition Engine
**Priority:** Must Have
**Description:** Review `src/composer/compose.js` for rule ordering, null return cleanliness, and edge cases.

**Acceptance Criteria:**
- [ ] `proposeComposedTheatre` returns clean `null` when no rule fires
- [ ] `lag_ms: 0` and `leader: 'concurrent'` edge cases handled correctly
- [ ] Three composition rules reviewed for ordering correctness

**Dependencies:** None

> Sources: FORGE_PRE_002.md:61-62

### FR-5: Code Review — Deterministic Replay
**Priority:** Must Have
**Description:** Confirm `src/replay/deterministic.js` produces byte-identical output for identical inputs.

**Acceptance Criteria:**
- [ ] No `Date.now()`, `Math.random()`, or non-deterministic object key ordering
- [ ] Same fixture + same options = byte-identical output

**Dependencies:** None

> Sources: FORGE_PRE_002.md:64-65

### FR-6: Security Audit — Supply Chain
**Priority:** Must Have
**Description:** Confirm zero external runtime dependencies.

**Acceptance Criteria:**
- [ ] `package.json` has no `dependencies` key, or an empty one
- [ ] No dynamic `require()` or `import()` of external modules at runtime

**Dependencies:** FR-1 through FR-5 (Phase 1 gate must pass)

> Sources: FORGE_PRE_002.md:81-82

### FR-7: Security Audit — Input Boundaries
**Priority:** Must Have
**Description:** Verify `ingest()` and `ingestFile()` handle adversarial input safely.

**Acceptance Criteria:**
- [ ] Malformed JSON handled gracefully
- [ ] Circular references do not cause infinite loops or stack overflow
- [ ] Memory-exceeding payloads bounded
- [ ] Infinity, NaN, -0, MAX_SAFE_INTEGER values handled correctly

**Dependencies:** FR-6

> Sources: FORGE_PRE_002.md:83-86

### FR-8: Security Audit — File I/O
**Priority:** Must Have
**Description:** Verify `ingestFile()` and `createReplay()` are path-traversal safe.

**Acceptance Criteria:**
- [ ] No user-controlled string reaches `fs.readFile` without sanitization
- [ ] Path traversal (`../`) does not escape intended directory
- [ ] Symlink following behavior documented and intentional

**Dependencies:** FR-6

> Sources: FORGE_PRE_002.md:87-89

### FR-9: Red-Team — Oracle Trust Model
**Priority:** Must Have
**Description:** Adversarial testing of trust tier mapping, settlement enforcement, and bypass scenarios.

**Attack Scenarios to Test:**
- sourceId string manipulation (case, prefix, substring, normalization)
- Null/undefined/empty/long/object inputs to `getTrustTier()`
- Exhaustiveness of tier mapping against real-world source IDs
- Code paths that skip `canSettle()` entirely

**Acceptance Criteria:**
- [ ] All attack scenarios tested and documented
- [ ] Each finding has severity, attack path, current defense, recommended fix, scope disposition

**Dependencies:** FR-6 through FR-8 (Phase 2 Part A)

> Sources: FORGE_PRE_002.md:97-114

### FR-10: Red-Team — Argus Adversarial Checks
**Priority:** Must Have
**Description:** Test all 6 adversarial checks for false negatives (attacks that succeed) and false positives (legitimate data rejected).

**Checks to Red-Team:**
1. Frozen data detection — slow drift evasion
2. Clock drift detection — timestamp replay
3. Sybil pattern detection — multi-source attacker
4. Spoofing detection — statistical fingerprint mimicry
5. Channel consistency — internally consistent but systematically wrong
6. [Sixth check — identify and document]

**Acceptance Criteria:**
- [ ] All 6 checks verified present in source
- [ ] Each check: worst-case false negative and false positive documented
- [ ] Detection thresholds documented for each check

**Dependencies:** FR-9

> Sources: FORGE_PRE_002.md:115-139

### FR-11: Red-Team — Evidence Bundle Spec
**Priority:** Must Have
**Description:** Test evidence bundle construction for quality gaming, doubt price manipulation, and immutability.

**Attack Scenarios:**
- Craft event with artificially high quality score
- Drive doubt price to zero
- `assignEvidenceClass` / `canSettle` disagreement
- Post-construction mutation of bundle object

**Acceptance Criteria:**
- [ ] Each attack scenario documented with severity and disposition
- [ ] Doubt price floor behavior documented
- [ ] Bundle immutability verified or gap documented

**Dependencies:** FR-9

> Sources: FORGE_PRE_002.md:144-158

### FR-12: Usefulness Heuristic — Audit (T-H01)
**Priority:** Must Have (if Phase 3 executes)
**Description:** Read `src/filter/usefulness.js` in full. Document the exact formula, weighting, clamping, normalization, and inputs used.

**Acceptance Criteria:**
- [ ] Written summary of current formula exists before any changes
- [ ] No code changes in this task

**Dependencies:** Phase 2 gate (G-2, G-3)

> Sources: FORGE_PRE_002.md:186-198

### FR-13: Usefulness Heuristic — Baseline Scoring (T-H02)
**Priority:** Must Have (if Phase 3 executes)
**Description:** Score all 13 proposals from the 3 golden envelope fixtures against current weights.

**Acceptance Criteria:**
- [ ] All 13 proposals scored with per-dimension breakdown
- [ ] Table produced
- [ ] At least one proposal flagged as "score feels wrong" with written reason

**Dependencies:** FR-12

> Sources: FORGE_PRE_002.md:200-225

### FR-14: Usefulness Heuristic — Weight Interrogation (T-H03)
**Priority:** Must Have (if Phase 3 executes)
**Description:** Reason through weight assumptions for each of the 4 dimensions using the baseline table. No code changes.

**Acceptance Criteria:**
- [ ] One paragraph per dimension: assumption, whether it holds, what's uncertain
- [ ] Document reasoning before proposing changes

**Dependencies:** FR-13

> Sources: FORGE_PRE_002.md:227-253

### FR-15: Usefulness Heuristic — Weight Proposal (T-H04)
**Priority:** Must Have (if Phase 3 executes)
**Description:** Propose revised weights, implement, compare before/after, keep or revert.

**Acceptance Criteria:**
- [ ] Written weight proposal with justification exists before implementation
- [ ] Before/after comparison table produced
- [ ] All existing `computeUsefulness` unit tests still pass
- [ ] Either revised weights committed with rationale, OR revert committed with reason

**Dependencies:** FR-14

> Sources: FORGE_PRE_002.md:255-279

### FR-16: Usefulness Heuristic — Document Findings (T-H05)
**Priority:** Must Have (if Phase 3 executes)
**Description:** Create `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md` with all findings.

**Sections Required:**
1. Baseline scoring table (T-H02)
2. Weight interrogation findings (T-H03)
3. Weight proposal and before/after comparison (T-H04)
4. "What real-world data would tell us"

**Acceptance Criteria:**
- [ ] File exists at `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md`
- [ ] All 4 sections present
- [ ] Self-contained for a cold reader
- [ ] If weights reverted, documents why

**Dependencies:** FR-15

> Sources: FORGE_PRE_002.md:281-305

---

## Non-Functional Requirements

### Determinism
- All scoring, classification, and rule evaluation must remain deterministic for identical input fixtures
- No randomness, sampling, or non-seeded heuristics
- Same input → same FeedProfile → same proposals → same score

> Sources: FORGE_PROGRAM.md:492

### Supply Chain Security
- Zero external runtime dependencies maintained
- `package.json` must have no `dependencies` key or an empty one
- Only `node:*` built-in modules at runtime

> Sources: FORGE_PROGRAM.md:488, FORGE_PRE_002.md:81-82

### Test Integrity
- All 566 existing tests must pass after any code changes
- Convergence tests must pass in both raw and anonymized fixture modes

> Sources: FORGE_PROGRAM.md:341-345, cycle-002-echelon-integration.md:78

### Settlement Security (Critical Invariant)
- T3 sources (PurpleAir, ThingSpeak) MUST NEVER settle a theatre
- Only T0 and T1 sources may settle
- This is the attack the entire trust model exists to prevent

> Sources: FORGE_PROGRAM.md:270 ("If FORGE proposes that PurpleAir can settle a theatre, the oracle trust model is broken"), FORGE_PROGRAM.md:314-323

---

## Technical Considerations

### Architecture
FORGE follows a linear pipeline architecture: Ingest → Classify (5D grammar) → Select (13 rules) → Propose → Runtime → RLMF. All modules are in `src/` with clear separation of concerns.

> Sources: /ride enriched analysis [CODE:src/classifier/feed-grammar.js:34-41], [CODE:src/selector/rules.js:35-200+]

### Codebase State (from /ride)
- 25K LOC, 30 source files
- Drift score: 0 (code and documentation fully aligned)
- Zero tech debt markers (no TODO, FIXME, HACK)
- Well-commented with JSDoc on all exports

### Integration Boundary
The Proposal IR (`spec/proposal-ir.json` v0.1.0) is the contract between FORGE and Echelon. This sprint explicitly does NOT modify the IR.

> Sources: FORGE_PRE_002.md:17, cycle-002-echelon-integration.md:31

### Governance Gaps (from /ride — in-scope if naturally surfaced)
- Missing: CHANGELOG.md, SECURITY.md, LICENSE file, CODEOWNERS
- Missing: Formal ADR records (decisions exist in code comments)
- Missing: Documented adversarial detection thresholds
- Missing: Doubt pricing formula derivation

> Sources: /ride enriched analysis, Phase 4 Q1 (include if surfaced)

---

## Scope & Prioritization

### In Scope — This Sprint

| Phase | Work | Priority | Effort | Gate |
|-------|------|----------|--------|------|
| Phase 1 | `/review-sprint` Cycle 001 (5 priority targets + full codebase) | P0 | M | Tech Lead approval |
| Phase 2A | `/audit-sprint` Cycle 001 | P0 | M | Security Auditor approval |
| Phase 2B | `/red-teaming` on 3 targets (trust, Argus, bundles) | P0 | L | Findings documented with dispositions |
| Phase 2C | Critical vulnerability fixes (if found) | P0 | Variable | Tests passing, vulnerability closed |
| Phase 3 | Usefulness heuristic iteration (T-H01–T-H05) — all or nothing | P1 | M | `FORGE_USEFULNESS_FINDINGS.md` complete |

### In Scope — If Naturally Surfaced

- Governance artifacts (SECURITY.md, CHANGELOG, etc.)
- Adversarial threshold documentation
- Doubt pricing formula documentation
- `BUTTERFREEZONE.md` corrections (only if findings require)

> Sources: Phase 4 Q1 (include if surfaced), FORGE_PRE_002.md:18

### Explicitly Out of Scope

| Item | Reason |
|------|--------|
| SWPC space weather (second backing spec) | Cycle 002 scope |
| Echelon economic conversation prep | Post-002 |
| `spec/proposal-ir.json` modifications | Frozen for this sprint |
| Golden envelope fixture modifications | Frozen for this sprint |
| `BUTTERFREEZONE.md` modifications | Unless a finding requires correction |
| New feature development | This is a review/audit/iterate sprint |

> Sources: FORGE_PRE_002.md:15-18

### Execution Order

Phases are **strictly sequential with gates**:

```
Phase 1 (Review) → [approval gate] → Phase 2 (Audit + Red-Team) → [approval gate] → Phase 3 (Usefulness)
```

Phase 3 is all-or-nothing: either T-H01 through T-H05 complete, or the entire phase defers.

> Sources: FORGE_PRE_002.md:24-30, Phase 6 Q1 (all or nothing)

---

## Success Criteria

### Sprint Definition of Done

- [ ] `/review-sprint` has produced formal approval for Cycle 001 (G-1)
- [ ] `/audit-sprint` has produced formal approval for Cycle 001 (G-2)
- [ ] Red-teaming findings for all 3 targets documented with dispositions (G-3)
- [ ] Economic usefulness heuristic audited, interrogated, iterated — findings documented in `FORGE_USEFULNESS_FINDINGS.md` (G-4)
- [ ] All critical and high findings addressed or have documented accepted-risk rationale (G-5)

### Post-Sprint State

FORGE is ready to receive Tobias's canvas redesign docs and begin Cycle 002 immediately, without carrying forward technical debt from Cycle 001.

> Sources: FORGE_PRE_002.md:322-323

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| Critical trust model vulnerability found | Medium | High | Fix immediately in this sprint (Phase 7 Q1 decision) |
| Tobias delivers early, interrupting sprint | Medium | Medium | Phase 1+2 take priority; Phase 3 defers as a unit |
| Usefulness weight iteration makes scores worse | Medium | Low | Reversion is a valid outcome; document why (FORGE_PRE_002.md:266-268) |
| Audit discovers scope-expanding issues | Low | High | Document as findings; only fix critical/high; defer rest to Cycle 002 |
| Red-teaming reveals fundamental trust model redesign needed | Low | High | Document gap; assess whether Cycle 002 can proceed safely |

### Assumptions

1. **[ASSUMPTION]** Phase 1 review covers all of Cycle 001, not just the 5 priority targets — priority targets get heightened attention but everything is in scope. If wrong: review would miss defects in non-priority modules.
2. **[ASSUMPTION]** `FORGE_USEFULNESS_FINDINGS.md` is the only persistent output from Phase 3 — code changes to weights may be committed or reverted. If wrong: additional deliverables needed.

### Dependencies on External Factors

- Tobias's canvas redesign docs delivery (timing unknown — determines whether this sprint is interrupted)

> Sources: FORGE_PRE_002.md:7-8, Phase 2 Q1 (no idea on timeline)

---

## Timeline & Milestones

| Milestone | Target | Deliverables |
|-----------|--------|--------------|
| Phase 1 Complete | Variable (no hard deadline) | `/review-sprint` approval, findings addressed |
| Phase 2A Complete | After Phase 1 | `/audit-sprint` approval |
| Phase 2B-C Complete | After Phase 2A | Red-teaming report, critical fixes applied |
| Phase 3 Complete | After Phase 2 | `FORGE_USEFULNESS_FINDINGS.md` |
| Sprint Done | All phases complete OR Tobias delivers | All exit criteria met |

No hard dates — this sprint runs until complete or interrupted by Cycle 002 inputs.

> Sources: Phase 2 Q1 (no idea on timeline), FORGE_PRE_002.md:310-323

---

## Appendix

### A. Source Traceability

| Section | Primary Sources |
|---------|-----------------|
| Problem Statement | FORGE_PRE_002.md:7-18, cycle-002-echelon-integration.md:1-3 |
| Goals | FORGE_PRE_002.md:310-323, Phase 1 Q1, Phase 7 Q1 |
| Personas | FORGE_PRE_002.md:9, cycle-002-echelon-integration.md:29, Phase 3 Q1 |
| FR-1 to FR-5 | FORGE_PRE_002.md:34-69 |
| FR-6 to FR-8 | FORGE_PRE_002.md:73-89 |
| FR-9 to FR-11 | FORGE_PRE_002.md:97-173 |
| FR-12 to FR-16 | FORGE_PRE_002.md:186-305 |
| Non-Functional | FORGE_PROGRAM.md:270, 314-323, 488, 492 |
| Scope | FORGE_PRE_002.md:15-18, 24-30, Phase 4 Q1, Phase 6 Q1 |
| Risks | Phase 1 Q1, Phase 7 Q1, FORGE_PRE_002.md:266-268 |

### B. Codebase Reality (from /ride --enriched)

| Metric | Value |
|--------|-------|
| LOC | ~25K |
| Source files | 30 |
| Tests | 566 (503 unit + 63 convergence) |
| Drift score | 0 |
| Tech debt markers | 0 |
| External dependencies | 0 |
| Trust tiers | T0-T3 (T0/T1 settle, T2 corroborate, T3 signal only) |
| Theatre templates | 6 (threshold_gate, cascade, divergence, regime_shift, anomaly, persistence) |
| Selector rules | 13 |
| Classifier dimensions | 5 (cadence, distribution, noise, density, thresholds) |

### C. Key Code References

| Component | File | Key Functions |
|-----------|------|---------------|
| Trust Model | `src/trust/oracle-trust.js` | `getTrustTier()`, `canSettle()`, `validateSettlement()`, `checkAdversarial()` |
| Evidence Bundles | `src/processor/bundles.js` | `buildBundle()`, `assignEvidenceClass()`, `canSettleByClass()`, `computeQuality()`, `computeDoubtPrice()` |
| Usefulness | `src/filter/usefulness.js` | `computeUsefulness()` — 4 dimensions: market_depth, settlement_clarity, temporal_fitness, novelty |
| Composition | `src/composer/compose.js` | `proposeComposedTheatre()` — 3 composition rules |
| Replay | `src/replay/deterministic.js` | Deterministic fixture replay |
| Argus | `src/trust/oracle-trust.js` | `checkAdversarial()`, `checkChannelConsistency()` — 6 checks |

### D. Glossary

| Term | Definition |
|------|------------|
| Theatre | A structured prediction market on Echelon with locked parameters, evidence ingestion, and Brier-scored RLMF export |
| Construct | An autonomous agent inside a Theatre with verifiable on-chain P&L |
| FeedProfile | 5-dimension classification of an event stream (cadence, distribution, noise, density, thresholds) |
| Argus | The 6-check adversarial gate on every evidence bundle (named: hundred-eyed watchman) |
| RLMF | Reinforcement Learning from Market Feedback — Brier-scored training data export |
| Proposal IR | Versioned JSON contract between FORGE output and Echelon's admission gate (v0.1.0) |
| Golden envelope | Fixture files containing expected FORGE output for each backing spec |
| Backing spec | Reference implementation (TREMOR, CORONA, BREATH) that FORGE must converge to |

> Sources: FORGE_PROGRAM.md:296-298, 300-312, FORGE_PRE_002.md:116-118

---

*Generated by PRD Architect Agent — grounded in /ride --enriched codebase analysis and 7-phase discovery interview*
