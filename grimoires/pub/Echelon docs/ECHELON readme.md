# Echelon

**Verification infrastructure for the agentic economy.**

Echelon verifies AI agent claims against reality. External builders ship domain-specialist constructs — skill, theatre, or bridge — and Echelon compiles them into evaluation contracts, executes deterministic checks, detects cross-domain contradictions, and issues certificates backed by real evidence.

The prediction market is the factory. The calibrated training data is the product.

## What It Does

**Construct contract verification** — External construct repos compile into evaluation contracts with deterministic check planning, multi-evaluator orchestration, and certificate issuance. Security domain packs use structured corpora (734+ cybersecurity skills) with OWASP, CWE, and MITRE ATT&CK anchors.

**Theatre network** — Independent domain-specialist verification environments that ingest live public data, run prediction markets, settle against external ground truth, and export Brier-scored calibration data. TREMOR (seismic intelligence: USGS, EMSC, IRIS) and CORONA (space weather: NOAA SWPC, NASA DONKI, GFZ Potsdam) are the first two validated external theatre constructs. Both compile, execute, and compare cleanly through the full verification stack. The architecture is extensible to any domain with public, machine-readable data.

**Cross-domain paradox detection** — A network-level integrity layer that detects contradictions across independently operated external theatres. Oracle divergence, settlement divergence, confidence inconsistency, and cross-domain divergence (e.g. seismic activity in a region with no corroborating volcanic thermal anomaly). The Paradox Engine is the network referee for a federation of external verification environments.

**OSINT intelligence pipeline** — 16 sources across 14 collectors. WorldMonitor (intelligence, market, maritime), CompaniesHouse, FRED, AlphaVantage, OpenCorporates, Etherscan, CoinGecko, OpenSky, USGS Earthquake, Carbon Intensity, OpenAQ, Calendarific, Semantic Scholar. Evidence anchoring with snapshot/live asset classification, R2 manifest pipeline, and domain-specific anchor packs (frontend, security, research, user-research/journey).

**Prediction markets as verification mechanism** — Theatre templates are prediction markets. Resolved outcomes produce calibrated data. LMSR cost-function pricing provides guaranteed liquidity and mathematically correct price discovery.

**RLMF training data** — Brier-scored certificates from theatre verification become structured training data exports. Position histories, calibration scores, and evidence bundles feed downstream AI systems through Reinforcement Learning from Market Feedback.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           ECHELON PROTOCOL                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  OSINT Pipeline            Contract Substrate        Theatre Network      │
│  ───────────────           ──────────────────        ───────────────      │
│  14 collectors             Construct contracts       TREMOR (seismic)     │
│  16 sources                Check planning            CORONA (space wx)    │
│  Evidence anchoring        Multi-evaluator           Extensible domains   │
│  R2 manifest pipeline      Certificate issuance      Brier settlement     │
│                                                                            │
│  Integrity Layer                         Verification Pipeline            │
│  ───────────────                         ─────────────────────            │
│  Cross-theatre paradox                   Theatre check runner             │
│  Oracle divergence                       Settlement accuracy              │
│  Scope overlap detection                 Oracle consistency               │
│  Network-level referee                   Calibration validity             │
│                                                                            │
│  Agent Population                        RLMF Export Pipeline             │
│  ────────────────                        ────────────────────             │
│  6 archetypes                            Position histories               │
│  Genome-driven behavior                  Brier scores                     │
│  Hierarchical reasoning                  Calibration certificates         │
│  On-chain wallets                        Training data export             │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘

Frontend: React 19 + TypeScript + Vite 7 + Tailwind CSS
Backend:  FastAPI + PostgreSQL (async) + Python 3.12
Chain:    Base (Solidity + Chainlink VRF)
```

## Project Structure

```
prediction-market-monorepo/
├── frontend/                    # React 19 + TypeScript + Vite 7
├── backend/
│   ├── api/                     # FastAPI REST endpoints
│   ├── agents/                  # Agent archetypes and decision engines
│   ├── database/                # SQLAlchemy models, Alembic migrations
│   ├── osint/
│   │   └── collectors/          # 14 collectors (BaseCollector pattern)
│   ├── services/                # ~68 backend services
│   │   ├── contract_service     # Construct contract compilation
│   │   ├── check_planner        # Deterministic check planning
│   │   ├── theatre_*            # Theatre verification pipeline
│   │   ├── cross_theatre_*      # Paradox detection + comparison
│   │   ├── external_theatre_*   # Orchestration + fixture extraction
│   │   ├── eval_asset_policy    # Snapshot/live asset classification
│   │   ├── r2_manifest_builder  # Ground truth manifest pipeline
│   │   ├── construct_anchor_*   # Evidence anchoring (4 anchor classes)
│   │   ├── security_*           # Security domain pack
│   │   └── domain_pack_loader   # Frontmatter-aware corpus ingestion
│   ├── schemas/                 # Pydantic models for all subsystems
│   ├── simulation/              # Theatre engines
│   └── scripts/                 # Build/seed utilities
├── smart-contracts/             # Solidity (LMSR markets, VRF, settlement)
├── grimoires/
│   └── loa/
│       └── context/             # Active cycle docs for Loa
└── docs/                        # Architecture documentation
```

## External Theatre Constructs

Echelon verifies external theatre constructs built by independent operators:

| Construct | Domain | Oracles | Templates | Tests |
|-----------|--------|---------|-----------|-------|
| [TREMOR](https://github.com/0xElCapitan/tremor) | Seismic intelligence | USGS NEIC, EMSC, IRIS DMC | 5 (Magnitude Gate, Aftershock Cascade, Swarm Watch, Depth Regime, Oracle Divergence) | 48 |
| [CORONA](https://github.com/0xElCapitan/corona) | Space weather | NOAA SWPC, NASA DONKI, GFZ Potsdam | 5 (Flare Class Gate, Geomagnetic Storm, CME Arrival, Proton Cascade, Solar Wind Divergence) | 60 |

Both constructs compile, execute, and compare cleanly through the full 037d → 037e → 038a verification stack. Zero external dependencies (Node.js 20+ only).

Theatre constructs produce 13 planned checks each across 4 check families: settlement accuracy, oracle consistency, calibration validity, and functional correctness.

## Ground Truth Pipeline

```
download → hash_local.py → r2_upload.py upload → r2_upload.py verify
```

Evaluation benchmarks (HumanEval, MBPP, HellaSwag, MMLU, MMLU-Pro, SWE-bench Verified, WCAG 2.2, ARIA APG), domain anchor snapshots (React docs, Tailwind CSS, OWASP Top 10, CWE subset, arXiv metadata, GOV.UK Service Manual/Design System), and computer-use datasets (Markov Blender/Photoshop/VS Code/Salesforce). Stored in Cloudflare R2 with SHA-256 hash verification.

## Constructs Network

Echelon integrates with [constructs.network](https://constructs.network) — a marketplace for AI agent expertise built by [Soju](https://github.com/0xHoneyJar/loa-constructs). Construct types: skill, theatre, bridge. External builders ship construct repos; Echelon compiles, executes, compares, and scans them.

## Status

Cycles 017–038b shipped. Active context: 038c (Orchestrated Scanner Handoff) + 039 (External Theatre Registry + Scheduling). TREMOR and CORONA validated end-to-end. Frontend hero page refresh in progress.

## Contact

Built by Tobias Harber — [@tobiasjames_eth](https://x.com/tobiasjames_eth)
