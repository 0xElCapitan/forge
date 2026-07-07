# FORGE Cycle-003 — Sprint 05 Review Report

> **State-Zone, gitignored. Review artifact ONLY.** Adversarial senior-lead review of
> the `/implement` output for Cycle-003 Sprint 05 on branch
> `cycle-003-s05-composed-trust-do-not-emit`. **No audit, no commit, no push, no tag, no
> release, no package bump, no Beads mutation, no master touch, no integration
> fast-forward, no forge-ewa Retire, no implementation-file edits.**

**Cycle:** 003
**Sprint:** 05 — `cycle-003-s05-composed-trust-do-not-emit` (Sprint Plan §6 / SDD S9 / OD-7; AC-13)
**Reviewer:** Loa `/review-sprint` (`reviewing-code`)
**Date:** 2026-07-07
**Reviewed report:** `19-s05-implementation-report-composed-trust-do-not-emit.md`
**Reviewed code:** `test/unit/composed-trust-do-not-emit.spec.js` (NEW, 299 lines, 14 tests)

---

## VERDICT: ✅ PASS — ready for audit

The canonical Sprint 05 (`composed-trust-do-not-emit`, not the earlier report-only
producer-lock framing) is correctly and comprehensively implemented. All 13 review focus
areas pass; AC-13 is met with independently reproduced evidence; every forbidden path is
byte-unchanged; the claim ceiling and OD-4 gate hold. Three **non-blocking** hardening
observations are recorded in the Adversarial Analysis (§Adversarial) — none block audit.

**Review methodology:** independent verification, not report-trust. I re-ran both test
suites, re-derived the BREATH digest/member-hash, ran my own F-B family grep across `src/`,
probed the runtime shape of every surface the tests scan (to hunt vacuous passes), and
cross-checked the two-layer design record against SDD §5 Lane 8.

---

## 1. Branch / base / hygiene — ✅ PASS

| Check | Expected | Observed | ✓ |
|-------|----------|----------|:-:|
| Active branch | `cycle-003-s05-composed-trust-do-not-emit` | same | ✓ |
| Descends from integration | merge-base = `71072440` | `git merge-base HEAD cycle-003-integration` = `710724406736…` | ✓ |
| HEAD | `71072440` | `710724406736e5fe5c4874e053f7052312ab9c93` | ✓ |
| `master` / `origin/master` | `715072c3` | `715072c3c4c4dd3e0bb187d39923cd53da31db4d` | ✓ |
| `cycle-003-integration` / origin | `71072440` | both `710724406736…` | ✓ |
| `package.json` | `0.4.0` | `0.4.0` | ✓ |
| Tag at HEAD | none | none | ✓ |
| Index (staged) | empty | empty (`git diff --cached` empty) | ✓ |
| Commit / push / tag / release / bump / Beads | none | none | ✓ |

## 2. Changed files — ✅ PASS

- Only implementation addition: `test/unit/composed-trust-do-not-emit.spec.js` (untracked;
  `git status --short` shows exactly `?? test/unit/composed-trust-do-not-emit.spec.js`).
- Scoped report present: `19-s05-implementation-report-composed-trust-do-not-emit.md` (this
  cycle-scoped path; non-generic per the artifact-naming rule).
- NOTES.md continuity entry: `git check-ignore` confirms `grimoires/loa/NOTES.md` is
  gitignored and **not staged**. ✓

## 3. Forbidden-path audit — ✅ PASS

`git diff --stat 710724406736…` (tracked, whole tree) is **empty** — dispositive proof that
every tracked forbidden path is byte-unchanged. Targeted re-confirmation (also empty) for:
`src/receipt/canonicalize.js`, `src/receipt/sign.js`, `src/ir/emit.js`, `src/bundle/*`,
`spec/proposal-ir.json`, `test/unit/bundle-conformance-posture.spec.js`,
`test/unit/bundle-boundaries.spec.js`, `test/unit/jcs-parity.spec.js`, `package.json`.
Also verified unchanged/untouched: lockfiles, `.github/workflows/*`, `.claude/**`,
`.beads/**`, `spec/receipt-v0.json`, `spec/jcs-test-vectors.json`, `README.md`,
`BUTTERFREEZONE.md`, `CHANGELOG.md`, `bin/*`, `fixtures/forge-snapshots-*.json`. No
composed_trust schema/emitter, scoring, cert, runtime/CLI, TREMOR/CORONA, multi-construct,
or VerificationReceipt path was created or changed.

## 4. Canonical Sprint 05 / AC-13 scope — ✅ PASS

Implements Sprint Plan §6 / OD-7 exactly: (a) comprehensive `composed_trust` do-not-emit
suite [T5.1], (b) F-B-scoped source grep [T5.2], (c) two-layer design record [T5.3].
AC-13 is marked ✓ Met in the report (§AC Verification, L314+) with file:line evidence that
I verified resolves correctly. Cross-checked against SDD:694 (AC-13 definition) and SDD §5
Lane 8 (SDD:472-528) — the deliverable matches the SDD's required do-not-emit test + no
schema key + documented two-layer model.

## 5. T5.1 advisory-family absence — ✅ PASS (non-vacuous, runtime-verified)

Family coverage = the full advisory set: `composed_trust`, `can_settle`, `settlement_risk`,
`risk_flags` (deep-key + whole-token), plus `settlement_authority`-in-`composed_trust`
handled **structurally** (absence of any `composed_trust` wrapper), F-B-correct.

Surfaces covered (spec.js): in-memory manifest (`:124`), in-memory receipt (`:128`), on-disk
JSON members parsed **and** raw (`:132-138`), all 3 markdown members (`:140-144`), default IR
envelope (`:190`), maximally-populated IR envelope (`:194-216`), plus the F-B structural
(`:147`) and positive-control (`:155`) cases.

**Vacuity probe (independent runtime inspection):** the scanned surfaces are real and
non-empty — manifest 26 deep keys, receipt 22 (+4 members), members are non-empty strings
(SKILL.md 2695 / reality.md 1595 / handoff.md 1137 / manifest.json 856 / bundle-receipt.json
1011 chars). `collectKeys` correctly walks arrays + nested objects (positive control at
`:155` proves it returns real keys). The recursive walk and raw-token scans are **meaningful,
not vacuous.**

## 6. T5.2 F-B-scoped source grep — ✅ PASS

Walks all `.js` under `src/` recursively (`:236-263`); count guard `>= 40`. My independent
`find src -name '*.js' | wc -l` = **51** (matches the report's claim exactly). My own
`git grep -w` for each token confirms `composed_trust`/`can_settle`/`settlement_risk`/
`risk_flags` = **0 hits** in `src/`. F-B positive controls (`:265-273`) are real: `git grep`
finds `settlement_authority` 3× in `fields.js` and `no_settlement_authority` 4× in
`negative-policy.js` — the grep is family-scoped and does **not** ban the legit shipped
tokens. The naming-collision trap is **asserted** (positive control), not avoided by an
over-broad or over-narrow sweep.

## 7. T5.3 two-layer design record — ✅ PASS (accurate vs SDD)

Test header (`:14-45`) + report §10 accurately record: FORGE (Layer 1) emits producer-side
provenance inputs only (oracle_declarations, the `settlement_authority` structured object,
trust_tier, construct_source_ref, normalization_trace, original_hash, negative_policy_flags);
Echelon (Layer 2) owns `composed_trust` computation, risk flags, integrity envelope, scoring,
certification, and the downstream `TheatreAdmissionDisposition`. The load-bearing invariant
— *"AdmissionState is an INPUT TO, not EQUAL TO, TheatreAdmissionDisposition"* — matches SDD
§5 Lane 8 verbatim (SDD:497-499). **reserve ≠ activate** anchored: `spec/proposal-ir.json`
carries no `composed_trust` key (T5.3 `:286-297` + my independent `git grep -w composed_trust
-- 'spec/*.json'` = 0); no schema key added; no emitter path added (empty diff).

## 8. Negative-proof quality — ✅ PASS (3 non-blocking hardening notes → §Adversarial)

The do-not-emit suite is **not** a vacuous pass: the bundle is really generated
(`assembleBundle`, real producer import), JSON members are really parsed (`JSON.parse` throws
on a bad member → cannot pass vacuously), markdown members are real non-empty strings, and
the maximal IR envelope genuinely exercises the optional fields (runtime probe: usefulness_
scores populated, normalization_trace len 2, composition + source_metadata populated → 72
deep keys vs 26 for the manifest). Advisory tokens are snake_case and matched whole-token, so
casing/delimiter evasion of the *emitted* (snake_case) surface is not a live risk. Three
hardening observations (defensive `typeof` guard on the raw-text scan; self-verify the
"maximal" envelope population; schema-key scan covers only proposal-ir.json) are documented
below as **non-blocking**.

## 9. S01–S04 invariant preservation — ✅ PASS (independently recomputed)

| Invariant | Observed | ✓ |
|-----------|----------|:-:|
| `emitted_at_ms` present / `emitted_at` absent | true / true | ✓ |
| ProposalEnvelope `ir_version` | `0.3.0` | ✓ |
| bundle manifest `ir_version` | `0.2.0` (independent domain, no equality lock) | ✓ |
| `bundle_schema_version` | `1.0.0` | ✓ |
| `normalization_trace` populated | array len 2 (BREATH worked path) | ✓ |
| `feed_id` | `epa_airnow_aqi` | ✓ |
| JCS vectors / canonicalizer | byte-unchanged (empty diff) | ✓ |
| CF-8 guard | unchanged (`settlement.js` in empty diff) | ✓ |
| CF-9 tests | unchanged (`bundle-boundaries.spec.js` in empty diff) | ✓ |
| `package.json` | `0.4.0` | ✓ |
| BREATH `bundle_digest` | `sha256:b8f05d8c75f1faba…` | ✓ |
| manifest member hash | `sha256:b08ed9fb7359dc42…` | ✓ |

## 10. Validation — ✅ PASS (independently reproduced)

| Check | Report claim | My re-run | ✓ |
|-------|--------------|-----------|:-:|
| New suite | 14/14 | `node --test …composed-trust…` → 14 pass / 0 fail | ✓ |
| Full suite | 938/0 | `npm run test:all` → 938 pass / 0 fail (241 suites) | ✓ |
| F-B family grep | 0 in src | 0 for all four tokens | ✓ |
| Claim/scope grep | do-not-emit framing only | confirmed; zero positive-emission assertions | ✓ |
| Runtime/CLI exposure | none | none (no new entrypoint; `src/bundle/*` unchanged) | ✓ |
| Beads mutation | none | `.beads/` diff empty | ✓ |
| Forbidden path changed | none | tracked diff empty | ✓ |

## 11. forge-ewa / OD-4 gate — ✅ PASS

- forge-ewa Retire **not** performed; 3 `fixtures/forge-snapshots-{breath,corona,tremor}.json`
  present.
- `README.md` (3 refs) and `CHANGELOG.md` (1 ref) forge-ewa/forge-snapshot references intact.
- `.beads/` byte-unchanged (diff vs base empty); `forge-ewa` remains open / not retired.
- Report §9 + §12 explicitly mark forge-ewa Retire + Beads closure as separately
  operator-gated under **OD-4** — honestly deferred, not claimed done.

## 12. Claim ceiling — ✅ PASS

Overclaim scan of the report finds **no** positive claim of Echelon admission, parser
acceptance, certification, calibration, optimization, signature production/verification,
SkillOpt, backend publication, L2/runtime readiness, multi-construct support, composed_trust
emission, populated `scoring.*`, cert issuance, BREATH round-trip, TREMOR/CORONA, or
VerificationReceipt. The suite/report name the forbidden vocabulary only to assert its
**absence** — the guard is itself a ceiling-preserving artifact. Claim-ceiling nuance
confirmed sound: the envelope emits `usefulness_scores` (the legit internal FORGE field) but
**no `scoring` key** (Object.keys check: `scoring` false, `usefulness_scores` true) — the
report and suite do not conflate FORGE `usefulness_scores` with Echelon-owned `scoring.*`.

---

## Adversarial Analysis

Per the adversarial protocol, minimums documented. **All concerns are NON-BLOCKING** —
each was probed at runtime and found to be theoretical (the suite is correct and non-vacuous
today); they are hardening suggestions for a future pass, not audit blockers.

### Concerns Identified (≥3)

1. **Raw-text scan has no non-empty guard** — `test/unit/composed-trust-do-not-emit.spec.js:98-102`
   (`assertNoAdvisoryText`) and `:140-144` (markdown iteration). `RegExp.test(undefined)`
   coerces to the string `"undefined"` and returns false, so if a member key were ever
   renamed/typo'd (`members['SKILL.md']` → `undefined`), the markdown scan would pass
   **vacuously**. *Verified non-vacuous today* (member keys match the passing
   `bundle-conformance-posture.spec.js`; members are real 1137–2695-char strings).
   *Recommendation:* assert `typeof text === 'string' && text.length > 0` before scanning,
   so a future member-key change fails loudly instead of silently vacuating the scan.

2. **"Maximally-populated" envelope is not self-verified** — `…spec.js:194-216`. The test
   passes `score_usefulness` / `evaluate_policy` / `normalization_trace` / `source_metadata`
   / `composition` and asserts absence, but never asserts those fields are actually
   populated. *Verified genuinely populated at runtime* (usefulness_scores set,
   normalization_trace len 2, composition + source_metadata present; 72 deep keys). If a
   future `emitEnvelope` refactor silently dropped one option, this test would still pass but
   no longer exercise that field. *Recommendation:* add 3–4 sanity asserts
   (`assert.ok(env.composition !== null)`, etc.) so the "maximal" label self-verifies.

3. **Schema-key scan covers only `proposal-ir.json`** — `…spec.js:283-299` (T5.3). Other
   `spec/*.json` schemas (e.g., `receipt-v0.json`) are not scanned for a `composed_trust`
   key; they rely on the T5.1 emitted-output check to catch actual emission. This is
   acceptable (the output check is dispositive for *emission*), but the schema-absence
   guarantee is narrower than the output-absence guarantee. *Recommendation (optional):*
   extend the T5.3 scan to `spec/*.json` for symmetry with the src grep.

4. *(minor)* **Source grep bans the token even in comments/JSDoc** — `…spec.js:254-263`.
   Aligned with the two-layer design (composed_trust is Echelon-owned and should not appear
   in FORGE `src/` at all), but it would false-positive on a future *legitimate* src comment
   referencing the token. Intentional, acceptable friction — noted for awareness.

### Assumption Challenged (≥1)

- **Assumption:** the advisory family is exactly the four snake_case tokens (+
  `settlement_authority`-in-`composed_trust`), and emitted fields are snake_case, so
  exact-key / whole-token matching is sufficient.
- **Risk if wrong:** a camelCase (`composedTrust`) or affixed (`composed_trust_v2`) variant
  would evade both the `keys.includes(...)` exact-key check and the `\b…\b` whole-token scan.
- **Verdict — justified, make explicit:** Echelon's receiving contract uses snake_case exact
  field names (SDD §5 Lane 8 provisional shape), so snake_case exact-token matching is the
  correct emission-surface scope; broadening to fuzzy/case-insensitive matching would
  re-introduce the very F-B false-positive class the sprint is built to avoid. The guard is
  exact-token **by design** — worth a one-line comment stating so.

### Alternative Not Considered (≥1)

- **Alternative:** implement the F-B source check as a standalone CI shell script
  (`tools/check-no-composed-trust.sh`) instead of inside the test file.
- **Tradeoff:** a script could run in pre-commit independently of the node runner and cover
  non-`.js` files — but it adds a new tracked script path (Sprint Plan §6 authorizes only the
  single test file), duplicates the F-B logic, and the "CI-rideable" requirement is already
  met by riding `npm test`.
- **Verdict:** current in-test approach is **justified** — satisfies "CI-rideable" via the
  existing suite, stays within the authorized single-file write scope, and keeps the F-B
  logic co-located with the assertions it supports.

---

## Complexity / quality notes

- Function sizes small (largest `it` ~22 lines); `collectKeys`/`walkJs`/`assertNo*` helpers
  are single-purpose and clear. No duplication beyond the deliberate helper reuse. No dead
  code. Naming is precise and self-documenting. Matches the house style of the sibling specs
  (`bundle-conformance-posture.spec.js`). No complexity blockers.
- Karpathy: Simplicity ✓ (a guard, no speculative abstraction); Surgical ✓ (one new file,
  zero tracked edits); Goal-driven ✓ (testable absence assertions with positive controls).

## Subagent / documentation gates

- No `grimoires/loa/a2a/subagent-reports/*` blocking verdicts for this sprint (none run;
  optional). Flatline `code_review` not enabled (`flatline_protocol.code_review.enabled` =
  null) → cross-model Phase 2.5 not required; single-model adversarial review performed.
- Documentation: this is a test-only, doc-record sprint; CHANGELOG intentionally untouched
  (forbidden path; producer behavior unchanged — nothing to log). No new command/skill →
  no CLAUDE.md entry required. Report + NOTES continuity present.
- `integrity_enforcement: strict` — no System Zone (`.claude/`) drift (empty tracked diff).

---

## Conclusion

**PASS — ready for audit.** Sprint 05 delivers the canonical `composed-trust-do-not-emit`
scope (Sprint Plan §6 / OD-7 / SDD §5 Lane 8) with a comprehensive, runtime-verified,
non-vacuous do-not-emit suite, an F-B-scoped source grep with real positive controls, and an
accurate two-layer design record. AC-13 is met. All invariants hold; all forbidden paths are
byte-unchanged; the claim ceiling and the OD-4 forge-ewa gate are preserved. The three
non-blocking hardening observations may be addressed in a follow-up or accepted with the
tradeoffs noted — they do not gate audit.

**Next step:** operator → `/audit-sprint cycle-003-s05-composed-trust-do-not-emit`.

*No audit, commit, push, integration fast-forward, tag, release, package bump, Beads
mutation, master touch, or forge-ewa Retire was performed by this review.*
