/**
 * test/convergence/scorer.js
 * Computes TotalScore from classifier output vs backing specification.
 *
 * TotalScore = TemplateScore + 0.5 × GrammarScore
 *
 * TemplateScore (max = template_count):
 *   For each expected template, find best matching proposal (greedy).
 *   score = template_match × (0.5 + 0.5 × mean(param_field_scores))
 *   False positives (unmatched proposals): -0.5 each
 *
 * GrammarScore (max = 5 per backing spec, 15 total across all 3):
 *   +1 per correct Q classification (Q1-Q5)
 *
 * @module convergence/scorer
 */

// ─── Core params per template type ──────────────────────────────────────────

/** Core required param fields (always scored). */
const CORE_PARAMS = {
  threshold_gate: ['threshold', 'window_hours', 'base_rate'],
  cascade:        ['trigger_threshold', 'bucket_count', 'window_hours'],
  divergence:     ['source_a_type', 'source_b_type', 'divergence_threshold'],
  regime_shift:   ['state_boundary', 'zone_prior'],
  anomaly:        ['baseline_metric', 'sigma_threshold', 'window_hours'],
  persistence:    ['condition_threshold', 'consecutive_count'],
};

/** Context param fields (scored when present in backing spec). */
const CONTEXT_PARAMS = {
  threshold_gate: ['settlement_source', 'input_mode', 'threshold_type'],
  cascade:        ['prior_model'],
  divergence:     ['resolution_mode'],
  regime_shift:   [],
  anomaly:        [],
  persistence:    [],
};

// ─── Param field scoring ─────────────────────────────────────────────────────

/**
 * Get the list of scoreable param fields for a template, given the backing spec params.
 * Core params always included; context params included only if present in spec.
 * @param {string} templateType
 * @param {Object} specParams - Params from backing spec expected_template
 * @returns {string[]}
 */
function getScoredFields(templateType, specParams) {
  // Guard: an unknown template type would silently return an empty field list,
  // which combines with the empty-scores fallback in scoreParams to produce a
  // trivially-perfect score (1.0). Make the gap visible instead of hidden so
  // future template types are explicitly added to CORE_PARAMS before scoring.
  if (!(templateType in CORE_PARAMS)) {
    throw new Error(
      `Unknown template type '${templateType}' — add to CORE_PARAMS before scoring`
    );
  }
  const core = CORE_PARAMS[templateType];
  const ctx = CONTEXT_PARAMS[templateType] ?? [];
  const ctxPresent = ctx.filter(f => specParams[f] !== undefined && specParams[f] !== null);
  return [...core, ...ctxPresent];
}

/**
 * Score a single param field: 1 if proposal value matches spec value, 0 otherwise.
 * null spec values are not scored (considered unspecified).
 * @param {any} specVal
 * @param {any} proposedVal
 * @returns {number}
 */
function scoreParamField(specVal, proposedVal) {
  if (specVal === null || specVal === undefined) return null; // unspecified — skip
  if (proposedVal === null || proposedVal === undefined) return 0;

  // Numeric: accept within 20% or exact
  if (typeof specVal === 'number' && typeof proposedVal === 'number') {
    if (specVal === 0) return proposedVal === 0 ? 1 : 0;
    return Math.abs(proposedVal - specVal) / Math.abs(specVal) <= 0.2 ? 1 : 0;
  }

  // String: case-insensitive exact match
  if (typeof specVal === 'string' && typeof proposedVal === 'string') {
    return specVal.toLowerCase() === proposedVal.toLowerCase() ? 1 : 0;
  }

  // Direct equality
  return specVal === proposedVal ? 1 : 0;
}

/**
 * Compute param match score between a proposal and an expected template.
 * Returns mean of scoreable param fields (null-skipped).
 * @param {string} templateType
 * @param {Object} specParams
 * @param {Object} proposedParams
 * @returns {{ score: number, detail: Object }}
 */
function scoreParams(templateType, specParams, proposedParams) {
  const fields = getScoredFields(templateType, specParams);
  const detail = {};
  const scores = [];

  for (const field of fields) {
    const s = scoreParamField(specParams[field], proposedParams?.[field]);
    if (s !== null) {
      detail[field] = s;
      scores.push(s);
    }
  }

  // When the spec declares all scoreable params as null (e.g. TREMOR
  // regime_shift's state_boundary/zone_prior — under-specified placeholders),
  // there are no fields to grade. Treat that as trivially passing (score 1)
  // rather than trivially failing (score 0): an under-specified spec must not
  // penalize a proposal that correctly identifies the template type.
  const mean = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 1;

  return { score: mean, detail };
}

// ─── Greedy template matching ─────────────────────────────────────────────────

/**
 * Greedily match proposals to expected templates.
 * For each expected template, find the proposal that maximizes param overlap.
 * Each proposal can be assigned to at most one expected template.
 * Proposals not matched are false positives.
 *
 * @param {Object[]} expected - Array of { template, params }
 * @param {Object[]} proposed - Array of { template, params }
 * @returns {Object[]} Match results
 */
function greedyMatch(expected, proposed) {
  // Build score matrix: [i][j] = score of matching expected[i] with proposed[j]
  const matrix = expected.map((exp, i) => {
    return proposed.map((prop, j) => {
      if (prop.template !== exp.template) {
        // Wrong template type — 0 template match
        return { expIdx: i, propIdx: j, templateMatch: 0, paramScore: 0, totalPairScore: 0 };
      }
      const { score: paramScore } = scoreParams(exp.template, exp.params, prop.params);
      const templateScore = 0.5 + 0.5 * paramScore;
      return { expIdx: i, propIdx: j, templateMatch: 1, paramScore, totalPairScore: templateScore };
    });
  });

  // Collect all (i,j) pairs and sort by totalPairScore desc
  const pairs = [];
  for (let i = 0; i < expected.length; i++) {
    for (let j = 0; j < proposed.length; j++) {
      if (matrix[i][j].templateMatch > 0) {
        pairs.push(matrix[i][j]);
      }
    }
  }
  pairs.sort((a, b) => b.totalPairScore - a.totalPairScore);

  // Greedy assignment
  const assignedExp = new Set();
  const assignedProp = new Set();
  const matches = [];

  for (const pair of pairs) {
    if (assignedExp.has(pair.expIdx) || assignedProp.has(pair.propIdx)) continue;
    assignedExp.add(pair.expIdx);
    assignedProp.add(pair.propIdx);
    matches.push(pair);
  }

  return { matches, assignedProp, assignedExp };
}

// ─── Grammar scoring ─────────────────────────────────────────────────────────

const Q_KEYS = ['cadence', 'distribution', 'noise', 'density', 'thresholds'];
const Q_VALUE_FIELDS = {
  cadence:      'classification',
  distribution: 'type',
  noise:        'classification',
  density:      'classification',
  thresholds:   'type',
};

/**
 * Compute GrammarScore: +1 per Q classification that matches the backing spec.
 * @param {Object} profile - FeedProfile from classifier
 * @param {Object} expectedProfile - From backing spec
 * @returns {{ score: number, detail: Object }}
 */
function scoreGrammar(profile, expectedProfile) {
  const detail = {};
  let score = 0;

  for (const q of Q_KEYS) {
    const field = Q_VALUE_FIELDS[q];
    const expected = expectedProfile[q]?.[field];
    const actual = profile?.[q]?.[field];

    const match = expected != null && actual != null &&
      String(expected).toLowerCase() === String(actual).toLowerCase();
    detail[q] = match ? 'match' : 'mismatch';
    if (match) score++;
  }

  return { score, detail };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ScoreResult
 * @property {number} template_score - Raw TemplateScore (before false positive penalty)
 * @property {number} grammar_score  - GrammarScore (0-5 per spec)
 * @property {number} total          - TotalScore = template_score + 0.5 * grammar_score
 * @property {Object} details        - Full breakdown for structured log
 */

/**
 * Compute TotalScore for a single backing spec.
 *
 * @param {Object[]} proposals    - Selector output: [{ template, params }, ...]
 * @param {Object}   profile      - Classifier output: FeedProfile
 * @param {Object}   backingSpec  - Imported spec: { expected_profile, expected_templates }
 * @returns {ScoreResult}
 */
export function score(proposals, profile, backingSpec) {
  const { expected_profile, expected_templates } = backingSpec;
  proposals = proposals ?? [];

  // ── Template scoring ─────────────────────────────────────────────────────

  const { matches, assignedProp, assignedExp } = greedyMatch(
    expected_templates,
    proposals
  );

  // Build per-expected-template results
  const templateDetails = expected_templates.map((exp, i) => {
    const match = matches.find(m => m.expIdx === i);
    if (!match) {
      // False negative
      return {
        expected: exp.template,
        proposed: null,
        params_match: 'none',
        score: 0,
      };
    }
    const prop = proposals[match.propIdx];
    const { score: paramScore, detail } = scoreParams(exp.template, exp.params, prop.params);
    const templateScore = 0.5 + 0.5 * paramScore;
    return {
      expected: exp.template,
      proposed: prop.template,
      params_match: paramScore === 1 ? 'exact' : paramScore > 0 ? 'partial' : 'none',
      param_detail: detail,
      score: templateScore,
    };
  });

  // False positives: proposals not matched to any expected template
  const falsePositives = proposals
    .map((p, j) => ({ template: p.template, idx: j }))
    .filter(({ idx }) => !assignedProp.has(idx));

  const rawTemplateScore = templateDetails.reduce((s, d) => s + d.score, 0);
  const falsePosPenalty = falsePositives.length * 0.5;
  const templateScore = Math.max(0, rawTemplateScore - falsePosPenalty);

  // ── Grammar scoring ───────────────────────────────────────────────────────

  const { score: grammarScore, detail: grammarDetail } =
    scoreGrammar(profile, expected_profile);

  // ── Total ─────────────────────────────────────────────────────────────────

  const total = templateScore + 0.5 * grammarScore;

  return {
    template_score: templateScore,
    grammar_score: grammarScore,
    total,
    details: {
      template_breakdown: templateDetails,
      false_positives: falsePositives.map(fp => fp.template),
      grammar_breakdown: grammarDetail,
      raw_template_score: rawTemplateScore,
      false_positive_penalty: falsePosPenalty,
    },
  };
}
