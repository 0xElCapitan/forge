# Sprint 10 — Implementation Report

**Sprint**: sprint-10 (global 10)
**Label**: Echelon Construct Spec (construct.json + construct.yaml)
**Status**: Ready for review
**Implemented**: 2026-03-20

---

## Summary

Sprint 10 delivers the two Echelon-compatible spec files that unblock Tobias from running FORGE through the Echelon full-stack validation path. No new logic — all content derived from existing code.

---

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| `spec/construct.json` | 184 | Echelon-compatible JSON spec — gold standard TREMOR pattern + BREATH dual-role data_sources |
| `spec/construct.yaml` | 34 | Lightweight YAML spec — TREMOR/CORONA pattern |

---

## T-33: spec/construct.json

### Design decisions

**Structural model**: TREMOR's construct.json (`grimoires/pub/TREMOR docs/tremor_construct.json`) as the gold standard. Adds BREATH's `data_sources[]` dual-role pattern at top level and `rlmf` block. The result is the fullest Echelon construct bundle format.

**Theatre templates** (6 entries, all with `brier_type`):

| ID | Resolution | brier_type | Source |
|----|------------|------------|--------|
| `threshold_gate` | binary | binary | `src/theatres/threshold-gate.js` |
| `cascade` | multi_bucket (5) | multi_class | `src/theatres/cascade.js` |
| `divergence` | binary | binary | `src/theatres/divergence.js` |
| `regime_shift` | binary | binary | `src/theatres/regime-shift.js` |
| `anomaly` | binary | binary | `src/theatres/anomaly.js` |
| `persistence` | binary | binary | `src/theatres/persistence.js` |

**Settlement tiers** (4 entries, matching `src/trust/oracle-trust.js` exactly):

| Tier | can_settle | brier_discount | Ground |
|------|-----------|----------------|--------|
| T0 — settlement_authority | true | 0 | `getTrustTier` + `canSettle` |
| T1 — official_source | true | 0.10 | same |
| T2 — corroboration | false | null | T3/T2 block |
| T3 — signal | false | null | PurpleAir invariant doc'd |

The `can_settle` field directly mirrors `canSettle(tier)` from `oracle-trust.js:75` (returns true only for T0/T1).

**Verification checks** (3 required):
- `evidence_bundle_accuracy` — template proposals match feed profile characteristics
- `settlement_tier_correctness` — settlement_source is T0/T1, never T2/T3
- `brier_score_computation` — Brier math correct against recorded positions

**data_sources** (dual role pattern from BREATH):
- `usgs_seismic` → role: primary / semantic_role: classification_target
- `swpc_space_weather` → role: primary / semantic_role: classification_target
- `purpleair_sensor` → role: cross_validation / semantic_role: trust_tier_signal
- `epa_airnow` → role: cross_validation / semantic_role: trust_tier_settlement

**osint_sources** (4 entries with `role` field): USGS NEIC (primary), NOAA SWPC (primary), EPA AirNow (primary), PurpleAir (cross_validation).

**rlmf.exports**: `["brier_score", "position_history", "calibration_bucket"]` — exactly as specified.

**composes_with.depended_by**: `["tremor", "breath", "corona"]` — the three constructs that consume FORGE's theatre proposals.

### Validation

```
JSON valid
theatre_templates: 6
verification_checks: 3
settlement_tiers: 4
osint_sources: 4
data_sources: 4
rlmf.exports: ["brier_score","position_history","calibration_bucket"]
composes_with.depended_by: ["tremor","breath","corona"]
  threshold_gate → brier_type: binary
  cascade → brier_type: multi_class
  divergence → brier_type: binary
  regime_shift → brier_type: binary
  anomaly → brier_type: binary
  persistence → brier_type: binary
```

---

## T-34: spec/construct.yaml

**construct_class**: `theatre` ✓

**domain_claims** (7, exactly as specified):
1. `feed_characterization`
2. `prediction_markets`
3. `rlmf_export`
4. `theatre_management`
5. `oracle_verification`
6. `settlement_verification`
7. `calibration_analysis`

**skill_manifest** (6 entries):

| command | domain |
|---------|--------|
| analyze | feed_characterization |
| classify | feed_characterization |
| propose | prediction_markets |
| compose | theatre_management |
| replay | calibration_analysis |
| get-certificates | rlmf_export |

**refusals** (3, scoping FORGE's boundaries):
- `financial_trading` — not market execution
- `domain_specific_advice` — structure only, not seismic/meteorological/epidemiological predictions
- `live_settlement` — settlement via T0/T1 oracles, not FORGE directly

### BREATH domain_claims note

BREATH's `construct.yaml` currently uses `environmental` as a domain claim, which Tobias flagged as vague/unrecognized by Echelon policy normalization (resulting in `tier_cap = UNVERIFIED`). FORGE uses `feed_characterization` as its primary domain claim — this is more precise and matches FORGE's actual function as a feed classifier. Tobias should confirm whether `feed_characterization` is in Echelon's recognized domain vocabulary, or whether it needs to be added alongside `air_quality_intelligence` for BREATH.

### Validation

```
YAML: all required fields present
domain_claim-like lines: 7
skill_manifest entries: 6
refusals entries: 3
```

---

## Acceptance Criteria Check

| Criterion | Status |
|-----------|--------|
| `spec/construct.json` is valid JSON | ✓ |
| All 6 theatre templates present with `brier_type` | ✓ |
| 3 verification checks present | ✓ |
| 4 settlement tiers (T0-T3), `can_settle` matches `oracle-trust.js` | ✓ |
| `rlmf.exports: ["brier_score", "position_history", "calibration_bucket"]` | ✓ |
| All `data_sources` have `role` + `semantic_role` | ✓ |
| All `osint_sources` have `role` field | ✓ |
| `composes_with.depended_by: ["tremor", "breath", "corona"]` | ✓ |
| `spec/construct.yaml` is valid YAML | ✓ |
| `construct_class: theatre` | ✓ |
| All 7 `domain_claims` present | ✓ |
| `skill_manifest` has 6 entries with command + domain | ✓ |
| 3 `refusals` scoping FORGE's boundaries | ✓ |

---

## Open Question for Reviewer

**domain_claims vocabulary**: Does the Echelon policy normalizer recognize `feed_characterization` as a precise domain? If not, it may assign `tier_cap = UNVERIFIED` (same issue as BREATH's `environmental`). Tobias should confirm what domain vocabulary the Echelon planner uses, and whether FORGE needs to mirror a domain it's validated against (e.g., `analytics` or `prediction_markets`) rather than its own function label.

No code changes needed for either answer — this is a naming alignment question.
