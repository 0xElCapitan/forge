# FORGE — Tobias Review Response Sprint

> **Context**: Tobias (Echelon) ran a sprint-10 review of FORGE from his fork at
> AITOBIAS04/echelon-core. He identified three MUST FIX items and three SHOULD ADDRESS
> items. This sprint addresses all six before Cycle 002 begins.
>
> His fork is 3 commits behind master. His 163 bridge tests are locked to the current
> IR contract. Do not break the IR schema structure — only extend it.
>
> **All existing tests must remain passing (558 unit + 6 convergence = 566 total).**
> Run `npm run test:all` after every task to verify.

---

## MUST FIX items (address first, in order)

### T-R01: Fix construct.json entry_point

**Description**: `spec/construct.json` has `entry_point` and `context_files[0]` referencing
`BUTTERFREEZONE.md`. That file did not exist when the spec was written and still does not
exist. This breaks Echelon's policy normaliser, which reads construct.json to compile the
EvaluationContract for FORGE's calibration certificate.

**Fix**: Change `entry_point` and any `context_files` references from `BUTTERFREEZONE.md`
to `README.md`. README.md exists and is the correct primary entry point until BUTTERFREEZONE.md
is generated in a future sprint.

**Acceptance criteria**:
- `spec/construct.json` references `README.md` as entry_point, not `BUTTERFREEZONE.md`
- All other construct.json fields unchanged
- `npm run test:all` still passes

**Effort**: XS

---

### T-R02: Resolve settlement tier key mismatch

**Description**: FORGE's trust model uses string keys (`"T0"`, `"T1"`, `"T2"`, `"T3"`)
throughout `src/trust/oracle-trust.js` and the IR envelope. TREMOR's theatre template
schema uses numeric tier keys for data maturity levels. These are described as orthogonal
concepts (oracle identity vs data maturity) but the inconsistency will cause friction at
Echelon's admission gate when it maps FORGE trust tiers to its own provenance taxonomy.

Echelon's confirmed provenance mapping for FORGE tiers:
- T0 → signal_initiated with high confidence
- T1 → signal_initiated with Brier-discounted confidence
- T2 → suggestion_promoted (needs corroborating signals)
- T3 → suggestion_unlinked (no settlement evidence, never settles)

**Fix**: Do NOT change the string key format — FORGE's string keys are correct and the
trust model is already audited and approved. Instead:
1. Add a comment block in `src/trust/oracle-trust.js` above the tier definitions
   that explicitly documents the string key format and explains why it differs from
   TREMOR's numeric maturity levels (orthogonal concepts)
2. Add the Echelon provenance mapping as a documented constant or comment so the
   integration guide can reference it
3. Add a note in `spec/proposal-ir.json` under the source_metadata trust_tier field
   that documents the string format and the Echelon provenance mapping

**Acceptance criteria**:
- The tier format (string keys) is unchanged
- The distinction between oracle identity tiers (FORGE) and data maturity levels (TREMOR)
  is clearly documented in the source
- The Echelon provenance mapping (T0→signal_initiated etc.) is documented in at least
  one canonical location
- `npm run test:all` still passes

**Effort**: XS

---

### T-R03: Verify domain claim vocabulary in construct.json

**Description**: `spec/construct.json` includes a `feed_characterization` domain claim.
Echelon's policy normaliser enforces that domain claims must match its vocabulary — wrong
vocabulary results in tier-cap penalties at certificate issuance time. FORGE would receive
a lower calibration certificate tier than it deserves if this claim is mismatched.

**Fix**:
1. Read `spec/construct.json` in full and identify all domain claims
2. Cross-reference against Echelon's known domain vocabulary. Echelon's v15 construct
   class taxonomy recognises these check family categories for theatre constructs:
   `settlement_accuracy`, `functional_correctness`, `oracle_consistency`,
   `calibration_validity`. The broader domain vocabulary includes: `feed_classification`,
   `oracle_trust`, `market_proposal`, `evidence_bundle`, `rlmf_certificate`,
   `theatre_lifecycle`
3. If `feed_characterization` is not in Echelon's vocabulary, replace it with the
   closest matching term (`feed_classification` is the likely correct term)
4. Document what was changed and why in a comment or changelog note

**Acceptance criteria**:
- All domain claims in construct.json use vocabulary consistent with Echelon's
  known taxonomy
- If any claims were changed, the original and replacement are documented
- `npm run test:all` still passes

**Effort**: S

---

## SHOULD ADDRESS items

### T-R04: Document IR schema stability policy

**Description**: `spec/proposal-ir.json` is currently at version 0.1.0 with no documented
stability commitment or semver policy. Tobias has 163 bridge tests locked to the current
schema. He needs to know: when will breaking changes happen, how much notice will he get,
and what constitutes a breaking change.

**Fix**: Add a `STABILITY.md` file to the `spec/` directory documenting:
- Current version: 0.1.0
- Stability status: stabilising — no breaking changes without prior notice
- What constitutes a breaking change: removing fields, changing field types, changing
  required/optional status of existing fields
- What is non-breaking: adding new optional fields, adding new enum values to open
  enums, adding new top-level optional sections
- Notice policy: breaking changes will be flagged in the FORGE changelog and communicated
  to Echelon (Tobias) before merging, with a minimum 1-sprint notice window
- The three new fields being added in Cycle 002 (normalization_trace,
  negative_policy_flags, original_hash) are additive and non-breaking

**Acceptance criteria**:
- `spec/STABILITY.md` exists and covers the above points
- `spec/proposal-ir.json` README or header comment references the stability policy

**Effort**: XS

---

### T-R05: Fix usefulness scoring inconsistency across golden envelopes

**Description**: Tobias's review identified that usefulness scores are inconsistent
across the three golden envelope snapshot files:
- DEPTH (TREMOR): per-proposal usefulness scores present
- BREATH: single envelope-level usefulness score (0.345), not per-proposal
- CORONA: no usefulness scores at all

This inconsistency will cause friction at Echelon's admission gate, which expects
consistent IR structure across all proposals.

**Fix**:
1. In `src/ir/emit.js`, ensure `usefulness_score` is computed and attached at the
   individual proposal level for every proposal, not at the envelope level
2. The envelope-level `usefulness_scores` map (keyed by proposal index) should remain
   for backwards compatibility but the per-proposal score should be the canonical location
3. Regenerate the three golden envelope snapshot files so they all have consistent
   per-proposal usefulness scores:
   - `fixtures/forge-snapshots-tremor.json`
   - `fixtures/forge-snapshots-corona.json`
   - `fixtures/forge-snapshots-breath.json`
4. Update `spec/proposal-ir.json` to make `usefulness_score` required at the proposal
   level, not optional

**Acceptance criteria**:
- All three golden envelope snapshots have per-proposal usefulness scores
- The IR schema marks usefulness_score as required at proposal level
- `npm run test:all` still passes
- Tobias's existing bridge tests should still pass against the updated envelopes
  (verify the per-proposal score field name matches what his bridge expects)

**Effort**: S

---

### T-R06: Document brier_type null rejection in IR spec

**Description**: Tobias's fork still allows `null` for `brier_type` in the IR schema.
FORGE master now requires `"binary"` or `"multi_class"` — null is no longer valid.
The IR spec needs to make this explicit so downstream consumers know null is rejected.

**Fix**:
1. In `spec/proposal-ir.json`, confirm that the `brier_type` field has no `null` in
   its enum and is marked required. If it still allows null, remove it.
2. Add a comment or description field to the brier_type schema entry explaining the
   mapping: cascade → multi_class, all other templates → binary
3. Add a test in the IR validation tests (if they exist) that confirms a proposal
   with `brier_type: null` fails schema validation

**Acceptance criteria**:
- `spec/proposal-ir.json` brier_type field does not allow null
- The cascade → multi_class, others → binary mapping is documented in the schema
- A validation test exists (or is added) confirming null brier_type is rejected
- `npm run test:all` still passes

**Effort**: XS

---

## Sprint Definition of Done

This sprint is complete when:

1. All three MUST FIX items (T-R01, T-R02, T-R03) are resolved and committed
2. All three SHOULD ADDRESS items (T-R04, T-R05, T-R06) are resolved and committed
3. `npm run test:all` passes with 566 tests (558 unit + 6 convergence + any new tests added)
4. No IR schema fields have been removed or renamed (additive changes only)
5. Changes are ready to communicate back to Tobias so he can sync his fork

**After this sprint**: FORGE is clean, Tobias can sync his fork without conflict,
and Cycle 002 can begin against a consistent baseline on both sides.
