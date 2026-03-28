# Changelog

All notable changes to FORGE will be documented in this file.

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
