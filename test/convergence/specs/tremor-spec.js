/**
 * test/convergence/specs/tremor-spec.js
 * TREMOR backing specification — what FORGE should discover from USGS data.
 * Source: FORGE_PROGRAM.md backing specification section.
 *
 * @module convergence/specs/tremor
 */

/**
 * Expected FeedProfile for TREMOR (USGS seismic).
 * Q1-Q5 classifications the classifier must produce.
 */
export const expected_profile = {
  cadence: {
    classification: 'event_driven',
  },
  distribution: {
    type: 'unbounded_numeric',
  },
  noise: {
    classification: 'spike_driven',
  },
  density: {
    classification: 'sparse_network',
  },
  thresholds: {
    type: 'statistical',
  },
};

/**
 * Expected Theatre proposals for TREMOR.
 * 5 templates: threshold_gate, cascade, divergence, anomaly, regime_shift.
 * Params are the scored fields per FORGE_PROGRAM.md.
 */
export const expected_templates = [
  {
    template: 'threshold_gate',
    params: {
      // Core params
      threshold: 5.0,        // M5.0
      window_hours: 24,
      base_rate: null,       // not specified in backing spec
      // Context params
      settlement_source: null,
      input_mode: 'single',
      threshold_type: 'statistical',
    },
  },
  {
    template: 'cascade',
    params: {
      // Core params
      trigger_threshold: 6.0,  // M6.0+
      bucket_count: 5,
      window_hours: 72,
      // Context params
      prior_model: 'omori',
    },
  },
  {
    template: 'divergence',
    params: {
      // Core params
      source_a_type: 'automatic',
      source_b_type: 'reviewed',
      divergence_threshold: null,
      // Context params
      resolution_mode: 'self-resolving',
    },
  },
  {
    template: 'anomaly',
    params: {
      // Core params
      baseline_metric: 'b-value',
      sigma_threshold: null,
      window_hours: 168,  // 7d = 168h
    },
  },
  {
    template: 'regime_shift',
    params: {
      // Core params
      state_boundary: null,
      zone_prior: null,
    },
  },
];

/** Number of expected templates (used by scorer for max TemplateScore calc). */
export const template_count = expected_templates.length;
