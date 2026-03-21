/**
 * src/selector/template-selector.js
 * Rule-based template selector — maps FeedProfile to Theatre template proposals.
 *
 * Evaluation model:
 *   1. Each rule in RULES is evaluated against the FeedProfile.
 *   2. A rule fires when ALL of its conditions are met.
 *   3. Fired rules produce proposals; each proposal carries the rule's params,
 *      confidence, and traced_to rationale.
 *   4. Proposals are returned sorted: confidence desc → specificity desc →
 *      traced_to count desc → lexical rule ID asc.
 *
 * The caller (convergence test / scoring loop) receives the proposals array
 * and passes it to the scorer. The scorer's greedy algorithm handles optimal
 * assignment of proposals to expected templates.
 *
 * @module selector/template-selector
 */

import { RULES } from './rules.js';

// ─── Condition evaluation ─────────────────────────────────────────────────────

/**
 * Retrieve a nested value from an object using a dot-separated path.
 *
 * @param {Object} profile  - FeedProfile (or any object)
 * @param {string} fieldPath - Dot-separated path, e.g. 'noise.classification'
 * @returns {any} The value at the path, or undefined if not found
 */
export function getField(profile, fieldPath) {
  const parts = fieldPath.split('.');
  let obj = profile;
  for (const part of parts) {
    if (obj == null) return undefined;
    obj = obj[part];
  }
  return obj;
}

/**
 * Evaluate a single condition against a field value.
 *
 * @param {any}    fieldValue - Value extracted from FeedProfile
 * @param {import('./rules.js').Condition} condition
 * @returns {boolean}
 */
function evaluateCondition(fieldValue, condition) {
  const { operator, value } = condition;
  switch (operator) {
    case 'equals': return fieldValue === value;
    case 'in':     return Array.isArray(value) && value.includes(fieldValue);
    case 'gt':     return typeof fieldValue === 'number' && fieldValue > value;
    case 'lt':     return typeof fieldValue === 'number' && fieldValue < value;
    case 'gte':    return typeof fieldValue === 'number' && fieldValue >= value;
    case 'lte':    return typeof fieldValue === 'number' && fieldValue <= value;
    default:       return false;
  }
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against a FeedProfile.
 *
 * @param {Object}                  profile - FeedProfile from classifier
 * @param {import('./rules.js').Rule} rule
 * @returns {{ conditions_met: number, conditions_total: number, confidence: number, fired: boolean }}
 */
export function evaluateRule(profile, rule) {
  const conditions_total = rule.conditions.length;
  let conditions_met = 0;

  for (const cond of rule.conditions) {
    const val = getField(profile, cond.field);
    if (evaluateCondition(val, cond)) conditions_met++;
  }

  const fired = conditions_met === conditions_total;
  return { conditions_met, conditions_total, confidence: rule.confidence, fired };
}

// ─── Proposal sorting ─────────────────────────────────────────────────────────

/**
 * Compare two (rule, evaluation) pairs for sort order.
 * Priority: confidence desc → specificity desc → traced_to count desc → lexical ID asc.
 *
 * @param {{ rule: import('./rules.js').Rule }} a
 * @param {{ rule: import('./rules.js').Rule }} b
 * @returns {number}
 */
function compareProposals(a, b) {
  // 1. Confidence desc
  if (b.rule.confidence !== a.rule.confidence) {
    return b.rule.confidence - a.rule.confidence;
  }
  // 2. Specificity (condition count) desc
  if (b.rule.conditions.length !== a.rule.conditions.length) {
    return b.rule.conditions.length - a.rule.conditions.length;
  }
  // 3. traced_to count desc
  if (b.rule.traced_to.length !== a.rule.traced_to.length) {
    return b.rule.traced_to.length - a.rule.traced_to.length;
  }
  // 4. Lexical ID asc
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Proposal
 * @property {string} template    - Template type name
 * @property {Object} params      - Template parameters
 * @property {number} confidence  - 0–1 rule confidence
 * @property {string} rationale   - Human-readable justification
 */

/**
 * Select Theatre templates from a FeedProfile using the production rule set.
 *
 * All rules in RULES are evaluated. Fired rules produce proposals which are
 * returned sorted by confidence (desc), then specificity, then traced_to count,
 * then lexical rule ID. The scorer's greedy algorithm handles assignment.
 *
 * @param {import('../classifier/feed-grammar.js').FeedProfile} profile
 * @returns {Proposal[]}
 */
export function selectTemplates(profile) {
  const fired = [];

  for (const rule of RULES) {
    const evaluation = evaluateRule(profile, rule);
    if (evaluation.fired) {
      fired.push({ rule, evaluation });
    }
  }

  fired.sort(compareProposals);

  return fired.map(({ rule, evaluation }) => ({
    template:   rule.template,
    params:     { ...rule.params },
    confidence: evaluation.confidence,
    rationale:  `Rule '${rule.id}' fired (${evaluation.conditions_total}/${evaluation.conditions_total} conditions). ` +
                `Traced to: ${rule.traced_to.join(', ')}.`,
  }));
}
