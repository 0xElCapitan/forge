/**
 * test/convergence/anonymizer.js
 * Deterministic field-name anonymizer for convergence testing.
 * Shuffles all JSON field names to random 6-char strings (seeded per fixture).
 * Strips URL and domain strings from string values.
 * Preserves numeric values, timestamps, and array structure.
 *
 * This ensures the ingester works on structural heuristics only,
 * not hardcoded field names.
 *
 * @module convergence/anonymizer
 */

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

/**
 * Simple seeded PRNG (mulberry32 algorithm).
 * Returns a function that produces floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function makePRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a 32-bit integer (djb2).
 * @param {string} str
 * @returns {number}
 */
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

// ─── Field name generation ───────────────────────────────────────────────────

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random 6-char lowercase+digit string.
 * @param {() => number} rand
 * @returns {string}
 */
function randomFieldName(rand) {
  let name = '';
  for (let i = 0; i < 6; i++) {
    name += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return name;
}

// ─── URL/domain stripping ────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s"]+/g;
const DOMAIN_RE = /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|org|net|gov|edu|io|gov|noaa|nasa|usgs|purpleair|airnow)\b[^\s"]*/g;

/**
 * Strip URLs and domain names from a string value.
 * @param {string} val
 * @returns {string}
 */
function stripSourceStrings(val) {
  return val
    .replace(URL_RE, '[url]')
    .replace(DOMAIN_RE, '[domain]');
}

// ─── Core anonymization ──────────────────────────────────────────────────────

/**
 * Anonymize a parsed JSON value recursively.
 * Field names → random 6-char strings (seeded, consistent within a call).
 * String values → URL/domain stripped.
 * Numbers, booleans, null, arrays → preserved structurally.
 *
 * @param {any} data
 * @param {() => number} rand - Seeded PRNG
 * @param {Map<string, string>} nameMap - Cache: original name → anonymized name
 * @returns {any}
 */
function anonymizeValue(data, rand, nameMap) {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => anonymizeValue(item, rand, nameMap));
  }

  if (typeof data === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(data)) {
      // Get or create anonymized name for this field
      if (!nameMap.has(key)) {
        let candidate;
        let attempts = 0;
        do {
          candidate = randomFieldName(rand);
          attempts++;
        } while ([...nameMap.values()].includes(candidate) && attempts < 1000);
        nameMap.set(key, candidate);
      }
      const anonKey = nameMap.get(key);
      result[anonKey] = anonymizeValue(val, rand, nameMap);
    }
    return result;
  }

  if (typeof data === 'string') {
    return stripSourceStrings(data);
  }

  // number, boolean — preserve exactly
  return data;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Anonymize a fixture's parsed JSON data.
 * - All field names replaced with deterministic random 6-char strings.
 * - URLs and domain names stripped from string values.
 * - Numeric values, array structure, timestamps preserved.
 * - Same (data, seed) input always produces the same output.
 *
 * @param {any} rawData - Parsed JSON object or array
 * @param {string} seed - Seed string (typically fixture name, e.g. 'tremor')
 * @returns {any} Anonymized data with same structure
 */
export function anonymize(rawData, seed) {
  const rand = makePRNG(hashStr(String(seed)));
  const nameMap = new Map();
  return anonymizeValue(rawData, rand, nameMap);
}

// ─── File-based helper (sync) ─────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

/**
 * Anonymize a fixture file (reads JSON, anonymizes, returns result).
 * @param {string} filePath
 * @param {string} seed
 * @returns {any}
 */
export function anonymizeFile(filePath, seed) {
  const raw = readFileSync(filePath, 'utf8');
  return anonymize(JSON.parse(raw), seed);
}
