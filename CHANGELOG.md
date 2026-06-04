# Changelog

All notable changes to FORGE will be documented in this file.

## [0.4.0] - 2026-06-04

Forward-only release for the Cycle-002 ConstructAdmissionBundle producer.

FORGE can emit a local, content-addressed ConstructAdmissionBundle producer artifact for the narrow BREATH worked path matching the Cycle-113 receiving surface shape.

### Added
- **bundle**: `src/bundle/` ConstructAdmissionBundle producer surface — bundle shape/constants (closed enums, field-name constants, construct slug, versioning).
- **bundle**: In-memory assembly skeleton (`assemble.js`, `members.js`) — assembles an unsigned, in-memory ConstructAdmissionBundle shaped to the Cycle-113 receiving surface. Final materialization is BREATH-only by an explicit construct-slug guard; non-BREATH slugs are rejected.
- **bundle**: Oracle-declaration and `settlement_authority` authoring (`oracles.js`, `settlement.js`) — producer-side authoring of those required bundle fields for the one worked BREATH path (oracle source plus read-only trust-tier bound). Authoring only: no settlement is performed and no payout; the path is not imported by any live runtime.
- **bundle**: Receipt-digest content-addressing for the bundle (`receipt.js`) — SHA-256 content hash, not a cryptographic signature.
- **bundle**: Local disk emitter (`emit.js`) — writes bundles to the gitignored `build/construct-bundles/` namespace. No network, no external submission.
- **bundle**: `SKILL.md`, `reality.md`, and `handoff.md` markdown-member materialization (`markdown-members.js`) for the single worked BREATH worked path.
- **test**: Construct bundle shape/conformance and boundary regression coverage (`test/unit/bundle-*.spec.js`).

### Scope and limits
- Producer artifact only — a local, **unsigned** bundle. It is not a submission.
- Single worked theatre: BREATH. Non-BREATH constructs are rejected by design (single-construct, single-theatre).
- No Echelon admission and no parser acceptance; no certification.
- No calibration improvement and no optimization.
- No signature production, signature verification, or signature-based acceptance.
- No SkillOpt execution; no backend skill publication; no L2 readiness.
- No broad multi-theatre / multi-construct support; no runtime/CLI readiness beyond the producer path itself.

### Release-baseline note
- Version `0.3.0` (ProposalReceipt v0; CHANGELOG entry dated 2026-04-11) was documented and bumped in `package.json` but **never tagged or released** — the semver automation was blocked by stale `[skip release]` / `[no-bump]` markers in the `v0.2.4..HEAD` range while `package.json` had already advanced past the latest `v0.2.4` tag.
- `v0.4.0` is a one-time, operator-approved forward-only re-baseline. `v0.3.0` is intentionally preserved as an untagged version-baseline gap and is **not** backfilled. History is not rewritten and the old `[skip release]` / `[no-bump]` markers are left in place.

## [IR 0.2.0] - 2026-05-27

Proposal IR schema bump from `0.1.0` to `0.2.0` — surface ratification only. **Not a FORGE software/package version bump.** Receipt schema (`forge-receipt/v0`), canonicalization (`jcs-subset/v0`), and determinism contract unchanged.

### Added
- **`verifier_type`** (envelope-level) — type `["string", "null"]`. Verification regime applied to this envelope's outputs; default and sole producer value at v0.2.0: `"echelon-brier/v0"`. Required in the envelope `required` array. Scaffolding-only at v0.2.0: no enum on the schema (single-value posture is producer-side convention via `src/ir/emit.js`), no dispatch behavior. Reserved for future multi-regime dispatch.
- **`claim_shape`** (proposal-level, inside `#/$defs/Proposal`) — type `["string", "null"]`; schema `enum: ["event", null]`. Default and sole producer value at v0.2.0: `"event"`. Validator-rejects `"state"`, `"interval"`, `"continuous"` and any other string. Required in the Proposal `required` array. Orthogonal to `template` (detection methodology) and `brier_type` (scoring rubric).

### Changed
- `spec/proposal-ir.json` top-level `version` and envelope `ir_version.const` move from `"0.1.0"` to `"0.2.0"`. `$id` URL stays at the `.../proposal-ir/0.1.0` URL by design (minor bump does not rotate the canonical schema URL).
- `src/ir/emit.js` constant `IR_VERSION` flips to `'0.2.0'`. `FORGE_VERSION` and `CLASSIFIER_VERSION` stay at `'0.1.0'`.
- `test/unit/schema-validation.spec.js` in-file lightweight validator extended to support the JSON Schema `enum` keyword (honoring `null` membership). Backward-compatible: properties without `enum` behave as before.

### Migration

- Consumers that ignore unknown fields (per JSON Schema `additionalProperties` policy and `spec/STABILITY.md` consumer guidance) require no code change.
- Consumers that hard-pin `ir_version === "0.1.0"` MUST widen to accept `"0.1.0"` OR `"0.2.0"`, or split into version-specific variants. See PRD §7 four-category bridge compatibility plan in `grimoires/loa/a2a/cycle-002/00-ir-surface-ratification-prd-draft.md`.
- Consumers iterating proposal fields MUST expect `claim_shape` on every proposal in v0.2.0 envelopes.
- Old `forge-receipt/v0` receipts produced against v0.1.0 envelopes remain valid forever; no retroactive re-signing.

### Bundled-notice flow

Bundled per `spec/STABILITY.md:33` 1-sprint notice rule: both fields delivered in one notice to Echelon (Tobias) on 2026-05-26 and acknowledged same-day with no integration objection. The bridge survey confirmed 176/180 Echelon-side bridge tests need no change; the 4 sites requiring assertion widening are localized to one Echelon test file.

### Notes

- A-6 (forge-verify MATCH for refreshed golden envelopes) is satisfied via the new `test/unit/forge-verify.spec.js` "Sprint 01 §7 dual-version gate" suite that exercises MATCH for one preserved v0.1.0 inline envelope+receipt (TREMOR) plus freshly generated v0.2.0 TREMOR/CORONA/BREATH receipts in a single test run with `bin/forge-verify.js` unchanged (PRD §7 Path 1 closure).
- `fixtures/forge-snapshots-{tremor,corona,breath}.json` snapshot refresh (FR-7 / T-E1) deferred this sprint — see follow-up bead `forge-ewa`. The snapshots are documentation-only and not consumed by any test; their refresh exposes pre-existing emitter drift unrelated to the IR 0.2.0 seam.

## [0.3.0] - 2026-04-11

### Added
- **ProposalReceipt v0** — signed, independently verifiable proof that a proposal envelope was produced from a specific input under a specific policy and code version. Schema: `spec/receipt-v0.json`.
- `forge-verify` CLI (`bin/forge-verify.js`) — independent replay verifier. Re-runs the FORGE pipeline on original input and compares output hash against receipt. Exit codes: 0=MATCH, 1=MISMATCH, 2=ERROR.
- JCS-subset/v0 canonical JSON serializer (`src/receipt/canonicalize.js`) — deterministic key ordering, type-safe value encoding.
- Ed25519 signing and verification (`src/receipt/sign.js`) — fail-closed design, `ed25519:` prefixed base64 signatures.
- Keyring management (`src/receipt/keyring.js`, `keys/forge-keyring.json`) — key loading, rotation support, environment variable overrides (`FORGE_SIGNING_KEY`, `FORGE_KEY_ID`).
- Policy hashing (`src/receipt/policy-hasher.js`) — hashes active rule set and regulatory tables for receipt `policy_hash` field.
- Code identity (`src/receipt/code-identity.js`) — embeds `{ git_sha, package_lock_sha, node_version }` triple in receipt for reproducibility.
- SHA-256 hash utility (`src/receipt/hash.js`) — `sha256:` prefixed hashes for all receipt fields.
- `ForgeConstruct.analyze()` now accepts `receipt: true` option — returns `{ envelope, receipt }` with optional `sign` function and `timestampBase`/`now` for deterministic output.
- `timestampBase` option in ingester for deterministic ingestion timestamps.
- 9 integration tests (`test/integration/receipt-pipeline.spec.js`) — TREMOR/CORONA/BREATH round-trip receipt verification.
- 91 unit tests across 7 new test files (canonicalize, hash, code-identity, policy-hasher, receipt-builder, sign, forge-verify, determinism-gate).
- Documentation: `docs/canonicalization.md`, `docs/key-management.md`, `docs/retention-policy.md`, `docs/echelon-integration.md`.

### Changed
- `emitEnvelope()` now returns `{ envelope, receipt }` when called with `receipt: true` and `rawInput`.
- `ingest()` accepts `timestampBase` option for reproducible timestamps.
- Total test count: 599 → 699 (684 unit + 6 convergence + 9 integration).

## [0.2.4] - 2026-03-28

### Security
- **RT-01 (CRITICAL)**: Settlement now requires `source_id` — fail-closed design. Omitting `source_id` returns `{ settled: false }` instead of bypassing trust enforcement.
- **RT-05/CR-01 (HIGH)**: Implemented Argus Check 6 (value out of range). `NaN`, `Infinity`, `-Infinity` are now rejected by `checkAdversarial()`.
- **SA-07/HI-03 (HIGH)**: Path traversal guard in `createReplay()`. When `allowedDir` is passed, paths resolving outside are blocked.
- **RT-02 (MEDIUM)**: `getTrustTier()` type guard — non-string inputs return `'unknown'` instead of throwing `TypeError`.
- **SA-02/ME-05 (MEDIUM)**: NaN guard in `freshnessScore()` — `stale_after_ms <= 0` returns 0 instead of `NaN`.
- **CR-02/SA-01 (MEDIUM)**: `buildBundle()` now validates `rawEvent.value` is a number, throws `TypeError` otherwise.

### Fixed
- **HI-04**: `generateId()` now uses injectable clock from `ForgeRuntime` instead of `Date.now()` directly.
- **ME-07 (HIGH)**: IR emit field name mismatches corrected — `median_ms`, `jitter_coefficient`, `spike_rate`, `sensor_count` now match classifier output.
- **RT-10 (HIGH)**: Bundle validation-at-ingestion — `ingestBundle()` now snapshots critical fields (`quality`, `evidence_class`, `doubt_price`, `source_id`) at ingestion time.

### Changed
- **RT-09 (HIGH)**: Documented tier validation as explicit API contract in `buildBundle()` JSDoc. Callers MUST use `getTrustTier()` to look up tier.

### Analysis
- Usefulness heuristic baseline audit — scored all 13 backing spec proposals, identified CORONA density classification and TREMOR score uniformity as structural issues. Weight change proposed and reverted (no calibration data). Findings documented for Cycle 002.

## [0.2.3] - 2026-03-25

### Added
- Loa framework v1.39.1 mounted
- Polymarket diagnostic agent prompt
- Coordinate guard prompt fix

## [0.2.2] - 2026-03-22

### Added
- SWPC API references and response samples
- Refined FORGE grimoire with space weather domain context

## [0.2.1] - 2026-03-21

### Added
- Proposal IR spec v0.1.0 — versioned `ProposalEnvelope` with deterministic `proposal_id`
- ForgeRuntime — theatre lifecycle orchestrator with `instantiate()` and `settle()`
- USGS live adapter — real-time seismic feed integration
- Golden envelope snapshots for TREMOR, CORONA, BREATH backing specs

## [0.2.0] - 2026-03-21

### Added
- IR spec scaffolding
- Feed grammar refinements
- README and grimoire updates

## [0.1.0] - 2026-03-20

### Added
- Initial FORGE implementation — Feed-Adaptive Oracle & Runtime Generator for Echelon.
- Feed grammar engine: cadence, distribution, noise, density, threshold classification
- Template selector with 13 rule-based proposals across 6 theatre types
- Evidence bundle assembly, quality scoring, doubt pricing
- Oracle trust tiers (T0–T3) with adversarial detection
- RLMF Brier scoring and certificate export
- Economic usefulness filter
- Convergence test suite against TREMOR, CORONA, BREATH backing specs
