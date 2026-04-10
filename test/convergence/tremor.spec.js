/**
 * test/convergence/tremor.spec.js
 * TREMOR convergence test — validates FORGE output against TREMOR backing spec.
 *
 * Runs in two modes:
 *   raw        — raw USGS fixture data
 *   anonymized — field names shuffled; ingester must work on structure alone
 *
 * Usage:
 *   node --test test/convergence/tremor.spec.js
 *   FORGE_ITERATION=42 node --test test/convergence/tremor.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { anonymize } from './anonymizer.js';
import { score } from './scorer.js';
import * as tremorSpec from './specs/tremor-spec.js';

const FIXTURE_PATH = 'fixtures/usgs-m4.5-day.json';
const ITERATION = parseInt(process.env.FORGE_ITERATION ?? '0', 10);
const FEED_NAME = 'tremor';

/**
 * Run a single FORGE iteration: ingest → classify → select → score → log.
 * @param {any} rawData - Parsed JSON (raw or anonymized)
 * @param {string} mode - 'raw' | 'anonymized'
 * @returns {{ result: Object, scoreResult: Object }}
 */
function runIteration(rawData, mode) {
  const events = ingest(rawData);
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const scoreResult = score(proposals, profile, tremorSpec);

  const result = {
    iteration: ITERATION,
    feed: FEED_NAME,
    mode,
    event_count: events.length,
    grammar_score: scoreResult.details.grammar_breakdown,
    template_score: scoreResult.details.template_breakdown,
    false_positives: scoreResult.details.false_positives,
    total: scoreResult.total,
    delta: null,  // populated by the convergence loop driver
    decision: null,
    rule_matches: [],
    rejected_rules: [],
  };

  return { result, scoreResult };
}

describe(`TREMOR convergence — iteration ${ITERATION}`, () => {
  it('raw fixture: ingests and scores without crashing', () => {
    const rawData = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const { result, scoreResult } = runIteration(rawData, 'raw');

    // Structural assertions (always true regardless of classifier quality)
    assert.ok(result.event_count > 0, 'must produce at least one event from USGS fixture');
    assert.ok(typeof scoreResult.total === 'number', 'total score must be a number');
    assert.strictEqual(scoreResult.total, 7.5,
      `TREMOR ${result.mode} score must be 7.5/7.5, got ${scoreResult.total}`);

    // Emit structured log
    process.stdout.write(JSON.stringify(result) + '\n');
  });

  it('anonymized fixture: ingests and scores without crashing', () => {
    const rawData = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const anonData = anonymize(rawData, FEED_NAME);

    // Verify anonymization changed the field names
    const rawKeys = Object.keys(rawData.features?.[0]?.properties ?? rawData);
    const anonTopKeys = Object.keys(anonData.features?.[0]?.properties ?? anonData);
    const unchanged = rawKeys.filter(k => anonTopKeys.includes(k));
    assert.ok(
      unchanged.length === 0 || rawKeys.length === 0,
      `anonymizer must rename all field names; unchanged: ${unchanged.join(', ')}`
    );

    const { result, scoreResult } = runIteration(anonData, 'anonymized');

    assert.ok(result.event_count > 0, 'anonymized fixture must still produce events');
    assert.ok(typeof scoreResult.total === 'number', 'total score must be a number');
    assert.strictEqual(scoreResult.total, 7.5,
      `TREMOR ${result.mode} score must be 7.5/7.5, got ${scoreResult.total}`);

    process.stdout.write(JSON.stringify({ ...result, mode: 'anonymized' }) + '\n');
  });
});
