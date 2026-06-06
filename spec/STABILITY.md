# FORGE Proposal IR — Stability Policy

**Schema:** `spec/proposal-ir.json`
**Current Version:** 0.3.0
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

## 0.3.0 — Cycle 003 Sprint 01 (coordinated breaking bump)

A single coordinated `0.3.0` bump carrying one breaking rename and one additive field.
`$id`, `version`, and `ir_version.const` are all reconciled to `0.3.0` (the `$id` path
segment was previously stale at `0.1.0`).

**BREAKING:**

- `emitted_at` → `emitted_at_ms` — renamed on **both** surfaces (the IR envelope and
  the bundle manifest/receipt). Value semantics are **unchanged**: still a Unix epoch
  **milliseconds** integer (no ISO-8601, no separate second field, no both-fields
  transition). The `_ms` suffix names the millisecond unit at the field, resolving the
  prior int-vs-datetime parser ambiguity. Echelon (the sole known consumer) requested
  and committed to this rename (Tobias follow-up reply). This deliberately spends the
  pre-1.0 MINOR slot on a breaking rename, once, with the consumer's request and notice
  — the additive-only-until-1.0 convention is broken here knowingly.

**Additive (non-breaking):**

- `normalization_trace` — **populated** producer-provenance object-array, travelling
  with the provenance family (`original_hash`, `negative_policy_flags`). Nullable; each
  entry is `{ field, input_value, normalized_value, method, source, confidence }` with
  `method ∈ {stated, inferred, mapped, defaulted}`, `source ∈ {forge, echelon, lattice,
  operator}`, and `confidence ∈ [0,1]`. It is producer provenance only — never an
  admission/acceptance/scoring claim (the single in-ceiling field Echelon asked FORGE to
  populate). STATED and INFERRED provenance never collapse.

**Scope notes (no release coupling):**

- **No `package.json` version bump.** The IR schema version (`0.3.0`) is independent of
  the FORGE package/release version (`0.4.0`), per the cycle-002 precedent (IR `0.2.0`
  shipped under package `0.4.0`).
- **No package `v0.3.0` tag/release backfill.**

## Non-Breaking Changes

The following are non-breaking and may be added in any release:

- Adding new optional fields to existing objects
- Adding new enum values
- Adding new optional top-level sections
- Extending description text
- Adding new `$defs` types

### This Sprint (Tobias Review Response)

- `usefulness_score` added to `Proposal` definition (required, `["number", "null"]`) — additive, non-breaking since all consumers must already handle unknown fields per JSON schema `additionalProperties` policy.

### Landed in 0.2.0

The following fields landed as additive (non-breaking) in IR 0.2.0 (Cycle 002, Sprint 01):

- `verifier_type` — envelope-level. Verification regime applied to this envelope's outputs; scaffolding-only at v0.2.0, single legal producer value (`"echelon-brier/v0"`), no dispatch behavior. Type `["string", "null"]`; consumers MAY infer the default on `null`. Required at v0.2.0. Approved by Tobias 2026-05-06; mechanics locked in the 2026-05-26 bundled 1-sprint notice; ratified by Tobias same-day.
- `claim_shape` — **proposal-level**. Temporal/extent shape of the asserted truth; scaffolding-only at v0.2.0. Type `["string", "null"]`; enum `["event", null]`. Legal value at v0.2.0: `"event"` (discrete, point-in-time occurrence). Reserved (validator-rejected at v0.2.0): `"state"`, `"interval"`, `"continuous"`. Orthogonal to `template` (detection methodology) and `brier_type` (scoring rubric). v0.2.0 consumers: passthrough only — admission gate, theatre instantiation, verifier, and Echelon scoring substrate all ignore; RLMF exports pass it through as a read-only manifest column. Required at v0.2.0. Semantics confirmed by Tobias 2026-05-13.

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