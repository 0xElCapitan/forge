# FORGE — Polymarket Fixture Diagnostic Pass

> Agent prompt. One task: run FORGE's classifier against real Polymarket fixture data and document what happens. No code changes.

---

## Context: Where FORGE is and what led here

FORGE is a feed classification engine that proposes prediction market templates for Echelon. It classifies any structured data feed across 5 statistical dimensions (cadence, distribution, noise, density, thresholds), selects theatre templates via rule-based matching, and emits versioned Proposal IR envelopes that Echelon's admission gate consumes.

**The integration is live.** Tobias (Echelon) has built a Python bridge (`forge_bridge.py`, ~540 lines, 163 tests) that consumes FORGE's IR output. He completed a formal spec review, identified 6 divergences (all bridge updates on his side), and committed to shipping fixes.

**What was done in pre-cycle-002 (already completed):**

Three tasks were executed to prepare FORGE before Tobias's deliverables arrived:

1. **IR Spec Audit** — Two issues found and fixed:
   - `proposal_id` description in the schema was vague — updated to document the exact algorithm (SHA-256 of `feed_id:template:JSON.stringify(sorted params)`, first 16 hex chars)
   - `brier_type` was optional with nullable — made required, removed null fallback in emitter. All 6 templates now map to either `binary` or `multi_class`
   - Composition location, domain field, serializeProfile() field names, and ir_version/forge_version were all verified correct

2. **Anonymizer Stress-Test** — Diagnostic only, no code changes. Key findings:
   - Anonymizer correctly strips field names and source URLs, preserves numeric values and structure
   - **Risk flag**: Markets with near-constant prices (unique/total < 0.05) could misclassify as `categorical` instead of `bounded_numeric` in the distribution classifier
   - **No geographic assumptions**: Density classifier handles `has_coords: false` gracefully → `single_point`
   - **Multi-value limitation**: `findValueField()` in the ingester selects the highest-variance single numeric field. Polymarket data has multiple important dimensions (yes_price, no_price, volume, liquidity) but only one survives ingestion. Known limitation, flagged for cycle-003.

3. **SWPC Adapter Skeleton** — `src/adapter/swpc-live.js` created following the `usgs-live.js` pattern. Fetch/retry/timeout plumbing ready. No classification logic yet — that comes with cycle-002.

All 560 unit tests + 6 convergence tests passing after these changes. IR spec is tighter. No existing behavior changed.

**What just happened:** Tobias committed real Polymarket fixture snapshots to `main`:
- `fixtures/polymarket-active-markets.json` — metadata snapshot of active markets
- `fixtures/polymarket-price-history.json` — 24h price series selected for meaningful mid-probability movement
- `fixtures/polymarket-resolution.json` — resolved market with outcome data for settlement validation

These are real snapshots from Polymarket's public APIs, not synthetic mocks. Tobias has NOT run `forge.analyze()` on them — that's our job now.

## Why this diagnostic matters

This is the first test of whether FORGE's domain-agnostic classifier actually transfers to a fundamentally different feed class. The three current backing specs (TREMOR/seismic, CORONA/space weather, BREATH/air quality) are all physical measurement feeds with sensor networks, geographic coordinates, and unbounded or regulatory-bounded numeric values. Polymarket data is none of those things — it's bounded 0-1 probability prices, no geographic coordinates, no sensor network, human-generated trading activity rather than physical measurements.

If the classifier handles it without special-casing, that validates the architecture. If it breaks or produces nonsensical proposals, that tells us exactly what needs to change before the Polymarket adapter can be built in cycle-003.

**Tobias's minimum expectations:**
- At least 1 threshold proposal (price crossing a belief-flip boundary like 0.5 or 0.9)
- At least 1 cascade proposal if a correlated market pair is present in the active-markets fixture

---

## Task: Diagnostic Pass

**Read `grimoires/pub/FORGE_PROGRAM.md` before starting.** It has the convergence scoring, backing specs, constraints, and anti-cheating rules.

### Step 1: Pull latest and verify fixtures

```bash
git pull origin main
ls fixtures/polymarket-*.json
```

Should see three files. If not, stop and report.

### Step 2: Read the fixtures before running anything

Read all three JSON files. Document for each:
- Top-level structure (array of objects? nested? combined?)
- Field names and types
- Value ranges (are prices bounded 0-1?)
- Timestamp format
- How many events/records in each file

Compare the structure against what `src/ingester/generic.js` handles. Which parser path will each fixture take? (`parseArrayOfObjects`? `parseCombinedObject`? `parseGeoJSON`?)

### Step 3: Run forge.analyze() on each fixture

Write a throwaway diagnostic script (do NOT commit it):

```js
import { ingest, classify, selectTemplates, emitEnvelope } from './src/index.js';
import { readFileSync } from 'fs';

for (const file of [
  'fixtures/polymarket-active-markets.json',
  'fixtures/polymarket-price-history.json',
  'fixtures/polymarket-resolution.json',
]) {
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  const events = ingest(raw);
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({
    feed_id: file.replace('fixtures/', '').replace('.json', ''),
    feed_profile: profile,
    proposals,
    source_metadata: { source_id: 'polymarket', trust_tier: 'T1', domain: 'prediction_market' },
    score_usefulness: true,
  });

  console.log(`\n=== ${file} ===`);
  console.log('Events ingested:', events.length);
  console.log('FeedProfile:', JSON.stringify(profile, null, 2));
  console.log('Proposals:', proposals.length);
  for (const p of envelope.proposals) {
    console.log(`  - ${p.template} (confidence: ${p.confidence}, brier_type: ${p.brier_type})`);
    console.log(`    params:`, JSON.stringify(p.params));
  }
  if (envelope.usefulness_scores) {
    console.log('Usefulness scores:', JSON.stringify(envelope.usefulness_scores));
  }
}
```

Run it: `node --experimental-vm-modules diagnostic.mjs` (or whatever module flag your Node 20+ setup needs).

### Step 4: Document findings

Write a report answering these questions:

**Ingestion:**
1. Did the ingester parse all three fixtures without error?
2. How many NormalizedEvents were produced from each fixture?
3. Which parser path did each fixture take in `generic.js`?
4. Which value field did `findValueField()` select for each fixture? Was it a price field? Volume? Something else?

**Classification:**
5. What FeedProfile (Q1-Q5) did the classifier produce for each fixture?
6. Was `distribution.type` correctly `bounded_numeric` for price data in the 0-1 range?
7. Did the near-constant-price misclassification risk fire? (unique/total < 0.05 → wrongly classified as `categorical`)
8. What did `density.classification` produce? (Expected: `single_point` since no geographic coordinates)
9. What did `noise.classification` produce?
10. What did `thresholds.type` produce? (Expected: `statistical` — no regulatory tables for prediction markets)

**Proposals:**
11. How many proposals were generated per fixture?
12. Which templates were proposed? At what confidence levels?
13. Did at least 1 threshold proposal appear? (Tobias's minimum expectation)
14. Did any cascade proposal appear? (Only expected if correlated market pair is in the data)
15. Were any proposals clearly wrong or nonsensical for market price data?

**Edge cases:**
16. Were there any errors, crashes, or degenerate outputs?
17. Did any fixture produce zero proposals? If so, why?
18. Did the multi-value limitation (only highest-variance field survives) cause any visible information loss?

### Step 5: Confirm existing tests still pass

```bash
npm run test:unit
npm test
```

All 560 unit + 6 convergence tests must pass. The new fixtures are diagnostic inputs — they should not affect existing test behavior.

### DONE condition

- Diagnostic script run against all 3 fixtures
- Written report answering all 18 questions above
- All existing tests still green
- No changes to any FORGE source files
- Diagnostic script NOT committed to repo

The output of this task determines whether Polymarket becomes a cycle-003 backing spec or whether the classifier grammar needs adjustment first. Either answer is useful — document what actually happened, not what we hoped would happen.
