/**
 * lab/survey/rank.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-P4(e)/N5; SDD DR-4.4; Sprint Plan T2.3). The
 * mechanical rank: a pure function of criterion-derived attributes, closed by a
 * terminal lexicographic `(provider, product)` tie-break.
 *
 * ── Why no candidate can be hand-placed ──────────────────────────────────────
 *
 * Every sort key is drawn from a closed registry of CRITERION-derived attributes
 * ({@link RANK_ATTRIBUTES}); an unknown attribute is a refusal. Two of the three
 * attributes are pure functions of the criteria document and the candidate's
 * documented cadence class — the candidate supplies no number that enters the sort.
 * The terminal key is identity, appended by this module rather than declared, so the
 * order is TOTAL by construction (provider-product pairs are unique, DR-4.3) and no
 * declared tuple can leave a tie for a human to break.
 *
 * Ranks are `1..N` contiguous unique integers — the floor the frozen assembly layer
 * enforces ([assemble.js:51](lab/acquisition/assemble.js)) and the uniqueness the
 * frozen selection rule refuses without ([selection-rule.js:46](lab/census/selection-rule.js)).
 *
 * PURE: no network, no filesystem, no clock.
 *
 * @module lab/survey/rank
 */

import { REFUSAL_REASONS as R, refuse } from './refusal.js';
import { RANK_ATTRIBUTES, TERMINAL_TIE_BREAK, isDerivedValue } from './criteria.js';

const COUNT_SURFACE_CRITERION = 'C-A-count-surface';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** Locale-free lexicographic comparison — deterministic on every runtime leg. */
function lexCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/**
 * Derive the criterion-derived rank attributes for one surveyed candidate.
 *
 * `count_surface_class` is the class the §(a) criterion verdict records; the cadence
 * attributes are looked up in the criteria's own derived cadence table, so they carry
 * the worksheet's provenance rather than anything the candidate asserts.
 *
 * @param {Object} p
 * @param {Object} p.entry - a `surveyed[]` entry
 * @param {Object} p.criteria - the validated criteria machine block
 * @returns {{count_surface_class:string, cadence_obs_interval_seconds:number, history_band_margin_days:number}}
 */
export function deriveRankAttributes({ entry, criteria }) {
  const key = entry?.candidate_key ?? `${entry?.provider}/${entry?.product}`;

  const countVerdict = entry?.criteria_verdicts?.[COUNT_SURFACE_CRITERION];
  const count_surface_class = countVerdict?.count_surface_class;
  const registry = criteria?.rank_attribute_registry?.count_surface_class;
  const ordering = Array.isArray(registry?.ordering) ? registry.ordering : null;
  if (!ordering) {
    refuse(R.RANK_ATTRIBUTE_UNRESOLVABLE, 'criteria declare no ordering for count_surface_class', { candidate_key: key });
  }
  if (!ordering.includes(count_surface_class)) {
    refuse(R.RANK_ATTRIBUTE_UNRESOLVABLE,
      `count_surface_class "${count_surface_class}" is not one of the criteria-declared classes`,
      { candidate_key: key, declared: ordering });
  }

  const cadenceClass = entry?.authored_gate_values?.cadence?.value;
  const row = (criteria?.cadence_classes ?? []).find(c => c.cadence_class === cadenceClass);
  if (!row) {
    refuse(R.RANK_ATTRIBUTE_UNRESOLVABLE,
      `documented cadence class "${cadenceClass}" is not a criteria-declared cadence class`,
      { candidate_key: key });
  }
  if (!isDerivedValue(row.obs_interval_seconds) || !isDerivedValue(row.band_margin_days)) {
    refuse(R.RANK_ATTRIBUTE_UNRESOLVABLE, `cadence class "${cadenceClass}" carries no provenanced band values`, { candidate_key: key });
  }

  return {
    count_surface_class,
    cadence_obs_interval_seconds: row.obs_interval_seconds.value,
    history_band_margin_days: row.band_margin_days.value,
  };
}

/**
 * Build the comparator for the criteria-declared sort-key tuple, terminated by the
 * mandatory lexicographic `(provider, product)` key.
 *
 * @param {Object} criteria - validated criteria machine block (must be Gate-P-fixed)
 * @returns {(a:Object, b:Object) => number}
 */
export function buildComparator(criteria) {
  const rf = criteria?.rank_function;
  if (!isPlainObject(rf) || !Array.isArray(rf.sort_keys)) {
    refuse(R.RANK_ATTRIBUTE_UNKNOWN, 'criteria declare no rank_function.sort_keys — the rank function is an operator decision fixed at Gate P (UD-C6-1)');
  }
  const tb = rf.terminal_tie_break;
  if (!isPlainObject(tb)
    || tb.comparator !== TERMINAL_TIE_BREAK.comparator
    || tb.direction !== TERMINAL_TIE_BREAK.direction
    || String(tb.attributes) !== String(TERMINAL_TIE_BREAK.attributes)) {
    refuse(R.RANK_TIE_BREAK_INVALID, 'the terminal tie-break must be exactly lexicographic ascending (provider, product)', { declared: tb });
  }

  const keys = rf.sort_keys.map((k) => {
    const spec = RANK_ATTRIBUTES[k.attribute];
    if (!spec) {
      refuse(R.RANK_ATTRIBUTE_UNKNOWN,
        `rank attribute "${k.attribute}" is not in the criterion-derived registry — a ranking key may never be candidate-authored`,
        { declared: k.attribute, registry: Object.keys(RANK_ATTRIBUTES) });
    }
    const ordering = spec.type === 'enum'
      ? (criteria.rank_attribute_registry?.[k.attribute]?.ordering ?? null)
      : null;
    return { attribute: k.attribute, direction: k.direction, type: spec.type, ordering };
  });

  return (a, b) => {
    for (const k of keys) {
      const av = a.rank_attributes[k.attribute];
      const bv = b.rank_attributes[k.attribute];
      let c;
      if (k.type === 'enum') c = k.ordering.indexOf(av) - k.ordering.indexOf(bv);
      else c = av < bv ? -1 : av > bv ? 1 : 0;
      if (c !== 0) return k.direction === 'desc' ? -c : c;
    }
    // Terminal key: identity. Total because (provider, product) pairs are unique.
    const p = lexCompare(a.provider, b.provider);
    if (p !== 0) return p;
    return lexCompare(a.product, b.product);
  };
}

/**
 * Assign contiguous unique ranks `1..N` to the admitted set.
 *
 * @param {Object} p
 * @param {Array<{candidate_key:string, provider:string, product:string, rank_attributes:Object}>} p.admitted
 * @param {Object} p.criteria - validated, Gate-P-fixed criteria machine block
 * @returns {Array<{rank:number, candidate_key:string, provider:string, product:string, rank_attributes:Object}>}
 */
export function assignRanks({ admitted, criteria }) {
  if (!Array.isArray(admitted)) refuse(R.SURVEY_RECORD_INVALID, 'admitted must be an array', { got: typeof admitted });
  const compare = buildComparator(criteria);

  const ordered = admitted.slice().sort(compare);
  for (let i = 1; i < ordered.length; i++) {
    if (compare(ordered[i - 1], ordered[i]) === 0) {
      refuse(R.RANK_NOT_TOTAL,
        `the declared rank function plus the terminal tie-break left "${ordered[i - 1].candidate_key}" and "${ordered[i].candidate_key}" indistinguishable`,
        { a: ordered[i - 1].candidate_key, b: ordered[i].candidate_key });
    }
  }

  return ordered.map((c, i) => ({
    rank: i + 1,
    candidate_key: c.candidate_key,
    provider: c.provider,
    product: c.product,
    rank_attributes: c.rank_attributes,
  }));
}

/**
 * Structural check that a rank sequence is `1..N` contiguous, unique, integral, and
 * >= 1 — the frozen contracts' floor, asserted rather than assumed.
 *
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateRankSequence(ranked) {
  const problems = [];
  if (!Array.isArray(ranked)) return { valid: false, problems: ['ranked must be an array'] };
  const ranks = ranked.map(r => r.rank);
  for (const r of ranks) {
    if (!Number.isInteger(r) || r < 1) problems.push(`rank ${r} is not an integer >= 1`);
  }
  if (new Set(ranks).size !== ranks.length) problems.push('ranks are not unique');
  const sorted = ranks.slice().sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) { problems.push(`ranks are not contiguous 1..${ranks.length} (found ${sorted[i]} at position ${i + 1})`); break; }
  }
  return { valid: problems.length === 0, problems };
}
