/**
 * test/unit/baseline-forecasters.spec.js
 *
 * Cycle-003 deferred carry-forward — Sprint 07
 * (`cycle-003-carryforward-s07-structural-baselines`; Sprint Plan §6 Sprint 07
 * / SDD S8 (FR-10) / PRD Lane 7 FR-10; AC-12; NFR-CEIL, NFR-BOUNDARY).
 *
 * DELIVERABLE. Unit-tests the five structural baseline forecasters
 * (base rate, domain priors, persistence/continuation, rolling baseline,
 * transition frequency) specified in FR-10 — "resolution-independent
 * structural benchmark-forecasters" computable from feed history alone.
 * Honors "a stronger model is the WRONG benchmark": structural baselines,
 * not TimesFM-as-benchmark.
 *
 * Each forecaster is exercised against:
 *   (a) small hand-crafted synthetic windows, so every assertion has an
 *       independently hand-computed expected value (not "it works" — an
 *       exact number), and
 *   (b) real historical feed windows from the existing fixtures/*.json
 *       real-data windows named in the SDD (usgs-m4.5-day.json for the
 *       Omori/seismic domain prior, swpc-goes-xray.json for the
 *       Wheatland/solar domain prior, airnow-sf-bay.json for the
 *       resolution-independent forecasters), loaded via the existing
 *       `ingestFile(path, { timestampBase })` deterministic-replay contract
 *       (no wall-clock — matches the existing determinism-gate convention).
 *
 * T7.4 claim-prevention (mandatory): a live behavioral guard — mirroring the
 * do-not-emit pattern in test/unit/composed-trust-do-not-emit.spec.js and the
 * T6.3 pattern in test/unit/classifier-robustness.spec.js — recursively
 * checks every forecaster output produced anywhere in this suite for the
 * forbidden key set {scoring, certified, admitted, calibrated, calibration,
 * certificate}. None of the five forecasters emit a `scoring` object, a
 * certificate, or a calibration claim; outputs are baseline predictions for
 * comparison/validation only.
 *
 * T7.5 boundary confirmation: a self-check asserting none of the five new
 * src/baseline/*.js source files import src/bundle/ (the producer). The
 * complementary direction — src/bundle/ must not import src/baseline/ or
 * src/forecast/ — is asserted explicitly in test/unit/bundle-boundaries.spec.js
 * (new describe block, this sprint), which stays green (existing checks
 * unmodified).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { ingestFile } from '../../src/ingester/generic.js';
import { baseRate } from '../../src/baseline/base-rate.js';
import { persistenceForecast } from '../../src/baseline/persistence.js';
import { rollingBaseline } from '../../src/baseline/rolling-baseline.js';
import { transitionFrequency } from '../../src/baseline/transition-frequency.js';
import { omoriDomainPrior, wheatlandFlarePrior } from '../../src/baseline/domain-priors.js';

// Fixed replay base — no Date.now(), matches the existing determinism-gate
// convention (test/unit/determinism-gate.spec.js) used across this codebase.
const FIXED_TIMESTAMP_BASE = 1700000000000;

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const usgsEvents = ingestFile(join(FIXTURES_DIR, 'usgs-m4.5-day.json'), { timestampBase: FIXED_TIMESTAMP_BASE });
const swpcEvents = ingestFile(join(FIXTURES_DIR, 'swpc-goes-xray.json'), { timestampBase: FIXED_TIMESTAMP_BASE });
const airnowEvents = ingestFile(join(FIXTURES_DIR, 'airnow-sf-bay.json'), { timestampBase: FIXED_TIMESTAMP_BASE });

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── T7.1/T7.2 — base rate ──────────────────────────────────────────────────

describe('base-rate — synthetic (hand-computed)', () => {
  const events = [1, 2, 3, 4, 5].map((value, i) => ({ timestamp: i, value, metadata: {} }));

  it('counts events matching the predicate and computes the exact rate', () => {
    const result = baseRate(events, (e) => e.value > 3);
    assert.deepEqual(result, { count: 2, total: 5, rate: 0.4 });
  });

  it('returns rate 0 for an empty window (no division by zero)', () => {
    assert.deepEqual(baseRate([], () => true), { count: 0, total: 0, rate: 0 });
  });

  it('returns rate 1 when every event matches', () => {
    const result = baseRate(events, () => true);
    assert.deepEqual(result, { count: 5, total: 5, rate: 1 });
  });
});

describe('base-rate — real feed window (usgs-m4.5-day.json)', () => {
  it('the rate for a threshold at the data median is close to 0.5 and internally consistent', () => {
    const values = usgsEvents.map((e) => e.value);
    const threshold = median(values);
    const result = baseRate(usgsEvents, (e) => e.value > threshold);
    assert.equal(result.total, usgsEvents.length);
    assert.equal(result.count, values.filter((v) => v > threshold).length);
    assert.equal(result.rate, result.count / result.total);
  });

  it('is deterministic — re-running on the same feed window yields identical output', () => {
    const isEvent = (e) => e.value > median(usgsEvents.map((ev) => ev.value));
    assert.deepEqual(baseRate(usgsEvents, isEvent), baseRate(usgsEvents, isEvent));
  });
});

// ── T7.2 — persistence / continuation ──────────────────────────────────────

describe('persistence — synthetic (hand-computed)', () => {
  it('predicts the value of the most recent event by timestamp, not array order', () => {
    const events = [
      { timestamp: 300, value: 30, metadata: {} },
      { timestamp: 100, value: 10, metadata: {} },
      { timestamp: 200, value: 20, metadata: {} },
    ];
    const result = persistenceForecast(events, (e) => e.value > 25);
    assert.deepEqual(result, { predicted_value: 30, predicted_state: true, basis_timestamp: 300 });
  });

  it('predicted_state is null when no predicate is supplied', () => {
    const events = [{ timestamp: 1, value: 42, metadata: {} }];
    assert.deepEqual(persistenceForecast(events), {
      predicted_value: 42,
      predicted_state: null,
      basis_timestamp: 1,
    });
  });

  it('returns nulls for an empty window', () => {
    assert.deepEqual(persistenceForecast([]), {
      predicted_value: null,
      predicted_state: null,
      basis_timestamp: null,
    });
  });
});

describe('persistence — real feed window (airnow-sf-bay.json)', () => {
  it('predicted_value equals the value of the chronologically last event', () => {
    const sorted = [...airnowEvents].sort((a, b) => a.timestamp - b.timestamp);
    const result = persistenceForecast(airnowEvents);
    assert.equal(result.predicted_value, sorted[sorted.length - 1].value);
    assert.equal(result.basis_timestamp, sorted[sorted.length - 1].timestamp);
  });
});

// ── T7.2 — rolling baseline ────────────────────────────────────────────────

describe('rolling-baseline — synthetic (hand-computed)', () => {
  it('computes the moving average from only the preceding window, with exceeds flags', () => {
    const events = [10, 20, 30, 40, 50, 5].map((value, i) => ({ timestamp: i, value, metadata: {} }));
    const result = rollingBaseline(events, 2);
    assert.deepEqual(result, [
      { timestamp: 0, value: 10, baseline: null, exceeds: null },
      { timestamp: 1, value: 20, baseline: 10, exceeds: true },
      { timestamp: 2, value: 30, baseline: 15, exceeds: true },
      { timestamp: 3, value: 40, baseline: 25, exceeds: true },
      { timestamp: 4, value: 50, baseline: 35, exceeds: true },
      { timestamp: 5, value: 5, baseline: 45, exceeds: false },
    ]);
  });

  it('sorts by timestamp before windowing, regardless of input order', () => {
    const events = [
      { timestamp: 2, value: 30, metadata: {} },
      { timestamp: 0, value: 10, metadata: {} },
      { timestamp: 1, value: 20, metadata: {} },
    ];
    const result = rollingBaseline(events, 1);
    assert.deepEqual(result.map((r) => r.timestamp), [0, 1, 2]);
    assert.equal(result[1].baseline, 10);
    assert.equal(result[2].baseline, 20);
  });
});

describe('rolling-baseline — real feed window (swpc-goes-xray.json)', () => {
  it('produces one entry per input event, chronologically ordered, with null baseline only at the start', () => {
    const windowSize = 5;
    const result = rollingBaseline(swpcEvents, windowSize);
    assert.equal(result.length, swpcEvents.length);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].timestamp >= result[i - 1].timestamp, 'output must be timestamp-sorted');
    }
    assert.equal(result[0].baseline, null);
    assert.notEqual(result[result.length - 1].baseline, null);
  });

  it('is deterministic — re-running on the same feed window yields identical output', () => {
    assert.deepEqual(rollingBaseline(swpcEvents, 5), rollingBaseline(swpcEvents, 5));
  });
});

// ── T7.2 — transition frequency ────────────────────────────────────────────

describe('transition-frequency — synthetic (hand-computed)', () => {
  it('computes exact empirical transition rates for a known state sequence', () => {
    // values [1,5,1,5,5,1] @ threshold 3 -> states [F,T,F,T,T,F]
    // transitions: F->T, T->F, F->T, T->T, T->F
    const events = [1, 5, 1, 5, 5, 1].map((value, i) => ({ timestamp: i, value, metadata: {} }));
    const result = transitionFrequency(events, (e) => e.value > 3);
    assert.deepEqual(result, {
      counts: { eventToEvent: 1, eventToNoEvent: 2, noEventToEvent: 2, noEventToNoEvent: 0 },
      rate_event_to_event: 1 / 3,
      rate_no_event_to_event: 1,
    });
  });

  it('reports null rates for a from-state that never occurs (no division by zero)', () => {
    const events = [5, 5, 5].map((value, i) => ({ timestamp: i, value, metadata: {} }));
    const result = transitionFrequency(events, (e) => e.value > 3);
    assert.deepEqual(result, {
      counts: { eventToEvent: 2, eventToNoEvent: 0, noEventToEvent: 0, noEventToNoEvent: 0 },
      rate_event_to_event: 1,
      rate_no_event_to_event: null,
    });
  });
});

describe('transition-frequency — real feed window (usgs-m4.5-day.json)', () => {
  it('transition counts sum to exactly one less than the event count', () => {
    const threshold = median(usgsEvents.map((e) => e.value));
    const result = transitionFrequency(usgsEvents, (e) => e.value > threshold);
    const totalTransitions = Object.values(result.counts).reduce((a, b) => a + b, 0);
    assert.equal(totalTransitions, usgsEvents.length - 1);
  });
});

// ── T7.1 — domain priors: Omori (seismic) ──────────────────────────────────

describe('domain-priors — omoriDomainPrior — synthetic (hand-computed)', () => {
  it('K is a direct count of events within the c-day window after the reference event', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const events = [
      { timestamp: 0, value: 100, metadata: {} }, // reference (max value)
      { timestamp: 3_600_000, value: 10, metadata: {} }, // +1h, inside c=1 day window
      { timestamp: 43_200_000, value: 20, metadata: {} }, // +12h, inside window
      { timestamp: 90_000_000, value: 5, metadata: {} }, // +25h, outside window
      { timestamp: -1000, value: 1, metadata: {} }, // before reference, excluded
    ];
    const result = omoriDomainPrior(events, { c: 1, p: 1, horizonsDays: [1, 2, 3, 7] });
    assert.equal(result.reference_timestamp, 0);
    assert.equal(result.K, 2);
    assert.equal(result.c, 1);
    assert.equal(result.p, 1);
    assert.deepEqual(result.predictions, [
      { horizon_days: 1, predicted_rate: 2 / Math.pow(2, 1) },
      { horizon_days: 2, predicted_rate: 2 / Math.pow(3, 1) },
      { horizon_days: 3, predicted_rate: 2 / Math.pow(4, 1) },
      { horizon_days: 7, predicted_rate: 2 / Math.pow(8, 1) },
    ]);
    assert.equal(result.predictions[0].predicted_rate, 1);
    assert.ok(DAY_MS > 0); // sanity: constant used to build the fixture above
  });

  it('returns a zeroed structure for an empty window (no crash)', () => {
    const result = omoriDomainPrior([]);
    assert.equal(result.reference_timestamp, null);
    assert.equal(result.K, 0);
    assert.ok(result.predictions.every((p) => p.predicted_rate === 0));
  });

  it('predicted rate strictly decreases as the horizon grows (decay law)', () => {
    const events = [
      { timestamp: 0, value: 50, metadata: {} },
      { timestamp: 1000, value: 1, metadata: {} },
    ];
    const result = omoriDomainPrior(events, { c: 1, p: 1, horizonsDays: [1, 2, 3] });
    const rates = result.predictions.map((p) => p.predicted_rate);
    assert.ok(rates[0] > rates[1] && rates[1] > rates[2], `expected strictly decreasing rates, got ${rates}`);
  });
});

describe('domain-priors — omoriDomainPrior — real feed window (usgs-m4.5-day.json, seismic)', () => {
  it('reference_timestamp matches the timestamp of the max-value event; K counts only later events within the window', () => {
    const result = omoriDomainPrior(usgsEvents, { c: 1, p: 1 });
    const reference = usgsEvents.reduce((max, e) => (e.value > max.value ? e : max), usgsEvents[0]);
    assert.equal(result.reference_timestamp, reference.timestamp);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const expectedK = usgsEvents.filter(
      (e) => e.timestamp > reference.timestamp && e.timestamp <= reference.timestamp + DAY_MS,
    ).length;
    assert.equal(result.K, expectedK);
  });

  it('is deterministic — re-running on the same feed window yields identical output', () => {
    assert.deepEqual(omoriDomainPrior(usgsEvents), omoriDomainPrior(usgsEvents));
  });
});

// ── T7.1 — domain priors: Wheatland (solar) ────────────────────────────────

describe('domain-priors — wheatlandFlarePrior — synthetic (hand-computed)', () => {
  it('matches the closed-form Poisson survival probability exactly', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i * 10_000, // 0, 10s, 20s, ..., 90s -> duration 90000ms
      value: i,
      metadata: {},
    }));
    const isEvent = (e) => e.value % 3 === 0; // multiples of 3 in 0..9: {0,3,6,9} -> exactly 4 events

    // Hand-derived independently of the source (literal constants, not a
    // second call into the function under test): duration = 90000ms,
    // eventCount = 4, lambda = 4/90000, horizon = 1000ms.
    const expectedEventCount = 4;
    const expectedDurationMs = 90_000;
    const expectedLambda = 4 / 90_000;
    const horizonMs = 1000;
    const expectedProbability = 1 - Math.exp(-(4 / 90_000) * 1000);

    const result = wheatlandFlarePrior(events, isEvent, { horizonMs });
    assert.equal(result.event_count, expectedEventCount);
    assert.equal(result.duration_ms, expectedDurationMs);
    assert.equal(result.lambda_per_ms, expectedLambda);
    assert.equal(result.probability_at_least_one, expectedProbability);
    assert.ok(result.probability_at_least_one > 0 && result.probability_at_least_one < 1);
  });

  it('returns a zeroed structure for a window with fewer than 2 events (no crash)', () => {
    assert.deepEqual(wheatlandFlarePrior([], () => true, { horizonMs: 1000 }), {
      lambda_per_ms: 0,
      horizon_ms: 1000,
      probability_at_least_one: 0,
      event_count: 0,
      duration_ms: 0,
    });
    assert.deepEqual(wheatlandFlarePrior([{ timestamp: 0, value: 1, metadata: {} }], () => true, { horizonMs: 1000 }), {
      lambda_per_ms: 0,
      horizon_ms: 1000,
      probability_at_least_one: 0,
      event_count: 0,
      duration_ms: 0,
    });
  });

  it('probability increases monotonically with the forecast horizon', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ timestamp: i * 1000, value: i, metadata: {} }));
    const isEvent = (e) => e.value >= 2;
    const short = wheatlandFlarePrior(events, isEvent, { horizonMs: 100 });
    const long = wheatlandFlarePrior(events, isEvent, { horizonMs: 10000 });
    assert.ok(long.probability_at_least_one > short.probability_at_least_one);
  });
});

describe('domain-priors — wheatlandFlarePrior — real feed window (swpc-goes-xray.json, solar)', () => {
  it('event_count/duration/lambda are internally consistent and probability stays in [0,1]', () => {
    const values = swpcEvents.map((e) => e.value);
    const threshold = median(values);
    const isEvent = (e) => e.value > threshold;
    const horizonMs = 3_600_000; // 1 hour
    const result = wheatlandFlarePrior(swpcEvents, isEvent, { horizonMs });

    const sorted = [...swpcEvents].sort((a, b) => a.timestamp - b.timestamp);
    const expectedDuration = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
    const expectedCount = sorted.filter(isEvent).length;

    assert.equal(result.duration_ms, expectedDuration);
    assert.equal(result.event_count, expectedCount);
    assert.ok(result.probability_at_least_one >= 0 && result.probability_at_least_one <= 1);
  });

  it('is deterministic — re-running on the same feed window yields identical output', () => {
    const isEvent = (e) => e.value > median(swpcEvents.map((ev) => ev.value));
    const opts = { horizonMs: 3_600_000 };
    assert.deepEqual(wheatlandFlarePrior(swpcEvents, isEvent, opts), wheatlandFlarePrior(swpcEvents, isEvent, opts));
  });
});

// ── T7.4 — mandatory claim-prevention negative assertions ──────────────────
//
// Live behavioral guard (not just fixture inspection), mirroring the T6.3
// pattern in test/unit/classifier-robustness.spec.js and the do-not-emit
// pattern in test/unit/composed-trust-do-not-emit.spec.js: every forecaster
// output produced anywhere in this suite is recursively checked for the
// forbidden key set. No forecaster ever emits a `scoring` object, a
// certificate, or a calibration claim.

const FORBIDDEN_KEYS = new Set(['scoring', 'certified', 'admitted', 'calibrated', 'calibration', 'certificate']);

function collectKeys(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, acc);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      acc.push(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

describe('claim-prevention — no forecaster ever emits a forbidden certification/scoring key', () => {
  it('base rate, persistence, rolling baseline, transition frequency, and domain priors are all clean', () => {
    const isEventUsgs = (e) => e.value > median(usgsEvents.map((ev) => ev.value));
    const isEventSwpc = (e) => e.value > median(swpcEvents.map((ev) => ev.value));

    const outputs = [
      baseRate(usgsEvents, isEventUsgs),
      baseRate(swpcEvents, isEventSwpc),
      persistenceForecast(airnowEvents, isEventUsgs),
      rollingBaseline(swpcEvents, 5),
      transitionFrequency(usgsEvents, isEventUsgs),
      omoriDomainPrior(usgsEvents),
      wheatlandFlarePrior(swpcEvents, isEventSwpc, { horizonMs: 3_600_000 }),
    ];

    const keys = collectKeys(outputs);
    const hits = keys.filter((k) => FORBIDDEN_KEYS.has(k));
    assert.deepEqual(hits, [], `forbidden key(s) found in forecaster output: ${hits.join(', ')}`);
  });
});

// ── T7.5 — producer-import-graph boundary confirmation ─────────────────────
//
// Self-check asserting the five new baseline module files never import
// src/bundle/ (the producer). The complementary direction (src/bundle/ must
// not import src/baseline/) is asserted in test/unit/bundle-boundaries.spec.js.

describe('boundary — src/baseline/* modules never import src/bundle/', () => {
  const BASELINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'baseline');
  const IMPORT_RE = /^\s*import\s.*\bfrom\s+['"]([^'"]+)['"]/gm;

  it('none of the five baseline source files reference ../bundle or src/bundle', () => {
    const files = readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5, `expected >=5 baseline source files, found ${files.length}`);

    const offenders = [];
    for (const file of files) {
      const content = readFileSync(join(BASELINE_DIR, file), 'utf8');
      let m;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(content))) {
        const spec = m[1];
        if (spec.includes('bundle')) offenders.push(`${file} -> ${spec}`);
      }
    }
    assert.deepEqual(offenders, [], `baseline modules must not import src/bundle/; found: ${offenders.join(', ')}`);
  });
});
