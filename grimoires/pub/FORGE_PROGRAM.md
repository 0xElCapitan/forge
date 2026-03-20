# FORGE — program.md

> The human iterates on this file. The agent iterates on the code.
> The metric is convergence. The loop runs until all three backing specs converge under both raw and anonymized fixture evaluation.

## Identity

FORGE — Feed-Adaptive Oracle & Runtime Generator for Echelon.
The Uniswap factory for prediction surfaces. Point it at any live data feed → it characterizes the data → selects Theatre templates → deploys. FORGE proposes deployable Theatre surfaces; downstream usefulness filters and market participation determine whether they should run.

## The metric

Two scores, computed together. The agent needs a gradient, not just pass/fail.

### TemplateScore (per expected template)

Score each expected template by matching the proposal, then scoring params field-by-field:

```
template_match:
  +1 if correct template proposed
   0 if expected template missing (false negative)

param_field_score (per required param):
  +1 if field value matches backing spec
   0 if field value does not match

template_score = template_match × (0.5 + 0.5 × mean(param_field_scores))
```

This means: correct template with all params right = 1.0. Correct template with no params right = 0.5. Missing template = 0. False positives (proposed template not in backing spec) = -0.5 each.

TREMOR has 5 templates. CORONA has 5. BREATH has 3. Max TemplateScore = 13.0.

**Duplicate template matching**: When multiple expected templates share the same template type (e.g., CORONA has three threshold_gates), proposals are matched to expected templates by maximum param field overlap. Each proposal may be assigned to at most one expected template. Use greedy matching: highest-overlap pair first, then next highest, etc.

**Required param fields per template type (core — always scored):**
- threshold_gate: `threshold`, `window_hours`, `base_rate`
- cascade: `trigger_threshold`, `bucket_count`, `window_hours`
- divergence: `source_a_type`, `source_b_type`, `divergence_threshold`
- regime_shift: `state_boundary`, `zone_prior`
- anomaly: `baseline_metric`, `sigma_threshold`, `window_hours`
- persistence: `condition_threshold`, `consecutive_count`

**Context param fields (scored when present in the backing spec):**
- threshold_gate: `settlement_source`, `input_mode` (single/multi), `threshold_type` (regulatory/physical/statistical)
- cascade: `prior_model` (omori/wheatland/uniform)
- divergence: `resolution_mode` (self-resolving/expiry)

Context params use the same field scoring formula. They expand `mean(param_field_scores)` when present — a proposal that matches core params but misses context params scores lower than one that matches both.

### GrammarScore (per backing spec)

```
+1  per correct Q classification (Q1-Q5 match backing spec)
```

Three backing specs × 5 questions = max GrammarScore = 15.

### TotalScore

```
TotalScore = TemplateScore + (0.5 × GrammarScore)
Max = 13.0 + 7.5 = 20.5
```

GrammarScore is weighted lower because correct classification is a means to correct template selection — but it provides signal when templates are wrong (was it the classifier or the selector that failed?).

### Per-experiment report

Every loop iteration must output:

```js
{
  iteration: 42,
  feed: 'tremor',
  grammar_score: { Q1: 'match', Q2: 'match', Q3: 'mismatch', Q4: 'match', Q5: 'match' },
  template_score: [
    { expected: 'threshold_gate', proposed: 'threshold_gate', params_match: 'partial', score: 0.5 },
    { expected: 'cascade', proposed: 'cascade', params_match: 'exact', score: 1.0 },
    { expected: 'divergence', proposed: null, score: 0 },       // false negative
    { expected: 'anomaly', proposed: 'anomaly', params_match: 'exact', score: 1.0 },
    { expected: 'regime_shift', proposed: null, score: 0 },     // false negative
  ],
  false_positives: ['persistence'],                              // -0.5
  total: 2.0,
  rule_matches: ['rule_001', 'rule_003', 'rule_007'],
  rejected_rules: ['rule_002 (failed: noise != cyclical)', 'rule_005 (failed: density != dense)'],
  delta: +0.5,    // vs previous iteration
  decision: 'keep' // score improved
}
```

**Keep/discard rule**:

Keep (git commit) if ANY of:
- TotalScore increased
- TotalScore unchanged BUT structured logs show strictly better decomposition (fewer false positives at same score, or same proposals with better grammar alignment)
- Change is explicitly marked `[exploratory]` in commit message (max 1 per 10 iterations — controlled exploration, not random noise)

Discard (git revert) if:
- TotalScore decreased AND none of the above apply

One change per iteration so you know exactly what helped or hurt.

## The files

```
prepare (FIXED — do not modify)
├── fixtures/usgs-m4.5-day.json         # TREMOR convergence input
├── fixtures/swpc-goes-xray.json        # CORONA convergence input (SWPC)
├── fixtures/donki-flr-cme.json         # CORONA convergence input (DONKI)
├── fixtures/purpleair-sf-bay.json      # BREATH convergence input (PurpleAir)
├── fixtures/airnow-sf-bay.json         # BREATH convergence input (AirNow)
├── test/convergence/tremor.spec.js     # Assertions: FORGE output == TREMOR theatres
├── test/convergence/corona.spec.js     # Assertions: FORGE output == CORONA theatres
├── test/convergence/breath.spec.js     # Assertions: FORGE output == BREATH theatres
└── grimoires/pub/*                     # All backing spec reference files

code (AGENT MODIFIES)
├── src/classifier/feed-grammar.js      # The five-question classifier
├── src/classifier/cadence.js           # Q1
├── src/classifier/distribution.js      # Q2
├── src/classifier/noise.js             # Q3
├── src/classifier/density.js           # Q4
├── src/classifier/thresholds.js        # Q5
├── src/selector/template-selector.js   # FeedProfile → Theatre proposals
└── src/selector/rules.js               # Explicit selection rules (decision tree)

infrastructure (BUILD ONCE, then fixed)
├── src/ingester/generic.js             # Feed ingester (JSON, GeoJSON, CSV, XML)
├── src/ingester/rate-limiter.js        # Per-source rate limiting
├── src/replay/deterministic.js         # Archived feed replay for the loop
├── src/processor/quality.js            # Generalized quality scoring
├── src/processor/uncertainty.js        # Generalized doubt pricing
├── src/processor/settlement.js         # Generalized settlement logic
├── src/processor/bundles.js            # Generalized evidence bundles
├── src/theatres/threshold-gate.js      # Template 1
├── src/theatres/cascade.js             # Template 2
├── src/theatres/divergence.js          # Template 3
├── src/theatres/regime-shift.js        # Template 4
├── src/theatres/persistence.js         # Template 5
├── src/theatres/anomaly.js             # Template 6
├── src/trust/oracle-trust.js           # T0-T3 trust tiers
├── src/trust/adversarial.js            # Anti-gaming
├── src/filter/usefulness.js            # Economic usefulness scoring
├── src/composer/compose.js             # Cross-feed composition
├── src/rlmf/certificates.js            # Same schema as TREMOR/CORONA/BREATH
└── src/index.js                        # ForgeConstruct entrypoint
```

## The loop

```bash
while true; do
  # 1. Agent modifies classifier and/or selector
  # 2. Run convergence tests
  node --test test/convergence/tremor.spec.js
  node --test test/convergence/corona.spec.js
  node --test test/convergence/breath.spec.js
  # 3. If score improved → git commit → continue
  # 4. If score unchanged or regressed → git revert → try different approach
done
```

Each iteration should be small. One change to one classifier question, or one selector rule. Test. Keep or discard. Repeat. Do not batch changes — one modification per loop so you know exactly what helped or hurt.

## Build order

The loop cannot run until the infrastructure exists. Build in this order:

### Phase 0: Scaffolding (build once)
1. **Replay module** — `src/replay/deterministic.js`. Takes a fixture JSON file, replays it as if it were a live feed. Without this, the loop can't run.
2. **Feed ingester** — `src/ingester/generic.js`. Normalizes raw feed data into `{timestamp, value, metadata}` tuples. Must handle USGS GeoJSON, SWPC JSON, PurpleAir JSON, AirNow JSON.
3. **Convergence test harness** — `test/convergence/*.spec.js`. Three files, each loads a fixture, runs classify → select, asserts against the backing spec. These are the assertions the loop validates.

### Phase 1: Classifier (the main loop)
4. **Q1 Cadence** — `src/classifier/cadence.js`. Compute median timestamp delta, jitter coefficient, classify as seconds/minutes/hours/days/event_driven/multi_cadence.
5. **Q2 Distribution** — `src/classifier/distribution.js`. Compute bounds, percentiles, detect breakpoints, classify as bounded_numeric/unbounded_numeric/categorical/composite.
6. **Q3 Noise** — `src/classifier/noise.js`. Autocorrelation, spike rate, cycle period detection. Classify as spike_driven/cyclical/trending/stable_with_drift/mixed.
7. **Q4 Density** — `src/classifier/density.js`. Count sensors, detect co-located pairs, count tiers. Classify as single_point/sparse_network/dense_network/multi_tier.
8. **Q5 Thresholds** — `src/classifier/thresholds.js`. Histogram clustering, regulatory table lookup (if configured), classify as regulatory/physical/statistical/none.
9. **Feed grammar orchestrator** — `src/classifier/feed-grammar.js`. Runs Q1-Q5, produces a FeedProfile. This is the primary file the agent iterates on.

**Run the loop after each Q is built.** Partial convergence is expected — Q1 alone won't produce full template matches, but it will validate cadence classification against the three backing specs. Each new Q should increase the convergence score.

### Phase 2: Selector (second loop target)
10. **Selection rules** — `src/selector/rules.js`. Explicit decision tree mapping FeedProfile properties to Theatre template recommendations. Every rule must cite which backing construct it generalizes.
11. **Template selector** — `src/selector/template-selector.js`. Runs rules, produces ranked proposals with confidence and rationale.

**Run the loop again.** This is where convergence should approach 13/13. If it doesn't, the gap is diagnostic — which templates are missed? Which are wrongly proposed? Fix the specific rule and loop.

### Phase 3: Infrastructure (after convergence)
12. Generalized theatre templates (6 files) — extract from the 13 implementations in TREMOR/CORONA/BREATH.
13. Generalized processor pipeline (quality, uncertainty, settlement, bundles).
14. Oracle trust model + adversarial detection.
15. RLMF certificates (same schema).
16. Economic usefulness filter.
17. Composition layer.
18. ForgeConstruct entrypoint.

Phase 3 doesn't need the autoresearch loop — it follows the standard Loa `/build` → `/review` → `/ship` workflow because the patterns are already proven in the three constructs. The novel work (classifier + selector) is what the loop is for.

## Backing specification: the three convergence targets

### TREMOR — what FORGE should discover from USGS data

**Expected FeedProfile:**
```js
{
  cadence: { classification: 'event_driven', median_ms: ~60000 },
  distribution: { type: 'unbounded_numeric' },
  noise: { classification: 'spike_driven' },
  density: { classification: 'sparse_network' },
  thresholds: { type: 'statistical' },
}
```

**Expected Theatre proposals:**
| Template | Params | Why |
|----------|--------|-----|
| threshold_gate | threshold: M5.0, window: 24h | Unbounded numeric + spike driven + statistical thresholds |
| cascade | trigger: M6.0+, buckets: 5, window: 72h | Spike events produce aftershock sequences |
| divergence | source_a: automatic, source_b: reviewed | Same event has two measurements (revision history) |
| anomaly | b-value deviation, window: 7d | Statistical baseline with detectable anomalies (swarm) |
| regime_shift | shallow vs deep, zone prior | Bimodal depth distribution in subduction zones |

### CORONA — what FORGE should discover from SWPC + DONKI data

**Expected FeedProfile:**
```js
{
  cadence: { classification: 'multi_cadence', streams: ['1min', '3hr', '5min', 'event'] },
  distribution: { type: 'composite', sub_types: ['bounded_numeric', 'categorical'] },
  noise: { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density: { classification: 'single_point' },
  thresholds: { type: 'regulatory', values: ['G1-G5', 'S1-S5', 'R1-R5'] },
}
```

**Expected Theatre proposals:**
| Template | Params | Why |
|----------|--------|-----|
| threshold_gate | flare class ≥M1.0, window: 24h | Categorical + regulatory thresholds |
| threshold_gate | Kp ≥5, window: 72h, multi-input | Bounded numeric + regulatory + multi-source |
| threshold_gate | CME arrival ±6h | Binary arrival prediction |
| cascade | trigger: M5+ flare, buckets: 5, window: 72h | Spike trigger → proton event sequence |
| divergence | Bz volatility streak | Single-point instrument, temporal divergence |

### BREATH — what FORGE should discover from PurpleAir + AirNow data

**Expected FeedProfile:**
```js
{
  cadence: { classification: 'multi_cadence', streams: ['120s', '60min'] },
  distribution: { type: 'bounded_numeric', bounds: [0, 500] },
  noise: { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density: { classification: 'multi_tier', tiers: ['dense', 'sparse'] },
  thresholds: { type: 'regulatory', values: [51, 101, 151, 201, 301] },
}
```

**Expected Theatre proposals:**
| Template | Params | Why |
|----------|--------|-----|
| threshold_gate | AQI ≥151, window: 24h, settlement: AirNow | Bounded + regulatory breakpoints + dual-tier trust |
| divergence | sensor A vs sensor B, consecutive: 3 | Dense network → co-located sensor pairs |
| cascade | trigger: AQI ≥200, metric: sensor fraction, buckets: 5, window: 72h | Dense network + wildfire spike events |

**Critical check:** If FORGE proposes that PurpleAir can settle a theatre, the oracle trust model is broken. PurpleAir = T3 signal. AirNow = T1 official. Only T0/T1 sources settle.

## Beyond convergence: the novel tests

Once loops 1-3 converge (13/13), run these to validate generalization:

### Loop 4 — Novel feed (ThingSpeak temperature)
Feed: a public ThingSpeak temperature channel (hourly, single sensor, -40 to 60°C, no regulatory thresholds).

**Expected classification:** `{ cadence: 'hours', distribution: 'bounded_numeric', noise: 'cyclical', density: 'single_point', thresholds: 'statistical' }`

**Expected proposals:** Threshold gate at historical extremes, regime-shift at seasonal transitions.

**Expected usefulness score:** Lower than PurpleAir. One backyard sensor has no regulatory, economic, or population significance.

### Loop 5 — Feed composition
Feed: PurpleAir + wind direction simultaneously.

**Expected proposal:** Smoke plume arrival theatre (binary: will AQI exceed 200 at downwind location within 12h given active fire?). Neither feed alone would generate this — it requires temporal alignment and causal ordering (wind carries smoke from source to sensor).

If FORGE can do 1-3, it's validated. If 4, it generalizes. If 5, it's the factory.

**Convergence is necessary but not sufficient for deployment.** Convergence proves the classifier and selector work on known data. Deployment requires additionally passing: Loop 4 (novel feed generalization), Loop 5 (composition), anti-cheating validation (anonymized fixture mode), and usefulness filter calibration. Do not declare victory at 13/13 on raw fixtures alone.

## Platform context

Echelon runs structured prediction markets called Theatres. Each Theatre commits parameters at creation (locked cryptographically), ingests real-world data as timestamped evidence bundles via an OSINT pipeline, uses a Paradox Engine to penalize positions diverging from observable reality, and exports Brier-scored training data via RLMF. Constructs are autonomous agents inside Theatres with verifiable on-chain P&L.

## Theatre template library

Six generalized templates the selector chooses from. Extracted from 13 implementations across three constructs.

**1. Threshold Gate** (binary) — Will value exceed X within Z hours? Traced to: TREMOR MagGate, CORONA FlareGate/GeomagGate, BREATH AQI Gate.

**2. Cascade** (multi-class, 5 buckets) — Following trigger, how many qualifying sub-events? Traced to: TREMOR Aftershock, CORONA ProtonCascade, BREATH WildfireCascade.

**3. Divergence** (binary, Paradox Engine native) — Will two measurements disagree beyond threshold? Traced to: TREMOR OracleDivergence, CORONA SolarWindDivergence, BREATH SensorDivergence.

**4. Regime Shift** (binary) — Will system transition from state A to B? Traced to: TREMOR DepthRegime, CORONA GeomagGate (quiet→storm).

**5. Persistence** (binary) — Will condition X persist for N consecutive periods? Extracted from BREATH auto-spawn + CORONA sustained Kp patterns.

**6. Anomaly** (binary) — Will statistically anomalous reading occur? Generalized from TREMOR SwarmWatch (b-value).

## Oracle trust tiers

| Tier | Role | Settles? | Example |
|------|------|----------|---------|
| T0 | Settlement authority | Yes | EPA AQS, USGS reviewed, GFZ Kp |
| T1 | Official source | Yes (Brier discount) | AirNow, USGS automatic, SWPC GOES |
| T2 | Corroboration | No (evidence only) | OpenAQ, EMSC |
| T3 | Signal | No (position update only) | PurpleAir, ThingSpeak |

T3 may promote to T2 via: min observation count + uptime % + neighborhood agreement + anti-spoof checks. Never to T0/T1 without human override.

## Adversarial model

Required for any T2/T3 source. Detect and mitigate: location spoofing, value manipulation (purifier/smoke near sensor), replayed/frozen data, clock drift, mirrored feeds, Sybil sensors. PurpleAir channel A/B consistency is the design template.

## Constraints

### Anti-cheating (CRITICAL)

**The classifier MUST NOT use source identity to classify feeds.** This means:
- No URL sniffing ("if earthquake.usgs.gov → output TREMOR templates")
- No field name matching ("if properties.mag exists → seismic")
- No hardcoded mappings to known fixtures
- No source name, domain name, or API path in any classification logic

**All classification must derive from statistical properties of the data stream.** The classifier receives `{timestamp, value, metadata}` tuples where metadata is normalized to remove all source-specific semantics. Metadata may contain: sensor coordinates (if present), sensor count, and generic value labels ("reading_1", "reading_2"). Metadata MUST NOT contain: domain names, source identifiers, API paths, unit names, field names from the original feed, or any string that reveals the data source. The ingester is responsible for this normalization before data reaches the classifier.

**Enforcement**: Every convergence test suite MUST run in two modes:
1. **Raw fixture mode** — original field names, original structure
2. **Anonymized fixture mode** — shuffled field names, stripped source URLs, generic metadata

A classifier is INVALID if it passes raw mode but fails anonymized mode. Both modes must converge for the loop to succeed. The anonymization step is part of the test harness, not the classifier — the classifier never knows which mode it's running in.

### Rule schema (enforced structure)

Every selector rule must follow this schema:

```js
{
  id: "rule_001",
  conditions: [
    { field: "noise.classification", operator: "equals", value: "spike_driven" },
    { field: "distribution.type", operator: "equals", value: "unbounded_numeric" },
    { field: "thresholds.type", operator: "in", value: ["statistical", "physical"] }
  ],
  output: {
    template: "threshold_gate",
    params: {
      threshold: "thresholds.values[percentile_95]",
      window_hours: "cadence.median_ms * 240 / 3600000",
      base_rate: 0.10
    }
  },
  confidence: "conditions_satisfied / conditions_total",
  traced_to: "TREMOR MagGate, CORONA FlareGate"
}
```

No inline logic, no hidden branches, no anonymous rules. Every rule is inspectable and testable in isolation.

### Confidence definition

```
confidence = (number of conditions in the rule that are satisfied by the FeedProfile)
           / (total number of conditions in the rule)
```

A rule with 3 conditions where 2 match produces confidence 0.67. This is mechanical, not vibes. Confidence is testable: given a FeedProfile, the confidence of every rule is deterministic.

**Tie-breaking** (when two or more rules produce the same confidence):
1. Higher confidence wins
2. More specific rule (greater condition count) wins
3. Higher backing-construct frequency in `traced_to` wins (a rule traced to 3 constructs beats one traced to 1)
4. Lexical rule ID as final deterministic tiebreak (`rule_001` < `rule_002`)

### Structured logging (required)

Every classify → select cycle must produce a structured log:

```js
{
  iteration: N,
  feed: 'fixture_name',
  feed_profile: { /* full FeedProfile output */ },
  rules_evaluated: [
    { id: 'rule_001', conditions_met: 3, conditions_total: 3, fired: true },
    { id: 'rule_002', conditions_met: 1, conditions_total: 3, fired: false,
      failed_condition: 'noise.classification != cyclical' },
  ],
  proposals: [ /* ranked template proposals */ ],
  score: { template_score: X, grammar_score: Y, total: Z },
  delta: +/-N,
  decision: 'keep' | 'discard'
}
```

Without this, debugging convergence stalls is guesswork. With it, you can see exactly which rule failed on which condition for which template.

### Feed grammar measurable thresholds

The Q1-Q5 classifications must be defined by measurable numeric criteria, not subjective labels. The starting thresholds below are defaults. Any threshold change (tightening or loosening) must be justified in the structured log and pass the keep/discard rule. Changes to threshold values count as modifications — one per iteration.

**Spike primitive** (used in Q3):
```
spike = observation whose |value - rolling_median(window=20)| > 3 × rolling_MAD(window=20)
spike_rate = spike_count / total_observations
```

**Q1 Cadence**:
```
seconds:       median_delta < 60s
minutes:       60s ≤ median_delta < 3600s
hours:         3600s ≤ median_delta < 86400s
days:          median_delta ≥ 86400s
event_driven:  jitter_coefficient (stdev/median of deltas) > 2.0
multi_cadence: bimodal or multimodal distribution of timestamp deltas
               (two or more peaks in delta histogram separated by > 2× smaller peak)
```

**Q2 Distribution**:
```
bounded_numeric:   observed values stay within stable min/max across ≥90% of window;
                   range = max - min is finite and non-growing
unbounded_numeric: no known fixed upper bound inferable from observed distribution;
                   upper tail remains open under window expansion
                   (operationally: coefficient of max growth across rolling sub-windows
                   exceeds 0.1 AND no stable ceiling detected in top decile)
categorical:       unique_values / total_observations < 0.05
                   AND values are non-continuous (gaps between clusters)
composite:         two or more sub-streams with different distribution types
                   coexist in the same feed (detected via multimodal value histogram)
```

**Q3 Noise profile**:
```
spike_driven:      spike_rate > 0.05 AND lag-1 autocorrelation < 0.3
cyclical:          dominant FFT frequency with spectral power > 2× next peak
                   AND autocorrelation shows periodicity (peak at lag > 1)
trending:          linear regression slope over full window has |t-statistic| > 2.0
stable_with_drift: rolling stdev < 0.1 × rolling mean
                   AND |regression slope t-stat| < 2.0
mixed:             two or more of the above criteria are simultaneously satisfied
```

**Q4 Density**:
```
single_point:   sensor_count = 1 (or no spatial metadata present)
sparse_network: sensor_count > 1 AND mean nearest-neighbor distance > 50km
                (or co_located_pairs / sensor_count < 0.1)
dense_network:  sensor_count > 1 AND mean nearest-neighbor distance ≤ 50km
                (or co_located_pairs / sensor_count ≥ 0.1)
multi_tier:     two or more distinct sensor classes inferred from
                cadence differences, quality distribution, spatial density clustering,
                or normalized trust metadata
                (NOT from source-specific labels — inferred from data properties)
```

**Q5 Thresholds**:
```
regulatory:  feed values cluster at known breakpoint boundaries
             (detected: histogram shows sharp density changes at specific values
             that match a configured regulatory table — EPA AQI, NOAA scales, etc.)
physical:    thresholds correspond to natural phase boundaries
             (detected: bimodal value distribution with clear separation)
statistical: thresholds derived from percentile analysis
             (use: p95, p99, or 3-sigma as candidate gate thresholds)
none:        no stable breakpoint family detected
             (no bimodality, no clustering, no regulatory table match)
```



### Other constraints

- Zero external dependencies. Node.js 20+. node:test runner.
- RLMF certificates use the same schema as TREMOR/CORONA/BREATH.
- All selection rules must cite which backing construct they generalize (the `traced_to` field).
- One change per loop iteration. Test. Keep or discard. Do not batch.
- **Determinism**: All scoring, classification, and rule evaluation must be deterministic for identical input fixtures. No randomness, sampling, or non-seeded heuristics in convergence mode. Same input → same FeedProfile → same proposals → same score. Every time.

## Open questions (flag, don't solve prematurely)

1. **Composite feed classification**: classify the composite (AQI) or classify sub-feeds (PM2.5, O3, etc.) and compose?
2. **Automatic vs declared composition**: does FORGE detect cross-feed correlations automatically, or does a human declare the composition graph?
3. **Economic usefulness heuristic**: Start with this formula, equal weights, iterate:
   ```
   usefulness = population_impact × regulatory_relevance × predictability × actionability
   ```
   Each factor 0-1. `population_impact`: how many people does the geographic coverage affect? `regulatory_relevance`: does the threshold have regulatory or safety significance? `predictability`: is the feed's resolution cadence fast enough to produce meaningful RLMF volume? `actionability`: is there an existing market or decision that depends on this measurement? Weights will be tuned — this is the most valuable IP in FORGE and it needs real-world iteration, not premature optimization.
4. **Multi-input theatres**: CORONA's GeomagGate accepts 4 evidence types. How does the selector express "this theatre needs inputs from multiple classified feeds"?
