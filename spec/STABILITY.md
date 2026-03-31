# FORGE Proposal IR — Stability Policy

**Schema:** `spec/proposal-ir.json`
**Current Version:** 0.1.0
**Status:** Stabilising

---

## Commitment

The Proposal IR is the contract between FORGE and Echelon. Echelon has 163 bridge tests locked to the current schema. No breaking changes will be made without prior notice.

## Versioning

The `ir_version` field follows [SemVer 2.0](https://semver.org/):

- **MAJOR** (1.0.0): Reserved for post-stabilisation breaking changes.
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

## Consumer Guidance

Echelon and other consumers SHOULD:

- Ignore unknown fields (forward-compatibility)
- Check `ir_version` and reject unrecognised MAJOR versions
- Treat MINOR version bumps as safe to consume without code changes
