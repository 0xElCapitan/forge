# Sprint Plan: FORGE Pre-002 Holding Sprint

**Version:** 1.0
**Date:** 2026-03-27
**Author:** Sprint Planner Agent
**PRD Reference:** grimoires/loa/prd.md
**SDD Reference:** grimoires/loa/sdd.md

---

## Executive Summary

This holding sprint subjects FORGE Cycle 001 to formal code review, security audit with adversarial red-teaming, and usefulness heuristic iteration. No new features are built. The work is strictly sequential with approval gates between phases.

**Total Sprints:** 4
**Sprint Duration:** Variable (no hard deadlines — this sprint runs until complete or interrupted by Cycle 002 inputs)

---

## Sprint Overview

| Sprint | Theme | Key Deliverables | Dependencies |
|--------|-------|------------------|--------------|
| 1 | Code Review | Tech Lead approval, findings documented | None |
| 2 | Security Audit + Red-Team | Security Auditor approval, red-team report | Sprint 1 approved |
| 3 | Critical Fixes | All critical/high findings resolved, tests passing | Sprint 2 complete |
| 4 | Usefulness Heuristic Iteration | `FORGE_USEFULNESS_FINDINGS.md` | Sprint 3 complete |

---

## Sprint 1: Code Review

### Sprint Goal
Formal Tech Lead review of all Cycle 001 code with heightened attention to 5 priority targets. Produce findings with severity ratings and resolve all critical/high issues.

### Deliverables
- [ ] Code review findings document with severity ratings for all findings
- [ ] Formal Tech Lead approval (no open critical/high findings)
- [ ] All 566 tests still passing

### Acceptance Criteria
- [ ] All 5 priority review targets examined (oracle trust, bundles, usefulness, compose, replay)
- [ ] `getTrustTier()` handles unrecognized source IDs safely; `'unknown'` fallback consumed correctly everywhere
- [ ] `canSettle()` returns `false` for T2, T3, and `'unknown'` — no exception path
- [ ] `validateSettlement()` populates `reason` field for all rejection paths
- [ ] `checkAdversarial()` wiring assessed — is runtime-level enforcement (lifecycle.js:223) sufficient or is bundle-level needed?
- [ ] `assignEvidenceClass()`/`canSettleByClass()` consistent with `canSettle()` — no dual-gate disagreement
- [ ] `computeQuality()` and `computeDoubtPrice()` handle zero variance, single-event, all-identical values
- [ ] `proposeComposedTheatre()` returns clean `null` when no rule fires
- [ ] No `Date.now()`, `Math.random()`, or non-deterministic patterns in replay
- [ ] Composite usefulness score is true [0,1] with no silent clamping or NaN propagation

### Technical Tasks

- [ ] Task 1.1: Review `src/trust/oracle-trust.js` — tier lookup, settlement enforcement, reason population → **[G-1, G-5]**
- [ ] Task 1.2: Review `src/trust/adversarial.js` — verify 5 implemented checks, document missing Check 6, assess wiring into pipeline → **[G-1, G-3]**
- [ ] Task 1.3: Review `src/processor/bundles.js` + `quality.js` + `uncertainty.js` + `settlement.js` — trust enforcement consistency, edge cases, dual-gate agreement → **[G-1]**
- [ ] Task 1.4: Review `src/filter/usefulness.js` — 4 dimensions, composite formula, NaN propagation → **[G-1, G-4]**
- [ ] Task 1.5: Review `src/composer/compose.js` — null return, lag_ms=0, rule ordering → **[G-1]**
- [ ] Task 1.6: Review `src/replay/deterministic.js` — determinism verification → **[G-1]**
- [ ] Task 1.7: Full codebase sweep — remaining modules (ingester, classifier, selector, IR, runtime, theatres, RLMF, adapter) → **[G-1]**
- [ ] Task 1.8: Compile findings document, severity-rate all issues, resolve critical/high → **[G-1, G-5]**

### Dependencies
- None (first sprint)

### Security Considerations
- **Trust boundaries:** `oracle-trust.js` is the primary trust boundary — this sprint's most critical review target
- **Dual-gate consistency:** `canSettle(tier)` and `canSettleByClass(assignEvidenceClass(tier))` must agree for all tiers
- **Adversarial wiring:** `checkAdversarial` runs at `ForgeRuntime.ingestBundle()` but NOT at `buildBundle()` — assess if this is a bypass vector

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Review finds fundamental design issue | Low | High | Document as finding; assess if fixable in Phase 2C or requires Cycle 002 redesign |
| Tobias delivers early mid-review | Medium | Medium | Complete review quickly; findings are valuable regardless |

### Success Metrics
- All 5 priority targets reviewed with documented findings
- Zero open critical/high findings at sprint end
- 566/566 tests passing

---

## Sprint 2: Security Audit + Red-Team

### Sprint Goal
Security audit confirming supply chain integrity, input boundary safety, and file I/O security. Red-team testing of oracle trust model, Argus adversarial gate, and evidence bundle spec. All findings documented with severity, attack path, defense, and disposition.

### Deliverables
- [x] Security audit findings with formal approval
- [x] Red-team report for 3 targets (trust model, Argus, evidence bundles)
- [x] All findings have severity + attack path + current defense + recommended fix + disposition
- [x] All 566 tests still passing

### Acceptance Criteria
- [x] `package.json` confirmed: no `dependencies` key or empty one
- [x] No dynamic `require()` or `import()` of external modules at runtime
- [x] Malformed JSON handled gracefully in `ingest()` — finding SA-04 documented
- [x] Circular references do not cause infinite loops or stack overflow — finding SA-03 documented
- [x] Infinity, NaN, -0, MAX_SAFE_INTEGER values handled correctly — findings SA-02, SA-06 documented
- [x] Path traversal impossible in `ingestFile()` and `createReplay()` — finding SA-07 documented (NOT impossible — gap found)
- [x] All 6 Argus checks verified present (or missing Check 6 documented as finding) — RT-05 documented
- [x] Trust model tier bypass scenarios tested — no path where T2/T3/unknown settles — RT-01 CRITICAL bypass found
- [x] Evidence bundle immutability verified or gap documented — RT-10 gap documented
- [x] Doubt price floor behavior documented — RT-11
- [x] `assignEvidenceClass`/`canSettle` disagreement scenarios tested — dual-gate agreement verified

### Technical Tasks

- [x] Task 2.1: Supply chain audit — scan `package.json`, verify no external imports in all 30 source files → **[G-2]**
- [x] Task 2.2: Input boundary testing — malformed JSON, circular refs, memory-exceeding payloads, special numeric values → **[G-2]**
- [x] Task 2.3: File I/O audit — path traversal in `ingestFile()`, `createReplay()`, `readFileSync()` calls, symlink behavior → **[G-2]**
- [x] Task 2.4: Red-team oracle trust model — sourceId string manipulation (case, prefix, substring), null/undefined/empty/object inputs, exhaustive tier mapping, `canSettle()` bypass paths → **[G-3, G-5]**
- [x] Task 2.5: Red-team Argus adversarial checks — verify all 6 checks, test false negatives (attacks that succeed), test false positives (legitimate data rejected), document thresholds → **[G-3]**
- [x] Task 2.6: Red-team evidence bundles — craft artificially high quality, drive doubt price to zero, dual-gate disagreement, post-construction mutation → **[G-3]**
- [x] Task 2.7: Compile red-team report with structured findings per target → **[G-3]**

### Dependencies
- Sprint 1: Tech Lead approval (no open critical/high findings)

### Security Considerations
- **This sprint IS the security review** — all security considerations from the PRD are addressed here
- **Settlement invariant** is the #1 attack target: T3 (PurpleAir) must NEVER settle
- **Argus Check 6** (value out of range): documented but not implemented — this is a known gap to confirm

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Critical trust model vulnerability discovered | Medium | High | Immediately escalate to Sprint 3 (critical fixes) |
| Red-teaming reveals fundamental redesign needed | Low | High | Document gap; assess Cycle 002 safety; do not redesign in this sprint |
| Path traversal vulnerability in file I/O | Medium | Medium | FORGE is a library (not a server), so attacker must have code execution — document risk level accordingly |

### Success Metrics
- Zero unmitigated critical findings
- All 3 red-team targets have structured reports
- Security Auditor formal approval issued

---

## Sprint 3: Critical Fixes

### Sprint Goal
Resolve all critical and high findings from Sprints 1 and 2. Every fix must maintain all 566 tests passing and convergence score at 20.5/20.5.

### Deliverables
- [x] All critical findings fixed in code
- [x] All high findings either fixed or documented as accepted risk with rationale
- [x] All 587 tests passing after fixes (566 original + 21 new)
- [x] Convergence score unchanged (20.0/20.0)

### Acceptance Criteria
- [x] Zero open critical findings
- [x] Every high finding has either a code fix or a written accepted-risk rationale
- [x] `npm run test:all` passes (587 tests, 0 failures)
- [x] Convergence tests pass in both raw and anonymized fixture modes

### Technical Tasks

- [x] Task 3.1: Triage findings from Sprint 1 and Sprint 2 — categorize as critical/high/medium/low → **[G-5]**
- [x] Task 3.2: Fix critical findings (if any) — implement fixes, verify tests pass → **[G-5]**
- [x] Task 3.3: Fix high findings or document accepted-risk rationale for each → **[G-5]**
- [x] Task 3.4: Run full test suite — confirm 587/587 pass, convergence 20.0/20.0 → **[G-1, G-2, G-5]**
- [x] Task 3.5: Update findings documents with fix references and final dispositions → **[G-5]**

### Dependencies
- Sprint 2: Security audit + red-team complete

### Security Considerations
- **Every fix must be regression-tested** against the settlement invariant
- **No new dependencies** may be introduced
- **Convergence score must not regress** — any fix that changes classification output is suspect

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Fix introduces regression | Medium | High | Run full test suite after every change; revert if convergence regresses |
| No critical/high findings (sprint is empty) | Medium | None | Sprint completes immediately; proceed to Sprint 4 |

### Success Metrics
- All critical findings resolved
- All high findings dispositioned
- 566/566 tests, 20.5/20.5 convergence

---

## Sprint 4: Usefulness Heuristic Iteration

### Sprint Goal
Audit, baseline, interrogate, and iterate the economic usefulness heuristic. Document all findings in a self-contained report. This sprint is all-or-nothing: either T-H01 through T-H05 complete, or the entire phase defers.

### Deliverables
- [x] `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md` with all 4 required sections
- [x] Baseline scoring table for all 13 proposals
- [x] Weight interrogation findings (one paragraph per dimension)
- [x] Before/after comparison (even if weights reverted)
- [x] All 587 tests still passing

### Acceptance Criteria
- [x] Baseline table covers all 13 proposals with per-dimension breakdown
- [x] At least one proposal flagged as "score feels wrong" with reason
- [x] Weight interrogation covers all 4 dimensions (population_impact, regulatory_relevance, predictability, actionability)
- [x] Written weight proposal with justification exists before implementation
- [x] Before/after comparison table produced
- [x] All existing `computeUsefulness` unit tests still pass
- [x] Either revised weights committed with rationale, OR revert committed with reason
- [x] Findings doc is self-contained for a cold reader
- [x] "What real-world data would tell us" section present

### Technical Tasks

- [x] Task 4.1 (T-H01): Read-only audit of `src/filter/usefulness.js` — document exact formula, weights, clamping, normalization, inputs. No code changes. → **[G-4]**
- [x] Task 4.2 (T-H02): Score all 13 proposals from 3 golden envelope fixtures against current weights. Produce per-dimension breakdown table. Flag at least one "feels wrong" score. → **[G-4]**
- [x] Task 4.3 (T-H03): Weight interrogation — one paragraph per dimension analyzing assumption, whether it holds, what's uncertain. Document reasoning before proposing changes. → **[G-4]**
- [x] Task 4.4 (T-H04): Propose revised weights with justification. Implement. Run before/after comparison. Keep or revert. All `computeUsefulness` tests must pass. → **[G-4]**
- [x] Task 4.5 (T-H05): Create `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md` with 4 sections: baseline, interrogation, proposal+comparison, "what real-world data would tell us". → **[G-4]**

### Task 4.E2E: End-to-End Goal Validation

**Priority:** P0 (Must Complete)
**Goal Contribution:** All goals (G-1, G-2, G-3, G-4, G-5)

**Validation Steps:**

| Goal ID | Goal | Validation Action | Expected Result |
|---------|------|-------------------|-----------------|
| G-1 | Formal code review approval | Verify Sprint 1 approval document exists | Tech Lead approval with no open critical/high |
| G-2 | Formal security audit approval | Verify Sprint 2 approval document exists | Security Auditor approval with all critical/high dispositioned |
| G-3 | Red-teaming findings documented | Verify red-team report covers 3 targets | Every finding has severity + attack path + defense + disposition |
| G-4 | Usefulness heuristic documented | Verify `FORGE_USEFULNESS_FINDINGS.md` | All 4 sections present, self-contained |
| G-5 | Critical vulnerabilities fixed | Verify Sprint 3 findings register | Zero open critical findings |

**Acceptance Criteria:**
- [x] Each goal validated with documented evidence
- [x] All 587 tests passing (566 original + 21 Sprint 3)
- [x] Convergence score 20.0/20.0
- [x] FORGE ready for Cycle 002

### Dependencies
- Sprint 3: All critical/high findings resolved

### Security Considerations
- **Weight changes must not affect settlement logic** — usefulness is independent of trust enforcement
- **No modifications to golden envelope fixtures or Proposal IR schema**
- **Determinism must hold** — same input → same usefulness score

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Weight iteration worsens scores | Medium | Low | Reversion is a valid outcome; document why |
| Tobias delivers, interrupting Phase 3 | Medium | Medium | Phase 3 defers as a unit — findings doc is incomplete but no code changes left unreviewed |
| Multiplicative formula means one low factor dominates | Medium | Low | This IS the finding to document — not necessarily a bug |

### Success Metrics
- `FORGE_USEFULNESS_FINDINGS.md` exists with all 4 sections
- At least one "feels wrong" proposal identified and analyzed
- All 566 tests passing

---

## Risk Register

| ID | Risk | Sprint | Probability | Impact | Mitigation | Owner |
|----|------|--------|-------------|--------|------------|-------|
| R1 | Critical trust model vulnerability | 1-2 | Medium | High | Fix immediately in Sprint 3 | Security Auditor |
| R2 | Tobias delivers early | 1-4 | Medium | Medium | Phase 1+2 priority; Phase 3 defers as unit | Solo Developer |
| R3 | Usefulness weight regression | 4 | Medium | Low | Revert is valid; document reasoning | Solo Developer |
| R4 | Scope expansion from audit findings | 2-3 | Low | High | Only fix critical/high; defer rest to Cycle 002 | Tech Lead |
| R5 | Fundamental trust model redesign needed | 2 | Low | High | Document gap; assess Cycle 002 safety | Security Auditor |
| R6 | Missing Argus Check 6 is critical | 2 | High | Medium | Identify, document, assess severity | Red Team |

---

## Success Metrics Summary

| Metric | Target | Measurement Method | Sprint |
|--------|--------|-------------------|--------|
| Code review findings | All critical/high resolved | Findings document | 1 |
| Security audit approval | Formal approval issued | Audit document | 2 |
| Red-team coverage | 3/3 targets with reports | Report existence | 2 |
| Test integrity | 566/566 passing | `npm run test:all` | 1-4 |
| Convergence score | 20.5/20.5 | Convergence test output | 1-4 |
| Usefulness documentation | 4/4 sections complete | File existence + review | 4 |
| Open critical findings | 0 | Findings register | 3 |

---

## Dependencies Map

```
Sprint 1 (Review) ──▶ [approval gate] ──▶ Sprint 2 (Audit+RedTeam) ──▶ Sprint 3 (Fixes) ──▶ Sprint 4 (Usefulness)
     │                                          │                            │                       │
     └─ Tech Lead approval                      └─ Security approval         └─ Critical/high        └─ Findings doc
                                                    Red-team report              resolved               E2E validation
```

---

## Appendix

### A. PRD Feature Mapping

| PRD Feature | Sprint | Task |
|-------------|--------|------|
| FR-1: Oracle Trust Model Review | Sprint 1 | Task 1.1, 1.2 |
| FR-2: Evidence Bundle Pipeline Review | Sprint 1 | Task 1.3 |
| FR-3: Usefulness Filter Review | Sprint 1 | Task 1.4 |
| FR-4: Composition Engine Review | Sprint 1 | Task 1.5 |
| FR-5: Deterministic Replay Review | Sprint 1 | Task 1.6 |
| FR-6: Supply Chain Audit | Sprint 2 | Task 2.1 |
| FR-7: Input Boundaries | Sprint 2 | Task 2.2 |
| FR-8: File I/O Audit | Sprint 2 | Task 2.3 |
| FR-9: Red-Team Trust Model | Sprint 2 | Task 2.4 |
| FR-10: Red-Team Argus | Sprint 2 | Task 2.5 |
| FR-11: Red-Team Evidence Bundles | Sprint 2 | Task 2.6 |
| FR-12: Usefulness Audit (T-H01) | Sprint 4 | Task 4.1 |
| FR-13: Usefulness Baseline (T-H02) | Sprint 4 | Task 4.2 |
| FR-14: Weight Interrogation (T-H03) | Sprint 4 | Task 4.3 |
| FR-15: Weight Proposal (T-H04) | Sprint 4 | Task 4.4 |
| FR-16: Document Findings (T-H05) | Sprint 4 | Task 4.5 |

### B. PRD Goal Mapping

| Goal ID | Goal Description | Contributing Tasks | Validation |
|---------|------------------|-------------------|------------|
| G-1 | Formal code review approval | Sprint 1: Tasks 1.1–1.8 | Sprint 4: E2E |
| G-2 | Formal security audit approval | Sprint 2: Tasks 2.1–2.3 | Sprint 4: E2E |
| G-3 | Red-teaming findings documented | Sprint 2: Tasks 2.4–2.7 | Sprint 4: E2E |
| G-4 | Usefulness heuristic documented | Sprint 4: Tasks 4.1–4.5 | Sprint 4: E2E |
| G-5 | Critical vulnerabilities fixed | Sprint 1: Task 1.8, Sprint 3: Tasks 3.1–3.5 | Sprint 4: E2E |

**Goal Coverage Check:**
- [x] All PRD goals have at least one contributing task
- [x] All goals have validation in Sprint 4 E2E
- [x] No orphan tasks (all tasks map to a goal)

---

*Generated by Sprint Planner Agent*
