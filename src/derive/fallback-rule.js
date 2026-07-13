/**
 * src/derive/fallback-rule.js
 *
 * The experimental statistical-threshold fallback rule (Cycle-004 FR-3; SDD
 * Lane L1). NOT a member of `src/selector/rules.js` — the landed authored-rule
 * set is unchanged. Emitted only via the experimental default-OFF path, only
 * after the authored domain selector returns zero proposals.
 *
 * The proposal uses the six-key `threshold_gate` param shape every landed
 * threshold_gate rule carries, so the standard emit annotation supplies the
 * remaining contract-required Proposal fields (proposal_id, brier_type,
 * claim_shape, usefulness_score) with no IR/schema change.
 *
 * @module derive/fallback-rule
 */

/**
 * Rule-shaped descriptor (id `statistical_threshold_gate`, template
 * `threshold_gate`). Frozen. `params.threshold` is a placeholder — the real
 * derived value is supplied per-record by {@link buildFallbackProposal}.
 */
export const STATISTICAL_THRESHOLD_RULE = Object.freeze({
  id: 'statistical_threshold_gate',
  template: 'threshold_gate',
  params: Object.freeze({
    threshold:         null,
    window_hours:      720,
    base_rate:         null,
    input_mode:        'single',
    threshold_type:    'statistical',
    settlement_source: null,
  }),
  confidence: 0.50,
  traced_to: Object.freeze(['experimental/HF-1-order-statistic']),
});

/**
 * Build the fallback Proposal from a derived ParameterRecord. Same pre-emit
 * shape as a `selectTemplates` proposal: `{ template, params, confidence,
 * rationale }`. `window_hours = 720` = the pre-registered horizon H (market
 * duration); `confidence = 0.50` is authored strictly below the landed floor.
 *
 * @param {{value:number}} record - ParameterRecord v0 (the `record` of a RANKED_CANDIDATES result)
 * @returns {{template:string, params:Object, confidence:number, rationale:string}}
 */
export function buildFallbackProposal(record) {
  return {
    template: 'threshold_gate',
    params: {
      threshold:         record.value,
      window_hours:      720,
      base_rate:         null,
      input_mode:        'single',
      threshold_type:    'statistical',
      settlement_source: null,
    },
    confidence: 0.50,
    rationale:
      "Experimental fallback rule 'statistical_threshold_gate': HF-1 order-statistic threshold " +
      'derived from the trailing window. Experimental, default-OFF, unvalidated.',
  };
}
