# FORGE Cycle-003 Sprint 02 — Implementation Report

**Canonicalization parity + receiving-alignment hardening (BREATH producer path)**

> **State-Zone report. Implementation + validation only.** No review, no audit, no commit, no push, no tag, no
> release, no package bump, no Beads mutation, no `master` touch, no integration fast-forward. Awaiting operator
> review and `/review-sprint`.

**Sprint:** `cycle-003-s02-canonicalization-parity-receiving-alignment`
**Date:** 2026-06-17
**Author:** Loa `/implement` (`implementing-tasks`)
**Binding spec set:** `01-cycle-003-prd.md`, `02-cycle-003-sdd.md`, `03-cycle-003-sprint-plan.md` §6 Sprint 02,
`04-cycle-003-operator-decisions.md`, `09-cycle-003-s02-scope-amendment-brief.md`,
`00-cycle-003-S02-reply-reconciliation.md`, `00-cycle-003-S02-echelon-docdump-intake.md`; S01 reports 05/06/07 as
background.

---

## Executive summary

Sprint 02 lands the canonicalization-parity and receiving-alignment hardening for the narrow BREATH
`ConstructAdmissionBundle` producer path, strictly inside the standing claim ceiling:

- **JCS parity** — a jointly-owned `spec/jcs-test-vectors.json` (29 canonical + 10 reject vectors) pins the existing
  `jcs-subset/v0` canonicalizer; `test/unit/jcs-parity.spec.js` certifies the in-repo `canonicalize.js` against it
  (byte-equality for canonical vectors, fail-closed throw for reject vectors). The canonicalizer is **byte-unchanged**
  (COMPAT-5 — subset kept, no full-RFC swap). The vectors are authoritative for both the FORGE `bundle_digest` and the
  Echelon `cert_hash` parity basis.
- **feed_id grammar** — `FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/` + exported `assertFeedId` + a module-load
  self-check on `BREATH_FEED_ID` (`epa_airnow_aqi`, preserved).
- **Receiving-alignment no-change postures** — asserted: `bundle_member_hash` present-and-null, `calibration_ref` null,
  `construct_source_ref` dual-axis, the four receipt authenticity fields present-and-null (no signature built).
- **`bundle_schema_version` `0.1.0` → `1.0.0`** — one-line change adopting Echelon's Cycle-113 receiving-contract
  version; deliberate `bundle_digest` re-baseline (`991704ec…` → `b8f05d8c…`), confined to the `manifest.json` member;
  markdown member hashes stable. `ir_version` stays `0.2.0`; ProposalEnvelope `ir_version` stays `0.3.0`; **no equality
  lock** added.
- **calibration_ref §12 pointer** recorded (record-only): `{cert_uri, cert_hash, n_resolutions, as_of, verifier_type}`.

**Full suite: 904 pass / 0 fail** (baseline 848 + 56 new). Package stays `0.4.0`. All forbidden paths byte-unchanged.

---

## 1. Branch / base / hygiene

| Item | Value |
|------|-------|
| Active branch | `cycle-003-s02-canonicalization-parity-receiving-alignment` |
| Branch HEAD | `a1ca874e9af40d8d8e84bcc02d39593dd856713c` |
| Base commit (`cycle-003-integration`) | `a1ca874e9af40d8d8e84bcc02d39593dd856713c` |
| `origin/cycle-003-integration` | `a1ca874e9af40d8d8e84bcc02d39593dd856713c` (untouched) |
| `master` / `origin/master` | `715072c3c4c4dd3e0bb187d39923cd53da31db4d` (untouched) |
| Commits on branch since base | **0** (working-tree only — nothing committed) |
| On `master`? | **No** — confirmed on the Sprint-02 branch |

**Preflight result:** working tree was clean at start (no dirty tracked implementation files, no gitignored State-Zone
continuity files present). Branch created from `cycle-003-integration @ a1ca874e` (no slash-form ref). No push, no
commit.

`git status --short` (end state):

```
 M spec/STABILITY.md
 M src/bundle/assemble.js
 M src/bundle/markdown-members.js
 M test/unit/bundle-conformance-posture.spec.js
?? spec/jcs-test-vectors.json
?? test/unit/jcs-parity.spec.js
```

---

## 2. Files changed

| File | Status | Task(s) | Δ |
|------|--------|---------|---|
| `spec/jcs-test-vectors.json` | **NEW** | T2.1 | 97 lines (29 canonical + 10 reject vectors, metadata, 5 deltas) |
| `test/unit/jcs-parity.spec.js` | **NEW** | T2.2 | 120 lines (43 tests) |
| `src/bundle/markdown-members.js` | modified | T2.3 | +43 (FEED_ID_GRAMMAR + assertFeedId + self-check) |
| `src/bundle/assemble.js` | modified | T2.7 | 1 line (`DEFAULT_BUNDLE_SCHEMA_VERSION` value) |
| `test/unit/bundle-conformance-posture.spec.js` | modified | T2.4 / T2.5 / T2.7 | +169 (2 imports + 13 tests) |
| `spec/STABILITY.md` | modified | T2.8 / T2.6 | +28 (one scoped `bundle_schema_version` + calibration_ref note) |
| `grimoires/loa/a2a/cycle-003/10-s02-implementation-report-…md` | **NEW** | report | this file |

All six code/spec/test paths are in the Sprint-02 authorized write-list.

---

## 3. Forbidden-path audit

Verified byte-unchanged vs HEAD (`git diff --quiet` clean):

| Forbidden path | State |
|----------------|-------|
| `package.json` | UNCHANGED (`0.4.0`) |
| lockfiles | none present / none changed |
| `.github/workflows/*` | not touched |
| `.claude/**` | not touched |
| `.beads/**` | not touched |
| `src/receipt/canonicalize.js` | **UNCHANGED** (subset kept — COMPAT-5) |
| `src/receipt/sign.js` | **UNCHANGED** (no signature build — COMPAT-6) |
| `spec/receipt-v0.json` | **UNCHANGED** (`jcs-subset/v0` label intact) |
| `src/ir/emit.js` | **UNCHANGED** (S01 complete) |
| `src/bundle/settlement.js` | UNCHANGED (read-only this sprint) |
| `src/bundle/oracles.js` | UNCHANGED (read-only this sprint) |
| `test/unit/bundle-boundaries.spec.js` | UNCHANGED (Sprint 03) |
| `fixtures/forge-snapshots-*.json` | not touched (Sprint 04) |
| `README.md` / `BUTTERFREEZONE.md` | not touched |
| composed_trust schema/emitter | none added/changed |
| `scoring.*` path | none added/changed |
| certification / cert-issuance path | none added/changed |
| runtime/CLI entrypoint, `bin/*` | none added/changed |
| TREMOR/CORONA path | none added/changed |
| multi-construct admission generalization | none |
| `VerificationReceipt` admission substrate | none |

---

## 4. What changed by task

### T2.1 — JCS subset vectors (`spec/jcs-test-vectors.json`, NEW)

Jointly-owned (FORGE + Echelon) `jcs-subset/v0` parity vectors describing the **existing** `canonicalize.js`
behavior — not full RFC 8785, no dependency, no canonicalizer change. Top-level metadata: `canonicalization:
"jcs-subset/v0"`, `reference_implementation`, `spec` pointer, `ownership`, `parity_basis` (`bundle_digest` +
`cert_hash`), `subset_vs_rfc8785_deltas` (5 entries), `builder_tokens` (for values JSON cannot hold). 29 canonical
vectors pin object key ordering, nested object/array handling, strings (JSON.stringify), numbers (JSON.stringify
incl. `-0`→`0`, `1e21`→`1e+21`, `1e-7`), booleans/null. 10 reject vectors pin fail-closed rejection
(Infinity/-Infinity/NaN/undefined/BigInt/Date/function/symbol + nested propagation).

### T2.2 — JCS parity tests (`test/unit/jcs-parity.spec.js`, NEW)

Loads the vectors and exercises **only** the in-repo `canonicalize.js`: byte/string equality for every `canonical`
vector; `assert.throws(…, TypeError)` for every `reject` vector. Asserts metadata names `jcs-subset/v0` and that the
vectors document the `bundle_digest` + `cert_hash` parity basis (incl. the `calibration_ref` exclusion and the
`jcs-subset/v0` naming). A small `BUILDERS` map constructs the non-JSON values; it does not touch canonicalization.
**43 tests, all pass.**

### T2.3 — feed_id grammar (`src/bundle/markdown-members.js`)

- `markdown-members.js:106` — `export const FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/;`
- `markdown-members.js:121` — `export function assertFeedId(value, label = 'feed_id')` — rejects non-string or
  non-conforming values, mirroring the existing `assertSafeIdentifier` precedent; grammar **not broadened**.
- `markdown-members.js:171` — module-load self-check `assertFeedId(BREATH_FEED_ID, 'BREATH_FEED_ID')`.
- `BREATH_FEED_ID` preserved at `epa_airnow_aqi` (`markdown-members.js:153`). No unrelated markdown-member behavior
  changed.

### T2.4 — feed_id tests (`test/unit/bundle-conformance-posture.spec.js`)

Value-extracted (not bare-substring): pulls `feed_id` from `handoff.md`, asserts it equals `epa_airnow_aqi`, satisfies
`FEED_ID_GRAMMAR`, and passes `assertFeedId`; asserts `assertFeedId` rejects 11 non-conforming inputs.

### T2.5 — receiving-alignment no-change assertions (`test/unit/bundle-conformance-posture.spec.js`)

Asserts (no schema keys added): SKILL.md `bundle_member_hash` present-and-null (never a populated digest);
`manifest.calibration_ref` present-and-null (object + on-disk); `construct_source_ref` dual-axis (each oracle has both
a tier-resolving `source_id` and a distinct provenance-only `construct_source_ref`; `airnow`/`epa_airnow`,
`purpleair`/`purpleair_sensor`); the four receipt authenticity fields present-and-null (no signature built; ed25519
encoding pinned in sign.js, not produced); and that no `composed_trust` / `scoring` / `cert` keys are emitted in
manifest or receipt.

### T2.6 — calibration_ref pointer record (record-only)

Confirmed §12 pointer shape locked as a design note (no emission, no schema key, no cert, no scoring) — see §10 and the
`spec/STABILITY.md` note.

### T2.7 — bundle_schema_version alignment (`src/bundle/assemble.js`)

- `assemble.js:82` — `DEFAULT_BUNDLE_SCHEMA_VERSION` `'0.1.0'` → `'1.0.0'` (one line only).
- `DEFAULT_IR_VERSION` unchanged at `'0.2.0'` (`assemble.js:70`). Manifest `ir_version` stays `0.2.0`. ProposalEnvelope
  `ir_version` stays `0.3.0` (Sprint 01). **No equality assertion** added between manifest `ir_version` and
  ProposalEnvelope `ir_version` — the version domains are intentionally independent (F1/#200).
- Conformance tests assert emitted `bundle_schema_version` is `1.0.0`, `ir_version` is `0.2.0`, the two are independent,
  and the digest re-baseline is confined to `manifest.json`.

### T2.8 — STABILITY note (`spec/STABILITY.md:132`)

One scoped section: `bundle_schema_version` adopts Echelon receiving-contract `1.0.0`; not a package bump (stays
`0.4.0`); not an IR bump (bundle `ir_version` `0.2.0`, ProposalEnvelope `ir_version` `0.3.0`); no
admission/certification/scoring/runtime claim. Also records the calibration_ref §12 pointer (T2.6). No marketing
language.

---

## 5. Validation commands run and results

| # | Check | Result |
|---|-------|--------|
| 1 | `node --test test/unit/jcs-parity.spec.js` | **43 pass / 0 fail** |
| 2 | `node --test test/unit/bundle-conformance-posture.spec.js` | **24 pass / 0 fail** (11 existing + 13 new) |
| 3 | IR/schema (`ir.spec.js`) via full suite | pass — `env.ir_version === '0.3.0'` holds |
| 4 | `npm run test:all` (full repo standard) | **904 pass / 0 fail** (baseline 848 + 56 new) |
| 5 | `canonicalize.js` byte-unchanged | UNCHANGED |
| 6 | `sign.js` byte-unchanged | UNCHANGED |
| 7 | `receipt-v0.json` byte-unchanged | UNCHANGED |
| 8 | `src/ir/emit.js` byte-unchanged | UNCHANGED |
| 9 | `package.json` `0.4.0` unmodified | `0.4.0`, UNCHANGED |
| 10 | no lockfile changes | none |
| 11 | no `.github` / `.claude` / `.beads` changes | none |
| 12 | no composed_trust emission/schema path changed | none |
| 13 | no `scoring.*` path changed | none |
| 14 | no runtime/CLI path changed | none |
| 15 | no TREMOR/CORONA path changed | none |
| 16 | no multi-construct generalization | none |
| 17 | `bundle_schema_version` emitted `1.0.0` | confirmed |
| 18 | bundle `ir_version` remains `0.2.0` | confirmed |
| 19 | ProposalEnvelope `ir_version` remains `0.3.0` | confirmed (`proposal-ir.json` const + `ir.spec.js`) |
| 20 | no `manifest.ir_version == ProposalEnvelope.ir_version` equality assertion | none added |
| 21 | `bundle_digest` re-baseline deliberate + recorded | yes — see §9 |
| 22 | markdown member hashes stable | SKILL/reality/handoff all stable |
| 23 | claim/scope-risk grep over changed artifacts | clean (only non-claims) — see §12 |

Repo standard test command: `npm run test:all` → `node --test test/unit/*.spec.js test/convergence/*.spec.js
test/integration/*.spec.js`.

---

## 6. JCS vector summary

- **Canonicalization:** `jcs-subset/v0` (`src/receipt/canonicalize.js`, byte-unchanged).
- **Canonical vectors (29):** booleans/null; numbers (`0`, `-0`→`0`, `42`, `-7`, `3.14`, `1.5`, `1e20`→
  `100000000000000000000`, `1e21`→`1e+21`, `1e-6`→`0.000001`, `1e-7`); strings (empty, basic, newline-escape,
  embedded quotes, raw-UTF-8 `€`, control `` lowercase escape); arrays (empty, order-preserved, mixed,
  nested); objects (empty, key ordering, recursive nested ordering, UTF-16 unicode-key ordering, undefined-value
  skip); and the FORGE-shaped composite (matches `JCS_SUBSET_V0.md` §6.4).
- **Reject vectors (10):** Infinity, -Infinity, NaN, undefined (top-level), BigInt, Date, function, symbol, plus
  nested-Infinity-in-object and nested-NaN-in-array (fail-closed propagation).
- **Subset-vs-RFC deltas (documented, 5):** numbers via ES6 `Number::toString` (same as RFC for accepted inputs; the
  subset additionally rejects non-finite); `-0`→`0` (diverges from Python `-0.0`); strings via ECMA-262 Quote with raw
  UTF-8 for non-ASCII (diverges from Python `ensure_ascii=True`); UTF-16 code-unit key sorting; fail-closed type
  narrowing.
- **Parity basis (both):** `bundle_digest` = `sha256(canonicalize(members[]))`; `cert_hash` = Echelon recomputes over
  the ProposalEnvelope **minus** `forge_seam.calibration_ref` using the **same** `jcs-subset/v0`. The file states FORGE
  asserts only the canonicalization parity basis — no cert is issued or verified by FORGE.

---

## 7. feed_id grammar summary

- **Grammar:** `FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/` (one or more lowercase-alphanumeric segments joined by
  single underscores; anchored, no `m` flag).
- **BREATH value:** `epa_airnow_aqi` (preserved; module-load self-check passes).
- **Rejection examples (all throw `invalid feed_id`):** `EPA_airnow` (uppercase), `epa__airnow` (double underscore),
  `_epa` / `epa_` (edge underscore), `epa-airnow` (dash), `epa airnow` (space), `epa.airnow` (dot), `''` (empty),
  `épa` (non-ASCII), `42` / `null` / `undefined` (non-string).
- Grammar deliberately **narrow**, **not broadened**.

---

## 8. bundle_schema_version summary

| Field | Value | Note |
|-------|-------|------|
| `bundle_schema_version` (old) | `0.1.0` | pre-Sprint-02 default |
| `bundle_schema_version` (new) | **`1.0.0`** | adopts Echelon Cycle-113 receiving-contract version |
| bundle manifest `ir_version` | `0.2.0` | unchanged (independent domain) |
| ProposalEnvelope `ir_version` | `0.3.0` | unchanged (Sprint 01) |
| equality assertion `manifest.ir_version == ProposalEnvelope.ir_version` | **NOT added** | F1/#200 — independence, not equality |
| `package.json` | `0.4.0` | not bumped |

`bundle_schema_version` and `ir_version` are independent version domains; the bump is the receiving-contract version
adoption, not a FORGE-semantic break, not a package bump, not an IR bump.

---

## 9. Determinism / digest re-baseline

`PINNED_NOW = 1735689600000`; BREATH final bundle.

| Member | OLD (schema `0.1.0`) | NEW (schema `1.0.0`) | Moved? |
|--------|----------------------|----------------------|--------|
| `bundle_digest` | `sha256:991704ecc843ae6fabe33e87c66528241352e2ed79d0b8dc8bdb90622d7b0a9a` | `sha256:b8f05d8c75f1faba9e40968a4c9cc4722b05d16245b26aa4cbdfe69246189bec` | **yes (deliberate)** |
| `manifest.json` | `sha256:99c6b29c77d3bd8bc5e58d721e170e9f8e5f7c94353a6563e005f266232228ca` | `sha256:b08ed9fb7359dc422e7037052fc3e61e4e4bd84f33b10ce7cc9e7ce34313c100` | **yes** (schema value lives in this member) |
| `SKILL.md` | `sha256:fb8f36767d4266b7c36d645dc4802c96e44680e46cb19968ac1681d5ffa37a8a` | (same) | no — **stable** |
| `reality.md` | `sha256:a53b6ca120401bb09ae310a7ac8f2ba6e1a489a9f44e28706a4690d89cb51320` | (same) | no — **stable** |
| `handoff.md` | `sha256:f33322105d325053250e15d3922f61ccc02ea2a475bd59d5b1ca329e8a55f3d7` | (same) | no — **stable** |

The move is confined to `manifest.json` (the schema-version value is a manifest field) and the aggregate
`bundle_digest`. The re-baseline is **deliberate and recorded**; the value is not hard-coded in any test literal (tests
assert the *relationship*: manifest moves, markdown stable, digest changes).

---

## 10. calibration_ref pointer record (record-only)

Confirmed §12 pointer shape (recorded, **not emitted**):

```
calibration_ref = { cert_uri, cert_hash, n_resolutions, as_of, verifier_type }
```

- Record/design-note only — **no emission, no schema key, no cert issuance, no scoring** this cycle.
- `verifier_type` is **Echelon-owned**. FORGE Rung 3 maps to `frozen_replay_baseline` as **compatibility language
  only**, not a Cycle-003 claim.
- `frozen_baseline_hash` is **not added** this sprint.
- `manifest.calibration_ref` stays `null` (asserted in T2.5). The claim ceiling is not expanded.

---

## 11. Receiving-alignment no-change assertions

| Posture | State | Evidence |
|---------|-------|----------|
| `bundle_member_hash` present-and-null | held | SKILL.md `bundle_member_hash: null`; never a populated digest (T2.5) |
| `calibration_ref` null | held | `manifest.calibration_ref === null` (object + on disk) (T2.5) |
| `construct_source_ref` dual-axis | held | each oracle carries distinct `source_id` + `construct_source_ref` (`airnow`/`epa_airnow`, `purpleair`/`purpleair_sensor`) (T2.5) |
| signature encoding pinned `ed25519:<base64>` | held, **no signature built** | four receipt authenticity fields present-and-null; encoding lives in `sign.js` (unchanged), produced by neither this sprint nor the bundle (T2.5) |
| no cert emission / no scoring / no composed_trust emission | held | absence asserted in manifest + receipt (T2.5) |

No new schema keys were added for `calibration_ref` or `composed_trust`.

---

## 12. Claim-ceiling / non-claim grep results

Grep over added lines (modified files) + full new files for the risk vocabulary (`composed_trust`, `can_settle`,
`settlement_risk`, `risk_flags`, `scoring`, `admission/admitted`, `certif*`, `cert_*`, `calibrat*`, `optimi[sz]`,
`signature`, `frozen_baseline_hash`, `multi-construct`, `tremor`, `corona`). All hits are **non-claims** or
record-only:

- `…makes NO admission / certification / scoring / runtime claim` — explicit non-claim.
- `manifest.calibration_ref stays null` / `{cert_uri, cert_hash, n_resolutions, as_of, verifier_type}` — record-only,
  `frozen_baseline_hash` explicitly NOT added.
- `cert_hash` in the vectors / parity test — describes **Echelon's** recompute; "no cert is issued or verified here"
  (FORGE-side disclaimer).
- `no signature is built` / "the bundle PRODUCES no signature" / "ed25519 encoding pinned in sign.js" — non-claim.
- `no composed_trust` / `no scoring` / `no cert` key assertions — absence checks.
- The two prior FORGE-side uses of "certify/certifies" were reworded to "pin its behavior" / "checks" to keep the grep
  unambiguous; the sole remaining `certif*` hit is the explicit `NO … certification` non-claim.
- No TREMOR/CORONA tokens in any changed artifact.

Result: **clean** — only producer-artifact language + explicit non-claims. Claim ceiling preserved
(producer-artifact-only).

---

## AC Verification

| AC (scope-amendment §3 / sprint-plan §6) | Status | Evidence |
|------|--------|----------|
| **AC-5** — vectors exist + `jcs-parity.spec.js` asserts byte-equality + fail-closed throws; `canonicalize.js` unchanged (subset kept, no full-RFC swap); file documents the same vectors govern `bundle_digest` **and** Echelon `cert_hash` | ✓ Met | `spec/jcs-test-vectors.json` (29+10 vectors, `parity_basis.{bundle_digest,cert_hash}`); `test/unit/jcs-parity.spec.js` (43 pass); `canonicalize.js` byte-unchanged |
| **AC-6** — `feed_id` matches `^[a-z0-9]+(_[a-z0-9]+)*$`; BREATH emits `epa_airnow_aqi`; `assertFeedId` rejects a non-conforming id | ✓ Met | `markdown-members.js:106,121,171`; conformance T2.4 (3 tests pass) |
| **AC-7′** — manifest carries `bundle_schema_version: "1.0.0"`, independent of `ir_version` (`0.2.0`); digest move deliberate, re-baselined, recorded (old `991704ec…` → new captured); markdown hashes stable; no `ir_version == ProposalEnvelope.ir_version` equality assertion | ✓ Met | `assemble.js:82`; conformance T2.7 (5 tests pass); §9 digest table; §8 |
| **COMPAT-2/3/4/6** — `bundle_member_hash` null, `calibration_ref` null, `construct_source_ref` dual-axis, signature encoding pinned (no build) | ✓ Met | conformance T2.5 (5 tests pass); §11 |

No AC is `Not met` / `Partial`. No deferrals.

---

## 13. Known residuals

- None blocking. The `cert_hash` recompute is **Echelon-side** by design; FORGE asserts only the canonicalization
  parity basis (the shared vectors). No FORGE-side cert work is in scope or attempted.
- The comprehensive `composed_trust` do-not-emit suite remains **Sprint 05** (T2.5 includes only a light manifest/
  receipt absence check, explicitly noted in-test).
- `bundle_member_hash` self-referential resolution remains a deferred follow-up (present-and-null posture preserved; not
  a Sprint-02 concern).

---

## 14. Explicit confirmation

This sprint performed **implementation + validation + this report only**. Confirmed:

- **No review** — `/review-sprint` not run.
- **No audit** — `/audit-sprint` not run.
- **No commit** — 0 commits on the branch (working-tree only).
- **No push** — no branch pushed.
- **No tag** — none created.
- **No release** — none.
- **No package bump** — `package.json` stays `0.4.0`.
- **No Beads mutation** — `.beads/**` untouched.
- **No `master` touch** — `master`/`origin/master` at `715072c3`.
- **No integration fast-forward** — `cycle-003-integration`/`origin/cycle-003-integration` at `a1ca874e`.

**Stop condition reached.** Awaiting operator review and `/review-sprint`.
