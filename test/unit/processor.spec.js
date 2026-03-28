/**
 * test/unit/processor.spec.js
 * Unit tests for the generalized processor pipeline.
 *
 * Covers: quality.js, uncertainty.js, settlement.js, bundles.js
 *
 * node --test test/unit/processor.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuality }      from '../../src/processor/quality.js';
import { computeDoubtPrice }   from '../../src/processor/uncertainty.js';
import { assignEvidenceClass, canSettleByClass } from '../../src/processor/settlement.js';
import { buildBundle }         from '../../src/processor/bundles.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = 1_000_000_000_000;  // fixed clock

/** A fresh event (timestamp === now) */
const freshEvent = { value: 42, timestamp: NOW };

/** A stale event (3 hours old with 1-hour stale_after_ms) */
const staleEvent = { value: 42, timestamp: NOW - 3 * 3_600_000 };

// ─── quality.js ──────────────────────────────────────────────────────────────

describe('computeQuality', () => {
  it('T0 fresh event returns near-maximum quality', () => {
    const q = computeQuality(freshEvent, { tier: 'T0', now: NOW });
    // T0 base=1.0, freshness=1.0, blend → 1.0
    assert.equal(q, 1.0);
  });

  it('T1 fresh event returns 0.9 quality', () => {
    const q = computeQuality(freshEvent, { tier: 'T1', now: NOW });
    // T1 base=0.9, freshness=1.0, blend(0.2) → 0.8*0.9 + 0.2*1.0 = 0.72 + 0.2 = 0.92
    assert.ok(q > 0.9 && q <= 1.0, `expected 0.9–1.0, got ${q}`);
  });

  it('T2 fresh event returns 0.7 quality', () => {
    const q = computeQuality(freshEvent, { tier: 'T2', now: NOW });
    // T2 base=0.7, freshness=1.0 → 0.8*0.7 + 0.2*1.0 = 0.56 + 0.2 = 0.76
    assert.ok(q >= 0.7 && q <= 0.8, `expected 0.7–0.8, got ${q}`);
  });

  it('T3 fresh event returns ~0.6 quality', () => {
    const q = computeQuality(freshEvent, { tier: 'T3', now: NOW });
    // T3 base=0.5, freshness=1.0 → 0.8*0.5 + 0.2*1.0 = 0.4 + 0.2 = 0.6
    assert.ok(Math.abs(q - 0.6) < 1e-10, `expected ~0.6, got ${q}`);
  });

  it('stale event has lower quality than fresh event (same tier)', () => {
    const fresh = computeQuality(freshEvent, { tier: 'T1', now: NOW });
    const stale = computeQuality(staleEvent, { tier: 'T1', now: NOW });
    assert.ok(stale < fresh, `stale ${stale} should be < fresh ${fresh}`);
  });

  it('completely stale event (3h old, 1h threshold) has reduced quality', () => {
    const q = computeQuality(staleEvent, { tier: 'T1', now: NOW, stale_after_ms: 3_600_000 });
    // freshness = max(0, 1 - 3) = 0; T1 base=0.9 → 0.8*0.9 + 0.2*0 = 0.72
    assert.ok(Math.abs(q - 0.72) < 1e-10, `expected ~0.72, got ${q}`);
  });

  it('future timestamp gets slight penalty (freshness 0.9)', () => {
    const futureEvent = { value: 1, timestamp: NOW + 60_000 };
    const q = computeQuality(futureEvent, { tier: 'T0', now: NOW });
    // freshness=0.9 (future), T0 base=1.0 → 0.8*1.0 + 0.2*0.9 = 0.8 + 0.18 = 0.98
    assert.ok(Math.abs(q - 0.98) < 1e-10, `expected ~0.98, got ${q}`);
  });

  it('unknown tier defaults to T3 baseline (0.5)', () => {
    const q = computeQuality(freshEvent, { tier: 'T9', now: NOW });
    // unknown base=0.5, freshness=1.0 → 0.6
    assert.ok(Math.abs(q - 0.6) < 1e-10, `expected ~0.6, got ${q}`);
  });

  it('quality is always in [0, 1]', () => {
    for (const tier of ['T0', 'T1', 'T2', 'T3', 'unknown']) {
      const q = computeQuality(staleEvent, { tier, now: NOW });
      assert.ok(q >= 0 && q <= 1, `tier ${tier} quality ${q} out of range`);
    }
  });
});

// ─── uncertainty.js ───────────────────────────────────────────────────────────

describe('computeDoubtPrice', () => {
  it('quality 1.0 → doubt 0.0', () => {
    assert.equal(computeDoubtPrice(1.0), 0.0);
  });

  it('quality 0.0 → doubt 1.0', () => {
    assert.equal(computeDoubtPrice(0.0), 1.0);
  });

  it('quality 0.5 → doubt 0.5', () => {
    assert.equal(computeDoubtPrice(0.5), 0.5);
  });

  it('quality 0.9 → doubt 0.1', () => {
    assert.ok(Math.abs(computeDoubtPrice(0.9) - 0.1) < 1e-10, 'expected 0.1');
  });

  it('quality 0.6 (T3 fresh) → doubt 0.4', () => {
    assert.ok(Math.abs(computeDoubtPrice(0.6) - 0.4) < 1e-10, 'expected 0.4');
  });

  it('out-of-range quality is clamped', () => {
    assert.equal(computeDoubtPrice(1.5), 0.0);   // clamped at 0
    assert.equal(computeDoubtPrice(-0.5), 1.0);  // clamped at 1
  });
});

// ─── settlement.js ───────────────────────────────────────────────────────────

describe('assignEvidenceClass', () => {
  it('T0 → ground_truth', () => {
    assert.equal(assignEvidenceClass('T0'), 'ground_truth');
  });

  it('T1 → ground_truth', () => {
    assert.equal(assignEvidenceClass('T1'), 'ground_truth');
  });

  it('T2 → corroboration', () => {
    assert.equal(assignEvidenceClass('T2'), 'corroboration');
  });

  it('T3 → provisional', () => {
    assert.equal(assignEvidenceClass('T3'), 'provisional');
  });

  it('unknown tier → provisional', () => {
    assert.equal(assignEvidenceClass('T9'), 'provisional');
    assert.equal(assignEvidenceClass(undefined), 'provisional');
  });
});

describe('canSettleByClass', () => {
  it('ground_truth → true', () => {
    assert.equal(canSettleByClass('ground_truth'), true);
  });

  it('corroboration → false', () => {
    assert.equal(canSettleByClass('corroboration'), false);
  });

  it('provisional → false', () => {
    assert.equal(canSettleByClass('provisional'), false);
  });
});

// ─── bundles.js ──────────────────────────────────────────────────────────────

describe('buildBundle', () => {
  it('returns correct EvidenceBundle shape for T0 source', () => {
    const bundle = buildBundle(freshEvent, {
      tier: 'T0', source_id: 'epa_aqs', theatre_refs: ['th-001'], now: NOW,
    });
    assert.equal(bundle.value, 42);
    assert.equal(bundle.timestamp, NOW);
    assert.equal(bundle.evidence_class, 'ground_truth');
    assert.equal(bundle.source_id, 'epa_aqs');
    assert.deepEqual(bundle.theatre_refs, ['th-001']);
    assert.equal(bundle.resolution, null);
    assert.ok(typeof bundle.quality === 'number');
    assert.ok(typeof bundle.doubt_price === 'number');
    assert.equal(bundle.quality, 1.0);
    assert.equal(bundle.doubt_price, 0.0);
  });

  it('T3 source produces provisional evidence_class', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T3', source_id: 'purpleair', now: NOW });
    assert.equal(bundle.evidence_class, 'provisional');
    assert.ok(Math.abs(bundle.quality - 0.6) < 1e-10, `expected quality ~0.6, got ${bundle.quality}`);
    assert.ok(Math.abs(bundle.doubt_price - 0.4) < 1e-10);
  });

  it('T1 source produces ground_truth evidence_class', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T1', source_id: 'airnow', now: NOW });
    assert.equal(bundle.evidence_class, 'ground_truth');
  });

  it('T2 source produces corroboration evidence_class', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T2', source_id: 'openaq', now: NOW });
    assert.equal(bundle.evidence_class, 'corroboration');
  });

  it('missing timestamp defaults to now', () => {
    const bundle = buildBundle({ value: 7 }, { tier: 'T2', now: NOW });
    assert.equal(bundle.timestamp, NOW);
  });

  it('theatre_refs defaults to empty array', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T1', now: NOW });
    assert.deepEqual(bundle.theatre_refs, []);
  });

  it('source_id defaults to null', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T1', now: NOW });
    assert.equal(bundle.source_id, null);
  });

  it('passes through channel_a and channel_b', () => {
    const raw = { value: 50, timestamp: NOW, channel_a: 48, channel_b: 52 };
    const bundle = buildBundle(raw, { tier: 'T3', now: NOW });
    assert.equal(bundle.channel_a, 48);
    assert.equal(bundle.channel_b, 52);
  });

  it('passes through lat, lon, frozen_count', () => {
    const raw = { value: 10, timestamp: NOW, lat: 37.7, lon: -122.4, frozen_count: 3 };
    const bundle = buildBundle(raw, { tier: 'T3', now: NOW });
    assert.equal(bundle.lat, 37.7);
    assert.equal(bundle.lon, -122.4);
    assert.equal(bundle.frozen_count, 3);
  });

  it('does not include channel_a when rawEvent omits it', () => {
    const bundle = buildBundle(freshEvent, { tier: 'T3', now: NOW });
    assert.equal(Object.hasOwn(bundle, 'channel_a'), false);
  });

  it('quality degrades for stale event', () => {
    const fresh = buildBundle(freshEvent, { tier: 'T1', now: NOW });
    const stale = buildBundle(staleEvent, { tier: 'T1', now: NOW });
    assert.ok(stale.quality < fresh.quality);
    assert.ok(stale.doubt_price > fresh.doubt_price);
  });
});

// ─── Sprint 3: Input validation (CR-02/SA-01) ──────────────────────────────

describe('buildBundle — input validation (Sprint 3)', () => {
  it('throws TypeError for missing rawEvent', () => {
    assert.throws(() => buildBundle(null), TypeError);
    assert.throws(() => buildBundle(undefined), TypeError);
  });

  it('throws TypeError for missing rawEvent.value', () => {
    assert.throws(() => buildBundle({}), TypeError);
    assert.throws(() => buildBundle({ timestamp: NOW }), TypeError);
  });

  it('throws TypeError for non-number rawEvent.value', () => {
    assert.throws(() => buildBundle({ value: 'hello' }), TypeError);
    assert.throws(() => buildBundle({ value: null }), TypeError);
  });

  it('accepts valid numeric values including edge cases', () => {
    assert.doesNotThrow(() => buildBundle({ value: 0 }, { now: NOW }));
    assert.doesNotThrow(() => buildBundle({ value: -1 }, { now: NOW }));
    assert.doesNotThrow(() => buildBundle({ value: NaN }, { now: NOW }));
    assert.doesNotThrow(() => buildBundle({ value: Infinity }, { now: NOW }));
  });
});

// ─── Sprint 3: NaN guard (SA-02/ME-05/ME-06) ───────────────────────────────

describe('computeQuality — NaN guard (Sprint 3)', () => {
  it('returns finite value when stale_after_ms is 0', () => {
    const q = computeQuality(freshEvent, { tier: 'T3', now: NOW, stale_after_ms: 0 });
    assert.ok(Number.isFinite(q), `quality should be finite, got ${q}`);
  });

  it('returns finite value when stale_after_ms is negative', () => {
    const q = computeQuality(freshEvent, { tier: 'T3', now: NOW, stale_after_ms: -1 });
    assert.ok(Number.isFinite(q), `quality should be finite, got ${q}`);
  });

  it('doubt_price is finite when quality is finite', () => {
    const q = computeQuality(freshEvent, { tier: 'T3', now: NOW, stale_after_ms: 0 });
    const dp = computeDoubtPrice(q);
    assert.ok(Number.isFinite(dp), `doubt_price should be finite, got ${dp}`);
  });
});
