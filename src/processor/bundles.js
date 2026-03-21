/**
 * src/processor/bundles.js
 * Generalized EvidenceBundle assembly.
 *
 * Assembles a well-typed EvidenceBundle from a raw event using:
 *   - quality.js   → quality score
 *   - uncertainty.js → doubt_price
 *   - settlement.js  → evidence_class
 *
 * EvidenceBundle contract (matches TREMOR/CORONA/BREATH patterns):
 *   {
 *     value          : number                    - primary reading
 *     timestamp      : number                    - Unix ms
 *     doubt_price    : number                    - [0,1] confidence discount
 *     quality        : number                    - [0,1] trustworthiness score
 *     evidence_class : 'ground_truth'|'corroboration'|'provisional'
 *     source_id      : string|null               - originating source identifier
 *     theatre_refs   : string[]                  - theatre IDs this bundle targets
 *     resolution     : null|object               - populated at settlement time
 *   }
 *
 * Optional passthrough fields (present when rawEvent provides them):
 *   channel_a, channel_b   — for multi-channel sources (PurpleAir A/B)
 *   lat, lon               — GPS coordinates (for adversarial location checks)
 *   frozen_count           — consecutive identical readings counter
 *
 * @module processor/bundles
 */

import { computeQuality }      from './quality.js';
import { computeDoubtPrice }   from './uncertainty.js';
import { assignEvidenceClass } from './settlement.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assemble an EvidenceBundle from a raw event.
 *
 * @param {{ value: number, timestamp?: number, [key: string]: any }} rawEvent
 * @param {Object} [config]
 * @param {string} [config.tier='T3']              - oracle trust tier
 * @param {string|null} [config.source_id=null]    - originating source identifier
 * @param {string[]} [config.theatre_refs=[]]      - theatre IDs this bundle targets
 * @param {number} [config.now=Date.now()]         - injectable clock
 * @param {number} [config.stale_after_ms=3600000] - staleness threshold
 * @param {number} [config.freshness_weight=0.2]   - freshness blend weight
 * @returns {Object} EvidenceBundle
 */
export function buildBundle(rawEvent, config = {}) {
  const {
    tier           = 'T3',
    source_id      = null,
    theatre_refs   = [],
    now            = Date.now(),
    stale_after_ms = 3_600_000,
    freshness_weight = 0.2,
  } = config;

  const quality      = computeQuality(rawEvent, { tier, now, stale_after_ms, freshness_weight });
  const doubt_price  = computeDoubtPrice(quality);
  const evidence_class = assignEvidenceClass(tier);

  const bundle = {
    value:          rawEvent.value,
    timestamp:      rawEvent.timestamp ?? now,
    doubt_price,
    quality,
    evidence_class,
    source_id,
    theatre_refs,
    resolution:     null,
  };

  // Passthrough optional fields from rawEvent (adversarial detection context)
  if (rawEvent.channel_a  != null) bundle.channel_a  = rawEvent.channel_a;
  if (rawEvent.channel_b  != null) bundle.channel_b  = rawEvent.channel_b;
  if (rawEvent.lat        != null) bundle.lat         = rawEvent.lat;
  if (rawEvent.lon        != null) bundle.lon         = rawEvent.lon;
  if (rawEvent.frozen_count != null) bundle.frozen_count = rawEvent.frozen_count;

  return bundle;
}
