/**
 * src/trust/oracle-trust.js
 * Oracle trust tier enforcement (T0–T3).
 *
 * CRITICAL INVARIANT: PurpleAir (T3) must NEVER settle a theatre.
 * Only T0 (settlement authority) and T1 (official source) may settle.
 * This invariant is enforced at bundle processing time, not proposal time.
 *
 * Trust tiers (from FORGE_PROGRAM.md § Oracle trust tiers):
 *   T0 — Settlement authority  (settles, ground truth)
 *         Examples: EPA AQS, USGS reviewed, GFZ Kp
 *   T1 — Official source       (settles with Brier discount)
 *         Examples: AirNow, USGS automatic, SWPC GOES
 *   T2 — Corroboration         (position updates only, no settlement)
 *         Examples: OpenAQ, EMSC
 *   T3 — Signal                (position updates only, no settlement)
 *         Examples: PurpleAir, ThingSpeak
 *
 * T3 → T2 promotion: requires min observation count + uptime % + neighborhood
 * agreement + anti-spoof checks. NEVER to T0/T1 without explicit human override.
 *
 * @module trust/oracle-trust
 */

// ─── Trust registry ───────────────────────────────────────────────────────────

/**
 * FORGE trust tier key format: string keys ("T0", "T1", "T2", "T3").
 *
 * These represent oracle identity tiers — who the source is and whether it can
 * settle a theatre. They are orthogonal to TREMOR's numeric data maturity
 * levels, which describe the maturity stage of a data product. Same tier label,
 * different axis. Do not conflate the two.
 *
 * Echelon provenance mapping (confirmed by Tobias, sprint-10 review):
 *   T0 → signal_initiated   (high confidence — ground truth settlement)
 *   T1 → signal_initiated   (Brier-discounted confidence — official source)
 *   T2 → suggestion_promoted (needs corroborating signals before settlement)
 *   T3 → suggestion_unlinked (no settlement evidence — never settles)
 */

/**
 * Echelon provenance mapping — maps trust tiers to provenance categories.
 * Confirmed by Tobias, sprint-10 review.
 *
 * @type {Readonly<Record<string, { provenance: string, confidence: string }>>}
 */
export const ECHELON_PROVENANCE_MAP = Object.freeze({
  T0: { provenance: 'signal_initiated',    confidence: 'high' },
  T1: { provenance: 'signal_initiated',    confidence: 'brier_discounted' },
  T2: { provenance: 'suggestion_promoted', confidence: 'corroboration_required' },
  T3: { provenance: 'suggestion_unlinked', confidence: 'none' },
});

/**
 * Known source IDs mapped to trust tiers.
 * Keys are lowercase source identifiers. Lookup normalises input to lowercase.
 */
const TRUST_REGISTRY = {
  // T0 — Settlement authority
  'epa_aqs':       'T0',
  'usgs_reviewed': 'T0',
  'gfz_kp':        'T0',

  // T1 — Official source
  'airnow':           'T1',
  'usgs_automatic':   'T1',
  'swpc_goes':        'T1',
  'noaa_goes':        'T1',

  // T2 — Corroboration (evidence only)
  'openaq': 'T2',
  'emsc':   'T2',

  // T3 — Signal (position update only)
  'purpleair':  'T3',
  'thingspeak': 'T3',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the trust tier for a given source ID.
 * Unknown sources are not trusted ('unknown').
 *
 * @param {string|null} sourceId - source identifier (case-insensitive)
 * @returns {'T0'|'T1'|'T2'|'T3'|'unknown'}
 */
export function getTrustTier(sourceId) {
  if (!sourceId || typeof sourceId !== 'string') return 'unknown';
  return TRUST_REGISTRY[sourceId.toLowerCase()] ?? 'unknown';
}

/**
 * Returns true only for tiers that may settle a theatre.
 *
 * CRITICAL: T2, T3, and unknown may NEVER settle. PurpleAir (T3) is the
 * canonical enforcement case — see § Security Architecture (FORGE SDD §7).
 *
 * @param {'T0'|'T1'|'T2'|'T3'|'unknown'} tier
 * @returns {boolean}
 */
export function canSettle(tier) {
  return tier === 'T0' || tier === 'T1';
}

/**
 * Validate that a settlement attempt is authorised.
 * Returns an object describing whether settlement is allowed.
 *
 * @param {string|null} sourceId - source requesting settlement
 * @returns {{ allowed: boolean, tier: string, reason?: string }}
 */
export function validateSettlement(sourceId) {
  const tier = getTrustTier(sourceId);
  const allowed = canSettle(tier);
  if (allowed) {
    return { allowed: true, tier };
  }
  return {
    allowed: false,
    tier,
    reason: `source '${sourceId}' has tier ${tier} — only T0/T1 sources may settle`,
  };
}
