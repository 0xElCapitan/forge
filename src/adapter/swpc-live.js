/**
 * src/adapter/swpc-live.js
 * SWPC GOES X-ray live feed adapter — real-time polling for FORGE.
 *
 * Fetches the SWPC GOES X-ray flux feed, deduplicates against seen events,
 * and routes new events through the full FORGE pipeline:
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
 * Dedup strategy:
 *   Key: `time_tag|energy` — SWPC returns two readings per minute (one per
 *   energy band: 0.05-0.4nm and 0.1-0.8nm). The full 1-day (or 3-day) window
 *   is returned on every request; dedup ensures only genuinely new readings
 *   reach the pipeline.
 *
 * Feed URLs:
 *   1-day: https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json
 *   3-day: https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json
 *
 * Zero external dependencies. Uses Node.js built-in fetch (Node 18+).
 *
 * @module adapter/swpc-live
 */

import { ingest, classify, selectTemplates, emitEnvelope, buildBundle } from '../index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const FEED_URLS = {
  xrays_1day: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
  xrays_3day: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json',
};

const DEFAULT_FEED    = 'xrays_1day';
const DEFAULT_POLL_MS = 60_000;  // 60 seconds (SWPC updates every ~60s)

// ─── SWPCLiveAdapter ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} PollResult
 * @property {number}   fetched_at   - Unix ms when feed was fetched
 * @property {number}   event_count  - Total records in the feed window
 * @property {number}   new_events   - Records not previously seen (deduplicated)
 * @property {Object}   envelope     - ProposalEnvelope (IR spec)
 * @property {Object[]} bundles      - EvidenceBundles for new records
 */

export class SWPCLiveAdapter {
  /** @type {string} */
  #feedType;

  /** @type {string} */
  #feedUrl;

  /** @type {number} */
  #pollIntervalMs;

  /** @type {Set<string>} dedup keys: `time_tag|energy` */
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
   * @param {string} [config.feedType='xrays_1day']  - Feed type key ('xrays_1day' or 'xrays_3day')
   * @param {number} [config.pollIntervalMs=60000]   - Poll interval in ms
   * @param {import('../runtime/lifecycle.js').ForgeRuntime} [config.runtime] - Optional runtime
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
      errors: 0,
    };
  }

  // ─── Core polling ──────────────────────────────────────────────────────────

  /**
   * Fetch with timeout and retry (exponential backoff).
   *
   * @param {string} url
   * @param {Object} [opts]
   * @param {number} [opts.timeoutMs=15000] - Per-attempt timeout
   * @param {number} [opts.retries=2]       - Max retry attempts
   * @returns {Promise<Object[]>} Parsed JSON array
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
            `[SWPCLiveAdapter] Fetch attempt ${attempt + 1} failed: ${err.message}. ` +
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
   * 1. Fetch SWPC GOES X-ray feed (with timeout + retry)
   * 2. Deduplicate against seen records (key: time_tag|energy)
   * 3. Ingest + classify + select templates
   * 4. Emit IR envelope
   * 5. Build evidence bundles for new records
   * 6. If runtime attached, route bundles to theatres
   *
   * @returns {Promise<PollResult>}
   */
  async poll() {
    const fetched_at = Date.now();
    this.#stats.polls++;

    // 1. Fetch with timeout and retry
    const data = await this.#fetchWithRetry(this.#feedUrl);

    // SWPC returns a flat JSON array of X-ray flux records
    const records = Array.isArray(data) ? data : [];
    this.#stats.total_events_fetched += records.length;

    // 2. Deduplicate — key: time_tag + energy (two energy bands per minute)
    const newRecords = [];
    for (const record of records) {
      const key = `${record.time_tag ?? ''}|${record.energy ?? ''}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      newRecords.push(record);
      this.#stats.new_events++;
    }

    // 3. Classify the full feed (all records — profile needs full window context)
    const events       = ingest(records);
    const feed_profile = classify(events);
    const proposals    = selectTemplates(feed_profile);

    // 4. Emit IR envelope
    const envelope = emitEnvelope({
      feed_id: `swpc_${this.#feedType}`,
      feed_profile,
      proposals,
      source_metadata: {
        source_id:        'swpc_goes',
        trust_tier:       'T1',
        domain:           'space_weather',
        endpoint:         this.#feedUrl,
        poll_interval_ms: this.#pollIntervalMs,
        event_count:      records.length,
      },
      score_usefulness: true,
    });

    // 5. Build evidence bundles for new records
    //    Primary value: flux (corrected X-ray flux in W/m²)
    //    Trust tier: T1 (NOAA SWPC is an official source)
    const bundles = newRecords.map(record => {
      const flux      = record.flux ?? 0;
      const timestamp = record.time_tag ? Date.parse(record.time_tag) : fetched_at;

      return buildBundle(
        { value: flux, timestamp },
        {
          tier:      'T1',
          source_id: 'swpc_goes',
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
      event_count: records.length,
      new_events:  newRecords.length,
      envelope,
      bundles,
    };

    if (this.#onPoll) {
      try { this.#onPoll(result); } catch (e) {
        console.error('[SWPCLiveAdapter] onPoll callback error:', e.message);
      }
    }

    return result;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the polling loop.
   * Performs an initial poll immediately, then schedules recurring polls.
   * @returns {Promise<PollResult>} Result of the initial poll
   */
  async start() {
    if (this.#pollTimer) throw new Error('SWPCLiveAdapter is already running');

    console.log(
      `[SWPCLiveAdapter] Starting. Feed: ${this.#feedType}, ` +
      `interval: ${this.#pollIntervalMs}ms, ` +
      `runtime: ${this.#runtime ? 'attached' : 'none'}`
    );

    // Initial poll
    const initial = await this.poll();

    // Recurring poll
    this.#pollTimer = setInterval(() => {
      this.poll().catch(err => {
        this.#stats.errors++;
        console.error('[SWPCLiveAdapter] Poll error:', err.message);
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
      console.log('[SWPCLiveAdapter] Stopped.');
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
   * Get number of seen records (dedup set size).
   * @returns {number}
   */
  getSeenCount() {
    return this.#seen.size;
  }
}

// ─── Convenience: one-shot classification ────────────────────────────────────

/**
 * Fetch and classify a SWPC GOES X-ray feed once (no polling loop).
 * Useful for testing and one-off analysis.
 *
 * @param {string} [feedType='xrays_1day']
 * @returns {Promise<Object>} ProposalEnvelope
 */
export async function classifySWPCFeed(feedType = 'xrays_1day') {
  const adapter = new SWPCLiveAdapter({ feedType });
  const result  = await adapter.poll();
  return result.envelope;
}
