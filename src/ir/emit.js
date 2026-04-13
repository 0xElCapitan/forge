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

const IR_VERSION    = '0.1.0';
const FORGE_VERSION = '0.1.0';

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
 * @param {number}   [opts.now=Date.now()] - Injectable wall-clock for emitted_at.
 *                   Defaults to Date.now() so existing callers are unaffected.
 *                   Pass a fixed value to obtain a deterministic envelope (used
 *                   by tests and by any caller that needs envelope-level hash
 *                   stability across identical inputs).
 * @param {any}      [opts.rawInput=null] - Pre-ingest payload for receipt materials.digest.
 *                   Only used when `receipt: true`.
 * @param {boolean}  [opts.receipt=false] - When true, return `{ envelope, receipt }`
 *                   instead of just the envelope.
 * @param {Function} [opts.sign=null] - Signing function for receipt (Sprint 5).
 * @returns {Object} ProposalEnvelope (or { envelope, receipt } when receipt: true)
 */
export function emitEnvelope({
  feed_id,
  feed_profile,
  proposals,
  source_metadata = null,
  composition     = null,
  score_usefulness = false,
  now             = Date.now(),
  rawInput        = null,
  receipt         = false,
  sign            = null,
}) {
  const emitted_at = now;

  // Annotate proposals with brier_type, deterministic proposal_id, and usefulness_score
  const annotated = proposals.map(p => ({
    proposal_id: proposalId(feed_id, p.template, p.params),
    template:    p.template,
    params:      p.params,
    confidence:  p.confidence,
    rationale:   p.rationale,
    brier_type:  BRIER_TYPE[p.template],
    usefulness_score: null,
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

  const envelope = {
    ir_version:    IR_VERSION,
    forge_version: FORGE_VERSION,
    emitted_at,
    feed_id,
    feed_profile:  serializeProfile(feed_profile),
    source_metadata: source_metadata ?? undefined,
    proposals:     annotated,
    composition:   composition ?? null,
    usefulness_scores,
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
