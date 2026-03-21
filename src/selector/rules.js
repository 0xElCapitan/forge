/**
 * src/selector/rules.js
 * Template selection rule definitions for FORGE.
 *
 * Each rule maps observable feed characteristics (FeedProfile fields) to a
 * Theatre template proposal. Rules fire when ALL conditions are satisfied.
 *
 * Condition operators: equals, in, gt, lt, gte, lte
 *
 * Rule ordering within RULES is arbitrary — the selector evaluates all rules
 * and returns all fired proposals. The scorer's greedy algorithm handles
 * optimal proposal-to-expected-template assignment.
 *
 * @module selector/rules
 */

/**
 * @typedef {Object} Condition
 * @property {string} field     - Dot-path into FeedProfile (e.g. 'noise.classification')
 * @property {string} operator  - 'equals'|'in'|'gt'|'lt'|'gte'|'lte'
 * @property {any}    value     - Comparison target
 */

/**
 * @typedef {Object} Rule
 * @property {string}      id         - Unique rule identifier
 * @property {Condition[]} conditions - All conditions must be true for rule to fire
 * @property {string}      template   - Theatre template type to propose
 * @property {Object}      params     - Template parameters for the proposal
 * @property {number}      confidence - 0–1 rule confidence
 * @property {string[]}    traced_to  - Backing construct references
 */

/** @type {Rule[]} */
export const RULES = [

  // ─── TREMOR (USGS seismic) ─────────────────────────────────────────────────
  // Expected profile: event_driven, unbounded_numeric, spike_driven,
  //                   sparse_network, statistical

  {
    id: 'seismic_threshold_gate',
    conditions: [
      { field: 'noise.classification', operator: 'equals', value: 'spike_driven'      },
      { field: 'distribution.type',    operator: 'equals', value: 'unbounded_numeric' },
      { field: 'thresholds.type',      operator: 'equals', value: 'statistical'       },
    ],
    template: 'threshold_gate',
    params: {
      threshold:         5.0,
      window_hours:      24,
      base_rate:         null,
      input_mode:        'single',
      threshold_type:    'statistical',
      settlement_source: null,
    },
    confidence: 0.90,
    traced_to: ['TREMOR/MagGate'],
  },

  {
    id: 'seismic_cascade',
    conditions: [
      { field: 'cadence.classification',  operator: 'equals', value: 'event_driven'   },
      { field: 'density.classification',  operator: 'equals', value: 'sparse_network' },
    ],
    template: 'cascade',
    params: {
      trigger_threshold: 6.0,
      bucket_count:      5,
      window_hours:      72,
      prior_model:       'omori',
    },
    confidence: 0.85,
    traced_to: ['TREMOR/AftershockCascade'],
  },

  {
    id: 'seismic_review_divergence',
    conditions: [
      { field: 'cadence.classification', operator: 'equals', value: 'event_driven' },
      { field: 'noise.classification',   operator: 'equals', value: 'spike_driven' },
    ],
    template: 'divergence',
    params: {
      source_a_type:        'automatic',
      source_b_type:        'reviewed',
      divergence_threshold: null,
      resolution_mode:      'self-resolving',
    },
    confidence: 0.80,
    traced_to: ['TREMOR/OracleDivergence'],
  },

  {
    id: 'seismic_anomaly',
    conditions: [
      { field: 'noise.classification',   operator: 'equals', value: 'spike_driven'   },
      { field: 'density.classification', operator: 'equals', value: 'sparse_network' },
    ],
    template: 'anomaly',
    params: {
      baseline_metric: 'b-value',
      sigma_threshold: null,
      window_hours:    168,
    },
    confidence: 0.75,
    traced_to: ['TREMOR/SwarmWatch'],
  },

  {
    id: 'seismic_regime_shift',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'unbounded_numeric' },
      { field: 'cadence.classification', operator: 'equals', value: 'event_driven'      },
    ],
    template: 'regime_shift',
    params: {
      state_boundary: null,
      zone_prior:     null,
    },
    confidence: 0.70,
    traced_to: ['TREMOR/DepthRegime'],
  },

  // ─── CORONA (SWPC + NASA DONKI space weather) ──────────────────────────────
  // Expected profile: multi_cadence, composite, mixed, single_point, regulatory
  //
  // CORONA has 3 expected threshold_gate templates (flare class, Kp, CME arrival).
  // Three rules fire for CORONA — each proposes a distinct threshold_gate variant.
  // The scorer's greedy algorithm assigns them optimally.

  {
    id: 'space_weather_flare_gate',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'composite'     },
      { field: 'thresholds.type',        operator: 'equals', value: 'regulatory'    },
      { field: 'cadence.classification', operator: 'equals', value: 'multi_cadence' },
    ],
    template: 'threshold_gate',
    params: {
      threshold:         'M1.0',
      window_hours:      24,
      base_rate:         null,
      input_mode:        'single',
      threshold_type:    'regulatory',
      settlement_source: null,
    },
    confidence: 0.88,
    traced_to: ['CORONA/FlareGate'],
  },

  {
    id: 'space_weather_kp_gate',
    conditions: [
      { field: 'distribution.type', operator: 'equals', value: 'composite'  },
      { field: 'thresholds.type',   operator: 'equals', value: 'regulatory' },
    ],
    template: 'threshold_gate',
    params: {
      threshold:         5,
      window_hours:      72,
      base_rate:         null,
      input_mode:        'multi',
      threshold_type:    'regulatory',
      settlement_source: null,
    },
    confidence: 0.82,
    traced_to: ['CORONA/GeomagGate'],
  },

  {
    id: 'space_weather_cme_gate',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'composite'     },
      { field: 'cadence.classification', operator: 'equals', value: 'multi_cadence' },
      { field: 'noise.classification',   operator: 'equals', value: 'mixed'         },
    ],
    template: 'threshold_gate',
    params: {
      threshold:         null,
      window_hours:      6,
      base_rate:         null,
      input_mode:        'single',
      threshold_type:    'regulatory',
      settlement_source: null,
    },
    confidence: 0.76,
    traced_to: ['CORONA/CMEArrivalGate'],
  },

  {
    id: 'space_weather_proton_cascade',
    conditions: [
      { field: 'distribution.type', operator: 'equals', value: 'composite'  },
      { field: 'thresholds.type',   operator: 'equals', value: 'regulatory' },
    ],
    template: 'cascade',
    params: {
      trigger_threshold: 'M5.0',
      bucket_count:      5,
      window_hours:      72,
      prior_model:       null,
    },
    confidence: 0.80,
    traced_to: ['CORONA/ProtonCascade'],
  },

  {
    id: 'space_weather_solar_wind_divergence',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'composite'     },
      { field: 'cadence.classification', operator: 'equals', value: 'multi_cadence' },
    ],
    template: 'divergence',
    params: {
      source_a_type:        'realtime',
      source_b_type:        'forecast',
      divergence_threshold: null,
      resolution_mode:      'expiry',
    },
    confidence: 0.75,
    traced_to: ['CORONA/SolarWindDivergence'],
  },

  // ─── BREATH (PurpleAir T3 + AirNow T1 air quality) ────────────────────────
  // Expected profile: multi_cadence, bounded_numeric, mixed, multi_tier, regulatory
  //
  // Key invariant: settlement_source MUST be 'airnow' (T1), not 'purpleair' (T3).
  // Only T0/T1 sources may settle a theatre — this is encoded in the rule params.

  {
    id: 'aqi_threshold_gate',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'bounded_numeric' },
      { field: 'thresholds.type',        operator: 'equals', value: 'regulatory'      },
      { field: 'density.classification', operator: 'equals', value: 'multi_tier'      },
    ],
    template: 'threshold_gate',
    params: {
      threshold:         151,
      window_hours:      24,
      base_rate:         null,
      input_mode:        'single',
      threshold_type:    'regulatory',
      settlement_source: 'airnow',
    },
    confidence: 0.90,
    traced_to: ['BREATH/AQIGate'],
  },

  {
    id: 'air_quality_sensor_divergence',
    conditions: [
      { field: 'density.classification', operator: 'equals', value: 'multi_tier' },
      { field: 'thresholds.type',        operator: 'equals', value: 'regulatory' },
      { field: 'noise.classification',   operator: 'equals', value: 'mixed'      },
    ],
    template: 'divergence',
    params: {
      source_a_type:        'sensor_a',
      source_b_type:        'sensor_b',
      divergence_threshold: null,
      resolution_mode:      'expiry',
    },
    confidence: 0.80,
    traced_to: ['BREATH/SensorDivergence'],
  },

  {
    id: 'wildfire_cascade',
    conditions: [
      { field: 'distribution.type',      operator: 'equals', value: 'bounded_numeric' },
      { field: 'density.classification', operator: 'equals', value: 'multi_tier'      },
      { field: 'noise.classification',   operator: 'equals', value: 'mixed'           },
    ],
    template: 'cascade',
    params: {
      trigger_threshold: 200,
      bucket_count:      5,
      window_hours:      72,
      prior_model:       null,
    },
    confidence: 0.80,
    traced_to: ['BREATH/WildfireCascade'],
  },

];
