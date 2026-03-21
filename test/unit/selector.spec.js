/**
 * test/unit/selector.spec.js
 * Unit tests for src/selector/template-selector.js and src/selector/rules.js
 *
 * Tests: getField, evaluateRule (all operators), selectTemplates (per-spec
 * profile fixtures), sorting/tie-breaking, and false-positive absence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getField, evaluateRule, selectTemplates } from '../../src/selector/template-selector.js';
import { RULES } from '../../src/selector/rules.js';

// ─── Synthetic profile fixtures ───────────────────────────────────────────────

/** TREMOR-like profile */
const TREMOR_PROFILE = {
  cadence:      { classification: 'event_driven' },
  distribution: { type: 'unbounded_numeric' },
  noise:        { classification: 'spike_driven' },
  density:      { classification: 'sparse_network' },
  thresholds:   { type: 'statistical' },
};

/** CORONA-like profile */
const CORONA_PROFILE = {
  cadence:      { classification: 'multi_cadence', streams: ['1min', '3hr', '5min', 'event'] },
  distribution: { type: 'composite', sub_types: ['bounded_numeric', 'categorical'] },
  noise:        { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density:      { classification: 'single_point' },
  thresholds:   { type: 'regulatory' },
};

/** BREATH-like profile */
const BREATH_PROFILE = {
  cadence:      { classification: 'multi_cadence', streams: ['120s', '60min'] },
  distribution: { type: 'bounded_numeric', bounds: [0, 500] },
  noise:        { classification: 'mixed', components: ['cyclical', 'spike_driven'] },
  density:      { classification: 'multi_tier', tiers: ['dense', 'sparse'] },
  thresholds:   { type: 'regulatory' },
};

/** Minimal empty profile */
const EMPTY_PROFILE = {};

// ─── getField ─────────────────────────────────────────────────────────────────

describe('getField', () => {
  it('retrieves top-level field', () => {
    assert.strictEqual(getField({ a: 1 }, 'a'), 1);
  });

  it('retrieves nested field via dot-path', () => {
    const profile = { noise: { classification: 'spike_driven' } };
    assert.strictEqual(getField(profile, 'noise.classification'), 'spike_driven');
  });

  it('retrieves deeply nested field', () => {
    const obj = { a: { b: { c: 42 } } };
    assert.strictEqual(getField(obj, 'a.b.c'), 42);
  });

  it('returns undefined for missing top-level field', () => {
    assert.strictEqual(getField({}, 'missing'), undefined);
  });

  it('returns undefined for missing nested field', () => {
    assert.strictEqual(getField({ a: {} }, 'a.b'), undefined);
  });

  it('returns undefined safely when intermediate is null', () => {
    assert.strictEqual(getField({ a: null }, 'a.b'), undefined);
  });

  it('returns undefined safely when intermediate is undefined', () => {
    assert.strictEqual(getField({ a: undefined }, 'a.b'), undefined);
  });

  it('handles single-segment path', () => {
    assert.strictEqual(getField({ x: 'hello' }, 'x'), 'hello');
  });
});

// ─── evaluateRule — operator coverage ─────────────────────────────────────────

describe('evaluateRule — operators', () => {
  const makeRule = (field, operator, value) => ({
    id: 'test',
    conditions: [{ field, operator, value }],
    template: 'threshold_gate',
    params: {},
    confidence: 1.0,
    traced_to: [],
  });

  it('equals — match', () => {
    const r = makeRule('cadence.classification', 'equals', 'event_driven');
    const result = evaluateRule(TREMOR_PROFILE, r);
    assert.strictEqual(result.fired, true);
    assert.strictEqual(result.conditions_met, 1);
    assert.strictEqual(result.conditions_total, 1);
  });

  it('equals — no match', () => {
    const r = makeRule('cadence.classification', 'equals', 'minutes');
    assert.strictEqual(evaluateRule(TREMOR_PROFILE, r).fired, false);
  });

  it('in — match (value in array)', () => {
    const r = makeRule('thresholds.type', 'in', ['statistical', 'regulatory']);
    assert.strictEqual(evaluateRule(TREMOR_PROFILE, r).fired, true);
  });

  it('in — no match', () => {
    const r = makeRule('thresholds.type', 'in', ['regulatory', 'absolute']);
    assert.strictEqual(evaluateRule(TREMOR_PROFILE, r).fired, false);
  });

  it('gt — match', () => {
    const profile = { score: { value: 10 } };
    const r = makeRule('score.value', 'gt', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, true);
  });

  it('gt — no match (equal)', () => {
    const profile = { score: { value: 5 } };
    const r = makeRule('score.value', 'gt', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, false);
  });

  it('lt — match', () => {
    const profile = { score: { value: 3 } };
    const r = makeRule('score.value', 'lt', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, true);
  });

  it('lt — no match (equal)', () => {
    const profile = { score: { value: 5 } };
    const r = makeRule('score.value', 'lt', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, false);
  });

  it('gte — match (equal)', () => {
    const profile = { score: { value: 5 } };
    const r = makeRule('score.value', 'gte', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, true);
  });

  it('gte — match (greater)', () => {
    const profile = { score: { value: 6 } };
    const r = makeRule('score.value', 'gte', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, true);
  });

  it('gte — no match', () => {
    const profile = { score: { value: 4 } };
    const r = makeRule('score.value', 'gte', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, false);
  });

  it('lte — match (equal)', () => {
    const profile = { score: { value: 5 } };
    const r = makeRule('score.value', 'lte', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, true);
  });

  it('lte — no match (greater)', () => {
    const profile = { score: { value: 6 } };
    const r = makeRule('score.value', 'lte', 5);
    assert.strictEqual(evaluateRule(profile, r).fired, false);
  });

  it('unknown operator → does not fire', () => {
    const r = makeRule('cadence.classification', 'contains', 'event');
    assert.strictEqual(evaluateRule(TREMOR_PROFILE, r).fired, false);
  });
});

// ─── evaluateRule — multi-condition ───────────────────────────────────────────

describe('evaluateRule — multi-condition', () => {
  const multiRule = {
    id: 'multi_test',
    conditions: [
      { field: 'noise.classification',  operator: 'equals', value: 'spike_driven'      },
      { field: 'distribution.type',     operator: 'equals', value: 'unbounded_numeric' },
      { field: 'thresholds.type',       operator: 'equals', value: 'statistical'       },
    ],
    template: 'threshold_gate',
    params: {},
    confidence: 0.9,
    traced_to: [],
  };

  it('fires when ALL conditions match (TREMOR profile)', () => {
    const r = evaluateRule(TREMOR_PROFILE, multiRule);
    assert.strictEqual(r.fired, true);
    assert.strictEqual(r.conditions_met, 3);
  });

  it('does not fire when any condition fails', () => {
    const profile = { ...TREMOR_PROFILE, thresholds: { type: 'regulatory' } };
    const r = evaluateRule(profile, multiRule);
    assert.strictEqual(r.fired, false);
    assert.strictEqual(r.conditions_met, 2);
  });

  it('does not fire on empty profile', () => {
    const r = evaluateRule(EMPTY_PROFILE, multiRule);
    assert.strictEqual(r.fired, false);
    assert.strictEqual(r.conditions_met, 0);
  });

  it('returns correct confidence regardless of firing', () => {
    const r = evaluateRule(EMPTY_PROFILE, multiRule);
    assert.strictEqual(r.confidence, 0.9);
  });
});

// ─── selectTemplates — TREMOR profile ────────────────────────────────────────

describe('selectTemplates — TREMOR profile', () => {
  it('fires exactly 5 proposals (threshold_gate, cascade, divergence, anomaly, regime_shift)', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    assert.strictEqual(proposals.length, 5);
  });

  it('produces a threshold_gate proposal', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const tg = proposals.find(p => p.template === 'threshold_gate');
    assert.ok(tg, 'must include threshold_gate');
  });

  it('threshold_gate params: threshold_type=statistical, input_mode=single, threshold=5', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const tg = proposals.find(p => p.template === 'threshold_gate');
    assert.strictEqual(tg.params.threshold_type, 'statistical');
    assert.strictEqual(tg.params.input_mode, 'single');
    assert.strictEqual(tg.params.threshold, 5.0);
    assert.strictEqual(tg.params.window_hours, 24);
  });

  it('produces a cascade proposal with prior_model=omori', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const c = proposals.find(p => p.template === 'cascade');
    assert.ok(c, 'must include cascade');
    assert.strictEqual(c.params.prior_model, 'omori');
    assert.strictEqual(c.params.trigger_threshold, 6.0);
    assert.strictEqual(c.params.bucket_count, 5);
    assert.strictEqual(c.params.window_hours, 72);
  });

  it('produces a divergence proposal with resolution_mode=self-resolving', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const d = proposals.find(p => p.template === 'divergence');
    assert.ok(d, 'must include divergence');
    assert.strictEqual(d.params.source_a_type, 'automatic');
    assert.strictEqual(d.params.source_b_type, 'reviewed');
    assert.strictEqual(d.params.resolution_mode, 'self-resolving');
  });

  it('produces an anomaly proposal with baseline_metric=b-value, window_hours=168', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const a = proposals.find(p => p.template === 'anomaly');
    assert.ok(a, 'must include anomaly');
    assert.strictEqual(a.params.baseline_metric, 'b-value');
    assert.strictEqual(a.params.window_hours, 168);
    assert.strictEqual(a.params.sigma_threshold, null);
  });

  it('produces a regime_shift proposal', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const rs = proposals.find(p => p.template === 'regime_shift');
    assert.ok(rs, 'must include regime_shift');
    assert.strictEqual(rs.params.state_boundary, null);
    assert.strictEqual(rs.params.zone_prior, null);
  });

  it('all proposals carry confidence and rationale', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    for (const p of proposals) {
      assert.ok(typeof p.confidence === 'number', 'confidence must be number');
      assert.ok(typeof p.rationale === 'string' && p.rationale.length > 0, 'rationale required');
    }
  });
});

// ─── selectTemplates — CORONA profile ────────────────────────────────────────

describe('selectTemplates — CORONA profile', () => {
  it('fires exactly 5 proposals (3 threshold_gate, 1 cascade, 1 divergence)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    assert.strictEqual(proposals.length, 5);
  });

  it('produces 3 threshold_gate proposals', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const tgs = proposals.filter(p => p.template === 'threshold_gate');
    assert.strictEqual(tgs.length, 3);
  });

  it('includes flare gate (threshold=M1.0, window_hours=24, input_mode=single)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const flare = proposals.find(p =>
      p.template === 'threshold_gate' && p.params.threshold === 'M1.0'
    );
    assert.ok(flare, 'must include flare threshold_gate');
    assert.strictEqual(flare.params.window_hours, 24);
    assert.strictEqual(flare.params.input_mode, 'single');
    assert.strictEqual(flare.params.threshold_type, 'regulatory');
  });

  it('includes Kp gate (threshold=5, window_hours=72, input_mode=multi)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const kp = proposals.find(p =>
      p.template === 'threshold_gate' && p.params.threshold === 5
    );
    assert.ok(kp, 'must include Kp threshold_gate');
    assert.strictEqual(kp.params.window_hours, 72);
    assert.strictEqual(kp.params.input_mode, 'multi');
  });

  it('includes CME gate (threshold=null, window_hours=6)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const cme = proposals.find(p =>
      p.template === 'threshold_gate' && p.params.threshold === null && p.params.window_hours === 6
    );
    assert.ok(cme, 'must include CME threshold_gate');
    assert.strictEqual(cme.params.input_mode, 'single');
  });

  it('includes cascade (trigger_threshold=M5.0, prior_model=null)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const c = proposals.find(p => p.template === 'cascade');
    assert.ok(c, 'must include cascade');
    assert.strictEqual(c.params.trigger_threshold, 'M5.0');
    assert.strictEqual(c.params.bucket_count, 5);
    assert.strictEqual(c.params.prior_model, null);
  });

  it('includes divergence (source_a=realtime, source_b=forecast, resolution=expiry)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const d = proposals.find(p => p.template === 'divergence');
    assert.ok(d, 'must include divergence');
    assert.strictEqual(d.params.source_a_type, 'realtime');
    assert.strictEqual(d.params.source_b_type, 'forecast');
    assert.strictEqual(d.params.resolution_mode, 'expiry');
  });
});

// ─── selectTemplates — BREATH profile ────────────────────────────────────────

describe('selectTemplates — BREATH profile', () => {
  it('fires exactly 3 proposals (threshold_gate, divergence, cascade)', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    assert.strictEqual(proposals.length, 3);
  });

  it('AQI threshold_gate: threshold=151, settlement_source=airnow', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const tg = proposals.find(p => p.template === 'threshold_gate');
    assert.ok(tg, 'must include threshold_gate');
    assert.strictEqual(tg.params.threshold, 151);
    assert.strictEqual(tg.params.settlement_source, 'airnow');
    assert.strictEqual(tg.params.threshold_type, 'regulatory');
    assert.strictEqual(tg.params.window_hours, 24);
  });

  it('CRITICAL: settlement_source is airnow, NOT purpleair (trust model)', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    for (const p of proposals) {
      if (p.params.settlement_source != null) {
        assert.notStrictEqual(
          p.params.settlement_source.toLowerCase(),
          'purpleair',
          'PurpleAir (T3) must never be settlement_source'
        );
      }
    }
  });

  it('sensor divergence: source_a=sensor_a, source_b=sensor_b, resolution=expiry', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const d = proposals.find(p => p.template === 'divergence');
    assert.ok(d, 'must include divergence');
    assert.strictEqual(d.params.source_a_type, 'sensor_a');
    assert.strictEqual(d.params.source_b_type, 'sensor_b');
    assert.strictEqual(d.params.resolution_mode, 'expiry');
  });

  it('wildfire cascade: trigger_threshold=200, bucket_count=5', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const c = proposals.find(p => p.template === 'cascade');
    assert.ok(c, 'must include cascade');
    assert.strictEqual(c.params.trigger_threshold, 200);
    assert.strictEqual(c.params.bucket_count, 5);
    assert.strictEqual(c.params.window_hours, 72);
    assert.strictEqual(c.params.prior_model, null);
  });
});

// ─── selectTemplates — no false positives ─────────────────────────────────────

describe('selectTemplates — false positive isolation', () => {
  it('TREMOR profile: no CORONA rules fire (no composite proposals)', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    // CORONA rules all require distribution.type='composite' which TREMOR lacks
    const coronaTemplates = proposals.filter(p =>
      p.rationale.includes('space_weather') ||
      p.params.threshold === 'M1.0' ||
      p.params.threshold === 'M5.0'
    );
    assert.strictEqual(coronaTemplates.length, 0, 'no CORONA-specific proposals on TREMOR');
  });

  it('TREMOR profile: no BREATH rules fire (no bounded_numeric or multi_tier)', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const breathTemplates = proposals.filter(p =>
      p.rationale.includes('aqi') ||
      p.rationale.includes('wildfire') ||
      p.params.settlement_source === 'airnow'
    );
    assert.strictEqual(breathTemplates.length, 0, 'no BREATH-specific proposals on TREMOR');
  });

  it('CORONA profile: no TREMOR rules fire (no seismic proposals)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    // Seismic rules require spike_driven noise; CORONA has 'mixed'
    const seismicRules = proposals.filter(p =>
      p.rationale.includes('seismic') ||
      p.params.prior_model === 'omori'
    );
    assert.strictEqual(seismicRules.length, 0, 'no seismic proposals on CORONA');
  });

  it('CORONA profile: no BREATH rules fire (no multi_tier)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const breathRules = proposals.filter(p =>
      p.params.settlement_source === 'airnow' ||
      p.params.trigger_threshold === 200
    );
    assert.strictEqual(breathRules.length, 0, 'no BREATH-specific proposals on CORONA');
  });

  it('BREATH profile: no seismic rules fire (no event_driven)', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const seismicRules = proposals.filter(p => p.params.prior_model === 'omori');
    assert.strictEqual(seismicRules.length, 0, 'no seismic proposals on BREATH');
  });

  it('BREATH profile: no CORONA rules fire (no composite distribution)', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const coronaRules = proposals.filter(p =>
      p.params.threshold === 'M1.0' ||
      p.params.source_a_type === 'realtime'
    );
    assert.strictEqual(coronaRules.length, 0, 'no CORONA-specific proposals on BREATH');
  });

  it('CORONA profile: no anomaly or regime_shift proposed (seismic rules do not fire)', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    const types = proposals.map(p => p.template);
    assert.ok(!types.includes('anomaly'), 'anomaly must not fire for CORONA');
    assert.ok(!types.includes('regime_shift'), 'regime_shift must not fire for CORONA');
  });

  it('BREATH profile: no anomaly or regime_shift proposed (seismic rules do not fire)', () => {
    const proposals = selectTemplates(BREATH_PROFILE);
    const types = proposals.map(p => p.template);
    assert.ok(!types.includes('anomaly'), 'anomaly must not fire for BREATH');
    assert.ok(!types.includes('regime_shift'), 'regime_shift must not fire for BREATH');
  });

  it('empty profile: no proposals', () => {
    const proposals = selectTemplates(EMPTY_PROFILE);
    assert.strictEqual(proposals.length, 0);
  });
});

// ─── selectTemplates — proposal sorting ──────────────────────────────────────

describe('selectTemplates — sorting', () => {
  it('proposals sorted by confidence desc', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    for (let i = 1; i < proposals.length; i++) {
      assert.ok(
        proposals[i - 1].confidence >= proposals[i].confidence,
        `proposals[${i - 1}].confidence (${proposals[i - 1].confidence}) must be >= proposals[${i}].confidence (${proposals[i].confidence})`
      );
    }
  });

  it('higher confidence proposal appears before lower confidence', () => {
    // seismic_threshold_gate (0.90) should come before seismic_cascade (0.85)
    const proposals = selectTemplates(TREMOR_PROFILE);
    const tgIdx = proposals.findIndex(p => p.template === 'threshold_gate');
    const cascadeIdx = proposals.findIndex(p => p.template === 'cascade');
    assert.ok(tgIdx < cascadeIdx, 'threshold_gate (0.90) should appear before cascade (0.85)');
  });
});

// ─── selectTemplates — proposal shape ────────────────────────────────────────

describe('selectTemplates — proposal shape', () => {
  it('each proposal has template, params, confidence, rationale', () => {
    const proposals = selectTemplates(CORONA_PROFILE);
    for (const p of proposals) {
      assert.ok(typeof p.template === 'string', 'template must be string');
      assert.ok(p.params !== null && typeof p.params === 'object', 'params must be object');
      assert.ok(typeof p.confidence === 'number', 'confidence must be number');
      assert.ok(typeof p.rationale === 'string', 'rationale must be string');
    }
  });

  it('params are a fresh copy (not shared with RULES)', () => {
    const proposals = selectTemplates(TREMOR_PROFILE);
    const tg = proposals.find(p => p.template === 'threshold_gate');
    tg.params.threshold = 999;
    // Re-run — should not see mutation
    const proposals2 = selectTemplates(TREMOR_PROFILE);
    const tg2 = proposals2.find(p => p.template === 'threshold_gate');
    assert.strictEqual(tg2.params.threshold, 5.0, 'params must not be shared with RULES');
  });
});

// ─── RULES registry ───────────────────────────────────────────────────────────

describe('RULES registry', () => {
  it('all rules have required fields', () => {
    for (const rule of RULES) {
      assert.ok(typeof rule.id === 'string' && rule.id.length > 0, `rule.id required: ${JSON.stringify(rule)}`);
      assert.ok(Array.isArray(rule.conditions) && rule.conditions.length > 0, `conditions required: ${rule.id}`);
      assert.ok(typeof rule.template === 'string', `template required: ${rule.id}`);
      assert.ok(rule.params !== null && typeof rule.params === 'object', `params required: ${rule.id}`);
      assert.ok(typeof rule.confidence === 'number' && rule.confidence > 0 && rule.confidence <= 1, `confidence 0-1: ${rule.id}`);
      assert.ok(Array.isArray(rule.traced_to) && rule.traced_to.length > 0, `traced_to required: ${rule.id}`);
    }
  });

  it('all rule IDs are unique', () => {
    const ids = RULES.map(r => r.id);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length, 'rule IDs must be unique');
  });

  it('all condition operators are valid', () => {
    const validOps = new Set(['equals', 'in', 'gt', 'lt', 'gte', 'lte']);
    for (const rule of RULES) {
      for (const cond of rule.conditions) {
        assert.ok(validOps.has(cond.operator), `unknown operator '${cond.operator}' in rule '${rule.id}'`);
      }
    }
  });

  it('covers all three constructs in traced_to', () => {
    const tracedTo = RULES.flatMap(r => r.traced_to).join(' ');
    assert.ok(tracedTo.includes('TREMOR'), 'RULES must include TREMOR-traced rules');
    assert.ok(tracedTo.includes('CORONA'), 'RULES must include CORONA-traced rules');
    assert.ok(tracedTo.includes('BREATH'), 'RULES must include BREATH-traced rules');
  });
});
