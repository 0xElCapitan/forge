/**
 * lab/survey/validate.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-N3/N5/P6; SDD DR-4.1, DR-4.2, DR-4.6; Sprint Plan
 * T2.3). The third-party re-derivation check and the production survey entry point.
 *
 * ── The reproducibility rule, mechanized (DR-4.2, AC-A2) ─────────────────────
 *
 * {@link rederiveFromSurveyRecord} recomputes admission, rejection, and rank from the
 * RECORDED VERDICTS ALONE — it never reads the pool artifact while deriving.
 * {@link validatePoolAgainstSurvey} then compares that independent derivation against
 * the pool byte-for-byte on identity, order, and status, and refuses on any
 * divergence. A pool that cannot be re-derived from its own survey record is not a
 * pool; it is an assertion.
 *
 * ── The production path refuses while Gate P is absent ───────────────────────
 *
 * {@link requireSurveyAuthority} is the only entry that resolves real repository
 * paths. It refuses — loudly, with a typed reason — unless a persisted,
 * `record_id`-verified Gate-P acceptance record exists whose accepted criteria digest
 * equals the criteria bytes on disk, AND the criteria machine block is Gate-P-fixed.
 * At the time of writing no such record exists, so this path refuses by design; that
 * refusal is the mechanical form of standing invariant I-3.
 *
 * This module reads. It never fetches, never contacts a provider, and writes only
 * inside `lab/preregistration/cycle-006/` — enforced here as a resolved-containment
 * check (not a substring test) as well as by lint.
 *
 * @module lab/survey/validate
 */

import { readFileSync, existsSync } from 'node:fs';
import {
  resolve as resolvePath, relative as relativePath, isAbsolute, sep as PATH_SEP,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { contentAddress, sha256LFNormalized, assertNoForbiddenKeys } from '../harness/manifests.js';
import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';

import { REFUSAL_REASONS as R, refuse } from './refusal.js';
import { parseCriteriaDocument, assertGatePFixed, CANDIDATE_CRITERION_IDS } from './criteria.js';
import { deriveAdmissions } from './admit.js';
import { deriveRankAttributes, assignRanks, validateRankSequence } from './rank.js';
import {
  verifyGatePAuthority, GATE_P_RECORD_REL, CRITERIA_DOC_REL, PREREGISTRATION_REL, DERIVATIONS_REL,
} from './gate-p.js';

/** The frozen burned-list authority the §(h) pre-screen and gate 5 join against. */
export const BURNED_LIST_REL = 'lab/census/burned-list.json';

/** The ONLY directory this lane may write into (DR-4.7). */
export const SURVEY_WRITE_ROOT = 'lab/preregistration/cycle-006/';

export const SURVEY_RECORD_KIND = 'survey-record';
export const POOL_AUTHORITY = 'successor-candidate-pool';

// Resolved anchor for the write-root containment proof below. Anchored to this module's
// own on-disk location — never to `process.cwd()` — so the guard's answer does not
// depend on the invoking process's working directory.
const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT_ABS = resolvePath(MODULE_DIR, '..', '..');
const SURVEY_WRITE_ROOT_ABS = resolvePath(REPO_ROOT_ABS, SURVEY_WRITE_ROOT);

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function posix(p) { return String(p).replace(/\\/g, '/'); }

/**
 * A literal `..` path segment, split on either separator convention. A resolved-path
 * check alone cannot be trusted to catch this on every host: POSIX does not treat `\`
 * as a separator at all, so a `..\` sequence would otherwise only be caught by accident
 * (§7.1 correction — the guard must be right by construction, not by coincidence).
 */
function hasTraversalSegment(rawPath) {
  return String(rawPath).split(/[\\/]+/).includes('..');
}

/**
 * Resolve `rawPath` to an absolute, normalized path. A relative input resolves against
 * the repository root, never `process.cwd()`, so the answer is deterministic regardless
 * of where the process was launched from.
 */
function resolveAgainstRepoRoot(rawPath) {
  const p = String(rawPath);
  return isAbsolute(p) ? resolvePath(p) : resolvePath(REPO_ROOT_ABS, p);
}

/**
 * A `:` in any segment of a path already confirmed to resolve to a strict descendant of
 * the write root (Gate-P audit residual B-2). Checked only on that write-root-relative
 * portion — never on the absolute resolved path — so the drive-letter separator of an
 * absolute Windows root (e.g. `C:`) can never be misclassified: `relativePath` strips the
 * shared root, including its drive letter, before this runs, and a cross-drive input is
 * already refused as outside the write root by the strict-descendant check above. What
 * remains in `relToRoot` is caller-controlled content only. On NTFS, `name:stream` is the
 * alternate-data-stream form; survey artifact names have no lawful need for `:`, so a
 * conservative cross-platform prohibition is correct on every host, not only Windows.
 */
function hasAlternateDataStreamSegment(relToRoot) {
  return String(relToRoot).split(/[\\/]+/).some(segment => segment.includes(':'));
}

/**
 * The Windows reserved device basenames (Gate-P audit residual C-2, EC-elevated over
 * report 17 §9.2). Windows filename resolution treats each of these as a device, not a
 * regular file, regardless of any extension attached to it (`NUL.json` still names the
 * NUL device) and regardless of trailing spaces or periods (`NUL.`, `NUL ` still name the
 * NUL device) — both properties are normalized away in {@link hasReservedDeviceSegment}
 * before the comparison. Includes the COM/LPT superscript-digit aliases (`COM¹`…`COM³`,
 * `LPT¹`…`LPT³`) that recent Windows releases also treat as reserved.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', 'CONIN$', 'CONOUT$',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³',
]);

/**
 * A Windows reserved-device basename in any segment of a path already confirmed to
 * resolve to a strict descendant of the write root (Gate-P audit residual C-2). Checked
 * only on the write-root-relative portion — never on the absolute resolved path — for
 * the same reason as {@link hasAlternateDataStreamSegment}: the drive-letter separator of
 * an absolute Windows root can never reach this comparison. Per segment: trailing spaces
 * and periods are stripped (Windows ignores them when resolving a device name), then the
 * device basename is taken as everything before the first remaining period (Windows
 * device-name matching ignores any "extension"), then compared case-insensitively against
 * {@link RESERVED_DEVICE_NAMES}. A basename that merely contains a reserved token as part
 * of a longer name (`null-data`, `console`, `com10`) is not a match.
 */
function hasReservedDeviceSegment(relToRoot) {
  return String(relToRoot).split(/[\\/]+/).some(segment => {
    const trimmed = segment.replace(/[ .]+$/, '');
    const dot = trimmed.indexOf('.');
    const base = dot === -1 ? trimmed : trimmed.slice(0, dot);
    return RESERVED_DEVICE_NAMES.has(base.toUpperCase());
  });
}

/**
 * Resolved-containment proof (DR-4.7 correction): `filePath` must resolve to a strict
 * descendant of the survey write root. This is the run-time backstop for a
 * caller-constructed, non-literal path the boundary lint cannot see — the case the
 * substring test it replaces did not actually cover. Rejects `..` traversal (either
 * separator convention), sibling-prefix collisions (e.g. `cycle-006-other`), the write
 * root itself, any absolute destination outside the root, an NTFS alternate-data-stream
 * suffix inside the root (B-2), and a Windows reserved-device basename in any descendant
 * path segment (C-2).
 */
function assertWithinSurveyWriteRoot(filePath) {
  const attempted = posix(filePath);
  if (hasTraversalSegment(filePath)) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      `the survey lane may only write inside ${SURVEY_WRITE_ROOT}`,
      { attempted, reason: 'path traversal segment' });
  }
  const resolved = resolveAgainstRepoRoot(filePath);
  const rel = relativePath(SURVEY_WRITE_ROOT_ABS, resolved);
  const isStrictDescendant = rel !== '' && rel !== '..' && !rel.startsWith(`..${PATH_SEP}`) && !isAbsolute(rel);
  if (!isStrictDescendant) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      `the survey lane may only write inside ${SURVEY_WRITE_ROOT}`,
      { attempted, resolved: posix(resolved), reason: 'destination resolves outside the write root' });
  }
  if (hasAlternateDataStreamSegment(rel)) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      `the survey lane may only write inside ${SURVEY_WRITE_ROOT}`,
      { attempted, resolved: posix(resolved), reason: 'NTFS alternate-data-stream delimiter in a descendant path segment' });
  }
  if (hasReservedDeviceSegment(rel)) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      `the survey lane may only write inside ${SURVEY_WRITE_ROOT}`,
      { attempted, resolved: posix(resolved), reason: 'Windows reserved device basename in a descendant path segment' });
  }
}

// ── Deterministic serialization ──────────────────────────────────────────────

/** Canonical bytes for any survey artifact: sorted keys, no insignificant whitespace, LF-terminated. */
export function serializeSurveyArtifact(value) {
  return canonicalize(value) + '\n';
}

/** Self-excluded content id, the repo one-shot-record convention. */
export function computeSurveyRecordId(record) {
  const { record_id, ...rest } = record;
  void record_id;
  return contentAddress(rest);
}

/**
 * Atomically write a survey artifact, refusing any destination that does not resolve to
 * a strict descendant of the lane's single write root (DR-4.7). Belt and braces: the
 * boundary lint forbids naming another path in source; this is the run-time backstop for
 * a caller-constructed path the lint cannot see — it resolves both sides and proves
 * containment, rather than testing for a mere substring.
 */
export function writeSurveyArtifact(filePath, value) {
  assertWithinSurveyWriteRoot(filePath);
  assertNoForbiddenKeys(value);
  writeCanonicalJsonAtomic(filePath, value);
  return filePath;
}

// ── Survey-record shape ──────────────────────────────────────────────────────

/**
 * Fail-closed shape validation of a survey record (DR-4.2). PURE.
 *
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateSurveyRecordShape(record) {
  const problems = [];
  if (!isPlainObject(record)) return { valid: false, problems: ['survey record must be an object'] };
  if (record.record_kind !== SURVEY_RECORD_KIND) problems.push(`record_kind must be "${SURVEY_RECORD_KIND}"`);
  if (record.cycle !== 'cycle-006') problems.push('cycle must be "cycle-006"');
  if (!isNonEmptyString(record.schema_version)) problems.push('schema_version is required');
  if (!isNonEmptyString(record.criteria_digest)) problems.push('criteria_digest is required (C6-FR-P6)');
  if (!isNonEmptyString(record.gate_p_record_id)) problems.push('gate_p_record_id is required (AC-A1)');

  const su = record.source_universe;
  if (!isPlainObject(su)) problems.push('source_universe is required');
  else {
    if (!isNonEmptyString(su.declared_ref)) problems.push('source_universe.declared_ref is required');
    if (su.sweep_completed !== true) problems.push('source_universe.sweep_completed must be true — a partial sweep is not a survey (C6-FR-N3)');
  }

  if (!Array.isArray(record.surveyed)) problems.push('surveyed must be an array of EVERY consulted provider-product (C6-FR-N3)');
  if (!Number.isInteger(record.admitted_count) || record.admitted_count < 0) problems.push('admitted_count must be a non-negative integer');
  if (!Number.isInteger(record.selection_relevant_count) || record.selection_relevant_count < 0) problems.push('selection_relevant_count must be a non-negative integer');

  // C6-FR-N1: no measured value may appear anywhere in the record.
  for (const p of findMeasuredValueLeaks(record)) problems.push(`possible measured value at ${p} — the survey records documented descriptors and citations only (C6-FR-N1)`);

  return { valid: problems.length === 0, problems };
}

/**
 * The census-measured field names that must NEVER appear in a survey record or pool
 * artifact: measurement is the sealed apparatus's post-G0 monopoly (C6-FR-N1).
 */
export const MEASURED_FIELD_KEYS = Object.freeze(['n_observations', 'history_years', 'span']);

/** Collect JSON paths where a census-measured field name appears as a key. */
export function findMeasuredValueLeaks(node, path = '$') {
  const out = [];
  if (Array.isArray(node)) { node.forEach((v, i) => out.push(...findMeasuredValueLeaks(v, `${path}[${i}]`))); return out; }
  if (!isPlainObject(node)) return out;
  for (const [k, v] of Object.entries(node)) {
    const child = `${path}.${k}`;
    if (MEASURED_FIELD_KEYS.includes(k)) out.push(child);
    out.push(...findMeasuredValueLeaks(v, child));
  }
  return out;
}

// ── Re-derivation ────────────────────────────────────────────────────────────

/**
 * Re-derive admission, rejection, and rank from the survey record's recorded verdicts
 * ALONE. Reads no pool artifact — that is the whole point (AC-A2).
 *
 * @param {Object} p
 * @param {Object} p.surveyRecord
 * @param {Object} p.criteria - validated, Gate-P-fixed criteria machine block
 * @param {Object} p.burnedList - frozen authority
 * @returns {{admissions:Array<Object>, ranked:Array<Object>, admitted_count:number, selection_relevant_count:number}}
 */
export function rederiveFromSurveyRecord({ surveyRecord, criteria, burnedList }) {
  const shape = validateSurveyRecordShape(surveyRecord);
  if (!shape.valid) refuse(R.SURVEY_RECORD_INVALID, `survey record failed shape validation (${shape.problems.length} problem(s))`, { problems: shape.problems });

  const { admissions, admitted_count, selection_relevant_count } = deriveAdmissions({
    surveyed: surveyRecord.surveyed, burnedList,
  });

  const byKey = new Map(surveyRecord.surveyed.map(e => [`${e.provider}/${e.product}`, e]));
  const admittedWithAttrs = admissions
    .filter(a => a.survey_status === 'SURVEYED_ADMITTED')
    .map(a => ({
      candidate_key: a.candidate_key,
      provider: a.provider,
      product: a.product,
      rank_attributes: deriveRankAttributes({ entry: byKey.get(a.candidate_key), criteria }),
    }));

  const ranked = assignRanks({ admitted: admittedWithAttrs, criteria });
  const seq = validateRankSequence(ranked);
  if (!seq.valid) refuse(R.RANK_NOT_TOTAL, `derived ranks are not a contiguous 1..N sequence (${seq.problems.join('; ')})`, { problems: seq.problems });

  return { admissions, ranked, admitted_count, selection_relevant_count };
}

/**
 * Compare an independently re-derived result against the pool artifact and refuse on
 * ANY divergence — identity, order, status, or count (DR-4.2 reproducibility rule).
 *
 * @returns {{valid:true, admitted_count:number, selection_relevant_count:number}}
 */
export function validatePoolAgainstSurvey({ surveyRecord, poolArtifact, criteria, burnedList }) {
  const derived = rederiveFromSurveyRecord({ surveyRecord, criteria, burnedList });
  const divergences = [];

  if (poolArtifact?.authority !== POOL_AUTHORITY) divergences.push(`pool authority must be "${POOL_AUTHORITY}"`);
  if (poolArtifact?.cycle !== 'cycle-006') divergences.push('pool cycle must be "cycle-006"');
  if (poolArtifact?.criteria_digest !== surveyRecord.criteria_digest) divergences.push('pool criteria_digest differs from the survey record');
  if (poolArtifact?.gate_p_record_id !== surveyRecord.gate_p_record_id) divergences.push('pool gate_p_record_id differs from the survey record');

  const claimed = Array.isArray(poolArtifact?.candidates) ? poolArtifact.candidates : null;
  if (!claimed) {
    divergences.push('pool candidates must be an array');
  } else {
    if (claimed.length !== derived.ranked.length) {
      divergences.push(`pool holds ${claimed.length} candidates; re-derivation admits ${derived.ranked.length}`);
    }
    const n = Math.min(claimed.length, derived.ranked.length);
    for (let i = 0; i < n; i++) {
      const c = claimed[i];
      const d = derived.ranked[i];
      if (c.rank !== d.rank) divergences.push(`position ${i}: pool rank ${c.rank} != derived ${d.rank}`);
      if (c.provider !== d.provider || c.product !== d.product) {
        divergences.push(`rank ${d.rank}: pool identity ${c.provider}/${c.product} != derived ${d.provider}/${d.product}`);
      }
      if (c.selection_relevant !== true) divergences.push(`rank ${d.rank}: every pool member must be selection_relevant (C6-FR-N8)`);
    }
    const seq = validateRankSequence(claimed);
    if (!seq.valid) divergences.push(...seq.problems.map(p => `pool ranks: ${p}`));
  }

  if (surveyRecord.admitted_count !== derived.admitted_count) {
    divergences.push(`survey admitted_count ${surveyRecord.admitted_count} != derived ${derived.admitted_count}`);
  }
  if (surveyRecord.selection_relevant_count !== derived.selection_relevant_count) {
    divergences.push(`survey selection_relevant_count ${surveyRecord.selection_relevant_count} != derived ${derived.selection_relevant_count}`);
  }

  // Every rejection must name the specific failed criterion (C6-FR-N3).
  for (const a of derived.admissions) {
    if (a.survey_status !== 'SURVEYED_REJECTED') continue;
    if (!isNonEmptyString(a.rejection_criterion)) divergences.push(`${a.candidate_key}: rejection names no criterion`);
    const recorded = surveyRecord.surveyed.find(e => `${e.provider}/${e.product}` === a.candidate_key);
    if (recorded?.survey_status !== undefined && recorded.survey_status !== a.survey_status) {
      divergences.push(`${a.candidate_key}: recorded status "${recorded.survey_status}" != derived "${a.survey_status}"`);
    }
    if (recorded?.rejection_criterion !== undefined && recorded.rejection_criterion !== a.rejection_criterion) {
      divergences.push(`${a.candidate_key}: recorded rejection_criterion "${recorded.rejection_criterion}" != derived "${a.rejection_criterion}"`);
    }
  }
  for (const a of derived.admissions) {
    if (a.survey_status !== 'SURVEYED_ADMITTED') continue;
    const recorded = surveyRecord.surveyed.find(e => `${e.provider}/${e.product}` === a.candidate_key);
    if (recorded?.survey_status !== undefined && recorded.survey_status !== a.survey_status) {
      divergences.push(`${a.candidate_key}: recorded status "${recorded.survey_status}" != derived "${a.survey_status}"`);
    }
  }

  if (divergences.length > 0) {
    refuse(R.REDERIVATION_DIVERGENCE,
      `the pool artifact cannot be re-derived from the survey record alone (${divergences.length} divergence(s))`,
      { divergences });
  }
  return { valid: true, admitted_count: derived.admitted_count, selection_relevant_count: derived.selection_relevant_count };
}

/**
 * Refuse unless the bounds object is a RESOLVED, usable pair of Gate-P integers
 * (Gate-P audit residual A-3).
 *
 * The distinction this draws is the whole point. "Fewer selection-relevant members than
 * the Gate-P minimum" is a valid typed ending, so {@link checkPoolBounds} reports it as a
 * verdict. "I could not tell what the bounds are" is not an ending at all — it is a
 * specification defect — and reporting it as a verdict is how a fail-open happens. Before
 * this guard, an absent, null, malformed, or still-sentinel bounds object made both
 * comparisons vacuously false and produced `within_bounds: true`: the single most
 * permissive answer, returned for the single least usable input.
 *
 * Bounds are required as BARE INTEGERS — the shape the Gate-P acceptance record carries.
 * The criteria machine block carries the same two numbers as `{ value, derivation_ref }`
 * envelopes (C6-FR-P5), and an envelope is deliberately refused here rather than silently
 * unwrapped: a caller must say which authority it is bounding against.
 */
function assertUsablePoolBounds(pool_bounds) {
  const bad = (message, detail) => refuse(R.POOL_BOUNDS_UNRESOLVED, message, detail);

  if (!isPlainObject(pool_bounds)) {
    bad('pool bounds are absent, null, or not an object — the Gate-P bounds must be resolved before any bound check',
      { got: pool_bounds === null ? 'null' : Array.isArray(pool_bounds) ? 'array' : typeof pool_bounds });
  }
  if (pool_bounds.operator_decision_required === true) {
    bad('pool bounds are still the Gate-P operator sentinel — no bound check is meaningful over an undecided slot',
      { decision_id: pool_bounds.decision_id ?? null });
  }
  for (const k of ['min_pool_selection_relevant', 'max_pool']) {
    const v = pool_bounds[k];
    if (Number.isInteger(v) && v >= 1) continue;
    bad(`pool_bounds.${k} is not a resolved integer >= 1`, {
      key: k,
      got: v === undefined ? 'undefined' : v === null ? 'null' : typeof v,
      derived_value_envelope: isPlainObject(v) && 'value' in v && 'derivation_ref' in v,
      hint: 'the Gate-P record carries bare integers; the criteria machine block carries { value, derivation_ref } envelopes — unwrap explicitly',
    });
  }
  if (pool_bounds.min_pool_selection_relevant > pool_bounds.max_pool) {
    bad('pool_bounds.min_pool_selection_relevant exceeds pool_bounds.max_pool — the bounds are invalidly ordered',
      { min_pool_selection_relevant: pool_bounds.min_pool_selection_relevant, max_pool: pool_bounds.max_pool });
  }
}

/**
 * Check the Gate-P pool bounds over SELECTION-RELEVANT members only (C6-FR-N7/N8).
 *
 * Returns the insufficiency verdict rather than throwing, because "no lawfully
 * constitutable pool" is a valid typed ending, not an error (DR-4.9). It refuses — typed,
 * loudly — only when the inputs cannot support a verdict at all: see
 * {@link assertUsablePoolBounds}. `within_bounds: true` is therefore reachable only over
 * resolved bounds and a real count.
 *
 * @throws {SurveyRefusal} `POOL_BOUNDS_UNRESOLVED` on unusable bounds or an unusable count
 * @returns {{within_bounds:boolean, insufficient:boolean, over_max:boolean, ...}}
 */
export function checkPoolBounds({ selection_relevant_count, pool_bounds }) {
  assertUsablePoolBounds(pool_bounds);
  if (!Number.isInteger(selection_relevant_count) || selection_relevant_count < 0) {
    refuse(R.POOL_BOUNDS_UNRESOLVED,
      'selection_relevant_count is not a non-negative integer — a bound check over a non-count would report within_bounds vacuously',
      { got: typeof selection_relevant_count, value: String(selection_relevant_count) });
  }

  const min = pool_bounds.min_pool_selection_relevant;
  const max = pool_bounds.max_pool;
  const insufficient = selection_relevant_count < min;
  const over_max = selection_relevant_count > max;
  return {
    within_bounds: !insufficient && !over_max,
    insufficient,
    over_max,
    selection_relevant_count,
    min_pool_selection_relevant: min,
    max_pool: max,
    terminal_type_if_insufficient: 'no-lawfully-constitutable-pool',
  };
}

// ── The production survey path ───────────────────────────────────────────────

/**
 * Resolve real repository paths, verify Gate-P authority, and load the Gate-P-fixed
 * criteria and the frozen burned list. **This is the only function in the lane that
 * touches production paths, and it refuses unless Gate P has landed.**
 *
 * @param {Object} p
 * @param {string} p.repoRoot - absolute repository root
 * @returns {{criteria:Object, criteria_digest:string, gate_p_record:Object, gate_p_record_id:string, burnedList:Object}}
 */
export function requireSurveyAuthority({ repoRoot }) {
  if (!isNonEmptyString(repoRoot)) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED, 'requireSurveyAuthority needs an absolute repoRoot', { got: typeof repoRoot });
  }
  const at = rel => `${posix(repoRoot).replace(/\/$/, '')}/${rel}`;

  const criteriaPath = at(CRITERIA_DOC_REL);
  if (!existsSync(criteriaPath)) {
    refuse(R.CRITERIA_BLOCK_ABSENT, 'the pool-entry criteria document does not exist', { expected_at: CRITERIA_DOC_REL });
  }

  // I-3: the Gate-P record is the authority. Absent it, nothing below runs.
  const { record, criteria_digest, record_id } = verifyGatePAuthority({
    gatePRecordPath: at(GATE_P_RECORD_REL),
    criteriaDocumentPath: criteriaPath,
  });

  const { block } = parseCriteriaDocument(readFileSync(criteriaPath, 'utf8'));
  assertGatePFixed(block);

  const burnedPath = at(BURNED_LIST_REL);
  if (!existsSync(burnedPath)) {
    refuse(R.PRODUCTION_SURVEY_UNAUTHORIZED, 'the frozen burned-list authority is not on disk', { expected_at: BURNED_LIST_REL });
  }
  const burnedList = JSON.parse(readFileSync(burnedPath, 'utf8'));

  return { criteria: block, criteria_digest, gate_p_record: record, gate_p_record_id: record_id, burnedList };
}

/**
 * The DR-2.3 unit-acceptance path check: the three accepted digests still equal the
 * three files on disk. Returns the file digests so a caller can report them.
 *
 * @returns {{criteria:string, preregistration:string, derivations:string}}
 */
export function currentAcceptedDigests({ repoRoot }) {
  const at = rel => `${posix(repoRoot).replace(/\/$/, '')}/${rel}`;
  const digestOf = (rel) => (existsSync(at(rel)) ? sha256LFNormalized(readFileSync(at(rel))) : null);
  return {
    criteria: digestOf(CRITERIA_DOC_REL),
    preregistration: digestOf(PREREGISTRATION_REL),
    derivations: digestOf(DERIVATIONS_REL),
  };
}

/** Re-export for callers that validate a record's criterion coverage. */
export { CANDIDATE_CRITERION_IDS };
