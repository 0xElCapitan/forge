# FORGE — Product Requirements Document

> **Status**: Active
> **Version**: 1.0.0
> **Date**: 2026-03-19
> **Sources**: grimoires/pub/FORGE_PROGRAM.md, TREMOR/CORONA/BREATH/Echelon reference docs

---

## 1. Problem Statement

> *Sources: FORGE_PROGRAM.md (Identity, Platform context), Echelon readme*

The Echelon prediction market platform deploys "Theatres" — structured markets on real-world outcomes. Three constructs (TREMOR, CORONA, BREATH) have proven that this architecture works across seismic, space weather, and air quality domains. But each construct was hand-coded: a human looked at a data feed, designed the right Theatre templates, and hardcoded the parameters.

**The problem**: Scaling to new data feeds requires repeated human expert analysis. There is no automated system that can take an arbitrary live data feed, characterize its statistical properties, and propose appropriate Theatre templates.

**The opportunity**: All three existing constructs, despite being in very different domains, share common structural patterns. The same 6 Theatre templates (threshold_gate, cascade, divergence, regime_shift, persistence, anomaly) appear across all three. The feed characteristics that cause each template to be appropriate can be expressed as measurable statistical properties.

FORGE exists to automate this: a feed characterizer + template selector that generalizes the patterns already proven in TREMOR, CORONA, and BREATH into a deployable factory for any data feed.

---

## 2. Vision & Goals

> *Sources: FORGE_PROGRAM.md (Identity, The metric, Beyond convergence)*

**Vision**: The Uniswap factory for prediction surfaces. Point FORGE at any live data feed → it characterizes the data → selects Theatre templates → deploys markets. Domain expertise encoded once, applied everywhere.

**Primary goal**: Achieve convergence on all three backing specs simultaneously:
- TREMOR (USGS seismic): 5 templates correctly proposed
- CORONA (NOAA/NASA space weather): 5 templates correctly proposed
- BREATH (PurpleAir/AirNow air quality): 3 templates correctly proposed
- **Maximum TotalScore: 20.5** (13.0 TemplateScore + 7.5 GrammarScore)
- Both raw fixture mode AND anonymized fixture mode must converge

**Secondary goal**: Generalize beyond the three known feeds:
- Loop 4: Novel feed (ThingSpeak temperature) — validate the classifier generalizes
- Loop 5: Composed feed (PurpleAir + wind direction) — validate cross-feed composition

**Success definition**: 20.5/20.5 on raw + anonymized fixtures for all three backing specs. Convergence is necessary but not sufficient for deployment. Full deployment additionally requires Loop 4, Loop 5, and usefulness filter calibration.

---

## 3. Users & Stakeholders

> *Sources: Echelon readme, FORGE_PROGRAM.md (Platform context)*

**Primary user**: The Echelon platform / automated deployment pipeline. FORGE runs as a library/construct — it has no human operator in the hot path. It receives a data feed, produces Theatre proposals, and those proposals are validated and deployed.

**Secondary user**: Construct developers and integrators building new domains on Echelon. They point FORGE at a new feed and use the proposals as a starting point.

**Constrained operator (anti-cheating)**: The classifier must behave correctly even when the operator doesn't know what domain the feed is from. Statistical properties only — no source identity leaks.

---

## 4. Functional Requirements

> *Sources: FORGE_PROGRAM.md (The files, Build order, Backing specs, Anti-cheating)*

### 4.1 Phase 0 — Scaffolding (build once, fixed)

**F-01: Deterministic Replay Module** (`src/replay/deterministic.js`)
- Takes a fixture JSON file, replays it as if it were a live feed
- Same input → same output every time (no randomness)
- Must handle USGS GeoJSON, SWPC JSON, PurpleAir JSON, AirNow JSON
- This is the prerequisite for running the convergence loop

**F-02: Feed Ingester** (`src/ingester/generic.js`)
- Normalizes raw feed data into `{timestamp, value, metadata}` tuples
- Handles: USGS GeoJSON, SWPC JSON, PurpleAir JSON, AirNow JSON
- **CRITICAL**: Strips all source-identifying information from metadata before the classifier sees it. Metadata may contain: sensor coordinates (if present), sensor count, generic value labels ("reading_1", "reading_2"). Metadata MUST NOT contain: domain names, source identifiers, API paths, unit names, field names from original feed

**F-03: Convergence Test Harness** (`test/convergence/tremor.spec.js`, `corona.spec.js`, `breath.spec.js`)
- Three spec files; each loads the corresponding fixture, runs classify → select, asserts against backing spec
- **Must run in two modes**:
  - Raw fixture mode: original field names, original structure
  - Anonymized fixture mode: shuffled field names, stripped source URLs, generic metadata
- A classifier is INVALID if it passes raw but fails anonymized
- Per-experiment report output (see section 4.3 for schema)
- Rate limiting module (`src/ingester/rate-limiter.js`) for live feeds

### 4.2 Phase 1 — Feed Classifier

**F-04: Q1 Cadence** (`src/classifier/cadence.js`)
- Computes median timestamp delta and jitter coefficient (stdev/median of deltas)
- Classifications (measurable thresholds):
  - `seconds`: median_delta < 60s
  - `minutes`: 60s ≤ median_delta < 3600s
  - `hours`: 3600s ≤ median_delta < 86400s
  - `days`: median_delta ≥ 86400s
  - `event_driven`: jitter_coefficient > 2.0
  - `multi_cadence`: bimodal/multimodal delta histogram (two or more peaks separated by > 2× smaller peak)

**F-05: Q2 Distribution** (`src/classifier/distribution.js`)
- Computes bounds, percentiles, detects breakpoints
- Classifications:
  - `bounded_numeric`: values stay within stable min/max across ≥90% of window; range is finite and non-growing
  - `unbounded_numeric`: no known fixed upper bound; coefficient of max growth across rolling sub-windows exceeds 0.1 AND no stable ceiling in top decile
  - `categorical`: unique_values / total_observations < 0.05 AND values are non-continuous
  - `composite`: two or more sub-streams with different distribution types (detected via multimodal value histogram)

**F-06: Q3 Noise Profile** (`src/classifier/noise.js`)
- Computes autocorrelation, spike rate, cycle period
- Spike primitive: `|value - rolling_median(window=20)| > 3 × rolling_MAD(window=20)`; spike_rate = spike_count / total_observations
- Classifications:
  - `spike_driven`: spike_rate > 0.05 AND lag-1 autocorrelation < 0.3
  - `cyclical`: dominant FFT frequency with spectral power > 2× next peak AND autocorrelation shows periodicity (peak at lag > 1)
  - `trending`: linear regression slope |t-statistic| > 2.0
  - `stable_with_drift`: rolling stdev < 0.1 × rolling mean AND |regression slope t-stat| < 2.0
  - `mixed`: two or more criteria simultaneously satisfied

**F-07: Q4 Density** (`src/classifier/density.js`)
- Counts sensors, detects co-located pairs, counts tiers
- Classifications:
  - `single_point`: sensor_count = 1 or no spatial metadata
  - `sparse_network`: sensor_count > 1 AND mean nearest-neighbor distance > 50km (or co_located_pairs / sensor_count < 0.1)
  - `dense_network`: sensor_count > 1 AND mean nearest-neighbor distance ≤ 50km (or co_located_pairs / sensor_count ≥ 0.1)
  - `multi_tier`: two or more distinct sensor classes inferred from cadence differences, quality distribution, spatial density clustering, or normalized trust metadata — NOT from source-specific labels

**F-08: Q5 Thresholds** (`src/classifier/thresholds.js`)
- Histogram clustering, regulatory table lookup (if configured)
- Classifications:
  - `regulatory`: feed values cluster at known breakpoint boundaries (histogram shows sharp density changes at configured regulatory table values — EPA AQI, NOAA scales, etc.)
  - `physical`: thresholds correspond to natural phase boundaries (bimodal value distribution with clear separation)
  - `statistical`: thresholds derived from percentile analysis (p95, p99, or 3-sigma as candidate gate thresholds)
  - `none`: no stable breakpoint family detected

**F-09: Feed Grammar Orchestrator** (`src/classifier/feed-grammar.js`)
- Runs Q1-Q5 in sequence, produces a `FeedProfile`
- FeedProfile schema:
  ```js
  {
    cadence: { classification, median_ms, [jitter_coefficient], [streams] },
    distribution: { type, [bounds], [sub_types] },
    noise: { classification, [spike_rate], [components] },
    density: { classification, [sensor_count], [tiers] },
    thresholds: { type, [values] },
  }
  ```
- **Determinism**: Same input → same FeedProfile. No randomness in convergence mode.
- **Anti-cheating**: Classifier receives only normalized `{timestamp, value, metadata}` tuples with source identity stripped. No URL sniffing, field name matching, or hardcoded mappings to known feeds.

### 4.3 Phase 2 — Template Selector

**F-10: Selection Rules** (`src/selector/rules.js`)
- Explicit decision tree mapping FeedProfile properties to Theatre template recommendations
- Every rule must follow the enforced schema:
  ```js
  {
    id: "rule_001",
    conditions: [
      { field: "noise.classification", operator: "equals", value: "spike_driven" },
      ...
    ],
    output: {
      template: "threshold_gate",
      params: { threshold, window_hours, base_rate }
    },
    confidence: "conditions_satisfied / conditions_total",
    traced_to: "TREMOR MagGate, CORONA FlareGate"
  }
  ```
- No inline logic, no hidden branches, no anonymous rules
- Every rule cites the backing construct it generalizes via `traced_to`
- Confidence is mechanical: (conditions satisfied) / (total conditions)

**F-11: Template Selector** (`src/selector/template-selector.js`)
- Runs all rules against a FeedProfile, produces ranked proposals with confidence and rationale
- Tie-breaking (deterministic):
  1. Higher confidence wins
  2. More specific rule (greater condition count) wins
  3. Higher backing-construct frequency in `traced_to` wins
  4. Lexical rule ID as final tiebreak
- False positive penalty: −0.5 per proposed template not in backing spec

**F-12: Structured Logging** (required for every classify → select cycle)
```js
{
  iteration: N,
  feed: 'fixture_name',
  feed_profile: { /* full FeedProfile */ },
  rules_evaluated: [
    { id, conditions_met, conditions_total, fired: true },
    { id, conditions_met, conditions_total, fired: false, failed_condition: '...' },
  ],
  proposals: [ /* ranked template proposals */ ],
  score: { template_score, grammar_score, total },
  delta: +/-N,
  decision: 'keep' | 'discard'
}
```

### 4.4 Phase 3 — Generalized Infrastructure

**F-13: Theatre Templates** (6 files in `src/theatres/`)
- `threshold-gate.js` — binary: will value exceed X within Z hours? Generalized from TREMOR MagGate, CORONA FlareGate/GeomagGate, BREATH AQI Gate
- `cascade.js` — multi-class (5 buckets): following trigger, how many qualifying sub-events? Generalized from TREMOR Aftershock, CORONA ProtonCascade, BREATH WildfireCascade
- `divergence.js` — binary: will two measurements disagree beyond threshold? Generalized from TREMOR OracleDivergence, CORONA SolarWindDivergence, BREATH SensorDivergence
- `regime-shift.js` — binary: will system transition from state A to B? Generalized from TREMOR DepthRegime
- `persistence.js` — binary: will condition X persist for N consecutive periods? Extracted from BREATH auto-spawn + CORONA sustained Kp patterns
- `anomaly.js` — binary: will statistically anomalous reading occur? Generalized from TREMOR SwarmWatch (b-value)

**F-14: Generalized Processor Pipeline**
- `quality.js` — generalized quality scoring (from TREMOR/CORONA/BREATH processor patterns)
- `uncertainty.js` — generalized doubt pricing
- `settlement.js` — generalized settlement logic (T0/T1 settlement authority, T2/T3 signal only)
- `bundles.js` — generalized evidence bundle construction

**F-15: Oracle Trust Model**
- `oracle-trust.js` — T0-T3 trust tiers:

| Tier | Role | Settles? |
|------|------|----------|
| T0 | Settlement authority | Yes |
| T1 | Official source | Yes (Brier discount) |
| T2 | Corroboration | No (evidence only) |
| T3 | Signal | No (position update only) |

- T3 may promote to T2 via: min observation count + uptime % + neighborhood agreement + anti-spoof checks. Never to T0/T1 without human override.
- **Critical**: PurpleAir = T3. AirNow = T1. If FORGE proposes PurpleAir can settle a theatre, the trust model is broken.

**F-16: Adversarial Detection** (`src/trust/adversarial.js`)
- Required for any T2/T3 source
- Detects and mitigates: location spoofing, value manipulation, replayed/frozen data, clock drift, mirrored feeds, Sybil sensors
- PurpleAir channel A/B consistency is the design template

**F-17: Economic Usefulness Filter** (`src/filter/usefulness.js`)
- Formula (equal weights, iterate):
  ```
  usefulness = population_impact × regulatory_relevance × predictability × actionability
  ```
- Each factor 0-1. Not optimized prematurely — this needs real-world iteration.

**F-18: Cross-Feed Composition** (`src/composer/compose.js`)
- Handles composed feeds (e.g., PurpleAir + wind direction for smoke plume detection)
- Temporal alignment and causal ordering between feeds

**F-19: RLMF Certificates** (`src/rlmf/certificates.js`)
- Same schema as TREMOR/CORONA/BREATH certificates (pipeline compatibility)

**F-20: ForgeConstruct Entrypoint** (`src/index.js`)
- Exposes `ForgeConstruct` class following the established construct pattern: Oracle → Processor → Theatre → RLMF

---

## 5. Scoring System

> *Sources: FORGE_PROGRAM.md (The metric)*

### TemplateScore (per expected template)
```
template_match: +1 if correct template proposed, 0 if missing
param_field_score (per required param): +1 if matches backing spec, 0 if not
template_score = template_match × (0.5 + 0.5 × mean(param_field_scores))
false_positive: -0.5 per proposed template not in backing spec
```

### Required param fields per template type (always scored)
| Template | Required params |
|----------|----------------|
| threshold_gate | threshold, window_hours, base_rate |
| cascade | trigger_threshold, bucket_count, window_hours |
| divergence | source_a_type, source_b_type, divergence_threshold |
| regime_shift | state_boundary, zone_prior |
| anomaly | baseline_metric, sigma_threshold, window_hours |
| persistence | condition_threshold, consecutive_count |

### Context params (scored when present in backing spec)
- threshold_gate: settlement_source, input_mode, threshold_type
- cascade: prior_model
- divergence: resolution_mode

### GrammarScore
- +1 per correct Q classification matching backing spec
- Max: 3 specs × 5 questions = 15 points

### TotalScore
```
TotalScore = TemplateScore + (0.5 × GrammarScore)
Max = 13.0 + 7.5 = 20.5
```

### Duplicate matching
When multiple expected templates share the same type, proposals are matched by maximum param field overlap. Greedy matching: highest-overlap pair first. Each proposal assigned to at most one expected template.

---

## 6. Convergence Loop Protocol

> *Sources: FORGE_PROGRAM.md (The loop, Keep/discard rule)*

### Keep/discard rule
**Keep (git commit)** if ANY of:
- TotalScore increased
- TotalScore unchanged BUT structured logs show strictly better decomposition (fewer false positives, or better grammar alignment)
- Change is `[exploratory]` in commit message (max 1 per 10 iterations)

**Discard (git revert)** if:
- TotalScore decreased AND none of the above apply

### One change per iteration
- One modification to one classifier question OR one selector rule
- Test, keep or discard, repeat
- Do not batch changes

---

## 7. Technical Constraints

> *Sources: FORGE_PROGRAM.md (Constraints, Other constraints)*

| Constraint | Requirement |
|-----------|-------------|
| Dependencies | Zero external. Node.js 20+ only (built-in `fetch`, `node:test`) |
| Test runner | `node --test` |
| Determinism | Same input → same FeedProfile → same proposals → same score. Every time. No randomness, sampling, or non-seeded heuristics in convergence mode. |
| Anti-cheating | Classifier MUST NOT use source identity. Anonymized fixture mode must pass. |
| Rule schema | Enforced structure with id, conditions, output, confidence, traced_to |
| Structured logging | Every classify → select cycle must produce full structured log |
| Threshold changes | Must be justified in structured log and pass keep/discard rule |
| RLMF schema | Same as TREMOR/CORONA/BREATH for pipeline compatibility |

---

## 8. Convergence Targets (Backing Specifications)

> *Sources: FORGE_PROGRAM.md (Backing specification)*

### TREMOR (USGS seismic)

Expected FeedProfile:
```js
{
  cadence: { classification: 'event_driven', median_ms: ~60000 },
  distribution: { type: 'unbounded_numeric' },
  noise: { classification: 'spike_driven' },
  density: { classification: 'sparse_network' },
  thresholds: { type: 'statistical' },
}
```

Expected proposals (5 templates):
| Template | Key params |
|----------|-----------|
| threshold_gate | threshold: M5.0, window: 24h |
| cascade | trigger: M6.0+, buckets: 5, window: 72h |
| divergence | source_a: automatic, source_b: reviewed |
| anomaly | b-value deviation, window: 7d |
| regime_shift | shallow vs deep, zone prior |

### CORONA (NOAA SWPC + NASA DONKI)

Expected FeedProfile:
```js
{
  cadence: { classification: 'multi_cadence', streams: ['1min', '3hr', '5min', 'event'] },
  distribution: { type: 'composite', sub_types: ['bounded_numeric', 'categorical'] },
  noise: { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density: { classification: 'single_point' },
  thresholds: { type: 'regulatory', values: ['G1-G5', 'S1-S5', 'R1-R5'] },
}
```

Expected proposals (5 templates):
| Template | Key params |
|----------|-----------|
| threshold_gate | flare class ≥M1.0, window: 24h |
| threshold_gate | Kp ≥5, window: 72h, multi-input |
| threshold_gate | CME arrival ±6h |
| cascade | trigger: M5+ flare, buckets: 5, window: 72h |
| divergence | Bz volatility streak |

### BREATH (PurpleAir + AirNow)

Expected FeedProfile:
```js
{
  cadence: { classification: 'multi_cadence', streams: ['120s', '60min'] },
  distribution: { type: 'bounded_numeric', bounds: [0, 500] },
  noise: { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density: { classification: 'multi_tier', tiers: ['dense', 'sparse'] },
  thresholds: { type: 'regulatory', values: [51, 101, 151, 201, 301] },
}
```

Expected proposals (3 templates):
| Template | Key params |
|----------|-----------|
| threshold_gate | AQI ≥151, window: 24h, settlement: AirNow |
| divergence | sensor A vs sensor B, consecutive: 3 |
| cascade | trigger: AQI ≥200, metric: sensor fraction, buckets: 5, window: 72h |

---

## 9. Novel Validation (Post-Convergence)

> *Sources: FORGE_PROGRAM.md (Beyond convergence)*

### Loop 4 — Novel feed (ThingSpeak temperature)
- Single sensor, hourly, bounded -40 to 60°C, no regulatory thresholds
- Expected: `{ cadence: 'hours', distribution: 'bounded_numeric', noise: 'cyclical', density: 'single_point', thresholds: 'statistical' }`
- Expected proposals: threshold_gate at historical extremes, regime_shift at seasonal transitions
- Expected usefulness score: lower than PurpleAir (no regulatory/population significance)

### Loop 5 — Feed composition (PurpleAir + wind direction)
- Expected proposal: smoke plume arrival theatre (binary: will AQI exceed 200 at downwind location within 12h?)
- Neither feed alone generates this — requires temporal alignment and causal ordering
- This is the factory proof: FORGE composing feeds to produce novel theatres

---

## 10. Scope

### In Scope (MVP)

1. **Phase 0**: Scaffolding (replay, ingester, test harness) — prerequisite for loop
2. **Phase 1**: Five-question classifier (Q1-Q5 + orchestrator) — primary loop target
3. **Phase 2**: Selector (rules + template-selector) — convergence to 13/13
4. **Phase 3**: Generalized infrastructure (theatres, processors, trust, RLMF, composer, entrypoint) — post-convergence

### Out of Scope (Phase 1 MVP)

- Live feed polling (replay module sufficient for convergence)
- Frontend or admin UI
- Smart contract integration
- Production deployment / horizontal scaling
- ThingSpeak API integration (Loop 4 uses fixture, not live feed)
- Automatic feed discovery / crawling

### Open Questions (do not prematurely solve)

1. **Composite feed classification**: classify the composite (AQI) or classify sub-feeds (PM2.5, O3) and compose?
2. **Automatic vs declared composition**: does FORGE detect cross-feed correlations automatically, or does a human declare the composition graph?
3. **Economic usefulness weights**: start with equal weights, iterate after real-world data
4. **Multi-input theatres**: how does the selector express "this theatre needs inputs from multiple classified feeds"?

---

## 11. Risks & Dependencies

> *Sources: FORGE_PROGRAM.md (Anti-cheating, Convergence is necessary but not sufficient)*

| Risk | Severity | Mitigation |
|------|----------|------------|
| Classifier uses source identity (cheating) | Critical | Anonymized fixture mode is mandatory gating test |
| Convergence on raw but not anonymized | High | Run both modes every iteration from day one |
| False positives reducing score | High | Track false_positives in structured log; tighten rules iteratively |
| Q classification ambiguity (edge cases between two classifications) | Medium | Measurable numeric thresholds defined in spec; log boundary cases |
| Determinism violation (non-seeded heuristics) | High | No randomness in convergence mode; enforce in test harness |
| Selector rule explosion (too many rules) | Medium | Traced_to field enforces each rule is grounded in a real construct |
| Phase 3 divergence from construct patterns | Medium | Extract directly from proven TREMOR/CORONA/BREATH implementations |
| TotalScore plateau (diminishing returns) | Low | Use exploratory commits (max 1 per 10 iterations) to escape local optima |

**Critical dependency**: The fixtures in `fixtures/` are FIXED. The agent modifies classifier and selector code only. Never modify fixtures, test assertions, or backing spec definitions.

---

## 12. File Structure

> *Sources: FORGE_PROGRAM.md (The files)*

```
prepare (FIXED — do not modify)
├── fixtures/usgs-m4.5-day.json
├── fixtures/swpc-goes-xray.json
├── fixtures/donki-flr-cme.json
├── fixtures/purpleair-sf-bay.json
├── fixtures/airnow-sf-bay.json
├── test/convergence/tremor.spec.js
├── test/convergence/corona.spec.js
├── test/convergence/breath.spec.js
└── grimoires/pub/*                    (backing spec reference)

code (AGENT MODIFIES)
├── src/classifier/feed-grammar.js
├── src/classifier/cadence.js
├── src/classifier/distribution.js
├── src/classifier/noise.js
├── src/classifier/density.js
├── src/classifier/thresholds.js
├── src/selector/template-selector.js
└── src/selector/rules.js

infrastructure (BUILD ONCE, then fixed)
├── src/ingester/generic.js
├── src/ingester/rate-limiter.js
├── src/replay/deterministic.js
├── src/processor/quality.js
├── src/processor/uncertainty.js
├── src/processor/settlement.js
├── src/processor/bundles.js
├── src/theatres/threshold-gate.js
├── src/theatres/cascade.js
├── src/theatres/divergence.js
├── src/theatres/regime-shift.js
├── src/theatres/persistence.js
├── src/theatres/anomaly.js
├── src/trust/oracle-trust.js
├── src/trust/adversarial.js
├── src/filter/usefulness.js
├── src/composer/compose.js
├── src/rlmf/certificates.js
└── src/index.js
```
