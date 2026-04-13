/**
 * src/index.js
 * ForgeConstruct — entrypoint for the FORGE pipeline.
 *
 * Usage (fixture analysis):
 *   import { ForgeConstruct } from './src/index.js';
 *   const forge = new ForgeConstruct();
 *   const result = await forge.analyze('fixtures/usgs-m4.5-day.json');
 *   console.log(result.envelope);        // Proposal IR envelope
 *   console.log(result.proposals);       // raw proposals
 *
 * Usage (with theatre lifecycle):
 *   const forge = new ForgeConstruct();
 *   const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
 *     feed_id: 'usgs_m4.5_day',
 *     instantiate: true,
 *   });
 *   console.log(forge.getRuntime().getState());
 *   console.log(forge.getCertificates());
 *
 * Pipeline:
 *   fixture file → ingestFile → classify → selectTemplates → emit IR → [instantiate → lifecycle]
 *
 * @module index
 */

import { readFileSync }    from 'node:fs';
import { ingestFile }      from './ingester/generic.js';
import { ingest }          from './ingester/generic.js';
import { classify }        from './classifier/feed-grammar.js';
import { selectTemplates } from './selector/template-selector.js';
import { emitEnvelope }    from './ir/emit.js';
import { ForgeRuntime }    from './runtime/lifecycle.js';

// ─── ForgeConstruct ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ForgeResult
 * @property {import('./classifier/feed-grammar.js').FeedProfile} feed_profile
 * @property {import('./selector/template-selector.js').Proposal[]} proposals
 * @property {Object} envelope  - Proposal IR envelope (spec/proposal-ir.json)
 * @property {string[]} [theatre_ids] - IDs of instantiated theatres (if instantiate: true)
 * @property {Object} log
 */

/**
 * ForgeConstruct — orchestrates the full FORGE pipeline with optional
 * theatre lifecycle management.
 *
 * Two modes:
 *   1. Classification only (default): analyze → proposals + IR envelope
 *   2. Full lifecycle (instantiate: true): analyze → proposals → running theatres → certificates
 *
 * State: ForgeRuntime accumulates theatres and RLMF certificates across calls.
 */
export class ForgeConstruct {
  /** @type {ForgeRuntime} */
  #runtime;

  constructor() {
    this.#runtime = new ForgeRuntime();
  }

  /**
   * Analyze a feed fixture and return proposals + IR envelope.
   *
   * Runs the full pipeline:
   *   ingestFile → classify → selectTemplates → emitEnvelope
   *
   * When options.instantiate is true, also creates running theatres
   * from the proposals and wires them into the ForgeRuntime.
   *
   * @param {string} fixturePath - Path to a JSON fixture file
   * @param {Object} [options]
   * @param {string} [options.feed_id]          - Feed identifier for IR envelope
   * @param {boolean} [options.instantiate=false] - Create running theatres from proposals
   * @param {boolean} [options.score_usefulness=false] - Run economic filter
   * @param {Object} [options.source_metadata]  - Source provenance for IR envelope
   * @param {boolean} [options.receipt=false]    - When true, generate a ProposalReceipt
   * @param {number}  [options.timestampBase=null] - Fixed timestamp base for deterministic ingestion
   * @param {number}  [options.now]              - Fixed wall-clock for emitEnvelope (deterministic envelope)
   * @param {boolean} [options.deterministic=false] - Require explicit timestampBase and now (fail-closed)
   * @param {Function} [options.sign]            - Signing function for receipt
   * @returns {Promise<ForgeResult>}
   */
  async analyze(fixturePath, options = {}) {
    const {
      feed_id          = fixturePath,
      instantiate      = false,
      score_usefulness = false,
      source_metadata  = null,
      receipt          = false,
      timestampBase    = null,
      now              = undefined,
      sign             = null,
      deterministic    = false,
    } = options;

    if (deterministic && (timestampBase == null || now === undefined)) {
      throw new Error('deterministic mode requires explicit timestampBase and now');
    }

    // Read raw input before ingestion when receipt is requested
    const rawInput = receipt ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

    const events       = timestampBase != null
      ? ingest(rawInput ?? JSON.parse(readFileSync(fixturePath, 'utf8')), { timestampBase })
      : ingestFile(fixturePath);
    const feed_profile = classify(events);
    const proposals    = selectTemplates(feed_profile);

    const emitOpts = {
      feed_id,
      feed_profile,
      proposals,
      source_metadata,
      score_usefulness,
    };
    if (now !== undefined) emitOpts.now = now;
    if (receipt && rawInput != null) {
      emitOpts.rawInput = rawInput;
      emitOpts.receipt = true;
      emitOpts.sign = sign;
    }

    const emitResult = emitEnvelope(emitOpts);

    // When receipt mode, emitEnvelope returns { envelope, receipt }
    const envelope = receipt ? emitResult.envelope : emitResult;

    const log = {
      fixture:            fixturePath,
      event_count:        events.length,
      proposals_count:    proposals.length,
      templates_proposed: proposals.map(p => p.template),
    };

    const result = { feed_profile, proposals, envelope, log };
    if (receipt) {
      result.receipt = emitResult.receipt;
    }

    // Optionally instantiate theatres
    if (instantiate) {
      result.theatre_ids = this.#runtime.instantiate(proposals, { feed_id });
      log.theatres_instantiated = result.theatre_ids.length;
    }

    return result;
  }

  /**
   * Get the underlying ForgeRuntime for direct theatre management.
   *
   * Use this to:
   *   - Ingest bundles:     forge.getRuntime().ingestBundle(bundle)
   *   - Settle theatres:    forge.getRuntime().settle(id, outcome, opts)
   *   - Check expiries:     forge.getRuntime().checkExpiries()
   *   - Inspect state:      forge.getRuntime().getState()
   *
   * @returns {ForgeRuntime}
   */
  getRuntime() {
    return this.#runtime;
  }

  /**
   * Return all accumulated RLMF certificates.
   * Delegates to the runtime. Returns a defensive copy.
   *
   * @returns {Object[]} RLMF certificates
   */
  getCertificates() {
    return this.#runtime.getCertificates();
  }

  /**
   * Flush certificates after RLMF pipeline has consumed them.
   * @returns {number} Number of certificates flushed
   */
  flushCertificates() {
    return this.#runtime.flushCertificates();
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

// IR
export { emitEnvelope } from './ir/emit.js';

// Receipt
export { buildReceipt } from './receipt/receipt-builder.js';
export { toInTotoStatement } from './receipt/to-intoto.js';

// Runtime
export { ForgeRuntime } from './runtime/lifecycle.js';

// Theatres
export { createThresholdGate, processThresholdGate, expireThresholdGate, resolveThresholdGate } from './theatres/threshold-gate.js';
export { createCascade, processCascade, expireCascade, resolveCascade }                         from './theatres/cascade.js';
export { createDivergence, processDivergence, expireDivergence, resolveDivergence }             from './theatres/divergence.js';
export { createRegimeShift, processRegimeShift, expireRegimeShift, resolveRegimeShift }         from './theatres/regime-shift.js';
export { createAnomaly, processAnomaly, expireAnomaly, resolveAnomaly }                         from './theatres/anomaly.js';
export { createPersistence, processPersistence, expirePersistence, resolvePersistence }          from './theatres/persistence.js';

// Adapter
export { USGSLiveAdapter, classifyUSGSFeed } from './adapter/usgs-live.js';
