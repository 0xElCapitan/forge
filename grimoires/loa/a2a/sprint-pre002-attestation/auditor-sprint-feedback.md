# Security Audit: sprint-pre002-attestation

**Auditor**: Paranoid Cypherpunk Security Auditor
**Sprint**: sprint-pre002-attestation
**Date**: 2026-04-12
**Verdict**: APPROVED - LETS FUCKING GO

---

## Prerequisites

- Senior lead approval: VERIFIED (`engineer-feedback.md` contains "All good")
- Not already completed: VERIFIED (no COMPLETED marker)

---

## Signed Payload Integrity (PASS)

Three-way consistency verified across all code locations:

| Location | File:Lines |
|----------|-----------|
| Builder | `src/receipt/receipt-builder.js:88-97` |
| Verifier | `bin/forge-verify.js:82-91` |
| Determinism Test | `test/unit/determinism-gate.spec.js:233-241` |

All construct identical payload: `{ schema, predicateType, subject, materials, policy, builder, http_transcript_receipts, signer }`

Matches SDD §3.4.

**Correctly EXCLUDED** from signed payload: `computed_at` (metadata), `key_id` (signing output), `signature` (the signature itself).

**Could an attacker modify any unsigned field?** No. `computed_at` does not affect replay/hash verification. `key_id`/`signature` modification fails signature check.

---

## Verification Bypass Analysis (PASS — NO BYPASS FOUND)

| Check | forge-verify.js Line | Bypass Risk |
|-------|---------------------|-------------|
| Schema gate | 59-61 | Hard gate, returns ERROR |
| Input hash (materials.digest) | 66-69 | Recomputed independently, no bypass |
| Signature check | 74-107 | Reconstructs payload identically; unsigned correctly skipped |
| Node version | 110-117 | Advisory only (warning), correct |
| Output hash — direct | 123-136 | Independent envelope hash, no bypass |
| Output hash — replay | 138-164 | Full pipeline replay with fixed timestamps |

No early returns skip critical checks. All paths terminate with explicit verdict.

---

## Security Findings

| # | Finding | Severity | File:Line | Status |
|---|---------|----------|-----------|--------|
| 1 | `builder.uri` not in schema `required` | MEDIUM | `spec/receipt-v0.json:94` | Tracked → sprint-pre002-contract-tests |
| 2 | `toInTotoStatement()` lacks input validation | LOW | `src/receipt/to-intoto.js:18` | Tracked → sprint-pre002-contract-tests |
| 3 | `digest.replace()` not prefix-anchored | LOW | `src/receipt/to-intoto.js:23,35` | Schema regex prevents exploitation |
| 4 | URI fields not validated for format | INFO | Multiple | No action at v0 (all hardcoded) |
| 5 | `docs/retention-policy.md:44,46` stale field refs | LOW | `docs/retention-policy.md` | Add to sprint-pre002-contract-tests Task 4.2 |
| 6 | Canonical serialization deterministic with nested structures | INFO | `src/receipt/canonicalize.js:93` | No issue — recursive key sort at all levels |
| 7 | `undefined`/`null` handling safe in canonicalize | INFO | `src/receipt/canonicalize.js:52,98` | No divergence possible — all nullable fields set explicitly |
| 8 | `additionalProperties: false` on all schema objects | INFO | `spec/receipt-v0.json` | Correctly sealed (root, subject, materials, policy, builder) |
| 9 | Test keys properly isolated | INFO | `fixtures/receipt-test-key.js` | Only imported by test files; `src/receipt/sign.js` reads from env |

**Summary: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 3 LOW, 5 INFO**

No blocking issues.

---

## Senior Review Concerns Tracking

All 5 concerns from engineer-feedback.md verified as tracked:

| # | Concern | Tracked for Contract-Tests? |
|---|---------|---------------------------|
| 1 | `builder.uri` not in schema `required` | YES — Task 4.1 scope (schema validation) |
| 2 | `toInTotoStatement()` lacks input validation | YES — explicitly deferred to contract-tests or 002 |
| 3 | `docs/echelon-integration.md:37` stale `receipt.output_hash` | YES — Task 4.2 scope (doc updates) |
| 4 | `sign.spec.js:19` stale flat-field test payload | YES — low-priority cleanup |
| 5 | `emit.js:75` JSDoc references stale `input_hash` | YES — doc debt |

**Additional finding**: `docs/retention-policy.md:44,46` also references `input_hash`/`output_hash`. Should be added to Task 4.2 doc update scope.

---

## Cryptographic Assessment

- Canonicalization: Deterministic recursive key-sort at all nesting levels. Nested objects (`subject`, `materials`, `policy`, `builder`) correctly serialized.
- Signature: ed25519 via `node:crypto`. No changes to crypto primitives in this sprint.
- Hash: SHA-256 via `node:crypto`. No changes to hash primitives.
- Key management: Test keys isolated in `fixtures/`. Production key read from `process.env.FORGE_SIGNING_KEY`. No secrets in changed files.

---

## Conclusion

The receipt shape restructuring is cryptographically sound. The signed payload is complete and consistent. No verification bypass paths exist. The MEDIUM finding (schema required fields) is already tracked and scoped to the next sprint. All senior review concerns are properly documented for follow-up.

APPROVED - LETS FUCKING GO
