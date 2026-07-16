/**
 * lab/acquisition/assemble.js
 *
 * Cycle-005 S01 (PRD FR-A1/FR-A6, FR-C2; SDD DR-4.4, DR-8, DR-10; Sprint Plan T1.4).
 *
 * The census-input assembler. Builds each candidate's local aggregate-metadata JSON
 * as EXACTLY the frozen 14-field contract ([census.js:54-58]) — nothing more,
 * nothing less (DR-4.4 poisoning prevention). The object is the union of:
 *   - identity (`provider`, `product`) transcribed from the frozen pool;
 *   - DR-8 authored inputs (the 8 authored gate flags + `cadence`), injected verbatim;
 *   - measured fields (`n_observations`, `history_years`, `span`) from extract.js,
 *     present ONLY where lawfully classified.
 *
 * DR-4.4 census-input rule: a metadata file is assembled ONLY for a candidate whose
 * every HARD-GATE input field is lawfully present (`history_years` finite, and
 * `n_observations` an integer). An unresolved candidate gets NO file — feeding a
 * gap-ridden object to the frozen census would surface as a Gate-3 failure and
 * disguise §9.1 class 3 as class 2, which PRD §9.1 forbids. Writes are canonical +
 * atomic (DR-10). NO value-level series is ever written.
 *
 * @module lab/acquisition/assemble
 */

import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';

/** The frozen 14-field census-input contract, in the frozen order ([census.js:54-58]). */
export const EXPECTED_FIELDS = Object.freeze([
  'provider', 'product', 'n_observations', 'history_years', 'span', 'cadence',
  'authority_published', 'public', 'machine_readable', 'free',
  'exogeneity_judgment', 'exogenous', 'mechanical_outcome_declared', 'revision_vintage_documented',
]);

/** The 8 authored gate flags injected verbatim from the Gate-A table (DR-8). */
export const AUTHORED_FLAGS = Object.freeze([
  'authority_published', 'public', 'machine_readable', 'free',
  'exogeneity_judgment', 'exogenous', 'mechanical_outcome_declared', 'revision_vintage_documented',
]);

/** An assembly refusal — DR-4.4 census-input-rule breach or exact-field-set violation. */
export class AssemblyRefusal extends Error {
  constructor(message) { super(message); this.name = 'AssemblyRefusal'; }
}

/** DR-4.4 slug: lowercase, runs of non-[a-z0-9] → '-', trimmed. */
export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The fixed census-input filename `rank-<rank>-<slug(provider product)>.json` (DR-4.4). */
export function metadataFilename(rank, provider, product) {
  if (!Number.isInteger(rank) || rank < 1) throw new AssemblyRefusal(`metadataFilename: rank must be a positive integer, got ${rank}`);
  return `rank-${rank}-${slugify(`${provider} ${product}`)}.json`;
}

/**
 * Assemble one candidate's 14-field census-input object. Throws {@link AssemblyRefusal}
 * on any DR-4.4 breach (missing hard-gate input, wrong field set, wrong types).
 *
 * @param {Object} p
 * @param {number} p.rank
 * @param {string} p.provider
 * @param {string} p.product
 * @param {Object} p.authored_inputs - the DR-8 authored table entry (8 flags + cadence)
 * @param {Object} p.measured - { n_observations, history_years, span } from extract.js
 * @returns {Object} the exact 14-field object
 */
export function assembleCandidate({ rank, provider, product, authored_inputs, measured }) {
  if (typeof provider !== 'string' || provider.length === 0) throw new AssemblyRefusal('assemble: provider required');
  if (typeof product !== 'string' || product.length === 0) throw new AssemblyRefusal('assemble: product required');
  if (authored_inputs === null || typeof authored_inputs !== 'object') throw new AssemblyRefusal('assemble: authored_inputs required (DR-8)');
  if (measured === null || typeof measured !== 'object') throw new AssemblyRefusal('assemble: measured fields required');

  // DR-4.4 hard-gate input rule: a metadata file exists ONLY when the gate-3 inputs
  // are lawfully present. An unresolved candidate must NOT reach the census.
  if (!Number.isInteger(measured.n_observations)) {
    throw new AssemblyRefusal(`assemble rank ${rank}: n_observations is not a lawful integer (DR-4.4) — unresolved candidate gets NO census-input file`);
  }
  if (!Number.isFinite(measured.history_years)) {
    throw new AssemblyRefusal(`assemble rank ${rank}: history_years is not a lawful finite number (DR-4.4) — unresolved candidate gets NO census-input file`);
  }

  for (const f of AUTHORED_FLAGS) {
    if (!(f in authored_inputs)) throw new AssemblyRefusal(`assemble rank ${rank}: authored input "${f}" absent (DR-8)`);
  }
  if (typeof authored_inputs.exogeneity_judgment !== 'string' || authored_inputs.exogeneity_judgment.trim().length === 0) {
    throw new AssemblyRefusal(`assemble rank ${rank}: exogeneity_judgment must be a non-empty string (gate 2)`);
  }
  if (typeof authored_inputs.cadence !== 'string' || authored_inputs.cadence.length === 0) {
    throw new AssemblyRefusal(`assemble rank ${rank}: cadence (authored/transcribed) required`);
  }

  const obj = {
    provider,
    product,
    n_observations: measured.n_observations,
    history_years: measured.history_years,
    span: 'span' in measured ? measured.span : null,
    cadence: authored_inputs.cadence,
    authority_published: authored_inputs.authority_published,
    public: authored_inputs.public,
    machine_readable: authored_inputs.machine_readable,
    free: authored_inputs.free,
    exogeneity_judgment: authored_inputs.exogeneity_judgment,
    exogenous: authored_inputs.exogenous,
    mechanical_outcome_declared: authored_inputs.mechanical_outcome_declared,
    revision_vintage_documented: authored_inputs.revision_vintage_documented,
  };
  assertExactFieldSet(obj);
  return obj;
}

/** Assert an object carries EXACTLY the 14 census-input fields — no more, no fewer (DR-4.4). */
export function assertExactFieldSet(obj) {
  const keys = Object.keys(obj);
  const expected = new Set(EXPECTED_FIELDS);
  for (const k of keys) if (!expected.has(k)) throw new AssemblyRefusal(`census-input: unexpected field "${k}" (exact-14-field rule, DR-4.4)`);
  for (const f of EXPECTED_FIELDS) if (!(f in obj)) throw new AssemblyRefusal(`census-input: missing field "${f}" (exact-14-field rule, DR-4.4)`);
  if (keys.length !== EXPECTED_FIELDS.length) throw new AssemblyRefusal(`census-input: expected exactly ${EXPECTED_FIELDS.length} fields, got ${keys.length}`);
  return true;
}

/**
 * Assemble + atomically write one candidate's census-input file into `metadataDir`.
 * Canonical JSON (DR-10). Returns the written path.
 *
 * @returns {string} the metadata file path
 */
export function writeCandidateMetadata(metadataDir, { rank, provider, product, authored_inputs, measured }) {
  const obj = assembleCandidate({ rank, provider, product, authored_inputs, measured });
  const path = `${metadataDir}/${metadataFilename(rank, provider, product)}`;
  writeCanonicalJsonAtomic(path, obj);
  return path;
}
