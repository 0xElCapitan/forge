# Project Description (from /plan)
> Updated 2026-03-28. Cycle 001 complete. Cycle 002 pending.

FORGE — Feed-Adaptive Oracle & Runtime Generator. Standalone feed classification engine that converts any structured event stream into a prediction market proposal. The Uniswap factory for prediction surfaces.

## What exists (Cycle 001 complete)

Full classification pipeline, 12 sprints, 566 tests passing, 20.5/20.5 convergence score.

**Pipeline**: live feed → ingest → classify (5 dimensions) → select template → emit ProposalEnvelope (IR) → Echelon admission gate

**Five classification dimensions**: cadence, distribution, noise, density, thresholds

**Six theatre templates**: threshold_gate, cascade, divergence, regime_shift, anomaly, persistence

**Completed modules**: `src/ingester/`, `src/classifier/`, `src/selector/`, `src/processor/`, `src/trust/`, `src/rlmf/`, `src/filter/`, `src/composer/`, `src/replay/`, `src/theatres/`, `src/runtime/`, `src/adapter/`, `src/ir/`

**Three validated backing specs**:
- TREMOR: USGS seismic → 5 proposals (threshold_gate, cascade, divergence, anomaly, regime_shift)
- CORONA: NOAA SWPC + NASA DONKI space weather → 5 proposals (3× threshold_gate, cascade, divergence)
- BREATH: PurpleAir + AirNow air quality → 3 proposals (threshold_gate, divergence, cascade)

**Convergence**: 20.5/20.5 TotalScore (13.0 TemplateScore + 7.5 GrammarScore) on raw and anonymized fixtures. The anonymized mode is the more important test — proves generalizability, not pattern-matching.

**Trust model**: T0–T3 oracle trust tiers. `canSettle()` is a hard invariant — T3 sources (PurpleAir, ThingSpeak) cannot settle a theatre under any circumstances. Enforced by Argus on every evidence bundle.

**IR contract**: `spec/proposal-ir.json` — the boundary between FORGE and Echelon. FORGE owns everything up to the IR envelope. Echelon owns everything after. Tobias (Echelon) has 163 bridge tests consuming it.

## Integration partner

**Echelon** (Tobias / AITOBIAS04/echelon-core) — verification infrastructure platform on Base. System Bible v14/v15, Cycle 037+ complete, 468+ tests, 8 calibration certificates, 10 theatre templates, 57-source OSINT registry. FORGE maps to Echelon's Theatre Factory component (Echelon Cycle 040 scope). The seam is the IR contract, not shared code.

**Collaboration terms**: Option 3 — shared architecture, separate ownership. FORGE stays standalone.

**`negative_policy_flags` ownership boundary**: FORGE emits `synthetic_only` and `no_settlement_authority` (reliably), `reflexive_feed` (conservatively). `insufficient_independence` and `hidden_upstream_dependency` are always left to Echelon.

## What Cycle 002 needs to deliver

1. **IR hardening**: add `normalization_trace`, `negative_policy_flags`, `original_hash` fields to `spec/proposal-ir.json`. Add hounfour `validate()` call in `src/ir/emit.js` (dev-time only, gated by `NODE_ENV !== 'production'`).
2. **Tobias review fixes**: three MUST FIX items (construct.json entry_point, tier key mismatch documentation, domain claim vocabulary) and three SHOULD ADDRESS items (IR stability policy, usefulness score consistency, brier_type null documentation). See `grimoires/pub/FORGE_TOBIAS_REVIEW_SPRINT.md`.
3. **Runtime integration tests**: full loop — fixture → classify → propose → instantiate → replay → settle → export certificates → validate Brier scores. Against all 3 backing specs.
4. **Live adapter hardening**: retry logic, staleness detection, stats emission on USGSLiveAdapter. Second adapter: SWPC space weather.
5. **Echelon-facing integration guide**: `docs/integration-guide.md` — how Echelon consumes FORGE output, what FORGE guarantees vs what Echelon supplies.
6. **Trust tier alignment**: align T0/T1/T2/T3 source list against Echelon's Settlement Authority Registry.

## Open questions requiring Tobias input before building

- Settlement tier key mismatch decision (string vs numeric keys — confirm before touching schema)
- IR version negotiation handshake
- Usefulness score field name at proposal level (confirm bridge expects same field name)

## Critical constraints (unchanged from Cycle 001)

- Zero external runtime dependencies — `@0xhoneyjar/loa-hounfour` is in `devDependencies` only
- Node.js 20+ with built-in test runner
- Deterministic — same input, same output, every time
- Anti-cheating — anonymized fixture mode must pass convergence
- All existing tests must remain passing (566 total)
- IR spec is the integration boundary — additive changes only, no breaking changes without notice

## Reference docs

- `grimoires/pub/FORGE_PROGRAM.md` — full classifier spec, scoring rules, backing specs
- `grimoires/pub/FORGE_TOBIAS_REVIEW_SPRINT.md` — Tobias review items to address
- `grimoires/loa/context/cycle-002-echelon-integration.md` — Cycle 002 scope and open questions
- `grimoires/pub/Echelon docs/` — Echelon context (private, do not reference in public outputs)
- `grimoires/pub/TREMOR docs/`, `grimoires/pub/CORONA docs/`, `grimoires/pub/BREATH docs/`
