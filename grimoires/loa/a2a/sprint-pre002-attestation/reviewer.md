# Implementation Report: sprint-pre002-attestation

**Sprint**: sprint-pre002-attestation
**Cycle**: pre-002
**FR**: H-1 (Receipt shape audit + attestation field cleanup)
**Date**: 2026-04-12

---

## Executive Summary

Completed all 8 tasks for sprint-pre002-attestation. The ProposalReceipt v0 shape has been restructured from flat bespoke fields to attestation-aligned grouped structures (`subject`, `materials`, `policy`, `builder`) with a `predicateType` discriminator. A pure-function `toInTotoStatement()` converter enables mechanical mapping to in-toto Statement v1 format. All receipt consumers (receipt-builder, forge-verify, tests, integration tests) updated atomically — no partial migration.

**743 tests pass. 0 failures.**

---

## Tasks Completed

### Task 3.1: Update receipt schema

**File**: `spec/receipt-v0.json`
**Approach**: Evolved schema in-place within `forge-receipt/v0` (not a version bump — receipt is pre-stable, no downstream consumers store it). Replaced flat fields with grouped objects per SDD §3.2.

**Changes**:
- `required` array: `["schema", "predicateType", "subject", "materials", "policy", "builder", "computed_at", "signer", "key_id", "signature"]`
- Added `predicateType` (const: `"https://forge.echelon.build/attestation/v0"`)
- Added `subject` object: `{ digest, uri }` — output identity
- Added `materials` object: `{ digest, canonicalization, uri }` — input identity
- Added `policy` object: `{ policy_hash, rule_set_hash, version_tag }` — policy group
- Added `builder` object: `{ uri, git_sha, package_lock_sha, node_version }` — code identity
- Removed flat `input_hash`, `input_canonicalization`, `output_hash`, `code_version`, `policy_hash`, `rule_set_hash`, `policy_version_tag` from schema
- All objects have `additionalProperties: false`

### Task 3.2: Restructure receipt builder

**File**: `src/receipt/receipt-builder.js`
**Approach**: Updated `buildReceipt()` to assemble the new grouped shape. Signed payload updated per SDD §3.4.

**Key changes**:
- Receipt assembly now produces `{ schema, predicateType, subject, materials, policy, builder, computed_at, ... }`
- `builder.uri` set to `"https://forge.echelon.build/builder/v0"`
- Signed payload uses grouped fields: `{ schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer }`
- No flat `input_hash`, `output_hash`, `code_version` fields emitted

### Task 3.3: Create in-toto converter

**File**: `src/receipt/to-intoto.js` (new)
**Approach**: Pure function per SDD §3.5. Maps FORGE receipt fields to in-toto Statement v1 JSON. Not in receipt's critical path.

**Mapping**:
- `_type`: `"https://in-toto.io/Statement/v1"`
- `subject[0]`: `{ name: receipt.subject.uri ?? 'forge-output', digest: { sha256: <bare hex> } }`
- `predicateType`: passthrough from receipt
- `predicate.builder.id`: from `receipt.builder.uri`
- `predicate.materials[0]`: `{ uri: receipt.materials.uri ?? 'forge-input', digest: { sha256: <bare hex> } }`
- `predicate.policy`: passthrough from receipt
- `predicate.metadata`: `{ buildInvocationId: git_sha, completeness: {...} }`

### Task 3.4: Update forge-verify

**File**: `bin/forge-verify.js`
**Field path updates**:
- `receipt.input_hash` → `receipt.materials.digest` (line 67)
- `receipt.output_hash` → `receipt.subject.digest` (lines 128, 134, 154, 162)
- `receipt.code_version?.node_version` → `receipt.builder?.node_version` (lines 112-116)
- Signed payload reconstruction updated to grouped fields (lines 82-93)

### Task 3.5: Update receipt-builder tests

**File**: `test/unit/receipt-builder.spec.js`
**Changes**:
- `validateReceipt()` helper completely rewritten for new field paths
- All `receipt.input_hash` → `receipt.materials.digest`
- All `receipt.output_hash` → `receipt.subject.digest`
- All `receipt.code_version` → `receipt.builder`
- Added new assertions: `predicateType`, `subject.uri`, `materials.canonicalization`, `policy.*`, `builder.uri`
- Added test: "no flat fields remain" — verifies `input_hash`, `output_hash`, `code_version`, `policy_hash`, `rule_set_hash`, `policy_version_tag` are all `undefined`

### Task 3.6: Update forge-verify tests

**File**: `test/unit/forge-verify.spec.js`
**Changes**:
- `receipt.output_hash = ...` → `receipt.subject.digest = ...` (MISMATCH test)
- `receipt.code_version.node_version` → `receipt.builder.node_version` (warning test)

### Task 3.7: Create converter tests

**File**: `test/unit/to-intoto.spec.js` (new, 7 tests)
**Tests**:
1. Produces correct `_type: "https://in-toto.io/Statement/v1"`
2. `subject` is array with `name` and `digest.sha256` (bare 64-char hex)
3. `predicate.materials` is array with `uri` and `digest.sha256` (bare hex)
4. `predicate.builder.id` matches `receipt.builder.uri`
5. `predicateType` matches receipt predicateType
6. `predicate.policy` preserves all receipt policy fields
7. `predicate.metadata.buildInvocationId` from `git_sha` with completeness flags

### Task 3.8: Export converter from index

**File**: `src/index.js`
**Change**: Added `export { toInTotoStatement } from './receipt/to-intoto.js'` and `export { buildReceipt } from './receipt/receipt-builder.js'` in Receipt export section.

### Additional: Dependent test updates

- **`test/unit/determinism-gate.spec.js:233-244`**: Updated signed payload reconstruction from flat fields to grouped fields
- **`test/integration/receipt-pipeline.spec.js:149-150`**: Updated G-2 required fields from old flat list to new grouped list

---

## Technical Highlights

### Architecture
- Receipt shape now isomorphic to in-toto Statement v1 — same semantic fields, FORGE-native naming
- Grouped fields (`subject`, `materials`, `policy`, `builder`) align with attestation vocabulary
- `predicateType` enables programmatic identification of FORGE attestations
- `toInTotoStatement()` is a separate utility, not in the signed/verified path

### Security
- Signed payload updated atomically with shape change — signature covers `{ schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer }`
- `computed_at` remains excluded from signed payload (metadata only)
- `additionalProperties: false` on all schema objects — strict receipt validation

### Backward Compatibility
- Receipt evolves within `forge-receipt/v0` (no version bump) per SDD §3.1
- No downstream consumer stores receipts — Tobias/Echelon consumes ProposalEnvelope only
- `emitEnvelope({ receipt: false })` path unchanged

---

## Testing Summary

| Test File | Tests | Status |
|-----------|-------|--------|
| `test/unit/receipt-builder.spec.js` | 14 | Pass |
| `test/unit/forge-verify.spec.js` | 10 | Pass |
| `test/unit/to-intoto.spec.js` | 7 (new) | Pass |
| `test/unit/determinism-gate.spec.js` | Updated | Pass |
| `test/integration/receipt-pipeline.spec.js` | Updated | Pass |
| **Full suite** | **743 total** | **0 failures** |

**How to run**: `npm run test:all`

---

## Known Limitations

1. `builder.uri` and `predicateType` URIs are provisional (`https://forge.echelon.build/...`) — may change before v1 stable
2. `subject.uri` and `materials.uri` are null at v0 — reserved for future URI identity
3. `docs/echelon-integration.md:37` references `receipt.output_hash` — this is a documentation file outside the sprint scope (sprint-pre002-contract-tests will handle doc updates)
4. Test count increased from 699 → 743 — doc updates (README, BUTTERFREEZONE) deferred to sprint-pre002-contract-tests

---

## Verification Steps

```bash
# 1. Run full test suite
npm run test:all
# Expected: 743 tests, 0 failures

# 2. Verify receipt shape
node -e "
  import { buildReceipt } from './src/receipt/receipt-builder.js';
  import { ingest } from './src/ingester/generic.js';
  import { classify } from './src/classifier/feed-grammar.js';
  import { selectTemplates } from './src/selector/template-selector.js';
  import { emitEnvelope } from './src/ir/emit.js';
  import { readFileSync } from 'fs';
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(raw, { timestampBase: 1700000000000 });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({ feed_id: 'test', feed_profile: profile, proposals, now: 1700000001000 });
  const receipt = buildReceipt({ rawInput: raw, envelope });
  console.log(Object.keys(receipt));
  console.log('predicateType:', receipt.predicateType);
  console.log('subject.digest:', receipt.subject.digest.slice(0,20)+'...');
  console.log('materials.digest:', receipt.materials.digest.slice(0,20)+'...');
  console.log('builder.uri:', receipt.builder.uri);
"

# 3. Verify in-toto converter
node -e "
  import { toInTotoStatement } from './src/receipt/to-intoto.js';
  import { buildReceipt } from './src/receipt/receipt-builder.js';
  import { ingest } from './src/ingester/generic.js';
  import { classify } from './src/classifier/feed-grammar.js';
  import { selectTemplates } from './src/selector/template-selector.js';
  import { emitEnvelope } from './src/ir/emit.js';
  import { readFileSync } from 'fs';
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(raw, { timestampBase: 1700000000000 });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({ feed_id: 'test', feed_profile: profile, proposals, now: 1700000001000 });
  const receipt = buildReceipt({ rawInput: raw, envelope });
  const stmt = toInTotoStatement(receipt);
  console.log(JSON.stringify(stmt, null, 2));
"

# 4. Verify no flat fields remain
node -e "
  import { buildReceipt } from './src/receipt/receipt-builder.js';
  import { ingest } from './src/ingester/generic.js';
  import { classify } from './src/classifier/feed-grammar.js';
  import { selectTemplates } from './src/selector/template-selector.js';
  import { emitEnvelope } from './src/ir/emit.js';
  import { readFileSync } from 'fs';
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(raw, { timestampBase: 1700000000000 });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({ feed_id: 'test', feed_profile: profile, proposals, now: 1700000001000 });
  const receipt = buildReceipt({ rawInput: raw, envelope });
  const banned = ['input_hash', 'output_hash', 'code_version', 'input_canonicalization', 'policy_hash', 'rule_set_hash', 'policy_version_tag'];
  banned.forEach(f => { if (f in receipt) throw new Error('Flat field still present: ' + f); });
  console.log('No flat fields remain ✓');
"
```

---

## Acceptance Criteria

- [x] `buildReceipt()` output has `predicateType`, `subject.digest`, `materials.digest`, `policy.*`, `builder.*`
- [x] No flat `input_hash`, `output_hash`, `code_version` fields remain in receipt
- [x] `toInTotoStatement(receipt)` produces valid in-toto v1 JSON with correct `_type`
- [x] `forge-verify` replay verification produces MATCH with new receipt shape
- [x] All receipt tests (builder, verify, pipeline) pass with new field paths
- [x] `npm run test:all` green (743 pass, 0 fail)
