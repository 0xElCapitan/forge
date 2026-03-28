/**
 * src/processor/quality.js
 * Generalized quality scoring for evidence bundles.
 *
 * Quality is a [0, 1] score reflecting how trustworthy and fresh a reading is.
 * It is configurable per feed tier (T0–T3) and optionally decays with staleness.
 *
 * Used by bundles.js to populate `quality` on every EvidenceBundle.
 *
 * @module processor/quality
 */

// ─── Tier baseline ────────────────────────────────────────────────────────────

/**
 * Quality baseline by oracle trust tier.
 * T0 = ground-truth authority (perfect baseline), T3 = uncorroborated signal.
 */
const TIER_BASELINE = {
  T0: 1.00,
  T1: 0.90,
  T2: 0.70,
  T3: 0.50,
};

const DEFAULT_BASELINE = 0.50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Freshness score: 1.0 when age=0, decaying linearly to 0.0 at stale_after_ms.
 * Future timestamps receive a slight penalty (0.9).
 *
 * @param {number} timestamp   - event timestamp (Unix ms)
 * @param {number} now         - current time (Unix ms)
 * @param {number} stale_after_ms - age at which freshness reaches 0
 * @returns {number} freshness in [0, 1]
 */
function freshnessScore(timestamp, now, stale_after_ms) {
  if (stale_after_ms <= 0) return 0;  // guard: avoid division by zero → NaN
  const age_ms = now - timestamp;
  if (age_ms < 0) return 0.9;  // future timestamp — slight penalty
  return Math.max(0, 1 - age_ms / stale_after_ms);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute quality score for a raw event.
 *
 * @param {{ value: number, timestamp: number }} event - raw event with at least value + timestamp
 * @param {Object} [config]
 * @param {string} [config.tier='T3']              - oracle trust tier (T0/T1/T2/T3)
 * @param {number} [config.now=Date.now()]         - injectable clock
 * @param {number} [config.stale_after_ms=3600000] - staleness threshold (default: 1 hour)
 * @param {number} [config.freshness_weight=0.2]   - blend weight for freshness component
 * @returns {number} quality in [0, 1]
 */
export function computeQuality(event, config = {}) {
  const {
    tier = 'T3',
    now = Date.now(),
    stale_after_ms = 3_600_000,
    freshness_weight = 0.2,
  } = config;

  const base = TIER_BASELINE[tier] ?? DEFAULT_BASELINE;
  const freshness = freshnessScore(event.timestamp ?? now, now, stale_after_ms);

  // Weighted blend: mostly tier baseline, partially freshness.
  return Math.max(0, Math.min(1, (1 - freshness_weight) * base + freshness_weight * freshness));
}
