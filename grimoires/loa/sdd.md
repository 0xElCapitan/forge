# Software Design Document: FORGE Pre-002 Holding Sprint

**Version:** 1.0
**Date:** 2026-03-27
**Author:** Architecture Designer Agent
**Status:** Draft
**PRD Reference:** grimoires/loa/prd.md

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Software Stack](#2-software-stack)
3. [Data Design](#3-data-design)
4. [Interface Design](#4-interface-design)
5. [API Specifications](#5-api-specifications)
6. [Error Handling Strategy](#6-error-handling-strategy)
7. [Testing Strategy](#7-testing-strategy)
8. [Development Phases](#8-development-phases)
9. [Known Risks and Mitigation](#9-known-risks-and-mitigation)
10. [Open Questions](#10-open-questions)
11. [Appendix](#11-appendix)

---

## 1. Project Architecture

### 1.1 System Overview

FORGE (Feed-Adaptive Oracle & Runtime Generator for Echelon) is a headless Node.js pipeline that classifies arbitrary event streams into 5-dimension feed profiles, selects theatre templates via 13 deterministic rules, and emits a versioned Proposal IR consumed by Echelon's admission gate. An optional runtime layer instantiates theatres from proposals, processes evidence bundles with trust-tiered quality scoring, and exports Brier-scored RLMF certificates.

This sprint does not add new architecture. It subjects the existing Cycle 001 codebase to formal code review, security audit with adversarial red-teaming, and usefulness heuristic iteration. The SDD documents the system **as-built** to ground that work.

### 1.2 Architectural Pattern

**Pattern:** Strict linear pipeline with orthogonal trust enforcement

**Justification:**
- Determinism requirement: identical input must produce identical output across runs
- Zero-dependency constraint: no external runtime libraries, only `node:fs` and `node:crypto`
- Convergence-loop optimization: each pipeline stage is independently testable and scoreable
- Trust enforcement is orthogonal — applied at bundle processing time, not proposal time — so the classification pipeline remains pure

### 1.3 Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FORGE Pipeline                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ Ingester │──▶│Classifier│──▶│ Selector │──▶│ IR Emit  │            │
│  │(generic) │   │(5D gram) │   │(13 rules)│   │(envelope)│            │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘            │
│       │                                              │                  │
│  fixture.json                                   ProposalEnvelope        │
│  → NormalizedEvent[]                            (spec v0.1.0)           │
│                                                      │                  │
│                              ┌────────────────────────┘                 │
│                              ▼                                          │
│                    ┌──────────────────┐                                  │
│                    │  ForgeRuntime    │  (optional: instantiate=true)    │
│                    │  ┌────────────┐  │                                  │
│                    │  │ Theatres   │  │  6 types × 4 lifecycle ops       │
│                    │  └────────────┘  │                                  │
│                    │  ┌────────────┐  │                                  │
│                    │  │  Bundles   │──┤──▶ Trust enforcement             │
│                    │  └────────────┘  │   (oracle-trust + adversarial)   │
│                    │  ┌────────────┐  │                                  │
│                    │  │   RLMF     │  │  Brier-scored certificates       │
│                    │  └────────────┘  │                                  │
│                    └──────────────────┘                                  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Orthogonal Subsystems                                │   │
│  │  Trust Model: oracle-trust.js (T0-T3 registry, settlement gate) │   │
│  │  Argus:       adversarial.js  (6 anti-gaming checks)            │   │
│  │  Usefulness:  usefulness.js   (4-factor economic filter)        │   │
│  │  Composer:    compose.js      (3 cross-feed composition rules)  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.4 System Components

#### Ingester (`src/ingester/generic.js`)
- **Purpose:** Convert raw or anonymized JSON into `NormalizedEvent[]` using structural heuristics
- **Responsibilities:** Shape detection (GeoJSON, array-of-objects, array-of-arrays, combined-object, PurpleAir), timestamp extraction, highest-variance value field selection, coordinate detection, URL redaction
- **Interfaces:** `ingest(rawData)`, `ingestFile(filePath)`
- **Dependencies:** `src/replay/deterministic.js` (for file loading)

#### Classifier (`src/classifier/`)
- **Purpose:** Classify event streams into a 5-dimension FeedProfile
- **Responsibilities:** Q1 cadence, Q2 distribution, Q3 noise, Q4 density, Q5 thresholds
- **Interfaces:** `classify(events)` + 5 individual dimension classifiers
- **Dependencies:** None (pure computation)

#### Selector (`src/selector/`)
- **Purpose:** Match FeedProfile to theatre templates via deterministic rules
- **Responsibilities:** Evaluate 13 rules in order, produce ranked `Proposal[]`
- **Interfaces:** `selectTemplates(feedProfile)`, `evaluateRule(rule, profile)`, `RULES`
- **Dependencies:** None (pure computation)

#### IR Emitter (`src/ir/emit.js`)
- **Purpose:** Package proposals + profile into a versioned ProposalEnvelope
- **Responsibilities:** Schema conformance, deterministic proposal IDs (SHA-256), optional usefulness scoring
- **Interfaces:** `emitEnvelope({ feed_id, feed_profile, proposals, source_metadata, score_usefulness })`
- **Dependencies:** `src/filter/usefulness.js` (optional), `node:crypto`

#### Processor (`src/processor/`)
- **Purpose:** Assemble evidence bundles with trust-tiered quality and pricing
- **Responsibilities:** Quality scoring, doubt pricing, evidence class assignment, bundle assembly
- **Interfaces:** `buildBundle(rawEvent, config)`, `computeQuality()`, `computeDoubtPrice()`, `assignEvidenceClass()`, `canSettleByClass()`
- **Dependencies:** None (pure computation)

#### Trust Model (`src/trust/oracle-trust.js`)
- **Purpose:** Enforce the settlement invariant: only T0/T1 sources may settle theatres
- **Responsibilities:** Tier lookup (11 known source IDs), settlement authorization, rejection reason population
- **Interfaces:** `getTrustTier(sourceId)`, `canSettle(tier)`, `validateSettlement(sourceId)`
- **Dependencies:** None (static registry)

#### Argus Adversarial Gate (`src/trust/adversarial.js`)
- **Purpose:** Detect manipulation patterns in T2/T3 oracle sources
- **Responsibilities:** 6 documented checks (5 implemented, 1 documented but not in function body — see §10)
- **Interfaces:** `checkAdversarial(bundle, context)`, `checkChannelConsistency(channelA, channelB)`
- **Dependencies:** None (stateless checks)

#### Runtime (`src/runtime/lifecycle.js`)
- **Purpose:** Orchestrate theatre lifecycle from proposal to RLMF certificate
- **Responsibilities:** Theatre instantiation, bundle ingestion with adversarial checks, expiry management, settlement with trust enforcement, certificate export
- **Interfaces:** `ForgeRuntime` class — `instantiate()`, `ingestBundle()`, `checkExpiries()`, `settle()`, `getCertificates()`, `flushCertificates()`
- **Dependencies:** All 6 theatre modules, `oracle-trust.js`, `adversarial.js`, `rlmf/certificates.js`

#### Theatres (`src/theatres/`)
- **Purpose:** Implement 6 theatre types with 4 lifecycle operations each
- **Types:** `threshold_gate`, `cascade`, `divergence`, `regime_shift`, `anomaly`, `persistence`
- **Operations per type:** `create()`, `process()`, `expire()`, `resolve()`
- **Dependencies:** None (pure state machines)

#### Usefulness Filter (`src/filter/usefulness.js`)
- **Purpose:** Economic scoring of proposals — multiplicative 4-factor formula
- **Factors:** population_impact × regulatory_relevance × predictability × actionability
- **Interfaces:** `computeUsefulness(proposal, feedProfile, config)`
- **Dependencies:** None (lookup tables + arithmetic)

#### Composer (`src/composer/compose.js`)
- **Purpose:** Cross-feed composition for theatre proposals neither feed generates alone
- **Responsibilities:** Temporal alignment, causal ordering detection, 3 composition rules
- **Interfaces:** `alignFeeds()`, `detectCausalOrdering()`, `proposeComposedTheatre()`
- **Dependencies:** None (pure computation)

### 1.5 Data Flow

```
fixture.json
  │
  ▼
ingestFile(path) ─── readFileSync ──▶ JSON.parse ──▶ detectShape ──▶ parse*()
  │
  ▼
NormalizedEvent[] { timestamp, value, metadata }
  │
  ▼
classify(events) ──▶ FeedProfile { cadence, distribution, noise, density, thresholds }
  │
  ▼
selectTemplates(profile) ──▶ Proposal[] { template, params, confidence }
  │
  ▼
emitEnvelope(...) ──▶ ProposalEnvelope (spec/proposal-ir.json v0.1.0)
  │
  ▼ (if instantiate=true)
ForgeRuntime.instantiate(proposals) ──▶ Theatre[] (open, processing bundles)
  │
  ▼ (per evidence bundle)
buildBundle(rawEvent, config) ──▶ EvidenceBundle { value, quality, doubt_price, evidence_class, ... }
  │
  ▼
ForgeRuntime.ingestBundle(bundle) ──▶ checkAdversarial ──▶ theatre.process()
  │
  ▼ (on settlement or expiry)
ForgeRuntime.settle() / checkExpiries() ──▶ exportCertificate() ──▶ RLMF Certificate
```

### 1.6 External Integrations

| Service | Purpose | Contract | Status |
|---------|---------|----------|--------|
| Echelon | Theatre admission | Proposal IR v0.1.0 (`spec/proposal-ir.json`) | Frozen this sprint |

### 1.7 Security Architecture

**Critical Invariant:** T3 sources (PurpleAir, ThingSpeak) MUST NEVER settle a theatre. Only T0 and T1 may settle.

**Enforcement chain:**

```
getTrustTier(sourceId)          → tier lookup (11 sources, unknown fallback)
  ↓
canSettle(tier)                 → boolean whitelist (T0 || T1 only)
  ↓
validateSettlement(sourceId)    → { allowed, tier, reason } (rejection reason populated)
  ↓
ForgeRuntime.settle()           → calls validateSettlement before resolving
```

**Dual-gate consistency:**

```
assignEvidenceClass(tier)       → 'ground_truth' (T0/T1), 'corroboration' (T2), 'provisional' (T3/unknown)
canSettleByClass(evidence_class) → true only for 'ground_truth'
```

Both gates must agree: `canSettle(tier) === canSettleByClass(assignEvidenceClass(tier))` for all tiers.

**Adversarial gate (Argus):** 6 documented checks applied at `ForgeRuntime.ingestBundle()`:
1. Channel A/B inconsistency (15% divergence threshold)
2. Frozen/replayed data (5 consecutive identical readings)
3. Clock drift (>7 days old or >1 hour future)
4. Location spoofing (>0.45° deviation from registered coords)
5. Sybil sensors (all peer values identical)
6. Value out of range — **documented in JSDoc but not implemented** (see §10)

**Key observation:** `checkAdversarial()` is called by `ForgeRuntime.ingestBundle()` (line 223) but is NOT called by `buildBundle()`. The adversarial gate runs at runtime bundle ingestion, not at bundle construction time. This is a review target for FR-1.

---

## 2. Software Stack

| Category | Technology | Version | Justification |
|----------|-----------|---------|---------------|
| Runtime | Node.js | ≥20.0.0 | ES module support, built-in test runner |
| Module system | ES Modules | — | `"type": "module"` in package.json |
| Test runner | `node --test` | built-in | Zero-dependency testing |
| Built-in only | `node:fs`, `node:crypto` | — | Zero external runtime dependencies (security property) |

**Explicitly NOT used:**
- No bundler, transpiler, or build step
- No external runtime dependencies (`dependencies: {}`)
- No dev dependencies (`devDependencies: {}`)
- No test framework (Jest, Vitest, etc.)
- No HTTP server or REST framework

---

## 3. Data Design

FORGE is stateless between pipeline runs. All data structures are in-memory. No database.

### 3.1 Core Data Types

#### NormalizedEvent
```js
{
  timestamp: number,    // Unix epoch ms
  value:     number,    // Primary reading (highest-variance field)
  metadata:  {          // Structural metadata only
    shape: string,      // 'geojson_feature', 'object', 'array_row'
    has_coords: boolean,
    // ... shape-specific fields
  }
}
```

#### FeedProfile (5 dimensions)
```js
{
  cadence:      { classification: 'seconds'|'minutes'|'hours'|'days'|'event_driven'|'multi_cadence', median_gap_ms, cv },
  distribution: { type: 'bounded_numeric'|'unbounded_numeric'|'categorical'|'composite', min, max, mean },
  noise:        { classification: 'smooth'|'noisy'|'spike_driven'|'mixed', spike_ratio },
  density:      { classification: 'single_point'|'sparse_network'|'dense_network'|'multi_tier', stream_count },
  thresholds:   { type: 'regulatory'|'statistical'|'physical'|'none', detected_thresholds },
}
```

#### Proposal
```js
{
  template:   'threshold_gate'|'cascade'|'divergence'|'regime_shift'|'anomaly'|'persistence',
  params:     { /* template-specific */ },
  confidence: number,  // [0, 1]
  rationale:  string,
}
```

#### EvidenceBundle
```js
{
  value:          number,
  timestamp:      number,
  doubt_price:    number,     // [0, 1] — 1 - quality
  quality:        number,     // [0, 1] — tier baseline blended with freshness
  evidence_class: 'ground_truth'|'corroboration'|'provisional',
  source_id:      string|null,
  theatre_refs:   string[],
  resolution:     null|object,
  // Optional passthrough: channel_a, channel_b, lat, lon, frozen_count
}
```

#### ProposalEnvelope (Proposal IR v0.1.0)
See `spec/proposal-ir.json` for the complete JSON Schema. Key fields: `ir_version`, `forge_version`, `emitted_at`, `feed_id`, `feed_profile`, `proposals[]`, `composition`, `usefulness_scores`.

### 3.2 Static Registries

| Registry | Location | Size | Purpose |
|----------|----------|------|---------|
| `TRUST_REGISTRY` | `oracle-trust.js:31-50` | 11 entries | Source ID → trust tier mapping |
| `DENSITY_IMPACT` | `usefulness.js:31-36` | 4 entries | Density classification → population impact factor |
| `THRESHOLD_RELEVANCE` | `usefulness.js:42-47` | 4 entries | Threshold type → regulatory relevance factor |
| `CADENCE_PREDICTABILITY` | `usefulness.js:53-60` | 6 entries | Cadence classification → predictability factor |
| `TIER_ACTIONABILITY` | `usefulness.js:67-73` | 5 entries | Trust tier → actionability modifier |
| `TIER_BASELINE` | `quality.js:19-24` | 4 entries | Trust tier → quality baseline |
| `TIER_CLASS` | `settlement.js:25-30` | 4 entries | Trust tier → evidence class label |
| `THEATRE_OPS` | `lifecycle.js:61-98` | 6 entries | Template type → {create, process, expire, resolve} |

### 3.3 Fixture Files

8 fixtures across 3 domains (seismic, air quality, space weather) used for convergence testing. **Frozen this sprint.**

---

## 4. Interface Design

FORGE is a headless library. No UI.

The "interface" is the programmatic API consumed in two ways:
1. **Pipeline consumer:** `ForgeConstruct.analyze(fixturePath, options)` → `ForgeResult`
2. **Echelon admission gate:** Reads the `ProposalEnvelope` JSON output (Proposal IR v0.1.0)

---

## 5. API Specifications

### 5.1 Programmatic API

#### ForgeConstruct (primary entrypoint)

| Method | Signature | Returns |
|--------|-----------|---------|
| `analyze` | `(fixturePath, { feed_id?, instantiate?, score_usefulness?, source_metadata? })` | `Promise<ForgeResult>` |
| `getRuntime` | `()` | `ForgeRuntime` |
| `getCertificates` | `()` | `Object[]` (defensive copy) |
| `flushCertificates` | `()` | `number` (count flushed) |

#### ForgeRuntime (theatre lifecycle)

| Method | Signature | Returns |
|--------|-----------|---------|
| `instantiate` | `(proposals, { feed_id?, now? })` | `string[]` (theatre IDs) |
| `ingestBundle` | `(bundle, adversarialCtx?)` | `{ processed, rejected, reason? }` |
| `checkExpiries` | `({ now? })` | `string[]` (expired IDs) |
| `settle` | `(theatreId, outcome, { source_id?, settlement_class?, now? })` | `{ settled, reason? }` |
| `getTheatre` | `(id)` | `Object\|null` |
| `getOpenTheatres` | `()` | `string[]` |
| `getStats` | `()` | `RuntimeStats` |
| `getState` | `()` | `Object` |

### 5.2 Granular Exports

`src/index.js` exports 46 functions/classes across 14 modules for testing, debugging, and convergence loop access. See `src/index.js:151-206` for the complete export map.

### 5.3 Proposal IR Contract (v0.1.0)

Schema: `spec/proposal-ir.json` — **frozen this sprint**.

Required envelope fields: `ir_version`, `forge_version`, `emitted_at`, `feed_id`, `feed_profile`, `proposals`.
Optional: `source_metadata`, `composition`, `usefulness_scores`.

Each proposal carries a deterministic `proposal_id` (first 16 hex chars of SHA-256 of `feed_id:template:sorted_params`).

---

## 6. Error Handling Strategy

### 6.1 Current Patterns

| Pattern | Location | Behavior |
|---------|----------|----------|
| TypeError throws | `compose.js:121-142` | Guard clauses on malformed FeedProfile input |
| Graceful fallback | `oracle-trust.js:63` | `?? 'unknown'` for unrecognized source IDs |
| Graceful fallback | `settlement.js:41` | `?? 'provisional'` for unknown tiers |
| Graceful fallback | `quality.js:66` | `?? DEFAULT_BASELINE` for unknown tiers |
| Return-value signaling | `adversarial.js:64-129` | `{ clean: false, reason }` for adversarial violations |
| Return-value signaling | `oracle-trust.js:86-97` | `{ allowed: false, tier, reason }` for settlement rejection |
| Null return | `compose.js:260` | `null` when no composition rule fires |
| Console warn | `lifecycle.js:179` | Unknown template type during instantiation |
| Try-catch | `lifecycle.js:345-351` | Certificate export failure logged, not thrown |

### 6.2 Gaps to Audit (Phase 2)

| Gap | Location | Risk |
|-----|----------|------|
| No input validation | `buildBundle()` | `rawEvent.value` could be `undefined`, `NaN`, `Infinity` |
| No circular reference protection | `ingest()` | Recursive object traversal could stack overflow |
| No path sanitization | `ingestFile()`, `createReplay()` | `readFileSync` with raw file path — path traversal possible |
| No payload size limit | `ingest()` | Memory-exceeding JSON could cause OOM |

---

## 7. Testing Strategy

### 7.1 Existing Test Infrastructure

| Category | Count | Runner | Location |
|----------|-------|--------|----------|
| Unit tests | 503 | `node --test` | `test/unit/*.spec.js` |
| Convergence tests | 63 | `node --test` | `test/convergence/*.spec.js` |
| **Total** | **566** | — | — |

All 566 tests pass (verified: 0 failures, 334ms).

### 7.2 Convergence Testing

3 backing specifications: TREMOR (seismic), CORONA (space weather), BREATH (air quality).

Each convergence test:
1. Ingests a golden envelope fixture (raw + anonymized mode)
2. Runs the full pipeline
3. Scores against expected output: grammar score (5D match), template score (exact param match), false positive count
4. Produces a `TotalScore` — convergence target is 20.5/20.5

### 7.3 Test Invariants (Must Hold Through Sprint)

- All 566 tests pass after any code change
- Convergence score remains 20.5/20.5
- Anonymized fixtures produce identical FeedProfiles to raw fixtures
- Same input → same output (determinism)

### 7.4 Sprint Review/Audit Methodology

| Phase | Method | Output |
|-------|--------|--------|
| Phase 1: Code Review | Targeted review of 5 priority modules + full codebase sweep | Findings with severity ratings |
| Phase 2A: Security Audit | Supply chain verification, input boundary testing, file I/O audit | Audit findings with dispositions |
| Phase 2B: Red-Team | Adversarial attack scenarios against 3 targets | Structured report per target |
| Phase 3: Usefulness | Read-only audit → baseline → interrogation → proposal → document | `FORGE_USEFULNESS_FINDINGS.md` |

---

## 8. Development Phases

### Phase 1: Code Review (FR-1 through FR-5)

**Gate:** Tech Lead approval with no open critical/high findings.

- [ ] **FR-1:** Oracle trust model review — `getTrustTier()` gap handling, `canSettle()` correctness, `validateSettlement()` reason population, adversarial check wiring
- [ ] **FR-2:** Evidence bundle pipeline review — trust enforcement consistency, edge cases in quality/doubt, dual-gate agreement
- [ ] **FR-3:** Usefulness filter review — 4 dimensions computed, composite is true [0,1], no NaN propagation
- [ ] **FR-4:** Composition engine review — null return, lag_ms=0 edge, rule ordering
- [ ] **FR-5:** Deterministic replay review — no non-determinism sources, byte-identical output

### Phase 2A: Security Audit (FR-6 through FR-8)

**Gate:** Security Auditor approval. **Requires:** Phase 1 gate passed.

- [ ] **FR-6:** Supply chain — zero external runtime deps confirmed, no dynamic imports
- [ ] **FR-7:** Input boundaries — malformed JSON, circular refs, Infinity/NaN/-0, memory limits
- [ ] **FR-8:** File I/O — path traversal in `ingestFile()`/`createReplay()`, symlink behavior

### Phase 2B: Red-Team (FR-9 through FR-11)

**Requires:** Phase 2A complete.

- [ ] **FR-9:** Oracle trust model — sourceId string manipulation, null/undefined inputs, tier mapping exhaustiveness, `canSettle()` bypass paths
- [ ] **FR-10:** Argus adversarial checks — all 6 checks verified present, worst-case false negatives/positives, detection thresholds documented
- [ ] **FR-11:** Evidence bundle spec — quality gaming, doubt price manipulation, dual-gate disagreement, post-construction mutation

### Phase 2C: Critical Fixes

**Conditional:** Only if Phase 2A/2B produce critical or high findings.

- [ ] Fix all critical findings immediately
- [ ] Disposition all high findings (fix or accepted-risk)
- [ ] All 566 tests still passing after fixes

### Phase 3: Usefulness Heuristic Iteration (FR-12 through FR-16)

**Gate:** Phase 2 approved. **All-or-nothing:** either T-H01 through T-H05 complete, or entire phase defers.

- [ ] **FR-12 (T-H01):** Read-only audit of current formula, weights, clamping, normalization
- [ ] **FR-13 (T-H02):** Baseline scoring — all 13 proposals scored with per-dimension breakdown
- [ ] **FR-14 (T-H03):** Weight interrogation — one paragraph per dimension, assumption analysis
- [ ] **FR-15 (T-H04):** Weight proposal — implement, compare before/after, keep or revert
- [ ] **FR-16 (T-H05):** Document findings in `grimoires/pub/FORGE_USEFULNESS_FINDINGS.md`

### Execution Order

```
Phase 1 ──▶ [approval gate] ──▶ Phase 2A ──▶ Phase 2B ──▶ Phase 2C ──▶ [approval gate] ──▶ Phase 3
```

---

## 9. Known Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Critical trust model vulnerability found | Medium | High | Fix immediately in this sprint (PRD: Phase 7 Q1) |
| Tobias delivers early, interrupting sprint | Medium | Medium | Phase 1+2 take priority; Phase 3 defers as a unit |
| Usefulness weight iteration worsens scores | Medium | Low | Reversion is valid; document why |
| Audit discovers scope-expanding issues | Low | High | Document findings; only fix critical/high; defer rest |
| Red-teaming reveals fundamental trust model redesign needed | Low | High | Document gap; assess Cycle 002 safety |
| `checkAdversarial` not wired into `buildBundle` found to be a vulnerability | Medium | Medium | Determine if runtime-level enforcement (lifecycle.js:223) is sufficient or if bundle-level enforcement is also needed |
| Missing Argus Check 6 (value out of range) | High | Medium | Identify and document during FR-10; implement if severity warrants |

---

## 10. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Argus Check 6 ("value out of range") is documented in `adversarial.js` JSDoc (line 12) but not implemented in the function body. Is this intentional or a gap? | Red-Team (FR-10) | Open |
| 2 | `buildBundle()` does NOT call `checkAdversarial()`. Adversarial checks run at `ForgeRuntime.ingestBundle()` instead. Is bundle-level enforcement needed, or is runtime-level sufficient? PRD FR-1 says "wired into `buildBundle()`". | Code Review (FR-1) | Open |
| 3 | The usefulness formula is multiplicative (`pop × reg × pred × act`) but the JSDoc describes "equal weights at 1.0" — weights of 1.0 in a multiplicative formula are identity, not equal weighting. Is the formula intentional? | Phase 3 (T-H03) | Open |
| 4 | `actionability()` uses a two-step computation (`thresholdBase × tierMod`) unlike the other three single-lookup factors. Is this asymmetry intentional? | Phase 3 (T-H03) | Open |
| 5 | `generateId()` in `lifecycle.js:106` uses `Date.now()` — this means theatre IDs are non-deterministic. Acceptable for runtime but notable. | Code Review (FR-5) | Open |
| 6 | Doubt pricing formula is `1 - quality`. Is this derivation documented? Should it be non-linear? | Phase 3 / Governance | Open |
| 7 | What constitutes "physically plausible bounds" for Check 6? Each domain (seismic, AQI, X-ray flux) has different valid ranges. | Red-Team (FR-10) | Open |

---

## 11. Appendix

### A. Module Dependency Graph

```
src/index.js (ForgeConstruct)
├── ingester/generic.js
│   └── replay/deterministic.js (node:fs)
├── classifier/feed-grammar.js
│   ├── classifier/cadence.js
│   ├── classifier/distribution.js
│   ├── classifier/noise.js
│   ├── classifier/density.js
│   └── classifier/thresholds.js
├── selector/template-selector.js
│   └── selector/rules.js
├── ir/emit.js (node:crypto)
│   └── filter/usefulness.js
├── runtime/lifecycle.js
│   ├── theatres/threshold-gate.js
│   ├── theatres/cascade.js
│   ├── theatres/divergence.js
│   ├── theatres/regime-shift.js
│   ├── theatres/anomaly.js
│   ├── theatres/persistence.js
│   ├── trust/oracle-trust.js
│   ├── trust/adversarial.js
│   └── rlmf/certificates.js
├── processor/bundles.js
│   ├── processor/quality.js
│   ├── processor/uncertainty.js
│   └── processor/settlement.js
└── composer/compose.js
```

### B. Glossary

| Term | Definition |
|------|------------|
| Theatre | Structured prediction market on Echelon with locked parameters and Brier-scored RLMF export |
| Construct | Autonomous agent inside a Theatre with verifiable on-chain P&L |
| FeedProfile | 5-dimension classification (cadence, distribution, noise, density, thresholds) |
| Argus | 6-check adversarial gate on evidence bundles (named: hundred-eyed watchman) |
| RLMF | Reinforcement Learning from Market Feedback — Brier-scored training data |
| Proposal IR | Versioned JSON contract between FORGE and Echelon's admission gate (v0.1.0) |
| Golden envelope | Fixture files containing expected FORGE output per backing spec |
| Backing spec | Reference implementation (TREMOR, CORONA, BREATH) that FORGE must converge to |
| Settlement invariant | T3 sources MUST NEVER settle a theatre — the attack the trust model exists to prevent |
| Doubt price | Confidence discount on evidence bundles; `1 - quality` |

### C. PRD Traceability

| SDD Section | PRD Source |
|-------------|-----------|
| §1.7 Security Architecture | FR-1, FR-9, NFR Settlement Security |
| §3.1 Core Data Types | FR-2, FR-11 |
| §5.3 Proposal IR | Technical Considerations §7 |
| §6.2 Gaps to Audit | FR-7, FR-8 |
| §7 Testing Strategy | NFR Test Integrity, NFR Determinism |
| §8 Phase 1 | FR-1 through FR-5 |
| §8 Phase 2A | FR-6 through FR-8 |
| §8 Phase 2B | FR-9 through FR-11 |
| §8 Phase 3 | FR-12 through FR-16 |
| §10 Open Questions | FR-1 (Q2), FR-10 (Q1, Q7), Phase 3 (Q3, Q4, Q6) |

### D. Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-27 | Initial version — architecture documentation for holding sprint | Architecture Designer Agent |

---

*Generated by Architecture Designer Agent — grounded in full codebase exploration of 30 source files, 566 tests, and PRD v1.0*
