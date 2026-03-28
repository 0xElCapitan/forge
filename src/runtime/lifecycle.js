/**
 * src/runtime/lifecycle.js
 * ForgeRuntime — theatre lifecycle orchestrator.
 *
 * Bridges the gap between FORGE's proposal output and running theatres.
 * Modelled after TremorConstruct and CoronaConstruct's proven lifecycle
 * patterns, but generalized across all six theatre templates.
 *
 * Lifecycle:
 *   proposals → instantiate → process (per bundle) → check expiry → resolve → export certificate
 *
 * Design decisions:
 *   - Immutable theatre state (each process/resolve returns a new object)
 *   - Theatre dispatch by template type (no switch chains — uses a factory map)
 *   - Certificate accumulation with flush (matches TREMOR pattern)
 *   - Injectable clock for deterministic testing
 *
 * @module runtime/lifecycle
 */

import {
  createThresholdGate, processThresholdGate,
  expireThresholdGate, resolveThresholdGate,
} from '../theatres/threshold-gate.js';

import {
  createCascade, processCascade,
  expireCascade, resolveCascade,
} from '../theatres/cascade.js';

import {
  createDivergence, processDivergence,
  expireDivergence, resolveDivergence,
} from '../theatres/divergence.js';

import {
  createRegimeShift, processRegimeShift,
  expireRegimeShift, resolveRegimeShift,
} from '../theatres/regime-shift.js';

import {
  createAnomaly, processAnomaly,
  expireAnomaly, resolveAnomaly,
} from '../theatres/anomaly.js';

import {
  createPersistence, processPersistence,
  expirePersistence, resolvePersistence,
} from '../theatres/persistence.js';

import { exportCertificate }   from '../rlmf/certificates.js';
import { validateSettlement }  from '../trust/oracle-trust.js';
import { checkAdversarial }    from '../trust/adversarial.js';

// ─── Theatre factory map ─────────────────────────────────────────────────────

/**
 * Maps template type → { create, process, expire, resolve } functions.
 * Adding a new theatre type requires only adding an entry here.
 */
const THEATRE_OPS = {
  threshold_gate: {
    create:  createThresholdGate,
    process: processThresholdGate,
    expire:  expireThresholdGate,
    resolve: resolveThresholdGate,
  },
  cascade: {
    create:  createCascade,
    process: processCascade,
    expire:  expireCascade,
    resolve: resolveCascade,
  },
  divergence: {
    create:  createDivergence,
    process: processDivergence,
    expire:  expireDivergence,
    resolve: resolveDivergence,
  },
  regime_shift: {
    create:  createRegimeShift,
    process: processRegimeShift,
    expire:  expireRegimeShift,
    resolve: resolveRegimeShift,
  },
  anomaly: {
    create:  createAnomaly,
    process: processAnomaly,
    expire:  expireAnomaly,
    resolve: resolveAnomaly,
  },
  persistence: {
    create:  createPersistence,
    process: processPersistence,
    expire:  expirePersistence,
    resolve: resolvePersistence,
  },
};

// ─── ID generation ───────────────────────────────────────────────────────────

let _idCounter = 0;

/** Generate a unique theatre ID. */
function generateId(template, clock = Date.now) {
  return `${template}-${clock()}-${++_idCounter}`;
}

// ─── ForgeRuntime ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RuntimeStats
 * @property {number} theatres_created
 * @property {number} theatres_resolved
 * @property {number} theatres_expired
 * @property {number} bundles_processed
 * @property {number} bundles_rejected
 * @property {number} certificates_exported
 */

/**
 * ForgeRuntime orchestrates the full theatre lifecycle.
 *
 * Usage:
 *   const runtime = new ForgeRuntime();
 *   const ids = runtime.instantiate(proposals);
 *   runtime.ingestBundle(bundle);
 *   runtime.checkExpiries();
 *   const certs = runtime.getCertificates();
 */
export class ForgeRuntime {
  /** @type {Map<string, Object>} theatre_id → theatre state */
  #theatres;

  /** @type {Object[]} accumulated RLMF certificates */
  #certificates;

  /** @type {RuntimeStats} */
  #stats;

  /** @type {Function} injectable clock */
  #clock;

  constructor({ clock = () => Date.now() } = {}) {
    this.#theatres    = new Map();
    this.#certificates = [];
    this.#clock       = clock;
    this.#stats       = {
      theatres_created:     0,
      theatres_resolved:    0,
      theatres_expired:     0,
      bundles_processed:    0,
      bundles_rejected:     0,
      certificates_exported: 0,
    };
  }

  // ─── Instantiation ─────────────────────────────────────────────────────────

  /**
   * Instantiate theatres from an array of proposals.
   *
   * Each proposal becomes a running theatre with an assigned ID.
   * Unknown template types are silently skipped (logged).
   *
   * @param {Object[]} proposals - From selectTemplates() or IR envelope
   * @param {Object} [opts]
   * @param {string} [opts.feed_id]    - Feed ID for tracing
   * @param {number} [opts.now]        - Override clock
   * @returns {string[]} IDs of created theatres
   */
  instantiate(proposals, opts = {}) {
    const now = opts.now ?? this.#clock();
    const ids = [];

    for (const proposal of proposals) {
      const ops = THEATRE_OPS[proposal.template];
      if (!ops) {
        console.warn(`[ForgeRuntime] Unknown template '${proposal.template}' — skipped`);
        continue;
      }

      const id = generateId(proposal.template, this.#clock);
      const theatre = ops.create(proposal.params, { now });

      // Attach runtime metadata (not part of the theatre template's domain)
      const managed = {
        ...theatre,
        _id:         id,
        _feed_id:    opts.feed_id ?? null,
        _confidence: proposal.confidence,
        _rationale:  proposal.rationale ?? null,
        _created_by: 'forge',
      };

      this.#theatres.set(id, managed);
      this.#stats.theatres_created++;
      ids.push(id);
    }

    return ids;
  }

  // ─── Bundle processing ─────────────────────────────────────────────────────

  /**
   * Ingest an evidence bundle into all matching open theatres.
   *
   * Matching logic:
   *   - If bundle.theatre_refs is non-empty, route only to those IDs
   *   - Otherwise, route to ALL open theatres (broadcast)
   *
   * Adversarial checks run before processing. Rejected bundles
   * increment bundles_rejected and are not routed.
   *
   * @param {Object} bundle - EvidenceBundle from buildBundle()
   * @param {Object} [adversarialCtx] - Context for adversarial checks
   * @returns {{ processed: number, rejected: boolean, reason?: string }}
   */
  ingestBundle(bundle, adversarialCtx = {}) {
    // Adversarial check — use runtime clock for timestamp validation
    const ctx = { now: this.#clock(), ...adversarialCtx };
    const adv = checkAdversarial(bundle, ctx);
    if (!adv.clean) {
      this.#stats.bundles_rejected++;
      return { processed: 0, rejected: true, reason: adv.reason };
    }

    // Snapshot critical fields at ingestion time (RT-10: validation-at-ingestion)
    // Downstream code uses the snapshot, not the mutable original
    const ingested = {
      ...bundle,
      _snapshot: {
        quality:        bundle.quality,
        evidence_class: bundle.evidence_class,
        doubt_price:    bundle.doubt_price,
        source_id:      bundle.source_id,
      },
    };

    // Determine target theatres
    const targets = (Array.isArray(ingested.theatre_refs) && ingested.theatre_refs.length > 0)
      ? ingested.theatre_refs
      : [...this.#theatres.keys()];

    let processed = 0;

    for (const id of targets) {
      const theatre = this.#theatres.get(id);
      if (!theatre || theatre.status !== 'open') continue;

      const ops = THEATRE_OPS[theatre.template];
      if (!ops) continue;

      const updated = ops.process(theatre, ingested);

      // Preserve runtime metadata
      this.#theatres.set(id, { ...updated, _id: theatre._id, _feed_id: theatre._feed_id,
        _confidence: theatre._confidence, _rationale: theatre._rationale, _created_by: theatre._created_by });

      processed++;
    }

    this.#stats.bundles_processed += processed;
    return { processed, rejected: false };
  }

  // ─── Expiry ────────────────────────────────────────────────────────────────

  /**
   * Check all open theatres for expiry and expire/resolve as needed.
   *
   * @param {Object} [opts]
   * @param {number} [opts.now] - Override clock
   * @returns {string[]} IDs of theatres that expired
   */
  checkExpiries(opts = {}) {
    const now = opts.now ?? this.#clock();
    const expired = [];

    for (const [id, theatre] of this.#theatres) {
      if (theatre.status !== 'open') continue;
      if (now < theatre.expires_at) continue;

      const ops = THEATRE_OPS[theatre.template];
      if (!ops) continue;

      const result = ops.expire(theatre, { now });
      this.#theatres.set(id, { ...result, _id: theatre._id, _feed_id: theatre._feed_id,
        _confidence: theatre._confidence, _rationale: theatre._rationale, _created_by: theatre._created_by });

      if (result.status === 'expired') {
        this.#stats.theatres_expired++;
      } else if (result.status === 'resolved') {
        this.#stats.theatres_resolved++;
        this._exportCert(id);
      }

      expired.push(id);
    }

    return expired;
  }

  // ─── Settlement ────────────────────────────────────────────────────────────

  /**
   * Resolve a theatre with a definitive outcome (oracle settlement).
   *
   * Enforces trust tier: only T0/T1 sources may settle.
   *
   * @param {string}  theatreId
   * @param {boolean|number} outcome    - true/false for binary; count for cascade
   * @param {Object}  [opts]
   * @param {string}  [opts.source_id]  - Source requesting settlement
   * @param {string}  [opts.settlement_class='oracle']
   * @param {number}  [opts.now]
   * @returns {{ settled: boolean, reason?: string }}
   */
  settle(theatreId, outcome, opts = {}) {
    const theatre = this.#theatres.get(theatreId);
    if (!theatre || theatre.status !== 'open') {
      return { settled: false, reason: `theatre '${theatreId}' is not open` };
    }

    // Trust tier enforcement — fail-closed: source_id is REQUIRED for settlement
    if (!opts.source_id) {
      return { settled: false, reason: 'source_id is required for settlement' };
    }
    const validation = validateSettlement(opts.source_id);
    if (!validation.allowed) {
      return { settled: false, reason: validation.reason };
    }

    const ops = THEATRE_OPS[theatre.template];
    if (!ops) return { settled: false, reason: `unknown template '${theatre.template}'` };

    const now = opts.now ?? this.#clock();
    const settlement_class = opts.settlement_class ?? 'oracle';

    const resolved = ops.resolve(theatre, outcome, settlement_class, { now });
    this.#theatres.set(theatreId, { ...resolved, _id: theatre._id, _feed_id: theatre._feed_id,
      _confidence: theatre._confidence, _rationale: theatre._rationale, _created_by: theatre._created_by });

    this.#stats.theatres_resolved++;
    this._exportCert(theatreId);

    return { settled: true };
  }

  // ─── Certificates ──────────────────────────────────────────────────────────

  /** @private */
  _exportCert(theatreId) {
    const theatre = this.#theatres.get(theatreId);
    if (!theatre) return;

    try {
      const cert = exportCertificate(theatre, { theatre_id: theatreId });
      this.#certificates.push(cert);
      this.#stats.certificates_exported++;
    } catch (err) {
      console.error(`[ForgeRuntime] Certificate export failed for ${theatreId}:`, err.message);
    }
  }

  /**
   * Get all accumulated RLMF certificates (defensive copy).
   * @returns {Object[]}
   */
  getCertificates() {
    return [...this.#certificates];
  }

  /**
   * Flush certificates after RLMF pipeline has consumed them.
   * @returns {number} Number of certificates flushed
   */
  flushCertificates() {
    const count = this.#certificates.length;
    this.#certificates = [];
    return count;
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Get a theatre by ID (defensive copy).
   * @param {string} id
   * @returns {Object|null}
   */
  getTheatre(id) {
    const t = this.#theatres.get(id);
    return t ? { ...t } : null;
  }

  /**
   * Get all open theatre IDs.
   * @returns {string[]}
   */
  getOpenTheatres() {
    return [...this.#theatres.entries()]
      .filter(([, t]) => t.status === 'open')
      .map(([id]) => id);
  }

  /**
   * Get runtime statistics.
   * @returns {RuntimeStats}
   */
  getStats() {
    return { ...this.#stats };
  }

  /**
   * Get full runtime state (for health checks / debugging).
   * @returns {Object}
   */
  getState() {
    const byStatus = {};
    const byTemplate = {};
    for (const t of this.#theatres.values()) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byTemplate[t.template] = (byTemplate[t.template] ?? 0) + 1;
    }

    return {
      theatres: {
        total: this.#theatres.size,
        by_status: byStatus,
        by_template: byTemplate,
      },
      certificates: this.#certificates.length,
      stats: this.getStats(),
    };
  }
}
