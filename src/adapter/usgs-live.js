/**
 * src/adapter/usgs-live.js
 * USGS live feed adapter — real-time polling for FORGE.
 *
 * Fetches the USGS GeoJSON earthquake feed, deduplicates against seen events,
 * and routes new/updated events through the full FORGE pipeline:
 *   fetch → ingest → classify → select → emit IR envelope
 *
 * Optionally wires into a ForgeRuntime for theatre lifecycle management.
 *
 * Security model (adversarial checks):
 *   Adapters do NOT perform adversarial checks directly. Instead, they build
 *   EvidenceBundles and route them to ForgeRuntime.ingestBundle(), which runs
 *   checkAdversarial() on EVERY bundle before processing. This ensures:
 *     - All adapters (USGS, SWPC, future) share the same adversarial gate
 *     - The gate is in the runtime, not per-adapter (single enforcement point)
 *     - Flagged bundles are rejected and logged, never reaching theatres
 *   See: src/runtime/lifecycle.js → ingestBundle() → checkAdversarial()
 *
 * Fetch resilience:
 *   Uses #fetchWithRetry() — per-attempt timeout (15s), exponential backoff
 *   (1s, 2s), max 2 retries. Malformed JSON and HTTP errors are caught and
 *   logged without crashing the polling loop.
 *
 * Feed URLs:
 *   M4.5+ past hour:  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson
 *   M2.5+ past hour:  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson
 *   M4.5+ past day:   https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson
 *   All past hour:    https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson
 *
 * Zero external dependencies. Uses Node.js built-in fetch (Node 18+).
 *
 * @module adapter/usgs-live
 */

import { ingest }           from '../ingester/generic.js';
import { classify }         from '../classifier/feed-grammar.js';
import { selectTemplates }  from '../selector/template-selector.js';
import { emitEnvelope }     from '../ir/emit.js';
import { buildBundle }      from '../processor/bundles.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const FEED_URLS = {
  'm4.5_hour': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson',
  'm2.5_hour': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson',
  'm4.5_day':  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  'all_hour':  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
};

const DEFAULT_FEED    = 'm4.5_hour';
const DEFAULT_POLL_MS = 60_000;  // 60 seconds (USGS updates every ~60s)

// ─── USGSLiveAdapter ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} PollResult
 * @property {number}   fetched_at     - Unix ms when feed was fetched
 * @property {number}   event_count    - Total events in the feed
 * @property {number}   new_events     - Events not previously seen
 * @property {number}   updated_events - Events with updated properties
 * @property {Object}   envelope       - ProposalEnvelope (IR spec)
 * @property {Object[]} bundles        - EvidenceBundles for new/updated events
 */

export class USGSLiveAdapter {
  /** @type {string} */
  #feedType;

  /** @type {string} */
  #feedUrl;

  /** @type {number} */
  #pollIntervalMs;

  /** @type {Set<string>} event dedup keys: `${id}-${updated}` */
  #seen;

  /** @type {NodeJS.Timeout|null} */
  #pollTimer;

  /** @type {import('../runtime/lifecycle.js').ForgeRuntime|null} */
  #runtime;

  /** @type {Function|null} onPoll callback */
  #onPoll;

  /** @type {Object} */
  #stats;

  /**
   * @param {Object} [config]
   * @param {string} [config.feedType='m4.5_hour'] - Feed type key
   * @param {number} [config.pollIntervalMs=60000] - Poll interval
   * @param {import('../runtime/lifecycle.js').ForgeRuntime} [config.runtime] - Optional runtime for theatre lifecycle
   * @param {Function} [config.onPoll] - Callback after each poll: (result: PollResult) => void
   */
  constructor(config = {}) {
    this.#feedType       = config.feedType ?? DEFAULT_FEED;
    this.#feedUrl        = FEED_URLS[this.#feedType] ?? FEED_URLS[DEFAULT_FEED];
    this.#pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.#runtime        = config.runtime ?? null;
    this.#onPoll         = config.onPoll ?? null;
    this.#seen           = new Set();
    this.#pollTimer      = null;
    this.#stats          = {
      polls: 0,
      total_events_fetched: 0,
      new_events: 0,
      updated_events: 0,
      errors: 0,
    };
  }

  // ─── Core polling ──────────────────────────────────────────────────────────

  /**
   * Fetch with timeout and retry (exponential backoff).
   *
   * @param {string} url
   * @param {Object} [opts]
   * @param {number} [opts.timeoutMs=15000]  - Per-attempt timeout
   * @param {number} [opts.retries=2]        - Max retry attempts
   * @returns {Promise<Object>} Parsed JSON
   */
  async #fetchWithRetry(url, { timeoutMs = 15_000, retries = 2 } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
      } catch (err) {
        lastError = err;

        if (attempt < retries) {
          const backoff = Math.min(1000 * 2 ** attempt, 10_000);
          console.warn(
            `[USGSLiveAdapter] Fetch attempt ${attempt + 1} failed: ${err.message}. ` +
            `Retrying in ${backoff}ms...`
          );
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    throw lastError;
  }

  /**
   * Perform a single poll cycle.
   *
   * 1. Fetch USGS GeoJSON feed (with timeout + retry)
   * 2. Deduplicate against seen events
   * 3. Ingest + classify + select templates
   * 4. Emit IR envelope
   * 5. Build evidence bundles for new/updated events
   * 6. If runtime attached, route bundles to theatres
   *
   * @returns {Promise<PollResult>}
   */
  async poll() {
    const fetched_at = Date.now();
    this.#stats.polls++;

    // 1. Fetch with timeout and retry
    const data = await this.#fetchWithRetry(this.#feedUrl);

    // 2. Deduplicate
    const features = data.features ?? [];
    this.#stats.total_events_fetched += features.length;

    const newFeatures     = [];
    const updatedFeatures = [];

    for (const feature of features) {
      const id      = feature.id ?? feature.properties?.code ?? '';
      const updated = feature.properties?.updated ?? feature.properties?.time ?? 0;
      const key     = `${id}-${updated}`;

      if (this.#seen.has(key)) continue;

      // Check if we've seen this event ID with a different update timestamp
      const idPrefix = `${id}-`;
      const isUpdate = [...this.#seen].some(k => k.startsWith(idPrefix));

      this.#seen.add(key);

      if (isUpdate) {
        updatedFeatures.push(feature);
        this.#stats.updated_events++;
      } else {
        newFeatures.push(feature);
        this.#stats.new_events++;
      }
    }

    // 3. Classify the full feed (all events, not just new — profile needs full context)
    const events       = ingest(data);
    const feed_profile = classify(events);
    const proposals    = selectTemplates(feed_profile);

    // 4. Emit IR envelope
    const envelope = emitEnvelope({
      feed_id: `usgs_${this.#feedType}`,
      feed_profile,
      proposals,
      source_metadata: {
        source_id:       'usgs_automatic',
        trust_tier:      'T1',
        endpoint:        this.#feedUrl,
        poll_interval_ms: this.#pollIntervalMs,
        event_count:     features.length,
      },
      score_usefulness: true,
    });

    // 5. Build evidence bundles for new/updated events
    const allNew = [...newFeatures, ...updatedFeatures];
    const bundles = allNew.map(feature => {
      const mag       = feature.properties?.mag ?? 0;
      const timestamp = feature.properties?.time ?? Date.now();
      const status    = feature.properties?.status ?? 'automatic';

      return buildBundle(
        { value: mag, timestamp },
        {
          tier:      status === 'reviewed' ? 'T0' : 'T1',
          source_id: status === 'reviewed' ? 'usgs_reviewed' : 'usgs_automatic',
          now:       fetched_at,
        },
      );
    });

    // 6. Route bundles to runtime if attached
    if (this.#runtime && bundles.length > 0) {
      for (const bundle of bundles) {
        this.#runtime.ingestBundle(bundle);
      }
      this.#runtime.checkExpiries({ now: fetched_at });
    }

    const result = {
      fetched_at,
      event_count:    features.length,
      new_events:     newFeatures.length,
      updated_events: updatedFeatures.length,
      envelope,
      bundles,
    };

    if (this.#onPoll) {
      try { this.#onPoll(result); } catch (e) {
        console.error('[USGSLiveAdapter] onPoll callback error:', e.message);
      }
    }

    return result;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the polling loop.
   * @returns {Promise<PollResult>} Result of the initial poll
   */
  async start() {
    if (this.#pollTimer) throw new Error('USGSLiveAdapter is already running');

    console.log(
      `[USGSLiveAdapter] Starting. Feed: ${this.#feedType}, ` +
      `interval: ${this.#pollIntervalMs}ms, ` +
      `runtime: ${this.#runtime ? 'attached' : 'none'}`
    );

    // Initial poll
    const initial = await this.poll();

    // Recurring poll
    this.#pollTimer = setInterval(() => {
      this.poll().catch(err => {
        this.#stats.errors++;
        console.error('[USGSLiveAdapter] Poll error:', err.message);
      });
    }, this.#pollIntervalMs);

    return initial;
  }

  /**
   * Stop the polling loop.
   */
  stop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
      console.log('[USGSLiveAdapter] Stopped.');
    }
  }

  /**
   * Check if the adapter is currently polling.
   * @returns {boolean}
   */
  isRunning() {
    return this.#pollTimer !== null;
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Get adapter statistics.
   * @returns {Object}
   */
  getStats() {
    return { ...this.#stats };
  }

  /**
   * Get feed configuration.
   * @returns {{ feedType: string, feedUrl: string, pollIntervalMs: number }}
   */
  getConfig() {
    return {
      feedType:       this.#feedType,
      feedUrl:        this.#feedUrl,
      pollIntervalMs: this.#pollIntervalMs,
    };
  }

  /**
   * Get number of seen events (dedup set size).
   * @returns {number}
   */
  getSeenCount() {
    return this.#seen.size;
  }
}

// ─── Convenience: one-shot classification ────────────────────────────────────

/**
 * Fetch and classify a USGS feed once (no polling loop).
 * Useful for testing and one-off analysis.
 *
 * @param {string} [feedType='m4.5_hour']
 * @returns {Promise<Object>} ProposalEnvelope
 */
export async function classifyUSGSFeed(feedType = 'm4.5_hour') {
  const adapter = new USGSLiveAdapter({ feedType });
  const result  = await adapter.poll();
  return result.envelope;
}
