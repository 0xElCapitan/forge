/**
 * lab/survey/admit.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-N3/N5/N8, C6-FR-P4(g)/(h)/(k); SDD DR-4.3, DR-4.4,
 * DR-4.5; Sprint Plan T2.3). Mechanical admission: the criteria conjunction plus the
 * C6-FR-N8 selection-relevance probe, over exact `(provider, product)` identity.
 *
 * ── Admission is a conjunction, never a judgment ─────────────────────────────
 *
 * A candidate is admitted iff **every** candidate-scope criterion verdict recorded in
 * the survey record is `pass` AND the candidate is selection-relevant. There is no
 * discretionary step, no weighting, and no override: `deriveAdmission` reads recorded
 * verdicts and computes. A missing verdict is a refusal, not a default.
 *
 * ── The N8 probe is the frozen rule, reused — not reimplemented (DR-4.5) ─────
 *
 * Selection relevance asks: *could this candidate be primary or reserve under the most
 * favorable lawful completion of its not-yet-measured fields?* The probe builds
 *
 *     { ...FAVORABLE_CENSUS_STANDIN, ...authored gate values, provider, product }
 *
 * — the SAME overlay order the invariance layer's Tier-2 exclusion uses
 * ([invariance.js:137](lab/resolution/invariance.js)) — and runs it through the frozen
 * `applySelectionRule`. Because both sides call the same frozen function with the same
 * composition rule, admission-time and invariance-time cannot drift; a conformance
 * spec asserts agreement on shared fixtures.
 *
 * `eligibility.js` is never imported (G9): eligibility is probed only through
 * `applySelectionRule`, exactly as the invariance layer does it.
 *
 * PURE: no network, no filesystem, no clock.
 *
 * @module lab/survey/admit
 */

import { applySelectionRule } from '../census/selection-rule.js';

import { REFUSAL_REASONS as R, refuse } from './refusal.js';
import { AUTHORED_GATE_VALUE_KEYS, CANDIDATE_CRITERION_IDS } from './criteria.js';

/**
 * The most-favorable completion of the census-measured fields, byte-equal to the
 * frozen invariance stand-in `lab/resolution/fixtures/hypothetical-eligible.json`
 * (minus its `_label`). The authored gate values overlay this, so in practice only
 * `n_observations`, `history_years`, and `span` survive from here — the three fields
 * the census measures and a survey may never know.
 *
 * It is restated as a literal rather than imported because the survey lane may not
 * import the apparatus namespace (DR-4.7). The conformance spec asserts byte equality
 * against the frozen fixture, so the restatement cannot drift.
 */
export const FAVORABLE_CENSUS_STANDIN = Object.freeze({
  n_observations: 1000000,
  history_years: 100,
  span: Object.freeze({ start_ms: 0, end_ms: 3155760000000 }),
  cadence: 'hourly',
  authority_published: true,
  public: true,
  machine_readable: true,
  free: true,
  exogeneity_judgment: 'HYPOTHETICAL-BRANCH: invariance enumeration only',
  exogenous: true,
  mechanical_outcome_declared: true,
  revision_vintage_documented: true,
});

/** The frozen hard gate whose failure the burned-list criterion (§h) mirrors. */
const BURNED_GATE = 'burned';
const BURNED_CRITERION_ID = 'C-H-burned-list-disjointness';

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * The deterministic candidate identity (DR-4.3): the exact `(provider, product)`
 * string pair, joined — the same granularity gate 5 joins the burned list on and
 * reconciliation matches on. No slug, no normalization, no case folding.
 *
 * @returns {string} `<provider>/<product>`
 */
export function candidateKey({ provider, product }) {
  if (!isNonEmptyString(provider) || !isNonEmptyString(product)) {
    refuse(R.CANDIDATE_IDENTITY_INVALID, 'candidate identity requires non-empty provider and product strings',
      { provider: typeof provider, product: typeof product });
  }
  return `${provider}/${product}`;
}

/** Extract the plain authored value map from the survey record's evidence-bearing form. */
export function authoredValueMap(entry) {
  const src = entry?.authored_gate_values;
  if (!isPlainObject(src)) {
    refuse(R.AUTHORED_GATE_VALUE_MISSING, 'authored_gate_values block is missing', { candidate_key: entry?.candidate_key });
  }
  const out = {};
  for (const k of AUTHORED_GATE_VALUE_KEYS) {
    const cell = src[k];
    if (!isPlainObject(cell) || !('value' in cell)) {
      refuse(R.AUTHORED_GATE_VALUE_MISSING, `authored gate value "${k}" is missing`, { candidate_key: entry?.candidate_key, key: k });
    }
    if (!isNonEmptyString(cell.standard_ref)) {
      refuse(R.AUTHORED_GATE_STANDARD_REF_MISSING,
        `authored gate value "${k}" carries no standard_ref into the criteria §(k) standards (C6-FR-P4(k))`,
        { candidate_key: entry?.candidate_key, key: k });
    }
    if (!isPlainObject(cell.citation) || !isNonEmptyString(cell.citation.document)) {
      refuse(R.AUTHORED_GATE_STANDARD_REF_MISSING,
        `authored gate value "${k}" carries no citation — every authored value is a citation standard, never a judgment call`,
        { candidate_key: entry?.candidate_key, key: k });
    }
    out[k] = cell.value;
  }
  for (const k of Object.keys(src)) {
    if (!AUTHORED_GATE_VALUE_KEYS.includes(k)) {
      refuse(R.AUTHORED_GATE_VALUE_MISSING, `authored_gate_values declares unknown key "${k}"`, { candidate_key: entry?.candidate_key, key: k });
    }
  }
  return out;
}

/**
 * The C6-FR-N8 selection-relevance probe — a single-candidate run of the FROZEN rule
 * over the most-favorable lawful completion (DR-4.5).
 *
 * @param {{provider:string, product:string, authored:Object}} p
 * @param {{entries:Array<{provider:string, product:string}>}} burnedList - frozen authority
 * @returns {{selection_relevant:boolean, probe:string, failed_gate:string|null, failed_hard_gates:string[]}}
 */
export function probeSelectionRelevance({ provider, product, authored }, burnedList) {
  const metadata = { ...FAVORABLE_CENSUS_STANDIN, ...authored, provider, product };
  const result = applySelectionRule([{ rank: 1, provider, product, metadata }], burnedList);
  const ev = result.evaluations[0];
  return {
    selection_relevant: ev.eligible === true,
    probe: 'frozen-rule-single-candidate',
    failed_gate: ev.eligible ? null : (ev.failed_hard_gates[0] ?? null),
    failed_hard_gates: ev.failed_hard_gates.slice(),
  };
}

/**
 * Derive one candidate's admission from its recorded verdicts. Deterministic and
 * total: every path either returns a verdict or refuses.
 *
 * @param {Object} p
 * @param {Object} p.entry - one `surveyed[]` entry from the survey record
 * @param {Object} p.burnedList - the frozen burned-list authority
 * @returns {{candidate_key:string, provider:string, product:string,
 *            criteria_conjunction:{satisfied:boolean, failed_criteria:string[]},
 *            selection_relevance:Object, survey_status:string, rejection_criterion:string|null}}
 */
export function deriveAdmission({ entry, burnedList }) {
  const provider = entry?.provider;
  const product = entry?.product;
  const key = candidateKey({ provider, product });
  if (isNonEmptyString(entry.candidate_key) && entry.candidate_key !== key) {
    refuse(R.CANDIDATE_IDENTITY_INVALID,
      `candidate_key "${entry.candidate_key}" is not the exact (provider, product) join "${key}"`,
      { recorded: entry.candidate_key, derived: key });
  }

  const verdicts = entry.criteria_verdicts;
  if (!isPlainObject(verdicts)) {
    refuse(R.CRITERION_VERDICT_MISSING, 'criteria_verdicts block is missing', { candidate_key: key });
  }
  const failed_criteria = [];
  for (const id of CANDIDATE_CRITERION_IDS) {
    const v = verdicts[id];
    if (!isPlainObject(v) || (v.verdict !== 'pass' && v.verdict !== 'fail')) {
      refuse(R.CRITERION_VERDICT_MISSING, `criterion "${id}" has no pass/fail verdict`, { candidate_key: key, criterion_id: id });
    }
    if (!isPlainObject(v.citation) || !isNonEmptyString(v.citation.document)) {
      refuse(R.CRITERION_VERDICT_MISSING, `criterion "${id}" verdict carries no citation (C6-FR-N3)`, { candidate_key: key, criterion_id: id });
    }
    if (v.verdict === 'fail') failed_criteria.push(id);
  }
  for (const id of Object.keys(verdicts)) {
    if (!CANDIDATE_CRITERION_IDS.includes(id)) {
      refuse(R.CRITERION_VERDICT_MISSING, `criteria_verdicts declares unknown criterion "${id}"`, { candidate_key: key, criterion_id: id });
    }
  }

  const authored = authoredValueMap(entry);
  const selection_relevance = probeSelectionRelevance({ provider, product, authored }, burnedList);

  // §(h) cross-check: the recorded burned-list verdict must agree with the frozen
  // gate-5 result the probe already computed on true identity (DR-4.5).
  const probeSaysBurned = selection_relevance.failed_hard_gates.includes(BURNED_GATE);
  const recordedSaysClean = verdicts[BURNED_CRITERION_ID].verdict === 'pass';
  if (probeSaysBurned === recordedSaysClean) {
    refuse(R.REDERIVATION_DIVERGENCE,
      `recorded "${BURNED_CRITERION_ID}" verdict disagrees with the frozen gate-5 join on true identity`,
      { candidate_key: key, recorded: verdicts[BURNED_CRITERION_ID].verdict, frozen_gate_5_burned: probeSaysBurned });
  }

  const conjunctionSatisfied = failed_criteria.length === 0;
  const admittedNow = conjunctionSatisfied && selection_relevance.selection_relevant;

  return {
    candidate_key: key,
    provider,
    product,
    criteria_conjunction: { satisfied: conjunctionSatisfied, failed_criteria },
    selection_relevance,
    survey_status: admittedNow ? 'SURVEYED_ADMITTED' : 'SURVEYED_REJECTED',
    rejection_criterion: admittedNow ? null
      : (failed_criteria.length > 0 ? failed_criteria[0] : `authored-gate:${selection_relevance.failed_gate}`),
  };
}

/**
 * Derive admission for a whole surveyed set. Duplicate `(provider, product)` identity
 * is a refusal, never a merge or a last-wins (DR-4.3).
 *
 * @param {Object} p
 * @param {Array<Object>} p.surveyed - every consulted provider-product (C6-FR-N3 completeness)
 * @param {Object} p.burnedList
 * @returns {{admissions:Array<Object>, admitted_count:number, selection_relevant_count:number}}
 */
export function deriveAdmissions({ surveyed, burnedList }) {
  if (!Array.isArray(surveyed)) {
    refuse(R.SURVEY_RECORD_INVALID, 'surveyed must be an array', { got: typeof surveyed });
  }
  const seen = new Map();
  const admissions = [];
  for (const entry of surveyed) {
    const a = deriveAdmission({ entry, burnedList });
    if (seen.has(a.candidate_key)) {
      refuse(R.DUPLICATE_CANDIDATE_KEY,
        `duplicate candidate identity "${a.candidate_key}" — provider-product identity must be unique across the survey (DR-4.3)`,
        { candidate_key: a.candidate_key, first_index: seen.get(a.candidate_key) });
    }
    seen.set(a.candidate_key, admissions.length);
    admissions.push(a);
  }
  const admittedSet = admissions.filter(a => a.survey_status === 'SURVEYED_ADMITTED');
  // `selection_relevant_count` counts POOL members, not every surveyed candidate: the
  // Gate-P minimum is satisfied by selection-relevant POOL members alone (C6-FR-N8).
  // Because admission already requires selection relevance, the two counts must be
  // equal — asserted here rather than assumed, so a future change to the admission
  // rule that silently admitted a non-selection-relevant member would refuse.
  const selection_relevant_count = admittedSet.filter(a => a.selection_relevance.selection_relevant).length;
  if (selection_relevant_count !== admittedSet.length) {
    refuse(R.REDERIVATION_DIVERGENCE,
      'an admitted candidate is not selection-relevant — admission and C6-FR-N8 have diverged',
      { admitted: admittedSet.length, selection_relevant: selection_relevant_count });
  }
  return { admissions, admitted_count: admittedSet.length, selection_relevant_count };
}
