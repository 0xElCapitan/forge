# FORGE Proposal IR — Stability Policy

**Schema:** `spec/proposal-ir.json`
**Current Version:** 0.1.0
**Status:** Stabilizing

---

## Commitment

The Proposal IR is the contract between FORGE and Echelon. Echelon has 163 bridge tests locked to the current schema. No breaking changes will be made without prior notice.

## Versioning

The `ir_version` field follows [SemVer 2.0](https://semver.org/):

- **MAJOR** (1.0.0): Reserved for post-stabilization breaking changes.
- **MINOR** (0.2.0): Non-breaking additions (new optional fields, new enum values, new optional sections).
- **PATCH** (0.1.1): Documentation, description, or metadata corrections with no structural change.

## Breaking Changes

A breaking change is any modification that would cause a previously valid envelope to become invalid, or a previously working consumer to fail:

- Removing a field
- Changing a field's type (e.g. `string` to `number`)
- Changing a field from optional to required (or vice versa)
- Renaming a field
- Removing an enum value

### Notice Policy

Breaking changes will be:

1. Flagged in the CHANGELOG with a `BREAKING:` prefix
2. Communicated to Echelon maintainers with a minimum of **1 sprint notice** before merge
3. Accompanied by a MAJOR or MINOR version bump as appropriate

## Non-Breaking Changes

The following are non-breaking and may be added in any release:

- Adding new optional fields to existing objects
- Adding new enum values
- Adding new optional top-level sections
- Extending description text
- Adding new `$defs` types

### This Sprint (Tobias Review Response)

- `usefulness_score` added to `Proposal` definition (required, `["number", "null"]`) — additive, non-breaking since all consumers must already handle unknown fields per JSON schema `additionalProperties` policy.

### Cycle 002 Planned Additions

The following fields are planned as additive (non-breaking) for Cycle 002:

- `normalization_trace` — provenance of any value normalization applied
- `negative_policy_flags` — policy violations detected during classification
- `original_hash` — content hash of the raw feed data window
- `hash_algorithm` — algorithm used to produce `original_hash`; currently always `"sha256"`; reserved to support post-quantum hash migration without a breaking change
- `activation_policy` — deterministic warmup and activation timing hint for downstream market operators
- `usefulness_breakdown` — decomposition of the composite usefulness score into four component scores (`predictability`, `settlement_clarity`, `actionability`, `population_impact`)
- `allocation_class` — routing tier derived from usefulness breakdown (`"core"` | `"niche"` | `"experimental"`)
- `classifier_version` — independent semver for the Pythia classifier, enabling version-aware composition in downstream module pipelines
- `composed_trust` — trust and settlement authority metadata for Hermes-composed theatres; schema subject to co-design with Echelon before 002 ships

The following fields are planned as additive (non-breaking) for Cycle 003 (nullable in 002, populated in 003):

- `scoring.benchmark` — naive forecaster comparison scores per theatre type
- `scoring.skill_adjusted` — difficulty-adjusted skill delta over the benchmark forecaster

## Consumer Guidance

Echelon and other consumers SHOULD:

- Ignore unknown fields (forward-compatibility)
- Check `ir_version` and reject unrecognised MAJOR versions
- Treat MINOR version bumps as safe to consume without code changes

## Reserved Field Names

The following field names are reserved for future use and MUST NOT be used for
other purposes in any cycle before the relevant spec ships:

- `module_type` — reserved for Echelon composable environment module contract
  (§9). Will declare the producing module's type for composition runtime routing.
  Not emitted until the module contract spec is finalized.
- `module_id` — reserved as alternative identifier if `module_type` is
  insufficient for routing.