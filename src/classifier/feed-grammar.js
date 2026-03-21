/**
 * src/classifier/feed-grammar.js
 * Feed grammar orchestrator — runs Q1-Q5, produces a complete FeedProfile.
 *
 * Sprint 2: Q1 (cadence) and Q2 (distribution) implemented.
 * Sprint 3: Q3 (noise) and Q4 (density) implemented.
 * Sprint 4: Q5 (thresholds) implemented. Grammar is now complete (Q1-Q5).
 *
 * @module classifier/feed-grammar
 */

import { classifyCadence } from './cadence.js';
import { classifyDistribution } from './distribution.js';
import { classifyNoise } from './noise.js';
import { classifyDensity } from './density.js';
import { classifyThresholds } from './thresholds.js';

/**
 * @typedef {Object} FeedProfile
 * @property {Object} cadence      - Q1 cadence classification
 * @property {Object} distribution - Q2 distribution type
 * @property {Object} noise        - Q3 noise classification
 * @property {Object} density      - Q4 density classification
 * @property {Object} thresholds   - Q5 threshold type
 */

/**
 * Classify a NormalizedEvent[] into a complete FeedProfile.
 * All five grammar questions (Q1-Q5) are answered.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {FeedProfile}
 */
export function classify(events) {
  return {
    cadence:      classifyCadence(events),
    distribution: classifyDistribution(events),
    noise:        classifyNoise(events),
    density:      classifyDensity(events),
    thresholds:   classifyThresholds(events),  // Q5 — Sprint 4
  };
}
