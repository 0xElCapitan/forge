# Engineer Feedback: sprint-pre002-local-hardening

**Reviewer**: Senior Tech Lead
**Sprint**: sprint-pre002-local-hardening
**Date**: 2026-04-12
**Verdict**: APPROVED

---

All good (with noted concerns)

Sprint sprint-pre002-local-hardening has been reviewed and approved. All acceptance criteria met. All previous feedback items resolved.

---

## Previous Feedback Status

| Item | Status | Verification |
|------|--------|--------------|
| **C-1**: `.find()` → `.findIndex()` in peer_values guard | **RESOLVED** | `adversarial.js:137` uses `findIndex`, sentinel `-1`. Test at `trust.spec.js:409` covers `undefined` in array. Runtime verified: returns `{ clean: false, reason: 'invalid_peer_value: ..., got undefined' }` |
| **NC-1**: String coercion tests | **RESOLVED** | 4 tests at `trust.spec.js:416-440` covering channel_a, timestamp, lat, frozen_count with string inputs |
| **NC-2**: Rationale regression test | **RESOLVED** | Source-level guard at `selector.spec.js:438-444` asserts `selectTemplates.toString()` references both `conditions_met` and `conditions_total` |

---

## Adversarial Analysis

### Concerns Identified (3, all non-blocking)

1. The `selectTemplates.toString()` source inspection test (`selector.spec.js:438`) is fragile under bundling/minification. Acceptable here since FORGE is a zero-dependency Node.js library that runs unbundled.
2. String coercion tests cover 4 of 7 guarded fields. Representative coverage is adequate — the same `Number.isFinite` guard pattern applies to all fields.
3. `checkAdversarial` is now ~95 lines (`adversarial.js:64-159`). Approaching complexity threshold but justified given 6 sequential checks with early returns. No refactoring needed.

### Assumptions Challenged (1)

- **Assumption**: The `toString()` approach for regression testing will remain viable
- **Risk if wrong**: A future refactor (extract template string to constant, or rename variables) could silently break the test
- **Recommendation**: Acceptable risk. The test would fail loudly on such a refactor, prompting review. No action needed.

### Alternatives Not Considered (1)

- **Alternative**: Monkey-patch `evaluateRule` to return `fired: true` with `conditions_met !== conditions_total`, then verify the rationale string shows the correct numerator
- **Tradeoff**: More traditional unit test approach, but requires coupling the test to internal function structure
- **Verdict**: Current source-inspection approach is simpler and more direct. Justified.

---

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| `checkAdversarial({ channel_a: NaN, channel_b: 10 })` → `{ clean: false }` | PASS |
| `checkAdversarial({ timestamp: NaN }, { now: ... })` → `{ clean: false }` | PASS |
| `checkAdversarial({ lat: Infinity }, { registered_lat: 37 })` → `{ clean: false }` | PASS |
| Rationale string shows `conditions_met/conditions_total` | PASS |
| All 699 existing tests still pass | PASS (726 total, 0 fail) |
| `npm run test:all` green | PASS |

---

## Complexity Analysis

### Functions Reviewed
- `checkAdversarial()`: OK (95 lines, 2 params, nesting 2, early-return pattern)
- `selectTemplates()`: OK (20 lines, unchanged structure)

### Duplication Found
- None

### Dependency Issues
- None

### Dead Code
- None

---

Documentation verification: N/A (no new commands, no CHANGELOG required for pre-002 hardening internal sprint)
