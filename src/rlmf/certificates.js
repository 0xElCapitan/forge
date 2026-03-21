/**
 * src/rlmf/certificates.js
 * RLMF certificate export — same schema as TREMOR/CORONA/BREATH.
 *
 * Reinforcement Learning from Market Feedback (RLMF): after a theatre resolves,
 * the final probability is scored against the true outcome using the Brier
 * scoring rule. The certificate captures the full history for training data export.
 *
 * Brier scoring:
 *   Binary:     BS = (probability - outcome)²              ∈ [0, 1]
 *   Multi-class: BS = Σᵢ (pᵢ - oᵢ)²  over N buckets      ∈ [0, N]
 *                (N=5 for cascade; lower is better)
 *
 * Certificate schema (identical across TREMOR/CORONA/BREATH/FORGE):
 *   {
 *     theatre_id       : string|null          - external identifier
 *     template         : string               - theatre template type
 *     params           : Object               - locked params at creation
 *     created_at       : number               - Unix ms
 *     resolved_at      : number|null          - Unix ms, null if not resolved
 *     settlement_class : string|null          - 'oracle'|'auto'|'expired'|...
 *     outcome          : boolean|number|null  - true/false for binary; bucket index for cascade
 *     final_probability: number               - position_probability at export time
 *     brier_score      : number|null          - null if theatre is not resolved
 *     position_history : Array                - full history of probability updates
 *   }
 *
 * @module rlmf/certificates
 */

// ─── Brier scoring ─────────────────────────────────────────────────────────────

/**
 * Brier score for a binary prediction market.
 *
 * BS = (probability - outcome)²
 *
 * - Perfect forecast: BS = 0 (probability matches outcome)
 * - Worst forecast: BS = 1 (completely wrong with certainty)
 * - Climatological (50/50): BS = 0.25
 *
 * @param {boolean|0|1} outcome     - true/1 = event occurred, false/0 = did not
 * @param {number}       probability - forecast probability in [0, 1]
 * @returns {number} Brier score in [0, 1]
 */
export function brierScoreBinary(outcome, probability) {
  const o = outcome ? 1 : 0;
  return (probability - o) ** 2;
}

/**
 * Brier score for a multi-class prediction (cascade theatre, 5 buckets).
 *
 * BS = Σᵢ (pᵢ - oᵢ)²
 * where oᵢ = 1 if i === outcome_bucket else 0.
 *
 * Range: [0, N] where N = distribution.length (N=5 for cascade).
 * Lower is better. Perfect forecast: BS = 0.
 *
 * @param {number}   outcome_bucket - Index of the bucket that actually occurred (0–4)
 * @param {number[]} distribution   - Forecast probabilities [p0, p1, p2, p3, p4]
 * @returns {number} Brier score in [0, distribution.length]
 */
export function brierScoreMultiClass(outcome_bucket, distribution) {
  return distribution.reduce((sum, p, i) => {
    const o = i === outcome_bucket ? 1 : 0;
    return sum + (p - o) ** 2;
  }, 0);
}

// ─── Certificate export ────────────────────────────────────────────────────────

/**
 * Templates that use multi-class Brier scoring (Cascade: 5-bucket distribution).
 * All other templates use binary Brier scoring.
 */
const MULTI_CLASS_TEMPLATES = new Set(['cascade']);

/**
 * Export an RLMF certificate from a resolved or expired theatre.
 *
 * For unresolved theatres (status === 'open'), `brier_score` is null.
 * For expired theatres, `brier_score` is null (no ground-truth outcome).
 * For resolved theatres, `brier_score` is computed using the appropriate scorer.
 *
 * @param {Object} theatre - Theatre state (from any theatre template)
 * @param {Object} [config]
 * @param {string|null} [config.theatre_id=null] - External identifier for this theatre
 * @returns {Object} RLMF certificate
 */
export function exportCertificate(theatre, config = {}) {
  const { theatre_id = null } = config;

  const resolved = theatre.status === 'resolved';
  const outcome  = theatre.resolution?.outcome ?? null;

  let brier_score = null;

  if (resolved && outcome !== null) {
    if (MULTI_CLASS_TEMPLATES.has(theatre.template)) {
      // Cascade: multi-class Brier over position_distribution
      const dist = theatre.position_distribution ?? [0.2, 0.2, 0.2, 0.2, 0.2];
      brier_score = brierScoreMultiClass(outcome, dist);
    } else {
      // Binary theatre: threshold_gate, divergence, regime_shift, persistence, anomaly
      const prob = typeof theatre.position_probability === 'number'
        ? theatre.position_probability
        : 0.5;
      brier_score = brierScoreBinary(outcome, prob);
    }
  }

  return {
    theatre_id,
    template:         theatre.template,
    params:           theatre.params,
    created_at:       theatre.created_at,
    resolved_at:      theatre.resolution?.settled_at ?? null,
    settlement_class: theatre.resolution?.settlement_class ?? null,
    outcome,
    final_probability: theatre.position_probability ?? null,
    brier_score,
    position_history: theatre.position_history ?? [],
  };
}
