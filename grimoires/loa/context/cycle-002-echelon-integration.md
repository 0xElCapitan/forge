# FORGE Cycle 002 — Echelon Integration

> Context for `/plan-and-analyze`. Cycle 001 (classification engine) is complete — 12 sprints, 20.5/20.5 convergence, 558 tests. This cycle bridges FORGE from a standalone classifier into a live, integrated component of the Echelon ecosystem.

## What exists (Cycle 001 output)

FORGE classifies any structured event feed across 5 grammar dimensions (cadence, distribution, noise, density, thresholds), selects Theatre templates via rule-based matching, and proposes composed theatres from feed pairs. Validated against 3 backing specs (TREMOR/CORONA/BREATH) on raw and anonymized fixtures. Zero external dependencies. Node 20+.

Completed modules: `src/ingester/`, `src/classifier/`, `src/selector/`, `src/processor/`, `src/trust/`, `src/rlmf/`, `src/filter/`, `src/composer/`, `src/replay/`, `src/theatres/` (6 types).

## What was added between cycles (pre-work, already merged)

Three new modules were built as pre-work before this cycle's formal planning:

1. **Proposal IR spec** (`spec/proposal-ir.json`) — JSON Schema defining the `ProposalEnvelope` contract between FORGE and Echelon's admission gate. Versioned at 0.1.0. Contains feed_profile, annotated proposals with brier_type, optional composition context, and usefulness scores.

2. **ForgeRuntime** (`src/runtime/lifecycle.js`) — Theatre lifecycle orchestrator. Factory-map dispatch across all 6 theatre types. Full lifecycle: instantiate → ingestBundle → checkExpiries → settle → exportCertificate. Injectable clock. Adversarial checks on every bundle. Trust tier enforcement on settlement.

3. **USGSLiveAdapter** (`src/adapter/usgs-live.js`) — Live polling adapter for USGS GeoJSON feeds. Deduplicates, classifies on each poll, emits IR envelopes, builds evidence bundles, optionally routes to ForgeRuntime. One-shot `classifyUSGSFeed()` convenience export.

4. **IR emitter** (`src/ir/emit.js`) — Serializes FORGE output into versioned ProposalEnvelope conforming to the IR spec. Annotates brier_type, runs optional usefulness scoring.

5. **Updated entrypoint** (`src/index.js`) — ForgeConstruct now emits IR envelopes, supports `instantiate: true` for theatre lifecycle, delegates certificates to ForgeRuntime.

Tests: 558 unit + 6 convergence, all passing.

## Collaboration context

Tobias (Echelon) reviewed FORGE and confirmed alignment with his Cycle 040 (Proposal Operating System). We agreed on Option 3: **shared architecture, separate ownership**. FORGE stays standalone (own repo, zero deps, I maintain). We co-design the interface between FORGE's proposal output and Echelon's admission gate.

The agreed seam: FORGE owns `classify → propose → emit IR`. Echelon owns `admission → instantiation → resolution → RLMF`. The Proposal IR (`spec/proposal-ir.json`) is the contract.

## What this cycle needs to deliver

### 1. Proposal IR hardening

The IR spec exists but hasn't been validated against Echelon's actual admission requirements. This cycle should:
- Add a JSON Schema validator that runs on every emitted envelope (dev-time, not runtime)
- Add an IR envelope example file per backing spec (TREMOR, CORONA, BREATH) — concrete reference for Tobias
- Validate the IR schema covers Echelon's needs or flag gaps (e.g., does Echelon need agent deck hints? liquidity parameter suggestions?)

### 2. Runtime integration tests

ForgeRuntime has unit tests but no integration test that runs the full loop:
- Fixture → classify → propose → instantiate theatres → replay bundles through runtime → check expiry/settlement → export certificates → validate Brier scores
- This should run against all 3 backing specs as a convergence-level test
- The replay module (`src/replay/deterministic.js`) already supports this — wire it into ForgeRuntime

### 3. Live adapter hardening

USGSLiveAdapter is functional but needs:
- Retry logic with exponential backoff on network failures
- Feed staleness detection (alert if USGS hasn't updated in >5 minutes)
- Stats emission on each poll (for monitoring)
- A second adapter (SWPC space weather) to prove the adapter pattern generalizes

### 4. Echelon-facing documentation

Tobias needs docs to integrate against. This means:
- A `docs/integration-guide.md` that explains how Echelon consumes FORGE output
- IR envelope examples with annotations
- Clear statement of what FORGE guarantees vs what Echelon must supply (e.g., settlement_source, liquidity depth)

### 5. Open questions for Tobias

These should be flagged in the SDD as requiring Echelon input, not solved unilaterally:
- Does the IR need to carry agent deck composition hints?
- Does Echelon's admission gate filter by usefulness score, or does it have its own filter?
- How does Echelon handle FORGE proposing theatres that already exist (dedup)?
- What's the handshake for IR version negotiation?

## Constraints

- Zero external dependencies (maintained from Cycle 001)
- Node.js 20+ with built-in test runner
- FORGE stays standalone — no Echelon runtime dependency
- IR spec is the integration boundary, not shared code
- All existing tests must remain passing (558 unit + 6 convergence)

## Open questions (for SDD / future cycles)

- **Shadow mode for ForgeRuntime**: Tobias's environment concept includes "shadow runs" where a theatre construct runs against live or historical data before activation, producing readiness traces and certificates without real settlement. ForgeRuntime could support a `shadowMode: true` option on instantiate that bypasses state mutations, executes the logic, and emits structured readiness traces (JSON). This would enable a "Builder Studio → Shadow Run" pipeline where FORGE proposes a theatre, it runs in shadow against live data, and the trace proves it's viable before Echelon activates it for real trading. Design question: should traces be emitted via callback/event emitter (composable) or written to disk (inspectable)? Defer to SDD — don't implement prematurely.

## Reference docs in grimoires/pub/

- `FORGE_PROGRAM.md` — Full classifier spec, scoring rules, backing specs
- `Echelon docs/` — Echelon readme, Tobias context
- `TREMOR docs/` — TREMOR architecture, theatre patterns, RLMF
- `CORONA docs/` — CORONA architecture, SWPC/DONKI patterns
- `BREATH docs/` — BREATH architecture, trust hierarchy, sensor recruitment
