# FORGE Cycle-003 — Sprint 03 Security Audit (Paranoid Cypherpunk Auditor)

**CF-8 settlement trust-tier guard + CF-9 boundary multi-line import detection**

> **State-Zone, local draft.** Audit-only. No implementation, no edit of implementation files, no commit, push, tag,
> release, package bump, Beads mutation, master touch, or integration fast-forward. Per operator instruction, this pass
> produces **only** this scoped audit report and does **not** create a `COMPLETED` marker or advance the workflow — the
> operator retains the commit-approval gate.

**Cycle:** 003
**Sprint:** `cycle-003-s03-safety-hardening-cf8-cf9`
**Audit pass:** `/audit-sprint` (`auditing-security`), runs after `/review-sprint` → **PASS**
**Date:** 2026-06-17
**Method:** independent re-verification from scratch — git byte-checks; full-suite re-run; **broad prototype-chain stress of the CF-8 guard**; CF-9 evasion reproduction + hunt; independent digest recompute; runtime-importer hunt across `src/` **and** `bin/`. The implementation and review reports were read but not trusted as evidence.

**Verdict:** **PASS — ready for operator commit approval.** No CRITICAL/HIGH/MEDIUM security findings. Four LOW / non-blocking residuals are classified below (none gate commit).

---

## Security posture summary

| Severity | Count | Items |
|----------|:-----:|-------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW / non-blocking | 4 | CF-9 comment-semicolon false-negative; from-less side-effect detection gap; non-recursive T3.4 scan; unreachable defense-in-depth guard |

CF-8 is a genuine prototype-pollution defense (CWE-1321) and is **complete** (0 bypasses, see §4). CF-9 is defense-in-depth test hardening with documented heuristic residuals. No new attack surface, no claim-ceiling breach, no producer-byte change.

---

## 1. Branch / base / repo hygiene — ✓ CONFIRMED

`branch=cycle-003-s03-safety-hardening-cf8-cf9`; `git merge-base --is-ancestor 91aa63f0 HEAD` → yes; `HEAD=91aa63f0`; commits-since-integration = **0**; no tag at HEAD. `master`/`origin/master` = `715072c3`; `cycle-003-integration`/`origin` = `91aa63f0`. No commit/push/tag/release/package-bump/Beads mutation occurred.

## 2. Changed files — ✓ CONFIRMED

Tracked: exactly `src/bundle/settlement.js`, `test/unit/bundle-boundaries.spec.js`, `test/unit/bundle-conformance-posture.spec.js`. Scoped State-Zone reports `13-…` and `14-…` (gitignored local drafts) plus this `15-…` report. No other tracked change.

## 3. Forbidden paths byte-unchanged — ✓ CONFIRMED

Independent `git diff --quiet` over all listed paths returned byte-unchanged: `package.json` (0.4.0), `package-lock.json`, `canonicalize.js`, `sign.js`, `receipt-v0.json`, `jcs-test-vectors.json`, `jcs-parity.spec.js`, `ir/emit.js`, `assemble.js`, `receipt.js`, `fields.js`, `markdown-members.js`, `oracles.js`, `oracle-trust.js`, `enums.js`, `spec/STABILITY.md`, `README.md`, `BUTTERFREEZONE.md`, `bin/forge-verify.js`. No `.github`/`.claude`/`.beads`. No composed_trust/scoring/cert/TREMOR/CORONA/forecast/multi-construct/VerificationReceipt path touched.

## 4. CF-8 settlement trust-tier guard — ✓ CONFIRMED COMPLETE (prototype-pollution defense)

Independent stress of `assertAuthoredOracleSettlement` across the **entire Object.prototype attack surface** an attacker could supply as a forge `source_id` / `settling_source_id`, plus all non-string `declared_trust_tier` shapes:

| Input class | getTrustTier resolves to | Result |
|-------------|--------------------------|--------|
| `__proto__` | `object` (Object.prototype) | THROW (non-string guard) |
| `constructor` | `function` (Object) | THROW (non-string guard) |
| `prototype`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__` | `string 'unknown'` (lowercasing breaks camelCase chain access) | THROW (unknown check) |
| `declared_trust_tier` = Object.prototype / array / number / bool / null / obj / func | n/a | THROW (non-string guard) |

**TOTAL BYPASSES: 0.** Every output of `getTrustTier` is one of {valid tier T0–T3 (legit), `'unknown'` (rejected), non-string (rejected)} — the guard `typeof tier !== 'string' || !TRUST_TIER.includes(tier)` plus the downstream `=== 'unknown'` / `canSettle` checks cover the complete space. No prototype key reaches an accepted settlement.

Per-requirement:
- rejects non-string `trust_tier` — ✓ (both branches, `settlement.js:186/251`)
- rejects non-enum `trust_tier` — ✓ (`signal_initiated`, `settlement.js:235`)
- both FORGE branches guarded — ✓ (forge-oracle `:186`; settlement-authority declared `:235` + resolved `:251`)
- mirrors enum conventions + `TRUST_TIER` import — ✓ (faithful copy of `oracles.js:94-99`; import `:34`)
- valid BREATH path passes — ✓ (digest unchanged, §10)
- Object.prototype / `__proto__` / `constructor` / prototype-key source_ids fail closed — ✓ (table above)
- Echelon-owned states (`signal_initiated`) fail closed — ✓
- no tier broadened — ✓ (`enums.js` byte-unchanged; `TRUST_TIER` = `['T0','T1','T2','T3','unknown']`)
- no composed_trust/scoring/cert/admission/runtime field added — ✓ (gate returns `void`)

**Emission-path confirmation:** `assemble.js:261` invokes the gate inside `if (final)`, before member materialization (`:298`). The guard is load-bearing on the only settlement-authority-conformant emission path. Prototype-pollution defense is real, not theater.

## 5. CF-9 boundary multi-line import detection — ✓ CONFIRMED (residual in §6)

Independent regex probing of `bundle-boundaries.spec.js:63`:
- multi-line `import {\n foo,\n} from 'x'` → detected ✓; CRLF multiline → detected ✓; tab-separated → detected ✓; `export * from 'x'` namespace re-export → detected ✓.
- single-line detection intact ✓; regression tests present (`:152` multi-line, `:159` synthetic forbidden external).
- zero-importer + allowlist walks green (full suite); no false-positive on prose ✓.
- no parser dependency added (`package.json`/lockfile byte-unchanged) ✓.

## 6. Audit of the review's CF-9 false-negative finding — REPRODUCED → NON-BLOCKING RESIDUAL

**Reproduced** the reported miss: `import {\n foo, // ;\n} from 'evil';` → `importSpecifiers` returns `[]` (evades); block-comment form `/* ; */` also evades. The `[^;]*?` span stops at the comment's `;`.

**Classification: NON-BLOCKING RESIDUAL (future hardening).** Security reasoning:
- The boundary spec is a **third-layer** defense-in-depth assertion, not the security boundary itself. It sits atop (a) code review and (b) an independently-verified fact: my runtime-importer hunt confirms **no file in `src/` OR `bin/` (including the `bin/forge-verify.js` CLI) imports the producer** — the producer has zero runtime importers regardless of the regex. The test asserts a property that is independently true today.
- **No current exposure:** `src/bundle/` contains no multi-line-comment-semicolon import; the real-file walk is green.
- **AC-8 as written is satisfied** (multi-line `import {…} from '…'` is detected). The comment-semicolon case is beyond the AC's scope.
- **Tradeoff weighed against the SDD `[\s\S]*?` alternative:** I reproduced both failure modes. `[^;]*?` (shipped) → comment-semicolon false-negative, but **no** prose-string false-positive. `[\s\S]*?` (SDD literal) → catches the comment-semicolon case, but produces a prose-string **false-positive** (`import './a.js';\nconst u="from 'fake'"` → captures `fake`), which would break the real-file walk on legitimate code containing a string with `from '...'`. Since the SDD forbids a parser dependency, no regex closes both directions. The shipped choice fails **safe** for the real-file walk (no spurious red on legit code) at the cost of an obscure deliberate-obfuscation evasion — a defensible point in the tradeoff space.
- **Recommendation (do NOT fix during audit):** record the comment-semicolon (and block-comment) residual in a boundary threat-model note; a future hardening pass could add a comment-stripping pre-pass (strip `//…` and `/*…*/` before scanning), which would close the evasion without the prose-string false-positive. Tracked as future cleanup, not a Sprint-03 blocker.

## 7. Audit of the three additional review residuals

| Residual | Reproduced | Classification | Reasoning |
|----------|:----------:|----------------|-----------|
| from-less side-effect import (`import 'pkg'`) not detected | ✓ (`[]`) | **NON-BLOCKING / pre-existing, out of scope → future cleanup** | Neither the old nor new regex detected from-less imports; CF-9 scope was explicitly multi-line `import {…} from`. Not introduced or regressed by S03. Mitigated by the same layered controls + zero-importer fact. Future: add a separate `import\s*['"]([^'"]+)['"]` from-less detector. |
| T3.4 entrypoint scan non-recursive | ✓ (`readdirSync` flat) | **NON-BLOCKING / correct for current surface** | `src/bundle/` is flat (12 `.js`, 0 subdirs — verified). Scan is complete today. The sibling `bundle-boundaries.spec.js` already has a recursive `walkJs`; switch to it if `src/bundle/` ever gains subdirectories. No current gap. |
| `settlement.js:251` resolved-tier guard unreachable | ✓ (AC-16 + loop guard catch first) | **NON-BLOCKING / by design — keep** | A faithful mirror per SDD §5 Lane 5 ("both branches … on `getTrustTier(s.settling_source_id)`"). Unreachable-but-present defense-in-depth is sound practice — robust to a future refactor that reorders checks. Not harmful dead code. No action. |

None rise to a blocker.

## 8. No-runtime / no-CLI assertions — ✓ CONFIRMED

- Path-aware entrypoint scan (`bundle-conformance-posture.spec.js:484`) robust for the flat `src/bundle/` surface (anchored regexes for shebang/`process.argv`/`process.exit`/`import.meta.main`/`require.main`); offenders `[]`.
- Export-surface lock (`:497`) is a real `deepEqual` against the exact four producer-authoring functions — **not vacuous**; a new CLI/runner export would fail it.
- No `bin/*` change; no package-scripts change; no CLI entrypoint; no runtime export for admission/parser/cert/scoring/round-trip/composed_trust.
- **Paranoid cross-check:** runtime-importer hunt over `src/` + `bin/` → the producer has **zero** importers anywhere; the CLI does not reach it.

## 9. Sprint 01 / Sprint 02 invariant preservation — ✓ CONFIRMED

`emitted_at_ms` is the timestamp key (no bare `emitted_at`); ProposalEnvelope `ir_version` 0.3.0; bundle manifest `ir_version` 0.2.0; `bundle_schema_version` 1.0.0; `normalization_trace` populated; JCS vectors + `canonicalize.js` byte-unchanged; `feed_id` `epa_airnow_aqi` passes grammar; `package.json` 0.4.0. (Full suite green; independent digest recompute confirms the manifest fields.)

## 10. Determinism and digest — ✓ CONFIRMED

Independent recompute (pinned `now`): `bundle_digest` = `sha256:b8f05d8c…189bec` **matches S02**; `manifest.json` member = `sha256:b08ed9fb…3c100` **matches report**; the digest is `sha256(canonicalize(members[]))`, so an unchanged aggregate with an unchanged manifest member entails `SKILL.md`/`reality.md`/`handoff.md` are byte-identical too. CF-8 adds only throw paths; valid producer bytes are unchanged → no digest move (Sprint Plan §6 expects none).

## 11. Validation — ✓ CONFIRMED

Independent `npm run test:all` → **924 tests / 924 pass / 0 fail / 237 suites**. Targeted `bundle-conformance-posture` + `bundle-boundaries` → 48 pass / 0 fail (CF-8 8, T3.4 3, T3.5 3, CF-9 6, plus existing blocks). Claim/scope grep clean. Forbidden/invariant byte-checks clean.

## 12. Claim ceiling — ✓ CONFIRMED

Claim grep over the changed impl/test files: no positive overclaim. No Echelon admission, parser acceptance, certification, calibration, optimization, signature production/verification, SkillOpt/backend/L2/runtime readiness, multi-construct support, composed_trust emission, populated `scoring.*`, BREATH round-trip, TREMOR/CORONA, or VerificationReceipt claim. The digest match (§10) confirms emitted artifacts are unchanged — the producer makes no stronger claim than before. Ceiling preserved: a local, content-addressed `ConstructAdmissionBundle` producer for the narrow BREATH worked path, and nothing stronger.

## 13. Scope reconciliation — ✓ CONFIRMED

- STABILITY note skipped — correct: Sprint Plan §6 Sprint 03 forbids `spec/**`; T3.6 is optional. `spec/STABILITY.md` byte-unchanged.
- CF-8 tests in `bundle-conformance-posture.spec.js` — correct: the authorized intersection of the operator-expected list and §6's "extend an existing bundle spec."
- No unauthorized new test file or spec path (`git status` shows only the 3 authorized files; the declined `settlement-trust-tier-guard.spec.js` was not created).

---

## Auditor's adversarial notes

- **Prototype pollution (CWE-1321):** the threat the CF-8 guard addresses is real — `getTrustTier` reads a plain-object registry, so an attacker-supplied prototype-key `source_id` resolves through the prototype chain. The guard is the correct fix location (bundle layer, not the shared trust registry, which stays byte-unchanged) and is **provably complete** against the full key surface (§4). No partial-coverage gap.
- **No injection / no secrets:** the guard interpolates already-validated non-empty strings into error messages; no `eval`, no dynamic require, no secret material, no PII. Error messages disclose only the supplied `source_id`/`settling_source_id` (attacker-controlled input echoed back) — acceptable.
- **Fail-closed discipline:** every ambiguous/unknown/non-enum/non-string state throws; nothing is silently coerced or accepted. This is the correct posture for a producer authoring-safety gate.
- **Defense-in-depth, not over-trust:** the CF-9 boundary test and the no-runtime assertions are assertions ABOUT the codebase's current shape, layered atop code review and the independently-verified zero-importer fact. The residuals (§6, §7) are heuristic limits of a regex that the SDD deliberately kept parser-free; they do not weaken the actual (layered) boundary.

## Decision

CF-8 closes a real prototype-pollution vector completely and fails closed across the entire attack surface, on the actual emission path, with no producer-byte change and no claim-ceiling breach. CF-9 strengthens the boundary detector per AC-8 with documented, non-blocking heuristic residuals and no current exposure. Hygiene, forbidden-path, invariant, digest, validation, claim-ceiling, and scope-reconciliation checks all pass independently. The four residuals are LOW / non-blocking with concrete future-hardening recommendations; none gate commit.

## PASS — ready for operator commit approval

Recommended future-hardening backlog (NOT Sprint-03 blockers): (1) CF-9 comment-stripping pre-pass + boundary threat-model note covering the comment-semicolon and from-less side-effect residuals; (2) switch the T3.4 scan to a recursive walk if `src/bundle/` ever gains subdirectories.

Stopping after audit. No `COMPLETED` marker created, no fix implemented, no commit, push, integration fast-forward, tag, release, package bump, Beads mutation, or master touch performed — the operator holds the commit-approval gate.
