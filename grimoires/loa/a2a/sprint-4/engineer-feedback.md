# Sprint 4 Code Review: Engineer Feedback

**Sprint:** 4 — Usefulness Heuristic Iteration
**Reviewer:** Senior Tech Lead
**Date:** 2026-03-28
**Verdict:** All good

---

## Overall Assessment

Sprint 4 is a pure analysis sprint — zero net code changes, zero new dependencies. All 5 tasks (T-H01 through T-H05) completed. The findings document is thorough, well-structured, and self-contained. The weight reversion decision is well-reasoned with clear rationale.

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Baseline table covers all 13 proposals with per-dimension breakdown | PASS |
| At least one proposal flagged as "score feels wrong" with reason | PASS — CORONA (0.1454) and TREMOR identical scores |
| Weight interrogation covers all 4 dimensions | PASS |
| Written weight proposal with justification exists before implementation | PASS |
| Before/after comparison table produced | PASS |
| All existing computeUsefulness unit tests still pass | PASS — 587/587 |
| Revised weights committed with rationale OR revert committed with reason | PASS — reverted with 4-point rationale |
| Findings doc is self-contained for a cold reader | PASS |
| "What real-world data would tell us" section present | PASS — 5 testable hypotheses |

---

## Findings Document Quality

The `FORGE_USEFULNESS_FINDINGS.md` document is strong:

- **Section 1 (Baseline):** Complete per-dimension breakdown for all 13 proposals. Scores validated against snapshot data. Two "feels wrong" flags with clear reasoning.
- **Section 2 (Interrogation):** Each dimension gets assumption/holds/uncertain treatment. Regulatory relevance correctly identified as strongest assumption. Population impact correctly identified as weakest.
- **Section 3 (Proposal):** Before/after comparison is clean. Reversion rationale is substantive — identifies classification vs. weighting distinction.
- **Section 4 (Real-World Data):** Five concrete, testable hypotheses with specific data requirements.
- **Appendix (Audit):** Code structure mapped with line numbers. Actionability double-counting asymmetry correctly identified.

---

## Adversarial Analysis

### Concerns Identified (3)

1. **CORONA snapshot has 0 proposals** (forge-snapshots-corona.json): The 5 CORONA proposals in the baseline table come from the convergence spec expectations, not from the actual snapshot. The snapshot shows `"proposals": []` and `"proposals_count": 0`. This is correctly handled — the scoring uses the feed profile and expected templates — but a cold reader might wonder why the snapshot has no proposals. Non-blocking: the findings doc could note this.

2. **Actionability double-counting not flagged as a bug**: The audit identified that regulatory threshold type is counted twice (in `regulatoryRelevance` AND in `actionability`'s `thresholdBase`). This amplifies the gap between regulatory and non-regulatory feeds. The document notes it as a "design note" but doesn't recommend whether to fix it. Non-blocking: this is a Cycle 002 decision.

3. **13 proposals but only 3 distinct score values**: The multiplicative, feed-centric formula means all proposals within a feed score identically. The baseline table has 13 rows but effectively only 3 data points (BREATH=0.3452, CORONA=0.1454, TREMOR=0.0594). The document flags this ("template type has zero influence") but doesn't explore whether this is acceptable or whether a template-sensitive factor should be added. Non-blocking: documented for Cycle 002.

### Assumptions Challenged (1)

- **Assumption**: The "13 proposals" in the sprint plan refers to convergence spec expected templates.
- **Risk if wrong**: If the sprint plan intended proposals from a different source (e.g., running the pipeline at runtime), the baseline might miss proposals.
- **Recommendation**: The interpretation is reasonable — the snapshots only contain 6 proposals (5 TREMOR + 1 BREATH), and the convergence specs define 13 expected templates. The scoring approach is valid.

### Alternatives Not Considered (1)

- **Alternative**: Score proposals at multiple tier levels (T0/T1/T2/T3) to produce a richer baseline — 13 proposals × 4 tiers = 52 data points.
- **Tradeoff**: More data points but more complex table. The current approach uses actual source tiers from snapshots, which is more grounded.
- **Verdict**: Current approach is justified — using actual source tiers reflects real-world configuration.

---

## Documentation Verification

| Item | Status |
|------|--------|
| Findings document at grimoires/pub/ | PASS |
| No code changes to verify in CHANGELOG | N/A — no net code changes |
| Reversion documented with rationale | PASS |

---

Concerns documented but non-blocking. See Adversarial Analysis above.
