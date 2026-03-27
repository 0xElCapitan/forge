# Sprint 4 — Engineer Feedback

**Reviewer**: Senior Technical Lead
**Date**: 2026-03-20
**Sprint goal**: Q5 Threshold Type Classifier; GrammarScore 2.0 → 2.5 per spec (×3 specs)

---

## Verdict: Approved — proceed to audit

All acceptance criteria are met. 239 unit tests pass, 0 fail. All 6 convergence iterations
confirm `thresholds: match` for TREMOR (statistical), CORONA (regulatory), and BREATH (regulatory)
in both raw and anonymized modes. GrammarScore = 2.5/2.5 per spec as required. No regressions
from Sprint 3.

Three items require attention before Sprint 5 begins. None block audit.

---

## Review by Area

### 1. Regulatory data tables — path resolution is correct

`src/classifier/thresholds.js:33-34` uses `fileURLToPath(import.meta.url)` and `dirname` to resolve
`__dirname`, then constructs the data directory path via `join(__dirname, 'data')`. This is the
correct pattern for ES modules with `readFileSync`. The path is anchored to the module's own
location on disk, not the process working directory. Running the process from any working directory
(including `C:/Users/0x007/forge` or a subdirectory) will not break the data load. No issue here.

The three JSON files are single-line, valid JSON, content verified:
- `regulatory-epa-aqi.json`: `{"name":"EPA_AQI","breakpoints":[0,51,101,151,201,301,500]}`
- `regulatory-noaa-kp.json`: `{"name":"NOAA_Kp_Gscale","breakpoints":[5,6,7,8,9]}`
- `regulatory-noaa-r.json`: `{"name":"NOAA_R_scale","breakpoints":[0.00001,0.0001,0.001,0.01,0.1]}`

All match the sprint plan T-15 spec exactly.

### 2. Anti-cheating boundary — clean

`src/classifier/thresholds.js:199-209` (`classifyThresholds`) reads only:
- `e.metadata?.stream_index` — an ingester-set structural field
- `e.value` — primary ingester-extracted value
- `e.metadata` — for undefined/null guard

No source field names. No domain strings. No fixture-specific identifiers anywhere in the
classification logic. Anti-cheating boundary is intact. The reviewer.md correctly identifies this
as a key design constraint and the code upholds it.

### 3. TREMOR timestamp-as-value path — latent issue, must document for Sprint 5

This is the most important finding in this review.

**What happens now**: The ingester selects the highest-variance field from USGS GeoJSON as the
primary `e.value`. That field is a Unix millisecond timestamp (~1.77e12), not the earthquake
magnitude. `isRegulatedRange([1.77e12...])` returns false (1.77e12 >> 600) → `statistical`.
The classification is correct by spec output, but the mechanism is coincidental: TREMOR is
`statistical` because it accidentally exposes a timestamp as its value, not because the
classifier detected that earthquake magnitudes are non-regulatory.

**Why this is latent but material**: If the ingester's highest-variance field selection changes
in a future sprint — for instance, if the variance computation is fixed to exclude timestamp-like
fields, which would be a defensible improvement — TREMOR's primary values would shift to
magnitudes in the range ~[4.5, 8.5]. Those values pass `isRegulatedRange` (all ≤ 600 and ≥ 0)
and TREMOR would suddenly classify as `regulatory`, which is incorrect. Sprint 5 selector rules
will condition on `thresholds.type === 'statistical'` for TREMOR's `threshold_gate` rule. A
latent misclassification here would cause a Sprint 5 regression with no obvious root cause.

**What needs to happen before Sprint 5**: The reviewer.md (Known Limitations §1) documents this
correctly. However, it needs to be explicit in the Sprint 5 brief as a precondition: the
ingester's primary value selection behavior for USGS GeoJSON must be treated as frozen or
explicitly documented. If the ingester behavior changes, Q5 must be retested. This is not a
Sprint 4 code defect — the current behavior is correct and tested — but the dependency is
invisible unless explicitly noted in the handoff.

**Test coverage for this path**: `thresholds.spec.js:370-375` tests `classifyThresholds` with
explicit Unix timestamp values (1773902840040, 1773903000000, 1773983871040) and asserts
`statistical`. This is the right test. The description says "Earthquake ingester may produce
timestamp values as the primary value" — the word "may" understates the certainty. As of Sprint 4,
it always does for TREMOR. The test is correct and sufficient; the framing should be stronger.

### 4. `loadRegulatoryTables` and `REGULATORY_TABLES` — loaded but not in primary classification path

**This is a code quality issue that Sprint 5 implementers must understand.**

`src/classifier/thresholds.js:56` loads `REGULATORY_TABLES` at module initialization time. The
module-level constant is populated. However, `classifyThresholds` — the function called by the
grammar orchestrator — does not reference `REGULATORY_TABLES` at all. The classification decision
tree in `classifyThresholds:194-227` uses only:
1. `streamIndices.size >= 2` check (lines 208-210)
2. `isRegulatedRange(values)` check (lines 217-219)
3. Fall-through to `statistical` (line 226)

Neither `matchRegulatoryTable` nor `REGULATORY_TABLES` appears anywhere in this decision path.
The tables are loaded into memory, but the load result is never consumed by the classification
call that ships in `feed-grammar.js`.

`matchRegulatoryTable` is implemented and tested (`thresholds.spec.js:215-247`) and works
correctly in isolation. It is used in the test suite directly (test line 216 calls
`loadRegulatoryTables()` to get tables for test input). But the function is not called from
`classifyThresholds`. As a result, `REGULATORY_TABLES` is effectively dead state for the current
classification path.

The reviewer.md (Technical Highlights §"Regulatory Tables Design") acknowledges this: "This
function is implemented and tested but is not in the primary classification path for the current
three fixtures." This is accurate and the rationale is defensible — the multi-stream and range
checks are sufficient for the current fixture set, and the breakpoint infrastructure is staged for
future single-stream regulated feeds.

However, the code has a silent contradiction: `REGULATORY_TABLES` is loaded on every module
import (including in production via `feed-grammar.js`), incurring three synchronous disk reads,
but the loaded data is never consulted by `classifyThresholds`. Sprint 5 implementers reading
`classifyThresholds` will find no reference to the tables and may not realize the infrastructure
exists. Sprint 5 implementers reading `loadRegulatoryTables` will find a cached constant with no
callsite in the primary path.

**Required action before Sprint 5**: Add a JSDoc note directly to `classifyThresholds` (at
`src/classifier/thresholds.js:194`) stating that `matchRegulatoryTable` and `REGULATORY_TABLES`
are in-module but not called from this function — they are available for Sprint 5+ when
single-stream regulated feeds need breakpoint matching. Without this, a Sprint 5 implementer
adding a new single-stream regulated fixture would not discover the existing infrastructure.

The three synchronous disk reads at module init are acceptable for the current use: module load
time is not a hot path, and the constant caches the result. But the orphaned constant is a
readability debt that accrues interest when Sprint 5 adds selector rules referencing Q5 output.

### 5. Zero external dependencies — confirmed

`src/classifier/thresholds.js` imports only:
- `node:fs` (readFileSync)
- `node:module` (createRequire — imported but not called; this import is unused)
- `node:url` (fileURLToPath)
- `node:path` (dirname, join)

All Node.js builtins. No npm packages. The `createRequire` import at line 27 is unused —
`loadRegulatoryTables` uses `readFileSync` + `JSON.parse`, not `require()`. This is dead code.
It should be removed to avoid confusion (a reader might expect `createRequire` to be used
somewhere and search for it).

**File:line**: `src/classifier/thresholds.js:27` — `import { createRequire } from 'node:module';`
is not used anywhere in the file. Remove before Sprint 5.

### 6. Grammar completeness — confirmed

`src/classifier/feed-grammar.js:34-42` calls all five classifiers. No null stubs. The `classify`
function returns a FeedProfile with:
- `cadence`: from `classifyCadence(events)`
- `distribution`: from `classifyDistribution(events)`
- `noise`: from `classifyNoise(events)`
- `density`: from `classifyDensity(events)`
- `thresholds`: from `classifyThresholds(events)` — Q5, no longer a stub

The convergence output confirms: all 6 iterations show `thresholds: "match"` in the structured
log. GrammarScore = 2.5/2.5 per spec.

### 7. Test coverage — solid with one gap

60 tests across all helpers and classification paths. Real fixture integration tests for all 3
specs. Edge cases covered: empty events, NaN values, Infinity values, single events.

**TREMOR timestamp-as-value path is covered** at `thresholds.spec.js:370-375` (synthetic
timestamp values) and via the real USGS fixture integration test at lines 418-441. Both paths
assert `statistical`. Adequate.

**One gap worth noting**: There is no test that exercises the `classifyThresholds` path where
`streamIndices.size === 1` (explicit single stream with index 0) combined with values in [0, 600].
The `makeStreamEvents` helper builds events with a stream_index, but the single-stream bounded
tests at lines 342-358 use `makeEvents` (no stream_index), so `streamIndices.size === 0`. This
means the code path where `streamIndices = {0}` (size 1, falls through to range check) is not
directly tested. This is not a bug — `size >= 2` is the multi-stream threshold, and `size === 1`
correctly falls through to the range check — but the test matrix has a gap that a Sprint 5
implementer might not notice. Low priority, not blocking.

---

## Sprint 4 Pre-conditions Carried Forward

The two Sprint 3 documentation–code discrepancies remain unresolved (trending t-stat: code=3.0
vs doc=2.0; cyclical autocorr: code=0.7 vs doc=0.8). These were flagged in Sprint 3
engineer-feedback as "must fix before Sprint 5 selector rules are authored." They do not affect
Sprint 4 output. They remain blocking for Sprint 5.

---

## Action Items Before Sprint 5

| Priority | Location | Action |
|----------|----------|--------|
| Required | `src/classifier/thresholds.js:27` | Remove unused `createRequire` import |
| Required | `src/classifier/thresholds.js:194` | Add JSDoc to `classifyThresholds` noting that `matchRegulatoryTable` and `REGULATORY_TABLES` are available for future single-stream regulated fixtures but not in the current classification path |
| Required | Sprint 5 brief | Document that TREMOR's Q5=`statistical` depends on the ingester selecting a timestamp field as the primary value; if ingester changes, Q5 must be retested |
| Required | `grimoires/loa/a2a/sprint-3/reviewer.md` | Reconcile t-stat threshold (2.0→3.0) and autocorr threshold (0.8→0.7) before Sprint 5 rules are authored (carried from Sprint 3) |
| Low | `test/unit/thresholds.spec.js` | Add test for `streamIndices.size === 1` (single stream with explicit index 0) + values in [0, 600] → `regulatory` |

---

## Score at Completion

**GrammarScore: 2.5/2.5 per spec** (Q1-Q5 all correct, both modes, all 3 specs)
**TotalScore: 2.5/20.5 per spec** (TemplateScore = 0 — selector not yet implemented, expected)

Sprint 4 completes Phase 1 of the FORGE convergence loop. The full grammar is operational.
Phase 2 (template selector, Sprint 5) may begin after the action items above are resolved.
