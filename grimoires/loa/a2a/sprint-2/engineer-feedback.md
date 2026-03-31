# Sprint 2 Review: Senior Tech Lead Feedback

**Sprint:** 2 — Tobias Review Response (SHOULD ADDRESS)
**Reviewer:** Senior Tech Lead
**Date:** 2026-03-31
**Verdict:** All good (with noted concerns)

---

## Overall Assessment

Sprint 2 delivers all three SHOULD ADDRESS items with one code logic change, comprehensive documentation, and 2 new tests (589 total, 0 failures). The code change in `emit.js` is minimal and surgical — 4 lines added to annotation, 3 lines modified in the scoring loop. Schema change is additive. Fixtures updated correctly.

**Approved for the following reasons:**
1. T-R04: `spec/STABILITY.md` exists with all required sections (commitment, versioning, breaking changes, notice policy, non-breaking, consumer guidance). `proposal-ir.json:5` references it.
2. T-R05: `usefulness_score: null` initialized on every proposal (`emit.js:89`), set to computed score when `score_usefulness=true` (`emit.js:101`). Envelope-level map retained (`emit.js:102`). Schema updated (`proposal-ir.json:152,204-209`). All 3 fixtures updated. Tests verify both scored and unscored paths.
3. T-R06: `brier_type` description updated with full template→type mapping (`proposal-ir.json:201-202`). Validation test covers all 6 templates (`ir.spec.js:227-253`).
4. 589 tests passing, 0 failures
5. No IR schema fields removed, renamed, or type-changed (additive only)

---

## Verification of Changes

| Task | File | Verified |
|------|------|----------|
| T-R04 | `spec/STABILITY.md` | **CONFIRMED** — All required sections present |
| T-R04 | `spec/proposal-ir.json:5` | **CONFIRMED** — Description references `spec/STABILITY.md` |
| T-R05 | `src/ir/emit.js:89` | **CONFIRMED** — `usefulness_score: null` in annotated map |
| T-R05 | `src/ir/emit.js:101` | **CONFIRMED** — `annotated[i].usefulness_score = score` when scored |
| T-R05 | `src/ir/emit.js:102` | **CONFIRMED** — Envelope-level map still populated |
| T-R05 | `spec/proposal-ir.json:152` | **CONFIRMED** — `usefulness_score` in required array |
| T-R05 | `spec/proposal-ir.json:204-209` | **CONFIRMED** — `["number", "null"]`, min 0, max 1 |
| T-R05 | `fixtures/forge-snapshots-tremor.json` | **CONFIRMED** — 5 proposals each with `usefulness_score: 0.0594` |
| T-R05 | `fixtures/forge-snapshots-breath.json` | **CONFIRMED** — 1 proposal with `usefulness_score: 0.34520625` |
| T-R05 | `fixtures/forge-snapshots-corona.json` | **CONFIRMED** — 0 proposals, no change needed |
| T-R05 | `test/unit/ir.spec.js:155-179` | **CONFIRMED** — Per-proposal score assertions + envelope map match |
| T-R05 | `test/unit/ir.spec.js:182-194` | **CONFIRMED** — Null assertion when not scored |
| T-R06 | `spec/proposal-ir.json:201-202` | **CONFIRMED** — cascade→multi_class mapping documented |
| T-R06 | `test/unit/ir.spec.js:227-253` | **CONFIRMED** — All 6 templates validated |

---

## Adversarial Analysis

### Concerns Identified

1. **STABILITY.md claims `usefulness_score` is "non-breaking since all consumers must already handle unknown fields per JSON schema `additionalProperties` policy" — but `Proposal` has `additionalProperties: false` (`proposal-ir.json:153`).** This means consumers validating against the OLD schema would reject envelopes containing the new field. The claim is technically incorrect. In practice this is fine because Tobias would update his schema simultaneously, but the STABILITY.md wording should be corrected to say "non-breaking when schema is updated in lockstep" or simply "additive field requiring schema update." This is **non-blocking** — a documentation correction.

2. **Fixture values were hand-edited rather than pipeline-regenerated.** The reviewer.md acknowledges this limitation. Since the values were copied from the already-consistent envelope-level `usefulness_scores` map (same computation path), and `proposal_id` values are deterministic from unchanged inputs, this is acceptable. However, it means the fixtures have never been validated end-to-end with the new code path. If `computeUsefulness` had changed behavior, the fixture values would be stale. **Non-blocking** — the test suite exercises the live code path and the fixture files are documentation snapshots, not test baselines.

3. **The `usefulness_score` field is marked required in the schema but allows null.** This means every producer MUST emit the field (even as null). Any existing code that constructs Proposal objects without `usefulness_score` will fail schema validation. Since FORGE is the only producer and `emitEnvelope()` always sets it, this is safe within FORGE. But if Tobias has any code that constructs Proposal objects directly (not through FORGE), he'll need to add the field. This should be communicated in the Tobias sync summary. **Non-blocking** but notable for fork sync.

### Assumptions Challenged

- **Assumption**: "Adding a required-but-nullable field is non-breaking."
- **Risk if wrong**: Tobias's 163 bridge tests may validate Proposal objects against the schema. If any test constructs a Proposal without `usefulness_score`, it will fail validation after schema update. The field is required, not optional.
- **Recommendation**: Document in the Tobias sync notes that `usefulness_score: null` must be added to any manually-constructed Proposal objects in his test fixtures. The field was intentionally made required (not optional) so consumers always see a consistent shape.

### Alternatives Not Considered

- **Alternative**: Make `usefulness_score` optional instead of required — omit from `required` array, let it be absent when not scored.
- **Tradeoff**: More lenient for existing consumers (no update needed for Tobias's fixtures). But creates ambiguity: is the field absent because the filter wasn't run, or because the producer is outdated? The null-when-not-scored pattern is cleaner.
- **Verdict**: Current approach (required, nullable) is justified. It guarantees a consistent object shape and makes the "not scored" state explicit rather than relying on field absence.

---

## Documentation Verification

| Item | Status |
|------|--------|
| STABILITY.md | Created — comprehensive and well-structured |
| CHANGELOG | N/A — Sprint 2 CHANGELOG entry appropriate post-merge |
| Code comments | Adequate — emit.js comment updated to mention usefulness_score |
| Schema descriptions | Updated — brier_type and usefulness_score descriptions are clear |

---

## Summary

Sprint 2 is clean, minimal, and correct. All three SHOULD ADDRESS items are resolved. The code change is surgical (7 lines modified in emit.js). Schema change is additive. Tests cover both scored and unscored paths. The STABILITY.md wording about `additionalProperties` is slightly inaccurate but non-blocking.

Sprint 2 is **approved**. Proceed to security audit.
