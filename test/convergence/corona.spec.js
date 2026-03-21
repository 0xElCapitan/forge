/**
 * test/convergence/corona.spec.js
 * CORONA convergence test — validates FORGE output against CORONA backing spec.
 * Uses two fixture files: swpc-goes-xray.json and donki-flr-cme.json.
 * Both are ingested and combined into a single event stream.
 *
 * Runs in two modes: raw and anonymized.
 *
 * Usage:
 *   node --test test/convergence/corona.spec.js
 *   FORGE_ITERATION=42 node --test test/convergence/corona.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { anonymize } from './anonymizer.js';
import { score } from './scorer.js';
import * as coronaSpec from './specs/corona-spec.js';

const SWPC_PATH  = 'fixtures/swpc-goes-xray.json';
const DONKI_PATH = 'fixtures/donki-flr-cme.json';
const ITERATION  = parseInt(process.env.FORGE_ITERATION ?? '0', 10);
const FEED_NAME  = 'corona';

/**
 * Load and combine SWPC + DONKI fixture data into a merged structure.
 * @returns {Object} Combined fixture: { xray_flux, kp_index, flares, cmes }
 */
function loadCoronaFixtures() {
  const swpc  = JSON.parse(readFileSync(SWPC_PATH, 'utf8'));
  const donki = JSON.parse(readFileSync(DONKI_PATH, 'utf8'));
  return {
    xray_flux: swpc.xray_flux,
    kp_index:  swpc.kp_index,
    flares:    donki.flares,
    cmes:      donki.cmes,
  };
}

function runIteration(rawData, mode) {
  const events = ingest(rawData);
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const scoreResult = score(proposals, profile, coronaSpec);

  const result = {
    iteration: ITERATION,
    feed: FEED_NAME,
    mode,
    event_count: events.length,
    grammar_score: scoreResult.details.grammar_breakdown,
    template_score: scoreResult.details.template_breakdown,
    false_positives: scoreResult.details.false_positives,
    total: scoreResult.total,
    delta: null,
    decision: null,
    rule_matches: [],
    rejected_rules: [],
  };

  return { result, scoreResult };
}

describe(`CORONA convergence — iteration ${ITERATION}`, () => {
  it('raw fixture: ingests SWPC + DONKI and scores without crashing', () => {
    const rawData = loadCoronaFixtures();
    const { result, scoreResult } = runIteration(rawData, 'raw');

    assert.ok(result.event_count > 0, 'must produce events from SWPC + DONKI fixture');
    assert.ok(typeof scoreResult.total === 'number', 'total score must be a number');
    assert.ok(scoreResult.total >= 0, 'score must be non-negative');

    process.stdout.write(JSON.stringify(result) + '\n');
  });

  it('anonymized fixture: ingests and scores without crashing', () => {
    const rawData = loadCoronaFixtures();
    const anonData = anonymize(rawData, FEED_NAME);

    // Verify top-level keys were renamed
    const rawKeys = Object.keys(rawData);
    const anonKeys = Object.keys(anonData);
    const unchanged = rawKeys.filter(k => anonKeys.includes(k));
    assert.ok(
      unchanged.length === 0,
      `anonymizer must rename all field names; unchanged: ${unchanged.join(', ')}`
    );

    const { result, scoreResult } = runIteration(anonData, 'anonymized');

    assert.ok(result.event_count > 0, 'anonymized fixture must still produce events');
    assert.ok(typeof scoreResult.total === 'number', 'total score must be a number');
    assert.ok(scoreResult.total >= 0, 'score must be non-negative');

    process.stdout.write(JSON.stringify({ ...result, mode: 'anonymized' }) + '\n');
  });
});
