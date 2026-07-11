/**
 * test/unit/classifier-robustness.spec.js
 *
 * Cycle-003 deferred carry-forward Sprint 06 — `cycle-003-carryforward-s06-classifier-robustness`
 * (Sprint Plan §"Sprint 06" / SDD S7 Lane 7 / PRD FR-9 / AC-11; operator-decisions OD-5).
 *
 * DELIVERABLE. A ceiling-fenced classifier-robustness red-team suite that probes the
 * internal Pythia classifier (`classify()` in src/classifier/feed-grammar.js) across
 * five fixture classes, calling the classifier READ-ONLY. **Validation only** — this
 * suite adds no producer behavior, no scoring, no certification/acceptance/optimization/
 * calibration claim. It measures per-dimension (Q1-Q5) robustness by sweeping a
 * perturbation across a real, live classifier decision boundary and recording how many
 * times each dimension's classification flips — never a "score", just a flip count used
 * as an internal test assertion.
 *
 * ── The five fixture classes (SDD §"Lane 7 — Research-validation", verbatim mapping) ──
 *
 *   threshold-straddle      — inputs sitting exactly on a classification boundary;
 *                              small perturbations should not flip the grammar
 *                              dimension unstably (Q1 cadence, Q2 distribution,
 *                              Q3 noise, Q4 density, Q5 thresholds each have a
 *                              grounded, real boundary constant in the source —
 *                              see per-group comments below for the exact math).
 *   synthetic-adversarial    — crafted inputs designed to mislead the classifier
 *                              (malformed/poisoned readings probing the numeric
 *                              guards; a near-miss spike pattern probing whether a
 *                              boundary-gamed input produces a false positive).
 *   cross-domain-transplant  — a feed from one domain shaped like another (real
 *                              USGS seismic magnitude VALUES reshaped onto a
 *                              dense/regular air-quality-like TIMING structure) —
 *                              probes that Q1/Q4 classification is a pure function
 *                              of structure, not domain semantics.
 *   correlated-upstream      — feeds with hidden shared upstream dependence (two
 *                              "independent" stream_index groups where one is an
 *                              exact duplicate of the other) — probes deterministic,
 *                              stable behavior and documents the explicit non-goal:
 *                              structural grammar classification does not attempt
 *                              to detect correlation between streams.
 *   no-ground-truth          — inputs where no settlement authority exists (SDD
 *                              framing) — operationalized here as degenerate/minimal
 *                              inputs (0, 1, 2 events) where no independently
 *                              verifiable "correct" classification exists; probes
 *                              graceful degradation (never throws, always returns a
 *                              well-formed FeedProfile).
 *
 * ── Claim-prevention (mandatory, T6.3/AC-11/AC-15) ─────────────────────────────
 *
 *   This suite and its fixtures assert/contain NO certification language, NO
 *   Echelon-acceptance claim, NO optimization, NO calibration, and emit NO
 *   populated scoring value. The dedicated negative-assertion block below checks,
 *   as a LIVE behavioral property (not just fixture inspection), that every
 *   `classify()` output produced anywhere in this suite is free of `certified`,
 *   `admitted`, and `scoring` keys — i.e. the classifier itself, exercised across
 *   all 5 red-team classes, never emits a certification/admission/scoring-shaped
 *   result. This is a regression guard on the PRODUCT's actual behavior, mirroring
 *   the do-not-emit pattern established in test/unit/composed-trust-do-not-emit.spec.js
 *   (Sprint 05).
 *
 * ── Producer-import-graph boundary (mandatory, T6.4) ───────────────────────────
 *
 *   This suite lives entirely under test/unit/ + fixtures/robustness/ and imports
 *   only from src/classifier/ (read-only). It adds zero files under src/, so the
 *   existing test/unit/bundle-boundaries.spec.js walk (which enforces "no file
 *   outside src/bundle/ imports src/bundle/") is structurally unaffected. The
 *   self-check below additionally pins, as a permanent regression guard, that this
 *   file's own import specifiers never resolve into src/bundle/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { classify } from '../../src/classifier/feed-grammar.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '..', '..', 'fixtures', 'robustness');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * Recursively assert an object contains no NaN/Infinity anywhere, and JSON-round-trips
 * losslessly (i.e. classify() never produces a non-finite number in its output).
 */
function assertNoNonFiniteNumbers(obj, path = '$') {
  if (typeof obj === 'number') {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) assertNoNonFiniteNumbers(v, `${path}.${k}`);
  }
}

/** Recursively assert an object contains none of the forbidden claim-ceiling keys. */
function assertNoForbiddenKeys(obj, forbidden, path = '$') {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoForbiddenKeys(v, forbidden, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      assert.ok(!forbidden.has(k), `forbidden key "${k}" found at ${path}.${k}`);
      assertNoForbiddenKeys(v, forbidden, `${path}.${k}`);
    }
  }
}

const FORBIDDEN_KEYS = new Set(['certified', 'admitted', 'scoring']);

// ── T6.4 — producer-import-graph boundary self-check ───────────────────────────

describe('S06 T6.4 — suite stays outside the producer import graph', () => {
  it("this file's own source contains no import from src/bundle/", () => {
    const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    // Anchored to real ES-module import syntax at statement start (not prose that
    // merely contains the words "import"/"from", e.g. inside a test description).
    const importLines = ownSource
      .split('\n')
      .filter((l) => /^\s*import\s.*\bfrom\s+['"]/.test(l));
    for (const line of importLines) {
      assert.ok(!/src\/bundle/.test(line), `forbidden src/bundle import: ${line}`);
    }
    assert.ok(importLines.length > 0, 'sanity: file must have at least one import statement');
  });
});

// ── T6.1/T6.2 — threshold-straddle: per-dimension stability at real boundaries ──

describe('S06 threshold-straddle — Q1 cadence (event_driven boundary)', () => {
  // classifyCadence()'s event_driven test: jitter > 2.0 || (rangeRatio > 5.0 && jitter > 0.5).
  // For deltas [1000,1000,1000,1000,D] (median always 1000), rangeRatio = D/1000 is the
  // binding disjunct well before jitter alone reaches 2.0 (verified: at D=5000, rangeRatio
  // exactly 5.0 and jitter=1.6 -> neither disjunct fires; at D=5500, rangeRatio=5.5 and
  // jitter=1.8 -> the rangeRatio disjunct fires). Both fixtures straddle this live boundary
  // of the SAME event_driven decision.
  const straddle = loadFixture('threshold-straddle.json').cadence;

  it('below the boundary classifies as a regular (non-event_driven) cadence', () => {
    const profile = classify(straddle.below);
    assert.equal(profile.cadence.classification, 'seconds');
  });

  it('above the boundary classifies as event_driven', () => {
    const profile = classify(straddle.above);
    assert.equal(profile.cadence.classification, 'event_driven');
  });

  it('classification is deterministic under repeated calls (both sides)', () => {
    for (const side of [straddle.below, straddle.above]) {
      const first = JSON.stringify(classify(side).cadence);
      for (let i = 0; i < 4; i++) {
        assert.equal(JSON.stringify(classify(side).cadence), first, 'classify() must be pure/deterministic');
      }
    }
  });

  it('per-dimension stability sweep: exactly one flip crossing D=5000..5500, no oscillation', () => {
    const base = straddle.below; // 4 fixed deltas of 1000ms; final delta D swept below
    const events = base.slice(0, 5);
    const startTs = events[4].timestamp;
    const flips = [];
    let prevClass = null;
    for (let D = 5000; D <= 5500; D += 100) {
      const sweepEvents = [...events, { timestamp: startTs + D, value: 5.0, metadata: {} }];
      const cls = classify(sweepEvents).cadence.classification;
      if (prevClass !== null && cls !== prevClass) flips.push({ D, from: prevClass, to: cls });
      prevClass = cls;
    }
    assert.equal(flips.length, 1, `expected exactly one flip across the sweep, got ${flips.length}: ${JSON.stringify(flips)}`);
    assert.equal(flips[0].from, 'seconds');
    assert.equal(flips[0].to, 'event_driven');
  });
});

describe('S06 threshold-straddle — Q2 distribution + Q5 thresholds (shared max<=600 boundary)', () => {
  // classifyDistribution() and classifyThresholds() both key off max<=600 for
  // bounded_numeric/regulatory vs unbounded_numeric/statistical.
  const straddle = loadFixture('threshold-straddle.json').value_bound;

  it('below the boundary (max=599.9) classifies as bounded_numeric / regulatory', () => {
    const profile = classify(straddle.below);
    assert.equal(profile.distribution.type, 'bounded_numeric');
    assert.equal(profile.thresholds.type, 'regulatory');
  });

  it('above the boundary (max=600.1) classifies as unbounded_numeric / statistical', () => {
    const profile = classify(straddle.above);
    assert.equal(profile.distribution.type, 'unbounded_numeric');
    assert.equal(profile.thresholds.type, 'statistical');
  });

  it('per-dimension stability sweep: exactly one flip crossing max=599..601, both dims agree', () => {
    const baseEvents = straddle.below.slice(0, 4); // [10,50,120,300] fixed; 5th value swept
    let prevDist = null;
    let prevThresh = null;
    const distFlips = [];
    const threshFlips = [];
    for (let maxVal = 599; maxVal <= 601; maxVal += 0.25) {
      const sweepEvents = [...baseEvents, { timestamp: baseEvents[3].timestamp + 5000, value: maxVal, metadata: {} }];
      const profile = classify(sweepEvents);
      if (prevDist !== null && profile.distribution.type !== prevDist) {
        distFlips.push({ maxVal, from: prevDist, to: profile.distribution.type });
      }
      if (prevThresh !== null && profile.thresholds.type !== prevThresh) {
        threshFlips.push({ maxVal, from: prevThresh, to: profile.thresholds.type });
      }
      prevDist = profile.distribution.type;
      prevThresh = profile.thresholds.type;
    }
    assert.equal(distFlips.length, 1, `Q2 distribution: expected exactly 1 flip, got ${JSON.stringify(distFlips)}`);
    assert.equal(threshFlips.length, 1, `Q5 thresholds: expected exactly 1 flip, got ${JSON.stringify(threshFlips)}`);
  });
});

describe('S06 threshold-straddle — Q3 noise (cv=0.15 boundary, value-based path)', () => {
  const straddle = loadFixture('threshold-straddle.json').noise;

  it('below the boundary (cv<0.15) classifies as low_noise', () => {
    const profile = classify(straddle.below);
    assert.equal(profile.noise.classification, 'low_noise');
  });

  it('above the boundary (cv>=0.15) classifies as white_noise (falls through trend/cyclical checks)', () => {
    const profile = classify(straddle.above);
    assert.equal(profile.noise.classification, 'white_noise');
  });

  it('classification is deterministic under repeated calls (both sides)', () => {
    for (const side of [straddle.below, straddle.above]) {
      const first = JSON.stringify(classify(side).noise);
      for (let i = 0; i < 4; i++) {
        assert.equal(JSON.stringify(classify(side).noise), first);
      }
    }
  });
});

describe('S06 threshold-straddle — Q4 density (n=200 sparse/dense boundary)', () => {
  const straddle = loadFixture('threshold-straddle.json').density;

  it('below the boundary (n=199) classifies as sparse_network', () => {
    const profile = classify(straddle.below);
    assert.equal(profile.density.classification, 'sparse_network');
    assert.equal(profile.density.sensor_count, 199);
  });

  it('above the boundary (n=201) classifies as dense_network', () => {
    const profile = classify(straddle.above);
    assert.equal(profile.density.classification, 'dense_network');
    assert.equal(profile.density.sensor_count, 201);
  });

  it('per-dimension stability sweep: exactly one flip crossing n=195..205', () => {
    const flips = [];
    let prevClass = null;
    for (let n = 195; n <= 205; n++) {
      const events = straddle.below.slice(0, n < straddle.below.length ? n : straddle.below.length);
      // Build exactly n events by trimming/extending from the below fixture's shape.
      const sweepEvents = Array.from({ length: n }, (_, i) => straddle.below[0]
        ? { timestamp: straddle.below[0].timestamp + i * 60000, value: 1.0, metadata: { has_coords: true } }
        : null
      ).filter(Boolean);
      const cls = classify(sweepEvents).density.classification;
      if (prevClass !== null && cls !== prevClass) flips.push({ n, from: prevClass, to: cls });
      prevClass = cls;
    }
    assert.equal(flips.length, 1, `expected exactly one flip across n=195..205, got ${JSON.stringify(flips)}`);
    assert.equal(flips[0].from, 'sparse_network');
    assert.equal(flips[0].to, 'dense_network');
    assert.equal(flips[0].n, 200, 'flip must occur exactly at n=200 (the documented boundary)');
  });
});

// ── synthetic-adversarial ────────────────────────────────────────────────────

describe('S06 synthetic-adversarial — poisoned readings (numeric-guard robustness)', () => {
  // NaN/Infinity cannot survive JSON serialization (JSON has no such literal) and
  // round-trip to `null` — a discovery made while authoring this fixture, and
  // itself a more realistic "poisoned reading" than a literal NaN would have been:
  // FORGE only ever ingests real JSON, so a missing/null sensor value is the
  // actually-plausible malformation, not literal NaN. The fixture also carries a
  // finite-but-extreme outlier (1e308) to probe magnitude robustness separately.
  const fixture = loadFixture('synthetic-adversarial.json').poisoned_values;

  it('classify() does not throw on poisoned/malformed readings', () => {
    assert.doesNotThrow(() => classify(fixture));
  });

  it('null-valued readings are excluded by the Number.isFinite guards (not coerced to 0/NaN)', () => {
    const profile = classify(fixture);
    // Legitimate finite values present: 10, 20, 30, 1e308, 40 (three nulls excluded).
    assert.equal(profile.distribution.bounds.min, 10);
    assert.equal(profile.distribution.bounds.max, 1e308);
  });

  it('output contains no NaN or Infinity anywhere (guards hold end-to-end)', () => {
    const profile = classify(fixture);
    assertNoNonFiniteNumbers(profile);
  });

  it('the extreme finite outlier (1e308) does not crash noise/threshold classification', () => {
    const profile = classify(fixture);
    assert.equal(profile.thresholds.type, 'statistical'); // max far exceeds the 600 regulatory ceiling
    assert.ok(typeof profile.noise.classification === 'string' && profile.noise.classification.length > 0);
  });
});

describe('S06 synthetic-adversarial — boundary-gamed spike (near-miss false-positive probe)', () => {
  // Engineered so tailRatio sits just under the isSpikeDriven() 1.4 cutoff while
  // otherwise looking anomalous (one value ~33% above its neighbors). Probes
  // whether a deliberately near-miss adversarial shape produces a false-positive
  // spike_driven classification.
  const fixture = loadFixture('synthetic-adversarial.json').boundary_gamed_spike;

  it('does not false-trigger spike_driven for the near-miss adversarial pattern', () => {
    const profile = classify(fixture);
    assert.notEqual(profile.noise.classification, 'spike_driven');
  });

  it('classification is deterministic under repeated calls', () => {
    const first = JSON.stringify(classify(fixture).noise);
    for (let i = 0; i < 4; i++) {
      assert.equal(JSON.stringify(classify(fixture).noise), first);
    }
  });
});

// ── cross-domain-transplant ──────────────────────────────────────────────────

describe('S06 cross-domain-transplant — structural (domain-blind) classification', () => {
  // Real USGS seismic magnitude VALUES (from fixtures/usgs-m4.5-day.json), reshaped
  // onto a dense/regular 60s cadence (a BREATH/air-quality-like TIMING structure)
  // instead of their natural sparse/irregular seismic timing. Probes that Q1/Q4
  // classification is a pure function of structure, independent of what domain the
  // values originate from — the "grammar not semantics" design principle.
  const fixture = loadFixture('cross-domain-transplant.json').seismic_values_dense_regular_cadence;

  it('cadence classification reflects the TRANSPLANTED (dense/regular) timing, not the seismic origin of the values', () => {
    const profile = classify(fixture);
    assert.equal(profile.cadence.classification, 'minutes');
    assert.equal(profile.cadence.median_ms, 60000);
  });

  it('density classification reflects the transplanted coordinate-tagged structure', () => {
    const profile = classify(fixture);
    assert.equal(profile.density.classification, 'sparse_network');
  });

  it('classify() does not throw and is deterministic on the transplanted feed', () => {
    assert.doesNotThrow(() => classify(fixture));
    const first = JSON.stringify(classify(fixture));
    for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(classify(fixture)), first);
  });
});

// ── correlated-upstream ──────────────────────────────────────────────────────

describe('S06 correlated-upstream — stable behavior under hidden shared-upstream duplication', () => {
  // "duplicate" = stream_index 1 is an exact value-for-value copy of stream_index 0.
  // "independent" = stream_index 1 has a genuinely different pattern, same cardinality.
  // Explicit non-goal (documented, not a defect): structural grammar classification
  // does NOT attempt to detect correlation between streams — it classifies purely on
  // stream COUNT and shape. This suite asserts that behavior is STABLE and
  // deterministic under both inputs, not that correlation is detected.
  const fixture = loadFixture('correlated-upstream.json');

  it('classify() does not throw for either duplicate or independent multi-stream input', () => {
    assert.doesNotThrow(() => classify(fixture.duplicate));
    assert.doesNotThrow(() => classify(fixture.independent));
  });

  it('documented non-goal: duplicate and independent streams produce the same TOP-LEVEL classification set (correlation-blind by design)', () => {
    const dupProfile = classify(fixture.duplicate);
    const indepProfile = classify(fixture.independent);
    assert.equal(dupProfile.cadence.classification, indepProfile.cadence.classification);
    assert.equal(dupProfile.noise.classification, indepProfile.noise.classification);
    assert.equal(dupProfile.thresholds.type, indepProfile.thresholds.type);
  });

  it('both are deterministic under repeated calls', () => {
    for (const events of [fixture.duplicate, fixture.independent]) {
      const first = JSON.stringify(classify(events));
      for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(classify(events)), first);
    }
  });
});

// ── no-ground-truth ───────────────────────────────────────────────────────────

describe('S06 no-ground-truth — graceful degradation (settlement-authority-absent inputs)', () => {
  // SDD framing: "inputs where no settlement authority exists". Operationalized as
  // degenerate/minimal inputs (0, 1, 2 events) where there is no independently
  // verifiable "correct" classification. Probes graceful degradation only —
  // classify() must never throw and must always return a well-formed FeedProfile
  // with every Q1-Q5 dimension present and defined.
  const fixture = loadFixture('no-ground-truth.json');

  for (const key of ['empty', 'single_event', 'two_events']) {
    it(`"${key}" does not throw and returns a well-formed FeedProfile`, () => {
      let profile;
      assert.doesNotThrow(() => {
        profile = classify(fixture[key]);
      });
      assert.ok(profile.cadence && typeof profile.cadence.classification === 'string' && profile.cadence.classification.length > 0);
      assert.ok(profile.distribution && typeof profile.distribution.type === 'string' && profile.distribution.type.length > 0);
      assert.ok(profile.noise && typeof profile.noise.classification === 'string' && profile.noise.classification.length > 0);
      assert.ok(profile.density && typeof profile.density.classification === 'string' && profile.density.classification.length > 0);
      assert.ok(profile.thresholds && typeof profile.thresholds.type === 'string' && profile.thresholds.type.length > 0);
    });

    it(`"${key}" is deterministic under repeated calls`, () => {
      const first = JSON.stringify(classify(fixture[key]));
      for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(classify(fixture[key])), first);
    });
  }
});

// ── T6.3 — claim-prevention negative assertions (mandatory) ────────────────────

describe('S06 T6.3 — claim-prevention: classify() output never contains certified/admitted/scoring keys', () => {
  // Live behavioral guard (not just fixture inspection): every classify() output
  // produced anywhere in this suite, across all 5 red-team classes, must be free
  // of the forbidden claim-ceiling keys. Mirrors the do-not-emit pattern in
  // test/unit/composed-trust-do-not-emit.spec.js (Sprint 05).
  const straddle = loadFixture('threshold-straddle.json');
  const adversarial = loadFixture('synthetic-adversarial.json');
  const transplant = loadFixture('cross-domain-transplant.json');
  const correlated = loadFixture('correlated-upstream.json');
  const noGroundTruth = loadFixture('no-ground-truth.json');

  const allEventSets = [
    straddle.cadence.below, straddle.cadence.above,
    straddle.value_bound.below, straddle.value_bound.above,
    straddle.noise.below, straddle.noise.above,
    straddle.density.below, straddle.density.above,
    adversarial.poisoned_values, adversarial.boundary_gamed_spike,
    transplant.seismic_values_dense_regular_cadence,
    correlated.duplicate, correlated.independent,
    noGroundTruth.empty, noGroundTruth.single_event, noGroundTruth.two_events,
  ];

  it('no classify() output across all fixture classes contains a certified/admitted/scoring key', () => {
    for (const events of allEventSets) {
      const profile = classify(events);
      assertNoForbiddenKeys(profile, FORBIDDEN_KEYS);
    }
  });

  it('the fixture files themselves contain no certified/admitted/scoring keys', () => {
    for (const name of [
      'threshold-straddle.json',
      'synthetic-adversarial.json',
      'cross-domain-transplant.json',
      'correlated-upstream.json',
      'no-ground-truth.json',
    ]) {
      const data = loadFixture(name);
      assertNoForbiddenKeys(data, FORBIDDEN_KEYS);
    }
  });
});
