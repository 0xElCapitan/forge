# Sprint 1 Implementation Report: MUST FIX

**Sprint:** 1 — Tobias Review Response (MUST FIX)
**Date:** 2026-03-31
**Status:** Complete
**Tests:** 587 passing (0 failures)

---

## Executive Summary

Sprint 1 resolves all three MUST FIX items from Tobias's sprint-10 review. Three files modified, zero code logic changes, zero new dependencies. All 587 tests pass.

---

## Tasks Completed

### T-R01: Fix construct.json entry_point

**Files Modified:**
- `spec/construct.json:42` — `entry_point`: `"BUTTERFREEZONE.md"` → `"README.md"`
- `spec/construct.json:45` — `context_files[0]`: `"BUTTERFREEZONE.md"` → `"README.md"`

**Approach:** Direct field edit. Verified `README.md` exists at repo root.

**Acceptance Criteria:**
- [x] `spec/construct.json` references `README.md` as entry_point
- [x] `context_files[0]` updated to `README.md`
- [x] All other construct.json fields unchanged
- [x] `npm run test:all` passes (587/587)

---

### T-R02: Document settlement tier key distinction

**Files Modified:**
- `src/trust/oracle-trust.js:27-38` — Added comment block above `TRUST_REGISTRY` documenting:
  - FORGE uses string keys ("T0"–"T3") for oracle identity tiers
  - These are orthogonal to TREMOR's numeric data maturity levels
  - Full Echelon provenance mapping (T0→signal_initiated high confidence, T1→signal_initiated Brier-discounted, T2→suggestion_promoted, T3→suggestion_unlinked)
- `spec/proposal-ir.json:45` — Updated `trust_tier` field description with string key format explanation and Echelon provenance mapping

**Approach:** Documentation-only. No code logic changes. Tier format (string keys) preserved exactly as-is.

**Acceptance Criteria:**
- [x] Comment block in `src/trust/oracle-trust.js` above tier definitions
- [x] Echelon provenance mapping documented in source
- [x] `spec/proposal-ir.json` trust_tier description updated
- [x] Tier format (string keys) unchanged
- [x] `npm run test:all` passes (587/587)

---

### T-R03: Verify domain claim vocabulary

**Files Modified:**
- `spec/construct.json:24` — `skills` array: `"feed-characterization"` → `"feed-classification"`
- `spec/construct.yaml:5` — `domain_claims`: `feed_characterization` → `feed_classification`
- `spec/construct.yaml:14` — `skill_manifest` analyze command: `domain: feed_characterization` → `domain: feed_classification`
- `spec/construct.yaml:16` — `skill_manifest` classify command: `domain: feed_characterization` → `domain: feed_classification`

**Approach:** Conservative scope per sprint plan — only renamed the explicitly flagged term (`feed_characterization`). Other domain claims (`prediction_markets`, `rlmf_export`, `theatre_management`, `oracle_verification`, `settlement_verification`, `calibration_analysis`) are flagged for Tobias confirmation but not changed (SDD Q1).

**Vocabulary audit note:** The `domain` array in construct.json (line 9) already contained `"feed-classification"` — no change needed there. The `skills` array (line 24) and construct.yaml entries were the only locations with the stale `feed_characterization` / `feed-characterization` terms.

**Acceptance Criteria:**
- [x] All `feed_characterization` references replaced with `feed_classification`
- [x] Original and replacement documented (this report)
- [x] Other domain claims flagged but not changed (conservative scope)
- [x] `npm run test:all` passes (587/587)

---

## Testing Summary

| Metric | Value |
|--------|-------|
| Total tests | 587 |
| Passing | 587 |
| Failing | 0 |
| Suites | 162 |
| Duration | 398ms |
| Command | `npm run test:all` |

No new tests added in Sprint 1 — all changes are metadata/documentation, not code logic.

---

## Technical Highlights

- **Zero code logic changes** — all modifications are metadata fields, comments, and schema descriptions
- **Additive only** — no IR fields removed, renamed, or type-changed
- **Test count** is 587 (above the 566 baseline in the PRD)

---

## Known Limitations

1. **SDD Q1 remains open:** Six additional domain claims in `construct.yaml` may need renaming to match Echelon's vocabulary. Only `feed_characterization` was changed per the conservative scope. Candidates: `prediction_markets`→`market_proposal`, `rlmf_export`→`rlmf_certificate`, `theatre_management`→`theatre_lifecycle`, `oracle_verification`→`oracle_trust`, `settlement_verification`→`settlement_accuracy`, `calibration_analysis`→`calibration_validity`. Awaiting Tobias confirmation.

---

## Verification Steps

```bash
# 1. Verify entry_point fix
grep '"entry_point"' spec/construct.json
# Expected: "entry_point": "README.md"

# 2. Verify context_files fix
grep -A1 '"context_files"' spec/construct.json
# Expected: first entry is "README.md"

# 3. Verify tier documentation exists
grep -c "Echelon provenance mapping" src/trust/oracle-trust.js
# Expected: 1

# 4. Verify domain claim fix — no stale references
grep 'feed.character' spec/construct.json spec/construct.yaml
# Expected: no matches (all replaced)

grep 'feed.classif' spec/construct.yaml
# Expected: 3 matches (domain_claims + 2 skill_manifest entries)

# 5. Run tests
npm run test:all
# Expected: 587 tests, 0 failures
```

---

*Generated by Sprint Implementer Agent*
