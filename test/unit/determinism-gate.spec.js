/**
 * test/unit/determinism-gate.spec.js
 * Determinism gate — proves the full ingestion→classification→selection→emission
 * pipeline produces identical output across N=5 repeated runs when given
 * fixed timestampBase and now values.
 *
 * Covers 4 fixture domains:
 *   TREMOR  — GeoJSON FeatureCollection (usgs-m4.5-day.json)
 *   CORONA  — Combined object with multiple streams (swpc + donki)
 *   BREATH  — Combined PurpleAir + AirNow fixture
 *   timestamp-less — Synthetic array-of-objects with no parseable timestamps
 *                    (exercises the timestampBase fallback path)
 *
 * FR-2 (Determinism CI Gate): If any run diverges, the test fails.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ingest, ingestFile } from '../../src/ingester/generic.js';
import { classify }           from '../../src/classifier/feed-grammar.js';
import { selectTemplates }    from '../../src/selector/template-selector.js';
import { emitEnvelope }       from '../../src/ir/emit.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const N = 5;
const FIXED_TIMESTAMP_BASE = 1700000000000;
const FIXED_NOW            = 1700000001000;

const TREMOR_FIXTURE = 'fixtures/usgs-m4.5-day.json';
const SWPC_FIXTURE   = 'fixtures/swpc-goes-xray.json';
const DONKI_FIXTURE  = 'fixtures/donki-flr-cme.json';
const PURPLEAIR_FIXTURE = 'fixtures/purpleair-sf-bay.json';
const AIRNOW_FIXTURE    = 'fixtures/airnow-sf-bay.json';

// ─── Fixture loaders ────────────────────────────────────────────────────────

function loadTremor() {
  return JSON.parse(readFileSync(TREMOR_FIXTURE, 'utf8'));
}

function loadCorona() {
  const swpc  = JSON.parse(readFileSync(SWPC_FIXTURE, 'utf8'));
  const donki = JSON.parse(readFileSync(DONKI_FIXTURE, 'utf8'));
  return {
    xray_flux: swpc.xray_flux,
    kp_index:  swpc.kp_index,
    flares:    donki.flares,
    cmes:      donki.cmes,
  };
}

function loadBreath() {
  const purpleair = JSON.parse(readFileSync(PURPLEAIR_FIXTURE, 'utf8'));
  const airnow    = JSON.parse(readFileSync(AIRNOW_FIXTURE, 'utf8'));
  return { purpleair, airnow };
}

/**
 * Synthetic fixture with no parseable timestamps.
 * Forces the ingester to use the timestampBase fallback on every event.
 */
function createTimestampless() {
  return [
    { sensor_reading: 42.5, quality: 0.9, label: 'alpha' },
    { sensor_reading: 38.1, quality: 0.7, label: 'beta' },
    { sensor_reading: 55.0, quality: 0.8, label: 'gamma' },
    { sensor_reading: 41.2, quality: 0.6, label: 'delta' },
    { sensor_reading: 47.9, quality: 0.95, label: 'epsilon' },
  ];
}

// ─── Pipeline runner ────────────────────────────────────────────────────────

/**
 * Run the full pipeline with deterministic parameters.
 * @param {any} rawData - Parsed fixture data
 * @param {string} feedId - Feed identifier
 * @returns {Object} ProposalEnvelope
 */
function runPipeline(rawData, feedId) {
  const events    = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
  const profile   = classify(events);
  const proposals = selectTemplates(profile);
  return emitEnvelope({
    feed_id: feedId,
    feed_profile: profile,
    proposals,
    now: FIXED_NOW,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Determinism Gate (FR-2)', () => {

  it('TREMOR: 5 runs produce identical envelopes', () => {
    const data = loadTremor();
    const envelopes = [];
    for (let i = 0; i < N; i++) {
      envelopes.push(runPipeline(data, 'determinism-gate-tremor'));
    }
    const reference = JSON.stringify(envelopes[0]);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(envelopes[i])),
        JSON.parse(reference),
        `TREMOR run ${i + 1} diverged from run 1`,
      );
    }
  });

  it('CORONA: 5 runs produce identical envelopes', () => {
    const data = loadCorona();
    const envelopes = [];
    for (let i = 0; i < N; i++) {
      envelopes.push(runPipeline(data, 'determinism-gate-corona'));
    }
    const reference = JSON.stringify(envelopes[0]);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(envelopes[i])),
        JSON.parse(reference),
        `CORONA run ${i + 1} diverged from run 1`,
      );
    }
  });

  it('BREATH: 5 runs produce identical envelopes', () => {
    const data = loadBreath();
    const envelopes = [];
    for (let i = 0; i < N; i++) {
      envelopes.push(runPipeline(data, 'determinism-gate-breath'));
    }
    const reference = JSON.stringify(envelopes[0]);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(envelopes[i])),
        JSON.parse(reference),
        `BREATH run ${i + 1} diverged from run 1`,
      );
    }
  });

  it('timestamp-less: 5 runs produce identical envelopes (exercises fallback path)', () => {
    const data = createTimestampless();
    const envelopes = [];
    for (let i = 0; i < N; i++) {
      envelopes.push(runPipeline(data, 'determinism-gate-timestampless'));
    }

    // Verify fallback path was actually exercised: all timestamps should be
    // based on FIXED_TIMESTAMP_BASE, not wall-clock
    const timestamps = envelopes[0].feed_profile.cadence.median_ms;
    // Events should all have timestamps near FIXED_TIMESTAMP_BASE
    const events = ingest(data, { timestampBase: FIXED_TIMESTAMP_BASE });
    for (const ev of events) {
      assert.ok(
        ev.timestamp >= FIXED_TIMESTAMP_BASE && ev.timestamp < FIXED_TIMESTAMP_BASE + 1000,
        `Event timestamp ${ev.timestamp} not based on timestampBase ${FIXED_TIMESTAMP_BASE}`,
      );
    }

    const reference = JSON.stringify(envelopes[0]);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(envelopes[i])),
        JSON.parse(reference),
        `timestamp-less run ${i + 1} diverged from run 1`,
      );
    }
  });

  it('ingestFile with timestampBase produces deterministic output', () => {
    const results = [];
    for (let i = 0; i < N; i++) {
      results.push(ingestFile(TREMOR_FIXTURE, { timestampBase: FIXED_TIMESTAMP_BASE }));
    }
    const reference = JSON.stringify(results[0]);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(results[i])),
        JSON.parse(reference),
        `ingestFile run ${i + 1} diverged from run 1`,
      );
    }
  });

  it('ingest without timestampBase preserves wall-clock behavior', () => {
    // When no timestampBase is provided, timestamps for events without parseable
    // timestamps should use Date.now() (existing behavior)
    const data = createTimestampless();
    const before = Date.now();
    const events = ingest(data);
    const after = Date.now();

    for (const ev of events) {
      assert.ok(
        ev.timestamp >= before && ev.timestamp <= after + data.length,
        'Without timestampBase, timestamps should be based on Date.now()',
      );
    }
  });
});
