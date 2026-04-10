/**
 * test/convergence/breath.spec.js
 * BREATH convergence test — validates FORGE output against BREATH backing spec.
 * Uses two fixture files: purpleair-sf-bay.json and airnow-sf-bay.json.
 * Both are ingested and combined into a single event stream.
 *
 * Runs in two modes: raw and anonymized.
 *
 * Usage:
 *   node --test test/convergence/breath.spec.js
 *   FORGE_ITERATION=42 node --test test/convergence/breath.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { anonymize } from './anonymizer.js';
import { score } from './scorer.js';
import * as breathSpec from './specs/breath-spec.js';

const PURPLEAIR_PATH = 'fixtures/purpleair-sf-bay.json';
const AIRNOW_PATH    = 'fixtures/airnow-sf-bay.json';
const ITERATION      = parseInt(process.env.FORGE_ITERATION ?? '0', 10);
const FEED_NAME      = 'breath';

/**
 * Load and combine PurpleAir + AirNow fixtures.
 * @returns {Object} { purpleair, airnow }
 */
function loadBreathFixtures() {
  const purpleair = JSON.parse(readFileSync(PURPLEAIR_PATH, 'utf8'));
  const airnow    = JSON.parse(readFileSync(AIRNOW_PATH, 'utf8'));
  return { purpleair, airnow };
}

function runIteration(rawData, mode) {
  const events = ingest(rawData);
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const scoreResult = score(proposals, profile, breathSpec);

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

describe(`BREATH convergence — iteration ${ITERATION}`, () => {
  it('raw fixture: ingests PurpleAir + AirNow and scores without crashing', () => {
    const rawData = loadBreathFixtures();
    const { result, scoreResult } = runIteration(rawData, 'raw');

    assert.ok(result.event_count > 0, 'must produce events from PurpleAir + AirNow fixture');
    assert.ok(typeof scoreResult.total === 'number', 'total score must be a number');
    assert.strictEqual(scoreResult.total, 5.5,
      `BREATH ${result.mode} score must be 5.5/5.5, got ${scoreResult.total}`);

    process.stdout.write(JSON.stringify(result) + '\n');
  });

  it('anonymized fixture: ingests and scores without crashing', () => {
    const rawData = loadBreathFixtures();
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
    assert.strictEqual(scoreResult.total, 5.5,
      `BREATH ${result.mode} score must be 5.5/5.5, got ${scoreResult.total}`);

    process.stdout.write(JSON.stringify({ ...result, mode: 'anonymized' }) + '\n');
  });
});
