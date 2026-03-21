# FORGE

**Feed-Adaptive Oracle & Runtime Generator**

FORGE takes any live data feed, characterizes its statistical properties, and proposes the right Echelon Theatre templates. Domain expertise encoded once, applied everywhere.

> The Uniswap factory for prediction surfaces.

---

## Quick Start

```js
import { ForgeConstruct } from './src/index.js';

const forge = new ForgeConstruct();
const result = await forge.analyze('fixtures/usgs-m4.5-day.json');

console.log(result.proposals);
// [
//   { template: 'threshold_gate', params: { threshold: 4.5, window_hours: 24 }, confidence: 0.9 },
//   { template: 'cascade',        params: { trigger_threshold: 6.0, ... },      confidence: 0.85 },
//   ...
// ]

console.log(result.log);
// { fixture: '...', event_count: 18, proposals_count: 5, templates_proposed: [...] }
```

## Pipeline

```
fixture file
    │
    ▼
ingestFile()          — parse JSON feed into normalized events
    │
    ▼
classify()            — characterize statistical properties → FeedProfile
    │  cadence · distribution · noise · density · thresholds
    ▼
selectTemplates()     — match profile against rules → Proposals
    │
    ▼
{ feed_profile, proposals, log }
```

## Requirements

- Node.js ≥ 20
- Zero external dependencies

## Installation

```bash
git clone <repo>
cd forge
# No npm install needed — zero deps
```

## Tests

```bash
# Unit tests (503 tests)
npm run test:unit

# Convergence tests — TREMOR, CORONA, BREATH backing specs
npm test

# Everything
npm run test:all
```

## Modules

| Module | Description |
|--------|-------------|
| `src/index.js` | `ForgeConstruct` entrypoint + all granular exports |
| `src/ingester/` | Feed ingestion — JSON fixture → normalized event array |
| `src/classifier/` | Feed grammar — cadence, distribution, noise, density, thresholds |
| `src/selector/` | Template selection rules |
| `src/processor/` | EvidenceBundle assembly, quality scoring, doubt pricing |
| `src/trust/` | Oracle trust tiers (T0–T3), adversarial detection |
| `src/rlmf/` | Brier scoring, RLMF certificate export |
| `src/filter/` | Economic usefulness scoring |
| `src/composer/` | Temporal feed alignment and causal ordering |
| `src/replay/` | Deterministic replay for convergence testing |

## Granular Exports

Every sub-module is exported individually for testing, debugging, and the convergence loop:

```js
import {
  // Ingester
  ingest, ingestFile,

  // Classifier
  classify, classifyCadence, classifyDistribution,
  classifyNoise, classifyDensity, classifyThresholds,

  // Selector
  selectTemplates, evaluateRule, RULES,

  // Processor
  buildBundle, computeQuality, computeDoubtPrice,
  assignEvidenceClass, canSettleByClass,

  // Trust
  getTrustTier, canSettle, validateSettlement,
  checkAdversarial, checkChannelConsistency,

  // RLMF
  exportCertificate, brierScoreBinary, brierScoreMultiClass,

  // Filter
  computeUsefulness,

  // Composer
  alignFeeds, detectCausalOrdering,

  // Replay
  createReplay,
} from './src/index.js';
```

## Trust Tiers

| Tier | Sources | Can Settle? |
|------|---------|-------------|
| T0 | EPA AQS, USGS (reviewed), GFZ Kp | ✅ Yes |
| T1 | AirNow, USGS (automatic), SWPC/NOAA GOES | ✅ Yes (with Brier discount) |
| T2 | OpenAQ, EMSC | ❌ Corroboration only |
| T3 | PurpleAir, ThingSpeak | ❌ Signal only — never settles |

## RLMF Certificates

After a theatre resolves, export a training certificate:

```js
import { exportCertificate, brierScoreBinary } from './src/index.js';

const cert = exportCertificate(theatre, { theatre_id: 'th-001' });
// {
//   theatre_id: 'th-001',
//   template: 'threshold_gate',
//   brier_score: 0.04,       // (0.8 - 1)² — lower is better
//   outcome: true,
//   final_probability: 0.8,
//   position_history: [...],
//   ...
// }
```

## Economic Usefulness

Score a proposal's economic viability before deployment:

```js
import { computeUsefulness } from './src/index.js';

const score = computeUsefulness(proposal, feedProfile, { source_tier: 'T1' });
// 0–1: population_impact × regulatory_relevance × predictability × actionability
```

## Backing Specs

Convergence is validated against three real-world constructs:

| Spec | Domain | Fixtures |
|------|--------|----------|
| TREMOR | USGS seismic | `fixtures/usgs-m4.5-day.json` |
| CORONA | NOAA/NASA space weather | `fixtures/swpc-goes-xray.json`, `fixtures/donki-flr-cme.json` |
| BREATH | PurpleAir/AirNow air quality | `fixtures/purpleair-sf-bay.json`, `fixtures/airnow-sf-bay.json` |

**Target**: 20.5/20.5 TotalScore (13.0 TemplateScore + 7.5 GrammarScore) on raw and anonymized fixtures.
