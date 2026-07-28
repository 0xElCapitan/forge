/**
 * lab/survey/criteria.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-P4(a)–(k)/P5/P6; SDD DR-2.1, DR-2.3, DR-3.5;
 * Sprint Plan T2.1/T2.3). Parse, validate, and digest the pool-entry criteria
 * document's single canonical machine block.
 *
 * ── The contract this module enforces ────────────────────────────────────────
 *
 * The criteria document (`pool-entry-criteria.md`) is normative prose PLUS **exactly
 * one** fenced JSON block. That block is the only thing the tooling reads — prose is
 * for humans and reviewers, never for machines. The block must be byte-identical to
 * its own canonicalization, so the document digest cannot drift on whitespace.
 *
 * ── Two mechanical rules that make the criteria outcome-blind ────────────────
 *
 *  1. **Every numeric criteria value is a derived-value envelope**
 *     `{ value, derivation_ref }` — a bare number anywhere outside the small
 *     structural allowlist is a refusal (C6-FR-P5: "every numeric criterion value
 *     shall carry its derivation"). {@link validateAgainstWorksheet} then resolves
 *     every `derivation_ref` into the CI-line derivation worksheet or the frozen
 *     parameter set, so no number can appear without provenance.
 *
 *  2. **Operator-reserved slots are explicit sentinels, never guesses.** While the
 *     document is `PENDING_GATE_P`, every value the operator owns (UD-C6-1/-4:
 *     pool bounds, `k_max`, budgets, rank function, credential posture, source
 *     universe, survey procedure) is the sentinel `{ operator_decision_required:
 *     true, decision_id }`. At `GATE_P_FIXED` **zero** sentinels may remain. The
 *     implementing agent therefore cannot silently fix an operator-reserved value,
 *     and Gate P cannot be declared over a half-decided document.
 *
 * PURE with respect to the network and the filesystem: callers supply document text.
 *
 * @module lab/survey/criteria
 */

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256LFNormalized } from '../harness/manifests.js';
import { REFUSAL_REASONS as R, refuse } from './refusal.js';

/** The criteria machine block's record kind and schema generation. */
export const CRITERIA_RECORD_KIND = 'pool-entry-criteria';
export const CRITERIA_SCHEMA_VERSION = '1.0.0';

/** Lifecycle status values. Only `GATE_P_FIXED` may authorize a survey act. */
export const CRITERIA_STATUS = Object.freeze({
  PENDING_GATE_P: 'PENDING_GATE_P',
  GATE_P_FIXED: 'GATE_P_FIXED',
});

/**
 * The candidate-level criteria whose conjunction IS admission (DR-2.1(a)–(k) minus
 * the pool-level bound (i), which constrains the pool rather than a candidate).
 * Order is the document order and is the order rejections are reported in.
 */
export const CANDIDATE_CRITERION_IDS = Object.freeze([
  'C-A-count-surface',
  'C-B-no-value-contact-route',
  'C-C-cadence-history-band',
  'C-D-reserve-runnability',
  'C-E-source-universe-membership',
  'C-F-credential-posture',
  'C-G-identity-independence',
  'C-H-burned-list-disjointness',
  'C-J-provider-surface-change',
  'C-K-authored-gate-standards',
]);

/** The pool-level criterion (DR-2.1(i)) — evaluated over the constituted pool. */
export const POOL_CRITERION_IDS = Object.freeze(['C-I-pool-bounds']);

/**
 * The nine authored gate values the criteria §(k) standards govern (SDD DR-4.2
 * `authored_gate_values`). Frozen gates 1/2/4/5 + the gate-6 tie-breaker + the
 * documented cadence class. Every one must carry a `standard_ref` and a citation.
 */
export const AUTHORED_GATE_VALUE_KEYS = Object.freeze([
  'authority_published', 'public', 'machine_readable', 'free',
  'exogeneity_judgment', 'exogenous', 'mechanical_outcome_declared',
  'revision_vintage_documented', 'cadence',
]);

/**
 * Rank attributes the tooling knows how to derive. The operator picks an ordered
 * subset at Gate P (SDD §13 P-3); anything outside this registry is a refusal, so a
 * candidate-authored ranking key can never enter the sort. Every attribute here is
 * CRITERION-derived — none is a free-text field a candidate supplies about itself.
 */
export const RANK_ATTRIBUTES = Object.freeze({
  count_surface_class: { type: 'enum', source_criterion: 'C-A-count-surface' },
  cadence_obs_interval_seconds: { type: 'number', source_criterion: 'C-C-cadence-history-band' },
  history_band_margin_days: { type: 'number', source_criterion: 'C-D-reserve-runnability' },
});

/** The mandatory terminal tie-break (DR-2.1(e), DR-4.4) — total by construction. */
export const TERMINAL_TIE_BREAK = Object.freeze({
  attributes: Object.freeze(['provider', 'product']),
  comparator: 'lexicographic',
  direction: 'asc',
});

/**
 * Keys whose numeric values are STRUCTURAL (document mechanics), not criteria
 * values, and therefore need no `derivation_ref`. Deliberately tiny.
 */
const BARE_NUMBER_ALLOWED_KEYS = Object.freeze(new Set(['revision']));

/** Fields of a derived-value envelope. */
const ENVELOPE_KEYS = Object.freeze(['value', 'derivation_ref']);

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

/** True for a `{ operator_decision_required: true, decision_id }` sentinel. */
export function isOperatorSentinel(v) {
  return isPlainObject(v) && v.operator_decision_required === true && isNonEmptyString(v.decision_id);
}

/** True for a `{ value, derivation_ref }` derived-value envelope. */
export function isDerivedValue(v) {
  return isPlainObject(v)
    && Object.keys(v).length === ENVELOPE_KEYS.length
    && typeof v.value === 'number'
    && Number.isFinite(v.value)
    && isNonEmptyString(v.derivation_ref);
}

/**
 * The document digest (C6-FR-P6): `sha256LFNormalized(file bytes)`, the repo
 * convention. This is the value Gate P accepts and every later artifact cites.
 *
 * @param {string|Buffer} documentBytes
 * @returns {string} `sha256:<hex>`
 */
export function criteriaDigest(documentBytes) {
  return sha256LFNormalized(documentBytes);
}

// ── Machine-block extraction ─────────────────────────────────────────────────

const FENCE_RE = /^```json\r?\n([\s\S]*?)\r?\n```\r?$/gm;

/**
 * Extract the single fenced JSON block from the criteria document.
 *
 * Refuses when there is no block, when there is more than one (DR-2.1: "ONE fenced
 * machine block" — two blocks means two possible authorities), or when the block's
 * bytes are not already canonical.
 *
 * @param {string} documentText
 * @returns {{raw:string, parsed:Object}}
 */
export function extractMachineBlock(documentText) {
  if (typeof documentText !== 'string') {
    refuse(R.CRITERIA_BLOCK_ABSENT, 'criteria document text must be a string', { got: typeof documentText });
  }
  const blocks = [...documentText.matchAll(FENCE_RE)].map(m => m[1]);
  if (blocks.length === 0) refuse(R.CRITERIA_BLOCK_ABSENT, 'no fenced ```json machine block found in the criteria document');
  if (blocks.length > 1) {
    refuse(R.CRITERIA_BLOCK_NOT_UNIQUE, `the criteria document must contain exactly one fenced json machine block, found ${blocks.length}`, { count: blocks.length });
  }

  const raw = blocks[0];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    refuse(R.CRITERIA_SCHEMA_INVALID, `machine block is not valid JSON: ${e.message}`);
  }
  const canonical = canonicalize(parsed);
  if (raw !== canonical) {
    refuse(R.CRITERIA_BLOCK_NOT_CANONICAL,
      'machine block bytes are not canonical JSON — the document digest would drift on whitespace or key order',
      { raw_length: raw.length, canonical_length: canonical.length });
  }
  return { raw, parsed };
}

// ── Schema validation ────────────────────────────────────────────────────────

/**
 * Walk the whole block and collect every bare number that is not under an allowed
 * structural key and not inside a derived-value envelope (C6-FR-P5).
 *
 * @returns {string[]} JSON paths of offending bare numbers
 */
export function findUnprovenancedNumbers(node, path = '$') {
  const out = [];
  if (isDerivedValue(node)) return out;                       // envelope: its `value` is provenanced
  if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...findUnprovenancedNumbers(v, `${path}[${i}]`)));
    return out;
  }
  if (!isPlainObject(node)) return out;
  for (const [k, v] of Object.entries(node)) {
    const child = `${path}.${k}`;
    if (typeof v === 'number') {
      if (!BARE_NUMBER_ALLOWED_KEYS.has(k)) out.push(child);
      continue;
    }
    out.push(...findUnprovenancedNumbers(v, child));
  }
  return out;
}

/** Collect the JSON paths of every operator sentinel still present. */
export function findOperatorSentinels(node, path = '$') {
  const out = [];
  if (isOperatorSentinel(node)) return [path];
  if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...findOperatorSentinels(v, `${path}[${i}]`)));
    return out;
  }
  if (!isPlainObject(node)) return out;
  for (const [k, v] of Object.entries(node)) out.push(...findOperatorSentinels(v, `${path}.${k}`));
  return out;
}

function validateRankFunction(block, problems) {
  const rf = block.rank_function;
  if (isOperatorSentinel(rf)) return;                          // undecided at Gate P — lawful while pending
  if (!isPlainObject(rf)) { problems.push('rank_function must be an object or an operator sentinel'); return; }

  if (!Array.isArray(rf.sort_keys) || rf.sort_keys.length === 0) {
    problems.push('rank_function.sort_keys must be a non-empty array');
  } else {
    for (const [i, key] of rf.sort_keys.entries()) {
      if (!isPlainObject(key)) { problems.push(`rank_function.sort_keys[${i}] must be an object`); continue; }
      if (!Object.prototype.hasOwnProperty.call(RANK_ATTRIBUTES, key.attribute)) {
        problems.push(`rank_function.sort_keys[${i}].attribute "${key.attribute}" is not in the criterion-derived rank-attribute registry`);
      }
      if (key.direction !== 'asc' && key.direction !== 'desc') {
        problems.push(`rank_function.sort_keys[${i}].direction must be "asc" or "desc"`);
      }
    }
    const attrs = rf.sort_keys.map(k => k?.attribute);
    if (new Set(attrs).size !== attrs.length) problems.push('rank_function.sort_keys repeats an attribute');
    for (const a of attrs) {
      if (TERMINAL_TIE_BREAK.attributes.includes(a)) {
        problems.push(`rank_function.sort_keys may not name "${a}" — identity is the TERMINAL tie-break, appended by the tooling`);
      }
    }
  }

  const tb = rf.terminal_tie_break;
  if (!isPlainObject(tb)
    || canonicalize(tb.attributes ?? null) !== canonicalize(TERMINAL_TIE_BREAK.attributes)
    || tb.comparator !== TERMINAL_TIE_BREAK.comparator
    || tb.direction !== TERMINAL_TIE_BREAK.direction) {
    problems.push('rank_function.terminal_tie_break must be exactly lexicographic ascending (provider, product)');
  }
}

/**
 * Fail-closed schema validation of the criteria machine block (DR-2.1).
 *
 * @param {Object} block
 * @returns {{valid:boolean, problems:string[]}} PURE — the caller decides to refuse
 */
export function validateCriteriaBlock(block) {
  const problems = [];
  if (!isPlainObject(block)) return { valid: false, problems: ['criteria machine block must be an object'] };

  if (block.record_kind !== CRITERIA_RECORD_KIND) problems.push(`record_kind must be "${CRITERIA_RECORD_KIND}"`);
  if (block.schema_version !== CRITERIA_SCHEMA_VERSION) problems.push(`schema_version must be "${CRITERIA_SCHEMA_VERSION}"`);
  if (block.cycle !== 'cycle-006') problems.push('cycle must be "cycle-006"');
  if (!Number.isInteger(block.revision) || block.revision < 1) problems.push('revision must be an integer >= 1');
  if (block.status !== CRITERIA_STATUS.PENDING_GATE_P && block.status !== CRITERIA_STATUS.GATE_P_FIXED) {
    problems.push(`status must be "${CRITERIA_STATUS.PENDING_GATE_P}" or "${CRITERIA_STATUS.GATE_P_FIXED}"`);
  }
  if (!isNonEmptyString(block.derivations_ref)) problems.push('derivations_ref must name the derivation worksheet');

  // Criterion registry: every declared criterion, no extras, no omissions.
  const declared = Array.isArray(block.criteria) ? block.criteria : null;
  if (!declared) {
    problems.push('criteria must be an array');
  } else {
    const ids = declared.map(c => c?.criterion_id);
    const expected = [...CANDIDATE_CRITERION_IDS, ...POOL_CRITERION_IDS];
    for (const id of expected) if (!ids.includes(id)) problems.push(`criteria is missing "${id}"`);
    for (const id of ids) if (!expected.includes(id)) problems.push(`criteria declares unknown criterion "${id}"`);
    if (new Set(ids).size !== ids.length) problems.push('criteria repeats a criterion_id');
    for (const c of declared) {
      if (!isPlainObject(c)) { problems.push('every criteria entry must be an object'); continue; }
      const at = `criterion "${c.criterion_id}"`;
      if (c.scope !== 'candidate' && c.scope !== 'pool') problems.push(`${at}: scope must be "candidate" or "pool"`);
      if (c.kind !== 'citation-standard' && c.kind !== 'mechanical') problems.push(`${at}: kind must be "citation-standard" or "mechanical" (C6-FR-P5 — never a judgment call)`);
      if (!isNonEmptyString(c.standard)) problems.push(`${at}: standard text is required`);
      if (!isNonEmptyString(c.basis)) problems.push(`${at}: basis (derivation or citation rationale) is required`);
      if (!Array.isArray(c.required_evidence)) problems.push(`${at}: required_evidence must be an array (possibly empty)`);
    }
  }

  // Admission = the mechanical conjunction of the candidate criteria, in registry order.
  const adm = block.admission;
  if (!isPlainObject(adm)) {
    problems.push('admission must be an object');
  } else {
    if (adm.rule !== 'conjunction-of-candidate-criteria') problems.push('admission.rule must be "conjunction-of-candidate-criteria"');
    if (canonicalize(adm.criterion_ids ?? null) !== canonicalize(CANDIDATE_CRITERION_IDS)) {
      problems.push('admission.criterion_ids must be exactly the candidate criteria, in registry order');
    }
    if (adm.selection_relevance_required !== true) problems.push('admission.selection_relevance_required must be true (C6-FR-N8)');
  }

  validateRankFunction(block, problems);

  // Rank-attribute registry: the enum orderings the rank function may consult. Every
  // registered attribute must be one this tooling knows how to derive from criteria.
  const rar = block.rank_attribute_registry;
  if (!isPlainObject(rar)) {
    problems.push('rank_attribute_registry must be an object');
  } else {
    for (const [attr, entry] of Object.entries(rar)) {
      const spec = RANK_ATTRIBUTES[attr];
      if (!spec) { problems.push(`rank_attribute_registry declares unknown attribute "${attr}"`); continue; }
      if (!isPlainObject(entry) || entry.type !== spec.type) problems.push(`rank_attribute_registry.${attr}.type must be "${spec.type}"`);
      if (entry?.source_criterion !== spec.source_criterion) {
        problems.push(`rank_attribute_registry.${attr}.source_criterion must be "${spec.source_criterion}" — every rank key is criterion-derived`);
      }
      if (spec.type === 'enum') {
        if (!Array.isArray(entry?.ordering) || entry.ordering.length < 2) problems.push(`rank_attribute_registry.${attr}.ordering must declare at least two classes`);
        else if (new Set(entry.ordering).size !== entry.ordering.length) problems.push(`rank_attribute_registry.${attr}.ordering repeats a class`);
      }
    }
    for (const attr of Object.keys(RANK_ATTRIBUTES)) {
      if (!(attr in rar)) problems.push(`rank_attribute_registry is missing "${attr}"`);
    }
  }

  // Identity (DR-2.1(g), DR-4.3).
  const id = block.identity;
  if (!isPlainObject(id)) problems.push('identity must be an object');
  else {
    if (id.key_form !== '<provider>/<product>') problems.push('identity.key_form must be "<provider>/<product>"');
    if (id.match !== 'exact-string') problems.push('identity.match must be "exact-string" (burned-list join granularity)');
    if (id.duplicate_policy !== 'refuse') problems.push('identity.duplicate_policy must be "refuse"');
  }

  // Authored-gate standards: exactly the nine keys, each a citation or mechanical standard.
  const ags = block.authored_gate_standards;
  if (!isPlainObject(ags)) {
    problems.push('authored_gate_standards must be an object');
  } else {
    for (const k of AUTHORED_GATE_VALUE_KEYS) {
      const s = ags[k];
      if (!isPlainObject(s)) { problems.push(`authored_gate_standards.${k} is missing`); continue; }
      if (!isNonEmptyString(s.standard_ref)) problems.push(`authored_gate_standards.${k}.standard_ref is required`);
      if (!isNonEmptyString(s.standard)) problems.push(`authored_gate_standards.${k}.standard is required`);
      if (s.kind !== 'citation-standard' && s.kind !== 'mechanical') problems.push(`authored_gate_standards.${k}.kind must be "citation-standard" or "mechanical"`);
    }
    for (const k of Object.keys(ags)) {
      if (!AUTHORED_GATE_VALUE_KEYS.includes(k)) problems.push(`authored_gate_standards declares unknown authored value "${k}"`);
    }
  }

  // Cadence classes: the DR-3.5 derived band per class, each value provenanced.
  if (!Array.isArray(block.cadence_classes) || block.cadence_classes.length === 0) {
    problems.push('cadence_classes must be a non-empty array');
  } else {
    const seen = new Set();
    for (const c of block.cadence_classes) {
      if (!isPlainObject(c)) { problems.push('every cadence_classes entry must be an object'); continue; }
      if (!isNonEmptyString(c.cadence_class)) { problems.push('cadence_classes entry missing cadence_class'); continue; }
      if (seen.has(c.cadence_class)) problems.push(`cadence_classes repeats "${c.cadence_class}"`);
      seen.add(c.cadence_class);
      for (const f of ['obs_interval_seconds', 'band_lower_years', 'band_upper_years', 'band_margin_days']) {
        if (!isDerivedValue(c[f])) problems.push(`cadence_classes["${c.cadence_class}"].${f} must be a { value, derivation_ref } envelope`);
      }
      if (typeof c.admissible !== 'boolean') problems.push(`cadence_classes["${c.cadence_class}"].admissible must be a boolean`);
      if (c.admissible === true && isDerivedValue(c.band_margin_days) && !(c.band_margin_days.value > 0)) {
        problems.push(`cadence_classes["${c.cadence_class}"] is admissible but its runnability band is empty (C6-FR-P4(d))`);
      }
    }
  }

  // Operator-reserved slots must be present as slots, decided or sentinel.
  for (const k of ['pool_bounds', 'credential_posture', 'source_universe', 'survey_procedure', 'fr_d2_bounds']) {
    if (!(k in block)) problems.push(`${k} slot is missing — an operator-reserved slot must be declared even while undecided`);
  }
  if (!Array.isArray(block.operator_decisions) || block.operator_decisions.length === 0) {
    problems.push('operator_decisions must enumerate every operator-reserved slot');
  } else {
    for (const d of block.operator_decisions) {
      if (!isPlainObject(d)) { problems.push('every operator_decisions entry must be an object'); continue; }
      for (const f of ['decision_id', 'subject', 'recommendation', 'consequence']) {
        if (!isNonEmptyString(d[f])) problems.push(`operator_decisions["${d.decision_id}"].${f} is required`);
      }
      if (!Array.isArray(d.lawful_options) || d.lawful_options.length < 1) {
        problems.push(`operator_decisions["${d.decision_id}"].lawful_options must list the lawful alternatives`);
      }
    }
  }

  // C6-FR-P5: no bare numbers.
  for (const p of findUnprovenancedNumbers(block)) {
    problems.push(`numeric value at ${p} carries no derivation_ref (C6-FR-P5)`);
  }

  // Status coherence: a Gate-P-fixed document has no undecided slot left.
  const sentinels = findOperatorSentinels(block);
  if (block.status === CRITERIA_STATUS.GATE_P_FIXED && sentinels.length > 0) {
    problems.push(`status is GATE_P_FIXED but ${sentinels.length} operator-reserved slot(s) remain undecided: ${sentinels.join(', ')}`);
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Parse + validate in one fail-closed step.
 *
 * @param {string} documentText - the full criteria markdown document
 * @returns {{block:Object, raw:string, status:string, gate_p_fixed:boolean}}
 */
export function parseCriteriaDocument(documentText) {
  const { raw, parsed } = extractMachineBlock(documentText);
  const { valid, problems } = validateCriteriaBlock(parsed);
  if (!valid) refuse(R.CRITERIA_SCHEMA_INVALID, `criteria machine block failed validation (${problems.length} problem(s))`, { problems });
  return { block: parsed, raw, status: parsed.status, gate_p_fixed: parsed.status === CRITERIA_STATUS.GATE_P_FIXED };
}

/** Refuse unless the criteria are Gate-P-fixed. The survey lane's first gate. */
export function assertGatePFixed(block) {
  if (block?.status !== CRITERIA_STATUS.GATE_P_FIXED) {
    refuse(R.CRITERIA_NOT_GATE_P_FIXED,
      `criteria status is "${block?.status}" — no survey, nomination, evaluation, or enumeration act is lawful before the criteria are Gate-P-fixed (I-1/I-3)`,
      { status: block?.status, undecided: findOperatorSentinels(block ?? {}) });
  }
}

/**
 * Resolve every `derivation_ref` in the block against the CI-line derivation
 * worksheet (AC-C8). A ref resolves when it names a worksheet `constant_id`, a
 * frozen input (`frozen_inputs.<key>`), a declared cadence-envelope row
 * (`cadence_history_envelope.c<cadence_seconds>[.<field>]`), or a declared operator
 * decision (`gate_p_decision.<decision_id>`).
 *
 * The last form exists because C6-FR-P4(i) reserves the pool and FR-D2 bounds to the
 * operator where the evidence supports more than one lawful value. Such a number's
 * provenance is the Gate-P decision itself — which must be declared in
 * `operator_decisions[]`, carrying its own `evidence_ref` into this worksheet — never
 * an undocumented constant.
 *
 * @param {Object} block - a validated criteria machine block
 * @param {Object} worksheet - the parsed `criteria-derivations.json`
 * @returns {{valid:boolean, problems:string[], resolved:Array<{path:string, derivation_ref:string}>}}
 */
export function validateAgainstWorksheet(block, worksheet) {
  const problems = [];
  const resolved = [];
  const constantIds = new Set((worksheet?.constants ?? []).map(c => c.constant_id));
  const frozenKeys = new Set(Object.keys((worksheet?.constants ?? [])[0]?.frozen_inputs ?? {}));
  const envelopeRows = new Set((worksheet?.cadence_history_envelope?.classes ?? []).map(r => `cadence_history_envelope.c${r.cadence_seconds}`));
  const decisionIds = new Set((block?.operator_decisions ?? []).map(d => d?.decision_id).filter(Boolean));

  const walk = (node, path) => {
    if (isDerivedValue(node)) {
      const ref = node.derivation_ref;
      const ok = constantIds.has(ref)
        || (ref.startsWith('frozen_inputs.') && frozenKeys.has(ref.slice('frozen_inputs.'.length)))
        || [...envelopeRows].some(r => ref === r || ref.startsWith(`${r}.`))
        || (ref.startsWith('gate_p_decision.') && decisionIds.has(ref.slice('gate_p_decision.'.length)));
      if (!ok) problems.push(`${path}: derivation_ref "${ref}" resolves to no worksheet constant, frozen input, cadence-envelope row, or declared operator decision`);
      else resolved.push({ path, derivation_ref: ref });
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(block, '$');

  if (resolved.length === 0) problems.push('no derivation_ref found anywhere in the criteria machine block');
  return { valid: problems.length === 0, problems, resolved };
}
