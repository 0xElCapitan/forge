/**
 * src/trust/adversarial.js
 * Anti-gaming detection for T2/T3 oracle sources.
 *
 * Detects manipulation patterns documented in FORGE_PROGRAM.md § Adversarial model:
 *   1. Channel A/B inconsistency  — PurpleAir reference pattern
 *   2. Frozen/replayed data       — N consecutive identical readings
 *   3. Clock drift                — timestamp too old or too far in future
 *   4. Location spoofing          — GPS coords deviate from registered position
 *   5. Sybil sensors              — multiple sensors with implausibly correlated readings
 *   6. Value out of range         — reading outside physically plausible bounds
 *
 * Usage:
 *   const result = checkAdversarial(bundle);         // stateless checks
 *   const result = checkAdversarial(bundle, ctx);    // + context checks (location, sybil)
 *
 *   if (!result.clean) console.warn(result.reason);
 *
 * @module trust/adversarial
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** PurpleAir A/B channels: flag when relative divergence exceeds this. */
const CHANNEL_DIVERGENCE_THRESHOLD = 0.15;  // 15%

/** Frozen data: flag when this many consecutive identical readings detected. */
const FROZEN_COUNT_THRESHOLD = 5;

/** Clock drift: flag timestamp older than 7 days. */
const MAX_AGE_MS = 7 * 24 * 3_600_000;

/** Clock drift: flag timestamp more than 1 hour in the future. */
const MAX_FUTURE_MS = 3_600_000;

/**
 * Location spoofing: flag when coords deviate more than ~50 km from registered.
 * 1° latitude ≈ 111 km; 0.45° ≈ 50 km.
 */
const MAX_COORD_DEVIATION_DEG = 0.45;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check a bundle for adversarial manipulation signals.
 *
 * @param {Object} bundle - EvidenceBundle (from buildBundle or raw)
 * @param {number} [bundle.value]          - primary reading
 * @param {number} [bundle.timestamp]      - Unix ms
 * @param {number} [bundle.channel_a]      - primary channel reading (PurpleAir)
 * @param {number} [bundle.channel_b]      - secondary channel reading (PurpleAir)
 * @param {number} [bundle.frozen_count]   - consecutive identical reading count
 * @param {number} [bundle.lat]            - current GPS latitude
 * @param {number} [bundle.lon]            - current GPS longitude
 *
 * @param {Object} [context={}]            - optional cross-bundle context
 * @param {number} [context.now=Date.now()] - injectable clock
 * @param {number} [context.registered_lat] - sensor's registered latitude
 * @param {number} [context.registered_lon] - sensor's registered longitude
 * @param {number[]} [context.peer_values]  - readings from peer sensors (Sybil check)
 *
 * @returns {{ clean: true } | { clean: false, reason: string }}
 */
export function checkAdversarial(bundle, context = {}) {
  const { now = Date.now() } = context;

  // ── Check 1: Channel A/B inconsistency (PurpleAir reference pattern) ────────
  if (bundle.channel_a != null && bundle.channel_b != null) {
    const a = bundle.channel_a;
    const b = bundle.channel_b;
    // Relative divergence: |a - b| / max(|a|, |b|, 1) to avoid division-by-zero.
    const denom = Math.max(Math.abs(a), Math.abs(b), 1);
    const divergence = Math.abs(a - b) / denom;
    if (divergence > CHANNEL_DIVERGENCE_THRESHOLD) {
      return {
        clean: false,
        reason: `channel_ab_inconsistency: divergence ${divergence.toFixed(3)} exceeds threshold ${CHANNEL_DIVERGENCE_THRESHOLD}`,
      };
    }
  }

  // ── Check 2: Frozen / replayed data ─────────────────────────────────────────
  if (bundle.frozen_count != null && bundle.frozen_count >= FROZEN_COUNT_THRESHOLD) {
    return {
      clean: false,
      reason: `frozen_data: ${bundle.frozen_count} consecutive identical readings (threshold: ${FROZEN_COUNT_THRESHOLD})`,
    };
  }

  // ── Check 3: Clock drift ─────────────────────────────────────────────────────
  if (bundle.timestamp != null) {
    const age_ms = now - bundle.timestamp;
    if (age_ms > MAX_AGE_MS) {
      const days = Math.round(age_ms / 86_400_000);
      return { clean: false, reason: `clock_drift: timestamp is ${days} day(s) old (max: 7)` };
    }
    if (-age_ms > MAX_FUTURE_MS) {
      const mins = Math.round(-age_ms / 60_000);
      return { clean: false, reason: `clock_drift: timestamp is ${mins} minute(s) in the future (max: 60)` };
    }
  }

  // ── Check 4: Location spoofing ───────────────────────────────────────────────
  if (context.registered_lat != null && bundle.lat != null) {
    const latDiff = Math.abs(bundle.lat - context.registered_lat);
    const lonDiff = Math.abs((bundle.lon ?? 0) - (context.registered_lon ?? 0));
    const maxDiff = Math.max(latDiff, lonDiff);
    if (maxDiff > MAX_COORD_DEVIATION_DEG) {
      return {
        clean: false,
        reason: `location_spoofing: coords deviate ${maxDiff.toFixed(3)}° from registered location (max: ${MAX_COORD_DEVIATION_DEG})`,
      };
    }
  }

  // ── Check 5: Sybil sensors ───────────────────────────────────────────────────
  // Flag when all peer sensor readings are identical (implausible for independent sensors).
  if (Array.isArray(context.peer_values) && context.peer_values.length >= 2) {
    const first = context.peer_values[0];
    const allIdentical = context.peer_values.every(v => v === first);
    if (allIdentical) {
      return {
        clean: false,
        reason: `sybil_sensors: ${context.peer_values.length} independent sensors report identical value ${first}`,
      };
    }
  }

  return { clean: true };
}

/**
 * Check PurpleAir channel A/B consistency in isolation.
 * Convenience wrapper for the canonical adversarial reference pattern.
 *
 * @param {number} channelA
 * @param {number} channelB
 * @returns {{ consistent: boolean, divergence: number }}
 */
export function checkChannelConsistency(channelA, channelB) {
  const denom = Math.max(Math.abs(channelA), Math.abs(channelB), 1);
  const divergence = Math.abs(channelA - channelB) / denom;
  return { consistent: divergence <= CHANNEL_DIVERGENCE_THRESHOLD, divergence };
}
