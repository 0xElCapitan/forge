# Cycle-006 Successor Pre-Registration

**Status:** `ACCEPTED_AT_GATE_P` — **revision 1**
**Cycle:** cycle-006 · **Authority:** PRD C6-FR-P1/P2/P3/P7/P8, C6-FR-N4, C6-FR-T2 · SDD DR-2.2, DR-8, DR-9, DR-10 · Sprint Plan T2.2 / T2.3a

> **This document is authority.** EC accepted it at Gate P **as one unit** with the pool-entry criteria and the CI-line derivation worksheet; the acceptance record is `lab/evidence/cycle-006/gate-p-acceptance.json`. Gate P authorizes **materialization and verification only** — it does not authorize candidate enumeration, survey execution, provider contact, pool construction, successor freeze, commit, push, landing, or LU-2B. The acceptance is not yet operative for any survey act: the record must still be reviewed, exact-tree audited, committed, CI-verified, and landed.
>
> **No successor candidate has been nominated or evaluated.** This document names no prospective provider and no prospective product.

---

## 1. What this document does, and what it deliberately does not do

This pre-registration **adopts the frozen Cycle-005 experimental design by reference** and adds exactly the pre-registered conditions Cycle-006 requires. It is a short document on purpose.

**It does not restate the frozen design.** Nothing below restates — in normative form, in paraphrase, or as a parameter — any frozen threshold, window rule, walk-forward schedule, baseline tier, scoring rule, pass/fail block, void condition, or trials-discipline clause. Those live in the frozen document, are pinned by digest (§2), and remain in force **unchanged**. Restating them would create a second copy that could drift; referencing them cannot.

**It supersedes exactly two things** (§4), and nothing else.

**Every condition it adds is restrict-only** (§6, §7). A pre-registered condition added here may only **narrow** what may be sealed or accepted. None may admit a candidate, re-rank a pool, substitute a member, or modify the frozen rule's computation (C6-FR-P7).

---

## 2. Adoption of the frozen experimental design, by pinned reference

The Cycle-006 experiment **is** the Cycle-005 experiment. The design is adopted whole, by reference to these exact pinned bytes:

| Adopted artifact | Pinned identity |
|---|---|
| Frozen master pre-registration | `lab/preregistration/preregistration.md` @ `sha256:2023f67d8f1363fb020f5739d162bf80584f0cfd24f5d9d0f5a4c75a37e7fd05` (the digest the historical freeze manifest pins in its `assets[]`) |
| Historical freeze manifest companion | `sha256:d0c0f0cf875bcbcaa37dd89880057f249a55939aaee0f9e0fbf78a9ddbaf9d91` |
| Asset set covered by that freeze | 43 assets, all verifying byte-identical at the time of this drafting |

Adopted **without alteration**, by section reference into the pinned document:

- §1 experiment ordering;
- §4 parameter under test, target, and the p\* selection rule;
- §5 derived method under test;
- §6 walk-forward schedule;
- §7 rejected-origin semantics;
- §8 baseline hierarchy;
- §9 scoring;
- §10 pre-committed pass/fail thresholds;
- §11 void conditions;
- §12 trials-ledger discipline;
- §13 integrity guarantees;
- §14 authored-constant provenance notes.

Cycle-006 **adds no parameter to, removes no parameter from, and re-derives no value of** any of the above. Where this cycle's criteria document performs a derivation over frozen parameters (the cadence/history band), it does so as a **derivation input** with worksheet provenance, not as a restatement of the frozen design, and it changes no frozen value.

---

## 3. Adoption of the single primary comparison, by reference

| Field | Value |
|---|---|
| Trial | `c005-e1-primary-001` |
| Trials-ledger digest | `sha256:e0e30b3d20f4a81cd36d686ccbbb8dd8d34212a9410673ecc727b91e581f2422` |
| Ledger line count | 1 |
| `n_trials` | **1, program-wide** |

`c005-e1-primary-001` is Cycle-006's **single primary comparison**, adopted **by reference**. This cycle registers no new trial, no exploratory entry, and no second comparison.

**The trials ledger is never opened for write by any Cycle-006 component.** No survey, criteria, apparatus, census, selection, invariance, p\*, seal, evidence, or terminal-record path in this cycle writes to it. The ledger-write tokens are forbidden identifiers in every apparatus and survey namespace and are enforced by lint (standing invariant I-12). The digest above is the byte-identity that every Cycle-006 terminal record re-asserts.

**The trial's placeholders resolve only by record, never by edit.** The `family` and `p` placeholders standing in the ledger line resolve **only** through Cycle-006 M4 records that cross-reference the trial by `trial_id`. They are never resolved by editing the ledger.

**An unspent trial stays unspent.** A sealed "none eligible" outcome, or any disposition-B ending, leaves `c005-e1-primary-001` **unspent and unresolved** — never consumed, never failed, never marked. That is the correct accounting of a cycle that did not reach a mechanical resolution, and it preserves the single-trial budget for a later cycle.

---

## 4. Supersession clauses — exhaustive, exactly two

This pre-registration supersedes the frozen master pre-registration in **exactly two** respects, by new artifact at a new path. Nothing else in the frozen document is superseded, weakened, or re-scoped. This list is closed.

**S-1 — Pool constitution (frozen §2), superseded for Cycle-006 execution only.**
The frozen §2 candidate-pool binding is superseded, **for Cycle-006 execution**, by the Cycle-006 pool-entry criteria document plus the successor candidate pool constituted under it. The **mechanical selection rule of frozen §2 is not superseded** — it is adopted unchanged and executes unmodified over the successor pool. The historical pool remains frozen history: its bytes are untouched, still pinned, and still verify.

**S-2 — Resolution-cycle labels, superseded administratively.**
The administrative "Cycle-005" resolution labels attached to the adopted trial's placeholders are superseded by Cycle-006 as the **anticipated** mechanical resolution cycle. This is an administrative relabeling of *which* cycle is expected to resolve the placeholders. It changes no resolution rule, no threshold, and no semantics, and it does not itself resolve anything.

---

## 5. Outcome-blind acquirability — the ground of the redraw (NFR-C6-BLIND)

The Cycle-006 pool is redrawn on **acquirability**, not on outcome, and the record supports that claim mechanically:

- **Zero families consumed.** No candidate family has been spent.
- **Burn ledger: 0 bytes.** No burn has ever occurred, in any cycle.
- **No census ever ran.** The frozen census has never executed against any real candidate; no measured value from any prospective candidate exists anywhere in this repository.
- **No prospective candidate has been nominated or evaluated** under these criteria (C6-FR-N4). The criteria were authored, and this document was drafted, before any candidate existed.

The redraw's ground is therefore **structural**: the Cycle-005 pool could not seal because the acquisition path to the required aggregate count surface was unresolved, not because any outcome was observed and disliked. There is no outcome to have been blind to.

**Historical candidates carry no privilege and no penalty.** A Cycle-005 pool member may re-enter only by satisfying the criteria through the same mechanical survey as every other candidate. The carried-forward count-surface analyses are **prior evidence** informing the criteria standards; they admit, reject, rank, and pre-select no one (C6-FR-N6).

---

## 6. Pre-registered runnability validity condition (C6-FR-P8) — restrict-only

**Pre-registered here; enforced mechanically by the successor apparatus.**

Every candidate admitted to the successor pool is experimentally runnable **by construction**, because admission requires a non-empty runnability band with a recorded positive margin (criteria §(c)/(d)). The post-selection condition is the second half of that guarantee.

**The condition.** After the frozen rule produces its (primary, reserve) outcome and after the bounded FR-D2 verdict, and **before any seal is treated as authoritative**, each sealed member — primary and reserve alike — is checked:

1. its census-measured cadence maps to an admissible cadence class of the criteria, by **exact class-string match** against the pinned criteria machine block;
2. its census-measured history meets the envelope floor for that class;
3. that class's band is non-empty under the **pinned** worksheet constants — re-read from the successor-pinned worksheet, never recomputed from live measurements.

**On pass** — a runnability-validity record is written and the seal may be treated as authoritative.

**On failure** — the seal is **not accepted**. The mechanically computed selection outcome is preserved as a **provisional, non-authoritative artifact**, an invalidation-by-reference record is written, and the cycle ends in the typed terminal disposition `runnability-violation` with operator adjudication.

**What it can never do.** It never re-ranks. It never substitutes a member. It never edits the computed outcome. It never modifies the frozen rule's computation. It can only convert *seal* into *typed terminal disposition* — restrict-only, in exactly one direction (C6-FR-P7, C6-FR-D6).

---

## 7. Pre-registered bounded-FR-D2 posture — restrict-only

The inherited FR-D2 invariant is **unchanged**: a seal is permitted only when, for every candidate not resolved to a resolved class, the frozen rule's (primary, reserve) outcome is provably unaffected by whichever way that candidate would ultimately resolve; any throw means unresolved, which means no seal.

Cycle-006 changes only the **mechanics** of evaluating that invariant — a closed-form evaluation, linear in the number of unresolved candidates, executed entirely through the frozen selection rule — and adds pre-registered **bounds**:

| Bound constant | Role | Value, fixed at Gate P (packet P-2b) |
|---|---|---:|
| `k_max` | maximum simultaneously-unresolved candidates the evaluator will accept | **6** |
| `probe_budget` | ceiling on `2 full + 3k single` frozen-rule probes | **20** |
| `n_ceiling` | ceiling on any observation count entering an existence-bound computation | **24 120 603 015** |
| `corroboration_budget` | projected-cost ceiling under which the definitional enumeration ALSO runs, as corroboration | **1000 ms** |

`k_max = 6` equals the Gate-P `max_pool`, so a lawful full-pool simultaneously-unresolved state remains evaluable rather than escalating. `probe_budget = 20` is `2 + 3×6` exactly — the formula's intended exact fit, not a breach. The associated `wall_clock_target_seconds = 60` is an **operator-fixed policy value, not a frozen empirical constant**; it is the target `n_ceiling` was sized against on the measured CI-line slope.

The measured cost slope backing these values is recorded pre-freeze in the CI-line derivation worksheet with four-leg provenance. The values themselves are EC's, fixed at Gate P over that evidence, carried in the accepted criteria machine block under `fr_d2_bounds`, and quoted in the Gate-A package.

**Bound breach is a typed fail-closed escalation, never a seal.** Exceeding `k_max` produces `FR_D2_KMAX_EXCEEDED`; exceeding the probe budget or `n_ceiling` produces `FR_D2_BUDGET_EXCEEDED`. Both are specification-class escalation records. There is never a hang, never a partial verdict, never a silent preference, and never a seal produced under a breached bound.

**Corroboration keeps the definitional form alive.** When the projected cost of the definitional enumeration falls under `corroboration_budget`, that enumeration **also** runs through the frozen rule and its verdict is asserted equal to the closed form's. Disagreement is a specification-error HALT, never a silent preference for either.

---

## 8. Ending semantics this cycle pre-registers

**A sealed "none eligible" is a real result.** If the frozen rule finds no eligible member, that is a mechanical outcome of the pre-registered rule over an operator-accepted pool — not a failure of the cycle, not a failure of the pool, and not a reason to revisit the criteria. The adopted trial stays unspent (§3).

**A disposition-B ending is reason-bearing, not a failure.** Every ending carries exactly one type and a reason. The pre-freeze endings this cycle can lawfully reach include `no-lawfully-constitutable-pool` (a complete sweep admitting fewer selection-relevant members than the Gate-P minimum) and `pre-freeze-halt`; the post-freeze endings include `runnability-violation` (§6). Every terminal record — in either authority form — re-asserts the historical preservation proof (the 43-asset freeze and the 13 Cycle-005 chain links, byte-identical) and both ledger proofs (trials digest unchanged, burn ledger 0 bytes).

**Recording never rewrites.** Superseded artifacts are invalidated **by reference** in a new record; they are never edited and never deleted.

---

## 9. Scope: the M4│M5 hard stop

Cycle-006 is **M4-scope only**, under every disposition.

Nothing in this pre-registration authorizes, schedules, implies, or pre-approves: a quarantine fetch; the retrieval or persistence of any held-out value; any burn of any family; or any M5 act whatsoever. A sealed M4 result is **not** an M5 authorization. Any future burn requires, at minimum, a fresh operator burn authorization in a later cycle, a burn-lawful acceptance framework, a reserve-runnability re-confirmation, and CI-line re-derivation currency at burn time. The burn ledger remains at 0 bytes throughout this cycle.

---

## 10. Claim ceiling

The standing FORGE capability claim ceiling is preserved verbatim and is **not** raised by anything in this cycle:

> "FORGE can emit a local, content-addressed ConstructAdmissionBundle producer artifact for the narrow BREATH worked path matching the Cycle-113 receiving-surface shape — and nothing stronger."

Cycle-006 success — even a sealed primary and reserve with a resolved p\* — adds **no new capability claim**. Specifically prohibited in every artifact and communication of this cycle: that the Instrument Compiler thesis has been validated or rejected; that any derived instrument works, beats a baseline, or will; that any sealed family or resolved p\* is "good" (resolution is mechanical, not evaluative); that a sealed M4 result implies, schedules, or pre-approves an M5 burn; that DD-1 or DD-2 is unlocked or advanced; any promotion of future-looking architecture into present capability; any claim about the eligibility, quality, or reliability of a provider or product beyond the mechanical census record itself.

A product or scientific claim raised **from an M4 result** is a scientific-integrity violation.

---

## 11. Companion artifacts — accepted-at-Gate-P identity

> **These digests are ACCEPTED IDENTITY.** EC accepted them at Gate P as one unit with this document, and the `gate-p-acceptance.json` record names all three. They are no longer provisional: from the acceptance forward, a byte change to either file is **not** a new provisional digest but a criteria amendment — a full re-issue with a bumped revision, a new Gate-P acceptance record naming the superseded record and digests, and a complete re-survey (§12; criteria §16). The survey tooling enforces the first half mechanically: it refuses to run when the criteria bytes on disk do not digest to the value the Gate-P record accepted.

| Artifact | Path | Accepted digest |
|---|---|---|
| Pool-entry criteria (`GATE_P_FIXED`, revision 1) | `lab/preregistration/cycle-006/pool-entry-criteria.md` | `sha256:aec400164f717bb6abd674a3921d1924a777726b588f875f1ac982b9f9a4e231` |
| CI-line derivation worksheet (byte-unchanged at Gate P) | `lab/preregistration/cycle-006/criteria-derivations.json` | `sha256:5254af545df43e8230d3fdb09af04228c2646978f18a89aca1adaf57607b6f5e` |

The worksheet digest is **unchanged from drafting**: Gate P fixed policy values in the criteria machine block, this document, and the acceptance record, and left the measured derivation evidence byte-for-byte alone.

EC accepted **three digests as one unit**: this document, the criteria document, and the derivation worksheet. This document's own digest is carried in the acceptance record as `successor_prereg_digest` — it is not restated here, because a document cannot contain its own digest. Every later survey, enumeration, pool, freeze, and Gate-A artifact cites the accepted `criteria_digest`.

---

## 12. Amendment

**Before Gate P** — this document was a draft and could be revised freely; nothing depended on it. **That phase is over.**

**After Gate P, before Gate F — where this document now stands.** An amendment is a **full re-issue**: new bytes at this path with a bumped revision, a new Gate-P acceptance record naming the superseded record and digests, and — where the criteria are also amended — a **complete** re-survey and re-enumeration. Superseded artifacts stay tracked and are cited by digest in the terminal record.

**After Gate F** — this document is successor-pinned. Any change is void-condition semantics: HALT, never an edit.
