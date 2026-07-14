# Cycle-005 Master-Experiment Pre-Registration (binding, frozen at M3)

- **Status:** binding experiment governance. Pinned in the freeze manifest (FR-9b / FR-13). A post-freeze edit to this document, or to any pinned asset, **voids the experiment** (PRD §11 void condition 1).
- **Authored:** Cycle-004 S03 (T3.8). Not evaluated this cycle. Governs the Cycle-005 held-out experiment.
- **Provenance:** architecture 2026-07-10 §9:240-287 (arch §9); PRD (06-cycle-004-prd.md) §10:244-254, §11:260-273, FR-1/FR-5/FR-7/FR-8/FR-10/FR-11/FR-13, NFR-THRESH; SDD (07-cycle-004-sdd.md) DR-2/DR-4, Lane L3 §6:442-467, §6 L4:513, §6 L6:544, §9.1; Sprint Plan §8.3 T3.8:790-811.
- **Determinism note:** this is a *pre-registration*. The held-out family (primary/reserve) and `p*` are **not chosen here** — they are sealed for mechanical resolution at C-005 M4, post-freeze, post-census. No candidate feed is contacted and no held-out value is inspected by authoring this document.

---

## 1. Experiment ordering (E2 → E1)

**E2 — apparatus, freeze, then selection.** The binding order of operations (D2-corrected — the census procedure is frozen *before* the census executes; arch §9:264-274):

1. Define the candidate pool.
2. Define the eligibility criteria.
3. Define the mechanical selection rule.
4. Define the aggregate-only census procedure/code.
5. Define the experiment protocol, scoring, baseline hierarchy, thresholds, kernel, and harness (Cycle-004 S1–S3, validated against burned-domain + synthetic data only — M2).
6. **Freeze and content-address all of the above** (the freeze commit — M3).
7. Execute the aggregate-only census (the first external data contact; aggregates only) — M4.
8. Mechanically select the primary and sealed-reserve families — M4.
9. Fetch the full held-out values into quarantine (data manifest appended) — M5.
10. Run the frozen experiment (E1) — M6; evaluate mechanically; record the decision — M7.

**E1 — the single-parameter walk-forward** (steps 9–10) runs only on the mechanically-selected held-out family, from quarantine.

## 2. Candidate pool and mechanical selection rule

- **Pool:** the frozen enumeration in `lab/census/candidate-pool.json` (fixed `rank`: 1 USGS NWIS river stage/discharge; 2 NOAA CO-OPS coastal water level; 3 NOAA NDBC buoy wave height; 4 NWS/ISD station weather; 5 EIA hourly electricity demand + endogeneity flag). Enumeration order fixed at authoring; frozen at M3.
- **Eligibility:** the six mechanical gates in `lab/census/eligibility.js` (arch §9:244-250): (1) authority-published/public/machine-readable/free; (2) exogenous with authored judgment recorded; (3) history ≥ 3 years AND ≥ 10⁴ observations AND `existenceBound(n, "0.90") ≤ α/3` at the census-measured n; (4) mechanical outcome function declared; (5) zero provider-product matches against the frozen `lab/census/burned-list.json`; (6) documented revision/vintage semantics (tie-breaker only).
- **Selection rule** (`lab/census/selection-rule.js`; arch §9:262): iterate the pool in ascending `rank`, evaluate all gates on each candidate's census-measured aggregate metadata → **primary = first candidate passing all hard gates; reserve = second**, sealed. No human choice anywhere — nobody, operator included, chooses the outcome. The census itself executes only post-freeze (step 7).
- **Burned list:** pinned by reference to the frozen `lab/census/burned-list.json` (provider-product granularity).

## 3. Quarantine discipline and burn rules

- Held-out values are fetched into quarantine only at step 9 (M5), after the freeze and after mechanical selection. Metadata acquisition (census, step 7) is aggregate-only and separate from value acquisition.
- **Burn rule (arch §9:276):** a void before quarantine fetch (step 9) burns no family; from fetch onward, the burn ledger (`lab/ledgers/burn-ledger.jsonl`) records the family as consumed.
- **Reserve-retest restriction:** at most one reserve re-test without a new operator decision.

## 4. Parameter under test, target, and p* selection

- **Parameter:** `threshold` of the domain-neutral `statistical_threshold_gate`, reached via the explicit experimental derivation option (default `analyze()` untouched; derivation default-OFF pre-PASS). Target: exceedance rate `1 − p*` (arch §9:280).
- **Mechanical `p*` selection rule (FR-7; arch §9:280):** the largest `p*` ∈ {`"0.90"`, `"0.95"`, `"0.99"`} whose existence bound clears with ≥ 3× margin at the census-measured `n`. The value resolves mechanically at C-005 M4, **before any outcome exposure**. It is **not** chosen here.

## 5. Derived method under test

- **Method:** trailing-window empirical quantile — the thing under test. The adaptivity (windowing) is exactly what the naive baseline lacks; the experiment tests whether feed-locality adds out-of-sample value (arch §9:281).
- **Quantile semantics — HF-1:** Hyndman–Fan **Type 1** empirical quantile — pure order statistic, no interpolation, no division (the nine-definitions trap pinned shut). Computed in exact integer arithmetic per SDD DR-4 (`k = ⌈n·p⌉`; `Q̂(p) = v[k−1]`, 0-based). Order-statistic CI at α = 0.05.
- **Trailing-window rule (FR-1):** the window `W` is the smallest `W ≥ 90 days` containing ≥ `n_min` qualifying observations.
- **Frozen `n_min` = 59.** Pinned here (frozen at M3). Rationale: `n_min` = 59 is the mechanical existence minimum `n*(p, α)` at the derivation default `p = "0.95"`, `α = "0.05"` (`existenceMinN("0.95","0.05") = 59`), consistent with the landed harness window rule (`W≥90d,n_min=59`) and the SDD option shape. The code default remains the mechanical existence minimum; E1 passes this pre-registered value explicitly. The per-origin existence gate (§6) independently enforces `p*`-specific sufficiency via `existenceBound` at the resolved `p*`, so origins too sparse for a larger `p*` self-gate to `NO_INSTRUMENT` rather than relying on `n_min` alone.

## 6. Walk-forward schedule (H = 30 days, P = H)

- **Horizon** `H = 30 days` (`H_ms = 2_592_000_000`). **Purge gap** `P = H` (`purge_gap_ms = 2_592_000_000`), frozen this cycle.
- **Origin schedule (verbatim from SDD §6 L3:444 / Sprint T2.2, pinned into the run manifest `origin_rule`):** candidate origins are every UTC calendar-month boundary `m` (day 1, 00:00:00.000Z, `Date.UTC` integer arithmetic). An origin is eligible iff (a) `m − P ≥ t_min + min_days·DAY_MS` and (b) `m + H_ms ≤ tail_start_ms`. Evaluation-overlap control (distinct from the purge): iterate eligible origins ascending; keep `m` iff it is the first kept or `m − last_kept ≥ H_ms`.
- **Per-origin intervals (SDD DR-2):** with `train_cutoff_k = t_k − P`:
  - **training:** qualifying observations with timestamp `< train_cutoff_k` (i.e. `< training_cutoff_ms`);
  - **purge:** `[train_cutoff_k, t_k)` — excluded from training, never evaluated;
  - **evaluation:** outcomes in `(t_k, t_k + H]` from the full series;
  - the point `t_k` belongs to neither set.
- **Locked tail (SDD §6 L3:442):** `tail_start_ms = t_max − floor((t_max − t_min) / 5)` (exact integer arithmetic; ~20% of span). Normal mode structurally cannot touch the locked tail; the single final `--final` run (C-005 only) refuses without a valid freeze-manifest reference.
- **Existence gate (arch §9:282):** existence bound within `W` at every origin; failure at an origin ⇒ that origin emits `NO_INSTRUMENT` (counted in the rejection metrics, not silently skipped).

## 7. Rejected-origin semantics (F-2, verbatim from SDD §6 L3:453)

> an origin at which the derived method returns `NO_INSTRUMENT` **has no numeric derived estimate**, so **no derived-vs-baseline delta `Δ_k` exists for it**. Such an origin is therefore **excluded from the numeric pinball-improvement median and from the sign-test population**. It is **not** treated as a tie, a numeric zero, a synthetic loss, or a fabricated prediction, and it is **never silently dropped**. It **remains in the total eligible-origin denominator**.

Coverage is reported separately from superiority. The F-6 order-statistic-CI ties caveat holds: exact at nominal coverage under the continuous/no-ties model; conservative under discrete/rounded/tied feeds; never described as "exactly distribution-free" without that qualification.

## 8. Baseline hierarchy (five tiers, D3-accepted)

The **primary scientific comparison** (n = 1) is the derived trailing-window feed-local quantile vs the **naive expanding-window quantile** — the comparison that carries the evidence.

| Tier | Baseline | Role / source |
|---|---|---|
| Primary scientific baseline | **naive expanding-window quantile** (all history up to each origin `< training_cutoff_ms`; no windowing; identical HF-1 semantics; `hf1Quantile` from `src/derive/quantile.js`) | the comparison that carries the evidence — **built fresh** for the harness this cycle (NOT S07) |
| Derived method under test | trailing-window feed-local quantile | FR-1 kernel (`src/derive/`) |
| Legacy / reference baseline | transplanted authored constant under the **pre-registered frozen mapping** (below) | necessary to pass, never the headline |
| Additional simple baseline | persistence / previous-window (`persistenceForecast` from `src/baseline/persistence.js`, consumed verbatim) | reported; **losing to it downgrades PASS → PARTIAL** |
| Coverage baseline | no-instrument (reject-all), scored on the risk-coverage point (curves out of scope) | frames coverage |

- **Legacy-constant frozen mapping (evaluated table frozen here):** the constant is the numeric `threshold` of the burned-domain `threshold_gate` rule whose fixture's default-mode FeedProfile shares the most of the 5 profile dimensions with the target feed's profile; tie → lexical rule id. Numeric-threshold inventory: **{ seismic 5.0, kp 5, aqi 151 }**. The mapping rule was implemented in S02 T2.4; the evaluated table is frozen in this document.
- **Optional structural comparators** (the four S07 modules `base-rate`, `domain-priors`, `rolling-baseline`, `transition-frequency`): MAY be reported but are **never** members of the primary comparison (n = 1); logged as `exploratory` in the trials ledger.

## 9. Scoring

- **Primary:** mean **pinball (quantile) loss at the frozen `p*`** — both the derived method and every baseline estimate the same functional (the feed's `p*`-quantile), for which pinball is strictly proper. Comparison is the per-origin pinball-improvement median vs the naive baseline (and vs the constant), with a sign test across origins.
- **Secondary:** exceedance-rate calibration against target `1 − p*` within the pre-registered 95% binomial band.
- **Diagnostic only:** Brier score on the induced event forecast — **never** the primary parameter-comparison score.

## 10. Pre-committed pass/fail thresholds (PRD §10, copied VERBATIM)

The block below is copied verbatim from the binding PRD §10. It is the frozen pass/fail posture; it must not be restated, paraphrased, weakened, or altered after any held-out exposure (NFR-THRESH / D3).

The following thresholds are the D3-accepted planning baseline. Loa may refine implementation detail during SDD work but **must not weaken these epistemic thresholds or alter them after any held-out exposure** (arch §24:639).

- **Median per-origin pinball improvement > 0** against the **naive expanding-window baseline** (the primary comparison that carries the evidence) **and > 0 against the legacy transplanted constant** (necessary, never the headline).
- **Sign test p ≤ 0.05** across origins.
- **Exceedance calibration within the frozen 95% binomial band** against target `1−p*`.
- **Correct constructed rejection behavior** (100%/0% per AC-11 semantics, on the held-out starved variants).
- **Cross-runtime byte identity** of outputs/digests.
- **Zero post-freeze pin violations.**
- Losing to the persistence baseline downgrades PASS → PARTIAL (arch §9:284; recon §6:140). The seven pre-committed outcome branches and their follow-on cycles are arch §10:291-306; the decision is evaluated mechanically from the run manifest (C-005 M7).

## 11. Void conditions (PRD §11, copied VERBATIM)

The block below is copied verbatim from the binding PRD §11.

Any of the following **voids the experiment**:

1. Any post-freeze edit to a pinned asset.
2. Any new domain-named rule.
3. Any tuning against held-out outcomes.
4. Any exploratory variant promoted to primary.
5. Grading against the co-authored convergence specifications (they are transcription-fidelity checks, never validation).
6. Any candidate-data contact before M3.

A void before quarantine fetch (C-005 step 9) burns no family; from fetch onward, the burn ledger records the family as consumed (arch §9:276).

## 12. Trials ledger — exactly one primary comparison

- **n_trials = 1.** Exactly one `primary` comparison is pre-registered (one family, one parameter, one method, one score, one `p*`). The `primary` entry is appended to `lab/ledgers/trials-ledger.jsonl` in this task (T3.8) with a deterministic `registered_at_ms` from pinned configuration (never wall clock). The family and `p*` are registered as sealed placeholders resolved mechanically at C-005 M4 (naming a real family now would be a held-out selection — forbidden).
- **Exploratory multiplicity discipline:** every variation (other quantile levels, window lengths, optional S07 comparators) is logged as `exploratory` and reported with Holm–Bonferroni deflation at reporting time; no post-hoc promotion of an exploratory variant to primary (void condition 4).
- **Reserve-retest restriction:** at most one reserve re-test without a new operator decision.

## 13. Integrity guarantees (pre-committed)

- **No post-exposure threshold changes** (NFR-THRESH / D3): the pre-registered thresholds are the accepted epistemic standard; they must not be weakened or changed after any exposure to held-out values.
- **No grammar repair mid-experiment (G0 freeze):** the grammar is frozen during Cycle-004 and Cycle-005; the grammar version is pinned in the freeze manifest.
- **No in-flight product fix after freeze:** any post-freeze modification to a pinned asset voids the experiment (FR-13).

## 14. Authored-constant provenance notes

- `window_hours: 720` = the authored market duration equal to the horizon `H` (720 h = 30 days).
- `confidence: 0.50` = authored below the landed 0.70 floor.

These provenance notes accompany the transplanted-constant baseline; they document the origin of the authored constants used as the legacy/reference gate.
