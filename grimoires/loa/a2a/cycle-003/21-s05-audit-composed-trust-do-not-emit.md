# FORGE Cycle-003 — Sprint 05 Security & Ceiling Audit

> **State-Zone, gitignored. Audit artifact ONLY.** Paranoid Cypherpunk Auditor — final
> security/ceiling gate for Cycle-003 Sprint 05 on branch
> `cycle-003-s05-composed-trust-do-not-emit`, after PASS review. **No fix implemented, no
> implementation-file edit, no commit, no push, no tag, no release, no package bump, no Beads
> mutation, no master touch, no integration fast-forward, no forge-ewa Retire, no cycle
> closeout, no COMPLETED marker.**

**Cycle:** 003
**Sprint:** 05 — `cycle-003-s05-composed-trust-do-not-emit` (Sprint Plan §6 / SDD S9 / OD-7; AC-13)
**Auditor:** Loa `/audit-sprint` (`auditing-security`)
**Date:** 2026-07-07
**Audited:** `test/unit/composed-trust-do-not-emit.spec.js` + reports 19 (impl) & 20 (review)
**Prior gate:** review verdict PASS (`20-s05-review-composed-trust-do-not-emit.md`)

---

## VERDICT: ✅ PASS — APPROVED. Ready for operator commit approval.

The canonical Sprint 05 (`composed-trust-do-not-emit`) passes the security/ceiling gate. The
sole change is one read-only test file that adds **zero** attack surface and actively
**defends** the FORGE claim ceiling (a fail-closed do-not-emit guard). Every forbidden path
is byte-unchanged; no unauthorized mutation occurred; the OD-4 forge-ewa/Beads gate holds;
all invariants are preserved. Independently reproduced — I trusted neither the implementation
nor the review report.

**Completion record:** per the established Cycle-003 convention (numbered reports serve as
completion records; no generic `COMPLETED` marker), this audit report **is** the sprint's
completion record. No `COMPLETED` marker, `index.md` mutation, or Beads state change was
written (operator instruction + convention).

**Auditor's security frame.** For FORGE the **claim ceiling is the security boundary**:
emitting an Echelon-owned field (`composed_trust`/`can_settle`/`settlement_risk`/`risk_flags`)
or overclaiming admission/cert/scoring would be the equivalent of a privilege-escalation. A
**vacuous** do-not-emit guard would be a *false security control* (an auth check that always
returns true). Both were probed directly and found sound.

---

## 1. Branch / base / repo hygiene — ✅ PASS

| Check | Expected | Observed |
|-------|----------|----------|
| Active branch | `cycle-003-s05-composed-trust-do-not-emit` | ✓ |
| Descends from integration | merge-base = `71072440` | `git merge-base HEAD cycle-003-integration` = `710724406736…` ✓ |
| HEAD | `71072440` | `710724406736e5fe5c4874e053f7052312ab9c93` ✓ |
| master / origin/master | `715072c3` | both `715072c3c4c4…` ✓ |
| integration / origin | `71072440` | both `710724406736…` ✓ |
| package.json | `0.4.0` | `0.4.0` ✓ |
| Tag at HEAD | none | none ✓ |
| Commit/push/tag/release/bump/Beads | none | none ✓ |

**No-unauthorized-mutation boundary (auditor's top concern) — HELD.** Index (staged) is
empty; `git status --short` shows only `?? test/unit/composed-trust-do-not-emit.spec.js`;
whole-tree `git diff --stat` vs base `71072440` is empty; `git reflog` shows only the branch
checkout (no commit/reset/rebase on the S05 branch).

## 2. Changed files — ✅ PASS

- Implementation addition: `test/unit/composed-trust-do-not-emit.spec.js` (untracked; new).
- Scoped reports present: `19-s05-implementation-report-…md`, `20-s05-review-…md`.
- `grimoires/loa/NOTES.md`: gitignored, **not staged** (continuity entry is local-only).

## 3. Forbidden-path audit — ✅ PASS

Whole-tree tracked `git diff` vs base is empty → every tracked forbidden path is byte-for-byte
unchanged. Explicitly re-confirmed: `package.json`, lockfiles, `.github/workflows/*`,
`.claude/**`, `.beads/**`, `src/receipt/canonicalize.js`, `src/receipt/sign.js`,
`spec/receipt-v0.json`, `spec/jcs-test-vectors.json`, `test/unit/jcs-parity.spec.js`,
`src/ir/emit.js`, `src/bundle/*`, `test/unit/bundle-boundaries.spec.js`,
`test/unit/bundle-conformance-posture.spec.js`, `fixtures/forge-snapshots-*.json`,
`README.md`, `BUTTERFREEZONE.md`, `CHANGELOG.md`, `bin/*`. No composed_trust
schema/emitter, scoring, cert, runtime/CLI, TREMOR/CORONA, multi-construct, or
VerificationReceipt path created or changed.

## 4. AC-13 — ✅ PASS (independently verified)

Sprint 05 delivers the Sprint Plan §6 / OD-7 / SDD §5 Lane 8 deliverable in full:
comprehensive do-not-emit suite (T5.1), F-B-scoped source grep (T5.2), two-layer design
record (T5.3). AC-13 evidence in report 19 (§AC Verification) cites file:line anchors that
resolve correctly against the test file (spot-verified `:124` manifest, `:254` source grep,
`:286` schema-key). Matches SDD:694 AC-13 definition. **AC-13 = Met.**

## 5. T5.1 advisory-family absence — ✅ PASS (non-vacuous, runtime-probed)

Full family covered — `composed_trust`, `can_settle`, `settlement_risk`, `risk_flags`
(deep-key + whole-token) and `settlement_authority`-in-`composed_trust` (structural, via
absence of any `composed_trust` wrapper). Surfaces: manifest (`:124`), receipt (`:128`),
on-disk JSON parsed+raw (`:132`), 3 markdown members (`:140`), default envelope (`:190`),
maximal envelope (`:194`).

**Vacuity probe (auditor re-ran independently):** scanned surfaces are real — manifest 26
deep keys, receipt 22 (+4 members), markdown members are non-empty strings (1137–2695 chars).
`collectKeys` walks arrays + nested objects (positive control `:155` proves it returns real
keys). **The guard is a genuine, fail-closed control — not a false/vacuous check.**

## 6. T5.2 F-B-scoped source grep — ✅ PASS

Recursive `src/` walk (`:236-263`). Independent recount: **51** `.js` files (matches report).
Independent `git grep -w`: `composed_trust`/`can_settle`/`settlement_risk`/`risk_flags` = **0**
in `src/`. Positive controls are real: `settlement_authority` 3× in `fields.js`,
`no_settlement_authority` 4× in `negative-policy.js` — the grep is family-scoped and does not
ban the legit shipped tokens. Naming-collision trap **asserted** (positive control), not
dodged by an over-broad/over-narrow sweep. `usefulness_scores` vs Echelon `scoring.*`
correctly distinguished (envelope Object.keys: `scoring` absent, `usefulness_scores` present).

## 7. T5.3 two-layer design record — ✅ PASS (accurate vs SDD)

Test header (`:14-45`) + report §10 record: FORGE (Layer 1) emits producer-side provenance
inputs only; Echelon (Layer 2) owns `composed_trust` computation, risk flags, integrity
envelope, scoring, certification, downstream admission/verdict. Load-bearing invariant —
*"AdmissionState is an INPUT TO, not EQUAL TO, TheatreAdmissionDisposition"* — matches SDD
§5 Lane 8 verbatim (SDD:497-499). **reserve ≠ activate** anchored: `spec/proposal-ir.json`
has no `composed_trust` key (T5.3 + independent grep = 0); no schema key added; no emitter
path added (empty diff).

## 8. Negative-proof quality — ✅ PASS

| Probe | Result |
|-------|--------|
| Bundle actually generated | Yes — real `assembleBundle`/`authorBreathManifestParts` import |
| JSON members actually parsed | Yes — `JSON.parse` throws on a bad member (cannot pass vacuously) |
| Markdown members actually read/scanned | Yes — real non-empty strings (1137–2695 chars) |
| Maximal envelope exercises optionals | Yes — usefulness_scores populated, normalization_trace len 2, composition + source_metadata present (72 deep keys) |
| Source grep scoped correctly | Yes — 51 files, not over-narrow; positive controls prove reads land |
| Casing/delimiter hiding | Emitted surface is snake_case; whole-token match is the correct scope |
| Raw-text scans have real input | Yes — members + serialized envelope are substantial strings |

## 9. Review's hardening notes — classified (NOT fixed; auditor does not implement)

| # | Note | Severity | Classification | Rationale |
|---|------|:--------:|----------------|-----------|
| 1 | Defensive non-empty guard on raw-text scan (`assertNoAdvisoryText`) | INFO | **Non-blocking — future test-hardening** | Non-vacuous today (member keys match the passing conformance suite; members are real strings). Risk requires a *future unrelated* member-key rename to materialize. Correctness/security unaffected. |
| 2 | Self-verify the "maximal" envelope stays maximal | INFO | **Non-blocking — future test-hardening** | Envelope is genuinely maximal at runtime (independently confirmed). A future `emitEnvelope` refactor could weaken the label silently; a sanity assert would catch it. Not a current defect. |
| 3 | Schema-key scan covers only `proposal-ir.json` | INFO | **Non-blocking — future cleanup** | The T5.1 emitted-output check is dispositive for *emission*. Empirically, `git grep composed_trust -- spec/*.json` = 0 across all schemas, so the "gap" is closed in practice today. Extending T5.3 to `spec/*.json` is a symmetry nicety. |

None are blockers. Per operator instruction 9, none were fixed during audit. Recommend
recording items 1–2 as optional test-robustness follow-ups; item 3 is discretionary.

## 10. S01–S04 invariant preservation — ✅ PASS (independently recomputed)

`emitted_at_ms` present / `emitted_at` absent ✓ · ProposalEnvelope `ir_version` 0.3.0 ✓ ·
manifest `ir_version` 0.2.0 ✓ · `bundle_schema_version` 1.0.0 ✓ · `normalization_trace`
populated (len 2) ✓ · `feed_id` `epa_airnow_aqi` ✓ · JCS vectors/canonicalizer unchanged
(empty diff) ✓ · CF-8 guard unchanged ✓ · CF-9 tests unchanged ✓ · `package.json` 0.4.0 ✓ ·
BREATH `bundle_digest` `sha256:b8f05d8c…` ✓ · manifest member hash `sha256:b08ed9fb…` ✓.

## 11. Validation — ✅ PASS (independently reproduced)

New suite `node --test …composed-trust…` → **14 pass / 0 fail**. Full suite `npm run
test:all` → **938 pass / 0 fail** (241 suites). F-B grep clean. Claim/scope grep clean. No
runtime/CLI exposure (no new entrypoint; `src/bundle/*` unchanged; the test adds none). No
Beads mutation (`.beads/` diff empty). No forbidden path changed.

## 12. forge-ewa / OD-4 gate — ✅ PASS

forge-ewa Retire **not** performed · 3 `fixtures/forge-snapshots-*.json` present ·
`README.md` (3) / `CHANGELOG.md` (1) refs intact · `.beads/` byte-unchanged · `forge-ewa`
open / not retired · reports §9/§12 mark it separately operator-gated under OD-4. Governance
boundary intact.

## 13. Claim ceiling — ✅ PASS

Overclaim scan of both reports: **no** positive claim of Echelon admission, parser
acceptance, certification, calibration, optimization, signature production/verification,
SkillOpt, backend publication, L2/runtime readiness, multi-construct support, composed_trust
emission, populated `scoring.*`, cert issuance, BREATH round-trip, TREMOR/CORONA, or
VerificationReceipt. The forbidden vocabulary appears only in absence/do-not-emit framing.
**Positive security finding:** this sprint doesn't merely avoid overclaiming — it installs a
fail-closed enforcement guard that will *break the build* if the advisory family ever leaks
into an emitted surface, source path, or the IR schema. Net ceiling posture is strengthened.

---

## Security checklist (auditing-security)

| Control | Finding |
|---------|---------|
| Secrets / credentials | None (scanned; synthetic fixtures only) |
| Input validation / injection | No external input; paths derived from `import.meta.url` (no user input, no traversal). `walkJs` skips symlinks (`isDirectory()`/`isFile()` false for symlinks) — no escape from `src/` |
| Unsafe fs / shell-out | None — `readFileSync`/`readdirSync` only (read-only); no `writeFile`/`exec`/`spawn`/`child_process`/`process.env`/`eval` (the lone "exec" grep hit is the substring in the word "executable" in a comment) |
| Producer mutation | None — imports are read-only (`assembleBundle`, `authorBreathManifestParts`, `emitEnvelope`) |
| Error handling | Fail-closed: `JSON.parse` throws on a bad member; assertions fail closed on any advisory leak |
| Attack surface added | None — test-only, no runtime/CLI/API surface |
| Ceiling / privilege boundary | Strengthened — new fail-closed do-not-emit enforcement |

---

## Conclusion

**PASS — APPROVED. Ready for operator commit approval.** Sprint 05 is a security-clean,
non-vacuous, ceiling-strengthening test-only addition that delivers AC-13 per Sprint Plan §6
/ OD-7 / SDD §5 Lane 8. No unauthorized mutation; forbidden paths byte-unchanged; OD-4 gate
held; all invariants preserved; claim ceiling preserved and actively enforced. The three
review hardening notes are non-blocking future test-robustness items — not audit blockers,
not fixed here.

**Completion record:** this numbered audit report is the Sprint 05 completion record (Cycle-003
convention). No `COMPLETED` marker created.

**Next step (operator-gated):** operator authorizes commit of the S05 evidence chain + test
file → sprint-branch push → `cycle-003-integration` fast-forward, exactly as S01–S04 landed.
`master` stays at `715072c3`; `package.json` stays `0.4.0`; no tag/release; `composed_trust`
emission and forge-ewa Retire/Beads closure remain separately gated (B-2 call / OD-4).

*No fix, commit, push, integration fast-forward, tag, release, package bump, Beads mutation,
master touch, forge-ewa Retire, cycle closeout, or COMPLETED marker was performed by this
audit.*
