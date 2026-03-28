# FORGE

**Feed-Adaptive Oracle & Runtime Generator**

FORGE takes any live data feed, characterizes its statistical properties, and proposes the right Echelon Theatre templates. Domain expertise encoded once, applied everywhere.

> The Uniswap factory for prediction surfaces.

---

## Quick Start

```js
import { ForgeConstruct } from './src/index.js';

const forge = new ForgeConstruct();

// Fixture analysis — returns proposals + IR envelope
const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
  feed_id: 'usgs_m4.5_day',
  source_metadata: { source_id: 'usgs_automatic', trust_tier: 'T1', domain: 'seismic' },
});

console.log(result.envelope);   // Versioned ProposalEnvelope (spec/proposal-ir.json)
console.log(result.proposals);  // Raw proposals array

// With theatre lifecycle — instantiate running theatres from proposals
const live = await forge.analyze('fixtures/usgs-m4.5-day.json', {
  feed_id: 'usgs_m4.5_day',
  instantiate: true,
});

console.log(live.theatre_ids);                    // Created theatre IDs
console.log(forge.getRuntime().getState());       // Runtime state
console.log(forge.getCertificates());             // RLMF certificates after resolution
```

## Pipeline

```
feed (fixture or live)
    │
    ▼
ingestFile() / ingest()     — parse JSON into normalized events
    │
    ▼
classify()                  — characterize statistical properties → FeedProfile
    │  cadence · distribution · noise · density · thresholds
    ▼
selectTemplates()           — match profile against rules → Proposals
    │
    ▼
emitEnvelope()              — versioned ProposalEnvelope (IR spec)
    │
    ▼ (optional)
ForgeRuntime.instantiate()  — proposals → running theatres
    │
    ▼
ingestBundle() → settle()   — evidence processing → RLMF certificates
```

## The Seam

FORGE is data-pure. It owns everything up to the **Proposal IR envelope** — classification, template selection, evidence bundle assembly, theatre lifecycle, and RLMF certificate export.

It does not handle market execution, liquidity, agent logic, or on-chain settlement. Integration with Echelon occurs via the `ProposalEnvelope` contract defined in `spec/proposal-ir.json`. FORGE emits; Echelon's admission gate consumes.

```
FORGE:   feed → classify → propose → emit IR envelope
Echelon: admission gate → instantiation → resolution → RLMF
```

## Requirements

- Node.js ≥ 20
- **Zero external dependencies** — no `npm install` required. Auditable, supply-chain-safe core. Classification is deterministic and side-effect free.

## Installation

```bash
git clone https://github.com/0xElCapitan/forge.git
cd forge
# No npm install needed — zero deps
```

## Tests

```bash
# Unit tests (581 tests)
npm run test:unit

# Convergence tests — TREMOR, CORONA, BREATH backing specs
npm test

# Everything (587 tests)
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
| `src/ir/` | Proposal IR envelope emitter — the Echelon integration boundary |
| `src/runtime/` | ForgeRuntime — theatre lifecycle orchestrator |
| `src/adapter/` | Live feed adapters (USGS seismic) |
| `src/theatres/` | Theatre templates — threshold_gate, cascade, divergence, regime_shift, anomaly, persistence |
| `spec/` | Proposal IR JSON Schema + construct spec |

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
  alignFeeds, detectCausalOrdering, proposeComposedTheatre,

  // Replay
  createReplay,

  // IR
  emitEnvelope,

  // Runtime
  ForgeRuntime,

  // Theatres
  createThresholdGate, processThresholdGate, expireThresholdGate, resolveThresholdGate,
  createCascade, processCascade, expireCascade, resolveCascade,
  createDivergence, processDivergence, expireDivergence, resolveDivergence,
  createRegimeShift, processRegimeShift, expireRegimeShift, resolveRegimeShift,
  createAnomaly, processAnomaly, expireAnomaly, resolveAnomaly,
  createPersistence, processPersistence, expirePersistence, resolvePersistence,

  // Adapter
  USGSLiveAdapter, classifyUSGSFeed,
} from './src/index.js';
```

## Proposal IR

FORGE emits versioned `ProposalEnvelope` objects conforming to `spec/proposal-ir.json`. Each envelope contains the full feed classification, annotated proposals with deterministic `proposal_id` for idempotent dedup, and optional usefulness scores.

```js
import { emitEnvelope } from './src/index.js';

const envelope = emitEnvelope({
  feed_id: 'usgs_m4.5_day',
  feed_profile,
  proposals,
  source_metadata: { source_id: 'usgs_automatic', trust_tier: 'T1', domain: 'seismic' },
  score_usefulness: true,
});

// envelope.ir_version     → '0.1.0'
// envelope.proposals[0].proposal_id → deterministic SHA-256 hash (dedup key)
// envelope.proposals[0].brier_type  → 'binary' | 'multi_class'
// envelope.usefulness_scores        → { '0': 0.82, '1': 0.71, ... }
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

**Target**: 20.5/20.5 TotalScore (13.0 TemplateScore + 7.5 GrammarScore) on raw and anonymized fixtures. ✅ Achieved.

## Golden Envelopes

Real `forge.analyze()` IR output for each backing spec, used by Echelon's bridge tests:

| File | Domain | Proposals |
|------|--------|-----------|
| `fixtures/forge-snapshots-tremor.json` | Seismic | 5 proposals |
| `fixtures/forge-snapshots-corona.json` | Space weather | 5 proposals |
| `fixtures/forge-snapshots-breath.json` | Air quality | 3 proposals |

## License

AGPL-3.0
