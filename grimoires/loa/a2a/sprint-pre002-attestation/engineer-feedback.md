# Engineer Feedback: sprint-pre002-attestation

**Reviewer**: Senior Tech Lead
**Date**: 2026-04-12
**Verdict**: All good (with noted concerns)

Sprint approved. All 6 acceptance criteria verified against code. Signed payload consistent across all 3 locations and SDD. Field migration complete. Concerns documented below are non-blocking — the most actionable item is adding `uri` to `builder.required` in the schema.

---

## Acceptance Criteria Verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| AC-1 | `buildReceipt()` output has `predicateType`, `subject.digest`, `materials.digest`, `policy.*`, `builder.*` | PASS | `receipt-builder.js:55-83` assembles all grouped fields |
| AC-2 | No flat `input_hash`, `output_hash`, `code_version` fields remain | PASS | `receipt-builder.spec.js:173-183` asserts all 7 flat fields are `undefined` |
| AC-3 | `toInTotoStatement(receipt)` produces valid in-toto v1 JSON | PASS | `to-intoto.spec.js:41-97` validates `_type`, subject array, materials array, builder.id |
| AC-4 | `forge-verify` replay produces MATCH with new shape | PASS | `forge-verify.js:67,110,126,152` use new paths; 3-domain MATCH tests pass |
| AC-5 | All receipt tests pass with new field paths | PASS | receipt-builder (14), forge-verify (10), to-intoto (7), determinism-gate + pipeline updated |
| AC-6 | `npm run test:all` green | PASS | 743 pass, 0 fail |

## Signed Payload Consistency (3-way check)

| Location | Fields |
|----------|--------|
| `receipt-builder.js:88-97` | schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer |
| `forge-verify.js:82-91` | schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer |
| `determinism-gate.spec.js:233-241` | schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer |

**CONSISTENT.** All three match SDD §3.4.

---

## Adversarial Analysis

### Concerns Identified (5, all non-blocking)

1. **`builder.uri` not in schema `required`** — `spec/receipt-v0.json:94`: `builder.required` is `["git_sha", "package_lock_sha", "node_version"]`. But `to-intoto.js:27` maps `receipt.builder.uri` to `predicate.builder.id` with no fallback. Schema permits a receipt without `uri`, which would produce an invalid in-toto statement. The builder always sets it (`receipt-builder.js:73`), so this is not a runtime bug today. **Recommendation**: Add `"uri"` to `builder.required` in the schema, or add a fallback in `toInTotoStatement()`. Address in sprint-pre002-contract-tests.

2. **`toInTotoStatement()` has no input validation** — `src/receipt/to-intoto.js:18-43`: No guard clauses for missing `subject`, `materials`, or `builder`. A malformed receipt produces an unhelpful TypeError. For a publicly exported function, a descriptive error would be better. Non-blocking at v0 but should be hardened before v1. Address in sprint-pre002-contract-tests or 002.

3. **`docs/echelon-integration.md:37` references stale `receipt.output_hash`** — Acknowledged in reviewer.md and deferred to sprint-pre002-contract-tests. Acceptable since Tobias consumes ProposalEnvelope, not receipt directly. Track it.

4. **`test/unit/sign.spec.js:19` uses stale flat-field test payload** — `canonicalize({ schema: 'forge-receipt/v0', input_hash: 'sha256:abc123' })`. The crypto test doesn't depend on field names, but this is misleading for developers reading it. Low-priority cleanup.

5. **`src/ir/emit.js:75` JSDoc references stale `input_hash`** — `@param {any} [opts.rawInput=null] - Pre-ingest payload for receipt input_hash.` Should say `materials.digest`. Doc debt.

### Assumptions Challenged (1)

- **Assumption**: "No downstream consumer stores or parses receipts beyond forge-verify and FORGE's own tests" (SDD §3.1:70)
- **Risk if wrong**: The stale reference in `docs/echelon-integration.md` suggests receipt consumption was at least planned. If a partner followed that doc, they'd reference fields that no longer exist.
- **Recommendation**: Confirm with Tobias before v1 stabilization. Plausible at v0 given pre-stability status. Current approach justified.

### Alternatives Not Considered (1)

- **Alternative**: A `validateReceipt(receipt) → TypedReceipt` step before `toInTotoStatement()`, producing descriptive errors for missing/malformed fields rather than silent propagation.
- **Tradeoff**: More defensive but adds a validation layer for a v0 format with exactly one consumer.
- **Verdict**: Current approach justified at v0. Worth revisiting when receipt consumer count > 1.

### What Is Not Unit-Tested (non-blocking)

- `toInTotoStatement()` with non-null `subject.uri` / `materials.uri` (the `??` fallback is tested, but the passthrough path is not)
- `toInTotoStatement()` with missing fields (would throw unhelpful TypeError)
- Schema validation of produced receipt using a real JSON Schema validator (the test helper does basic field checks only)

Note: Direct envelope verification mode IS tested in `test/integration/receipt-pipeline.spec.js:40-44`.

---

## Complexity Analysis

- `buildReceipt()`: 45 lines, 1 param (options object), nesting 1 — OK
- `toInTotoStatement()`: 25 lines, 1 param, nesting 1 — OK
- `verifyReceipt()`: ~80 lines — borderline but justified by 5-step sequential verification
- No duplicated code detected
- No circular dependencies

---

## Documentation Verification

- CHANGELOG: N/A (deferred to sprint-pre002-contract-tests)
- Schema: Updated (`spec/receipt-v0.json`)
- Code comments: Adequate
- Stale docs: `docs/echelon-integration.md`, `src/ir/emit.js:75` — tracked above

---

## Summary

Clean implementation. Signed payload consistency confirmed. All acceptance criteria met. Concerns are real but non-blocking at v0 pre-stability. The most actionable items (#1 schema `uri` required, #2 converter validation) should be picked up in sprint-pre002-contract-tests.
