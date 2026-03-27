# FORGE — Pre-002 Holding Sprint

> **Cycle**: pre-002
> **Created**: 2026-03-27
> **PRD**: grimoires/loa/prd.md
> **SDD**: grimoires/loa/sdd.md
> **Status**: Cycle 001 complete (Sprints 1–12). Cycle 002 blocked on Tobias delivering
> canvas redesign docs and potential new IR requirements.
> **Team**: Solo + AI agent
>
> **Purpose**: Use the wait productively. All work in this sprint is FORGE-internal.
> Nothing here touches the Echelon seam, the IR contract, or the golden envelopes.
>
> **HARD CONSTRAINTS — do not override under any circumstances**:
> - DO NOT begin second backing spec work (SWPC space weather). That is Cycle 002 scope.
> - DO NOT begin Echelon economic conversation prep. That is post-002.
> - DO NOT modify `spec/proposal-ir.json` or the golden envelope fixtures.
> - DO NOT modify `BUTTERFREEZONE.md` unless a finding in this sprint requires a correction.

---

## Overview

3 phases, executed in order:

| Phase | Work | Gate |
|-------|------|------|
| Phase 1 — Review | `/review-sprint` across Cycle 001 | Tech Lead approval |
| Phase 2 — Security Audit | `/audit-sprint` + deep adversarial review | Security Auditor approval |
| Phase 3 — Usefulness Heuristic | Iteration on `computeUsefulness` weights | Documented findings |

---

## Phase 1 — Code Review (Cycle 001)

Run `/review-sprint` across the completed Cycle 001 sprints (Sprints 1–12).

**Standard Tech Lead review pass applies.** In addition, give heightened attention to the
following areas. These are not the only things to review — they are the areas where the
cost of a defect is highest.

### Priority review targets

**`src/trust/oracle-trust.js`**
- `getTrustTier(sourceId)` — complete source-ID-to-tier mapping. Are there gaps? What happens with an unrecognized source ID — is the fallback `'unknown'` handled safely everywhere it is consumed?
- `canSettle(tier)` — single boolean gate. Verify it returns `false` for T2, T3, and `'unknown'`. There must be no path that returns `true` for anything other than T0 and T1.
- `validateSettlement(sourceId)` — the richer form. Verify the `reason` field is populated for all rejection paths. Downstream consumers may log this.
- `checkAdversarial(bundle)` — adversarial detection. See Phase 2 for the deep pass; in Phase 1 confirm the function is wired into `buildBundle` and cannot be bypassed by the caller.
- `checkChannelConsistency(bundle)` — same wiring check.

**`src/processor/bundles.js`**
- `buildBundle(rawEvent, config)` — the assembly point. Verify that adversarial checks and trust enforcement run on every call path, including edge cases (empty event, malformed event, missing config fields).
- `assignEvidenceClass(bundle)` / `canSettleByClass(bundle)` — confirm these are consistent with `canSettle()` in `oracle-trust.js`. There must not be two separate settlement gates that can disagree.
- `computeQuality(rawEvent)` and `computeDoubtPrice(rawEvent)` — review for numeric edge cases (zero variance, single-event feeds, all-identical values).

**`src/filter/usefulness.js`**
- `computeUsefulness(proposal, feedProfile, options)` — note any structural issues for Phase 3.
- Four dimensions: `market_depth`, `settlement_clarity`, `temporal_fitness`, `novelty`. Confirm all four are computed and that the composite is a true 0–1 score with no silent clamping or NaN propagation.

**`src/composer/compose.js`**
- `proposeComposedTheatre` — three composition rules. Review rule ordering and confirm `null` return is clean when no rule fires. Check that `lag_ms: 0` and `leader: 'concurrent'` edge cases are handled correctly.

**`src/replay/deterministic.js`**
- Confirm determinism: same fixture path, same options → byte-identical output. Any source of non-determinism (e.g. `Date.now()`, `Math.random()`, object key ordering) is a defect.

### Phase 1 exit gate

`/review-sprint` must produce a formal approval or a list of findings to address before
Phase 2 begins. Do not proceed to Phase 2 with open critical or high findings.

---

## Phase 2 — Security Audit + Adversarial Review

Run `/audit-sprint` across Cycle 001 first. Then run `/red-teaming` as described below.

### Part A — `/audit-sprint` (Security Auditor pass)

Standard Paranoid Cypherpunk Auditor pass. In addition, focus on:

- Supply chain: confirm zero external runtime dependencies. `package.json` must have no
  `dependencies` key, or an empty one. `devDependencies` are irrelevant to runtime security.
- Input boundaries: `ingest()` and `ingestFile()` accept arbitrary JSON. What happens with
  malformed input, circular references, payloads exceeding memory limits, or adversarially
  crafted numeric values (Infinity, NaN, -0, values exceeding Number.MAX_SAFE_INTEGER)?
- File I/O: `ingestFile()` and `createReplay()` accept file paths. Is path traversal possible?
  Are symlinks followed? Is there any user-controlled string that reaches `fs.readFile` or
  equivalent without sanitization?

### Part B — `/red-teaming` on the trust model and adversarial gate

This is the primary adversarial work of this sprint. Run `/red-teaming` against the
following components and their design documents. The goal is to find attack scenarios that
the current implementation does not defend against — not to find bugs in the code, but to
find gaps in the threat model.

#### Target 1: Oracle Trust Model (`src/trust/oracle-trust.js`)

The trust model is the core security property of FORGE. A bypass here means a T3 source
(e.g. PurpleAir community sensors) could settle a theatre — which is the attack that the
entire model exists to prevent.

Red-team questions to drive the attack scenarios:
- Can a caller construct a `sourceId` string that maps to T0 or T1 when it should not?
  (String normalization, case sensitivity, prefix matching, substring attacks.)
- What happens if `getTrustTier` is called with `null`, `undefined`, an empty string, a
  very long string, or an object instead of a string?
- Is the tier mapping exhaustive? Are there real-world source IDs that FORGE would encounter
  in production (USGS automatic feed, SWPC GOES, AirNow) that are not in the current
  mapping and would therefore fall to `'unknown'`? What does FORGE do with `'unknown'`?
- Is `canSettle()` the only enforcement point, or are there code paths that skip it?
  Specifically: can a Theatre be instantiated from a proposal without ever calling
  `canSettle()`?

#### Target 2: Argus — The Six Adversarial Checks (`src/trust/oracle-trust.js`, `checkAdversarial`)

Argus's six checks are the adversarial gate on every evidence bundle. The name is deliberate:
the hundred-eyed watchman who never sleeps. The symbol is the peacock 🦚.

Current checks (verify these are all present and enumerate what is actually implemented):
1. Frozen data detection
2. Clock drift detection
3. Sybil pattern detection
4. Spoofing detection
5. Channel consistency (via `checkChannelConsistency`)
6. [Verify the sixth check in the source — document it explicitly]

Red-team questions for each check:
- **Frozen data**: What is the detection threshold? Can an attacker submit data that
  slowly drifts (not strictly frozen) and evade detection?
- **Clock drift**: What is the tolerance window? Can an attacker replay historical data
  with timestamps shifted to appear current?
- **Sybil patterns**: How are sybil clusters detected in a single-source feed? What if
  an attacker controls multiple nominally distinct sources?
- **Spoofing**: What signals indicate spoofing? Can an attacker mimic a T1 source's
  statistical fingerprint?
- **Channel consistency**: What constitutes inconsistency? What if a feed is internally
  consistent but systematically wrong?
- **[Sixth check]**: [Document and red-team once identified]

For each check: what is the worst-case false negative (an attack succeeds), and what is
the worst-case false positive (legitimate data rejected)?

#### Target 3: Evidence Bundle Spec (`src/processor/bundles.js`)

The evidence bundle is the unit of settlement input. If the bundle can be constructed to
misrepresent the underlying data, the settlement outcome is compromised.

Red-team questions:
- `computeQuality(rawEvent)`: quality score feeds into doubt pricing. Can an attacker
  craft an event that scores artificially high quality, reducing doubt price and making
  the market cheaper to manipulate?
- `computeDoubtPrice(rawEvent)`: what is the floor? Can doubt price be driven to zero?
  What does a zero doubt price mean for settlement security?
- Can `assignEvidenceClass` and `canSettle` disagree? If so, which one wins, and is that
  documented and intentional?
- Is the bundle object immutable after construction, or can it be mutated by the caller
  before settlement?

### Part C — Document all findings

For each attack scenario identified:
- Severity: Critical / High / Medium / Low
- Attack path: step-by-step
- Current defense (if any)
- Recommended fix or acknowledged accepted risk
- Whether the fix is in-scope for this sprint or deferred

### Phase 2 exit gate

`/audit-sprint` approval required. Red-teaming findings documented in a structured report.
Critical and High findings must have a disposition (fix or accepted risk with rationale)
before Phase 3 begins.

---

## Phase 3 — Economic Usefulness Heuristic Iteration

**Context**: `computeUsefulness` (`src/filter/usefulness.js`) scores a Theatre proposal
across four dimensions and returns a 0–1 composite. The current implementation uses equal
weights. Equal weights are probably wrong. This is the most valuable IP in FORGE and the
least finished. This phase interrogates the weights using the existing backing specs as
ground truth.

### T-H01: Audit current weight implementation

**Description**: Read `src/filter/usefulness.js` in full. Document:
- The exact formula for each of the four dimensions: `market_depth`, `settlement_clarity`,
  `temporal_fitness`, `novelty`
- The current weighting scheme (equal or otherwise)
- Any clamping, normalization, or edge-case handling
- What inputs are actually used from `proposal`, `feedProfile`, and `options`

**Acceptance criteria**:
- A written summary of the current formula exists before any changes are made
- No code changes in this task — audit only

**Effort**: XS

---

### T-H02: Score all three backing specs against current weights

**Description**: Run `computeUsefulness` against every proposal in the three golden
envelope fixtures:
- `fixtures/forge-snapshots-tremor.json` (5 proposals, seismic)
- `fixtures/forge-snapshots-corona.json` (5 proposals, space weather)
- `fixtures/forge-snapshots-breath.json` (3 proposals, air quality)

For each proposal, record:
- `proposal_id`
- `template`
- Score for each dimension: `market_depth`, `settlement_clarity`, `temporal_fitness`, `novelty`
- Composite score
- Subjective assessment: does this score feel right given what this market is and who would trade it?

Produce a table. This is the baseline.

**Acceptance criteria**:
- All 13 proposals scored
- Table produced with per-dimension breakdown
- At least one proposal flagged as "score feels wrong" with a written reason

**Effort**: S

---

### T-H03: Interrogate weight assumptions

**Description**: Using the baseline table from T-H02, reason through the weight assumptions
explicitly. For each dimension:

**`market_depth`**: Does a market with low depth (niche audience) deserve a low usefulness
score? Or does a precise, niche market have high value precisely because it is hard to
replicate? Which FORGE backing spec domains are niche vs broad?

**`settlement_clarity`**: Is settlement clarity binary (it either resolves or it doesn't)
or continuous? How does trust tier affect this score? A T0-settled market should score
higher than a T1-settled market — is that currently reflected?

**`temporal_fitness`**: Does the current formula reward markets that resolve quickly?
Should it? A seismic cascade market that resolves in 24 hours is very different from a
regime shift market that takes 30 days — is one inherently more useful?

**`novelty`**: How is novelty currently measured? Against what baseline? This is the
hardest dimension to get right — a novel market that nobody trades is useless; a novel
market that fills a gap in the prediction market landscape is the most valuable thing
FORGE produces.

Document your reasoning. Do not change weights yet.

**Effort**: S

---

### T-H04: Propose revised weight scheme and test

**Description**: Based on T-H03, propose a revised weight scheme. The proposal must:
- Justify each weight relative to the others
- Predict which proposals in the baseline table will score higher or lower
- Not change the formula itself — only the weights

Implement the revised weights in `src/filter/usefulness.js`. Re-run the baseline table.
Compare before and after. Document whether the predictions from the proposal held.

If the revised weights make the results worse (by your judgment and against the backing
spec intuitions), document why and revert. The goal is learning, not optimization for
its own sake.

**Acceptance criteria**:
- Written weight proposal with justification exists before implementation
- Before/after comparison table produced
- All existing `computeUsefulness` unit tests still pass
- Either revised weights are committed with documented rationale, OR revert is committed
  with documented reason for reversion — both outcomes are valid

**Effort**: M

---

### T-H05: Document findings

**Description:** Create grimoires/pub/FORGE_USEFULNESS_FINDINGS.md and record all findings from T-H02–H04.

Context you need:

- The economic usefulness heuristic (population_impact × regulatory_relevance × predictability × actionability) is the most valuable IP in FORGE and the least finished. Equal weights are the current assumption and are probably wrong. Real-world iteration against live Echelon market performance is what will ultimately tell us the right weights — this document is the pre-live baseline so that iteration has something to compare against.
- The four dimensions currently implemented (market_depth, settlement_clarity, temporal_fitness, novelty) may or may not map cleanly to the four named above — note any discrepancy you find.

**Document must include:**

- The baseline scoring table from T-H02 (all 13 proposals, per-dimension breakdown)
- Written weight interrogation findings from T-H03 (one paragraph per dimension — what the assumption is, whether it holds, what's uncertain)
- The weight proposal and before/after comparison from T-H04
- A final section: "What real-world data would tell us" — what signals from live Echelon market performance would confirm or refute the revised weights

**Format**: plain markdown, written as operational notes not a polished document. Honest over optimistic.

**Acceptance criteria:**

- File exists at grimoires/pub/FORGE_USEFULNESS_FINDINGS.md
- All four sections present
- If weights were reverted in T-H04, document why — a reversion with a clear reason is a better outcome than a committed change without one
- File is self-contained — someone reading it cold should understand what was tested and what was learned

**Effort**: S

---

## Sprint Definition of Done

This holding sprint is complete when:

1. `/review-sprint` has produced a formal approval for Cycle 001 (Phase 1)
2. `/audit-sprint` has produced a formal approval for Cycle 001 (Phase 2, Part A)
3. Red-teaming findings for all three targets are documented with dispositions (Phase 2, Parts B–C)
4. Economic usefulness heuristic has been audited, interrogated, and iterated — with
   findings documented in `FORGE_LEARNINGS.md` (Phase 3)
5. All critical and high findings from review, audit, and red-teaming have been addressed
   or have documented accepted-risk rationale

**FORGE is then ready to receive Tobias's canvas redesign docs and begin Cycle 002
immediately, without carrying forward technical debt from Cycle 001.**
