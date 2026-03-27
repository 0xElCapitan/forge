# Sprint 10 — Engineer Feedback

**Reviewer**: Senior Technical Lead
**Sprint**: sprint-10 (Echelon Construct Spec)
**Decision**: Changes required — one operational issue, then approved

---

## Summary

Implementation is structurally correct on every acceptance criterion. All 6 theatre templates have `brier_type`. Settlement tiers mirror `oracle-trust.js` exactly. YAML is clean and complete. One issue must be fixed before this unblocks Tobias: the spec points to a missing entry point.

---

## Required Fix

### `entry_point` and `context_files[0]` reference a file that doesn't exist

**Files**: `spec/construct.json` lines 42 and 45

```json
"entry_point": "BUTTERFREEZONE.md",    // line 42
"context_files": [
  "BUTTERFREEZONE.md",                  // line 45 — MISSING
  ...
]
```

`BUTTERFREEZONE.md` is Sprint 11 work. It does not exist now. When Tobias loads this spec into the Echelon planner, the planner will attempt to resolve the entry point and immediately fail.

**Fix** — two field changes:

```json
"entry_point": "README.md",
"context_files": [
  "README.md",
  ...
]
```

`README.md` exists (confirmed). Sprint 11 will restore both fields to `BUTTERFREEZONE.md` once that file is created.

---

## Everything Else: Approved

**construct.json structural checks:**

| Check | Result |
|-------|--------|
| Valid JSON | ✓ |
| 6 theatre templates, all with `brier_type` | ✓ |
| `cascade` → `multi_class`, remaining 5 → `binary` | ✓ |
| 3 verification checks (required names) | ✓ |
| 4 settlement tiers T0–T3, `can_settle` matches `canSettle()` | ✓ |
| T0 `brier_discount: 0` (number, not null) | ✓ |
| T1 examples cover `noaa_goes` (in oracle-trust.js registry) | ✓ |
| `rlmf.exports: ["brier_score","position_history","calibration_bucket"]` | ✓ |
| All 4 `data_sources` have `role` + `semantic_role` | ✓ |
| All 4 `osint_sources` have `role` field | ✓ |
| `composes_with.depended_by: ["tremor","breath","corona"]` | ✓ |

**construct.yaml structural checks:**

| Check | Result |
|-------|--------|
| Valid YAML | ✓ |
| `construct_class: theatre` | ✓ |
| All 7 domain_claims (exact list from sprint spec) | ✓ |
| 6 skill_manifest entries with `command` + `domain` | ✓ |
| 3 refusals (financial_trading, domain_specific_advice, live_settlement) | ✓ |
| `live_settlement` refusal explicitly cites trust model source file | ✓ |

---

## Notes for Tobias (FYI, no code change needed)

**Settlement tier schema**: FORGE uses string keys (`"T0"`, `"T1"`, `"T2"`, `"T3"`) while TREMOR uses numeric keys (`1`, `2`, `3`). FORGE's tiers are oracle *identity* tiers (who is authorized to settle), not TREMOR's data *maturity* stages (when data is stable enough to settle). These are orthogonal models. Echelon planner schema validation should handle both, but Tobias should be aware of the semantic difference.

**`feed_characterization` domain claim**: BREATH's `environmental` domain was flagged by Echelon as vague. FORGE uses `feed_characterization` — Tobias should confirm this is in Echelon's recognized vocabulary or will suffer the same `tier_cap = UNVERIFIED` treatment.

---

## Next Step

Fix the two fields (`entry_point` and `context_files[0]`) and sprint-10 is done.
