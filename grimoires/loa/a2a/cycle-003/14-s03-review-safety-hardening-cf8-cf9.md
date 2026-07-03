# FORGE Cycle-003 — Sprint 03 Review (Senior Tech Lead, adversarial)

**CF-8 settlement trust-tier guard + CF-9 boundary multi-line import detection**

> **State-Zone, local draft.** Review-only. No audit, no commit, no push, no tag, no release, no package bump, no Beads
> mutation, no master touch, no integration fast-forward. Implementation files were **not** edited by this review.

**Cycle:** 003
**Sprint:** `cycle-003-s03-safety-hardening-cf8-cf9`
**Reviewer pass:** `/review-sprint` (`reviewing-code`), adversarial protocol
**Date:** 2026-06-17
**Subject:** the implementation reported in `13-s03-implementation-report-safety-hardening-cf8-cf9.md`
**Method:** re-read the actual diff (not the report alone); independent re-run of the full suite; empirical regex probing; independent digest recompute; byte-level forbidden-path checks.

**Verdict:** **PASS — ready for audit** (2 non-blocking concerns documented in §Adversarial Analysis).

---

## 1. Branch / base / repo hygiene — ✓ PASS

| Check | Expected | Observed |
|-------|----------|----------|
| Active branch | `cycle-003-s03-safety-hardening-cf8-cf9` | ✓ |
| Descends from integration @ `91aa63f0` | yes | ✓ (`git merge-base --is-ancestor` → yes; HEAD == `91aa63f0`, 0 commits since) |
| `master` / `origin/master` | `715072c3` | ✓ both |
| `cycle-003-integration` / `origin` | `91aa63f0` | ✓ both |
| Slash-form refs | none | ✓ hyphenated branch name |
| commit / push / tag / release / pkg bump / Beads | none | ✓ (0 commits since integration; no tag at HEAD; `package.json` 0.4.0) |

## 2. Changed files — ✓ PASS

`git status --short` (tracked) is exactly the three authorized implementation/test paths:

```
 M src/bundle/settlement.js
 M test/unit/bundle-boundaries.spec.js
 M test/unit/bundle-conformance-posture.spec.js
```

The scoped State-Zone report (`13-…md`) is a gitignored local draft (cycle-artifact convention). No other tracked file changed. No unauthorized new test file or spec path was created (§11).

## 3. Forbidden-path audit — ✓ PASS

Independent `git diff --quiet` over every forbidden / invariant path returned **byte-unchanged** for all: `package.json`, `package-lock.json` (lockfile), `canonicalize.js`, `sign.js`, `receipt-v0.json`, `jcs-test-vectors.json`, `jcs-parity.spec.js`, `ir/emit.js`, `assemble.js`, `receipt.js`, `fields.js`, `markdown-members.js`, `oracles.js`, `oracle-trust.js`, `enums.js`, `spec/STABILITY.md`, `README.md`, `BUTTERFREEZONE.md`, `bin/forge-verify.js`. No `.github` / `.claude` / `.beads` in status. No composed_trust / scoring / cert / TREMOR / CORONA / forecast / multi-construct / VerificationReceipt path touched.

## 4. CF-8 settlement trust-tier guard — ✓ PASS

Code re-read at `src/bundle/settlement.js`:
- **Import** (`:34`) `TRUST_TIER` added to the existing `./enums.js` import (bundle-internal sibling; no boundary change).
- **Forge-oracle branch** (`:186-191`): `if (typeof tier !== 'string' || !TRUST_TIER.includes(tier)) throw` placed **before** the `=== 'unknown'` check (`:192`). Rejects non-string `getTrustTier(d.source_id)`.
- **Settlement-authority forge branch — declared tier** (`:235-240`): same guard on caller-supplied `s.declared_trust_tier`, **before** `canSettle` (`:241`). This is where `Object.prototype` and Echelon-owned strings fail closed.
- **Settlement-authority forge branch — resolved tier** (`:251-256`): same guard on `getTrustTier(s.settling_source_id)`, **before** the equality check.

Each requirement verified:

| Requirement | Verdict | Evidence |
|-------------|:------:|----------|
| Rejects non-string `trust_tier` | ✓ | `typeof tier !== 'string'` (both branches); test "Object.prototype" passes |
| Rejects non-enum `trust_tier` | ✓ | `!TRUST_TIER.includes(...)`; test "signal_initiated" passes |
| Both relevant FORGE branches guarded | ✓ | forge-oracle (`:186`) + settlement-authority (`:235`,`:251`) |
| Mirrors enum conventions + `TRUST_TIER` import | ✓ | faithful copy of `oracles.js:94-99`; `TRUST_TIER` from `./enums.js` |
| Valid BREATH path still passes | ✓ | "valid BREATH worked path passes" test; digest unchanged (§8) |
| Object.prototype / prototype-key source_ids fail closed | ✓ | `__proto__`, `constructor` → non-string → throw; `prototype` → `'unknown'` → existing reject |
| Echelon-owned states (`signal_initiated`) fail closed | ✓ | non-enum string → throw |
| No tier broadened | ✓ | `enums.js` byte-unchanged; `TRUST_TIER` still `['T0','T1','T2','T3','unknown']` |
| No composed_trust/scoring/cert/admission/runtime field added | ✓ | guard returns `void`; "guard emits nothing" test; claim grep clean |

**Cross-check the guard is on the emission path (not theater):** `src/bundle/assemble.js:261` calls `assertAuthoredOracleSettlement(...)` inside the `if (final)` block, **before** member materialization (`:298`). A hand-built `assembleBundle({final:true, ...})` with a prototype-key or non-enum settlement is rejected before any bundle bytes are produced. The guard is genuinely load-bearing.

## 5. CF-9 boundary multi-line import detection — ✓ PASS (1 non-blocking concern)

Code re-read at `test/unit/bundle-boundaries.spec.js:63`:
`reStatic = /(?:^|;|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm`

| Requirement | Verdict | Evidence (empirical) |
|-------------|:------:|----------------------|
| Detects multi-line `import {…} from '…'` | ✓ | probe: `['import {','  foo,',"} from 'ext-b';"]` → `["ext-b"]` |
| `[^;]`-bounded strategy safe (no obvious bypass on valid syntax) | ✓ (with caveat) | valid JS cannot place `;` between `import` and `from`; **caveat** = comment-semicolon (see Concern 1) |
| Existing single-line detection still works | ✓ | probe single-line → `["ext-a"]`; real-file walk green |
| Multi-line/split evasion covered by regression tests | ✓ | `:152` multi-line braced; `:159` synthetic forbidden external `exfiltrate-secrets` |
| Zero-importer + allowlist walks green | ✓ | `bundle-boundaries.spec.js` 10/10 pass; no new offenders/violations |
| Valid BREATH members no false-positive | ✓ | prose probe → `[]`; real-file walk unchanged |
| No parser dependency added | ✓ | regex-only; `package.json`/lockfile byte-unchanged |

Concern 1 (comment-semicolon false-negative) is documented in §Adversarial Analysis and is **non-blocking** — AC-8 as written is satisfied.

## 6. No-runtime / no-CLI assertions — ✓ PASS

`test/unit/bundle-conformance-posture.spec.js` `describe('S03 T3.4 …')` (`:476`):
- **Path-aware entrypoint scan** (`:484-495`): walks `src/bundle/` (12 `.js` files) and asserts no shebang / `process.argv` / `process.exit(` / `import.meta.main` / `require.main === module` via anchored regexes. Robust, not a vague substring sweep. Passes (offenders `[]`).
- **Export-surface lock** (`:497-506`): `assert.deepEqual(Object.keys(mod).sort(), [4 functions])` — **meaningful, not vacuous**; any new export (e.g. a CLI runner) breaks it.
- No `bin/*` change; no package scripts change; no CLI entrypoint; no runtime export for admission/parser/cert/scoring/round-trip/composed_trust (export list is exactly the four producer-authoring functions; `bin/forge-verify.js` byte-unchanged).

## 7. Sprint 01 / Sprint 02 invariant preservation — ✓ PASS

| Invariant | Verdict | Evidence |
|-----------|:------:|----------|
| `emitted_at_ms` emitted timestamp key | ✓ | T8 + S03 T3.5; `1735689600000` |
| ProposalEnvelope `ir_version` 0.3.0 | ✓ | full suite green (`ir.spec.js`) |
| bundle manifest `ir_version` 0.2.0 | ✓ | S02 T2.7 + S03 T3.5 |
| `bundle_schema_version` 1.0.0 | ✓ | S02 T2.7 + S03 T3.5 |
| `normalization_trace` populated | ✓ | full suite green (`ir.spec.js`) |
| JCS vectors + `canonicalize.js` unchanged | ✓ | byte-unchanged; `jcs-parity.spec.js` green |
| `feed_id` epa_airnow_aqi + grammar | ✓ | S02 T2.4 + S03 T3.5 |
| `package.json` 0.4.0 | ✓ | byte-unchanged |

## 8. Determinism and digest — ✓ PASS

Independent recompute (pinned `now=1735689600000`):
- `bundle_digest` = `sha256:b8f05d8c75f1faba9e40968a4c9cc4722b05d16245b26aa4cbdfe69246189bec` — **matches Sprint 02 post-state**.
- `manifest.json` member = `sha256:b08ed9fb7359dc422e7037052fc3e61e4e4bd84f33b10ce7cc9e7ce34313c100` — **matches report**.
- `SKILL.md` `fb8f3676…`, `reality.md` `a53b6ca1…`, `handoff.md` `f3332210…` — stable. (The digest is `sha256(canonicalize(members[]))`; an unchanged aggregate digest with an unchanged manifest member entails the markdown members are byte-identical too.)
- The CF-8 guard adds only throw paths on invalid input; the valid producer path is byte-identical → no digest move, as expected (Sprint Plan §6 expects none).

## 9. Validation — ✓ PASS

| Check | Result |
|-------|--------|
| `npm run test:all` (independent re-run) | **924 pass / 0 fail** (= 904 baseline + 20 new S03) |
| Targeted CF-8 trust-tier tests | pass (8 cases) |
| Targeted CF-9 boundary/multi-line tests | pass (6 cases; boundary spec 10/10) |
| Targeted no-runtime/no-CLI tests | pass (3 cases) |
| Claim/scope-risk grep over changed files | clean (no positive-claim hits) |
| Forbidden/invariant byte-checks | clean (all byte-unchanged) |

## 10. Claim ceiling — ✓ PASS

Claim grep over added lines returns only negative assertions, fail-closed comments, and absence-detection patterns — no positive claim. No Echelon admission, parser acceptance, certification, calibration, optimization, signature production/verification, SkillOpt/backend/L2/runtime readiness, multi-construct support, composed_trust emission, populated `scoring.*`, BREATH round-trip, TREMOR/CORONA, or VerificationReceipt claim. Producer-only ceiling preserved; digest match (§8) confirms emitted artifacts are unchanged.

## 11. Scope reconciliation — ✓ PASS

- **STABILITY note skipped — correct.** Sprint Plan §6 Sprint 03 forbidden paths include `spec/**` (`03-cycle-003-sprint-plan.md:422-424`); T3.6 is optional ("only if warranted"). Deferring to the Sprint Plan path is the right call. `spec/STABILITY.md` byte-unchanged.
- **CF-8 tests in `bundle-conformance-posture.spec.js` — correct.** It is named in the operator's expected-path list AND qualifies as §6's "extend an existing bundle spec." It is the authorized intersection path.
- **No unauthorized new test file or spec path** — the declined `settlement-trust-tier-guard.spec.js` was not created; verified via `git status` (only 3 tracked files).

---

## AC Verification (cross-check of report §AC Verification)

| AC | Status | Reviewer confirmation |
|----|:------:|-----------------------|
| **AC-7** (FR-5) — guard rejects non-string/non-enum trust_tier incl. `{trust_tier: Object.prototype}` + prototype-key source_ids; no runtime/CLI entrypoint | ✓ Met | Code `settlement.js:186/235/251`; tests pass; T3.4 confirms no entrypoint; guard on emission path (`assemble.js:261`) |
| **AC-8** (FR-6) — detection matches multi-line `import {…} from '…'`; synthetic multi-line forbidden import caught | ✓ Met | `bundle-boundaries.spec.js:63` + regression `:152`/`:159`; empirically confirmed |
| **AC-14 (partial)** (NFR-BOUNDARY) — `src/bundle/` zero runtime importers; CF-9 strengthens; boundary test green | ✓ Met | zero-importer walk green (10/10) under stronger regex |
| **AC-15** (NFR-CEIL) — claim grep clean | ✓ Met | independent grep clean |

The report's `## AC Verification` section is present, complete, and accurate. Evidence is specific (file:line), not vague.

---

## Adversarial Analysis

### Concerns Identified

1. **CF-9 comment-semicolon false-negative (NON-BLOCKING).** Empirically confirmed at `test/unit/bundle-boundaries.spec.js:63`: a multi-line braced import with a `;` inside a line or block comment between `import` and `from` is **not detected** by the `[^;]*?` bound:
   - `import {\n  foo, // sneaky ; semicolon\n} from 'evil';` → `importSpecifiers` returns `[]`.
   - `import {\n  foo, /* a ; b */\n} from 'evil2';` → `[]`.
   This is the *false-negative* (security-relevant) direction. **Why non-blocking:** (a) AC-8 as written is satisfied — it requires detecting multi-line `import {…} from '…'`, which works; the comment-semicolon case is beyond the AC; (b) it is precondition-only **test** hardening (defense-in-depth), not a runtime control; (c) **no current exposure** — `src/bundle/` has no such construct and the real-file walk is green; (d) it is strictly better than the pre-CF-9 line-anchored regex, which missed *all* multi-line imports; (e) the implementer flagged the `[^;]` vs `[\s\S]` tradeoff in report §12. **Recommendation:** add the comment-semicolon residual to the boundary threat model explicitly; a future hardening could strip comments before scanning. Audit may note but need not block.

2. **CF-9 side-effect import not detected — pre-existing, out of scope (NON-BLOCKING).** Neither the old nor the new regex detects a pure side-effect import (`import 'evil-pkg';`, no `from`): probe returns `[]`. CF-9's scope is `import {…} from '…'`, so this is not a regression — but it is a real boundary-detection gap (a forbidden external could be reached as a side effect). **Recommendation:** note in the threat model; consider a separate `import\s*['"]([^'"]+)['"]` (from-less) detector in a future hardening pass.

3. **T3.4 entrypoint scan is non-recursive (NON-BLOCKING).** `bundle-conformance-posture.spec.js:478` uses `readdirSync(bundleDir)` (flat). Correct today (`src/bundle/` has no subdirectories; the `>=12` assertion would still hold), but a future `src/bundle/<subdir>/cli.js` would escape the scan. **Recommendation:** if `src/bundle/` ever gains subdirectories, switch to a recursive walk (the sibling `bundle-boundaries.spec.js` already has `walkJs`).

4. **Settlement resolved-tier guard (`settlement.js:251`) is unreachable through the public function (NON-BLOCKING, by design).** AC-16 cross-reference + the forge-oracle loop guard catch a prototype-key `settling_source_id` before the settlement branch runs, so no test can exercise `:251` directly through `assertAuthoredOracleSettlement`. It is correctly retained as a defense-in-depth mirror per SDD §5 Lane 5 ("both branches … on `getTrustTier(s.settling_source_id)`"). Acknowledged in report §12. No action needed.

### Assumptions Challenged

- **Assumption:** the boundary spec is a sufficient control that `src/bundle/` imports no forbidden module.
  - **Risk if wrong:** the detector is a heuristic regex, not a parser (the SDD forbids a parser dependency). Concerns 1 and 2 show two evasion classes (comment-semicolon multi-line; from-less side-effect) it does not cover.
  - **Recommendation:** keep treating the boundary test as **defense-in-depth layered with code review**, not the sole control — which is exactly how the implementer frames it ("precondition only"). Make the two known heuristic gaps explicit in the threat model so a future reader does not over-trust the green check. **Verdict:** the framing is correct; only the residual-gap documentation is missing.

### Alternatives Not Considered

- **Alternative:** strip `//…` and `/*…*/` comments from file content before applying `reStatic` (then `[\s\S]*?` could be used safely), instead of the `[^;]*?` bound.
  - **Tradeoff:** closes the comment-semicolon evasion (Concern 1) and, combined with `[\s\S]*?`, would still avoid the prose false-positive that `[\s\S]*?` alone produces (empirically: bare `[\s\S]*?` captured `not-an-import` from a string literal). Cost: ~3–5 lines of comment-stripping; stripping string literals too would approach a mini-tokenizer (arguably against the "no parser" spirit).
  - **Verdict:** worth a future hardening pass, but the current `[^;]` choice is **justified for this sprint** — it avoids the prose-string false-positive that would otherwise break the real-file walk on legitimate code, it adds no parser dependency, and AC-8 is met. The choice is a reasonable point in the heuristic tradeoff space, not a defect.

### Minimum-challenge ledger
Concerns: 4 (all non-blocking). Assumptions challenged: 1. Alternatives considered: 1. No blocking concern identified; no escalation triggered.

---

## Decision

All eleven required focus areas pass. CF-8 is correctly placed, mirrors the established `oracles.js` convention, sits on the real emission path (`assemble.js:261`), fails closed on non-string / non-enum / Echelon-owned trust states, and leaves the valid BREATH path and bundle digest byte-identical. CF-9 detects multi-line imports per AC-8, keeps the zero-importer + allowlist walks green, and adds no parser dependency. No-runtime/no-CLI assertions are path-aware and non-vacuous. All Sprint 01/02 invariants hold; the digest is unmoved; the claim ceiling is preserved; scope reconciliation (skipped STABILITY, intersection test path) is correct. The four concerns are non-blocking, documented, and carry explicit tradeoff justification.

## PASS — ready for audit

Non-blocking concerns (CF-9 comment-semicolon residual, from-less side-effect detection gap, non-recursive entrypoint scan, unreachable defense-in-depth guard) are recorded above for audit visibility and a future hardening pass; none gate `/audit-sprint`.

Stopping after review. No audit, commit, push, integration, tag, release, package bump, Beads mutation, or master touch performed.
