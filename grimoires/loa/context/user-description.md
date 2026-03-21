# Project Description (from /plan)
> Auto-generated from user's initial project description.

FORGE — Feed-Adaptive Oracle & Runtime Generator for Echelon.

FORGE is the Uniswap factory for prediction surfaces. Point it at any live data feed → it characterizes the data statistically → selects Theatre templates → deploys prediction markets. The classifier must work purely from statistical properties of the data stream (no source identity, no URL sniffing, no hardcoded field names).

Three convergence targets (backing specs):
- **TREMOR**: USGS seismic data → 5 Theatre templates (threshold_gate, cascade, divergence, anomaly, regime_shift)
- **CORONA**: NOAA SWPC + NASA DONKI space weather → 5 Theatre templates (3× threshold_gate, cascade, divergence)
- **BREATH**: PurpleAir + AirNow air quality → 3 Theatre templates (threshold_gate, divergence, cascade)

The core loop: modify classifier/selector → run convergence tests → keep if score improved, discard if not. Max TotalScore = 20.5 (13.0 TemplateScore + 7.5 GrammarScore).

Build order:
1. Phase 0: Scaffolding (replay module, feed ingester, convergence test harness)
2. Phase 1: Five-question feed classifier (Q1 cadence, Q2 distribution, Q3 noise, Q4 density, Q5 thresholds)
3. Phase 2: Selector (rules.js decision tree, template-selector.js)
4. Phase 3: Generalized infrastructure (theatre templates, processors, trust model, RLMF, composition)

Critical constraints: zero external dependencies, Node.js 20+, deterministic, anti-cheating (anonymized fixture mode must pass), structured rule schema with traced_to field, one change per loop iteration.

Reference docs: `grimoires/pub/FORGE_PROGRAM.md` (full spec), `grimoires/pub/TREMOR docs/`, `grimoires/pub/CORONA docs/`, `grimoires/pub/BREATH docs/`, `grimoires/pub/Echelon docs/`
