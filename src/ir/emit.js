/**
 * src/ir/emit.js
 * Proposal IR envelope emitter.
 *
 * Converts FORGE's internal classify/select output into a versioned
 * ProposalEnvelope conforming to spec/proposal-ir.json.
 *
 * This is the boundary between FORGE and Echelon. Everything upstream
 * (ingester, classifier, selector, composer) is FORGE's domain.
 * Everything downstream (admission gate, theatre instantiation, RLMF)
 * is Echelon's domain. The envelope is the contract.
 *
 * Idempotency: Each proposal carries a deterministic proposal_id derived
 * from SHA-256(feed_id + template + sorted core params). Identical feeds
 * with identical classifications produce identical IDs. Echelon uses this
 * for dedup — polling every 60s won't spam duplicate proposals.
 *
 * @module ir/emit
 */

import { createHash } from 'node:crypto';
import { computeUsefulness } from '../filter/usefulness.js';
import { buildReceipt } from '../receipt/receipt-builder.js';
import { sha256 } from '../receipt/hash.js';
import { canonicalize } from '../receipt/canonicalize.js';
import { evaluateNegativePolicy } from '../policy/negative-policy.js';

const IR_VERSION         = '0.3.0';
const FORGE_VERSION      = '0.1.0';
const CLASSIFIER_VERSION = '0.1.0';

/**
 * Brier type lookup per template.
 * Cascade uses multi-class (5-bucket); everything else is binary.
 */
const BRIER_TYPE = {
  threshold_gate: 'binary',
  cascade:        'multi_class',
  divergence:     'binary',
  regime_shift:   'binary',
  anomaly:        'binary',
  persistence:    'binary',
};

/**
 * Generate a deterministic proposal_id from feed_id + template + core params.
 *
 * SHA-256 ensures identical feeds with identical classifications always
 * produce the same ID. Echelon uses this for dedup — FORGE can poll every
 * 60s without spamming duplicate proposals.
 *
 * @param {string} feed_id
 * @param {string} template
 * @param {Object} params
 * @returns {string} Hex-encoded SHA-256 hash (first 16 chars for readability)
 */
function proposalId(feed_id, template, params) {
  // Sort params keys for deterministic serialization
  const sortedParams = JSON.stringify(params, Object.keys(params).sort());
  const input = `${feed_id}:${template}:${sortedParams}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ── normalization_trace — producer provenance (cycle-003 Lane 2) ──────────────
//
// How each emitted value was derived from its input (STATED vs INFERRED vs MAPPED
// vs DEFAULTED lineage). Travels with the provenance family (original_hash +
// negative_policy_flags). It is producer provenance ONLY — never an admission /
// acceptance / scoring claim. It is the single in-ceiling field Echelon asked FORGE
// to POPULATE. Nullable: null when no normalization is supplied (mirrors
// negative_policy_flags null-when-evaluate_policy=false).

/** Allowed `method` values — the STATED/INFERRED discriminator; must never collapse. */
const NORMALIZATION_METHODS = Object.freeze(['stated', 'inferred', 'mapped', 'defaulted']);

/** Allowed `source` values for a normalization_trace entry. */
const NORMALIZATION_SOURCES = Object.freeze(['forge', 'echelon', 'lattice', 'operator']);

/** Exact field set of a normalization_trace entry (additionalProperties:false). */
const NORMALIZATION_TRACE_FIELDS = Object.freeze([
  'field', 'input_value', 'normalized_value', 'method', 'source', 'confidence',
]);

/**
 * Producer authoring-safety validator for a normalization_trace value: null, OR an
 * array whose every entry carries EXACTLY the six fields, a `method`/`source` drawn
 * from the enums, and a numeric `confidence` in [0,1]. Throws on the first
 * violation. This is producer safety — it never fabricates entries (the caller
 * supplies the real, traceable normalizations); it is NOT Echelon receiving-end
 * validation.
 *
 * @param {Array<object>|null} trace
 * @returns {Array<object>|null} the validated trace (unchanged) on success
 */
export function assertNormalizationTrace(trace) {
  if (trace === null) return null;
  if (!Array.isArray(trace)) {
    throw new Error('ir/emit: normalization_trace must be an array or null');
  }
  for (const entry of trace) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('ir/emit: each normalization_trace entry must be a plain object');
    }
    for (const required of NORMALIZATION_TRACE_FIELDS) {
      if (!(required in entry)) {
        throw new Error(`ir/emit: normalization_trace entry missing required field '${required}'`);
      }
    }
    for (const key of Object.keys(entry)) {
      if (!NORMALIZATION_TRACE_FIELDS.includes(key)) {
        throw new Error(
          `ir/emit: normalization_trace entry has unexpected field '${key}' (additionalProperties:false)`,
        );
      }
    }
    if (typeof entry.field !== 'string' || entry.field.length === 0) {
      throw new Error('ir/emit: normalization_trace.field must be a non-empty string');
    }
    if (!NORMALIZATION_METHODS.includes(entry.method)) {
      throw new Error(
        `ir/emit: normalization_trace.method '${entry.method}' must be one of ${NORMALIZATION_METHODS.join('|')}`,
      );
    }
    if (!NORMALIZATION_SOURCES.includes(entry.source)) {
      throw new Error(
        `ir/emit: normalization_trace.source '${entry.source}' must be one of ${NORMALIZATION_SOURCES.join('|')}`,
      );
    }
    if (
      typeof entry.confidence !== 'number' ||
      Number.isNaN(entry.confidence) ||
      entry.confidence < 0 ||
      entry.confidence > 1
    ) {
      throw new Error(
        `ir/emit: normalization_trace.confidence must be a number in [0,1] (got ${JSON.stringify(entry.confidence)})`,
      );
    }
  }
  return trace;
}

/**
 * The POPULATED normalization_trace for the narrow BREATH worked path — one entry
 * per REAL producer normalization (NFR-PROV; never a fabricated entry). Grounded:
 *   - settlement source (MAPPED): src/bundle/settlement.js:52-54
 *     `S03C_SETTLEMENT_SOURCE_CANONICAL = { airnow: 'airnow' }` — the per-theatre
 *     `params.settlement_source: 'airnow'` (selector rule aqi_threshold_gate) maps to
 *     the canonical TRUST_REGISTRY key `airnow`. Identity-after-verification for this
 *     source, but a real mapping step. confidence 1.0.
 *   - feed_id (STATED): src/bundle/markdown-members.js:115,119 — the construct.json
 *     data-source id `epa_airnow` is producer-STATED as the authored feed convention
 *     `epa_airnow_aqi`. Producer-stated, not inferred. confidence 1.0.
 * STATED (`feed_id`) and MAPPED (`settlement_source`) stay distinct `method` values;
 * STATED and INFERRED never collapse.
 */
export const BREATH_NORMALIZATION_TRACE = Object.freeze([
  Object.freeze({
    field: 'settlement_source',
    input_value: 'airnow',
    normalized_value: 'airnow',
    method: 'mapped',
    source: 'forge',
    confidence: 1.0,
  }),
  Object.freeze({
    field: 'feed_id',
    input_value: 'epa_airnow',
    normalized_value: 'epa_airnow_aqi',
    method: 'stated',
    source: 'forge',
    confidence: 1.0,
  }),
]);

/**
 * Emit a ProposalEnvelope from FORGE's analysis output.
 *
 * @param {Object} opts
 * @param {string}   opts.feed_id       - Stable feed identifier
 * @param {Object}   opts.feed_profile  - Output of classify()
 * @param {Object[]} opts.proposals     - Output of selectTemplates()
 * @param {Object}   [opts.source_metadata] - Optional source provenance
 * @param {Object}   [opts.composition]     - Output of proposeComposedTheatre() context
 * @param {boolean}  [opts.score_usefulness=false] - Run economic filter
 * @param {number}   [opts.now=Date.now()] - Injectable wall-clock for emitted_at_ms.
 *                   Defaults to Date.now() so existing callers are unaffected.
 *                   Pass a fixed value to obtain a deterministic envelope (used
 *                   by tests and by any caller that needs envelope-level hash
 *                   stability across identical inputs).
 * @param {any}      [opts.rawInput=null] - Pre-ingest payload for receipt materials.digest.
 *                   Only used when `receipt: true`.
 * @param {boolean}  [opts.receipt=false] - When true, return `{ envelope, receipt }`
 *                   instead of just the envelope.
 * @param {Function} [opts.sign=null] - Signing function for receipt (Sprint 5).
 * @param {boolean}  [opts.evaluate_policy=false] - When true, evaluate FORGE-owned
 *                   negative policy flags and include in envelope.
 * @param {Array<object>|null} [opts.normalization_trace=null] - Populated producer
 *                   provenance, one entry per real normalization (cycle-003 Lane 2).
 *                   Null by default; the BREATH worked path passes
 *                   BREATH_NORMALIZATION_TRACE. Validated by assertNormalizationTrace.
 * @returns {Object} ProposalEnvelope (or { envelope, receipt } when receipt: true)
 */
export function emitEnvelope({
  feed_id,
  feed_profile,
  proposals,
  source_metadata  = null,
  composition      = null,
  score_usefulness = false,
  now              = Date.now(),
  rawInput         = null,
  receipt          = false,
  sign             = null,
  evaluate_policy  = false,
  normalization_trace = null,
}) {
  const emitted_at_ms = now;

  // Annotate proposals with brier_type, deterministic proposal_id, and usefulness_score
  const annotated = proposals.map(p => ({
    proposal_id: proposalId(feed_id, p.template, p.params),
    template:    p.template,
    params:      p.params,
    confidence:  p.confidence,
    rationale:   p.rationale,
    brier_type:  BRIER_TYPE[p.template],
    usefulness_score: null,
    claim_shape: 'event',
  }));

  // Optional usefulness scoring — populates both per-proposal and envelope-level map
  let usefulness_scores = null;
  if (score_usefulness) {
    usefulness_scores = {};
    const tier = source_metadata?.trust_tier ?? 'unknown';
    for (let i = 0; i < annotated.length; i++) {
      const score = computeUsefulness(
        annotated[i], feed_profile, { source_tier: tier },
      );
      annotated[i].usefulness_score = score;
      usefulness_scores[String(i)] = score;
    }
  }

  // FR-1: original_hash + hash_algorithm — SHA-256 of canonicalized raw input.
  // Identical computation to receipt.materials.digest when receipt: true, surfaced
  // at envelope level for consumers that don't need the full receipt.
  // canonicalize() throws TypeError on Infinity/NaN/BigInt/Date — treat as unhashable
  // rather than propagating the throw; original_hash stays null in that case.
  let original_hash  = null;
  let hash_algorithm = null;
  if (rawInput != null) {
    try {
      original_hash  = sha256(canonicalize(rawInput));
      hash_algorithm = 'sha256';
    } catch {
      // unhashable rawInput — original_hash and hash_algorithm remain null
    }
  }

  // FR-3: FORGE-owned negative policy flags (advisory signals, not Echelon rejections).
  const negative_policy_flags = evaluate_policy
    ? evaluateNegativePolicy({ proposals: annotated, feed_profile, source_metadata, feed_id })
    : null;

  // cycle-003 Lane 2: producer provenance. Validate the caller-supplied trace (null
  // OR a populated object-array; the BREATH worked path passes BREATH_NORMALIZATION_TRACE).
  // Producer authoring safety — fabricates nothing, gates the shape / enums / confidence.
  assertNormalizationTrace(normalization_trace);

  const envelope = {
    ir_version:           IR_VERSION,
    verifier_type:        'echelon-brier/v0',
    forge_version:        FORGE_VERSION,
    classifier_version:   CLASSIFIER_VERSION,
    emitted_at_ms,
    feed_id,
    feed_profile:         serializeProfile(feed_profile),
    source_metadata:      source_metadata ?? undefined,
    proposals:            annotated,
    composition:          composition ?? null,
    usefulness_scores,
    original_hash,
    hash_algorithm,
    negative_policy_flags,
    normalization_trace,
  };

  if (receipt && rawInput != null) {
    const receiptObj = buildReceipt({ rawInput, envelope, sign });
    return { envelope, receipt: receiptObj };
  }

  return envelope;
}

/**
 * Serialize a FeedProfile to the IR shape (strip internal-only fields).
 * Passes through the five grammar dimensions with only the fields
 * the IR schema declares.
 *
 * @param {Object} profile - Internal FeedProfile from classify()
 * @returns {Object} IR-compliant FeedProfile
 */
function serializeProfile(profile) {
  return {
    cadence: {
      classification: profile.cadence.classification,
      median_ms:          profile.cadence.median_ms          ?? null,
      jitter_coefficient: profile.cadence.jitter_coefficient ?? null,
    },
    distribution: {
      type: profile.distribution.type,
      min:  profile.distribution.min  ?? null,
      max:  profile.distribution.max  ?? null,
      mean: profile.distribution.mean ?? null,
    },
    noise: {
      classification: profile.noise.classification,
      spike_rate:     profile.noise.spike_rate ?? null,
    },
    density: {
      classification: profile.density.classification,
      sensor_count:   profile.density.sensor_count ?? profile.density.tier_count ?? null,
    },
    thresholds: {
      type:                 profile.thresholds.type,
      detected_thresholds:  profile.thresholds.detected_thresholds ?? null,
    },
  };
}
