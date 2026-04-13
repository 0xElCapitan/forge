# FORGE Hermeticity Contract

**Version**: 0.1.0
**Status**: Pre-stable (v0)

---

## 1. Purpose

This document formally backs FORGE's determinism claim: given identical inputs and injected clocks, the receipt-critical pipeline produces byte-identical output. It enumerates every allowed input, documents known hidden-input risks, and defines the enforcement mechanism.

---

## 2. Two-Zone Model

FORGE distinguishes two zones based on whether their output affects the signed receipt payload.

| Zone | Scope | Enforcement | Promotion Path |
|------|-------|-------------|----------------|
| **Receipt-critical** | `ingest` -> `classify` -> `selectTemplates` -> `emitEnvelope` -> `buildReceipt` | Fail-closed: `deterministic: true` throws if clocks not injected | Permanent — this zone only grows |
| **Runtime** | Theatre create/process/expire/resolve, `checkAdversarial`, `ForgeRuntime`, processors | Documented: all functions accept `opts.now`; no fail-closed gate | Promotable: when a runtime function becomes receipt-relevant, it moves to receipt-critical zone with enforcement |

The two-zone boundary is a current operational boundary, not a forever boundary. It is pragmatic, reflecting which functions currently contribute to the signed receipt payload. As FORGE evolves (e.g., composed attestation across theatres), runtime functions may be promoted to receipt-critical with full enforcement.

---

## 3. Allowed Inputs (Receipt-Critical Zone)

| Input | Source | Identified By |
|-------|--------|---------------|
| Raw feed data (bytes) | Fixture file or live feed | `materials.digest` in receipt (input hash) |
| Injected timestamp base | `options.timestampBase` | Deterministic ingestion — replaces `Date.now()` fallback |
| Injected wall clock | `options.now` | Deterministic `emitted_at` in envelope |
| Selector rules (RULES array) | `src/selector/rules.js` | `policy.rule_set_hash` in receipt |
| Regulatory tables | Threshold classifier imports | `policy.policy_hash` in receipt |
| Code identity | Git SHA + Node.js version | `code_version` in receipt |

Everything else is a hidden input. If it affects receipt output and is not in this table, it is a bug.

---

## 4. Hidden Input Risks

The following locations default to `Date.now()` when no explicit clock is injected. All are injectable but enforcement varies by zone.

### Receipt-Critical Zone (enforced via `deterministic: true`)

| Location | File | Default | Injection |
|----------|------|---------|-----------|
| Event timestamp fallback | `src/ingester/generic.js:185,225,320` | `Date.now()` | `options.timestampBase` |
| Envelope `emitted_at` | `src/ir/emit.js:89` | `Date.now()` | `options.now` |
| Receipt `computed_at` | `src/receipt/receipt-builder.js:45` | `new Date().toISOString()` | Metadata-only (excluded from signed payload) |

### Runtime Zone (documented, injectable, not enforced)

| Location | File | Default | Injection |
|----------|------|---------|-----------|
| Adversarial `now` | `src/trust/adversarial.js:65` | `Date.now()` | `context.now` |
| Theatre create/expire/resolve | `src/theatres/*.js` (6 theatre types) | `Date.now()` | `opts.now` |
| Theatre process (bundle timestamp) | `src/theatres/*.js` | `Date.now()` | `bundle.timestamp` |
| ForgeRuntime clock | `src/runtime/lifecycle.js:144` | `() => Date.now()` | Constructor `{ clock }` |
| Processor quality/bundles | `src/processor/quality.js:62`, `bundles.js:60` | `Date.now()` | `config.now` |
| Live adapters | `src/adapter/usgs-live.js:173,232`, `swpc-live.js:169` | `Date.now()` | Not injectable (live-only) |

---

## 5. Enforcement: `deterministic: true`

The `ForgeConstruct.analyze()` method accepts a `deterministic` option:

```js
const result = await forge.analyze(fixturePath, {
  deterministic: true,
  timestampBase: 1700000000000,
  now: 1700000001000,
});
```

When `deterministic: true`:
- If `timestampBase` is missing (`null`), throws `Error('deterministic mode requires explicit timestampBase and now')`
- If `now` is missing (`undefined`), throws the same error
- When both are provided, the pipeline runs with fully injected clocks

This is validation only — no output change. It enforces that callers explicitly provide clocks rather than silently falling back to `Date.now()`.

---

## 6. Replay Constants

For deterministic replay and verification, FORGE defines canonical constants:

| Constant | Value | Purpose |
|----------|-------|---------|
| `REPLAY_TIMESTAMP_BASE` | `1700000000000` | Epoch-ms base for event timestamps during replay |
| `REPLAY_NOW` | `1700000001000` (`REPLAY_TIMESTAMP_BASE + 1000`) | Wall-clock for `emitted_at` during replay |

These are the values any verifier (including `forge-verify`) must use when replaying a receipt to reproduce the original output. They appear in `test/unit/determinism-gate.spec.js` as `FIXED_TIMESTAMP_BASE` and `FIXED_NOW`.

---

## 7. Promotion Path

Runtime-zone functions can be promoted to receipt-critical when their output begins contributing to the signed receipt payload. Promotion means:

1. The function's `Date.now()` default must be injectable (already true for all runtime functions)
2. The `deterministic: true` gate must be extended to validate the new clock injection
3. Replay tests must be extended to cover the promoted function
4. This document must be updated with the new allowed input

The two-zone boundary is pragmatic, not permanent. It reflects the current state of which functions contribute to the signed payload, and will evolve as FORGE's attestation surface grows.

---

## 8. `computed_at` Note

The `computed_at` field in `ProposalReceipt` (`src/receipt/receipt-builder.js:45`) uses `new Date().toISOString()`. This is:

- **Metadata-only**: excluded from the signed payload (see `receipt-builder.js:67-78`)
- **Not determinism-critical**: it records when the receipt was built, not what was built
- **Not in the replay contract**: verifiers ignore `computed_at` when comparing receipts

If a future requirement demands injectable `computed_at` (e.g., for audit trail reproducibility), it can be promoted to an allowed input. Currently, this is unnecessary.
