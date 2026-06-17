/**
 * src/bundle/markdown-members.js
 * ConstructAdmissionBundle producer — SKILL.md / reality.md / handoff.md materialization (S03-E).
 *
 * Replaces the S03-B placeholder markdown members (the `skeleton*Md` helpers in
 * ./assemble.js) with fully materialized member content for the FINAL authored
 * bundle path, so an authored bundle is meaningfully reviewable as a producer
 * artifact. The S03-B skeletons remain in ./assemble.js for the NON-final
 * (skeleton) path, clearly labelled skeleton-only — S03-E does NOT reintroduce
 * placeholders into the authored path.
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slice S03-E): markdown member content ONLY.
 * This module —
 *   - emits the optimizer-READY shape and nothing more: `skillopt_config.enabled`
 *     is ALWAYS `false`. FORGE does NOT import / vendor / install / run SkillOpt
 *     (NFR-1; AC-14) — "steal the shape, not the package". It claims NO
 *     optimization and NO calibration improvement (those never occur here);
 *   - commits to the ONE worked theatre S03-C authored — the BREATH air-quality
 *     `aqi_threshold_gate` (PurpleAir T3 signal + AirNow T1 settlement). It builds
 *     NO broad multi-theatre / multi-settlement generality, mirroring the narrow
 *     ./oracles.js `BREATH_ORACLE_SOURCES` worked path;
 *   - reuses ONLY the zero-dependency receipt primitives
 *     src/receipt/{hash,canonicalize}.js for the reality.md per-entry
 *     `content_hash` (R-2). It imports NO signer / keyring / revocation /
 *     trust-policy / verification code and produces / verifies NO signature;
 *   - writes NO disk and is NOT imported by any live runtime path (./assemble.js,
 *     the only importer, is itself runtime-unreferenced).
 *
 * KEY DESIGN DECISIONS (documented; see the S03-E implementation report):
 *
 *   1. SKILL.md `bundle_member_hash` is emitted PRESENT and `null` (DEFERRED).
 *      The contract (§3) types it as "this file's own digest". A member CANNOT
 *      contain its own final content hash without a circular self-reference (the
 *      digest is taken over bytes that include the digest field). S03-E does NOT
 *      invent a canonicalization/hash scheme to work around the circularity.
 *      The AUTHORITATIVE SKILL.md digest already exists, computed by S03-D over
 *      the actual emitted bytes, in `bundle-receipt.json::members[]` (the parser
 *      cross-check target, D-4). Resolving the in-file self-reference (a defined
 *      hash-with-field-blanked canonicalization) is a deferred follow-up. `null`
 *      mirrors the S03-D present-and-null posture for deferred receipt fields.
 *
 *   2. reality.md per-entry `content_hash` IS a real computed digest (NOT
 *      deferred). Unlike (1) it is NOT circular: it is a `sha256:` over the
 *      canonical JSON of the provenance record's OWN grounding fields (parameter,
 *      value, source_side, source_id, derivation, verification_status) — the
 *      content_hash field itself is excluded from the input. It reuses
 *      src/receipt/{canonicalize,hash.js} (SDD §10 / R-2: "reuse hash.js shape").
 *      It is provenance-record integrity ONLY — it is NOT a digest of, nor a
 *      claim about, any Echelon-owned CalibrationReceipt / forecast-quality cert
 *      (the R-6 split is preserved; no cert body is embedded).
 *
 *   3. `bounded_edit_budget` is the SINGLE SOURCE OF TRUTH for the edit budget
 *      across the 3-surface envelope (§11). It appears as a literal NUMBER only
 *      in SKILL.md; handoff.md references it as a `$ref` string, never a second
 *      number (D-6 / H-5). It is asserted <= MAX_ALLOWED_BUDGET (=10, D-7) at
 *      module load — producer authoring safety, NOT Echelon receiving validation.
 *
 * NAMING: sibling of the singular `src/bundle/` producer — unrelated to the
 * plural `src/processor/bundles.js`; never imports it.
 *
 * @module bundle/markdown-members
 */

import { sha256 } from '../receipt/hash.js';
import { canonicalize } from '../receipt/canonicalize.js';
import { MAX_ALLOWED_BUDGET } from './fields.js';
import { HANDOFF_TEMPLATE } from './enums.js';

// ── SSOT edit budget (D-6/D-7; §11) ──────────────────────────────────────────

/**
 * The SINGLE SOURCE OF TRUTH for `skillopt_config.bounded_edit_budget`. Emitted
 * as a literal number in SKILL.md only; handoff.md `$ref`s it (never duplicates
 * the number). Conservatively below the absolute ceiling MAX_ALLOWED_BUDGET (10).
 */
export const BOUNDED_EDIT_BUDGET = 8;

/** `brier_improvement_threshold` surface — a float in (0,1); required-when-enabled. */
const BRIER_IMPROVEMENT_THRESHOLD = 0.2;

// Producer authoring-safety self-checks (run at import; catch constant drift —
// NOT Echelon receiving-end validation). Mirrors the S03-C assertion style.
if (
  !Number.isInteger(BOUNDED_EDIT_BUDGET) ||
  BOUNDED_EDIT_BUDGET < 1 ||
  BOUNDED_EDIT_BUDGET > MAX_ALLOWED_BUDGET
) {
  throw new Error(
    `bundle/markdown-members: BOUNDED_EDIT_BUDGET ${BOUNDED_EDIT_BUDGET} must be an ` +
      `integer in [1, MAX_ALLOWED_BUDGET=${MAX_ALLOWED_BUDGET}] (D-7)`,
  );
}

// ── feed_id grammar (S02 T2.3) ────────────────────────────────────────────────

/**
 * The receiving-contract grammar for `theatre_trigger_conditions[].feed_id`: one
 * or more lowercase-alphanumeric segments joined by single underscores
 * (`epa_airnow_aqi`). No leading/trailing underscore, no double underscore, no
 * uppercase, no other characters. This pins the BREATH feed_id shape to the
 * Cycle-113 receiving surface; it is deliberately NARROW and is NOT broadened
 * here. Anchored `^...$` with no `m` flag — in JavaScript `$` matches only the
 * true end of input (it does NOT match before a trailing newline as Python's `$`
 * would), so a newline-injection payload cannot satisfy it.
 */
export const FEED_ID_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Assert that a `feed_id` is a non-empty string conforming to {@link FEED_ID_GRAMMAR},
 * returning it unchanged on success. Mirrors the {@link assertSafeIdentifier}
 * producer-authoring-safety precedent: it validates the grammar only — it does NOT
 * claim Echelon receiving-end validation and adds no dependency. Rejects a non-string
 * or any value the grammar does not match (uppercase, leading/trailing or doubled
 * underscore, dot/dash/space/colon, the empty string).
 *
 * @param {unknown} value
 * @param {string}  [label='feed_id'] - field name, for the diagnostic.
 * @returns {string} the validated feed_id
 * @throws {Error} if `value` is not a string matching {@link FEED_ID_GRAMMAR}
 */
export function assertFeedId(value, label = 'feed_id') {
  if (typeof value !== 'string' || !FEED_ID_GRAMMAR.test(value)) {
    throw new Error(
      `bundle/markdown-members: invalid ${label} ${JSON.stringify(value)} — must match ` +
        `${FEED_ID_GRAMMAR} (one or more lowercase-alphanumeric segments joined by single ` +
        `underscores; feed_id grammar, S02 T2.3). The grammar is intentionally narrow and not broadened.`,
    );
  }
  return value;
}

// ── BREATH worked-path committed facts (single theatre; mirrors oracles.js) ───

/**
 * The one worked theatre S03-E materializes: the BREATH air-quality
 * `aqi_threshold_gate` (selector rule `aqi_threshold_gate`, src/selector/rules.js:233-250).
 * `threshold: 151` is the EPA AQI "Unhealthy" lower bound; `window_hours: 24` the
 * daily AQI window; settlement is the T1 source `airnow` (PurpleAir T3 never
 * settles). These are READ facts, hand-authored here (no construct.json import);
 * S03-E does not generalize beyond this single committed path (OD-2).
 */
/**
 * The ONLY construct slug the S03-E materializers may emit (S03-F, carries forward
 * S03-E review L1). The materializers below hardcode the BREATH AQI worked path, so
 * final materialization is BREATH-only for now — emitting this content under any other
 * slug would silently mislabel BREATH AQI content as another construct. The
 * (non-final) skeleton path in ./assemble.js stays generic and is NOT gated by this.
 */
export const BREATH_CONSTRUCT_SLUG = 'breath';

const BREATH_TEMPLATE = 'threshold_gate'; // FORGE Proposal-IR template (rules.js:239)
const BREATH_TRIGGER_ID = 'aqi_threshold_gate';
const BREATH_FEED_ID = 'epa_airnow_aqi'; // BREATH AQI feed (construct.json data_sources `epa_airnow`); ties to ProposalEnvelope.feed_id (L-5)
const BREATH_BRIER_TYPE = 'binary'; // threshold_gate ↔ binary_resolution (contract:223)
const BREATH_AQI_THRESHOLD = 151; // EPA AQI "Unhealthy" lower bound (rules.js:241)
const BREATH_WINDOW_HOURS = 24; // daily AQI window (rules.js:242)
const BREATH_PROVENANCE_SOURCE_ID = 'epa_airnow'; // construct.json oracle namespace (R-3), NOT the TRUST_REGISTRY key `airnow`

// Producer authoring-safety self-check: the worked template is a real FORGE
// Proposal-IR template (H-4). Catches drift from the S03-A enum.
if (!HANDOFF_TEMPLATE.includes(BREATH_TEMPLATE)) {
  throw new Error(
    `bundle/markdown-members: BREATH_TEMPLATE '${BREATH_TEMPLATE}' is not in ` +
      `HANDOFF_TEMPLATE {${HANDOFF_TEMPLATE.join(', ')}} (H-4)`,
  );
}

// Producer authoring-safety self-check (S02 T2.3): the BREATH feed_id conforms to
// FEED_ID_GRAMMAR. Catches drift if BREATH_FEED_ID is ever edited to a
// non-conforming value. Producer-side only — NOT Echelon receiving validation.
assertFeedId(BREATH_FEED_ID, 'BREATH_FEED_ID');

// ── reality.md provenance content_hash (decision 2 above) ─────────────────────

/**
 * Compute a parameter-provenance entry's `content_hash`: a `sha256:`-prefixed
 * digest over the canonical JSON of the record's OWN grounding fields (the
 * content_hash field is NOT part of the input — no circular self-reference).
 * Reuses src/receipt/{canonicalize,hash}.js; no new hashing code. This is
 * provenance-record integrity only (NOT a calibration / forecast-quality cert).
 *
 * @param {{ parameter: string, value: unknown, source_side: string, source_id: string, derivation: string, verification_status: string }} fields
 * @returns {string} `sha256:<hex>`
 */
function provenanceContentHash(fields) {
  return sha256(canonicalize(fields));
}

/**
 * The BREATH parameter-provenance records (grounding fields only; content_hash
 * is attached by {@link materializeRealityMd}). `source_id` uses the construct.json
 * oracle namespace (R-3) — provenance evidence, not a tier-resolving surface.
 */
const BREATH_PARAMETER_PROVENANCE = Object.freeze([
  Object.freeze({
    parameter: 'aqi_threshold_gate.threshold',
    value: BREATH_AQI_THRESHOLD,
    source_side: 'forge',
    source_id: BREATH_PROVENANCE_SOURCE_ID,
    derivation: 'regulatory',
    verification_status: 'verified',
  }),
  Object.freeze({
    parameter: 'aqi_threshold_gate.window_hours',
    value: BREATH_WINDOW_HOURS,
    source_side: 'forge',
    source_id: BREATH_PROVENANCE_SOURCE_ID,
    derivation: 'regulatory',
    verification_status: 'provisional',
  }),
]);

// ── Producer interpolation safety (S03-F; carries forward S03-E audit A1) ─────

/**
 * Safe-identifier charset for any value interpolated into a markdown/YAML surface.
 * Anchored `^...$` with NO `m` flag — in JavaScript `$` matches only the true end of
 * input (it does NOT match before a trailing newline as Python's `$` would), so a
 * `"airnow\ninjected_key: evil"` payload cannot satisfy it. Mirrors the slug.js L-1
 * anchoring note. Covers every TRUST_REGISTRY key, the construct slug, and feed/ref
 * ids (letters, digits, `.`, `_`, `-`); rejects newline / colon / quote / space / `#`
 * / `{` / `}` / `[` / `]` / backslash — the YAML- and markdown-breaking characters.
 */
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Assert that an identifier interpolated into a markdown/YAML member is injection-safe,
 * returning it unchanged on success. This is the narrow guard S03-E audit A1 requires
 * BEFORE any echelon|lattice authoring path is exercised: a `settling_source_id` /
 * `source_id` carrying a newline, colon, or quote would otherwise inject attacker-
 * controlled YAML keys into handoff.md. The BREATH worked path (`airnow`) passes
 * unchanged. This validates the charset only — it does NOT claim full YAML-parser
 * compatibility and adds no dependency.
 *
 * @param {unknown} value
 * @param {string}  [label='identifier'] - field name, for the diagnostic.
 * @returns {string} the validated identifier
 * @throws {Error} if `value` is not a string matching {@link SAFE_IDENTIFIER}
 */
export function assertSafeIdentifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `bundle/markdown-members: unsafe ${label} ${JSON.stringify(value)} for a markdown/YAML ` +
        `surface — must match ${SAFE_IDENTIFIER} (no newline / colon / quote / space; ` +
        `producer interpolation guard, S03-F/A1)`,
    );
  }
  return value;
}

// ── Materializers ─────────────────────────────────────────────────────────────

/**
 * Materialize SKILL.md: YAML frontmatter (incl. `skillopt_config.enabled: false`,
 * the SSOT `bounded_edit_budget`, the `brier_improvement_threshold` surface,
 * `slow_update_sections[]`, and a DEFERRED `bundle_member_hash: null`) + a
 * synthesis body + two `SLOW_UPDATE`-protected regions matching
 * `slow_update_sections[]` (SU-3). Optimizer-ready shape only; SkillOpt is never
 * run, imported, or vendored.
 *
 * @param {object} input
 * @param {string} input.slug - the construct slug (already L-1-validated upstream); becomes `skill_name`.
 * @returns {string} SKILL.md bytes
 */
export function materializeSkillMd({ slug } = {}) {
  // S03-F (S03-E review L1): this materializer hardcodes the BREATH AQI worked path,
  // so it may only be emitted for the BREATH slug. Refusing any other slug prevents
  // BREATH AQI content from being silently mislabelled as another construct.
  if (slug !== BREATH_CONSTRUCT_SLUG) {
    throw new Error(
      `bundle/markdown-members: final materialization is BREATH-only for now — got slug ` +
        `${JSON.stringify(slug)} (S03-E L1 guard; this materializer hardcodes BREATH AQI content)`,
    );
  }
  return `---
skill_name: ${slug}
archetype: core
skill_type: construct
input_format: air_quality_signal_digest
output_format: json
load_tier: L2
auto_load: false
skillopt_config:
  enabled: false
  optimizer: theatre_calibrator
  bounded_edit_budget: ${BOUNDED_EDIT_BUDGET}
  brier_improvement_threshold: ${BRIER_IMPROVEMENT_THRESHOLD}
  surfaces: [SKILL.md, reality.md, handoff.md]
slow_update_sections:
  - "Synthesis Rubric"
  - "AQI Threshold Framework"
bundle_member_hash: null
---

<!-- S03-E materialized member. FORGE emits the optimizer-READY shape ONLY:
     skillopt_config.enabled is false and FORGE never imports / vendors /
     installs / runs SkillOpt (NFR-1; AC-14). No optimizer pass has run and no
     forecast-quality improvement is claimed. The four publisher-authenticity
     fields stay null in bundle-receipt.json (no signature is produced or verified).

     bundle_member_hash is DEFERRED (null): a member cannot contain its own final
     content hash without a circular self-reference, and S03-E invents no hash
     scheme. The authoritative SKILL.md digest is bundle-receipt.json::members[]
     (computed by S03-D over the actual emitted bytes; the D-4 cross-check
     target). bounded_edit_budget is the single source of truth for the edit
     budget; handoff.md $refs it (it is never a second number). -->

# ${slug} — Construct Synthesis Skill

Synthesizes regulatory air-quality signals into a binary threshold-gate proposal
at the EPA AQI "Unhealthy" boundary (AQI ${BREATH_AQI_THRESHOLD}, ${BREATH_WINDOW_HOURS}h window).
AirNow (T1) is the settlement source; PurpleAir (T3) is a signal-only source that
never settles. This member declares the construct skill; it activates no behavior
on its own.

<!-- SLOW_UPDATE:BEGIN section="Synthesis Rubric" -->
## Synthesis Rubric

Protected region (SU-3): editable downstream ONLY via an explicit
\`promotion_record\` with \`validation_status == PROMOTED\` (Echelon-side). FORGE
emits it protected and never edits it (SkillOpt is never run).

- Treat the AirNow T1 reading as the settlement-authoritative AQI.
- Treat PurpleAir T3 readings as corroborating signal only — never as the
  settlement basis.
- Gate fires when the settlement-authoritative AQI crosses the protected
  threshold (see AQI Threshold Framework).
<!-- SLOW_UPDATE:END section="Synthesis Rubric" -->

<!-- SLOW_UPDATE:BEGIN section="AQI Threshold Framework" -->
## AQI Threshold Framework

Protected region (SU-3): same promotion gate as above.

- Threshold ${BREATH_AQI_THRESHOLD} is the EPA AQI "Unhealthy" lower bound
  (regulatory derivation; see reality.md parameter provenance).
- Resolution is binary (\`brier_type: ${BREATH_BRIER_TYPE}\`): the AQI is either
  at/above or below the boundary at evaluation time.
<!-- SLOW_UPDATE:END section="AQI Threshold Framework" -->
`;
}

/**
 * Materialize reality.md: the protected, construct-native parameter-provenance
 * manifest. The WHOLE member is protected (R-1/R-5: no non-protected regions by
 * default). `provenance_manifest_signed` is ALWAYS `false` (R-4). No
 * CalibrationReceipt / no OptimizationReceipt / no forecast-quality cert body is
 * embedded (R-6 split). Each parameter entry carries a real `content_hash`
 * (provenance-record integrity; see {@link provenanceContentHash}).
 *
 * @returns {string} reality.md bytes
 */
export function materializeRealityMd() {
  const [p1, p2] = BREATH_PARAMETER_PROVENANCE;
  const p1Hash = provenanceContentHash(p1);
  const p2Hash = provenanceContentHash(p2);

  return `<!-- S03-E materialized member — PROTECTED parameter provenance.
     reality.md is read-only evidence, fully protected (R-1/R-5): there are NO
     non-protected regions by default, so the optimizer may edit none of it (and
     FORGE never runs it). provenance_manifest_signed is ALWAYS false (R-4): this
     manifest is unsigned and no receipt is produced or verified over it. It
     embeds no forecast-quality cert body — that cert stays Echelon-owned and is
     only pointed at by manifest.calibration_ref, never embedded here (R-6 split).

     Each content_hash is a sha256: over the canonical JSON of that provenance
     record's own grounding fields (provenance-record integrity only — NOT an
     external evidence digest). source_id uses the construct.json oracle namespace
     (R-3), distinct from the manifest's TRUST_REGISTRY keys. -->
parameter_provenance:
  - parameter: "${p1.parameter}"
    value: ${p1.value}
    source_side: ${p1.source_side}
    source_id: "${p1.source_id}"
    derivation: "${p1.derivation}"
    verification_status: "${p1.verification_status}"
    content_hash: "${p1Hash}"
  - parameter: "${p2.parameter}"
    value: ${p2.value}
    source_side: ${p2.source_side}
    source_id: "${p2.source_id}"
    derivation: "${p2.derivation}"
    verification_status: "${p2.verification_status}"
    content_hash: "${p2Hash}"
oracle_thresholds:
  - oracle_source_id: "${BREATH_PROVENANCE_SOURCE_ID}"
    metric: "aqi"
    threshold: ${BREATH_AQI_THRESHOLD}
    units: "AQI"
    threshold_type: "regulatory"
provenance_manifest_signed: false
`;
}

/**
 * Materialize handoff.md: the single bounded-editable member — a theatre trigger
 * surface, NOT a financial contract. Only `window_hours` / `confidence_floor` /
 * `activation_delay_ms` are editable (H-1); `brier_type` and `settlement_source_id`
 * are frozen (H-2). `max_edits_per_pass` is a `$ref` to the SSOT
 * `skillopt_config.bounded_edit_budget` (never a second number; D-6/H-5).
 *
 * NO payout terms ever appear here (H-3): no counterparty, currency, amount,
 * token-transfer, or settlement-payment terms — those attach at Echelon
 * instantiation, never in the bundle.
 *
 * @param {object} input
 * @param {string} input.settlementSourceId - frozen settlement source; traces to
 *                 manifest.settlement_authority.settling_source_id (S03-C). For the
 *                 BREATH worked path this is the TRUST_REGISTRY key `airnow`.
 * @returns {string} handoff.md bytes
 */
export function materializeHandoffMd({ settlementSourceId } = {}) {
  // S03-F (S03-E audit A1): settlementSourceId is interpolated verbatim into the YAML
  // below (frozen.settlement_source_id). Validate it against the safe-identifier charset
  // BEFORE interpolation so a malicious newline / colon / quote cannot inject YAML keys.
  // The BREATH worked path ('airnow') passes unchanged; this guards the future
  // echelon|lattice authoring path at the materialization seam.
  assertSafeIdentifier(settlementSourceId, 'settlement_source_id');
  return `<!-- S03-E materialized member — bounded-editable theatre trigger surface.
     This member describes a theatre TRIGGER only (when a theatre activates); it
     is NOT a financial contract. Per H-3 the bundle carries no economic or
     settlement-financial terms whatsoever — any such terms attach downstream at
     Echelon instantiation (TriggerContract), never in the bundle.

     Only the bounded_editable fields may change post-emission (H-1). brier_type
     and settlement_source_id are frozen (H-2). max_edits_per_pass is a $ref to
     skillopt_config.bounded_edit_budget (SKILL.md) — the single source of truth,
     never a second number (D-6/H-5). -->
theatre_trigger_conditions:
  - trigger_id: "${BREATH_TRIGGER_ID}"
    template: "${BREATH_TEMPLATE}"
    feed_id: "${BREATH_FEED_ID}"
    bounded_editable:
      window_hours: ${BREATH_WINDOW_HOURS}
      confidence_floor: 0.55
      activation_delay_ms: 0
    frozen:
      brier_type: "${BREATH_BRIER_TYPE}"
      settlement_source_id: "${settlementSourceId}"
bounded_edit_policy:
  editable_fields: [window_hours, confidence_floor, activation_delay_ms]
  max_edits_per_pass: { "$ref": "skillopt_config.bounded_edit_budget" }
`;
}
