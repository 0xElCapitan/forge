/**
 * src/processor/uncertainty.js
 * Generalized doubt pricing for evidence bundles.
 *
 * doubt_price is a [0, 1] confidence discount applied to theatre probability updates.
 * High quality → low doubt (high confidence). Low quality → high doubt (high uncertainty).
 *
 * Used by bundles.js to populate `doubt_price` on every EvidenceBundle.
 *
 * @module processor/uncertainty
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute doubt price from quality score.
 *
 * doubt_price = 1 - quality
 *
 * - T0 source (quality ≈ 1.0) → doubt_price ≈ 0.0  (virtually certain)
 * - T3 source (quality ≈ 0.5) → doubt_price ≈ 0.5  (significant uncertainty)
 *
 * @param {number} quality - quality score in [0, 1] (from computeQuality)
 * @returns {number} doubt_price in [0, 1]
 */
export function computeDoubtPrice(quality) {
  return Math.max(0, Math.min(1, 1 - quality));
}
