# PRD: FORGE Pre-002 Hardening — Attestation & Hermeticity Discipline

**Cycle**: pre-002
**Created**: 2026-04-12
**Sources**: `grimoires/loa/context/Hardening and Prep of FORGE.md`, `FORGE-research-decision-memo.md`, `deep-research-FORGE.md`, live repo inspection (2026-04-12)

---

## 1. Problem Statement

FORGE ships ProposalReceipt v0 and a deterministic pipeline with 20.5/20.5 convergence. But the receipt shape is structurally bespoke — not mechanically relatable to any industry attestation format — and the determinism guarantee has no formal contract enumerating what inputs are allowed to affect output. These are discipline gaps, not feature gaps. They make FORGE harder to verify externally and harder to reason about internally.

Cycle 002 will add IR fields (`normalization_trace`, `original_hash`, `classifier_version`, `negative_policy_flags`) and harden the integration surface with Echelon. If those additions land on a receipt shape that is bespoke and a determinism model that is implicit, every future attestation and verification path inherits that debt.

This hardening pass makes FORGE truer, cleaner, and harder to misinterpret before 002 begins.

> Sources: `Hardening and Prep of FORGE.md:1-12`, `FORGE_THESIS_updated.md:34-37`, `deep-research-FORGE.md:1-10`

---

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Receipt shape is FORGE-native but mechanically convertible to in-toto Statement | A pure-function `toInTotoStatement(receipt)` produces valid in-toto v1 JSON |
| Hermeticity contract exists and is enforced | Written contract in `spec/`; fail-closed test that breaks if a hidden input is introduced |
| Docs match code | Zero drift between README/BUTTERFREEZONE/spec claims and live code behavior |
| Adversarial gate fails closed on malformed inputs | All 6 checks reject NaN/non-finite inputs instead of passing silently |
| Rationale string bug fixed | `conditions_met/conditions_total` in all proposal rationale strings |

> Sources: `Hardening and Prep of FORGE.md:40-64`, `deep-research-FORGE.md:91-125`, `template-selector.js:146`

---

## 3. Users & Stakeholders

| Who | Role | What They Need From This |
|-----|------|-------------------------|
| El Capitan | FORGE owner/builder | Cleaner rails for 002 implementation |
| Tobias (Echelon) | Integration partner, 163 bridge tests | Stable, verifiable receipt shape; honest docs |
| Future verifiers | Anyone running `forge-verify` | Deterministic replay that is contractually hermetic |
| Future agents | Echelon Theatre Factory consumers | Attestation shape that is interoperable, not bespoke |

> Sources: `FORGE_THESIS_updated.md:87-100`, `Echelon-README.md:135-137`

---

## 4. Pre-002 Audit: What Was Done, What Remains, What Was Rejected

### 4.1 Already Done (verified in live code 2026-04-12)

| Item | Commit | Verification |
|------|--------|--------------|
| CORONA density classifier fix | `c44005d` | Convergence tests pass 20.5/20.5 |
| Anomaly template second domain decision | Resolved | SWPC mapping documented in decision memo |
| T-R01: construct.json entry_point | `899e672` | `spec/construct.json:43` reads `"entry_point": "README.md"` |
| T-R02: Tier key mismatch | `899e672` | String keys (`T0`-`T3`) consistent throughout `oracle-trust.js`; `ECHELON_PROVENANCE_MAP` exported |
| T-R03: Domain claim vocabulary | `899e672` | `feed_characterization` → `feed_classification`; no stale term in `spec/` |
| T-R04: spec/STABILITY.md | `899e672` | Exists with semver policy, breaking change definition, 1-sprint notice |
| Positioning update | `84c1ce6`, `1b08783` | README/BUTTERFREEZONE updated |
| ProposalReceipt v0 implementation | Multiple | Schema, signing, verification, CLI all implemented and tested |
| Package version alignment | — | `package.json:0.3.0` matches README `v0.3.0` claims |
| Test count accuracy | — | 684 unit + 15 convergence + integration = 699 total; docs match |

### 4.2 Still Must Do Before 002

| # | Item | Why Pre-002 | Risk If Deferred |
|---|------|-------------|-----------------|
| H-1 | Receipt shape audit + attestation field cleanup | Locks cleaner provenance shape before 002 adds IR fields | 002 IR additions inherit bespoke shape; convertibility becomes harder with each added field |
| H-2 | Hermeticity contract | Prevents 002 IR stability commitment from being vacuous | "Deterministic output" claim has no formal backing; replay verification is aspirational without it |
| H-3 | Adversarial gate NaN hardening | Removes fail-open correctness risk in adversarial codepath | Malformed bundles bypass 5 of 6 adversarial checks silently |
| H-4 | Rationale string bug fix | Removes auditability gap in proposal traceability | Rule misfires become invisible during debugging; Tobias can't trace which conditions actually matched |
| H-5 | Docs/code contract verification | Treats docs/code drift as a trust bug | Consumers assume guarantees code doesn't enforce (per deep research finding) |

### 4.3 Correctly Rejected as Too Large

| Rejected Item | Why Rejected |
|---------------|-------------|
| Full SLSA compliance / level chasing | FORGE's seam is narrower than a generic supply chain; level compliance imports governance overhead with no near-term consumer |
| Full in-toto multi-step supply chain modeling | FORGE has one step (classify → propose → emit), not a multi-actor pipeline |
| Bazel migration | Tool migration is ideology; hermeticity thinking doesn't require Bazel |
| Nix migration | Same; content-addressed discipline doesn't require Nix |
| Transparency log infrastructure (Sigstore/Rekor) | Becomes compelling when receipts need public observability; not yet |
| Dispute economics (UMA-style) | Belongs downstream in Echelon if ever needed; imports bigger problem class |
| OpenLineage backend | Typed provenance composition is "soon"; standing up a backend is premature |
| Any new runtime/chain/orchestration surface | Violates the narrow seam |

> Sources: `Hardening and Prep of FORGE.md:113-124`, `deep-research-FORGE.md:186-364`

---

## 5. Functional Requirements

### FR-H1: Receipt Shape Audit — Attestation Field Discipline

**Problem**: ProposalReceipt v0 is functionally equivalent to an in-toto Statement but structurally bespoke. A verifier cannot mechanically map receipt fields to the standard attestation vocabulary (subject, materials, predicate, builder).

**What to borrow from SLSA/in-toto**:
- Explicit subject identity (what was produced)
- Explicit materials identity (what inputs were consumed)
- Explicit predicate type discriminator
- Explicit builder/code identity
- Deterministic canonicalization rules (already present: `jcs-subset/v0`)

**What to reject**:
- Multi-step layout verification (FORGE has one step)
- Signed functionary chain (single signer is correct for FORGE)
- SLSA level compliance (governance overhead with no consumer)

**Current shape vs. required shape**:

| Receipt v0 Field | Attestation Equivalent | Gap |
|---|---|---|
| `output_hash` | `subject[0].digest` | No URI, no array structure — single opaque hash |
| `input_hash` | `materials[0].digest` | Same — single hash, no URI, no list |
| `policy_hash` + `rule_set_hash` | `predicate.policy` | Not structured as a recipe/policy object |
| `code_version` | `predicate.builder` | Informal — git_sha + node_version, no builder URI |
| (missing) | `predicateType` | No type discriminator — verifier can't programmatically identify this as a FORGE attestation |
| `schema` | `_type` | Close but not explicitly a type discriminator for the attestation envelope |

**Requirements**:

1. Add a `predicateType` field (value: `"https://forge.echelon.build/attestation/v0"` or equivalent FORGE-native URI) that identifies the attestation type programmatically
2. Restructure `input_hash` into a `subject`-like structure that carries both digest and an optional URI/identifier for the input
3. Restructure `output_hash` into a `subject`-like structure for the output
4. Group `policy_hash`, `rule_set_hash`, `policy_version_tag` under a `policy` object
5. Group `code_version` fields under a `builder` object with an explicit builder URI
6. Provide a pure-function converter: `toInTotoStatement(receipt) → valid in-toto Statement v1 JSON`
7. The converter is a separate utility, not in the receipt's critical path
8. Receipt v0 schema (`spec/receipt-v0.json`) updated to reflect new structure
9. All existing receipt tests updated; forge-verify updated to consume new shape
10. **Backward compatibility**: If any downstream consumer exists (check with Tobias), provide a migration note

**Decision rule**: This is pre-002 because it locks a cleaner attestation shape before 002 adds IR fields. Every field added in 002 will be attested through this shape.

> Sources: `Hardening and Prep of FORGE.md:44-53`, `deep-research-FORGE.md:193-219`, `spec/receipt-v0.json`

### FR-H2: Hermeticity Contract

**Problem**: FORGE claims deterministic output but has no written contract listing what inputs are allowed to affect it. `Date.now()` defaults in 20+ locations mean determinism depends on callers remembering to inject clocks — not on the system enforcing it.

**What to borrow from Bazel/Nix**:
- Enumerate all allowed inputs
- Identify and eliminate hidden inputs
- Require injected clocks where determinism matters
- Add replay/repeatability enforcement
- Treat replay drift as a real bug

**What to reject**:
- Build system migration
- Content-addressed store
- Nix derivation model

**Two-zone model**:

| Zone | Path | Determinism Requirement | Enforcement |
|------|------|------------------------|-------------|
| **Receipt-critical** | `ingest → classify → selectTemplates → emitEnvelope → buildReceipt` | **MUST** be deterministic for identical inputs + injected clock | Fail-closed: throw if clock not injected in deterministic mode |
| **Runtime** | `theatre create/process/expire/resolve`, `checkAdversarial`, `ForgeRuntime` | **SHOULD** support deterministic replay via injectable clocks | Document allowed inputs; all functions accept `opts.now`; no fail-closed enforcement |

**Allowed inputs (receipt-critical zone)**:

| Input | Source | How Identified |
|-------|--------|---------------|
| Raw feed data (bytes) | Fixture file or live feed | `input_hash` in receipt |
| Injected timestamp base | `options.timestampBase` | Used when feed lacks parseable timestamps |
| Injected wall clock | `options.now` | Used for `emitted_at` in envelope |
| Selector rules (RULES array) | `src/selector/rules.js` | `rule_set_hash` in receipt |
| Regulatory tables | `src/classifier/thresholds.js` imports | `policy_hash` in receipt |
| Code identity | git SHA + Node.js version | `code_version` in receipt |

**Known hidden input risks (must be documented and guarded)**:

| Hidden Input | Location | Risk | Current State |
|-------------|----------|------|---------------|
| `Date.now()` in ingester | `generic.js:185,225,320` | Timestamp fallback when no parseable timestamp found | Injectable via `timestampBase`; defaults to wall-clock |
| `Date.now()` in emitter | `emit.js` (via `now` param) | `emitted_at` field in envelope | Injectable via `now`; defaults to wall-clock |
| `Date.now()` in adversarial | `adversarial.js:65` | Clock comparison for drift check | Injectable via `context.now`; not in receipt-critical path |
| Node.js version | Runtime | Floating-point behavior may differ across versions | Documented in `code_version.node_version`; not enforced |
| Locale / timezone | Runtime | Could affect date parsing | [ASSUMPTION] Not used in classification path — verify |

**Requirements**:

1. Create `spec/HERMETICITY.md` — written contract listing all allowed inputs for receipt-critical zone
2. Add `deterministic: true` option to `ForgeConstruct.analyze()` that:
   - Requires `timestampBase` and `now` to be explicitly provided
   - Throws `Error('deterministic mode requires explicit timestampBase and now')` if either is missing
   - Does NOT change any output — only enforces that callers provide what they should
3. Add a deterministic replay gate test: run the same fixture twice with fixed clocks, assert byte-identical canonicalized output
4. Document the two-zone model in `spec/HERMETICITY.md`
5. `forge-verify` already uses `REPLAY_TIMESTAMP_BASE` and `REPLAY_NOW` constants — document these as the canonical replay injection values

**Decision rule**: This is pre-002 because 002's IR stability commitment is vacuous without a formal determinism contract. You can't promise "same input → same output" if the inputs aren't enumerated.

> Sources: `Hardening and Prep of FORGE.md:56-64`, `deep-research-FORGE.md:238-252`, `adversarial.js:65`, `generic.js:185-320`

### FR-H3: Adversarial Gate NaN Hardening

**Problem**: `checkAdversarial()` has a `Number.isFinite` guard on `bundle.value` (line 130) but no equivalent guard on `channel_a`, `channel_b`, `timestamp`, `lat`, `lon`, or `frozen_count`. When these fields are NaN, arithmetic comparisons evaluate to `false`, causing 5 of 6 checks to silently pass.

**Affected checks**:

| Check | Field(s) | NaN Behavior | Impact |
|-------|----------|-------------|--------|
| Channel A/B inconsistency | `channel_a`, `channel_b` | `NaN > threshold` → false → passes | Manipulated dual-channel sensors bypass detection |
| Frozen data | `frozen_count` | `NaN >= threshold` → false → passes | Replayed data bypasses detection |
| Clock drift | `timestamp` | `NaN > MAX_AGE_MS` → false → passes | Stale/future bundles bypass detection |
| Location spoofing | `lat`, `lon` | `NaN > MAX_COORD_DEVIATION_DEG` → false → passes | Spoofed coordinates bypass detection |
| Sybil sensors | `peer_values` | Array.every with NaN → depends on comparison | Partial bypass possible |
| Value out of range | `bundle.value` | Guarded with `Number.isFinite` | **Already fixed** |

**Requirements**:

1. Add `Number.isFinite` guards on all numeric fields before arithmetic in each check
2. Non-finite values → `{ clean: false, reason: 'invalid_{field}: must be finite number' }`
3. This is fail-closed: malformed input is rejected, not silently accepted
4. Add test cases: NaN, Infinity, -Infinity, undefined, string-that-looks-like-number for each guarded field

**Decision rule**: This is pre-002 because it's a fail-open correctness risk in an adversarial codepath. Small, local, clearly fit-aligned.

> Sources: `deep-research-FORGE.md:91-125`, `adversarial.js:64-138`

### FR-H4: Rationale String Bug Fix

**Problem**: `template-selector.js:146` produces rationale strings showing `conditions_total/conditions_total` instead of `conditions_met/conditions_total`. Every proposal's rationale claims all conditions matched regardless of actual match count.

**Current** (line 146):
```js
rationale: `Rule '${rule.id}' fired (${evaluation.conditions_total}/${evaluation.conditions_total} conditions). ` +
```

**Required**:
```js
rationale: `Rule '${rule.id}' fired (${evaluation.conditions_met}/${evaluation.conditions_total} conditions). ` +
```

**Requirements**:

1. Fix the string at `template-selector.js:146`
2. Add a test that asserts `conditions_met` appears in rationale when fewer than all conditions match (partial-confidence rule fire)

**Decision rule**: Removes auditability gap. One-line fix. Pre-002 by any measure.

> Sources: `deep-research-FORGE.md:136-148`, `template-selector.js:146`

### FR-H5: Docs/Code Contract Verification

**Problem**: The hardening prompt treats docs/code drift as a "real trust bug, not a cosmetic issue." No currently observed drift after live repo inspection (2026-04-12), but this is a point-in-time audit — not a permanent guarantee. Findings:

| Doc Claim | Code Reality | Status |
|-----------|-------------|--------|
| README: 699 tests | `npm run test:all` → 699 pass | **Match** |
| README: 684 unit tests | `npm run test:unit` → 684 pass | **Match** |
| README: v0.3.0 | `package.json: "0.3.0"` | **Match** |
| README: receipt/IR/runtime modules | All implemented and tested | **Match** |
| BUTTERFREEZONE: 684 unit tests | Actual count: 684 | **Match** |
| BUTTERFREEZONE: Receipt v0 schema | `spec/receipt-v0.json` exists | **Match** |
| spec/proposal-ir.json schema | Envelope emitter output | **Needs structural verification** |

**Requirements**:

1. Add a schema-validation test: emit an envelope and validate it against `spec/proposal-ir.json` using JSON Schema
2. Add a schema-validation test: build a receipt and validate it against `spec/receipt-v0.json`
3. If the receipt shape changes (FR-H1), update `spec/receipt-v0.json` (or version to `receipt-v1.json`) and BUTTERFREEZONE accordingly
4. After all hardening changes, verify test counts in README/BUTTERFREEZONE still match and update if changed

**Decision rule**: Prevents docs from promising more than code enforces. The schema-validation tests make this self-enforcing going forward.

> Sources: `Hardening and Prep of FORGE.md:107-109`, `deep-research-FORGE.md:78-89`

---

## 6. Narrow Borrowing Memo

### 6.1 SLSA / in-toto

**Exact problem solved by the original system**: Standardized attestation/provenance shapes for "how an artifact was produced," with verification against signed layouts and per-step link metadata.

**Exact lesson borrowed**: Attestation field discipline — explicit subject (output identity), explicit materials (input identity), explicit policy/recipe hash, explicit builder identity, and a type discriminator that lets tooling identify the attestation programmatically. Plus the verification discipline of parsing rules tied to deterministic canonicalization.

**Exact thing rejected**: Level chasing (SLSA L1-L4 compliance), multi-step layout verification (FORGE has one step), signed functionary chains (single signer is correct), transparency log publication, and the full in-toto platform. FORGE's seam is "classify → propose → emit" — not a multi-actor supply chain.

**Exact minimal FORGE adoption**: Restructure ProposalReceipt to be isomorphic to an in-toto Statement — same semantic fields, FORGE-native naming, with a pure-function `toInTotoStatement()` converter. Keep FORGE's existing crypto (ed25519, JCS-subset canonicalization) unchanged. Keep verification local (`forge-verify`).

### 6.2 Bazel / Nix

**Exact problem solved by the original system**: Eliminating hidden inputs from builds so identical inputs produce identical outputs. Content-addressed dependency identity. Hermetic execution environments.

**Exact lesson borrowed**: Hermeticity mindset — enumerate all allowed inputs, treat any non-injected environment dependence (time, locale, floating-point behavior) as a first-class bug in determinism-critical flows, and enforce this via tests that detect replay drift.

**Exact thing rejected**: Build system migration (Bazel), package manager migration (Nix), content-addressed store, derivation model, and sandbox execution. FORGE can adopt hermeticity thinking without adopting any toolchain.

**Exact minimal FORGE adoption**: Written hermeticity contract (`spec/HERMETICITY.md`) listing every allowed input for the receipt-critical zone. A `deterministic: true` option that fails closed if clocks aren't injected. A replay gate test asserting byte-identical output for identical inputs. Two-zone model separating receipt-critical (enforced) from runtime (documented, injectable).

---

## 7. Scope & Prioritization

### In Scope (Pre-002)

| Priority | Item | Files Affected | Effort |
|----------|------|---------------|--------|
| P0 | H-3: Adversarial NaN hardening | `src/trust/adversarial.js`, tests | Small — add guards to 5 checks |
| P0 | H-4: Rationale string fix | `src/selector/template-selector.js`, tests | Trivial — one line |
| P1 | H-2: Hermeticity contract | `spec/HERMETICITY.md`, `src/index.js`, tests | Medium — document + `deterministic` option + gate test |
| P1 | H-1: Receipt shape cleanup | `src/receipt/*.js`, `spec/receipt-v0.json`, `bin/forge-verify.js`, tests | Medium — restructure + converter + update all consumers |
| P2 | H-5: Docs/code contract tests | `test/unit/schema-validation.spec.js` (new), README/BUTTERFREEZONE updates | Small — schema validation tests |

### Out of Scope

- All 002 IR field additions (`normalization_trace`, `negative_policy_flags`, `original_hash`, `activation_policy`, `usefulness_breakdown`, `allocation_class`, `classifier_version`, `composed_trust`)
- All 003 items (difficulty scoring, adversarial red-team suite, usefulness weight calibration)
- All "Monitor / Revisit Later" items from the decision memo
- Any new infrastructure, runtime, or chain surface

### Explicit Non-Goals

- Public transparency log publication
- OpenLineage backend
- Dispute windows / bonds / arbitration
- Calibration scoreboards needing live theatre outcomes
- 002 IR fields unless required to support the pre-002 discipline layer

---

## 8. Technical Constraints

| Constraint | Source |
|-----------|--------|
| Zero external dependencies | `FORGE_PROGRAM.md:488`, security property |
| Node.js >= 20 | `package.json`, `spec/construct.json:59-60` |
| Deterministic classification | `FORGE_PROGRAM.md:492`, convergence invariant |
| AGPL-3.0 | `spec/construct.json:8` |
| Anti-cheating: classifier must not use source identity | `FORGE_PROGRAM.md:333-345` |
| `node:test` runner only | Zero-dep test infrastructure |
| Additive-only IR changes until v1.0 | `spec/STABILITY.md:39-48` |

---

## 9. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Receipt shape change breaks forge-verify | Medium | High | Update forge-verify in same PR; run all receipt tests |
| Receipt shape change breaks Tobias's bridge tests | Low | High | Receipt is FORGE-internal; Tobias consumes ProposalEnvelope, not receipt. Verify with him if unsure. |
| Hermeticity contract reveals hidden inputs in classification path | Low | Medium | If found, fix them — that's the point |
| NaN hardening changes adversarial gate behavior for existing bundles | Very Low | Low | Only affects bundles with non-finite values, which were already passing incorrectly |
| Test count changes require doc updates | Certain | Low | Update README/BUTTERFREEZONE test counts in same PR |

---

## 10. How This Pre-002 Discipline Sets Up Cycle 002

| 002 Item | How Pre-002 Helps |
|----------|-------------------|
| IR stability commitment | Hermeticity contract makes "same input → same output" a formal contract, not a vague claim. 002's stability commitment inherits this. |
| `normalization_trace` | Receipt shape cleanup gives normalization metadata a clean attestation surface — the trace becomes a declared material, not an opaque field. |
| `original_hash` | Hermeticity contract already enumerates raw input hashing. `original_hash` becomes a natural field in the attested materials. |
| `classifier_version` | Builder identity in the receipt already captures code identity. `classifier_version` extends this with independent semver for Pythia. |
| `negative_policy_flags` | Receipt shape's predicate/policy grouping gives policy violations a natural home alongside `policy_hash` and `rule_set_hash`. |
| Composed trust co-design | The `toInTotoStatement()` converter establishes the pattern for typed provenance composition — when Hermes-composed theatres need attestation, the shape is already interoperable. |
| Future typed provenance composition | FORGE-native but in-toto-isomorphic receipts can participate in multi-system provenance graphs without format conversion at the boundary. |

---

## 11. Decision Rules (from hardening prompt)

A change is **pre-002** only if it:
- Removes docs/code ambiguity
- Strengthens determinism/replay truthfulness
- Locks a cleaner attestation/provenance shape
- Reduces hidden-input risk
- Prevents 002 from building on unstable semantics
- Is small, local, and clearly fit-aligned

A change is **not pre-002** if it:
- Introduces new infrastructure
- Depends on live theatre outcomes
- Belongs to public observability rather than local correctness
- Belongs to downstream Echelon economics/dispute layers
- Expands scope just because it feels sophisticated

> Source: `Hardening and Prep of FORGE.md:218-238`

---

## 12. Repo Changes Required

After implementation, update:

| File | What Changes |
|------|-------------|
| `spec/receipt-v0.json` | Receipt schema reflects restructured fields (or version to `receipt-v1.json`) |
| `spec/HERMETICITY.md` | New file — hermeticity contract |
| `src/receipt/*.js` | Receipt builder, canonicalize updated for new shape |
| `src/trust/adversarial.js` | NaN guards on 5 additional fields |
| `src/selector/template-selector.js` | Rationale string fix (one line) |
| `src/index.js` | `deterministic: true` option threading |
| `bin/forge-verify.js` | Updated for new receipt shape |
| `README.md` | Test counts if changed; receipt shape documentation |
| `BUTTERFREEZONE.md` | Test counts if changed; receipt shape documentation |
| `FORGE_LEARNINGS_updated2.md` | Append entries for borrowed SLSA/in-toto lesson, borrowed Bazel/Nix lesson, why bulk rejected, what pre-002 discipline sets up for 002 |

> Source: `Hardening and Prep of FORGE.md:126-148`
