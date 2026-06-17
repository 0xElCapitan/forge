# FORGE Cycle-003 Sprint 02 — Senior Review

**Canonicalization parity + receiving-alignment hardening (BREATH producer path)**

> **State-Zone review artifact. Review only.** No audit, no commit, no push, no tag, no release, no package bump, no
> Beads mutation, no `master` touch, no integration fast-forward. Verdict at the end.

**Sprint:** `cycle-003-s02-canonicalization-parity-receiving-alignment`
**Date:** 2026-06-17
**Reviewer:** Loa `/review-sprint` (`reviewing-code`) — independent, adversarial
**Implementation report reviewed:** `10-s02-implementation-report-canonicalization-parity-receiving-alignment.md`
**Method:** Verified against live code and re-run checks (full suite, fresh digest recomputation, git diffs, claim
greps). The implementation report was used as a map, not as evidence.

---

## Verdict summary

**PASS — ready for audit.** All 12 review-focus areas verified clean. The sprint is surgical (240 net insertions
across 4 tracked files + 2 new files; one-line source change in `assemble.js`), the canonicalizer is byte-unchanged,
the claim ceiling is preserved, and the full suite is green (904/0). Four non-blocking adversarial observations are
recorded below; none gate audit.

---

## 1. Branch / base / repo hygiene — ✓ PASS

| Check | Result |
|-------|--------|
| Active branch | `cycle-003-s02-canonicalization-parity-receiving-alignment` ✓ |
| Descends from `cycle-003-integration @ a1ca874e` | ✓ (merge-base = `a1ca874e`; HEAD = `a1ca874e`) |
| `master` / `origin/master` at `715072c3` | ✓ |
| `cycle-003-integration` / origin at `a1ca874e` | ✓ |
| Commits on branch | **0** (working-tree only — no commit/push) |
| Slash-form ref for this sprint | none (branch is hyphenated; pre-existing `claude/*`/`feat/*`/`release/*` branches are unrelated) |
| Tag / release / package bump / Beads mutation | none |

## 2. Changed files — ✓ PASS

Tracked-modified: `spec/STABILITY.md`, `src/bundle/assemble.js`, `src/bundle/markdown-members.js`,
`test/unit/bundle-conformance-posture.spec.js`. Untracked-new: `spec/jcs-test-vectors.json`,
`test/unit/jcs-parity.spec.js`. Plus State-Zone reports under `grimoires/loa/a2a/cycle-003/` (gitignored). **Exactly the
authorized set.** `STABILITY.md` change is scoped (one additive section). No unauthorized paths touched.

## 3. Forbidden-path audit — ✓ PASS

All byte-unchanged vs HEAD (`git diff --quiet` clean): `package.json` (`0.4.0`), `package-lock.json`,
`src/receipt/canonicalize.js`, `src/receipt/sign.js`, `spec/receipt-v0.json`, `src/ir/emit.js`,
`src/bundle/settlement.js`, `src/bundle/oracles.js`, `test/unit/bundle-boundaries.spec.js`, `README.md`,
`BUTTERFREEZONE.md`. No changes under `.github/`, `.claude/`, `.beads/`, `fixtures/`, `bin/`. No composed_trust schema/
emitter, no `scoring.*`, no cert-issuance, no runtime/CLI, no TREMOR/CORONA, no multi-construct generalization, no
VerificationReceipt substrate.

## 4. JCS vectors (`spec/jcs-test-vectors.json`) — ✓ PASS

- Describes existing `jcs-subset/v0` behavior — `schema_note` (L2): "DESCRIBES the existing
  src/receipt/canonicalize.js behavior … the canonicalizer is unchanged this sprint; these vectors pin its behavior".
- 29 canonical + 10 reject vectors. Pins: object key ordering (L79–81), nested structures (L77,L80,L83),
  `JSON.stringify` string behavior (L68–73), `JSON.stringify` number behavior incl. `-0`→`0`, `1e21`→`1e+21`, `1e-7`
  (L58–67), booleans/null (L55–57), fail-closed unsupported values (L86–95).
- Subset-vs-RFC deltas documented: 5 entries (numbers, negative_zero, strings, key_sorting, fail_closed_type_narrowing,
  L12–38).
- Parity basis for both `bundle_digest` (L9) and Echelon `cert_hash` (L10).
- **Does NOT imply FORGE computes/emits cert_hash** — L10: "The cert_hash recompute itself is Echelon-side; FORGE
  asserts only the canonicalization parity basis (no cert is issued or verified here)." ✓
- Independently re-validated: all 29 canonical match the in-repo canonicalizer; all 10 reject throw.

## 5. JCS parity tests (`test/unit/jcs-parity.spec.js`) — ✓ PASS

- Loads the vector file (L38, `JSON.parse(readFileSync(...))`).
- Canonical vectors assert exact string equality (L107). Reject vectors assert `throws(…, TypeError)` (L117) —
  stronger than required.
- Uses only the in-repo canonicalizer (sole non-builtin import is `canonicalize`, L29). No new dependency. No full-RFC
  swap (canonicalize.js byte-unchanged).
- **Anti-vacuous guard:** L96–99 asserts the canonical and reject sets are non-empty, so an empty/cleared vectors file
  fails rather than passing silently. `materialize` fails closed on an unknown `build` token (L65 throws a non-TypeError
  → the reject assertion's `TypeError` constructor check fails loudly).

## 6. feed_id grammar (`src/bundle/markdown-members.js`) — ✓ PASS

- `FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/` (L106) — exact.
- `assertFeedId` exported (L121); rejects non-string and non-conforming values (L122).
- Module-load self-check on `BREATH_FEED_ID` (L171), correctly ordered after `FEED_ID_GRAMMAR`@106 and
  `BREATH_FEED_ID`@153 are initialized — no temporal-dead-zone risk (module imports cleanly; full suite loads it).
- `BREATH_FEED_ID` preserved at `epa_airnow_aqi` (L153). Grammar not broadened. Unrelated markdown behavior unchanged
  (diff is purely additive). Independently exercised: `epa_airnow_aqi` passes; 12 malformed ids (uppercase, doubled/
  edge underscore, dash, space, dot, empty, non-ASCII, number, null, undefined) reject.

## 7. bundle_schema_version (`src/bundle/assemble.js`) — ✓ PASS

- `DEFAULT_BUNDLE_SCHEMA_VERSION` changed **only** `'0.1.0'` → `'1.0.0'` (L82; full diff is this one line).
- `DEFAULT_IR_VERSION` remains `'0.2.0'` (L70, untouched).
- ProposalEnvelope `ir_version` remains `0.3.0` — `proposal-ir.json` `version`/`ir_version.const` = `0.3.0`;
  `ir.spec.js` asserts `env.ir_version === '0.3.0'` (passes in suite).
- Emitted manifest `bundle_schema_version: "1.0.0"`, `ir_version: "0.2.0"` (conformance T2.7, L293–303; independently
  recomputed: default emits `1.0.0` / `0.2.0`).
- **No equality assertion** between `manifest.ir_version` and ProposalEnvelope `ir_version` was added — the conformance
  file imports no IR-envelope emitter; T2.7 asserts only the bundle's own two fields and that they *differ* (L309). ✓
- `package.json` remains `0.4.0`.

## 8. Determinism / digest re-baseline — ✓ PASS (independently recomputed)

| Member | OLD (0.1.0) | NEW (1.0.0) | Verdict |
|--------|-------------|-------------|---------|
| `bundle_digest` | `sha256:991704ec…` | `sha256:b8f05d8c…` | matches report; move confirmed |
| `manifest.json` | `99c6b29c…` | `b08ed9fb…` | moved (schema value lives here) |
| `SKILL.md` / `reality.md` / `handoff.md` | — | — | **stable** (byte-identical across the bump) |

Determinism with fixed `PINNED_NOW` preserved — two assembles with the same pin produce byte-identical members + digest
(independently confirmed). The re-baseline is deliberate and confined to the `manifest.json` member; absolute values are
recorded in the report (not pinned in a test literal, per the scope amendment).

## 9. Receiving-alignment no-change assertions — ✓ PASS

`bundle_member_hash` present-and-null and never a populated digest (T2.5, L226–231); `calibration_ref` null in object +
on disk (L233–240); `construct_source_ref` dual-axis — each oracle carries a distinct tier-resolving `source_id` and
provenance-only `construct_source_ref` (`airnow`/`epa_airnow`, `purpleair`/`purpleair_sensor`, L242–256); the four
receipt authenticity fields present-and-null = **no signature built** (L258–270); no cert/scoring/composed_trust keys
emitted (L272–281, exact-key match — `calibration_ref` does not false-trigger the `cert` check).

## 10. calibration_ref pointer — ✓ PASS

Recorded in `spec/STABILITY.md` (L132 section) and the report §10: `{cert_uri, cert_hash, n_resolutions, as_of,
verifier_type}` — record/design-note only, no schema key, no emitter path. `verifier_type` described as Echelon-owned;
`frozen_replay_baseline` is compatibility language only (not a FORGE Cycle-003 calibration claim); `frozen_baseline_hash`
not added. `manifest.calibration_ref` stays `null` (asserted, §9).

## 11. Claim ceiling — ✓ PASS

Claim/scope grep over added lines + new files: only producer-artifact language + explicit non-claims. The single
flagged token is the artifact's established proper name **`ConstructAdmissionBundle`** (pre-existing across
`src/bundle/`), not a new "Echelon admission" claim. STABILITY.md states "makes NO admission / certification / scoring /
runtime claim". No parser-acceptance, certification, calibration-improvement, optimization, signature production/
verification, SkillOpt/backend/L2/runtime readiness, multi-construct support, composed_trust emission, populated
`scoring.*`, BREATH round-trip, or TREMOR/CORONA claim.

## 12. Validation — ✓ PASS (re-run independently)

- `npm run test:all` → **904 pass / 0 fail** (baseline 848 + 56 new).
- `node --test test/unit/jcs-parity.spec.js` → 43 pass.
- `node --test test/unit/bundle-conformance-posture.spec.js` → 24 pass.
- Version-domain independence + old-digest checks: confirmed by fresh recomputation (§7, §8).
- Claim/scope-risk grep: clean (§11).

---

## AC Verification (report cross-check) — ✓ present and adequate

The implementation report contains an `## AC Verification` section walking **AC-5, AC-6, AC-7′, COMPAT-2/3/4/6**, each
`✓ Met` with specific `file:line` evidence (e.g. `markdown-members.js:106,121,171`; `assemble.js:82`; conformance
T2.5/T2.7). No AC is `Not met` / `Partial`; no deferrals. Evidence is specific (not "implemented in src/"). Gate
satisfied (Issue #475).

---

## Adversarial Analysis

### Concerns Identified (non-blocking)

1. **Stale JSDoc wording** — `src/bundle/assemble.js:79` still reads "**Initial** bundle schema version" while the value
   is now `1.0.0`. The substantive clause ("Versioned INDEPENDENTLY of `ir_version`") remains accurate and
   load-bearing. Leaving it was the **correct** call: the authorized write scope was "only the one-line value change",
   so touching the comment would have exceeded scope. Recommend a one-word touch-up (`Initial` → `Default`) in a future
   doc-hygiene pass — **does not block** this sprint.
2. **feed_id extracted via capture regex, not YAML parse** — `bundle-conformance-posture.spec.js:193` pulls `feed_id`
   from `handoff.md` with `/feed_id: "([^"]+)"/`. It validates the captured *value* (equals `epa_airnow_aqi`, passes
   `assertFeedId`), which is stronger than the pre-existing T7 substring match and satisfies "value-based, not bare
   substring". It is the one assertion not fully object-parsed — unavoidable, since `feed_id` lives in markdown and no
   YAML dependency is permitted. The JSON members (manifest/receipt) are properly `JSON.parse`d. Acceptable.
3. **Two canonical vectors are JS-only** — `negative_zero` (`jcs-test-vectors.json:59`) and
   `object_with_undefined_value` (L82) carry `build` tokens with no `input`, as do all 10 reject vectors. A Python
   (Echelon) porter of this "jointly-owned" file cannot directly consume those — they rely on the documented deltas
   instead. The parity-critical canonical vectors (numbers, strings, objects, the FORGE composite) all expose direct
   `input`/`canonical` pairs a porter can use, and `JCS_SUBSET_V0.md` §2 already says porters need not handle rejected
   types. Adequate for this sprint.

### Assumptions Challenged

- **Assumption:** `handoff.md` keeps the `feed_id: "<value>"` quoted-YAML line shape (relied on by `extractFeedId`,
  `bundle-conformance-posture.spec.js:193`).
  **Risk if wrong:** extraction returns `null` → T2.4 fails.
  **Recommendation:** No action — the failure is **visible and loud**, not silent (`assert.equal(null, 'epa_airnow_aqi')`
  fails; `assertFeedId(null)` throws). The coupling is acceptable precisely because it fails closed.

### Alternatives Not Considered

- **Alternative:** encode reject/edge values in the vectors via a language-neutral typed discriminator (e.g.
  `{"special":"infinity"}`) instead of JS-only `build` tokens, so Echelon's Python side can consume the full file
  uniformly.
  **Tradeoff:** more cross-language portable, but adds a mapping layer both sides must implement, and the reject
  vectors are explicitly out of a porter's required scope (`JCS_SUBSET_V0.md` §2).
  **Verdict:** Current approach justified for a producer-only sprint. A shared cross-org vector-exchange format is a
  reasonable future co-design item with Echelon (it pairs naturally with the `forge-shared-canonical-vectors.json`
  handshake noted in `JCS_SUBSET_V0.md` §6.5) — **not** required here.

### Build-token sync surface (note)

The test-side `BUILDERS` map (`jcs-parity.spec.js:46–59`) must stay in sync with the vectors file's `builder_tokens`.
A new token without a matching builder fails loudly (good fail-closed coupling), but it is a manual-sync point worth
keeping in mind when the vector set grows.

---

## Decision

All sprint tasks (T2.1–T2.8) are complete and verified against live code. Acceptance criteria (AC-5, AC-6, AC-7′,
COMPAT-2/3/4/6) are met with specific evidence. The change is surgical, the canonicalizer is byte-unchanged, the claim
ceiling holds, forbidden paths are untouched, and validation is green (904/0). The four adversarial observations are
documented and non-blocking.

**PASS — ready for audit**
