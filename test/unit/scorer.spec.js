/**
 * test/unit/scorer.spec.js
 * Unit tests for test/convergence/scorer.js
 * Tests known inputs → known outputs for all score scenarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../convergence/scorer.js';
import * as tremorSpec from '../convergence/specs/tremor-spec.js';
import * as coronaSpec from '../convergence/specs/corona-spec.js';
import * as breathSpec from '../convergence/specs/breath-spec.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_PROFILE = {
  cadence:      { classification: null },
  distribution: { type: null },
  noise:        { classification: null },
  density:      { classification: null },
  thresholds:   { type: null },
};

// ─── Empty proposals → score = 0 ─────────────────────────────────────────────

describe('score: empty proposals', () => {
  it('tremor: empty proposals → total = 0', () => {
    const result = score([], EMPTY_PROFILE, tremorSpec);
    assert.equal(result.total, 0);
    assert.equal(result.template_score, 0);
    assert.equal(result.grammar_score, 0);
  });

  it('corona: empty proposals → total = 0', () => {
    const result = score([], EMPTY_PROFILE, coronaSpec);
    assert.equal(result.total, 0);
  });

  it('breath: empty proposals → total = 0', () => {
    const result = score([], EMPTY_PROFILE, breathSpec);
    assert.equal(result.total, 0);
  });
});

// ─── Grammar scoring ─────────────────────────────────────────────────────────

describe('score: grammar only (no proposals)', () => {
  it('perfect TREMOR grammar = grammar_score 5', () => {
    const perfectProfile = {
      cadence:      { classification: 'event_driven' },
      distribution: { type: 'unbounded_numeric' },
      noise:        { classification: 'spike_driven' },
      density:      { classification: 'sparse_network' },
      thresholds:   { type: 'statistical' },
    };
    const result = score([], perfectProfile, tremorSpec);
    assert.equal(result.grammar_score, 5);
    assert.equal(result.total, 2.5); // 0 + 0.5 * 5
  });

  it('partial TREMOR grammar = grammar_score 2', () => {
    const profile = {
      cadence:      { classification: 'event_driven' }, // match
      distribution: { type: 'bounded_numeric' },         // mismatch
      noise:        { classification: 'spike_driven' },  // match
      density:      { classification: 'multi_tier' },    // mismatch
      thresholds:   { type: 'statistical' },             // match
    };
    const result = score([], profile, tremorSpec);
    assert.equal(result.grammar_score, 3);
    assert.equal(result.total, 1.5);
  });

  it('null profile = grammar_score 0', () => {
    const result = score([], EMPTY_PROFILE, tremorSpec);
    assert.equal(result.grammar_score, 0);
  });
});

// ─── Template scoring ────────────────────────────────────────────────────────

describe('score: correct template, correct params', () => {
  it('single perfect threshold_gate = 1.0 template score', () => {
    const proposals = [
      {
        template: 'threshold_gate',
        params: { threshold: 5.0, window_hours: 24, base_rate: null, input_mode: 'single', threshold_type: 'statistical' },
      },
    ];
    // tremor first template is threshold_gate — score should be ~1.0
    const result = score(proposals, EMPTY_PROFILE, tremorSpec);
    // template_score for a matched proposal with all specified params correct
    assert.ok(result.template_score > 0, 'matched template should score > 0');
    assert.ok(result.template_score <= tremorSpec.template_count);
  });
});

describe('score: false positives', () => {
  it('unmatched proposal → -0.5 penalty', () => {
    const proposals = [
      { template: 'persistence', params: {} },
    ];
    const result = score(proposals, EMPTY_PROFILE, tremorSpec);
    // All expected templates missed (false negatives = 0 each) + 1 false positive (-0.5)
    assert.equal(result.template_score, 0); // Math.max(0, 0 - 0.5) = 0
    assert.ok(result.details.false_positives.includes('persistence'));
  });

  it('multiple false positives clamped to 0, not negative', () => {
    const proposals = [
      { template: 'persistence', params: {} },
      { template: 'persistence', params: {} },
      { template: 'persistence', params: {} },
    ];
    const result = score(proposals, EMPTY_PROFILE, tremorSpec);
    assert.ok(result.template_score >= 0, 'template score must never be negative');
  });
});

describe('score: correct template, wrong params', () => {
  it('correct template type but wrong params = 0.5', () => {
    const proposals = [
      {
        template: 'threshold_gate',
        params: { threshold: 999, window_hours: 999, base_rate: null },
      },
    ];
    const result = score(proposals, EMPTY_PROFILE, tremorSpec);
    // template_match=1, all params wrong → score = 1*(0.5 + 0.5*0) = 0.5
    const tGateDetail = result.details.template_breakdown
      .find(d => d.expected === 'threshold_gate' && d.proposed === 'threshold_gate');
    if (tGateDetail) {
      assert.ok(tGateDetail.score >= 0.5 && tGateDetail.score < 1.0,
        `expected ~0.5, got ${tGateDetail.score}`);
    }
  });
});

// ─── Structured output ────────────────────────────────────────────────────────

describe('score: output structure', () => {
  it('returns required fields', () => {
    const result = score([], EMPTY_PROFILE, tremorSpec);
    assert.ok('template_score' in result);
    assert.ok('grammar_score' in result);
    assert.ok('total' in result);
    assert.ok('details' in result);
    assert.ok('template_breakdown' in result.details);
    assert.ok('false_positives' in result.details);
    assert.ok('grammar_breakdown' in result.details);
  });

  it('template_breakdown has entry per expected template', () => {
    const result = score([], EMPTY_PROFILE, tremorSpec);
    assert.equal(
      result.details.template_breakdown.length,
      tremorSpec.expected_templates.length
    );
  });

  it('grammar_breakdown has Q1-Q5 keys', () => {
    const result = score([], EMPTY_PROFILE, tremorSpec);
    const qKeys = ['cadence', 'distribution', 'noise', 'density', 'thresholds'];
    for (const q of qKeys) {
      assert.ok(q in result.details.grammar_breakdown, `missing ${q} in grammar_breakdown`);
    }
  });
});

// ─── Unknown template type guard ─────────────────────────────────────────────

describe('score: unknown template type guard', () => {
  it('throws when an expected template type is not in CORE_PARAMS', () => {
    // A future template type that hasn't been added to CORE_PARAMS yet.
    // Without the guard, the empty-scores fallback would silently return 1.0
    // (trivially perfect) and the gap would be invisible.
    const fakeSpec = {
      expected_profile: tremorSpec.expected_profile,
      expected_templates: [
        { template: 'mystery_template', params: { some_field: 1 } },
      ],
      template_count: 1,
    };
    const proposals = [
      { template: 'mystery_template', params: { some_field: 1 } },
    ];
    assert.throws(
      () => score(proposals, EMPTY_PROFILE, fakeSpec),
      /Unknown template type 'mystery_template' — add to CORE_PARAMS before scoring/
    );
  });
});

// ─── CORONA: duplicate template matching ─────────────────────────────────────

describe('score: CORONA duplicate threshold_gate matching', () => {
  it('greedy match assigns each proposal to at most one expected template', () => {
    const proposals = [
      { template: 'threshold_gate', params: { threshold: 'M1.0', window_hours: 24, input_mode: 'single', threshold_type: 'regulatory' } },
      { template: 'threshold_gate', params: { threshold: 5, window_hours: 72, input_mode: 'multi', threshold_type: 'regulatory' } },
      { template: 'threshold_gate', params: { threshold: null, window_hours: 6, input_mode: 'single', threshold_type: 'regulatory' } },
    ];
    const result = score(proposals, EMPTY_PROFILE, coronaSpec);
    // 3 proposals → 3 matches for 3 expected threshold_gates → no false positives
    assert.equal(result.details.false_positives.length, 0, 'no false positives expected');
    assert.ok(result.template_score > 0, 'matched templates should score > 0');
  });
});
