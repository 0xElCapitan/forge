# Review: sprint-pre002-hermeticity

**Reviewer**: Senior Tech Lead
**Date**: 2026-04-12
**Verdict**: All good (with noted concerns)

Sprint pre002-hermeticity has been reviewed and approved. All 6 acceptance criteria met. Implementation is minimal, surgical, and correct.

---

## Acceptance Criteria Verification

| Criterion | Verdict | Verified By |
|-----------|---------|-------------|
| `spec/HERMETICITY.md` exists with two-zone model and allowed inputs table | PASS | Read file — 8 sections, tables in §2-3 |
| `forge.analyze(fixture, { deterministic: true })` throws | PASS | Read `src/index.js:99-101`, test at L258-280 |
| `forge.analyze(fixture, { deterministic: true, timestampBase: X, now: Y })` succeeds | PASS | Test at L282-292 |
| Byte-identical canonicalized receipt across runs | PASS | Test at L215-252, field list matches `receipt-builder.js:67-78` |
| Promotion path states boundary is pragmatic | PASS | `spec/HERMETICITY.md:23` — exact quote: *"The two-zone boundary is a current operational boundary, not a forever boundary."* |
| `npm run test:all` green | PASS | 731 pass, 0 fail |

## Code Quality

- **Surgical**: Only 3 files touched (1 new spec, 1 src edit, 1 test edit). No drive-by changes.
- **Simplicity**: The gate is 3 lines of validation. No abstraction, no complexity.
- **Style**: Matches existing codebase conventions (JSDoc, destructuring defaults, assert patterns).
- **Null/undefined asymmetry**: `timestampBase == null` vs `now === undefined` is correct — both allow `0` as a valid value, and the operators match the destructuring defaults (`null` vs `undefined`). Well-documented in reviewer.md.

## HERMETICITY.md Spot-Check

Ran `grep -n 'Date.now()' src/` and cross-checked against §4 tables:
- Receipt-critical: `ingester/generic.js:185,225,320`, `ir/emit.js:89` — all match
- Runtime: `adversarial.js:65`, all 6 theatres, `lifecycle.js:144`, `quality.js:62`, `bundles.js:60`, live adapters — all match
- `new Date().toISOString()` at `receipt-builder.js:45` — documented correctly in §8

No undocumented `Date.now()` calls found. The contract is complete against current codebase.

## Receipt Replay Test Verification

The test's canonicalized field set (`determinism-gate.spec.js:233-244`) matches the receipt builder's signed payload set (`receipt-builder.js:67-78`) exactly:
`schema`, `input_hash`, `input_canonicalization`, `code_version`, `policy_hash`, `rule_set_hash`, `policy_version_tag`, `output_hash`, `http_transcript_receipts`, `signer`.

`computed_at` correctly excluded from both.

---

## Adversarial Analysis

### Concerns Identified (3 — all non-blocking)

1. **Line numbers in HERMETICITY.md will go stale** (`spec/HERMETICITY.md:49-63`): The hidden input tables cite specific line numbers (e.g., `generic.js:185,225,320`). Any refactor to those files will make the references incorrect. Non-blocking because function names and file names are also documented, and the contract is a living document expected to update with the codebase.

2. **Gate is entrypoint-only** (`src/index.js:99-101`): The `deterministic: true` gate only validates at `ForgeConstruct.analyze()`. The granular exports at `src/index.js:188-241` allow direct pipeline composition (`ingest()` + `classify()` + `emitEnvelope()`) bypassing the gate entirely. The enforcement is social (documented contract), not structural (code-enforced). Non-blocking because the HERMETICITY.md itself documents this as entrypoint enforcement (§5), and the two-zone model is explicitly pragmatic.

3. **Receipt replay test covers only TREMOR domain** (`determinism-gate.spec.js:219`): The envelope-level tests cover 4 fixture domains (TREMOR, CORONA, BREATH, timestamp-less), but the receipt-level replay only uses TREMOR. If canonicalization had a fixture-shape-dependent bug, it wouldn't be caught. Non-blocking because `canonicalize()` is shape-agnostic (it's JCS-subset — deterministic key sorting), and the envelope-level tests already prove pipeline determinism across all 4 domains.

### Assumptions Challenged (1)

- **Assumption**: Only `ForgeConstruct.analyze()` is the receipt-critical entrypoint, so gate enforcement there is sufficient.
- **Risk if wrong**: If a future consumer composes the pipeline via granular exports and calls `buildReceipt()` without injecting clocks, they produce non-deterministic receipts with no warning.
- **Recommendation**: This is acceptable for v0 — the HERMETICITY.md promotion path (§7) explicitly anticipates this. When `buildReceipt()` becomes externally consumed, promote the gate. No action needed now.

### Alternatives Not Considered (1)

- **Alternative**: Push deterministic validation into `emitEnvelope()` or `ingest()` directly, so ANY call path enforces it — not just `ForgeConstruct.analyze()`.
- **Tradeoff**: More invasive (touches multiple hot-path functions), but structurally sound — enforcement follows the data, not the caller.
- **Verdict**: Current approach is justified. The two-zone model is explicitly pragmatic, and the gate is validation-only. Structural enforcement is a future promotion path, not a v0 requirement. Moving the gate deeper would couple enforcement to functions that currently serve both receipt-critical and runtime callers.

---

Concerns documented but non-blocking. See Adversarial Analysis above.
