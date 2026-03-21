/**
 * test/convergence/specs/breath-spec.js
 * BREATH backing specification — what FORGE should discover from PurpleAir + AirNow data.
 * Source: FORGE_PROGRAM.md backing specification section.
 *
 * @module convergence/specs/breath
 */

/**
 * Expected FeedProfile for BREATH (PurpleAir T3 + AirNow T1 air quality).
 */
export const expected_profile = {
  cadence: {
    classification: 'multi_cadence',
    streams: ['120s', '60min'],
  },
  distribution: {
    type: 'bounded_numeric',
    bounds: [0, 500],
  },
  noise: {
    classification: 'mixed',
    components: ['cyclical', 'spike_driven'],
  },
  density: {
    classification: 'multi_tier',
    tiers: ['dense', 'sparse'],
  },
  thresholds: {
    type: 'regulatory',
    values: [51, 101, 151, 201, 301],
  },
};

/**
 * Expected Theatre proposals for BREATH.
 * 3 templates: threshold_gate, divergence, cascade.
 *
 * Critical: settlement_source MUST be AirNow (T1), not PurpleAir (T3).
 * If the selector proposes PurpleAir as settlement source, the oracle trust
 * model is broken — only T0/T1 sources may settle.
 */
export const expected_templates = [
  {
    template: 'threshold_gate',
    params: {
      // Core params
      threshold: 151,        // AQI ≥151 (Unhealthy)
      window_hours: 24,
      base_rate: null,
      // Context params — CRITICAL: settlement source must be official (T1)
      settlement_source: 'airnow',
      input_mode: 'single',
      threshold_type: 'regulatory',
    },
  },
  {
    template: 'divergence',
    params: {
      // Core params — co-located sensor pair divergence
      source_a_type: 'sensor_a',
      source_b_type: 'sensor_b',
      divergence_threshold: null,
      // Context params
      resolution_mode: 'expiry',
    },
  },
  {
    template: 'cascade',
    params: {
      // Core params — wildfire spike trigger
      trigger_threshold: 200,  // AQI ≥200
      bucket_count: 5,
      window_hours: 72,
      // Context params
      prior_model: null,
    },
  },
];

/** Number of expected templates. */
export const template_count = expected_templates.length;
