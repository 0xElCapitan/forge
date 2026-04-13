# FORGE Pre-002 Hardening: Executive Summary

**Cycle**: pre-002
**Date**: 2026-04-12
**Audience**: Executive / Tobias
**Status**: COMPLETE -- All 4 sprints approved (engineering review + security audit)

---

## The One-Liner

FORGE's provenance system was structurally bespoke. This cycle made it industry-convertible, formally hermetic, and adversarially fail-closed -- without adding a single external dependency.

---

## What This Cycle Was

Pre-002 is a **discipline pass**, not a feature release. It restructures and hardens FORGE's internals so that Cycle 002 (new IR fields, deeper Echelon integration) lands on clean rails instead of inheriting structural debt.

> "These are discipline gaps, not feature gaps. They make FORGE harder to verify externally and harder to reason about internally." (prd.md:L11)

### Why Now, Not Later

Cycle 002 will add `normalization_trace`, `original_hash`, `classifier_version`, and `negative_policy_flags` to the IR. If those land on a receipt shape that is bespoke and a determinism model that is implicit, every future attestation and verification path inherits that debt (prd.md:L13).

---

## What Was Delivered

### 5 Goals, All Verified End-to-End

```
 G-1  Receipt shape: FORGE-native but in-toto convertible     PASS
 G-2  Hermeticity contract exists and enforced                 PASS
 G-3  Docs match code (zero drift)                             PASS
 G-4  Adversarial gate fails closed on NaN                     PASS
 G-5  Rationale string bug fixed                               PASS
```

(Source: sprint.md:L29-37, validated in sprint-pre002-contract-tests/reviewer.md:L72-80)

### 4 Sprints, 20 Tasks, Zero Regressions

| Sprint | What It Did | Tasks | Tests Added | Verdict |
|--------|-------------|-------|-------------|---------|
| **Local Hardening** | Fixed a bug where malformed inputs (NaN, Infinity) silently bypassed 5 of 6 adversarial safety checks. Fixed a rationale string bug that made debugging opaque. | 3 | +21 | Approved |
| **Hermeticity** | Created a formal contract (`spec/HERMETICITY.md`) listing every input that may affect output, with a fail-closed enforcement gate. This backs FORGE's "deterministic output" claim with a testable specification. | 5 | +5 | Approved |
| **Attestation** | Restructured the ProposalReceipt from flat bespoke fields to attestation-aligned groups (subject, materials, policy, builder). Added a `predicateType` discriminator. Built a pure-function converter to in-toto Statement v1 for interoperability. | 8 | +18 | Approved |
| **Contract Tests** | Validated live pipeline output against JSON schemas. Updated all documentation to match code. Verified all 5 cycle goals end-to-end. Resolved 6 carry-forward concerns from earlier sprints. | 4 | +7 | Approved |

**Test count**: 699 at cycle start. **750** at cycle end. +51 net. Zero failures.

(Source: auditor-sprint-feedback.md across all 4 sprints)

---

## What This Means for Tobias / Echelon

### 1. Receipts Are Now Verifiable by Standard Tooling

Before this cycle, a verifier had to understand FORGE's bespoke field naming to validate a receipt. Now:

- **Programmatic identification**: `predicateType: "https://forge.echelon.build/attestation/v0"` tells any system what kind of attestation this is without human interpretation (receipt-v0.json:L27)
- **Standard interoperability**: `toInTotoStatement(receipt)` produces valid in-toto Statement v1 JSON -- the same format used by SLSA, Sigstore, and the broader supply chain security ecosystem (src/receipt/to-intoto.js)
- **Echelon admission gate** can now verify receipts using standard attestation libraries, not FORGE-specific code (docs/echelon-integration.md:L15-38)

### 2. "Deterministic" Is No Longer a Handshake Promise

Before: FORGE claimed deterministic output, but nothing formally defined which inputs were allowed to affect output.

After: `spec/HERMETICITY.md` is a two-zone contract:
- **Receipt-critical zone** (enforced): feed data, pipeline config, policy rules, code version. All tested. Any hidden input breaks the gate.
- **Runtime zone** (documented): wall-clock, Node.js version, adapter state. Documented with a promotion path to enforcement.

The `deterministic: true` flag is now a 3-line fail-closed gate (src/index.js:99-101) that rejects execution if injectable parameters are missing, **before** the pipeline runs.

### 3. Adversarial Safety Is Fail-Closed

Before: If a sensor bundle contained `NaN` for latitude, the adversarial check would **silently pass** it as clean. 5 of 6 checks had this vulnerability.

After: All 6 checks have `Number.isFinite` guards. A malformed input produces `{ clean: false, reason: "invalid_{field}: must be finite number" }` -- explicit rejection with a traceable reason string.

---

## What Was Deliberately Rejected

This cycle borrowed ideas from industry standards but rejected their infrastructure and governance overhead:

| Borrowed (discipline) | Rejected (infrastructure) | Why |
|----------------------|--------------------------|-----|
| SLSA attestation field structure | SLSA level compliance | FORGE has no near-term consumer for level certification (prd.md:L79) |
| in-toto Statement v1 shape | in-toto multi-step supply chain | FORGE has one step, not a multi-actor pipeline (prd.md:L80) |
| Bazel/Nix hermeticity thinking | Bazel/Nix toolchain migration | Tool migration is ideology; discipline doesn't require the tool (prd.md:L81-82) |
| Sigstore-style signing model | Transparency log infrastructure | Compelling when receipts need public observability; not yet (prd.md:L83) |

(Source: prd.md:L75-88)

---

## What's Next: Cycle 002

Pre-002 was the foundation pour. Cycle 002 is the build:

| 002 Deliverable | Why Pre-002 Enables It |
|----------------|----------------------|
| `normalization_trace` IR field | Lands on a receipt shape that already has attestation-aligned groups |
| `classifier_version` IR field | Builder group already carries code identity with a URI |
| `negative_policy_flags` | Policy group already structures rules and regulatory data |
| Echelon admission gate integration | Receipt is now verifiable by standard tooling, not FORGE-specific parsing |
| Deeper `forge-verify` validation | Hermeticity contract defines exactly what replay must reproduce |

---

## Investment Summary

| Metric | Value |
|--------|-------|
| Sprints | 4 |
| Tasks completed | 20 |
| Tests added | +51 (699 to 750) |
| Files changed | ~25 (src, test, spec, docs) |
| External dependencies added | 0 |
| Security issues found | 0 critical, 0 high, 1 medium (resolved same cycle) |
| Regressions | 0 |
| Carry-forward debt | 0 blocking items |

---

## Decision: No Action Required

This is an informational summary. All work is complete, reviewed, and audited. No decisions are needed from stakeholders. Cycle 002 can begin when ready.

```
Pre-002 Hardening: COMPLETE
Quality Gate: PASSED (4/4 sprints approved)
Test Suite: 750 pass, 0 fail
PRD Goals: 5/5 validated
Ready for: Cycle 002
```
