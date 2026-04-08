/**
 * Aftershock Cascade Theatre
 *
 * Multi-class market: "Given mainshock M≥6.0 at T₀, how many M≥4.0
 * aftershocks within 72 hours?"
 *
 * Buckets: 0-2, 3-5, 6-10, 11-20, 21+
 *
 * This is the richest RLMF producer — the position history captures
 * a complete time-series of Bayesian updating as aftershocks stream in.
 * The construct's belief trajectory (how it shifted from Omori-law prior
 * to calibrated posterior) is the highest-value training data export.
 */

/**
 * Modified Omori-law parameters by tectonic regime.
 *
 * source: Omori (1894), "On the Aftershocks of Earthquakes"; Utsu (1961),
 * "A statistical study on the occurrence of aftershocks".
 * The Omori-Utsu law: n(t) = K / (t + c)^p
 * where n(t) = aftershock rate at time t after mainshock,
 * K = productivity, c = time offset, p = decay exponent.
 *
 * source: Båth (1965) — largest aftershock ≈ mainshock − 1.2
 *
 * K values: backtest-derived empirical refit from Run 4 (2026-04-06)
 *   subduction K: source: grimoires/loa/calibration/omori-backtest/k-refit-notes.md
 *   transform K:  source: grimoires/loa/calibration/omori-backtest/k-refit-notes.md
 *   intraplate K: PROVISIONAL — 2 sequences only, flag for human review before production merge
 *                 source: grimoires/loa/calibration/omori-backtest/k-refit-notes.md
 *   volcanic K:   TBD: empirical calibration needed (robustness-only, no clean calibration data)
 *   default K:    TBD: empirical calibration needed (1 sequence, insufficient for refit)
 * c, p, bath_delta: TBD — empirical calibration needed
 * 0.75 scaling exponent: source: Reasenberg & Jones (1989)
 *   magnitude-dependence: see k-refit-notes.md — follow-on sprint may be warranted
 */
const REGIME_PARAMS = {
  subduction: { K: 0.220, c: 0.05, p: 1.05, bath_delta: 1.1 },
  transform:  { K: 0.291, c: 0.03, p: 1.10, bath_delta: 1.2 },
  intraplate: { K: 0.240, c: 0.08, p: 0.95, bath_delta: 1.3 },
  volcanic:   { K: 30, c: 0.02, p: 0.90, bath_delta: 1.0 },
  default:    { K: 18, c: 0.05, p: 1.00, bath_delta: 1.2 },
};

const BUCKETS = [
  { label: '0-2',  min: 0,  max: 2 },
  { label: '3-5',  min: 3,  max: 5 },
  { label: '6-10', min: 6,  max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21+',  min: 21, max: Infinity },
];

/**
 * Estimate expected aftershock count from Omori-law parameters.
 *
 * Integrates n(t) = K / (t + c)^p from t=0 to t=T
 * For p ≠ 1: N(T) = K * [(T+c)^(1-p) - c^(1-p)] / (1-p)
 * For p = 1: N(T) = K * ln((T+c)/c)
 *
 * @param {object} params - Omori parameters {K, c, p}
 * @param {number} mainMag - Mainshock magnitude
 * @param {number} thresholdMag - Minimum aftershock magnitude to count
 * @param {number} windowHours - Prediction window
 * @returns {number} Expected aftershock count
 */
function omoriExpectedCount(params, mainMag, thresholdMag, windowHours) {
  const { K, c, p } = params;

  // Scale productivity by magnitude difference.
  // source: Reasenberg & Jones (1989), "Earthquake Hazard After a
  // Mainshock in California", Science 243(4895). 0.75 exponent from
  // their productivity scaling relation.
  const magDiff = mainMag - thresholdMag;
  const scaledK = K * Math.pow(10, 0.75 * (magDiff - 1));

  const T = windowHours / 24; // Convert to days (Omori convention)

  let expectedN;
  if (Math.abs(p - 1) < 0.001) {
    expectedN = scaledK * Math.log((T + c) / c);
  } else {
    expectedN = scaledK * (Math.pow(T + c, 1 - p) - Math.pow(c, 1 - p)) / (1 - p);
  }

  return Math.max(0, expectedN);
}

/**
 * Convert expected count to bucket probabilities.
 *
 * Uses a Poisson-like distribution centered on the expected count
 * to assign probability mass to each bucket.
 *
 * @param {number} expectedCount - From Omori model
 * @returns {number[]} Probabilities for each bucket (sum to ~1)
 */
function countToBucketProbabilities(expectedCount) {
  const probs = BUCKETS.map(({ min, max }) => {
    // Probability of Poisson count falling in [min, max]
    let p = 0;
    const upper = Math.min(max, 50); // cap for computation
    for (let k = min; k <= upper; k++) {
      p += poissonPMF(expectedCount, k);
    }
    // For 21+ bucket, add tail
    if (max === Infinity) {
      let tailP = 0;
      for (let k = 0; k < min; k++) {
        tailP += poissonPMF(expectedCount, k);
      }
      p = Math.max(p, 1 - tailP);
    }
    return p;
  });

  // Normalize to sum to 1
  const total = probs.reduce((s, p) => s + p, 0);
  return probs.map((p) => Math.round((p / total) * 1000) / 1000);
}

function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log-space to avoid overflow for large lambda
  const logP = k * Math.log(lambda) - lambda - logFactorial(k);
  return Math.exp(logP);
}

function logFactorial(n) {
  if (n <= 1) return 0;
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

/**
 * Infer tectonic regime from depth and location.
 *
 * TBD: empirical calibration needed — all depth thresholds (30/50/100 km)
 * and bounding-box bounds below are rough engineering heuristics, not
 * sourced from a tectonic regionalization dataset. In production this
 * should be replaced with a proper regionalization (e.g. Hayes et al.
 * Slab2 for subduction zones, PB2002 plate boundaries for transform).
 * See grimoires/loa/calibration/
 */
function inferRegime(depth_km, lat, lon) {
  if (depth_km > 100) return 'subduction';
  if (depth_km > 50) return 'subduction';

  // South America Andes subduction zone
  // TBD: empirical calibration needed — bounding box is approximate;
  // see grimoires/loa/calibration/
  if (lon >= -82 && lon <= -65 && lat >= -55 && lat <= 12) {
    return depth_km > 20 ? 'subduction' : 'transform';
  }

  // Indonesia/Philippines subduction zone
  // TBD: empirical calibration needed — bounding box is approximate;
  // see grimoires/loa/calibration/
  if (lon >= 95 && lon <= 145 && lat >= -10 && lat <= 20) {
    return depth_km > 20 ? 'subduction' : 'transform';
  }

  // Caribbean plate boundary (transform-dominated)
  // TBD: empirical calibration needed — bounding box is approximate;
  // see grimoires/loa/calibration/
  if (lon >= -85 && lon <= -60 && lat >= 10 && lat <= 25) {
    return 'transform';
  }

  // TBD: hand-rolled intraplate approximation — production use requires proper
  // stable-craton regionalization (e.g., USGS tectonic summary regions or Flinn-Engdahl zones)
  if (depth_km < 30) {
    // Eastern North America (stable craton)
    if (lon >= -100 && lon <= -60 && lat >= 25 && lat <= 55) return 'intraplate';
    // Basin and Range / Intermountain West (extensional, not transform)
    // lat >= 36 excludes southern CA transform zones (e.g., Ridgecrest at 35.8°N)
    if (lon >= -120 && lon <= -100 && lat >= 36 && lat <= 50) return 'intraplate';
    // Australian craton
    if (lon >= 113 && lon <= 155 && lat >= -45 && lat <= -10) return 'intraplate';
    // Stable African craton (excludes East African Rift)
    if (lon >= 15 && lon <= 45 && lat >= -30 && lat <= 15) return 'intraplate';
    // Indian subcontinent interior (away from Himalayan collision zone)
    if (lon >= 68 && lon <= 88 && lat >= 10 && lat <= 28) return 'intraplate';
  }

  // Pacific ring of fire rough bounds
  if ((lon < -100 && lon > -180 && lat > -60 && lat < 60) ||
      (lon > 100 && lat > -60 && lat < 60)) {
    return depth_km > 20 ? 'subduction' : 'transform';
  }

  // Mid-ocean ridge zones
  if (Math.abs(lat) < 10 && (lon > -50 && lon < -10)) return 'transform';
  return 'default';
}

// =========================================================================
// Theatre lifecycle
// =========================================================================

/**
 * Create an Aftershock Cascade theatre.
 *
 * Auto-spawns when TREMOR detects a M≥6.0 event.
 *
 * @param {object} params
 * @param {object} params.mainshockBundle - Evidence bundle for the triggering mainshock
 * @param {number} [params.threshold_mag] - Minimum aftershock magnitude (default 4.0)
 * @param {number} [params.window_hours] - Prediction window (default 72)
 * @param {string} [params.regime] - Tectonic regime override
 * @returns {object} Theatre definition
 */
export function createAftershockCascade({
  mainshockBundle,
  threshold_mag = 4.0,
  window_hours = 72,
  regime = null,
}) {
  const mainMag = mainshockBundle.payload.magnitude.value;
  const loc = mainshockBundle.payload.location;

  if (mainMag < 6.0) return skipResult('magnitude_below_threshold', { mainMag });

  const now = Date.now();
  const inferredRegime = regime || inferRegime(loc.depth_km, loc.latitude, loc.longitude);

  // Volcanic routing check (conservative policy): volcanic events skip
  // Aftershock Cascade. Operator decides on Swarm Watch.
  const routing = assessAftershockApplicability({
    regime: inferredRegime, mag: mainMag,
    lat: loc.latitude, lon: loc.longitude, depth_km: loc.depth_km,
  });
  if (!routing.omoriApplicable) {
    console.warn(
      `[TREMOR] Aftershock Cascade skipped — ${routing.reason}. ` +
      `Swarm Watch recommended. Manual review: ${routing.manualReview}`,
    );
    return skipResult('volcanic_routing', routing);
  }
  const params = REGIME_PARAMS[inferredRegime] || REGIME_PARAMS.default;

  // Compute initial bucket probabilities from Omori model
  const expectedCount = omoriExpectedCount(params, mainMag, threshold_mag, window_hours);
  const initialProbs = countToBucketProbabilities(expectedCount);

  // Rupture length estimate for spatial matching.
  // source: Wells & Coppersmith (1994), "New Empirical Relationships
  // among Magnitude, Rupture Length, Rupture Width, Rupture Area, and
  // Surface Displacement", BSSA 84(4). log10(L) = -3.22 + 0.69*M → L in km.
  const ruptureLength = Math.pow(10, -3.22 + 0.69 * mainMag);
  // TBD: empirical calibration needed — the 1.5× match-radius multiplier
  // is an engineering heuristic; see grimoires/loa/calibration/
  const matchRadius = ruptureLength * 1.5;

  // Convert km → degrees (~111 km per degree of latitude).
  // TBD: equatorial approximation, distorts at high latitudes;
  // see grimoires/loa/calibration/
  const degreeRadius = matchRadius / 111;

  return {
    id: `T2-AFTERSHOCK-${mainshockBundle.payload.event_id}-${now}`,
    template: 'aftershock_cascade',
    question: `M≥${mainMag} mainshock: how many M≥${threshold_mag} aftershocks within ${window_hours}h?`,
    mainshock: {
      event_id: mainshockBundle.payload.event_id,
      magnitude: mainMag,
      location: loc,
      time: mainshockBundle.payload.event_time,
    },
    threshold_mag,
    region_bbox: [
      loc.longitude - degreeRadius,
      loc.latitude - degreeRadius,
      loc.longitude + degreeRadius,
      loc.latitude + degreeRadius,
    ],
    magnitude_threshold: threshold_mag,
    opens_at: now,
    closes_at: now + window_hours * 60 * 60 * 1000,
    state: 'open',
    outcome: null, // bucket index on resolution

    // Omori model state
    omori: {
      regime: inferredRegime,
      params,
      expected_count: Math.round(expectedCount * 10) / 10,
      rupture_length_km: Math.round(ruptureLength * 10) / 10,
      match_radius_deg: Math.round(degreeRadius * 100) / 100,
    },

    // Multi-class position: probability per bucket
    bucket_labels: BUCKETS.map((b) => b.label),
    current_position: initialProbs,
    aftershock_count: 0,
    aftershock_events: [],

    position_history: [
      {
        t: now,
        p: initialProbs,
        aftershock_count: 0,
        evidence: mainshockBundle.bundle_id,
        reason: `Omori prior (${inferredRegime}): expected ${expectedCount.toFixed(1)} aftershocks`,
      },
    ],
    evidence_bundles: [mainshockBundle.bundle_id],
    resolving_bundle_id: null,
    resolved_at: null,
  };
}

/**
 * Process an aftershock evidence bundle.
 *
 * Each aftershock updates the count and recomputes bucket probabilities
 * by blending the Omori prior with the observed rate.
 *
 * @param {object} theatre - Aftershock Cascade theatre
 * @param {object} bundle - Evidence bundle for a potential aftershock
 * @returns {object} Updated theatre
 */
export function processAftershockCascade(theatre, bundle) {
  if (theatre.state === 'resolved' || theatre.state === 'expired') {
    return theatre;
  }

  const mag = bundle.payload.magnitude.value;
  const threshold = theatre.threshold_mag;

  const updated = { ...theatre };
  updated.evidence_bundles = [...theatre.evidence_bundles, bundle.bundle_id];

  // Only count events at or above threshold
  if (mag < threshold) {
    // Sub-threshold event — still evidence (b-value signal) but doesn't increment count
    updated.position_history = [
      ...theatre.position_history,
      {
        t: Date.now(),
        p: theatre.current_position,
        aftershock_count: theatre.aftershock_count,
        evidence: bundle.bundle_id,
        reason: `Sub-threshold M${mag} — no count change (b-value signal)`,
      },
    ];
    return updated;
  }

  // Count this aftershock
  const newCount = theatre.aftershock_count + 1;
  updated.aftershock_count = newCount;
  updated.aftershock_events = [
    ...theatre.aftershock_events,
    {
      bundle_id: bundle.bundle_id,
      magnitude: mag,
      time: bundle.payload.event_time,
      evidence_class: bundle.evidence_class,
    },
  ];

  // Recompute bucket probabilities
  // Blend: weight observed rate more as more aftershocks arrive
  const elapsed = (Date.now() - theatre.opens_at) / (1000 * 60 * 60); // hours
  const remaining = Math.max(1, (theatre.closes_at - Date.now()) / (1000 * 60 * 60));
  const totalWindow = (theatre.closes_at - theatre.opens_at) / (1000 * 60 * 60);

  // Observed rate extrapolation.
  // TBD: empirical calibration needed — the 0.7 Omori-decay correction
  // and the blending formula below are engineering heuristics;
  // see grimoires/loa/calibration/
  const rate = elapsed > 0 ? newCount / elapsed : newCount;
  const projectedTotal = newCount + rate * remaining * 0.7;

  // Blend Omori prior with observed projection.
  // TBD: empirical calibration needed — the max(0.1, ...) blending floor
  // ensures the Omori prior never fully disappears, but the specific value
  // is unsourced; see grimoires/loa/calibration/
  const omoriWeight = Math.max(0.1, 1 - (elapsed / totalWindow));
  const obsWeight = 1 - omoriWeight;
  const blendedExpected =
    omoriWeight * theatre.omori.expected_count +
    obsWeight * projectedTotal;

  const newProbs = countToBucketProbabilities(blendedExpected);

  updated.current_position = newProbs;
  updated.position_history = [
    ...theatre.position_history,
    {
      t: Date.now(),
      p: newProbs,
      aftershock_count: newCount,
      evidence: bundle.bundle_id,
      reason:
        `M${mag} aftershock #${newCount} — ` +
        `rate=${rate.toFixed(2)}/hr, projected=${projectedTotal.toFixed(1)}, ` +
        `blended=${blendedExpected.toFixed(1)} (omori_w=${omoriWeight.toFixed(2)})`,
    },
  ];

  return updated;
}

/**
 * Resolve the Aftershock Cascade at theatre close.
 *
 * @param {object} theatre - Aftershock Cascade theatre
 * @returns {object} Resolved theatre with outcome = bucket index
 */
export function resolveAftershockCascade(theatre) {
  if (theatre.state === 'resolved') return theatre;

  const count = theatre.aftershock_count;

  // Find which bucket the final count falls into
  const outcomeIndex = BUCKETS.findIndex(
    ({ min, max }) => count >= min && count <= max
  );

  return {
    ...theatre,
    state: 'resolved',
    outcome: outcomeIndex >= 0 ? outcomeIndex : BUCKETS.length - 1,
    resolved_at: Date.now(),
    position_history: [
      ...theatre.position_history,
      {
        t: Date.now(),
        p: theatre.current_position,
        aftershock_count: count,
        evidence: null,
        reason: `Theatre closed — final count: ${count} → bucket "${BUCKETS[outcomeIndex >= 0 ? outcomeIndex : BUCKETS.length - 1].label}"`,
      },
    ],
  };
}

/**
 * Assess whether Omori aftershock modelling applies to an event.
 * Routing policy: conservative — volcanic events skip Aftershock Cascade,
 * operator decides on Swarm Watch.
 *
 * @param {Object} params
 * @param {string} params.regime - output of inferRegime()
 * @param {number} params.mag - mainshock magnitude
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {number} params.depth_km
 * @returns {{ omoriApplicable: boolean, routeTo: string, manualReview: boolean, volcanicSubtype: string|null, reason: string }}
 */
export function assessAftershockApplicability({ regime, mag, lat, lon, depth_km }) {
  if (regime === 'volcanic') {
    // Tectonic-volcanic boundary heuristic: M≥6.0 in a volcanic regime is used as a conservative
    // operational proxy for events that may have real mainshock-aftershock structure.
    // This is a routing heuristic, not a geophysical classification claim.
    // Flag for manual review rather than auto-routing.
    const isBoundaryCandidate = mag >= 6.0;
    return {
      omoriApplicable: false,
      routeTo: 'swarm_watch',
      manualReview: isBoundaryCandidate,
      volcanicSubtype: isBoundaryCandidate ? 'boundary' : 'swarm',
      reason: isBoundaryCandidate
        ? 'volcanic_boundary_candidate — Omori may apply, manual review required'
        : 'volcanic_swarm_non_omori — magma-driven swarm, Omori not applicable',
    };
  }

  return {
    omoriApplicable: true,
    routeTo: 'aftershock_cascade',
    manualReview: false,
    volcanicSubtype: null,
    reason: 'standard_tectonic',
  };
}

// Internal helper — not exported
function skipResult(reason, detail = null) {
  return { skipped: true, reason, detail };
}

export { BUCKETS, REGIME_PARAMS, omoriExpectedCount, countToBucketProbabilities, inferRegime };
