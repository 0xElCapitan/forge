/**
 * src/receipt/policy-hasher.js
 * Content-address all policy inputs for the ProposalReceipt.
 *
 * Reads the RULES array and regulatory JSON files, canonicalizes them,
 * and computes deterministic hashes. Any change to rules or regulatory
 * data produces a different policy_hash.
 *
 * @module receipt/policy-hasher
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from './canonicalize.js';
import { sha256 } from './hash.js';
import { RULES } from '../selector/rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Regulatory JSON files relative to src/classifier/data/ */
const REGULATORY_FILES = [
  'regulatory-epa-aqi.json',
  'regulatory-noaa-kp.json',
  'regulatory-noaa-r.json',
];

const REGULATORY_DIR = resolve(__dirname, '../classifier/data');

/**
 * Compute content-addressed hashes for all policy inputs.
 *
 * @returns {{ policy_hash: string, rule_set_hash: string, policy_version_tag: string }}
 */
export function computePolicyHash() {
  // 1. Hash the canonicalized RULES array
  const canonicalRules = canonicalize(RULES);
  const rule_set_hash = sha256(canonicalRules);

  // 2. Hash each regulatory JSON file
  const regulatoryHashes = REGULATORY_FILES.map(file => {
    const filePath = resolve(REGULATORY_DIR, file);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return sha256(canonicalize(data));
  });

  // 3. Compute policy_hash = sha256 of concatenation
  const concatenated = rule_set_hash + regulatoryHashes.join('');
  const policy_hash = sha256(concatenated);

  return {
    policy_hash,
    rule_set_hash,
    policy_version_tag: 'forge-policy/v0.1.0',
  };
}
