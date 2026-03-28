# Sprint 4 Implementation Report: Usefulness Heuristic Iteration

**Sprint:** 4 — Usefulness Heuristic Iteration
**Date:** 2026-03-28
**Author:** Implementation Agent
**Status:** Complete — Awaiting Tech Lead Approval

---

## Executive Summary

Sprint 4 completed all 5 tasks (T-H01 through T-H05): formula audit, baseline scoring of all 13 proposals across 3 golden envelope fixtures, weight interrogation per dimension, weight proposal with before/after comparison, and findings document. Weights were reverted after analysis — the structural issue is density classification, not weight calibration. All 587 tests pass. No code changes committed (revert restored original).

**Zero code changes. Zero new dependencies. Pure analysis sprint.**

---

## Task 4.1 (T-H01): Read-Only Audit

**File:** `src/filter/usefulness.js` (123 lines, 0 dependencies)

Documented exact formula, all 4 factor tables, defaults, clamping behavior, and the actionability two-step computation asymmetry. Full audit in `FORGE_USEFULNESS_FINDINGS.md` Appendix.

**Key finding:** Actionability double-counts regulatory importance (once in `regulatoryRelevance`, again in `actionability`'s `thresholdBase`). This amplifies the gap between regulatory and non-regulatory feeds.

**No code changes.** Read-only task.

---

## Task 4.2 (T-H02): Baseline Scoring

Scored all 13 proposals from 3 golden envelope fixtures:
- **BREATH** (AirNow, T1): 3 proposals → all score **0.3452**
- **CORONA** (SWPC GOES, T1): 5 proposals → all score **0.1454**
- **TREMOR** (USGS, T1): 5 proposals → all score **0.0594**

Scores validated against snapshot data:
- BREATH snapshot `usefulness_scores["0"]` = 0.34520625 — **exact match**
- TREMOR snapshot `usefulness_scores["0"]` = 0.0594 — **exact match**

**"Feels wrong" flags:**
1. CORONA (0.1454) feels too low — GOES is a globally critical instrument penalized by `single_point` density
2. All 5 TREMOR proposals score identically — template type has zero influence on usefulness

---

## Task 4.3 (T-H03): Weight Interrogation

One paragraph per dimension analyzing assumption validity:

| Dimension | Assumption Holds? | Key Uncertainty |
|-----------|------------------|-----------------|
| Population Impact | Partially | `single_point` conflates global instruments with local sensors |
| Regulatory Relevance | Yes (strongest) | `physical` vs `statistical` boundary may be fuzzy |
| Predictability | Mostly | `event_driven` may undervalue high-signal episodic data |
| Actionability | Yes | Two-step computation creates asymmetric sensitivity |

Full analysis in `FORGE_USEFULNESS_FINDINGS.md` §2.

---

## Task 4.4 (T-H04): Weight Proposal

**Proposed change:** `DENSITY_IMPACT.single_point` from 0.25 to 0.40.

**Before/After:**

| Feed | Before | After | Delta |
|------|--------|-------|-------|
| BREATH | 0.3452 | 0.3452 | 0 |
| CORONA | 0.1454 | 0.2326 | +0.0872 |
| TREMOR | 0.0594 | 0.0594 | 0 |

All 587 tests passed with revised weight. All ordering invariants held.

**Decision: REVERTED.** Rationale:
1. Band-aid — also inflates genuinely low-coverage sensors
2. No calibration data to justify the specific value
3. Root cause is classification (need `single_global_instrument`), not weighting
4. Multiplicative formula domination is the structural issue

---

## Task 4.5 (T-H05): Findings Document

Created `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md` with all 4 required sections:
1. Baseline scoring table (13 proposals with per-dimension breakdown)
2. Weight interrogation (one paragraph per dimension)
3. Weight proposal + before/after comparison + reversion rationale
4. "What real-world data would tell us" (5 testable hypotheses)

Document is self-contained for a cold reader.

---

## Testing Summary

```
$ npm run test:all
ℹ tests 587
ℹ pass 587
ℹ fail 0
ℹ duration_ms ~305ms
```

All 587 tests pass (566 original + 21 Sprint 3). No new tests added (this sprint is analysis-only with no code changes).

Convergence scores unchanged at 20.0/20.0.

---

## Files Modified

| File | Changes |
|------|---------|
| `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md` | **Created** — findings document with all 4 sections |
| `src/filter/usefulness.js` | **No net change** — temporarily modified single_point weight, then reverted |

---

## Verification Steps

1. `npm run test:all` — 587 tests, 0 failures
2. Verify findings doc exists: `cat grimoires/pub/FORGE_USEFULNESS_FINDINGS.md`
3. Verify all 4 sections present: Baseline, Interrogation, Proposal+Comparison, Real-World Data
4. Verify baseline scores match snapshots: BREATH=0.34520625, TREMOR=0.0594
5. Verify at least one "feels wrong" flag: CORONA at 0.1454
6. Verify weight interrogation covers all 4 dimensions
7. Verify reversion rationale documented
8. Verify convergence scores unchanged at 20.0/20.0

---

## Known Limitations

- Weight analysis is theoretical — no real-world market data exists to calibrate against
- Findings document identifies structural issues (classification, multiplicative formula) that are beyond Sprint 4 scope
- Template type has zero influence on usefulness scores — this is a design limitation, not a bug
- Actionability double-counts regulatory importance — documented but not fixed (would change test expectations)

---

*Generated by Implementation Agent — Sprint 4 Usefulness Heuristic Iteration*
