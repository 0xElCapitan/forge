# Implementation Report: sprint-pre002-local-hardening

**Sprint**: sprint-pre002-local-hardening
**Cycle**: pre-002
**Priority**: P0
**Status**: COMPLETE
**Date**: 2026-04-12

---

## Executive Summary

Completed all 3 tasks in the local hardening sprint. Fixed the rationale string bug (H-4) and added `Number.isFinite` guards to 5 adversarial checks (H-3). All 720 tests pass (699 existing + 21 new).

---

## Tasks Completed

### Task 1.1: Fix rationale string bug (H-4)

**File**: `src/selector/template-selector.js:146`
**Change**: Replaced `evaluation.conditions_total` with `evaluation.conditions_met` in first position of rationale template string.

```diff
- rationale: `Rule '${rule.id}' fired (${evaluation.conditions_total}/${evaluation.conditions_total} conditions). ` +
+ rationale: `Rule '${rule.id}' fired (${evaluation.conditions_met}/${evaluation.conditions_total} conditions). ` +
```

**Test coverage**: 2 new tests in `test/unit/selector.spec.js`:
- Rationale string contains `conditions_met/conditions_total` for fully-fired rules
- Partial match returns `conditions_met < conditions_total`

### Task 1.2: Add NaN guards to adversarial gate (H-3)

**File**: `src/trust/adversarial.js:64-160`
**Change**: Added `Number.isFinite` guards before arithmetic in 5 checks:

| Check | Fields Guarded | Lines |
|-------|---------------|-------|
| 1: Channel A/B | `channel_a`, `channel_b` | 69-74 |
| 2: Frozen data | `frozen_count` | 89-91 |
| 3: Clock drift | `timestamp` | 100-102 |
| 4: Location | `lat`, `lon` | 116-121 |
| 5: Sybil | `peer_values` elements | 137-140 |

**Pattern used**: Each guard returns `{ clean: false, reason: 'invalid_{field}: must be finite number' }` when a non-null, non-finite value is detected. For peer_values (array), uses `.find()` to detect any non-finite element.

**Check 6** (value range) already had a `Number.isFinite` guard — no change needed.

### Task 1.3: Add NaN test cases (H-3, H-4)

**File**: `test/unit/trust.spec.js` — 19 new tests
**File**: `test/unit/selector.spec.js` — 2 new tests

NaN hardening tests per field:

| Field | NaN | Infinity | -Infinity | Total |
|-------|-----|----------|-----------|-------|
| `channel_a` | 1 | 1 | 1 | 3 |
| `channel_b` | 1 | 1 | — | 2 |
| `frozen_count` | 1 | 1 | 1 | 3 |
| `timestamp` | 1 | 1 | 1 | 3 |
| `lat` | 1 | 1 | 1 | 3 |
| `lon` | 1 | 1 | — | 2 |
| `peer_values` | 1 | 1 | 1 | 3 |
| **Total** | | | | **19** |

---

## Testing Summary

| Metric | Value |
|--------|-------|
| Total tests | 720 |
| Passing | 720 |
| Failing | 0 |
| New tests added | 21 |
| Test suites | 198 |
| Duration | ~1.7s |

**Command**: `npm run test:all`

---

## Acceptance Criteria Verification

- [x] `checkAdversarial({ channel_a: NaN, channel_b: 10 })` returns `{ clean: false }`
- [x] `checkAdversarial({ timestamp: NaN }, { now: 1700000000000 })` returns `{ clean: false }`
- [x] `checkAdversarial({ lat: Infinity }, { registered_lat: 37 })` returns `{ clean: false }`
- [x] Rationale string shows `conditions_met/conditions_total` (not `total/total`)
- [x] All 699 existing tests still pass
- [x] `npm run test:all` green (720 pass, 0 fail)

---

## Technical Notes

- Guards are placed **after** null checks but **before** arithmetic, matching the pattern from Check 6 (which already had this guard)
- For Check 1 (channel A/B), guards are inside the `!= null` block since both must be non-null for the check to run
- For Check 5 (Sybil), uses `Array.find()` to locate the first non-finite element and includes its value in the error message
- No interface changes, no downstream impact, no new dependencies

---

## Known Limitations

None. This sprint is self-contained local fixes with no external surface changes.

---

## Verification Steps

```bash
# Run full test suite
npm run test:all

# Run just the affected test files
node --test test/unit/trust.spec.js test/unit/selector.spec.js

# Verify NaN rejection manually
node -e "
import { checkAdversarial } from './src/trust/adversarial.js';
console.log(checkAdversarial({ channel_a: NaN, channel_b: 10 }, { now: Date.now() }));
console.log(checkAdversarial({ value: 10, timestamp: NaN }, { now: Date.now() }));
console.log(checkAdversarial({ value: 10, lat: Infinity }, { now: Date.now() }));
"
```
