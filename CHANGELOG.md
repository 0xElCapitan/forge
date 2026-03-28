# Changelog

All notable changes to FORGE will be documented in this file.

## [0.1.1] - 2026-03-27

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

## [0.1.0] - 2026-03-27

### Added
- Initial FORGE implementation — Feed-Adaptive Oracle & Runtime Generator for Echelon.
