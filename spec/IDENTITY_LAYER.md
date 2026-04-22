# FORGE Identity Layer v0 — Vocabulary & Ownership

**Status**: Locked vocabulary — no emitted fields changed by this document
**Cycle**: forge-cycle-002-lane1
**Date**: 2026-04-21
**Source**: `grimoires/loa/context/FORGE/FORGE_LEARNINGS_updated2.md:131-133`,
           `spec/STABILITY.md:85-88`

---

## Purpose

This memo locks the vocabulary for FORGE's participation in Echelon's composable
environment identity contract. No code changes. No new emitted fields (beyond what
`spec/proposal-ir.json` already declares). This document prevents vocabulary drift
between FORGE and Echelon before the module contract spec arrives from Tobias.

---

## 1. Fields FORGE Emits Now

| Field | Type | Since | Meaning |
|-------|------|-------|---------|
| `ir_version` | `string` | Cycle 001 | Schema version for the ProposalEnvelope contract (SemVer) |
| `forge_version` | `string` | Cycle 001 | Full FORGE package version |
| `classifier_version` | `string` | Cycle 002 Lane 1 | Pythia classifier (Q1-Q5 grammar) version — independent from `forge_version` |
| `original_hash` | `string \| null` | Cycle 002 Lane 1 | `sha256(canonicalize(rawInput))` — input provenance, nullable |
| `hash_algorithm` | `string \| null` | Cycle 002 Lane 1 | Algorithm used for `original_hash`; always `"sha256"` until migration |
| `negative_policy_flags` | `string[] \| null` | Cycle 002 Lane 1 | FORGE-originated advisory policy flags; opt-in via `evaluate_policy: true` |

---

## 2. Fields Reserved — Emit When Module Contract Lands

These fields are reserved in `spec/STABILITY.md:85-88`. FORGE MUST NOT emit them for
any other purpose before the Echelon composable environment module contract is finalized.

| Field | Reserved For | Blocker |
|-------|-------------|---------|
| `module_type` | Echelon composable environment routing — declares the producing module's type | Echelon module contract spec (pending Tobias delivery) |
| `module_id` | Alternative identifier if `module_type` is insufficient for routing | Same as above |
| `module_version` | Version of the module instance (distinct from `classifier_version`) | Same as above |

**When the contract arrives**: These three fields will allow Echelon's composition
runtime to route envelopes to the correct module pipeline without tight coupling on
`feed_id` patterns. `module_type` for FORGE will be `"proposal_source"` per Tobias's
composable environment description (`FORGE_LEARNINGS_updated2.md:131`).

---

## 3. Proposed Provenance Chain — Emit When Inter-Module Pipeline Exists

These fields describe who produced, admitted, promoted, and certified an artifact as
it moves through Echelon's Integration Layer. They are proposed vocabulary only —
not yet agreed with Tobias.

| Field | Proposed Meaning | Populated By |
|-------|-----------------|--------------|
| `origin` | Root source of the input data (feed URL, oracle ID) | FORGE at emit time |
| `produced_by` | Module that created this envelope (`forge:<version>`) | FORGE at emit time |
| `admitted_by` | Echelon component that admitted the envelope to canvas | Echelon admission gate |
| `promoted_by` | Component that promoted from PROPOSED → ADMITTED state | Echelon Integration Layer |
| `certified_by` | Component that issued the RLMF certificate | Echelon resolution engine |

**Usage**: Provenance chain fields let any downstream component reconstruct the full
custody trail without querying multiple systems.

---

## 4. Lifecycle State Vocabulary

These state names describe the progression of a theatre from FORGE proposal to
Echelon certification. Align these names when documenting integration flows.

```
DRAFT          — Descriptor submitted, not yet validated
    ↓
PROPOSED       — ProposalEnvelope emitted by FORGE, Echelon not yet aware
    ↓
ADMITTED       — Echelon admission gate accepted; canvas node created
    ↓
INSTANTIATED   — Theatre runtime active; accepting positions
    ↓
RESOLVED       — Outcome determined; settlement authority confirmed
    ↓
CERTIFIED      — RLMF certificate issued; Brier score recorded
```

Mirrors FORGE trust tiers (T0–T3 measure the authority at RESOLVED/CERTIFIED) and
Echelon Theatre lifecycle (INSTANTIATED → RESOLVED → CERTIFIED is the settlement path).

---

## 5. FORGE Trust Tier → Echelon Provenance Mapping

From `src/trust/oracle-trust.js:ECHELON_PROVENANCE_MAP` (confirmed Tobias, sprint-10):

| FORGE Tier | Echelon Provenance | Confidence | Can Settle |
|------------|-------------------|-----------|------------|
| T0 | `signal_initiated` | high | Yes |
| T1 | `signal_initiated` | brier_discounted | Yes (discounted) |
| T2 | `suggestion_promoted` | — | No |
| T3 | `suggestion_unlinked` | — | No |

---

## 6. Decision Log

| Decision | Rationale | Source |
|----------|-----------|--------|
| `classifier_version` is required (not optional) in FORGE's schema | Identity metadata is always relevant; FORGE always emits it; non-breaking to Echelon consumers at ir_version 0.1.0 who SHOULD ignore unknowns | PRD §4 FR-2, Phase 0 interview 2026-04-21 |
| `module_type` / `module_id` not emitted in Lane 1 | No spec from Tobias yet; STABILITY.md reserves them; building anything now is unilateral | `spec/STABILITY.md:85-88`, `FORGE_LEARNINGS_updated2.md:133` |
| `negative_policy_flags` is flat string array, not structured object | Vocabulary-only in Lane 1; richer `{flag, source, severity}` shape deferred until shared vocabulary is co-designed | PRD §4 FR-3, Phase 0 interview 2026-04-21 |
| `ir_version` stays at 0.1.0 | MINOR bump coordinated with Tobias as part of Cycle 002 release; Echelon has 163 bridge tests | PRD §6, STABILITY.md:11 |
| `normalization_trace` deferred to Lane 2 | Requires instrumentation across all 5 Q1-Q5 classifier sub-modules; cross-cutting; not Lane 1 safe | PRD §5 |

---

> Related: `spec/proposal-ir.json`, `spec/STABILITY.md`, `src/trust/oracle-trust.js`,
> `grimoires/loa/context/FORGE/FORGE_LEARNINGS_updated2.md:131-133`
