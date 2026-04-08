/**
 * TREMOR — Threshold Resolution & Earth Movement Oracle
 *
 * Construct entrypoint. Manages the polling loop, theatre lifecycle,
 * and RLMF certificate export.
 *
 * Usage:
 *   import { TremorConstruct } from './index.js';
 *   const tremor = new TremorConstruct();
 *   tremor.start();
 */

import { pollAndIngest } from './oracles/usgs.js';
import { crossValidateEMSC } from './oracles/emsc.js';
import { crossValidateGEOFON } from './oracles/geofon.js';
import { createMagnitudeGate, processMagnitudeGate, expireMagnitudeGate } from './theatres/mag-gate.js';
import { createOracleDivergence, resolveOracleDivergence } from './theatres/paradox.js';
import { createAftershockCascade, processAftershockCascade, resolveAftershockCascade } from './theatres/aftershock.js';
import { createSwarmWatch, processSwarmWatch, expireSwarmWatch } from './theatres/swarm.js';
import { createDepthRegime, processDepthRegime, expireDepthRegime } from './theatres/depth.js';
import { exportCertificate, writeCertificate, certificateIdFor } from './rlmf/certificates.js';

export class TremorConstruct {
  constructor(config = {}) {
    this.constructId = config.constructId ?? 'TREMOR';
    this.feedType = config.feedType ?? 'm4.5_hour';
    this.pollIntervalMs = config.pollIntervalMs ?? 60_000;
    this.enableCrossValidation = config.enableCrossValidation ?? false;
    // Directory for atomic/idempotent certificate writes. If null, writes are
    // in-memory only (used in tests that don't need disk persistence).
    this.certificatesDir = config.certificatesDir ?? null;

    // State
    this.theatres = new Map();      // id → theatre
    this.revisionHistories = new Map(); // eventId → [{timestamp, mag, magType, status}]
    this.processedEvents = new Set();   // `${id}-${updated}` dedup keys
    this.certificates = [];            // exported RLMF certs (in-memory)
    this.pollTimer = null;             // setTimeout handle (single-flight)
    this.running = false;
    this._pollInFlight = false;
    // Theatres whose resolution was detected but whose certificate export
    // failed. Each entry: { theatre, reason, last_error, attempts }.
    this.pendingExports = [];

    // Routing decisions (volcanic skip, etc.) — capped at 100 most recent.
    this._routingDecisions = [];

    // Stats / observability
    this.stats = {
      polls: 0,
      bundles_ingested: 0,
      theatres_created: 0,
      theatres_resolved: 0,
      certificates_exported: 0,
      skipped_poll_count: 0,
      consecutive_poll_failures: 0,
      last_successful_poll: null,
    };
  }

  // =========================================================================
  // Theatre management
  // =========================================================================

  /**
   * Register a pre-configured theatre.
   */
  addTheatre(theatre) {
    this.theatres.set(theatre.id, theatre);
    this.stats.theatres_created++;
    console.log(`[TREMOR] Theatre added: ${theatre.id}`);
  }

  /**
   * Create and register a Magnitude Gate theatre.
   */
  openMagnitudeGate(params) {
    const theatre = createMagnitudeGate(params);
    this.addTheatre(theatre);
    return theatre;
  }

  /**
   * Create and register an Aftershock Cascade theatre.
   * Auto-called on M≥6.0 detections.
   */
  openAftershockCascade(params) {
    const result = createAftershockCascade(params);
    if (result?.skipped) return result;
    if (result) this.addTheatre(result);
    return result;
  }

  /**
   * Create and register a Swarm Watch theatre.
   */
  openSwarmWatch(params) {
    const theatre = createSwarmWatch(params);
    this.addTheatre(theatre);
    return theatre;
  }

  /**
   * Create and register a Depth Regime theatre.
   */
  openDepthRegime(params) {
    const theatre = createDepthRegime(params);
    if (theatre) this.addTheatre(theatre);
    return theatre;
  }

  /**
   * Get all active theatres as an array (for the ingestion config).
   */
  getActiveTheatres() {
    return Array.from(this.theatres.values()).filter(
      (t) => t.state === 'open' || t.state === 'provisional_hold'
    );
  }

  /**
   * Check for expired theatres and resolve them.
   * Certificate export happens BEFORE the theatre is marked resolved, so
   * an export failure leaves the theatre in its prior state and registers
   * a pending-export entry for retry.
   */
  checkExpiries() {
    const now = Date.now();
    for (const [id, theatre] of this.theatres) {
      if (theatre.state !== 'open') continue;
      if (now < theatre.closes_at) continue;

      let expired;
      switch (theatre.template) {
        case 'magnitude_gate':
          expired = expireMagnitudeGate(theatre);
          break;
        case 'aftershock_cascade':
          expired = resolveAftershockCascade(theatre);
          break;
        case 'swarm_watch':
          expired = expireSwarmWatch(theatre);
          break;
        case 'depth_regime':
          expired = expireDepthRegime(theatre);
          break;
        default:
          expired = { ...theatre, state: 'expired', resolved_at: Date.now() };
      }

      if (expired.state === 'resolved') {
        // Gate state transition behind successful export (fix 1c).
        const ok = this._tryExport(expired, theatre.state);
        if (ok) {
          this.theatres.set(id, expired);
          console.log(`[TREMOR] Theatre expired: ${id} → outcome=${expired.outcome}`);
        }
      } else {
        // Non-resolved terminal state (e.g. 'expired' with null outcome).
        this.theatres.set(id, expired);
        console.log(`[TREMOR] Theatre expired: ${id} → outcome=${expired.outcome}`);
      }
    }
  }

  // =========================================================================
  // Core loop
  // =========================================================================

  /**
   * Single poll cycle: fetch feed → build bundles → process theatres.
   *
   * Single-flight: the public start() loop will never invoke poll() while
   * a prior poll is in flight. poll() itself is still safe to call directly
   * (tests do); concurrent direct calls are the caller's responsibility.
   */
  async poll() {
    // Retry any previously failed exports first.
    this._retryPendingExports();

    let result;
    try {
      const config = {
        activeTheatres: this.getActiveTheatres(),
        revisionHistories: this.revisionHistories,
        crossValidation: null,
      };

      result = await pollAndIngest(this.feedType, config, this.processedEvents);
      this.stats.polls++;
      this.stats.bundles_ingested += result.bundles.length;
      this.stats.last_successful_poll = Date.now();
      this.stats.consecutive_poll_failures = 0;
    } catch (err) {
      this.stats.consecutive_poll_failures++;
      const level = this.stats.consecutive_poll_failures >= 3 ? 'error' : 'warn';
      const msg =
        `[TREMOR:${level}] Poll failed ` +
        `(consecutive_failures=${this.stats.consecutive_poll_failures}, feed=${this.feedType}): ` +
        `${err.message}`;
      if (level === 'error') console.error(msg);
      else console.warn(msg);
      // Do not retry within this poll cycle — next scheduled poll is the retry.
      return { bundles: [], skipped: 0, unmatched: 0, error: err.message };
    }

    for (const bundle of result.bundles) {
      // Cross-validate with EMSC + GEOFON if enabled
      if (this.enableCrossValidation && bundle.evidence_class === 'provisional') {
        // TODO: queue/batch in production to respect rate limits
        const featureLike = {
          properties: {
            mag: bundle.payload.magnitude.value,
            time: bundle.payload.event_time,
          },
          geometry: {
            coordinates: [
              bundle.payload.location.longitude,
              bundle.payload.location.latitude,
              bundle.payload.location.depth_km,
            ],
          },
        };

        const [emscSettled, geofonSettled] = await Promise.allSettled([
          crossValidateEMSC(featureLike),
          crossValidateGEOFON(featureLike),
        ]);

        const emsc = emscSettled.status === 'fulfilled' ? emscSettled.value : null;
        const geofon = geofonSettled.status === 'fulfilled' ? geofonSettled.value : null;

        if (emsc || geofon) {
          const sources = [
            ...(emsc   ? emsc.sources_checked   : []),
            ...(geofon ? geofon.sources_checked : []),
          ];
          const divergences = [
            emsc?.max_divergence ?? null,
            geofon?.divergence   ?? null,
          ].filter((d) => d !== null);

          bundle.cross_validation = {
            sources_checked: sources,
            max_divergence: divergences.length > 0
              ? Math.round(Math.max(...divergences) * 10000) / 10000
              : 0,
            paradox_flag: divergences.some((d) => d >= 0.3),
            emsc:   emsc   ?? null,
            geofon: geofon ?? null,
          };
        }
      }

      // Auto-spawn Oracle Divergence theatres for automatic M4.5+ events
      if (
        bundle.evidence_class === 'provisional' &&
        bundle.payload.magnitude.value >= 4.5
      ) {
        const divergeTheatre = createOracleDivergence(bundle);
        if (divergeTheatre) {
          this.addTheatre(divergeTheatre);
        }
      }

      // Auto-spawn Aftershock Cascade for M≥6.0 events.
      // Idempotent guard: if we already have an aftershock cascade for this
      // mainshock event, don't spawn a duplicate. Combined with single-flight
      // polling, this is defense in depth against double-spawn on retry.
      if (bundle.payload.magnitude.value >= 6.0) {
        const existingCascade = Array.from(this.theatres.values()).find(
          (t) => t.template === 'aftershock_cascade' &&
                 t.mainshock?.event_id === bundle.payload.event_id,
        );
        if (!existingCascade) {
          const cascadeResult = createAftershockCascade({
            mainshockBundle: bundle,
          });
          if (cascadeResult?.skipped) {
            // Record routing decision in machine-readable state.
            // Conservative policy: do not auto-spawn Swarm Watch — log
            // the recommendation and leave the decision to the operator.
            const routeDecision = {
              event_id: bundle.payload.event_id,
              timestamp: new Date().toISOString(),
              reason: cascadeResult.reason,
              detail: cascadeResult.detail,
              swarm_watch_recommended: cascadeResult.detail?.routeTo === 'swarm_watch',
              manual_review_required: cascadeResult.detail?.manualReview ?? false,
            };
            this._routingDecisions.push(routeDecision);
            // Retention: keep most recent 100 decisions only
            if (this._routingDecisions.length > 100) {
              this._routingDecisions = this._routingDecisions.slice(-100);
            }
            console.info(
              `[TREMOR] Cascade skipped (${cascadeResult.reason}) — ` +
              `Swarm Watch recommended for event ${bundle.payload.event_id}`,
            );
          } else if (cascadeResult) {
            this.addTheatre(cascadeResult);
          }
        }
      }

      // Process against all matching theatres
      for (const theatreId of bundle.theatre_refs) {
        const theatre = this.theatres.get(theatreId);
        if (!theatre) continue;

        let updated;
        switch (theatre.template) {
          case 'magnitude_gate':
            updated = processMagnitudeGate(theatre, bundle);
            break;
          case 'oracle_divergence':
            if (bundle.evidence_class === 'ground_truth') {
              updated = resolveOracleDivergence(theatre, bundle);
            } else {
              updated = theatre;
            }
            break;
          case 'aftershock_cascade':
            updated = processAftershockCascade(theatre, bundle);
            break;
          case 'swarm_watch':
            updated = processSwarmWatch(theatre, bundle);
            break;
          case 'depth_regime':
            updated = processDepthRegime(theatre, bundle);
            break;
          default:
            updated = theatre;
        }

        // If theatre just resolved, attempt export BEFORE committing state
        // (fix 1c). Export failure leaves the theatre in its prior state and
        // queues a pending retry.
        if (updated.state === 'resolved' && theatre.state !== 'resolved') {
          const ok = this._tryExport(updated, theatre.state);
          if (ok) {
            this.theatres.set(theatreId, updated);
          }
          // On failure, do not commit the 'resolved' transition.
          // We also don't commit intermediate bundle-processing state here to
          // keep "one event → one resolution" invariant under retry.
        } else {
          this.theatres.set(theatreId, updated);
        }
      }
    }

    // Check for expired theatres
    this.checkExpiries();

    return result;
  }

  /**
   * Attempt to export a certificate for a resolved theatre.
   *
   * Returns true on success (including the idempotent "already on disk" case),
   * false on failure. Failures are queued for retry in pendingExports.
   *
   * @param {object} theatre - Theatre transitioning to resolved
   * @param {string} priorState - State before the resolution attempt
   */
  _tryExport(theatre, priorState) {
    try {
      const cert = exportCertificate(theatre, { construct_id: this.constructId });

      // Atomic + idempotent disk write (fix 1a + 1c).
      let writeResult = { written: false, skipped: false };
      if (this.certificatesDir) {
        writeResult = writeCertificate(cert, this.certificatesDir);
      }

      // Only after the (possibly-skipped) write succeeds do we record the
      // cert in memory. For in-memory-only mode (no certificatesDir), we
      // still dedupe by cert.certificate_id to preserve the invariant.
      const alreadyInMemory = this.certificates.some(
        (c) => c.certificate_id === cert.certificate_id,
      );
      if (!alreadyInMemory && !writeResult.skipped) {
        this.certificates.push(cert);
        this.stats.certificates_exported++;
      }
      this.stats.theatres_resolved++;

      // Remove any previously queued pending-export for this theatre.
      this.pendingExports = this.pendingExports.filter(
        (p) => p.theatre.id !== theatre.id,
      );

      const tag = writeResult.skipped ? 'skipped-idempotent' : 'written';
      console.log(
        `[TREMOR] Certificate ${tag}: ${cert.certificate_id} ` +
        `brier=${cert.performance.brier_score} ` +
        `outcome=${theatre.outcome}`,
      );
      return true;
    } catch (err) {
      console.error(
        `[TREMOR] Certificate export failed for ${theatre.id}: ${err.message}`,
      );
      // Queue for retry. Store the pre-resolved view so we can re-attempt
      // on the next poll cycle.
      const existing = this.pendingExports.find((p) => p.theatre.id === theatre.id);
      if (existing) {
        existing.attempts++;
        existing.last_error = err.message;
      } else {
        this.pendingExports.push({
          theatre,
          prior_state: priorState,
          last_error: err.message,
          attempts: 1,
        });
      }
      return false;
    }
  }

  /**
   * Retry any exports that failed on a prior poll cycle.
   */
  _retryPendingExports() {
    if (this.pendingExports.length === 0) return;
    const queue = this.pendingExports.slice();
    for (const entry of queue) {
      const ok = this._tryExport(entry.theatre, entry.prior_state);
      if (ok) {
        // Commit the resolved state on successful retry.
        this.theatres.set(entry.theatre.id, entry.theatre);
      }
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start the polling loop (single-flight: schedule next poll only after the
   * current poll fully completes, eliminating overlap at the source — fix 1a).
   */
  start() {
    if (this.running) throw new Error('TREMOR is already running');
    this.running = true;

    console.log(
      `[TREMOR] Starting. Feed: ${this.feedType}, ` +
      `interval: ${this.pollIntervalMs}ms, ` +
      `theatres: ${this.theatres.size}, ` +
      `cross-validation: ${this.enableCrossValidation}`,
    );

    const tick = async () => {
      if (!this.running) return;
      if (this._pollInFlight) {
        this.stats.skipped_poll_count++;
        console.warn('[TREMOR] Poll tick fired while prior poll still in flight — skipped.');
      } else {
        this._pollInFlight = true;
        try {
          await this.poll();
        } catch (err) {
          // poll() handles its own errors, but defense in depth.
          console.error('[TREMOR] Unhandled poll error:', err.message);
        } finally {
          this._pollInFlight = false;
        }
      }
      if (this.running) {
        this.pollTimer = setTimeout(tick, this.pollIntervalMs);
      }
    };

    // Kick off first poll on next tick.
    this.pollTimer = setTimeout(tick, 0);
  }

  /**
   * Stop the polling loop.
   */
  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
      console.log('[TREMOR] Stopped.');
    }
  }

  /**
   * Get current construct state for debugging / health checks.
   */
  getState() {
    const theatresByState = {};
    for (const t of this.theatres.values()) {
      theatresByState[t.state] = (theatresByState[t.state] ?? 0) + 1;
    }

    return {
      construct: this.constructId,
      running: this.running,
      stats: this.stats,
      theatres: {
        total: this.theatres.size,
        by_state: theatresByState,
      },
      tracked_events: this.revisionHistories.size,
      processed_revisions: this.processedEvents.size,
      certificates_exported: this.certificates.length,
      skipped_poll_count: this.stats.skipped_poll_count,
      consecutive_poll_failures: this.stats.consecutive_poll_failures,
      last_successful_poll: this.stats.last_successful_poll,
      pending_exports: this.pendingExports.map((p) => ({
        theatre_id: p.theatre.id,
        attempts: p.attempts,
        last_error: p.last_error,
      })),
      routing_decisions: this._routingDecisions,
    };
  }

  /**
   * Get all exported certificates (for RLMF pipeline consumption).
   */
  getCertificates() {
    return this.certificates;
  }

  /**
   * Flush certificates (after RLMF pipeline has consumed them).
   */
  flushCertificates() {
    const flushed = this.certificates.length;
    this.certificates = [];
    return flushed;
  }
}

// Re-export components for granular use
export { pollAndIngest } from './oracles/usgs.js';
export { crossValidateEMSC } from './oracles/emsc.js';
export { crossValidateGEOFON } from './oracles/geofon.js';
export { buildBundle } from './processor/bundles.js';
export { computeQuality } from './processor/quality.js';
export { buildMagnitudeUncertainty, thresholdCrossingProbability } from './processor/magnitude.js';
export { assessStatusFlip } from './processor/settlement.js';
export { findRegion, REGION_PROFILES } from './processor/regions.js';
export { createMagnitudeGate, processMagnitudeGate, expireMagnitudeGate } from './theatres/mag-gate.js';
export { createOracleDivergence, resolveOracleDivergence } from './theatres/paradox.js';
export { createAftershockCascade, processAftershockCascade, resolveAftershockCascade } from './theatres/aftershock.js';
export { createSwarmWatch, processSwarmWatch, expireSwarmWatch, computeBValue } from './theatres/swarm.js';
export { createDepthRegime, processDepthRegime, expireDepthRegime, ZONE_PROFILES } from './theatres/depth.js';
export { exportCertificate, writeCertificate, certificateIdFor, brierScoreBinary, brierScoreMultiClass } from './rlmf/certificates.js';
