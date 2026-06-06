# FORGE Cycle-003 Sprint 01 — Implementation Report

> **Producer-compat spine.** Co-landed the `emitted_at` → `emitted_at_ms` rename (bundle + IR-envelope
> surfaces), the coordinated breaking IR schema bump to `0.3.0`, the build + populate of
> `normalization_trace`, the determinism re-baseline, and exact-key validation — in one repo state.
> No commit, push, tag, release, package bump, or Beads mutation. Awaiting operator review → `/review-sprint`.

**Sprint:** `cycle-003-s01-producer-compat-ir-bump`
**Date:** 2026-06-06
**Status:** Implementation + validation complete; STOPPED before commit (per stop condition).
**Binding specs:** cycle-003 PRD / SDD / sprint-plan / operator-decisions; Tobias follow-up reply + reconciliation (background authority).

---

## 1. Branch / base / hygiene

| Item | Value |
|------|-------|
| Active branch | `cycle-003-s01-producer-compat-ir-bump` |
| Base branch | `cycle-003-integration` (created this sprint from `master`@`715072c3`) |
| Base commit | `715072c3c4c4dd3e0bb187d39923cd53da31db4d` (`chore(release): v0.4.0`) |
| `cycle-003-integration` HEAD | `715072c3` (unchanged; sprint branch holds the work, uncommitted) |
| `master` | `715072c3` — **untouched** (verified `git rev-parse master` == base) |
| On `master`? | **No** — on the sprint branch |

**Preflight (all guards passed, no HALT):**
- Current branch was `master` @ `715072c3`; `git status --short` clean (no tracked changes) → no dirty-tree HALT.
- `master` == `origin/master` == `715072c3` → unambiguous base, no HALT.
- No pre-existing `cycle-003-integration` branch → created fresh from `715072c3`.
- Created sprint branch `cycle-003-s01-producer-compat-ir-bump` from `cycle-003-integration` (no slash-form refs).

**`git status --short` at stop (working tree, uncommitted):**
```
 M spec/STABILITY.md
 M spec/proposal-ir.json
 M src/bundle/assemble.js
 M src/bundle/fields.js
 M src/bundle/receipt.js
 M src/ir/emit.js
 M test/unit/bundle-conformance-posture.spec.js
 M test/unit/ir.spec.js
```
Plus this new untracked report. No staged changes; nothing committed.

---

## 2. Files changed

Exactly the 8 authorized write paths (`git diff --stat`):

| File | +/− | Task(s) |
|------|-----|---------|
| `src/bundle/assemble.js` | 8 | T1.1 |
| `src/bundle/receipt.js` | 28 | T1.2 |
| `src/bundle/fields.js` | 2 | T1.3 |
| `src/ir/emit.js` | 131 | T1.4, T1.6 (+ coordinated `IR_VERSION` bump) |
| `spec/proposal-ir.json` | 30 | T1.5, T1.7 |
| `spec/STABILITY.md` | 36 | T1.8 |
| `test/unit/bundle-conformance-posture.spec.js` | 57 | T1.9 |
| `test/unit/ir.spec.js` | 116 | T1.10 |

Plus the sprint implementation report (this file). No NOTES entry was required; a concise one may be added on request.

---

## 3. Forbidden-path audit

**Result: clean — zero forbidden paths touched.** `git status --short` lists only the 8 authorized files. Explicitly confirmed **untouched**:

`package.json`, lockfiles, `.github/workflows/*`, `.claude/**`, `.beads/**`, `src/receipt/canonicalize.js`, `src/receipt/sign.js`, `spec/receipt-v0.json`, `spec/jcs-test-vectors.json`, `test/unit/jcs-parity.spec.js`, `src/bundle/settlement.js`, `test/unit/bundle-boundaries.spec.js`, `fixtures/forge-snapshots-*.json`, `BUTTERFREEZONE.md`, `README.md`, `src/filter/usefulness.js`, any `composed_trust` path, any runtime/CLI entrypoint, all Sprint 02+ files.

`src/bundle/settlement.js` and `src/bundle/markdown-members.js` were **read-only** (to ground the `normalization_trace` entry values) — not modified.

---

## 4. What changed by task (T1.1–T1.10)

### T1.1 — Bundle rename (`src/bundle/assemble.js`)
Renamed the emitted field `emitted_at` → `emitted_at_ms` (value unchanged: injectable `now`, Unix-ms integer):
- local var [assemble.js:264](src/bundle/assemble.js#L264) `const emitted_at_ms = now;`
- manifest key [assemble.js:279](src/bundle/assemble.js#L279) (`emitted_at_ms,` shorthand)
- value passed to receipt [assemble.js:322](src/bundle/assemble.js#L322) `emittedAtMs: emitted_at_ms,`
- JSDoc [assemble.js:211](src/bundle/assemble.js#L211). The injectable clock parameter stays `now` (it is the clock, not the field). No ISO-8601 added.

### T1.2 — Receipt rename (`src/bundle/receipt.js`)
Renamed receipt key `emitted_at` → `emitted_at_ms` [receipt.js:216](src/bundle/receipt.js#L216) and the `buildBundleReceipt` input param `emittedAt` → `emittedAtMs` ([:187](src/bundle/receipt.js#L187), [:195](src/bundle/receipt.js#L195)). Updated the carried-verbatim JSDoc/notes ([:26-27](src/bundle/receipt.js#L26), [:154](src/bundle/receipt.js#L154), [:159](src/bundle/receipt.js#L159), [:175](src/bundle/receipt.js#L175), [:188](src/bundle/receipt.js#L188)) — the `_ms` note now records that the rename resolves the prior int-vs-datetime parser ambiguity (value still Unix-ms integer).

### T1.3 — Manifest required fields (`src/bundle/fields.js`) — Sprint-Plan finding F-A
[fields.js:30](src/bundle/fields.js#L30): replaced `'emitted_at'` → `'emitted_at_ms'` in the frozen `MANIFEST_REQUIRED_FIELDS` (this is the self-check allowlist; without it the emitter self-check at `assemble.js:285` would fail on the renamed manifest).

### T1.4 — IR envelope rename (`src/ir/emit.js`)
Renamed local + envelope `emitted_at` → `emitted_at_ms` ([emit.js:218](src/ir/emit.js#L218), [:277](src/ir/emit.js#L277)) + JSDoc [:186](src/ir/emit.js#L186). Value unchanged (Unix-ms integer). No ISO-8601.
**Coordinated `IR_VERSION` bump (required for schema coherence):** [emit.js:28](src/ir/emit.js#L28) `IR_VERSION = '0.3.0'`. The schema's `ir_version.const` is now `0.3.0`, so the emitter MUST emit `0.3.0` or `schema-validation.spec.js` would fail the const match. (The bundle's separate `DEFAULT_IR_VERSION` stays `0.2.0` per SDD §6.2 — see §11 residuals.)

### T1.5 — IR schema bump (`spec/proposal-ir.json`)
- `$id` [:3](spec/proposal-ir.json#L3) → `…/proposal-ir/0.3.0`
- top-level `version` [:6](spec/proposal-ir.json#L6) → `0.3.0`
- `ir_version.const` [:16](spec/proposal-ir.json#L16) → `0.3.0`
- `required[]` [:9](spec/proposal-ir.json#L9): `emitted_at` → `emitted_at_ms`
- property block [:36](spec/proposal-ir.json#L36): key renamed to `emitted_at_ms`, `type: integer` kept, "Unix epoch milliseconds" semantics retained. No `package.json` change.

### T1.6 — Build + populate `normalization_trace` (`src/ir/emit.js`)
Added the populated producer-provenance field to the envelope, in the provenance family right after `negative_policy_flags` [emit.js:287](src/ir/emit.js#L287). Components:
- `NORMALIZATION_METHODS` / `NORMALIZATION_SOURCES` / `NORMALIZATION_TRACE_FIELDS` constants ([emit.js:74-81](src/ir/emit.js#L74)).
- `assertNormalizationTrace(trace)` exported validator [emit.js:95](src/ir/emit.js#L95) — null OR an array whose every entry has exactly the 6 fields, `method`/`source` in the enums, numeric `confidence ∈ [0,1]`; throws on the first violation. Producer authoring safety; **fabricates nothing**.
- `BREATH_NORMALIZATION_TRACE` exported frozen populator [emit.js:157](src/ir/emit.js#L157) — the narrow BREATH worked path, **one entry per real producer normalization**, grounded against source (see §9).
- new optional param `normalization_trace = null` [emit.js:216](src/ir/emit.js#L216); validated [:270](src/ir/emit.js#L270); emitted [:287](src/ir/emit.js#L287). Default `null` mirrors `negative_policy_flags` null-when-unevaluated. The producer that performs a normalization supplies its trace (the BREATH path passes `BREATH_NORMALIZATION_TRACE`); `emit.js` validates + carries — it never invents an entry. **STATED and INFERRED never collapse** (distinct `method` values; validated + tested).

### T1.7 — `normalization_trace` schema (`spec/proposal-ir.json`)
Added the `normalization_trace` property [:107](spec/proposal-ir.json#L107): `type ["array","null"]`; `items` object with `additionalProperties:false`, `required` = the six fields, `method` enum `[stated,inferred,mapped,defaulted]`, `source` enum `[forge,echelon,lattice,operator]`, `confidence` number `minimum:0 maximum:1`. `input_value`/`normalized_value` are untyped (any JSON value, per the locked shape). Co-landed in the same `0.3.0` repo state.

### T1.8 — STABILITY update (`spec/STABILITY.md`)
Header `Current Version` → `0.3.0` [:4](spec/STABILITY.md#L4). Added a `## 0.3.0 — Cycle 003 Sprint 01 (coordinated breaking bump)` section [:39](spec/STABILITY.md#L39) recording: BREAKING `emitted_at` → `emitted_at_ms` (value unchanged); additive populated `normalization_trace`; `$id`/`version`/`ir_version.const` reconciled to `0.3.0`; **no `package.json` bump**; **no `v0.3.0` backfill**.

### T1.9 — Bundle determinism tests (`test/unit/bundle-conformance-posture.spec.js`)
Renamed all T8 asserted fields to `emitted_at_ms` (manifest + receipt + the `buildBundleReceipt` `emittedAtMs` param). Added a parsed-key exact-key test [:136](test/unit/bundle-conformance-posture.spec.js#L136): `Object.keys(manifest/receipt)` includes `emitted_at_ms` and **not** `emitted_at`, asserted on both the returned objects and the on-disk serialized members. Fixed-`now` determinism preserved (the three T8 properties intact). The digest move is exercised by the existing "different now ⇒ different digest" test (no hard-coded digest literal exists in this suite — see §7).

### T1.10 — IR tests (`test/unit/ir.spec.js`)
Renamed in-place asserts to `emitted_at_ms` ([:49-50](test/unit/ir.spec.js#L49), [:408-409](test/unit/ir.spec.js#L408)) and `ir_version` `0.2.0` → `0.3.0` [:47](test/unit/ir.spec.js#L47). Added two describe blocks:
- `emitted_at_ms rename (Lane 1)` [:462](test/unit/ir.spec.js#L462) — exact-key (no bare `emitted_at`), `ir_version 0.3.0`, injected-`now` byte-deterministic equality (`deepStrictEqual` + `canonicalize` parity).
- `normalization_trace provenance (Lane 2)` [:495](test/unit/ir.spec.js#L495) — present-and-null default; populated BREATH trace (object-array, valid enums, grounded values); STATED-vs-INFERRED-for-same-field distinguishable [:533](test/unit/ir.spec.js#L533); shape validation rejects bad method/source/confidence/extra/missing/non-array; `assertNormalizationTrace` round-trip.

---

## 5. Validation commands run and results

| Command | Result |
|---------|--------|
| `npm run test:all` (unit + convergence + integration) — **baseline (pre-change)** | **839 pass / 0 fail** |
| `npm run test:all` — **post-change** | **848 pass / 0 fail** (+9 net new; +2 suites) |
| `node --test test/unit/ir.spec.js test/unit/bundle-conformance-posture.spec.js` | **43 pass / 0 fail** (new Lane-1/Lane-2 tests execute + pass) |
| `node --test schema-validation + determinism-gate + forge-verify + receipt-builder + receipt-pipeline` (out-of-scope safety) | **67 pass / 0 fail** |
| `npm test` (convergence default) | **6 pass / 0 fail** |
| `node -e` schema parse + field check | `proposal-ir.json` valid; version/`$id`/const all `0.3.0`; `required` has `emitted_at_ms`, not `emitted_at`; `normalization_trace` present |
| Producer smoke (`emitEnvelope` + `assembleBundle` BREATH final) | envelope/manifest/receipt carry `emitted_at_ms`, not `emitted_at`; `ir_version 0.3.0`; trace populated (`mapped,stated`); default trace `null` |

**Out-of-scope safety confirmed:** `buildReceipt` hashes the canonicalized envelope into `subject.digest` ([receipt-builder.js:42-43](src/receipt/receipt-builder.js#L42)), so the rename + new field move every receipt's output digest — but no test hard-codes a v0.2.0+ envelope/receipt digest (determinism-gate asserts run-to-run equality; schema-validation reads the schema dynamically; `forge-verify`'s v0.1.0 pair is a self-contained frozen literal re-hashed in place). All green.

---

## 6. Exact-key validation results

**Method: parsed-JSON key assertions (not naive substring grep)** — because `emitted_at_ms` contains `emitted_at`.

- IR envelope: `Object.keys(env).includes('emitted_at_ms') === true`, `…includes('emitted_at') === false` ([ir.spec.js:474-475](test/unit/ir.spec.js#L474)).
- Bundle manifest + receipt (objects and on-disk serialized members): same assertions ([bundle-conformance-posture.spec.js:136-149](test/unit/bundle-conformance-posture.spec.js#L136)).
- `typeof emitted_at_ms === 'number' && Number.isInteger(...)` asserted on envelope + manifest + receipt.

**Belt-and-suspenders grep** (`\bemitted_at\b` — trailing word boundary excludes `emitted_at_ms`, since `_` is a word char):

| Location | Verdict |
|----------|---------|
| `src/ir/emit.js`, `src/bundle/{assemble,receipt,fields}.js` | **zero** bare `emitted_at` — rename complete in all producer code |
| `spec/proposal-ir.json` `required[]` + property key | **zero** — keys are `emitted_at_ms`; one occurrence at [:38](spec/proposal-ir.json#L38) is **description prose** documenting the rename, not a key |
| `test/unit/{ir,bundle-conformance-posture}.spec.js` | only intentional `!includes('emitted_at')` absence-assertions + comments |
| `spec/STABILITY.md:47` | intentional changelog prose ("`emitted_at` → `emitted_at_ms`") |
| `fixtures/forge-snapshots-*.json` | **out-of-scope residual** (stale snapshots; no test consumes them; Sprint 04 disposition) |
| `test/unit/forge-verify.spec.js:254` | **intentional** — frozen v0.1.0 preserved-envelope literal (v0.1.0 legitimately used `emitted_at`) |
| `spec/HERMETICITY.md` | **out-of-scope residual** (doc drift; not in Sprint-01 write set) |

No `emitted_at` key remains anywhere in **emitted producer output** (envelope, manifest, receipt). No ISO-8601 string field exists (grep for `ISO-8601` finds only the STABILITY.md non-claim "no ISO-8601").

---

## 7. Determinism / digest re-baseline

**Rule honored (NFR-DET / SDD §7):** fixed inputs + fixed `now` ⇒ stable member bytes/hashes/`bundle_digest`. Renaming `emitted_at` → `emitted_at_ms` inside the content-addressed `manifest.json` member changes that member's bytes → its `content_hash` and the aggregate `bundle_digest` move **deliberately**. This was re-baselined intentionally, not treated as a regression.

**BREATH final bundle, `PINNED_NOW = 1735689600000` — old (base `715072c3`, via throwaway worktree) vs new:**

| Quantity | OLD (`emitted_at`) | NEW (`emitted_at_ms`) | Moved? |
|----------|--------------------|-----------------------|--------|
| `manifest.json` member `content_hash` | `sha256:8df92ba251a876d47c0bbf8947e245b44155610eca466fc37048c50cb31ac6f6` | `sha256:99c6b29c77d3bd8bc5e58d721e170e9f8e5f7c94353a6563e005f266232228ca` | **yes** (key bytes changed) |
| `bundle_digest` | `sha256:8d7d0691195398efb7b61b69cbf5a9bfac16aa6b3f799ea058cbd5fe18dc38d8` | `sha256:991704ecc843ae6fabe33e87c66528241352e2ed79d0b8dc8bdb90622d7b0a9a` | **yes** (manifest member is inside the digested `members[]`) |
| `SKILL.md` / `reality.md` / `handoff.md` member hashes | (materializers + inputs unchanged) | `fb8f3676…` / `a53b6ca1…` / `f33322105…` | **no** (no timestamp inside; markdown materializers untouched) |
| receipt scalar `emitted_at_ms` | n/a | present, **outside** the digest (digest is over `members[]` only) | does not itself move `bundle_digest` |

**No digest literal is hard-coded in `bundle-conformance-posture.spec.js`** — the suite asserts *relative* properties (identical-now ⇒ equal; different-now ⇒ unequal with manifest hash moving and markdown hashes stable). So the re-baseline is recorded here (this report) rather than as a changed literal; the tests remain assertion-based and green. The old/new pair above is the deliberate-move evidence.

---

## 8. IR version confirmation

| Element | Value | Location |
|---------|-------|----------|
| `$id` | `https://forge.constructs.network/schemas/proposal-ir/0.3.0` | [proposal-ir.json:3](spec/proposal-ir.json#L3) |
| `version` | `0.3.0` | [proposal-ir.json:6](spec/proposal-ir.json#L6) |
| `ir_version.const` | `0.3.0` | [proposal-ir.json:16](spec/proposal-ir.json#L16) |
| emitter `IR_VERSION` (emits `ir_version`) | `0.3.0` | [emit.js:28](src/ir/emit.js#L28) |
| `package.json` version | `0.4.0` — **UNCHANGED** | [package.json:3](package.json#L3) |

All three schema version surfaces agree at `0.3.0`; the emitter matches. **No package bump.** The IR schema version is independent of the package/release version (cycle-002 precedent: IR `0.2.0` under package `0.4.0`).

---

## 9. `normalization_trace` emitted shape + populated entries

**Shape (per entry):** `{ field, input_value, normalized_value, method, source, confidence }` — `method ∈ {stated,inferred,mapped,defaulted}`, `source ∈ {forge,echelon,lattice,operator}`, `confidence` number `[0,1]`. Nullable; present-and-null by default; empty array valid; populated when a producer field is normalized.

**Populated BREATH worked-path entries (`BREATH_NORMALIZATION_TRACE`, [emit.js:157](src/ir/emit.js#L157)) — one per REAL normalization, grounded against source (no fabrication):**

| `field` | `input_value` → `normalized_value` | `method` | `source` | `confidence` | Grounding |
|---------|-----------------------------------|----------|----------|--------------|-----------|
| `settlement_source` | `airnow` → `airnow` | `mapped` | `forge` | 1.0 | [settlement.js:52-54](src/bundle/settlement.js#L52) `S03C_SETTLEMENT_SOURCE_CANONICAL = { airnow: 'airnow' }` — `params.settlement_source` → canonical TRUST_REGISTRY key (identity-after-verification, but a real mapping step) |
| `feed_id` | `epa_airnow` → `epa_airnow_aqi` | `stated` | `forge` | 1.0 | [markdown-members.js:115,119](src/bundle/markdown-members.js#L115) — construct.json data-source id `epa_airnow` producer-STATED as the authored feed convention `epa_airnow_aqi` |

STATED (`feed_id`) and MAPPED (`settlement_source`) are distinct `method` values. The same-field STATED-vs-INFERRED non-collapse invariant (NFR-PROV) is enforced by `assertNormalizationTrace` (entries are never merged) and proven by [ir.spec.js:533](test/unit/ir.spec.js#L533). The SDD §5 Lane-2 table is the floor; no entries beyond the two grounded ones were added (no fabrication).

**Design note (why caller-supplied + validate, with a BREATH populator):** `emit.js` is the generic envelope emitter; the BREATH `input_value` `epa_airnow` (construct namespace) is **not reconstructable** from the generic emitter inputs (it only sees the final `feed_id` `epa_airnow_aqi`), and the settlement canonicalization lives in `settlement.js`. So the producer that performs each normalization authors its trace; `emit.js` validates + carries it (never fabricates). The BREATH worked path supplies `BREATH_NORMALIZATION_TRACE` — the concrete "populate" deliverable, exported and test-covered like the other BREATH worked-path constants.

---

## 10. Claim-ceiling / non-claim grep results

**Clean.** Every ceiling-vocabulary occurrence in the added diff lines is an explicit **non-claim** (negative assertion):

- `emit.js` + `proposal-ir.json`: "Producer provenance ONLY — never an admission/acceptance/scoring claim"; "Provenance confidence only — NOT a calibration or scoring value".
- `STABILITY.md`: "no ISO-8601, no separate second field" (the do-not-list, documented).

No admission / acceptance / certification / optimization / calibration / payout introduced. **No `scoring.*` populated. No `composed_trust` / `can_settle` / `settlement_risk` / `risk_flags`. No signature production/verification. No ISO-8601 field.** `normalization_trace` is the single in-ceiling exception (producer provenance Echelon asked FORGE to populate) and is fenced as such in code + schema. The claim ceiling is preserved verbatim: *FORGE can emit a local, content-addressed ConstructAdmissionBundle producer artifact for the narrow BREATH worked path — and nothing stronger.*

---

## 11. Known residuals (out-of-scope; informational)

All are intentional consequences of the surgical scope; none break the suite. None are in the Sprint-01 authorized write set.

1. **Bundle `DEFAULT_IR_VERSION` stays `0.2.0`.** SDD §6.2 deliberately keeps the bundle manifest's targeted `ir_version` out of Lane 1 (it tracks Echelon's intake, versioned independently of the IR-envelope version per AC-7). Because the IR-envelope emitter `IR_VERSION` is now `0.3.0`, the comment citing it at [assemble.js:64-65](src/bundle/assemble.js#L64) (and the analogous note at `src/bundle/versioning.js:19-20`) is now stale. Not edited — outside the authorized assemble.js change (emitted_at rename only). Reconciling the bundle's targeted IR version, if desired, is a separate scoped decision (candidate for Sprint 04 version-reconcile).
2. **`fixtures/forge-snapshots-*.json`** still carry the old `emitted_at` key. Forbidden path; no test consumes them; this is the `forge-ewa` staleness slated for Sprint 04 disposition.
3. **`spec/HERMETICITY.md`** references `emitted_at` (doc drift). Not in the Sprint-01 spec write set (only `proposal-ir.json` + `STABILITY.md`); doc-only residual.
4. **`test/unit/forge-verify.spec.js`**: the frozen v0.1.0 preserved-envelope literal keeps `emitted_at` (correct — v0.1.0 used it); the two v0.2.0-named replay tests now actually exercise IR `0.3.0` (they assert `MATCH`, not the version string — cosmetic test-name staleness). Out of authorized scope.
5. **`schema-validation.spec.js` comment "IR 0.2.0 surface ratification"** is a stale comment; the validation reads the schema dynamically and passes against `0.3.0`. Out of authorized scope.

---

## 12. Explicit stop-condition confirmation

- **No commit** — working tree holds uncommitted changes (`git status --short` above).
- **No push** — no branch pushed.
- **No tag** — none created.
- **No release** — none.
- **No package bump** — `package.json` version unchanged at `0.4.0`; not in `git status`.
- **No `v0.3.0` backfill** — none.
- **No Beads mutation** — `.beads/**` untouched; no `br` mutation run.
- **No review/audit performed** — implementation + validation only.
- **Master untouched** — `master` == `715072c3`.

**Stop:** awaiting operator review and `/review-sprint`.
