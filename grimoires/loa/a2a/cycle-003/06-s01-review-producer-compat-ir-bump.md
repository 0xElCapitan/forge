# FORGE Cycle-003 Sprint 01 — Senior-Lead Review (Adversarial)

> **Verdict: PASS — ready for audit.** Zero confirmed blockers across all nine review-focus areas. Four
> non-blocking residuals noted (one is a real citation error in the implementation report; none affect code
> correctness or the claim ceiling). Both flagged design decisions adjudicated **acceptable**.

**Sprint:** `cycle-003-s01-producer-compat-ir-bump`
**Reviewer:** Loa `/reviewing-code` (adversarial), driving a 6-agent read-only verification workflow
**Date:** 2026-06-06
**Scope reviewed against:** cycle-003 PRD / SDD / sprint-plan / operator-decisions / implementation-report (`05-…md`)
**Stop condition honored:** review only — no audit, commit, push, integrate, tag, release, package bump, or Beads mutation. No implementation file edited (this review observes; it does not rewrite the artifact under review).

---

## Methodology — adversarial, independent

Per the operator's direction ("good use case for workflow from an adversarial pov"), this review ran a background
multi-agent workflow (`wap8a0twa`, 6 agents, 255 tool-uses, ~6.3 min). Five **read-only** `Explore` verifiers were each
told the engineer was Loa itself and instructed to **falsify** the implementation report's claims (treating it as claims,
not ground truth; "if you cannot independently confirm, mark uncertain — never assume the report is correct"). A sixth
agent built the strongest possible case *against* PASS.

The verifiers did **independent** work, not report-echoing — evidence:
- Re-ran `npm run test:all` → `848 pass / 0 fail`; `schema-validation` → `15/0`; `bundle-conformance-posture` → `11/0`.
- Re-emitted envelope/manifest/receipt via `node` and inspected `Object.keys` directly.
- Re-ran the trailing-word-boundary grep `\bemitted_at\b` over `src/` themselves.
- Re-computed digests, surfacing values **absent from the implementation report** — `now+1` manifest hash `af21bf01…`
  and bundle digest `a760eb8f…` — proving they recomputed rather than copied (report only carries the `PINNED_NOW`
  values, which they also reproduced exactly: bundle `991704ec…`, manifest `99c6b29c…`).
- Re-opened `settlement.js` and `markdown-members.js` to re-ground the two `normalization_trace` entries.

This multi-agent adversarial pass also satisfies the skill's Phase-2.5 cross-check intent (flatline not configured).

---

## Review-focus findings (1–9)

| # | Focus | Verdict | Key independent evidence |
|---|-------|:-------:|--------------------------|
| 1 | Branch/base hygiene | ✅ PASS | `git branch --show-current` = `cycle-003-s01-producer-compat-ir-bump`; `master` == `cycle-003-integration` == `715072c3` (untouched); `git log master..HEAD` empty (uncommitted); `git tag --points-at HEAD` = `v0.4.0` (pre-existing only), `git tag -l '*0.3.0*'` empty; no slash-form refs |
| 2 | Exact changed-file fence | ✅ PASS | `git status --short` = exactly the 8 authorized paths; report `05-…md` gitignored (State Zone) — `git check-ignore` confirms |
| 3 | Forbidden paths untouched | ✅ PASS | `package.json`, lockfiles, `.github/workflows/*`, `.claude/**`, `.beads/**`, `receipt/canonicalize.js`, `receipt/sign.js`, `receipt-v0.json`, `jcs-test-vectors.json`, `jcs-parity.spec.js`, `bundle/settlement.js`, `bundle-boundaries.spec.js`, `forge-snapshots-*.json`, `README.md`, `BUTTERFREEZONE.md`, `filter/usefulness.js`, composed_trust, runtime/CLI — all absent from diff |
| 4 | Rename complete + exact-key | ✅ PASS | node re-emit: envelope/manifest/receipt + serialized members all carry `emitted_at_ms` (integer), none carry `emitted_at`; `\bemitted_at\b` = **zero** in `assemble.js`/`receipt.js`/`fields.js`/`emit.js`; tests use `Object.keys(...).includes` / `JSON.parse` (parsed-key, **not** substring) at `ir.spec.js:472-475`, `bundle-conformance-posture.spec.js:139-149`; `forge-verify.spec.js:254` `emitted_at` is a **frozen v0.1.0 fixture** (not live output) — correctly excluded |
| 5 | IR 0.3.0 consistency | ✅ PASS | `proposal-ir.json` `$id`/`version`/`ir_version.const` all `0.3.0` (L3/6/16); `emit.js:28` `IR_VERSION='0.3.0'` (matches const — emitter coherent); `package.json` = `0.4.0` (diff empty); no `v0.3.0` tag; `schema-validation.spec.js` 15/0 |
| 6 | `normalization_trace` | ✅ PASS | schema `["array","null"]`, `items.additionalProperties:false`, 6 required fields, `method`/`source` enums + `confidence [0,1]` (L107-123); validator `assertNormalizationTrace` enforces the same (`emit.js:95-141`); BREATH populator populated (2 entries, not null/empty); both entries grounded against source (see §AC-4); STATED≠INFERRED non-collapse verified (`ir.spec.js:533`) |
| 7 | Determinism re-baseline | ✅ PASS | pinned-now ⇒ byte-identical bundle; `now` vs `now+1` ⇒ manifest hash moves (`99c6b29c…`→`af21bf01…`) while SKILL/reality/handoff hashes stay identical (no timestamp inside); digest move is deliberate + manifest-caused; markdown hashes match report |
| 8 | Claim ceiling | ✅ PASS | every ceiling-vocabulary hit in the diff is a **negative assertion** ("no ISO-8601", "never an admission/acceptance/scoring claim", "NOT a calibration or scoring value"); no populated `scoring.*`, no `composed_trust`/`can_settle`/`settlement_risk`/`risk_flags`, no signature build, no ISO-8601 field; `normalization_trace` framed as in-ceiling producer provenance |
| 9 | Two noted decisions | ✅ acceptable | See §Design-Decision Adjudication |

---

## Acceptance-criteria verification (sprint-plan AC-1…AC-4)

| AC | Verbatim (sprint-plan §6 Sprint 01) | Status | Evidence |
|----|--------------------------------------|:------:|----------|
| **AC-1** | "Every emitted bundle (manifest + receipt) and IR envelope carries `emitted_at_ms` as a Unix-ms **integer**; **no `emitted_at` key remains** anywhere in emitted output; no ISO-8601 string field exists." | ✓ Met | node re-emit + `Object.keys` on envelope/manifest/receipt + serialized members (all `emitted_at_ms`, integer, none `emitted_at`); `\bemitted_at\b` zero in producer code; schema keeps `type: integer` (`proposal-ir.json:36`), no ISO-8601 |
| **AC-2** | "`proposal-ir.json` `required[]` lists `emitted_at_ms` (not `emitted_at`); `$id` + `version` + `ir_version.const` all = `0.3.0`; `STABILITY.md` changelog records the breaking rename." | ✓ Met | `proposal-ir.json:9` required has `emitted_at_ms`; L3/6/16 all `0.3.0`; `STABILITY.md:39-64` "0.3.0 — Cycle 003 Sprint 01" records BREAKING rename + additive trace |
| **AC-3** | "Byte-determinism: identical inputs + fixed `now` → identical member hashes + identical `bundle_digest`; the manifest member hash + `bundle_digest` move **only** because of the deliberate key rename…; markdown member hashes … stay stable; receipt scalar `emitted_at_ms` stays outside the digest." | ✓ Met | `bundle-conformance-posture.spec.js` T8 11/0; independent now-vs-now+1 recomputation confirms manifest-only move, stable markdown hashes; report old→new pair (`8d7d0691…`→`991704ec…`) reproduced |
| **AC-4** | "`normalization_trace` emitted **populated** as the object-array with valid `method`/`source` enums; a `stated` entry and an `inferred` entry for the same `field` remain distinguishable (never collapsed)." | ✓ Met | BREATH populator emits 2 entries: `settlement_source` (`mapped`, grounded `settlement.js:52-54` `{airnow:'airnow'}`), `feed_id` (`stated`, grounded `markdown-members.js:115/119` `epa_airnow`→`epa_airnow_aqi`); `ir.spec.js:533` proves same-field STATED+INFERRED stay length-2 (not merged) |

Operator-decision conformance also confirmed: **OD-1** (0.3.0, no package bump, no `v0.3.0` backfill) ✓; **OD-2** (Lane 1 + Lane 2 co-landed, no `0.3.0`-without-trace state) ✓; **OD-3** (one entry per real normalization, no fabrication, STATED/INFERRED preserved) ✓; **F-A** sites (`assemble.js:322`, `fields.js:30`) renamed ✓; **F-B** exact-key (parsed, not substring) ✓.

> Note: the implementation report (`05-…md`) follows the operator's 12-item report spec rather than the skill's literal
> `## AC Verification` heading. The AC *substance* (AC-1…AC-4) is fully present and independently verified above, so the
> heading-name difference is not a gate failure — there is zero SDD-implementation drift, which is what the gate exists to
> catch.

---

## Design-Decision Adjudication (focus 9)

### Decision 1 — `emit.js` `IR_VERSION` bump to `0.3.0` (bundle `DEFAULT_IR_VERSION` stays `0.2.0`) → **ACCEPTABLE (non-blocking)**

This is not discretionary — it is **required for coherence**: `proposal-ir.json:16` pins `ir_version.const = "0.3.0"`, so the
emitter must emit `0.3.0` or `schema-validation.spec.js` fails the const match (`emit.js:28` correctly = `0.3.0`). The
bundle's `DEFAULT_IR_VERSION` staying `0.2.0` is **correct-by-scope**: Lane 1's authorized bundle change set (sprint-plan
authorized write paths + SDD §6.2's bundle change table) is *only* the `emitted_at`→`emitted_at_ms` rename — it does **not**
include `DEFAULT_IR_VERSION`. The bundle's `ir_version` field separately targets "the version Echelon's intake fixtures
already run" (`assemble.js:64-66`), a distinct concern from the IR-envelope's own schema version. The split is internally
consistent and all 848 tests pass.

> **Precision correction (non-blocking residual #2):** the implementation report justifies the split "per AC-7". That
> citation is imprecise: it borrows the cycle-002 "AC-7" cited at `assemble.js:79-80` (which is about
> `bundle_schema_version` being independent of `ir_version`), whereas cycle-003's AC-7 is the `trust_tier` guard (CF-8).
> The **decision is sound**; only the citation is wrong. Recommend the implementer reword the report's residual #1 to cite
> "Lane 1 authorized-write scope (emitted_at rename only) + `assemble.js:64-66` Echelon-intake targeting" rather than
> "AC-7".

### Decision 2 — caller-supplied `normalization_trace` + exported `BREATH_NORMALIZATION_TRACE` populator → **ACCEPTABLE (non-blocking)**

Justified by a genuine architectural constraint: the BREATH `input_value` `epa_airnow` (construct.json namespace) is **not
reconstructable** from the generic emitter, which only sees the final `feed_id` `epa_airnow_aqi`; and the settlement
canonicalization lives in `settlement.js`. So the producer that performs each normalization authors its trace; `emit.js`
**validates and carries** it (`assertNormalizationTrace`) but never fabricates — directly honoring OD-3's "do not
fabricate". SDD §5 Lane 2's "populated by emit.js" is satisfied in substance: `emit.js` owns both the populator
(`BREATH_NORMALIZATION_TRACE`) and the validation. Both entries are independently grounded (verified against
`settlement.js`/`markdown-members.js`), and the design is *defensive* (fabrication is gated at emit time). Within sprint
discretion; no fabrication risk.

---

## Adversarial Analysis

### Concerns identified (non-blocking)
1. **`src/bundle/assemble.js:64-65`** — comment still states the emitter is `IR_VERSION = '0.2.0'`; it is now `0.3.0`.
   Acknowledged in the implementation report as a residual outside Lane-1 scope; queued for Sprint 04 version-reconcile.
2. **`grimoires/loa/a2a/cycle-003/05-…md` (residual §11.1)** — "per AC-7" citation conflates cycle-002 AC-7
   (bundle_schema_version independence) with cycle-003 AC-7 (trust_tier guard). Decision correct; citation imprecise.
   (Detailed above.)
3. **`test/unit/schema-validation.spec.js`** — the in-repo lightweight validator does **not** recurse into array items,
   so the `normalization_trace` item constraints (enums, `confidence ∈ [0,1]`, `additionalProperties:false`) are exercised
   only by `assertNormalizationTrace` (`emit.js`), not by the schema-conformance test. Low risk (the code gate fires
   before any consumer and is well-tested at `ir.spec.js:545-558`), but it is a defense-in-depth gap: schema and code
   could silently drift in a future edit with no schema-test catch.
4. **`fixtures/forge-snapshots-*.json`** — still carry the old `emitted_at` key (forbidden path; no test consumes them;
   flagged as Sprint-04 `forge-ewa` disposition). Confirmed inert.

### Assumptions challenged
- **Assumption:** the bundle's `ir_version` may track *independently* of the IR-envelope's `ir_version` without breaking
  consumers. **Risk if wrong:** Echelon (or another consumer) expects bundle and envelope `ir_version` to stay in sync,
  and the 0.2.0-vs-0.3.0 split causes a round-trip mismatch. **Status:** acceptable for this producer-only sprint (no
  round-trip is in scope; OD-7 defers the BREATH round-trip until Echelon's S5 parser is runnable), **but** this coupling
  question should be explicitly confirmed with Echelon before any round-trip lands. Recommend the implementer/operator
  raise "should the BREATH bundle's emitted `ir_version` move to 0.3.0?" as a Sprint-02/round-trip co-design item rather
  than leaving it as an unstated inference.
- **Assumption:** `assertNormalizationTrace` at emit time is sufficient to prevent fabrication/malformation.
  **Risk if wrong:** a future caller passes a malformed trace that slips through. **Status:** mitigated — the validator
  checks all six fields, both enums, `confidence` bounds, rejects extras and non-arrays, and is a no-op only for `null`;
  fabrication is structurally impossible (trace is caller-supplied, never auto-invented).

### Alternatives not considered
- **Auto-computing `normalization_trace` inside `emit.js`.** Rejected correctly: the generic emitter cannot reconstruct
  construct-namespace `input_value`s (`epa_airnow`) from the final `feed_id`; doing so would be lossy or fabricated. The
  caller-supplied+validated design is the only fabrication-free architecture. **Verdict:** current approach justified.
- **Bumping the bundle's `DEFAULT_IR_VERSION` to `0.3.0` alongside the envelope.** Out of Lane-1 scope and would change the
  Echelon-intake target the bundle declares; correctly deferred. **Verdict:** current approach justified (but see the
  challenged assumption above — the *eventual* answer should be confirmed, not assumed).
- **Adding a schema-test extension that recurses into `normalization_trace` items** (closing concern #3). Not required for
  Sprint 01, but a cheap defense-in-depth improvement worth a follow-up micro-task. **Verdict:** optional enhancement.

---

## Recommended follow-ups (none blocking this sprint)
- Sprint 04: reconcile the stale `assemble.js:64-65` comment + the forge-snapshots fixtures (already its scope).
- Implementer (optional, this sprint or next): fix the "AC-7" citation in `05-…md` residual §11.1.
- Sprint 02 / round-trip co-design: explicitly confirm with Echelon whether the bundle's emitted `ir_version` should track
  the envelope's `0.3.0` (resolves the challenged assumption before any round-trip).
- Optional defense-in-depth: extend `schema-validation.spec.js` to validate `normalization_trace` item constraints.

---

## Verdict

All nine review-focus areas pass on independent adversarial verification. The co-land of Lane 1 (`emitted_at_ms` rename)
and Lane 2 (`normalization_trace` populate) under one coordinated breaking IR `0.3.0` bump is correct, complete, and
deterministic; the claim ceiling is preserved; scope and forbidden-path fences are respected; package version is
untouched. The four residuals are documentation/coverage nits, all non-blocking, two already self-disclosed by the
implementer. Both flagged design decisions are sound.

**PASS — ready for audit**
