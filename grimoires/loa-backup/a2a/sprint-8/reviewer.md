# Sprint 8 — Implementation Report

**Sprint**: Sprint 8 — Processor Pipeline + Trust Model (global sprint-8)
**Date**: 2026-03-20
**Engineer**: Implementing Agent

---

## Executive Summary

Sprint 8 delivered the generalized processor pipeline and oracle trust model for FORGE. Six new files across `src/processor/` and `src/trust/` implement pure, injectable-clock, zero-dependency modules following the TREMOR/CORONA/BREATH patterns established in earlier sprints.

**Total test count**: 459 unit + 6 convergence = 465 total. All pass. Zero regressions.

New tests: 77 (34 processor + 43 trust), across 15 suites.

---

## Tasks Completed

### T-27: Processor Pipeline

#### `src/processor/quality.js` (58 lines)

Quality scoring function configurable per feed tier.

- `computeQuality(event, config)` → quality in [0, 1]
- Tier baseline: T0=1.0, T1=0.9, T2=0.7, T3=0.5
- Freshness component: linear decay from 1.0→0 over `stale_after_ms` (default: 1 hour); future timestamps penalised at 0.9
- Blend: `(1 - freshness_weight) * tier_base + freshness_weight * freshness` (default freshness_weight=0.2)
- Unknown tiers default to 0.5 baseline

#### `src/processor/uncertainty.js` (22 lines)

Doubt pricing from quality score.

- `computeDoubtPrice(quality)` → doubt_price in [0, 1]
- Formula: `1 - quality` (clamped)
- High quality (T0 = 1.0) → doubt_price = 0.0; T3 fresh ≈ 0.4

#### `src/processor/settlement.js` (54 lines)

Evidence class assignment by trust tier.

- `assignEvidenceClass(tier)` → `'ground_truth' | 'corroboration' | 'provisional'`
- T0, T1 → `'ground_truth'` (may settle)
- T2 → `'corroboration'` (evidence only, no settlement)
- T3, unknown → `'provisional'` (signal only, no settlement)
- `canSettleByClass(evidence_class)` → boolean (convenience utility)
- Settlement enforcement is authoritative in `oracle-trust.js`; settlement.js is responsible for labelling only

#### `src/processor/bundles.js` (72 lines)

EvidenceBundle assembly integrating all three processor modules.

- `buildBundle(rawEvent, config)` → EvidenceBundle
- Produces: `{ value, timestamp, doubt_price, quality, evidence_class, source_id, theatre_refs, resolution: null }`
- Optional passthrough: `channel_a`, `channel_b`, `lat`, `lon`, `frozen_count` (present only when rawEvent provides them)
- Config: `tier`, `source_id`, `theatre_refs`, `now`, `stale_after_ms`, `freshness_weight`
- No mutation — returns a new object every call

EvidenceBundle contract matches TREMOR/CORONA/BREATH patterns precisely:
> From sprint.md: "`buildBundle(rawEvent, config)` → EvidenceBundle with evidence_class, theatre_refs, resolution"

---

### T-28: Oracle Trust Model + Adversarial Detection

#### `src/trust/oracle-trust.js` (78 lines)

T0–T3 tier enforcement with settlement authority gate.

- `getTrustTier(sourceId)` → `'T0'|'T1'|'T2'|'T3'|'unknown'`
- `canSettle(tier)` → boolean — **true only for T0 and T1**
- `validateSettlement(sourceId)` → `{ allowed, tier, reason? }` — convenience wrapper
- Lookup is case-insensitive (`sourceId.toLowerCase()`)
- Unknown sources return `'unknown'` and may never settle

Known source registry:
| Tier | Sources |
|------|---------|
| T0 | `epa_aqs`, `usgs_reviewed`, `gfz_kp` |
| T1 | `airnow`, `usgs_automatic`, `swpc_goes`, `noaa_goes` |
| T2 | `openaq`, `emsc` |
| T3 | `purpleair`, `thingspeak` |

**Critical invariant** explicitly tested and enforced:
> From sprint.md: "Critical invariant: PurpleAir (T3) must NEVER settle a theatre."

`getTrustTier('purpleair') === 'T3'` and `canSettle('T3') === false`. The test is explicit.

#### `src/trust/adversarial.js` (117 lines)

Anti-gaming detection for T2/T3 sources.

- `checkAdversarial(bundle, context?)` → `{ clean: true } | { clean: false, reason: string }`
- `checkChannelConsistency(channelA, channelB)` → `{ consistent: boolean, divergence: number }` (PurpleAir reference pattern)

Five detection checks in priority order:

| Check | Trigger | Threshold |
|-------|---------|-----------|
| Channel A/B inconsistency | `bundle.channel_a/b` present | relative divergence > 15% |
| Frozen / replayed data | `bundle.frozen_count` present | ≥ 5 consecutive identical readings |
| Clock drift (old) | `bundle.timestamp` present | > 7 days old |
| Clock drift (future) | `bundle.timestamp` present | > 1 hour in future |
| Location spoofing | `context.registered_lat` present | coord deviation > 0.45° (~50 km) |
| Sybil sensors | `context.peer_values` array | all identical (≥ 2 peers) |

Design note: Checks are stateless per-bundle where possible. Stateful comparisons (location, Sybil) require optional `context` parameter, keeping the function pure with respect to its inputs.

---

## Technical Highlights

**Pure functions throughout**: Every exported function returns a new value; no mutation. Consistent with theatre template design from Sprint 7.

**Injectable clock**: `buildBundle` accepts `{ now }` via config, matching the `{ now = Date.now() }` pattern used in all theatre functions for deterministic testing.

**Separation of concerns**: settlement.js labels; oracle-trust.js enforces. The labelling step (evidence_class) is informational for downstream scoring. The enforcement step (canSettle) is the security gate. These are intentionally separate so the trust enforcement point can be changed without touching bundle assembly.

**Zero external dependencies**: No imports, no network. All six files are pure computation modules.

**Denominator floor of 1**: Used in adversarial.js channel A/B check — `max(|a|, |b|, 1)` prevents division by zero for zero-value sensors, matching the pattern from divergence.js in Sprint 7.

---

## Testing Summary

**Files**: `test/unit/processor.spec.js`, `test/unit/trust.spec.js`

| File | Tests | Suites |
|------|-------|--------|
| processor.spec.js | 34 | 5 |
| trust.spec.js | 43 | 10 |

**How to run**:
```bash
node --test test/unit/processor.spec.js
node --test test/unit/trust.spec.js

# All unit tests (459 total)
node --test test/unit/*.spec.js

# Full suite including convergence (465 total)
node --test test/unit/*.spec.js test/convergence/*.spec.js
```

**Coverage highlights**:
- All four tier baselines (T0/T1/T2/T3) verified in quality + settlement
- Fresh vs stale quality degradation explicitly tested
- Float precision: approximate comparisons (`Math.abs(q - expected) < 1e-10`) used for computed quality values
- `canSettle('T3') === false` — PurpleAir critical invariant explicit test at trust.spec.js:55
- `validateSettlement('purpleair')` rejection with reason string verified
- All six adversarial checks individually tested with clean and dirty bundles
- Division-by-zero guard on zero-value channels tested
- Sybil check boundary (1 peer = no flag, 2+ identical peers = flag)

**Regression**: 6/6 convergence tests pass. 382 prior unit tests pass. Zero regressions.

---

## Known Limitations

**Trust registry is static**: Source IDs are hardcoded in oracle-trust.js. In production, this registry should be externally configurable (YAML/JSON config, or database-backed). The static registry is correct for the current FORGE scope where the known feed inventory is bounded.

**T3 → T2 promotion not implemented**: The SDD specifies a promotion path (min observation count + uptime % + neighbourhood agreement + anti-spoof checks). This path is documented in oracle-trust.js but not implemented; Sprint 8 scope covers tier assignment and enforcement only.

**Sybil detection is threshold-free**: The current implementation flags all-identical readings across ≥2 peers as Sybil activity. Real Sybil detection needs a statistical correlation threshold (e.g., Pearson r > 0.999 over N readings), which requires state across bundles. The current implementation is a simplified but correct first gate.

**Value range check not implemented**: Physically impossible values (e.g., PM2.5 = -500, AQI = 50000) are not checked in adversarial.js. This requires domain-specific bounds and belongs in a per-source adapter layer (out of scope for the generalized processor).

---

## Verification Steps

```bash
# 1. Run new tests
node --test test/unit/processor.spec.js
# Expected: 34 pass, 0 fail

node --test test/unit/trust.spec.js
# Expected: 43 pass, 0 fail

# 2. Verify critical invariant explicitly
node -e "
import { getTrustTier, canSettle } from './src/trust/oracle-trust.js';
const tier = getTrustTier('purpleair');
console.assert(tier === 'T3', 'PurpleAir tier');
console.assert(!canSettle(tier), 'PurpleAir cannot settle');
console.log('Critical invariant: PurpleAir T3 cannot settle ✓');
" --input-type=module

# 3. Run full regression suite
node --test test/unit/*.spec.js
# Expected: 459 pass, 0 fail

node --test test/convergence/*.spec.js
# Expected: 6 pass, 0 fail

# 4. Verify convergence score unchanged
# Expected TotalScore: 20.0/20.5 (unchanged from Sprint 7)
```
