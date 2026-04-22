/**
 * src/policy/negative-policy.js
 * FORGE-owned negative policy flag evaluators.
 *
 * These flags are advisory signals emitted by FORGE at classification time,
 * before Echelon's admission gate runs its own five-point policy check.
 * They are distinct from Echelon rejection codes — FORGE originates them,
 * Echelon may act on them at admission time.
 *
 * Ownership boundary (confirmed: grimoires/loa/context/cycle-002-echelon-integration.md §5):
 *   FORGE owns:   synthetic_only, no_settlement_authority, reflexive_feed
 *   Echelon owns: insufficient_independence, hidden_upstream_dependency
 *
 * @module policy/negative-policy
 */

/**
 * Feed ID substrings that suggest a self-referential feed.
 * Conservative: narrow list to avoid false positives.
 */
const REFLEXIVE_PATTERNS = ['_self_', '_internal_', '_echo_', '_loopback_'];

/**
 * Trust tiers that cannot provide settlement authority.
 * T3 = signal only (never settles). 'unknown' = no tier declared.
 */
const NON_SETTLEMENT_TIERS = new Set(['T3', 'unknown']);

/**
 * Evaluate FORGE-owned negative policy flags for a proposal envelope.
 *
 * Three flags are evaluated:
 *   - no_settlement_authority: source cannot settle a theatre (T3/unknown tier)
 *   - synthetic_only:          T3 feed with all proposals below 50% confidence
 *   - reflexive_feed:          feed_id contains a self-reference pattern
 *
 * @param {Object}   opts
 * @param {Object[]} opts.proposals        - Annotated proposals from emitEnvelope
 * @param {Object}   opts.feed_profile     - Classified FeedProfile (Q1-Q5)
 * @param {Object}   [opts.source_metadata] - Optional source provenance metadata
 * @param {string}   [opts.feed_id]        - Feed identifier (for reflexive_feed check)
 * @returns {string[]} Sorted array of flag strings. Empty array = no violations.
 */
export function evaluateNegativePolicy({ proposals, feed_profile, source_metadata, feed_id }) {
  const flags = new Set();
  const tier = source_metadata?.trust_tier ?? null;

  // 1. no_settlement_authority
  // Fires when source_metadata is absent or the trust tier cannot settle.
  if (!source_metadata || NON_SETTLEMENT_TIERS.has(tier ?? 'unknown')) {
    flags.add('no_settlement_authority');
  }

  // 2. synthetic_only
  // Heuristic: a T3 (signal-only) feed whose proposals all fall below 50%
  // confidence likely has no verifiable upstream source. Documented as
  // heuristic — consumers SHOULD treat this as advisory, not conclusive.
  if (
    tier === 'T3' &&
    proposals.length > 0 &&
    proposals.every(p => (p.confidence ?? 0) < 0.5)
  ) {
    flags.add('synthetic_only');
  }

  // 3. reflexive_feed
  // Conservative: fires only on an explicit set of self-reference substrings
  // in feed_id. Narrow list prevents false positives on real feed names.
  if (feed_id && REFLEXIVE_PATTERNS.some(pat => feed_id.includes(pat))) {
    flags.add('reflexive_feed');
  }

  return [...flags].sort();
}
