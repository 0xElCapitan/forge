# SDD: FORGE Pre-002 Hardening — Attestation & Hermeticity Discipline

**Cycle**: pre-002
**PRD**: grimoires/loa/prd.md
**Created**: 2026-04-12

---

## 1. Architecture Overview

FORGE Pre-002 Hardening is a discipline pass applied to the existing FORGE monolith (zero-dependency Node.js library). It restructures receipt attestation fields, introduces a hermeticity contract with a two-zone model, hardens adversarial checks against NaN/non-finite inputs, fixes a rationale string bug, and adds schema-validation tests as docs/code enforcement.

No new services, infrastructure, or runtime surfaces are introduced. All five hardening items are internal structural improvements to existing modules within `src/receipt/`, `src/trust/`, `src/selector/`, `src/ir/`, and `src/index.js`.

### 1.1 Affected Components

```
ingest → classify → selectTemplates → emitEnvelope → buildReceipt
  |           |              |                 |              |
  |           |         [H-4: rationale]  [H-2: det. mode]  [H-1: receipt shape]
  |           |                               |
  |     [H-2: contract doc]            [H-5: schema tests]
  |
[H-2: hidden input doc]     [H-3: adversarial NaN guards]
                              (src/trust/adversarial.js)
```

### 1.2 Key Change Surfaces

| Module | Change | Risk |
|--------|--------|------|
| `src/receipt/receipt-builder.js` | Restructured receipt shape: `predicateType`, `subject`, `materials`, `policy`, `builder` groups | Medium — all receipt consumers must update |
| `spec/receipt-v0.json` | Schema updated for new structure | Low — pre-stable v0 |
| `src/receipt/to-intoto.js` | New file: pure-function converter | None — additive |
| `bin/forge-verify.js` | Updated field paths for new receipt shape | Medium — must update in same PR |
| `src/trust/adversarial.js` | `Number.isFinite` guards on 5 fields | Low — fail-closed, only rejects malformed |
| `src/selector/template-selector.js` | One-line rationale string fix | None |
| `src/index.js` | `deterministic: true` validation gate | Low — validation only, no output change |
| `spec/HERMETICITY.md` | New file: hermeticity contract | None — documentation |

---

## 2. Software Stack

No additions. FORGE remains zero-dependency.

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Node.js | >= 20.0.0 |
| Test runner | `node:test` | Built-in |
| Crypto | `node:crypto` (ed25519, SHA-256) | Built-in |
| Serialization | JCS-subset/v0 | Internal (`src/receipt/canonicalize.js`) |
| Schema | JSON Schema draft/2020-12 | Spec files only |

---

## 3. Receipt Shape Restructuring (FR-H1)

### 3.1 Design Decision: In-Place v0 Evolution

The receipt shape evolves **within** `forge-receipt/v0`, not as a version bump to v1.

**Rationale**:
- Receipt is FORGE-internal. Tobias consumes ProposalEnvelope, not receipt (PRD §9).
- Receipt is at v0 — pre-stability. Shape improvements are expected before v1 locks.
- A version bump adds migration surface without benefit since no downstream consumer stores receipts.

**Carry-forward instruction**: "Receipt cleanup should be structurally stronger but migration-light." This design satisfies both: the structure improves (grouped fields, type discriminator, in-toto isomorphism) while the migration is minimal (same `forge-receipt/v0` schema identifier, no new consumers to update).

[ASSUMPTION] No downstream consumer stores or parses receipts beyond `forge-verify` and FORGE's own tests. Verify with Tobias before merging.

### 3.2 New Receipt Shape

```json
{
  "schema": "forge-receipt/v0",
  "predicateType": "https://forge.echelon.build/attestation/v0",
  "subject": {
    "digest": "sha256:...",
    "uri": null
  },
  "materials": {
    "digest": "sha256:...",
    "canonicalization": "jcs-subset/v0",
    "uri": null
  },
  "policy": {
    "policy_hash": "sha256:...",
    "rule_set_hash": "sha256:...",
    "version_tag": "forge-policy/v0.1.0"
  },
  "builder": {
    "uri": "https://forge.echelon.build/builder/v0",
    "git_sha": "abc123...",
    "package_lock_sha": null,
    "node_version": "20.11.1"
  },
  "computed_at": "2026-04-12T...",
  "http_transcript_receipts": null,
  "signer": "forge-production",
  "key_id": null,
  "signature": null
}
```

### 3.3 Field Migration Map

| Current Field | New Location | Notes |
|---|---|---|
| `output_hash` | `subject.digest` | Output is the subject (what was produced) |
| — | `subject.uri` | Nullable; reserved for future URI identity |
| `input_hash` | `materials.digest` | Input is a material (what was consumed) |
| `input_canonicalization` | `materials.canonicalization` | Moved into materials group |
| — | `materials.uri` | Nullable; reserved for future URI identity |
| `policy_hash` | `policy.policy_hash` | Grouped under policy |
| `rule_set_hash` | `policy.rule_set_hash` | Grouped under policy |
| `policy_version_tag` | `policy.version_tag` | Shortened key; grouped under policy |
| `code_version.git_sha` | `builder.git_sha` | `code_version` → `builder` |
| `code_version.package_lock_sha` | `builder.package_lock_sha` | Under builder |
| `code_version.node_version` | `builder.node_version` | Under builder |
| — | `builder.uri` | New: explicit builder identity URI |
| — | `predicateType` | New: type discriminator per in-toto pattern |

No field is removed — they are regrouped. Existing hash values are identical.

### 3.4 Signed Payload Update

The canonical signed payload becomes:

```js
const signedPayload = canonicalize({
  schema: receipt.schema,
  predicateType: receipt.predicateType,
  subject: receipt.subject,
  materials: receipt.materials,
  policy: receipt.policy,
  builder: receipt.builder,
  http_transcript_receipts: receipt.http_transcript_receipts,
  signer: receipt.signer,
});
```

This changes the signature. Since receipts are at v0 with no production signing deployed, this is acceptable.

### 3.5 `toInTotoStatement()` Converter

New file: `src/receipt/to-intoto.js`

Pure function that maps FORGE receipt to valid in-toto Statement v1 JSON. Separate utility, not in the receipt's critical path.

```js
export function toInTotoStatement(receipt) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: receipt.subject.uri ?? 'forge-output',
      digest: { sha256: receipt.subject.digest.replace('sha256:', '') },
    }],
    predicateType: receipt.predicateType,
    predicate: {
      builder: { id: receipt.builder.uri },
      metadata: {
        buildInvocationId: receipt.builder.git_sha,
        completeness: { parameters: true, environment: false, materials: true },
      },
      materials: [{
        uri: receipt.materials.uri ?? 'forge-input',
        digest: { sha256: receipt.materials.digest.replace('sha256:', '') },
      }],
      policy: {
        policy_hash: receipt.policy.policy_hash,
        rule_set_hash: receipt.policy.rule_set_hash,
        version_tag: receipt.policy.version_tag,
      },
    },
  };
}
```

### 3.6 Impact on `forge-verify`

Field path updates in `bin/forge-verify.js`:

| Old Path | New Path |
|----------|----------|
| `receipt.input_hash` | `receipt.materials.digest` |
| `receipt.output_hash` | `receipt.subject.digest` |
| `receipt.code_version?.node_version` | `receipt.builder?.node_version` |

Signed payload construction updated per §3.4. Schema check `receipt.schema !== 'forge-receipt/v0'` unchanged.

---

## 4. Hermeticity Contract (FR-H2)

### 4.1 Two-Zone Model

**Carry-forward instruction**: "Two-zone hermeticity is a current operational boundary, not a forever boundary." The contract explicitly documents a promotion path.

| Zone | Scope | Enforcement | Promotion Path |
|------|-------|-------------|----------------|
| **Receipt-critical** | `ingest → classify → selectTemplates → emitEnvelope → buildReceipt` | Fail-closed: `deterministic: true` throws if clocks not injected | Permanent — this zone only grows |
| **Runtime** | Theatre create/process/expire/resolve, `checkAdversarial`, `ForgeRuntime` | Documented: all functions accept `opts.now`; no fail-closed gate | Promotable: when a runtime function becomes receipt-relevant (e.g., composed attestation), it moves to receipt-critical zone with enforcement |

### 4.2 Allowed Inputs (Receipt-Critical Zone)

| Input | Source | Identified By |
|-------|--------|--------------|
| Raw feed data (bytes) | Fixture file or live feed | `materials.digest` in receipt |
| Injected timestamp base | `options.timestampBase` | Deterministic ingestion |
| Injected wall clock | `options.now` | Deterministic `emitted_at` |
| Selector rules (RULES array) | `src/selector/rules.js` | `policy.rule_set_hash` |
| Regulatory tables | Threshold classifier imports | `policy.policy_hash` |
| Code identity | Git SHA + Node.js version | `builder` in receipt |

Everything else is a hidden input.

### 4.3 `deterministic: true` Option

Added to `ForgeConstruct.analyze()` in `src/index.js`:

```js
if (deterministic) {
  if (timestampBase == null || now === undefined) {
    throw new Error('deterministic mode requires explicit timestampBase and now');
  }
}
```

Validation only. No output change. Fail-closed at entrypoint.

### 4.4 Deterministic Replay Gate Test

Extend `test/unit/determinism-gate.spec.js`:

1. Run same fixture twice with fixed clocks through full pipeline including `buildReceipt`
2. Assert byte-identical canonicalized receipt output
3. Test that `deterministic: true` throws when `timestampBase` or `now` is missing

### 4.5 `spec/HERMETICITY.md` Structure

1. Purpose — formal backing for determinism claim
2. Two-Zone Model — receipt-critical vs runtime
3. Allowed Inputs — exhaustive table
4. Hidden Input Risks — documented with locations
5. Enforcement — `deterministic: true` option
6. Replay Constants — `REPLAY_TIMESTAMP_BASE = 1700000000000`, `REPLAY_NOW = REPLAY_TIMESTAMP_BASE + 1000`
7. Promotion Path — explicit note on zone boundary evolution
8. `computed_at` Note — metadata-only, not in signed payload, not determinism-critical

### 4.6 Confirmed: No Locale/Timezone Hidden Input

Classification path (`classify()` in `src/classifier/feed-grammar.js`) operates on epoch-ms timestamps and numeric values. No `Date.toLocaleString()`, `Intl`, or timezone-dependent parsing found in the receipt-critical zone.

---

## 5. Adversarial Gate NaN Hardening (FR-H3)

### 5.1 Guard Placement

In `src/trust/adversarial.js`, `checkAdversarial()` (lines 64-138):

| Check | Fields to Guard | Insert Point | Current Line |
|-------|----------------|-------------|-------------|
| 1: Channel A/B | `channel_a`, `channel_b` | After null check (line 68), before arithmetic (line 72) | 68-80 |
| 2: Frozen data | `frozen_count` | After null check (line 83), before comparison | 83-88 |
| 3: Clock drift | `timestamp` | After null check (line 91), before arithmetic (line 92) | 91-101 |
| 4: Location | `lat`, `lon` | After null check (line 104), before arithmetic (line 105) | 104-114 |
| 5: Sybil sensors | `peer_values` elements | After array check (line 118), before `.every()` (line 120) | 118-127 |
| 6: Value range | `value` | **Already guarded** (line 130) | 130-135 |

### 5.2 Guard Pattern

```js
if (fieldValue != null && !Number.isFinite(fieldValue)) {
  return { clean: false, reason: `invalid_{field}: must be finite number` };
}
```

For multi-field checks (channel_a + channel_b, lat + lon): guard both before the arithmetic block. For array (peer_values): filter non-finite values and reject if any found.

### 5.3 Test Cases

For each guarded field, test: `NaN`, `Infinity`, `-Infinity`, `undefined`, `"42"`. Each must produce `{ clean: false }`. Add to `test/unit/trust.spec.js`.

---

## 6. Rationale String Fix (FR-H4)

### 6.1 The Fix

`src/selector/template-selector.js:146`:

```diff
- rationale: `Rule '${rule.id}' fired (${evaluation.conditions_total}/${evaluation.conditions_total} conditions). ` +
+ rationale: `Rule '${rule.id}' fired (${evaluation.conditions_met}/${evaluation.conditions_total} conditions). ` +
```

### 6.2 Test

Add assertion in `test/unit/selector.spec.js` that the rationale string contains `conditions_met` (not `conditions_total` repeated) in the first numeric position.

---

## 7. Docs/Code Contract Tests (FR-H5)

### 7.1 New Test File

`test/unit/schema-validation.spec.js`:

1. **Envelope schema validation**: `emitEnvelope()` output validated against `spec/proposal-ir.json`
2. **Receipt schema validation**: `buildReceipt()` output validated against `spec/receipt-v0.json` (updated)

### 7.2 Post-Hardening Doc Updates

| File | Update |
|------|--------|
| `README.md` | Test counts (estimated ~735 total) |
| `BUTTERFREEZONE.md` | Test counts, receipt shape docs |
| `spec/receipt-v0.json` | Updated schema for new structure |
| `FORGE_LEARNINGS_updated2.md` | Append: SLSA/in-toto lesson borrowed, Bazel/Nix lesson borrowed, why bulk rejected, how pre-002 sets up 002 |

---

## 8. Development Phases

### Phase 1: Local Fixes (P0 — No Shape Changes)

1. **H-4**: Rationale string fix — one line at `template-selector.js:146` + test
2. **H-3**: Adversarial NaN hardening — `Number.isFinite` guards on 5 checks + ~25 tests

Single commit/PR. No interface changes. No downstream risk.

### Phase 2: Hermeticity Contract (P1 — Documentation + Validation)

1. Create `spec/HERMETICITY.md`
2. Add `deterministic: true` option to `src/index.js`
3. Add deterministic replay gate test for receipts
4. Document replay constants

Single commit/PR. Adds documentation and validation gate. No output changes.

### Phase 3: Receipt Shape Restructuring (P1 — Core Shape Change)

Order matters:

1. Update `spec/receipt-v0.json` schema
2. Update `src/receipt/receipt-builder.js` — new shape + signed payload
3. Create `src/receipt/to-intoto.js` — converter
4. Update `bin/forge-verify.js` — new field paths
5. Update all receipt tests
6. Add `to-intoto.spec.js`
7. Export `toInTotoStatement` from `src/index.js`

Single PR. All receipt-touching changes together to avoid partial migration state.

### Phase 4: Contract Verification + Cleanup (P2)

1. Add `test/unit/schema-validation.spec.js`
2. Update README.md, BUTTERFREEZONE.md test counts
3. Append to FORGE_LEARNINGS_updated2.md
4. Final `npm run test:all` pass

---

## 9. Testing Strategy

### 9.1 New and Modified Tests

| Test File | Type | Changes |
|---|---|---|
| `test/unit/trust.spec.js` | Modified | NaN/Infinity/non-finite tests for 5 adversarial checks (~25 tests) |
| `test/unit/selector.spec.js` | Modified | Rationale string content assertion (1 test) |
| `test/unit/receipt-builder.spec.js` | Modified | Updated field paths for new receipt shape |
| `test/unit/forge-verify.spec.js` | Modified | Updated field paths |
| `test/unit/to-intoto.spec.js` | New | Converter produces valid in-toto shape (~4 tests) |
| `test/unit/schema-validation.spec.js` | New | Envelope + receipt schema validation (2 tests) |
| `test/unit/determinism-gate.spec.js` | Modified | Receipt-level determinism + `deterministic: true` enforcement (~3 tests) |
| `test/integration/receipt-pipeline.spec.js` | Modified | Updated for new receipt shape |

### 9.2 Estimated Test Count

Current: 699 total. Estimated additions: ~36 new tests. New total: ~735.

---

## 10. Open Questions

| Question | Owner | Status |
|---|---|---|
| Does Tobias/Echelon parse or store ProposalReceipts? | El Capitan | Open — verify before Phase 3 |
| Should `computed_at` accept injectable clock for full determinism? | Architect | [ASSUMPTION] Metadata-only, excluded from signed payload |
| Should `builder.uri` be `"https://forge.echelon.build/builder/v0"` or different scheme? | El Capitan | Open — proposed value follows predicateType pattern |
| Keep `additionalProperties: false` in updated receipt schema? | Architect | Recommend yes — receipt strictness |
