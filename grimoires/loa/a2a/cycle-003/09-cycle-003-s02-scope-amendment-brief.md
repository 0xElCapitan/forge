# FORGE Cycle-003 Sprint 02 — Scope Amendment / Implementation Brief

> **Planning-only. No code, no branch, no commit.** Amends §6 *Sprint 02* of `03-cycle-003-sprint-plan.md` with the
> facts confirmed in the 2026-06-08→14 co-design round (Tobias S02 reply, `#200`, `#206`, the Verdict-Integrity
> Envelope + Verification-Regimes spec). Sprint 02 implementation still flows through `/implement`
> (`cycle-003-s02-canonicalization-parity-receiving-alignment`, branched from `cycle-003-integration`) under
> review+audit gates. This brief authorises nothing to be built; it records the amended scope so the eventual
> `/implement` pass is unambiguous.

**Repo state:** `cycle-003-integration` @ `a1ca874e`; `master` @ `715072c3` / `v0.4.0`; `package.json` `0.4.0`.
**Sources folded in:** `00-cycle-003-S02-reply-reconciliation.md`, `00-cycle-003-S02-echelon-docdump-intake.md`, `#200` (GV5-1), `#206` (TREMOR — out of scope here), Verdict-Integrity Envelope schema, Verification-Regimes spec (regime-8/9 + §12).

---

## 1. Confirmed facts since the original Sprint-02 plan

| # | Fact (confirmed) | Effect on Sprint 02 |
|---|------------------|---------------------|
| F1 | `ir_version`: bundle & envelope are **separate version domains**; Echelon accepts any `0.x` (floor `0.1.0`, reject MAJOR ≥`1.0.0`); **no equality check**. | Encode assertions **(a)+(b)**, **NOT (c)** equality (Tobias: would over-constrain). |
| F2 | **NEW — `bundle_schema_version` is the Echelon receiving-contract version**, not FORGE-declarative → **BREATH moves `0.1.0`→`1.0.0`**. | **New task T2.7** (one-line + determinism re-baseline). Closes Echelon **GV5-1(b)** (#200). |
| F3 | `jcs-test-vectors.json` is **Echelon-co-owned** and now underwrites **`bundle_digest` AND `cert_hash`** parity (GV3-2 recompute rides it). | **Extend** T2.1/T2.2 scope; pin the documented subset-vs-RFC deltas. Closes **C003-16** + underwrites **#200(d)**. |
| F4 | `calibration_ref` §12 pointer text **confirmed**: `{cert_uri, cert_hash, n_resolutions, as_of, verifier_type}`; `verifier_type` Echelon-owned (FORGE Rung 3 = `frozen_replay_baseline`). | **Lock** T2.6 on confirmed text; record-only, no emission. |
| F5 | Flag seam: `echelon_owned_risk_flags` Echelon-owned + mutually exclusive; `forge_owned_risk_flags_seen` `[]`. | **No Sprint-02 action** — matches Sprint-05 `composed_trust` do-not-emit. Note the seam confirmation. |
| F6 | `emitted_at_ms` + `normalization_trace` (Sprint 01, `a1ca874e`) are **ingest-ready** by the VIE §6 verbatim. | **No Sprint-02 action** — validated; informs the calibration_ref/seam notes only. |

---

## 2. Amended Sprint-02 task list

Original tasks **T2.1–T2.6** (per `03-…md` §6) stand; deltas are marked **[AMENDED]** / **[NEW]**.

- **T2.1 [AMENDED]** Author `spec/jcs-test-vectors.json` (jointly-owned `jcs-subset/v0` vectors; categories per SDD §8.2). **Scope extension:** the vectors are authoritative for **both** `bundle_digest` **and** `cert_hash` (Echelon recomputes `cert_hash` over the envelope minus `forge_seam.calibration_ref` using the same `jcs-subset/v0`). Pin the documented subset-vs-RFC deltas (numbers via `JSON.stringify`, string escaping via `JSON.stringify`, fail-closed type narrowing) so neither digest can diverge across the seam.
- **T2.2** Author `test/unit/jcs-parity.spec.js` — byte-equality for `canonical` vectors, expected throw for `reject` vectors, in-repo `canonicalize.js` only (no new dependency, **no canonicalizer change**).
- **T2.3** Add `FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/` + exported `assertFeedId` + module-load self-check on `BREATH_FEED_ID` in `src/bundle/markdown-members.js`.
- **T2.4** Add the `feed_id` grammar assertion to `bundle-conformance-posture.spec.js` (BREATH emits `epa_airnow_aqi`; non-conforming id rejected).
- **T2.5** Record (assert, no change) the Lane-4 no-change postures: `bundle_member_hash` present-and-null, `calibration_ref` null, `construct_source_ref` dual-axis, signature encoding `ed25519:<base64>` (pin, **no signature build**).
- **T2.6 [AMENDED]** `calibration_ref` §12 pointer — lock on the **now-confirmed** text `{cert_uri, cert_hash, n_resolutions, as_of, verifier_type}` (record/design-note only; **no emission, no schema key**). `verifier_type` Echelon-owned; FORGE Rung 3 maps to `frozen_replay_baseline`. (`frozen_baseline_hash` is the only defensible *future* pointer addition — provenance, not score — and is **NOT** added this cycle.)
- **T2.7 [NEW] `bundle_schema_version` `0.1.0` → `1.0.0`.** One-line change to `DEFAULT_BUNDLE_SCHEMA_VERSION` (`src/bundle/assemble.js:82`). The value lives inside the `manifest.json` member, so this **moves the BREATH `manifest.json` member hash and the `bundle_digest`** — a deliberate determinism re-baseline (same class as Sprint 01's `emitted_at_ms` rename; anchor `bundle-conformance-posture.spec.js` T8, `PINNED_NOW`). Closes Echelon **GV5-1(b)**.

---

## 3. Amended acceptance criteria

- **AC-5 (jcs parity):** vectors exist + `jcs-parity.spec.js` asserts byte-equality + fail-closed throws; `canonicalize.js` **unchanged** (subset kept, no full-RFC swap); the file documents that the same vectors govern `bundle_digest` **and** Echelon's `cert_hash` recompute (the cert_hash recompute itself is Echelon-side — FORGE asserts the canonicalization parity basis).
- **AC-6 (feed_id):** `feed_id` matches `^[a-z0-9]+(_[a-z0-9]+)*$`; BREATH emits `epa_airnow_aqi`; `assertFeedId` rejects a non-conforming id.
- **AC-7′ (NEW — bundle_schema_version):** the emitted manifest carries `bundle_schema_version: "1.0.0"`; it remains **independent** of `ir_version` (the F1/#200 seam — `ir_version` stays `0.2.0`); the `bundle_digest` move is **deliberate, re-baselined, and recorded** (old `991704ec…` → new value captured in the Sprint-02 report); markdown member hashes (SKILL/reality/handoff) stay stable; **no `ir_version == ProposalEnvelope.ir_version` equality assertion** is added.
- **COMPAT confirmations** unchanged (`bundle_member_hash` null, `calibration_ref` null, `construct_source_ref` dual-axis, signature encoding pinned).

---

## 4. Allowed / forbidden write paths (amended)

**Allowed (Sprint 02 only):**
- `spec/jcs-test-vectors.json` (NEW) · `test/unit/jcs-parity.spec.js` (NEW)
- `src/bundle/markdown-members.js` (FEED_ID_GRAMMAR + `assertFeedId` + self-check)
- `src/bundle/assemble.js` — **only** the one-line `DEFAULT_BUNDLE_SCHEMA_VERSION` `0.1.0`→`1.0.0` (T2.7). **[added by this amendment — not in the original §6 Sprint-02 allow-list]**
- `test/unit/bundle-conformance-posture.spec.js` (feed_id assertion + `bundle_schema_version` re-baseline)
- `spec/STABILITY.md` — only if a one-line `bundle_schema_version` note is warranted
- Sprint-02 State-Zone reports under `grimoires/loa/a2a/cycle-003/`

**Forbidden:** `package.json` / lockfile · `.github/workflows/*` · `.claude/**` · `.beads/**` · `src/receipt/canonicalize.js` (subset kept) · `src/receipt/sign.js` (no signature build) · `spec/receipt-v0.json` · `src/ir/emit.js` (Sprint 01 done) · the `composed_trust` family (Sprint 05) · **any multi-construct admission generalisation** (FUTURE cross-org cycle — §7) · **any TREMOR/CORONA path** (FUTURE) · `fixtures/forge-snapshots-*.json` (Sprint 04) · `bin/*` / runtime-CLI.

---

## 5. Determinism re-baseline (T2.7)

`bundle_schema_version` is a `manifest.json` member field, so the bump behaves exactly like Sprint 01's `emitted_at_ms` rename:
- **moves:** `manifest.json` member `content_hash` → `bundle_digest`. Re-baseline deliberately; record old→new in the Sprint-02 report (the value is not hard-coded in any test literal — confirmed in Sprint 01, so this is a recorded move, not a changed assertion).
- **stable:** SKILL.md / reality.md / handoff.md member hashes (no version field inside); receipt scalar fields outside the digest.
- **validation note:** grep for any `'0.1.0'` `bundle_schema_version` assertion before landing; the conformance helper `breathFinal` will now emit `1.0.0` by default — update any pinned expectation.

---

## 6. Cross-org closure mapping

| Sprint-02 item | Closes / underwrites |
|----------------|----------------------|
| T2.7 `bundle_schema_version → 1.0.0` | Echelon **GV5-1(b)** (#200) |
| T2.1/T2.2 jcs-test-vectors (bundle_digest **+** cert_hash) | **C003-16** + **#200(d)** cert_hash parity |
| T2.6 `calibration_ref` pointer lock | **COMPAT-3** on confirmed §12 text |
| (validation only) `emitted_at_ms` + `normalization_trace` shipped | VIE §6 ingest-ready (no action) |

---

## 7. Explicitly OUT of Sprint 02 / cycle-003 (future cross-org cycle)

- **FORGE multi-construct admission support** (generalise the producer beyond the hard-coded BREATH path) — **#206 step 3**; beyond the BREATH ceiling (OD-7); opens as its own FORGE cycle **after** the TREMOR adapter lands.
- **TREMOR oracle adapter** — **El Capitan personally, construct-side** (`0xElCapitan/tremor`); **not FORGE, not cycle-003.**
- **`VerificationReceipt` admission substrate** (v3-addendum / mining-brief) — owner-ambiguous; needs an operator/Tobias scope decision before any build.
- **Real-oracle certs / BREATH round-trip** — Echelon S5 parser gated (at S1).
- **`composed_trust` emission** — Sprint 05 do-not-emit (not Sprint 02).

---

## 8. Validation gates + ceiling + stop

- **Validation (at `/implement` time):** full suite green (`npm run test:all`, 0 fail, baseline 848 + new); jcs-parity + feed_id tests pass; `bundle_schema_version` re-baseline recorded; exact-key / claim-ceiling greps clean; `canonicalize.js`/`sign.js`/`receipt-v0.json` byte-unchanged; `package.json` unchanged at `0.4.0`.
- **Ceiling:** Sprint 02 stays receiving-alignment inside the **BREATH producer ceiling**. The `bundle_schema_version` bump **adopts Echelon's contract version** (not a FORGE-semantic break, not a package bump). No admission / cert / scoring / `composed_trust` / multi-construct / runtime claim.
- **Stop:** this is planning. Nothing is coded. Sprint 02 begins only on operator `/implement cycle-003-s02-canonicalization-parity-receiving-alignment` (review+audit gated).
