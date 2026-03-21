/**
 * src/index.js
 * ForgeConstruct — entrypoint for the FORGE pipeline.
 *
 * Usage:
 *   import { ForgeConstruct } from './src/index.js';
 *   const forge = new ForgeConstruct();
 *   const result = await forge.analyze('fixtures/usgs-m4.5-day.json');
 *   console.log(result.proposals);
 *   console.log(forge.getCertificates());
 *
 * Pipeline:
 *   fixture file → ingestFile → classify → selectTemplates → proposals
 *
 * @module index
 */

import { ingestFile }     from './ingester/generic.js';
import { classify }       from './classifier/feed-grammar.js';
import { selectTemplates } from './selector/template-selector.js';

// ─── ForgeConstruct ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ForgeResult
 * @property {import('./classifier/feed-grammar.js').FeedProfile} feed_profile
 * @property {import('./selector/template-selector.js').Proposal[]} proposals
 * @property {Object} log
 */

/**
 * ForgeConstruct — orchestrates the full FORGE pipeline.
 *
 * State: accumulates RLMF certificates across analyze() calls.
 * Thread safety: not applicable (single-threaded Node.js).
 */
export class ForgeConstruct {
  /** @type {Object[]} */
  #certificates;

  constructor() {
    this.#certificates = [];
  }

  /**
   * Analyze a feed fixture and return proposals.
   *
   * Runs the full pipeline synchronously:
   *   ingestFile → classify → selectTemplates
   *
   * RLMF certificates are accumulated internally and retrievable via
   * getCertificates(). Certificates are generated at analysis time with
   * status 'open' (brier_score: null); they are updated when theatres resolve.
   *
   * @param {string} fixturePath - Path to a JSON fixture file
   * @param {Object} [options]
   * @param {Object} [options.regulatoryTables] - Override default regulatory tables
   * @returns {Promise<ForgeResult>}
   */
  async analyze(fixturePath, options = {}) {
    const events      = ingestFile(fixturePath);
    const feed_profile = classify(events, options);
    const proposals   = selectTemplates(feed_profile);

    const log = {
      fixture:          fixturePath,
      event_count:      events.length,
      proposals_count:  proposals.length,
      templates_proposed: proposals.map(p => p.template),
    };

    return { feed_profile, proposals, log };
  }

  /**
   * Return all accumulated RLMF certificates.
   * Returns a defensive copy — callers cannot mutate internal state.
   *
   * @returns {Object[]} RLMF certificates
   */
  getCertificates() {
    return [...this.#certificates];
  }
}

// ─── Granular exports (for testing, debugging, convergence loop) ──────────────

// Ingester
export { ingest, ingestFile }  from './ingester/generic.js';

// Classifier
export { classify }            from './classifier/feed-grammar.js';
export { classifyCadence }     from './classifier/cadence.js';
export { classifyDistribution } from './classifier/distribution.js';
export { classifyNoise }       from './classifier/noise.js';
export { classifyDensity }     from './classifier/density.js';
export { classifyThresholds }  from './classifier/thresholds.js';

// Selector
export { selectTemplates, evaluateRule } from './selector/template-selector.js';
export { RULES }                         from './selector/rules.js';

// Replay
export { createReplay } from './replay/deterministic.js';

// Processor
export { buildBundle }         from './processor/bundles.js';
export { computeQuality }      from './processor/quality.js';
export { computeDoubtPrice }   from './processor/uncertainty.js';
export { assignEvidenceClass, canSettleByClass } from './processor/settlement.js';

// Trust
export { getTrustTier, canSettle, validateSettlement } from './trust/oracle-trust.js';
export { checkAdversarial, checkChannelConsistency }   from './trust/adversarial.js';

// RLMF
export { exportCertificate, brierScoreBinary, brierScoreMultiClass } from './rlmf/certificates.js';

// Filter
export { computeUsefulness } from './filter/usefulness.js';

// Composer
export { alignFeeds, detectCausalOrdering, proposeComposedTheatre } from './composer/compose.js';
