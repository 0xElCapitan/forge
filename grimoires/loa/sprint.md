# Sprint Plan: FORGE Pre-002 Hardening — Attestation & Hermeticity Discipline

**Cycle**: pre-002
**PRD**: grimoires/loa/prd.md
**SDD**: grimoires/loa/sdd.md
**Created**: 2026-04-12
**Sprints**: 4 (sprint-pre002-local-hardening, sprint-pre002-hermeticity, sprint-pre002-attestation, sprint-pre002-contract-tests)
**Total FRs**: 5 (H-1 through H-5)

---

## Sprint Overview

```
sprint-pre002-local-hardening   [P0, 3 tasks, SMALL]
    │
    ▼
sprint-pre002-hermeticity       [P1, 5 tasks, MEDIUM]
    │
    ▼
sprint-pre002-attestation       [P1, 8 tasks, LARGE]
    │
    ▼
sprint-pre002-contract-tests    [P2, 4 tasks, SMALL]
```

---

## Goals → Sprint Mapping

| Goal ID | Goal | Sprint |
|---------|------|--------|
| G-1 | Receipt shape FORGE-native but in-toto convertible | sprint-pre002-attestation |
| G-2 | Hermeticity contract exists and enforced | sprint-pre002-hermeticity |
| G-3 | Docs match code | sprint-pre002-contract-tests |
| G-4 | Adversarial gate fails closed on NaN | sprint-pre002-local-hardening |
| G-5 | Rationale string bug fixed | sprint-pre002-local-hardening |

---

## sprint-pre002-local-hardening

**Size**: SMALL (3 tasks)
**Priority**: P0
**Dependencies**: None
**FRs**: H-3 (adversarial NaN hardening), H-4 (rationale string fix)
**Risk**: Very low — no interface changes, no downstream impact

### Tasks

#### Task 1.1: Fix rationale string bug

**File**: `src/selector/template-selector.js:146`
**FR**: H-4
**Change**: Replace `evaluation.conditions_total` with `evaluation.conditions_met` in first position of rationale template string
**Test**: Add assertion in `test/unit/selector.spec.js` that rationale contains `conditions_met/conditions_total`

#### Task 1.2: Add NaN guards to adversarial gate

**File**: `src/trust/adversarial.js`
**FR**: H-3
**Change**: Add `Number.isFinite` guards before arithmetic in 5 checks:

| Check | Fields | Insert After |
|-------|--------|-------------|
| 1: Channel A/B | `channel_a`, `channel_b` | Line 68 (null check) |
| 2: Frozen data | `frozen_count` | Line 83 (null check) |
| 3: Clock drift | `timestamp` | Line 91 (null check) |
| 4: Location | `lat`, `lon` | Line 104 (null check) |
| 5: Sybil | `peer_values` elements | Line 118 (array check) |

Pattern: `if (val != null && !Number.isFinite(val)) return { clean: false, reason: 'invalid_{field}: must be finite number' }`

#### Task 1.3: Add NaN test cases

**File**: `test/unit/trust.spec.js`
**FR**: H-3, H-4
**Change**: ~25 new tests — for each guarded field test with: `NaN`, `Infinity`, `-Infinity`, `undefined`, `"42"` (string). Each must produce `{ clean: false }`.

### Acceptance Criteria

- [x] `checkAdversarial({ channel_a: NaN, channel_b: 10 })` → `{ clean: false }`
- [x] `checkAdversarial({ timestamp: NaN }, { now: 1700000000000 })` → `{ clean: false }`
- [x] `checkAdversarial({ lat: Infinity }, { registered_lat: 37 })` → `{ clean: false }`
- [x] Rationale string shows `conditions_met/conditions_total` (not `total/total`)
- [x] All 699 existing tests still pass
- [x] `npm run test:all` green

---

## sprint-pre002-hermeticity

**Size**: MEDIUM (5 tasks)
**Priority**: P1
**Dependencies**: sprint-pre002-local-hardening
**FRs**: H-2 (hermeticity contract)
**Risk**: Low — validation only, no output change

### Tasks

#### Task 2.1: Create `spec/HERMETICITY.md`

**File**: `spec/HERMETICITY.md` (new)
**FR**: H-2
**Sections**:
1. Purpose — formal backing for determinism claim
2. Two-Zone Model — receipt-critical (enforced) vs runtime (documented, promotable)
3. Allowed Inputs — raw feed data, timestampBase, now, RULES, regulatory tables, code identity
4. Hidden Input Risks — `Date.now()` defaults in ingester/emitter/adversarial/theatres
5. Enforcement — `deterministic: true` option
6. Replay Constants — `REPLAY_TIMESTAMP_BASE = 1700000000000`, `REPLAY_NOW = 1700000001000`
7. Promotion Path — runtime zone can promote to receipt-critical when needed
8. `computed_at` — metadata-only, not in signed payload, not determinism-critical

#### Task 2.2: Add `deterministic: true` validation gate

**File**: `src/index.js`
**FR**: H-2
**Change**: In `analyze()` options destructuring, add `deterministic = false`. If true, throw `Error('deterministic mode requires explicit timestampBase and now')` when either is missing. Validation only — no output change.

#### Task 2.3: Receipt-level deterministic replay gate test

**File**: `test/unit/determinism-gate.spec.js`
**FR**: H-2
**Change**: Run same fixture twice with fixed `timestampBase` and `now` through full pipeline including `buildReceipt`. Assert byte-identical canonicalized receipt output (not just envelope).

#### Task 2.4: Test `deterministic: true` enforcement

**File**: `test/unit/determinism-gate.spec.js`
**FR**: H-2
**Change**: Assert `deterministic: true` throws when `timestampBase` missing, when `now` missing, and succeeds when both provided.

#### Task 2.5: Document replay constants

**File**: `spec/HERMETICITY.md`
**FR**: H-2
**Change**: Document that `forge-verify` uses `REPLAY_TIMESTAMP_BASE = 1700000000000` and `REPLAY_NOW = REPLAY_TIMESTAMP_BASE + 1000` as canonical replay injection values. These are the values any verifier must use for replay.

### Acceptance Criteria

- [x] `spec/HERMETICITY.md` exists with two-zone model and allowed inputs table
- [x] `forge.analyze(fixture, { deterministic: true })` throws descriptive error
- [x] `forge.analyze(fixture, { deterministic: true, timestampBase: X, now: Y })` succeeds
- [x] Two runs with identical fixed clocks produce byte-identical canonicalized receipt
- [x] Promotion path language explicitly states two-zone boundary is pragmatic, not permanent
- [x] `npm run test:all` green

---

## sprint-pre002-attestation

**Size**: LARGE (8 tasks)
**Priority**: P1
**Dependencies**: sprint-pre002-hermeticity
**FRs**: H-1 (receipt shape audit + attestation field cleanup)
**Risk**: Medium — largest change; all receipt consumers must update together
**Critical constraint**: All receipt-touching changes land in same PR. No partial migration.

**Confirmed**: Tobias/Echelon does NOT consume ProposalReceipt directly. All integration points reference ProposalEnvelope. Migration is light.

### Tasks

#### Task 3.1: Update receipt schema

**File**: `spec/receipt-v0.json`
**FR**: H-1
**Change**: Add `predicateType` (required string). Restructure:
- `output_hash` → `subject` object with `digest` (required) + `uri` (nullable)
- `input_hash` + `input_canonicalization` → `materials` object with `digest`, `canonicalization`, `uri`
- `policy_hash` + `rule_set_hash` + `policy_version_tag` → `policy` object
- `code_version` → `builder` object with added `uri` field
- Remove old flat fields from `required`

#### Task 3.2: Restructure receipt builder

**File**: `src/receipt/receipt-builder.js`
**FR**: H-1
**Change**: `buildReceipt()` returns new shape:
```js
{
  schema: 'forge-receipt/v0',
  predicateType: 'https://forge.echelon.build/attestation/v0',
  subject: { digest: outputHash, uri: null },
  materials: { digest: inputHash, canonicalization: 'jcs-subset/v0', uri: null },
  policy: { policy_hash, rule_set_hash, version_tag },
  builder: { uri: 'https://forge.echelon.build/builder/v0', git_sha, package_lock_sha, node_version },
  computed_at, http_transcript_receipts, signer, key_id, signature
}
```
Update signed payload to match new field structure.

#### Task 3.3: Create in-toto converter

**File**: `src/receipt/to-intoto.js` (new)
**FR**: H-1
**Change**: Pure function `toInTotoStatement(receipt)` producing valid in-toto Statement v1 JSON. Maps `subject.digest` → in-toto `subject[0].digest`, `materials` → `predicate.materials[0]`, `policy` + `builder` → `predicate`.

#### Task 3.4: Update forge-verify

**File**: `bin/forge-verify.js`
**FR**: H-1
**Change**: Update all field access paths:
- `receipt.input_hash` → `receipt.materials.digest`
- `receipt.output_hash` → `receipt.subject.digest`
- `receipt.code_version?.node_version` → `receipt.builder?.node_version`
- Signed payload reconstruction matches new shape

#### Task 3.5: Update receipt-builder tests

**File**: `test/unit/receipt-builder.spec.js`
**FR**: H-1
**Change**: All assertions updated for new field paths. Validate `predicateType`, `subject.digest`, `materials.digest`, `policy.*`, `builder.*`.

#### Task 3.6: Update forge-verify tests

**File**: `test/unit/forge-verify.spec.js`
**FR**: H-1
**Change**: Mock receipt fixtures updated for new shape. All field path assertions updated.

#### Task 3.7: Create converter tests

**File**: `test/unit/to-intoto.spec.js` (new)
**FR**: H-1
**Change**: ~4 tests:
- Produces `_type: "https://in-toto.io/Statement/v1"`
- `subject` is array with `name` and `digest.sha256`
- `predicate.materials` is array with `uri` and `digest.sha256`
- `predicate.builder.id` matches `receipt.builder.uri`

#### Task 3.8: Export converter from index

**File**: `src/index.js`
**FR**: H-1
**Change**: Add `toInTotoStatement` to exports (alongside existing receipt module exports).

### Acceptance Criteria

- [x] `buildReceipt()` output has `predicateType`, `subject.digest`, `materials.digest`, `policy.*`, `builder.*`
- [x] No flat `input_hash`, `output_hash`, `code_version` fields remain in receipt
- [x] `toInTotoStatement(receipt)` produces valid in-toto v1 JSON with correct `_type`
- [x] `forge-verify` replay verification produces MATCH with new receipt shape
- [x] All receipt tests (builder, verify, pipeline) pass with new field paths
- [x] `npm run test:all` green

---

## sprint-pre002-contract-tests

**Size**: SMALL (4 tasks)
**Priority**: P2
**Dependencies**: sprint-pre002-attestation
**FRs**: H-5 (docs/code contract verification)
**Risk**: Low — additive tests and documentation

### Tasks

#### Task 4.1: Add schema validation tests

**File**: `test/unit/schema-validation.spec.js` (new)
**FR**: H-5
**Change**: Two tests:
1. Emit an envelope via `emitEnvelope()` → validate against `spec/proposal-ir.json` schema
2. Build a receipt via `buildReceipt()` → validate against updated `spec/receipt-v0.json` schema

#### Task 4.2: Update docs with final counts

**Files**: `README.md`, `BUTTERFREEZONE.md`
**FR**: H-5
**Change**: Update test counts to match actual `npm run test:all` output (~735). Update receipt shape documentation to reflect new structure (grouped fields, `predicateType`).

#### Task 4.3: Append learnings log entries

**File**: `grimoires/loa/context/FORGE/FORGE_LEARNINGS_updated2.md`
**FR**: H-5
**Change**: Append dated entries preserving existing log format:
- `[2026-04-XX] TECHNICAL: SLSA/in-toto lesson borrowed — attestation field discipline (predicateType, subject/materials/policy/builder). Full supply-chain platform rejected.`
- `[2026-04-XX] TECHNICAL: Bazel/Nix lesson borrowed — hermeticity contract (spec/HERMETICITY.md), deterministic mode enforcement, replay gate test. Toolchain migration rejected.`
- `[2026-04-XX] TECHNICAL: Pre-002 discipline sets up 002 — receipt shape cleanup gives IR additions cleaner attestation surface; hermeticity contract backs IR stability commitment; NaN hardening closes adversarial fail-open.`

#### Task 4.E2E: End-to-end goal validation

**FR**: All (G-1 through G-5)
**Change**: Run final validation:
- G-1: `toInTotoStatement(buildReceipt(...))` produces valid in-toto v1 JSON
- G-2: `spec/HERMETICITY.md` exists; `deterministic: true` gate works; replay identical
- G-3: `npm run test:all` count matches README/BUTTERFREEZONE; schema-validation tests pass
- G-4: All 6 adversarial checks reject NaN
- G-5: Rationale strings show `conditions_met/conditions_total`

### Acceptance Criteria

- [x] `schema-validation.spec.js` validates envelope and receipt against their JSON schemas
- [x] README test count matches actual `npm run test:all` output
- [x] BUTTERFREEZONE test count matches
- [x] FORGE_LEARNINGS entries appended (not rewritten)
- [x] All ~735 tests pass (actual: 750)
- [x] All 5 PRD goals validated (G-1 through G-5 PASS)

---

## Assumptions

| # | Assumption | Impact If Wrong |
|---|-----------|----------------|
| 1 | No downstream consumer stores ProposalReceipt beyond forge-verify + tests | Receipt shape change needs migration note for Tobias |
| 2 | `computed_at` is metadata-only, excluded from signed payload | Full determinism requires injectable clock for `computed_at` |
| 3 | `builder.uri` value follows predicateType URI pattern | Easy to change at v0 |
| 4 | No locale/timezone in classification path | Hidden input found → fix in sprint-pre002-hermeticity |

## Risk Register

| Risk | Sprint | Probability | Impact | Mitigation |
|------|--------|-------------|--------|------------|
| Receipt shape breaks forge-verify | attestation | Certain | High | Update in same PR; run all receipt tests |
| Signed payload change invalidates test receipts | attestation | Certain | Low | v0 pre-stable; update test fixtures |
| Determinism gate reveals hidden input | hermeticity | Low | Medium | Fix the hidden input — that's the point |
| NaN hardening changes adversarial behavior | local-hardening | Very Low | Low | Only rejects malformed inputs (were bugs) |
| Test count changes require doc updates | contract-tests | Certain | Low | Final sprint handles all doc updates |
