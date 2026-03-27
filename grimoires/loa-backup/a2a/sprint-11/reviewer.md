# Sprint 11 — Implementation Report

**Sprint**: sprint-11 (global 11)
**Label**: BUTTERFREEZONE.md
**Status**: Ready for review
**Implemented**: 2026-03-20

---

## Summary

Sprint 11 delivers `BUTTERFREEZONE.md` at the FORGE repo root — the machine-readable agent context document that gives any agent loading FORGE a complete, provenance-tagged picture of its capabilities without reading source code.

Additionally: `spec/construct.json` `entry_point` has been restored to `BUTTERFREEZONE.md` (was temporarily set to `README.md` during Sprint 10 audit; now that BFZ exists the correct pointer is back).

---

## Files Created / Modified

| File | Action | Description |
|------|--------|-------------|
| `BUTTERFREEZONE.md` | Created | Agent context document (135 lines) |
| `spec/construct.json` | Updated | `entry_point` restored to `BUTTERFREEZONE.md` |

---

## T-35: BUTTERFREEZONE.md

### Structure (matches TREMOR template exactly)

1. **HTML comment AGENT-CONTEXT block** — YAML, not rendered by markdown
2. **Key Capabilities** — 17 entries, all with `file:line` provenance
3. **Architecture** — pipeline diagram + full directory listing
4. **Interfaces** — Construct API table (28 exports), Theatre Templates table (6), Oracle Trust Model table (4 tiers)
5. **Module Map** — 13 modules with file counts and purpose
6. **Verification** — 503 tests, 140 suites, zero deps
7. **Culture** — naming, principles, convergence loop origin story
8. **Quick Start** — two examples (ForgeConstruct + alignFeeds composer preview)
9. **ground-truth-meta** HTML comment at bottom

### Provenance audit

All `file:line` references verified against actual source before writing:

| Capability | Location | Verified |
|------------|----------|---------|
| `classify` | `src/classifier/feed-grammar.js:34` | ✓ |
| `classifyCadence` | `src/classifier/cadence.js:129` | ✓ |
| `classifyDistribution` | `src/classifier/distribution.js:127` | ✓ |
| `classifyNoise` | `src/classifier/noise.js:255` | ✓ |
| `classifyDensity` | `src/classifier/density.js:140` | ✓ |
| `classifyThresholds` | `src/classifier/thresholds.js:199` | ✓ |
| `selectTemplates` | `src/selector/template-selector.js:130` | ✓ |
| `evaluateRule` | `src/selector/template-selector.js:70` | ✓ |
| `RULES` | `src/selector/rules.js:35` | ✓ |
| `alignFeeds` | `src/composer/compose.js:28` | ✓ |
| `detectCausalOrdering` | `src/composer/compose.js:63` | ✓ |
| `computeUsefulness` | `src/filter/usefulness.js:113` | ✓ |
| `buildBundle` | `src/processor/bundles.js:49` | ✓ |
| `getTrustTier`/`canSettle`/`validateSettlement` | `src/trust/oracle-trust.js:61` | ✓ |
| `exportCertificate` | `src/rlmf/certificates.js:91` | ✓ |
| `createReplay` | `src/replay/deterministic.js:84` | ✓ |
| `ForgeConstruct` | `src/index.js:37` | ✓ |

### Rule count correction

Sprint plan said "16 rules" but actual count is 13 (verified by reading `src/selector/rules.js`):
- 5 TREMOR (seismic)
- 5 CORONA (space weather)
- 3 BREATH (air quality)

BUTTERFREEZONE.md uses the accurate count: 13 rules.

### proposeComposedTheatre omitted intentionally

Sprint plan (T-38) notes: "verify and patch the file:line reference" in Sprint 12. `proposeComposedTheatre` does not exist until Sprint 12. It is NOT included in BUTTERFREEZONE.md's Key Capabilities or AGENT-CONTEXT interfaces. T-38 will add it.

### Test count (verified)

```bash
node --test test/unit/*.spec.js 2>&1 | grep -E "pass|suites"
# ℹ pass 503
# ℹ suites 140
```

### spec/construct.json update

`entry_point` and `context_files[0]` restored from `"README.md"` to `"BUTTERFREEZONE.md"`. Verified all 6 context_files exist on disk.

---

## Acceptance Criteria Check

| Criterion | Status |
|-----------|--------|
| AGENT-CONTEXT block valid YAML with all required fields | ✓ |
| All Key Capabilities have `file:line` provenance | ✓ |
| `file:line` references accurate (verified against grep output) | ✓ |
| Architecture diagram correctly shows 4-stage pipeline | ✓ |
| Module Map file counts verified with `ls` | ✓ |
| Verification section states correct test count (503 tests, 140 suites) | ✓ |
| Quick Start runs without error (zero deps, Node 20+) | ✓ |
| `ground-truth-meta` comment at bottom with head_sha, generated_at, generator | ✓ |
| `spec/construct.json` entry_point points to existing file | ✓ |
