/**
 * src/filter/usefulness.js
 * Economic usefulness scoring for FORGE Theatre proposals.
 *
 * Formula (from FORGE_PROGRAM.md § Economic usefulness heuristic):
 *   usefulness = population_impact × regulatory_relevance × predictability × actionability
 *
 * Each factor is in [0, 1]. Weights are intentionally equal at 1.0 pending
 * real-world calibration. The formula is correct; weights need iteration.
 *
 * Factors:
 *   population_impact    — geographic coverage and population affected by the feed
 *   regulatory_relevance — whether the threshold has regulatory/safety significance
 *   predictability       — whether cadence is fast enough to generate RLMF volume
 *   actionability        — whether an existing market or decision depends on this measurement
 *
 * Acceptance criteria:
 *   - PurpleAir (T3, community sensor) scores lower than AirNow (T1, official)
 *   - ThingSpeak temperature (no regulatory threshold) scores lower than EPA AQI
 *   - Result is deterministic
 *
 * @module filter/usefulness
 */

// ─── Factor tables ─────────────────────────────────────────────────────────────

/**
 * Population impact by density classification.
 * Dense networks with multiple tiers cover larger populations.
 */
const DENSITY_IMPACT = {
  multi_tier:     0.90,  // T3 crowd + T1 official → broad coverage
  dense_network:  0.80,
  sparse_network: 0.50,
  single_point:   0.25,
};

/**
 * Regulatory relevance by threshold type.
 * Regulatory thresholds are calibrated to safety/policy outcomes.
 */
const THRESHOLD_RELEVANCE = {
  regulatory: 0.95,
  physical:   0.65,
  statistical: 0.40,
  none:        0.10,
};

/**
 * Predictability by cadence classification.
 * Faster cadence → more RLMF training data per unit time.
 */
const CADENCE_PREDICTABILITY = {
  seconds:      0.95,
  minutes:      0.85,
  hours:        0.55,
  days:         0.30,
  event_driven: 0.60,   // sparse but episodic — useful for rare-event markets
  multi_cadence: 0.80,  // multiple streams → rich data
};

/**
 * Trust-tier modifier for actionability.
 * T0/T1 official data drives regulatory decisions (high actionability).
 * T3 community/signal data is informative but not decision-authoritative.
 */
const TIER_ACTIONABILITY = {
  T0: 1.00,  // settlement authority — directly actionable
  T1: 0.90,  // official source — used in regulatory decisions
  T2: 0.65,  // corroboration — evidence layer
  T3: 0.45,  // signal only — community use, not decision-grade
  unknown: 0.30,
};

// ─── Factor computation ────────────────────────────────────────────────────────

function populationImpact(feedProfile) {
  const cls = feedProfile?.density?.classification ?? 'single_point';
  return DENSITY_IMPACT[cls] ?? DENSITY_IMPACT.single_point;
}

function regulatoryRelevance(feedProfile) {
  const type = feedProfile?.thresholds?.type ?? 'none';
  return THRESHOLD_RELEVANCE[type] ?? THRESHOLD_RELEVANCE.none;
}

function predictability(feedProfile) {
  const cls = feedProfile?.cadence?.classification ?? 'event_driven';
  return CADENCE_PREDICTABILITY[cls] ?? CADENCE_PREDICTABILITY.event_driven;
}

function actionability(feedProfile, proposal, sourceTier) {
  // Base from threshold type: regulatory thresholds are directly actionable
  const thresholdBase = feedProfile?.thresholds?.type === 'regulatory' ? 0.85 : 0.55;

  // Tier modifier: official sources produce decision-grade actionability
  const tierMod = TIER_ACTIONABILITY[sourceTier] ?? TIER_ACTIONABILITY.unknown;

  return thresholdBase * tierMod;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the economic usefulness of a Theatre proposal given its feed profile.
 *
 * @param {Object} proposal    - Proposal from selectTemplates (template, params, confidence)
 * @param {Object} feedProfile - FeedProfile from classify (cadence, distribution, noise, density, thresholds)
 * @param {Object} [config]
 * @param {string} [config.source_tier='unknown'] - Oracle trust tier of the primary data source
 * @returns {number} usefulness score in [0, 1]
 */
export function computeUsefulness(proposal, feedProfile, config = {}) {
  const { source_tier = 'unknown' } = config;

  const pop   = populationImpact(feedProfile);
  const reg   = regulatoryRelevance(feedProfile);
  const pred  = predictability(feedProfile);
  const act   = actionability(feedProfile, proposal, source_tier);

  return Math.max(0, Math.min(1, pop * reg * pred * act));
}
