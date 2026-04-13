All good (with noted concerns)

Sprint sprint-pre002-contract-tests has been reviewed and approved. All 6 acceptance criteria met. All 6 prior review/audit concerns verified fixed in code. 750 tests pass, 0 fail.

## Verification Summary

| Criterion | Verified |
|-----------|----------|
| `schema-validation.spec.js` validates envelope and receipt against JSON schemas | YES — 7 tests, all pass |
| README test count matches actual output | YES — 750 total, 735 unit, no stale 684/699 |
| BUTTERFREEZONE test count matches | YES — same, all 5 locations updated |
| FORGE_LEARNINGS entries appended (not rewritten) | YES — 3 entries, existing content preserved |
| All ~735 tests pass | YES — 750 pass, 0 fail |
| All 5 PRD goals validated | YES — G-1 through G-5 all PASS |

## Prior Concerns Status

| # | Concern | Status |
|---|---------|--------|
| R-1 | `builder.uri` missing from schema required | RESOLVED — `spec/receipt-v0.json:94` now includes `"uri"` |
| R-2 | `toInTotoStatement` input validation | RESOLVED — `src/receipt/to-intoto.js:20-22` guard clause + 4 tests |
| R-3 | `sign.spec.js` stale flat payload | RESOLVED — `test/unit/sign.spec.js:19` now uses grouped shape |
| R-4 | `emit.js` JSDoc stale field name | RESOLVED — `src/ir/emit.js:75` now says `materials.digest` |
| R-5 | `echelon-integration.md` stale field path | RESOLVED — L37 fixed + L95 clarification added |
| A-1 | `retention-policy.md` stale field paths | RESOLVED — L44, L46 updated |

## Adversarial Analysis

### Concerns Identified (3 — all non-blocking)

1. **`schema-validation.spec.js:28-100` — Custom validator coverage boundary**: The lightweight validator handles `required`, `const`, `type`, `pattern`, `additionalProperties`, and nested `object` recursion. It does NOT handle `$ref`, `oneOf`, `allOf`, `if/then/else`, `minItems`, `maxItems`, `enum`, or `format`. If a future schema revision introduces any of these keywords for a critical field, the contract test becomes silently weaker — it would pass without actually validating. The report's "Known Limitations" section acknowledges this, which satisfies the concern.

2. **`schema-validation.spec.js:67-69` — Null tolerance on non-required optional fields**: Lines 67-69 skip type checking when `val === null` and the field is not in `schema.required`. This is pragmatically correct for v0 (where `uri`, `version_tag`, etc. are nullable optional), but it means a field could be `null` when the schema says `"type": "string"` (no `"null"` in type array) and the test wouldn't catch it, as long as the field isn't required. This is only relevant if someone removes `"null"` from a type union but forgets to ensure code stops emitting `null`.

3. **`spec/receipt-v0.json:101-102` — `git_sha` has `pattern` but also `"type": ["string", "null"]`**: The schema allows `git_sha` to be null (for non-git environments). The custom validator at L76-79 only checks `pattern` when `typeof val === 'string'`, so a null `git_sha` correctly skips pattern validation. But if `git_sha` were an empty string `""`, the pattern check would catch it. This is fine, but worth noting: the pattern `^[0-9a-f]{40}$` does not match the empty string, so empty strings are rejected. Good.

### Assumptions Challenged (1)

- **Assumption**: The 750 test count is stable and won't drift before the next doc update.
- **Risk if wrong**: If someone adds tests in a bugfix PR without updating README/BUTTERFREEZONE, the docs go stale again. This is the classic H-5 problem.
- **Recommendation**: This is inherent to manual doc-count maintenance. Acceptable for v0 — a lint step or CI check would prevent drift but is over-engineering for this stage. No action needed now.

### Alternatives Not Considered (1)

- **Alternative**: Use AJV or another proper JSON Schema validator library instead of the custom `validateAgainstSchema`.
- **Tradeoff**: AJV provides complete JSON Schema compliance but adds an external dependency, violating FORGE's zero-dependency principle. The custom validator trades coverage breadth for dependency hygiene.
- **Verdict**: Current approach is justified. FORGE's zero-dependency stance is a deliberate architectural choice. The subset validator covers all keywords currently used in `proposal-ir.json` and `receipt-v0.json`. If schemas grow to use `$ref` or `oneOf`, the validator should be extended — but not before that need materializes.

## Documentation Verification

- CHANGELOG: N/A (no CHANGELOG in this repo; test/doc sprint, no features)
- CLAUDE.md: N/A (no new commands)
- Code comments: `schema-validation.spec.js` has clear section headers and JSDoc-style comments. `to-intoto.js` has full JSDoc.
- Security code: No new security-sensitive code in this sprint. Concern fixes are field-path corrections.

Sprint approved. Ready for `/audit-sprint`.
