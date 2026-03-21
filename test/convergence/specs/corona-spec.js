/**
 * test/convergence/specs/corona-spec.js
 * CORONA backing specification — what FORGE should discover from SWPC + DONKI data.
 * Source: FORGE_PROGRAM.md backing specification section.
 *
 * @module convergence/specs/corona
 */

/**
 * Expected FeedProfile for CORONA (SWPC + NASA DONKI space weather).
 */
export const expected_profile = {
  cadence: {
    classification: 'multi_cadence',
    streams: ['1min', '3hr', '5min', 'event'],
  },
  distribution: {
    type: 'composite',
    sub_types: ['bounded_numeric', 'categorical'],
  },
  noise: {
    classification: 'mixed',
    components: ['cyclical', 'spike_driven'],
  },
  density: {
    classification: 'single_point',
  },
  thresholds: {
    type: 'regulatory',
    values: ['G1-G5', 'S1-S5', 'R1-R5'],
  },
};

/**
 * Expected Theatre proposals for CORONA.
 * 5 templates: 3× threshold_gate, 1× cascade, 1× divergence.
 * Duplicate threshold_gates matched by max param overlap (greedy).
 */
export const expected_templates = [
  {
    template: 'threshold_gate',
    params: {
      // Core params — flare class threshold
      threshold: 'M1.0',
      window_hours: 24,
      base_rate: null,
      // Context params
      settlement_source: null,
      input_mode: 'single',
      threshold_type: 'regulatory',
    },
  },
  {
    template: 'threshold_gate',
    params: {
      // Core params — Kp geomagnetic threshold
      threshold: 5,
      window_hours: 72,
      base_rate: null,
      // Context params
      settlement_source: null,
      input_mode: 'multi',
      threshold_type: 'regulatory',
    },
  },
  {
    template: 'threshold_gate',
    params: {
      // Core params — CME arrival window
      threshold: null,
      window_hours: 6,   // ±6h = 6h window
      base_rate: null,
      // Context params
      settlement_source: null,
      input_mode: 'single',
      threshold_type: 'regulatory',
    },
  },
  {
    template: 'cascade',
    params: {
      // Core params — M5+ flare → proton event sequence
      trigger_threshold: 'M5.0',
      bucket_count: 5,
      window_hours: 72,
      // Context params
      prior_model: null,
    },
  },
  {
    template: 'divergence',
    params: {
      // Core params — Bz volatility temporal divergence
      source_a_type: 'realtime',
      source_b_type: 'forecast',
      divergence_threshold: null,
      // Context params
      resolution_mode: 'expiry',
    },
  },
];

/** Number of expected templates. */
export const template_count = expected_templates.length;
