# FORGE Pre-Cycle-002: IR Audit, Anonymizer Stress-Test, SWPC Adapter Skeleton

> Agent prompt. Three tasks. Execute in order. Each task has a DONE condition — do not move to the next task until the current one is complete.

---

## Context: Why these three tasks matter

FORGE is a feed classification engine that proposes prediction market templates for Echelon, a prediction market protocol built by Tobias (@tobiasjames_eth). FORGE classifies any structured data feed across 5 statistical dimensions and emits versioned Proposal IR envelopes that Echelon's admission gate consumes.

The integration is live. Tobias has built a Python bridge (`forge_bridge.py`, ~540 lines, 163 tests) that consumes FORGE's IR output. He completed a formal spec review of FORGE v0.2.0 and identified 6 divergences between his bridge and FORGE's IR — all are updates on his side, zero design disagreements. He committed to shipping those bridge updates.

**The risk:** If FORGE's IR spec has any ambiguity, his bridge updates will hit friction. If FORGE's anonymizer assumes physical-measurement-shaped data, the upcoming Polymarket feed expansion will break. If the SWPC adapter plumbing isn't ready, cycle-002 loses time on boilerplate instead of classification logic.

These three tasks make FORGE battle-ready before Tobias's next deliverables arrive.

### Tobias's 6 divergences (reference for Task 1)

1. **proposal_id algorithm** — FORGE uses SHA-256(feed_id:template:sortedParams)[:16]. Tobias's bridge was using a different algorithm. He is adopting FORGE's exactly. The spec must document this clearly.
2. **Template coverage** — His bridge maps 3 of 6 templates (threshold_gate, cascade, divergence). He will add regime_shift, anomaly, persistence. Not a FORGE issue.
3. **brier_type** — New field not yet in his ProposalIR. He needs it for RLMF scorer selection. Must be unambiguous in the spec.
4. **Composition is envelope-level** — FORGE puts composition at top level (shared by all proposals). His bridge expected per-proposal. He's adopting FORGE's model. Spec must be clear.
5. **Feed profile field names** — FORGE's `serializeProfile()` normalizes to IR names (median_gap_ms, spike_ratio, stream_count). His golden fixtures use pre-IR names. He's normalizing. FORGE's emitter must actually produce the IR names.
6. **ir_version / forge_version** — He will add version gate to bridge entry. Both fields must be present and constrained in the spec.

### Upcoming expansion (reference for Task 2)

Tobias has proposed adding Polymarket as a FORGE feed class. Polymarket data is bounded 0-1 probability prices — fundamentally different from the physical measurement feeds (seismic, space weather, air quality) FORGE currently handles. The anonymizer and ingester must not assume unbounded numeric values, geographic coordinates, or sensor network density patterns.

---

## Task 1: IR Spec Audit

**Goal:** Verify that `spec/proposal-ir.json` and `src/ir/emit.js` unambiguously support all 6 divergences Tobias is updating his bridge for. Fix anything unclear.

### Files to read
- `spec/proposal-ir.json` — the JSON Schema
- `src/ir/emit.js` — the emitter that serializes FORGE output into envelopes

### Checks

1. **proposal_id**: Open `src/ir/emit.js` and find the `proposalId()` function. Verify it uses `SHA-256(feed_id:template:sortedParams)` and slices to 16 hex chars. Then open `spec/proposal-ir.json` and check the `proposal_id` field description — does it document the algorithm, or just say "unique ID"? If the algorithm is not documented in the schema description, add it. The description should say exactly: "Deterministic ID: SHA-256 of `feed_id:template:JSON.stringify(sorted params)`, first 16 hex characters. Stable across polls for unchanged feeds. Use as dedup key."

2. **brier_type**: In `spec/proposal-ir.json`, find the `brier_type` field inside the Proposal definition. Is it required or optional? It should be required (Tobias needs it to select the RLMF scorer). If it's optional or nullable, consider whether it should be required. Check that `emit.js` always populates it — look at the `BRIER_TYPE` map and verify all 6 templates have entries. If any template maps to `null`, that's a gap.

3. **composition**: In `spec/proposal-ir.json`, verify `composition` is a top-level envelope field, not nested inside individual proposals. Check that the description makes clear it's shared context for the entire envelope (not per-proposal).

4. **domain field**: In `spec/proposal-ir.json`, verify `source_metadata.domain` exists. It was added in v0.2.1 per Tobias's Q4 request. Check the description says it's caller-supplied, not classifier-inferred.

5. **serializeProfile()**: In `src/ir/emit.js`, find the `serializeProfile()` function. Verify it outputs IR field names: `median_gap_ms` (not `median_ms`), `spike_ratio` (not `noise_ratio`), `stream_count` (not `sensor_count`). Cross-reference each field with what the schema declares in `feed_profile`.

6. **ir_version / forge_version**: In `spec/proposal-ir.json`, verify both are required fields. `ir_version` should have a `const` constraint (currently "0.1.0"). `forge_version` should be a string.

### DONE condition
- All 6 checks pass, or any issues found are fixed in the spec/emitter
- Run `npm run test:unit` — all 560 tests pass after any changes
- Run `npm test` — all convergence tests pass after any changes
- Write a brief summary of findings (what was correct, what was fixed)

---

## Task 2: Anonymizer Stress-Test

**Goal:** Verify the anonymization logic does not implicitly assume physical-measurement-shaped data. Confirm all convergence tests pass in both raw and anonymized modes. Identify any assumptions that would break on bounded 0-1 probability data (Polymarket).

### Files to read
- Find the anonymization logic. It's in the convergence test harness — look in `test/convergence/` for a helper/utility file that strips field names, shuffles metadata, and removes source URLs. Read it carefully.
- `src/ingester/generic.js` — the ingester that normalizes raw feeds before the classifier sees them. Read the shape detection logic (parseGeoJSON, parseArrayOfObjects, parseArrayOfArrays, parseCombinedObject).
- `src/classifier/distribution.js` — Q2 classifier. Check how it determines `bounded_categorical` vs `bounded_numeric` vs `unbounded_numeric`. Polymarket prices are bounded 0-1 floats.
- `src/classifier/density.js` — Q4 classifier. Check if it assumes geographic coordinates or sensor networks.

### Checks

1. **Run convergence tests**: Execute `node --test test/convergence/tremor.spec.js && node --test test/convergence/corona.spec.js && node --test test/convergence/breath.spec.js`. All 6 tests (3 specs × raw + anonymized) must pass. If any fail, stop and fix before proceeding.

2. **Read the anonymizer**: What exactly does it strip? What does it preserve? Document:
   - Does it remove geographic coordinates?
   - Does it remove field names?
   - Does it shuffle or randomize metadata keys?
   - Does it preserve `value` fields as-is, or does it transform them?
   - Does it assume `value` is always a single numeric field?

3. **Check distribution classifier for bounded float handling**: Polymarket prices are floats between 0 and 1. Does Q2 (`distribution.js`) correctly classify bounded 0-1 data? Or does it assume bounded means integer categories or specific value ranges? If all values are between 0 and 1, does it still detect `bounded_numeric`?

4. **Check density classifier for geographic assumptions**: Does Q4 (`density.js`) require `has_coords: true` to produce meaningful output? Polymarket data has no geographic coordinates. If the classifier produces a degenerate or error result when `has_coords: false`, that's a gap to flag.

5. **Check ingester for multi-value handling**: Polymarket events would have multiple value fields (yes_price, no_price, volume, liquidity). The ingester's `findValueField()` picks one numeric field. Is this sufficient, or would important Polymarket dimensions be lost? (Don't fix this now — just document the finding.)

### DONE condition
- All 6 convergence tests pass (confirm with output)
- Written summary documenting: what the anonymizer strips, any assumptions that would break on bounded 0-1 data, any assumptions about geographic coordinates, any issues with multi-value feeds
- No code changes unless a convergence test was failing. This task is diagnostic, not a fix. Flag issues for cycle-002/cycle-003.

---

## Task 3: SWPC Adapter Skeleton

**Goal:** Create the fetch/retry/timeout plumbing for a SWPC live adapter, following the `usgs-live.js` pattern exactly. Do NOT write classification logic — just the adapter shell that can poll SWPC, dedup, and hand off to the existing FORGE pipeline.

### Files to read
- `src/adapter/usgs-live.js` — THE pattern to follow. Read the entire file. Note: class structure, `#fetchWithRetry()`, `poll()` method, dedup via `#seen` Set, envelope emission, evidence bundle building, runtime routing.
- `fixtures/swpc-goes-xray.json` — what SWPC data looks like (this is the CORONA fixture)
- `src/ir/emit.js` — for envelope emission
- `src/index.js` — for imports (ingest, classify, selectTemplates, emitEnvelope, buildBundle)
- `references/swpc-api-response-sample.json` — real SWPC API response (26 records). Two readings per minute (one per energy band), flux in scientific notation, ISO 8601 timestamps.
- `references/swpc-reference.md` — endpoint URLs, field descriptions, dedup key strategy (`time_tag + energy`), flare classification thresholds, stale data detection notes. Read this first for Task 3.

### SWPC endpoints
- GOES X-ray 1-day: `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`
- GOES X-ray 3-day: `https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json`
- These return JSON arrays of objects with `time_tag`, `flux`, `energy`, `satellite` fields
- No auth required. No API key.
- Update frequency: ~1 minute

### What to build
Create `src/adapter/swpc-live.js` with:

1. **Same class pattern as USGSLiveAdapter**: `SWPCLiveAdapter` class with constructor accepting config, `poll()` method, `start()`/`stop()` for interval polling.

2. **Same `#fetchWithRetry()`**: Copy the timeout + exponential backoff pattern exactly. 15s timeout, 2 retries, max 10s backoff.

3. **Same dedup pattern**: `#seen` Set keyed on a unique event identifier from the SWPC response (likely `time_tag` or `time_tag + satellite`).

4. **Same pipeline routing**: `poll()` should: fetch → dedup → call `ingest()` on the raw data → call `classify()` → call `selectTemplates()` → call `emitEnvelope()` → optionally build evidence bundles → optionally route to runtime.

5. **Feed metadata**: `source_metadata` should include `{ source_id: 'swpc_goes', trust_tier: 'T1', domain: 'space_weather' }`.

6. **Convenience export**: `classifySWPCFeed()` one-shot function, same pattern as `classifyUSGSFeed()` in usgs-live.js.

### What NOT to build
- Do NOT write SWPC-specific classification logic or selector rules (those already exist for CORONA)
- Do NOT write new tests yet (tests come with cycle-002)
- Do NOT add SWPC endpoints to the network allowlist or any config files
- Do NOT modify any existing files

### Constraints
- Zero external dependencies. Node.js built-in `fetch` only.
- Must follow the security model documented in usgs-live.js: adapters do NOT run adversarial checks. They build bundles and route to ForgeRuntime, which runs `checkAdversarial()` on every bundle.
- The adapter must be a self-contained addition — no changes to existing source files.

### DONE condition
- `src/adapter/swpc-live.js` exists and follows the USGSLiveAdapter pattern
- File imports from `src/index.js` (not direct module imports)
- File exports `SWPCLiveAdapter` class and `classifySWPCFeed()` convenience function
- No existing tests broken: `npm run test:unit` still passes (560 tests)
- The adapter is a skeleton — it should be structurally complete but not yet tested against live SWPC endpoints

---

## Execution order

1. Task 1 (IR Audit) — do this first, it's the integration blocker
2. Task 2 (Anonymizer) — diagnostic only, document findings
3. Task 3 (SWPC Adapter) — new file, no changes to existing code

One task at a time. Test between each. Do not batch.
