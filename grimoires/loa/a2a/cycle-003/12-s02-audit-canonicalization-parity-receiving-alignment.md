# FORGE Cycle-003 Sprint 02 — Security & Quality Audit

**Canonicalization parity + receiving-alignment hardening (BREATH producer path)**

> **State-Zone audit artifact. Audit only.** No fixes, no implementation edits, no commit, no push, no tag, no release,
> no package bump, no Beads mutation, no `master` touch, no integration fast-forward. Verdict at the end.

**Sprint:** `cycle-003-s02-canonicalization-parity-receiving-alignment`
**Date:** 2026-06-17
**Auditor:** Loa `/audit-sprint` (`auditing-security`) — Paranoid Cypherpunk Auditor, final gate
**Reviewed after:** PASS review (`11-s02-review-…md`)
**Method:** Independent verification against live code — cryptographic blob-hash proof of forbidden-path immutability,
re-executed test suite, fresh digest recomputation, empirical injection-resistance testing. The implementation report
and review were used as maps, not as evidence.

---

## Verdict summary

**PASS — ready for operator commit approval.** All 12 audit objectives independently verified. No security findings.
The sprint is surgical (one-line source change + additive grammar helper + test/vector/doc additions), fail-closed,
injection-resistant, and claim-ceiling-preserving. The canonicalizer is byte-identical to HEAD (blob-hash proven). The
four review residuals are all non-blocking (2 future-cleanup, 2 acceptable-as-is). No COMPLETED marker created and no
commit performed — per the scoped instruction, this awaits operator commit approval.

---

## 1. Branch / base / repo hygiene — ✓ PASS

Active branch `cycle-003-s02-canonicalization-parity-receiving-alignment`; HEAD = base = merge-base = `a1ca874e`;
`master`/`origin/master` = `715072c3`; `cycle-003-integration`/origin = `a1ca874e`; **0 commits** since base; **no tags
point at HEAD**; no push/tag/release/package-bump/Beads mutation.

## 2. Changed-file scope — ✓ PASS

Tracked-modified: `spec/STABILITY.md`, `src/bundle/assemble.js`, `src/bundle/markdown-members.js`,
`test/unit/bundle-conformance-posture.spec.js`. Untracked-new: `spec/jcs-test-vectors.json`,
`test/unit/jcs-parity.spec.js`. State-Zone reports `10-…` / `11-…` (this is `12-…`) under
`grimoires/loa/a2a/cycle-003/` (gitignored). **Exactly the authorized set.**

## 3. Forbidden-path immutability — ✓ PASS (cryptographically proven)

Working-tree blob hash == HEAD blob hash (byte-identity, stronger than a diff flag):

| Path | Blob (HEAD == WT) |
|------|-------------------|
| `src/receipt/canonicalize.js` | `37005fa3…` ✓ |
| `src/receipt/sign.js` | `bac96c24…` ✓ |
| `src/ir/emit.js` | `e5f52dc8…` ✓ |
| `spec/receipt-v0.json` | `b375480a…` ✓ |
| `src/bundle/settlement.js` | `8b132054…` ✓ |
| `src/bundle/oracles.js` | `e591617e…` ✓ |
| `test/unit/bundle-boundaries.spec.js` | `d17f0c4b…` ✓ |
| `package.json` | `16271564…` (`0.4.0`) ✓ |

No changes under `.github/`, `.claude/`, `.beads/`, `fixtures/`, `bin/`. No composed_trust schema/emitter, no
`scoring.*`, no cert-issuance, no runtime/CLI, no TREMOR/CORONA, no multi-construct generalization, no VerificationReceipt
substrate. The byte-identity of `canonicalize.js` is the load-bearing fact for the entire parity claim — **proven**.

## 4. JCS vectors and parity — ✓ PASS (independently re-executed)

- Names `jcs-subset/v0` (vectors L3); 29 canonical + 10 reject vectors; canonical assert exact equality (parity test
  L107); reject fail-closed (L117, `throws(…, TypeError)`).
- **Documented deltas independently confirmed accurate** against the live canonicalizer: `-0`→`"0"`,
  `1e20`→`"100000000000000000000"`, `1e21`→`"1e+21"`, `1e-6`→`"0.000001"`, `1e-7`→`"1e-7"`, `"€"`→raw-UTF-8,
  embedded-quote escaping — all match. The deltas are truthful, not misleading.
- **Reject vectors independently fail-closed**: Infinity, -Infinity, NaN, undefined, BigInt, Date, function, symbol,
  nested-in-object, nested-in-array — all throw `TypeError`.
- Parity basis stated for both `bundle_digest` (L9) and Echelon `cert_hash` (L10). **Language does not imply FORGE
  computes/emits/certifies cert_hash** — L10 verbatim: "The cert_hash recompute itself is Echelon-side; FORGE asserts
  only the canonicalization parity basis (no cert is issued or verified here)."
- Parity test imports only the in-repo `canonicalize` (L29); no new dependency; no full-RFC swap (canonicalize.js
  blob-identical). Anti-vacuous guard present (L96–99); fail-closed on unknown build tokens (L65).
- Re-executed: `node --test test/unit/jcs-parity.spec.js` → 43/0; `test/unit/canonicalize.spec.js` → 31/0 (the
  canonicalizer's own suite still green).

## 5. feed_id grammar — ✓ PASS (injection-tested)

- `FEED_ID_GRAMMAR.source === '^[a-z0-9]+(_[a-z0-9]+)*$'`, flags `""` — exact (markdown-members.js:106).
- `assertFeedId` exported (L121); rejects non-string + non-conforming. `BREATH_FEED_ID` = `epa_airnow_aqi` (L153).
  Module-load self-check effective (L171, runs after both consts initialize). Unrelated markdown behavior unchanged
  (purely additive diff).
- **Security — injection resistance empirically verified.** `assertFeedId` rejects every injection payload tested:
  `epa_airnow_aqi\ninjected_key: evil`, **`epa_airnow_aqi\n` (trailing-newline bypass)**, `epa"quote`, `epa:colon`,
  `epa aqi`, `epa#hash`, `epa{brace}`, `../etc/passwd`, uppercase, doubled/edge underscore, dash, dot, empty. The
  trailing-newline rejection **empirically confirms** the JSDoc claim that JS `$` (no `m` flag) does not match before a
  trailing newline — the Python-`$` YAML-injection bypass class is genuinely closed. `feed_id` reaches `handoff.md` only
  as a load-validated frozen constant, so there is no live injection surface; the grammar is the forward guard.

## 6. bundle_schema_version alignment — ✓ PASS

`DEFAULT_BUNDLE_SCHEMA_VERSION` changed **only** `'0.1.0'`→`'1.0.0'` (`assemble.js:82`; `git diff --numstat` = `1 1`).
`DEFAULT_IR_VERSION` unchanged at `'0.2.0'` (L70). Emitted manifest `bundle_schema_version: "1.0.0"`, `ir_version:
"0.2.0"` (independently emitted). ProposalEnvelope `ir_version` = `0.3.0` (`proposal-ir.json` const + `ir.spec.js`).
`package.json` = `0.4.0`. **No equality lock**: the conformance test imports no IR emitter and contains no assertion
coupling `manifest.ir_version` to the envelope — the only `0.3.0`/envelope mention is an explanatory comment (L289)
documenting the deliberate non-coupling. **No stale 0.1.0 pinned expectation**: the two `'0.1.0'` test occurrences are
explicit input params (the T8 content-addressing fixture and the T2.7 old-digest derivation), not assertions of the
emitted default.

## 7. Determinism / digest re-baseline — ✓ PASS (independently recomputed)

Fresh recomputation (`PINNED_NOW = 1735689600000`): old `sha256:991704ec…` → new `sha256:b8f05d8c…`. `manifest.json`
member hash moved; `SKILL.md` / `reality.md` / `handoff.md` hashes byte-stable (`only manifest.json moved: true`). Fixed-
now determinism preserved (two assembles → identical members + digest). No unrelated member bytes changed.

## 8. Receiving-alignment no-change postures — ✓ PASS

Independently emitted BREATH bundle: `bundle_member_hash` present-and-null (never a populated digest); `calibration_ref`
present-and-null; `construct_source_ref` dual-axis (each oracle carries distinct `source_id` + `construct_source_ref`:
`airnow`/`epa_airnow`, `purpleair`/`purpleair_sensor`); the four authenticity fields (`publisher_signature`,
`signing_key_id`, `trust_policy_ref`, `revocation_ref`) all present-and-null = **no signature built**; no cert/scoring/
composed_trust key in manifest or receipt (exact-key check; `calibration_ref` does not false-trigger `cert`).

## 9. calibration_ref pointer record — ✓ PASS

`spec/STABILITY.md:152–153` records `{cert_uri, cert_hash, n_resolutions, as_of, verifier_type}` — record/design-note
only, no schema key, no emitter path. `verifier_type` described Echelon-owned; `frozen_replay_baseline` is compatibility
language only; **`frozen_baseline_hash` appears solely in the "is NOT added this cycle" disclaimer** (never as a field).

## 10. Claim ceiling — ✓ PASS

Comprehensive claim-ceiling scan over added lines + new files (negations filtered): **no positive overclaim**. No
Echelon-admission, parser-acceptance, certification, calibration-improvement, optimization, signature production/
verification, SkillOpt/backend/L2/runtime readiness, multi-construct support, composed_trust emission, populated
`scoring.*`, BREATH round-trip, or TREMOR/CORONA claim. The only token resembling a claim is the artifact's established
proper name `ConstructAdmissionBundle` (pre-existing across `src/bundle/`). For a cross-org trust boundary, ceiling
integrity is the security property — and it holds.

## 11. Validation — ✓ PASS (re-executed)

`npm run test:all` → **904 pass / 0 fail**. Targeted: jcs-parity 43/0, bundle-conformance-posture 24/0, canonicalize
31/0. Grep/parsed checks: no stale `0.1.0` bundle_schema_version assertion; no IR equality lock; claim/scope-risk grep
clean.

## 12. Review-residual classification — ✓ all non-blocking

| # | Residual | Classification | Rationale |
|---|----------|----------------|-----------|
| 1 | `assemble.js:79` JSDoc "**Initial** bundle schema version" (value now `1.0.0`) | **Non-blocking — future cleanup** | Cosmetic doc-accuracy nit. Leaving it was correct (the authorized scope was the one-line value change; touching the comment would exceed scope). Substantive clause ("Versioned INDEPENDENTLY of `ir_version`") stays accurate. Natural home: the Sprint-04 doc-hygiene lane (`Initial`→`Default`). |
| 2 | feed_id capture-regex extraction (`bundle-conformance-posture.spec.js:193`) | **Non-blocking — acceptable as-is** | Value-based (extracts + validates the value), stronger than bare substring; best available with no YAML dependency permitted. JSON members are properly `JSON.parse`d. Fails loud on format drift. No security exposure (feed_id is a load-validated frozen constant). |
| 3 | JS-only builder-token edge vectors (`jcs-test-vectors.json:59,82` + reject vectors) | **Non-blocking — future cleanup** | Two canonical + all reject vectors are JS-specific (no `input`), limiting direct Python-porter reuse of those edges. Parity-critical canonical vectors all expose direct `input`/`canonical` pairs; `JCS_SUBSET_V0.md` §2 says porters need not handle rejected types; deltas document the edge behavior. A language-neutral cross-org vector-exchange format is a future co-design item (pairs with the `forge-shared-canonical-vectors.json` handshake, §6.5). |
| 4 | Manual `BUILDERS` ↔ `builder_tokens` sync surface (`jcs-parity.spec.js:46–59`) | **Non-blocking — acceptable as-is** | Inherent to encoding non-JSON values as tokens. The coupling **fails closed** — a token without a builder throws loudly (the reject assertion's `TypeError` check fails), never a silent skip. The alternatives (eval / inline JS in JSON) are worse. |

---

## Security findings

**None.** Security-relevant surfaces audited:

- **Input validation / injection** — the canonicalizer fails closed on every unsafe type (10 reject vectors throw); the
  new `assertFeedId` grammar is injection-resistant (trailing-newline, colon, quote, brace, path-traversal all rejected,
  empirically). `settlementSourceId` interpolation remains guarded by the unchanged `assertSafeIdentifier`. No new
  injection surface.
- **Fail-closed posture** — canonicalizer, `assertFeedId`, and the parity test's unknown-token path all fail closed.
- **Determinism / content-addressing integrity** — digest is `sha256(canonicalize(members[]))`; the re-baseline is
  deliberate and confined to `manifest.json`; no determinism regression.
- **Cross-org trust-boundary integrity (claim ceiling)** — FORGE makes no admission/cert/scoring claim; `cert_hash`
  computation is correctly attributed to Echelon with an explicit FORGE disclaimer. Ceiling preserved.
- **Secrets / auth / network / runtime** — none introduced (producer-only, not on any runtime import path; no
  credentials, no network, no CLI/bin).

## Decision

All sprint tasks (T2.1–T2.8) are complete and independently verified against live code. Forbidden paths are
cryptographically proven byte-identical to HEAD. The canonicalization parity, feed_id injection resistance, version-
domain independence, deterministic digest re-baseline, receiving-alignment postures, and claim ceiling all hold. Full
suite green (904/0). No security findings. The four review residuals are non-blocking.

Per the scoped instruction, no COMPLETED marker is created and nothing is committed — the sprint awaits operator commit
approval.

**PASS — ready for operator commit approval**
