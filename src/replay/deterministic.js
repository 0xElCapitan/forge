/**
 * src/replay/deterministic.js
 * Deterministic fixture replay. Loads a fixture JSON file and returns events
 * in timestamp order. Used by the convergence test harness.
 *
 * @module replay/deterministic
 */

import { readFileSync } from 'node:fs';

/**
 * @typedef {Object} ReplayOptions
 * @property {number} [speedFactor=0] - 0 = instant (all events at once), >0 = real-time multiple
 */

/**
 * @typedef {Object} ReplayResult
 * @property {any[]} events - Raw events in timestamp order
 * @property {string} shape - Detected shape: 'geojson_feature_collection' | 'array_of_objects' | 'array_of_arrays' | 'combined_object'
 * @property {string} fixturePath - Original file path
 */

/**
 * Detect the shape of a parsed JSON fixture.
 * @param {any} data
 * @returns {string}
 */
function detectShape(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      return 'geojson_feature_collection';
    }
    // Combined object with multiple arrays (e.g. swpc-goes-xray.json, donki-flr-cme.json)
    return 'combined_object';
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return 'array_of_objects';
    const first = data[0];
    if (Array.isArray(first)) return 'array_of_arrays';
    return 'array_of_objects';
  }
  return 'unknown';
}

/**
 * Flatten a fixture into a raw event array, preserving structure.
 * For combined objects, each top-level array becomes a sub-stream tagged with its key.
 * @param {any} data
 * @param {string} shape
 * @returns {any[]}
 */
function flattenFixture(data, shape) {
  switch (shape) {
    case 'geojson_feature_collection':
      return data.features;
    case 'array_of_objects':
    case 'array_of_arrays':
      return data;
    case 'combined_object': {
      // Expand each array-valued key into events tagged with { _stream, _data }
      const events = [];
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            events.push({ _stream: key, _data: item });
          }
        }
      }
      return events;
    }
    default:
      return [];
  }
}

/**
 * Create a deterministic replay from a fixture file.
 * With speedFactor: 0, returns all events immediately as a plain array.
 *
 * @param {string} fixturePath - Path to fixture JSON file
 * @param {ReplayOptions} [options]
 * @returns {ReplayResult}
 */
export function createReplay(fixturePath, options = {}) {
  const { speedFactor = 0 } = options;

  const raw = readFileSync(fixturePath, 'utf8');
  const data = JSON.parse(raw);
  const shape = detectShape(data);
  const events = flattenFixture(data, shape);

  if (speedFactor !== 0) {
    // Non-instant replay is not needed for Sprint 1 — return same result for now.
    // Future: implement AsyncIterable with setTimeout pacing.
  }

  return {
    events,
    shape,
    fixturePath,
  };
}

/**
 * Convenience: load a fixture and return just the events array.
 * @param {string} fixturePath
 * @returns {any[]}
 */
export function loadFixture(fixturePath) {
  return createReplay(fixturePath).events;
}
