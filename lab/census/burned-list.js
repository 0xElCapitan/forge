/**
 * lab/census/burned-list.js
 *
 * Cycle-004 S03 (FR-11a; SDD Lane L5 07-cycle-004-sdd.md:533; Sprint Plan T3.1).
 *
 * Mechanical generator for the burned-family authority. The burned families are
 * seeded from the architecture (arch section 8-1:222 / section 9:249) and their
 * EVIDENCE is gathered by scanning FORGE's own local exposure surfaces:
 *
 *   - fixtures/**\/*.json            (fixture basenames name the burned families)
 *   - src/selector/rules.js          (rule ids + traced_to construct references)
 *   - README.md, BUTTERFREEZONE.md   (domain prose)
 *
 * These are stable, authoritative surfaces internal to FORGE. NO candidate feed
 * is inspected and NO network contact occurs — the generator reads local repo
 * files only. Generation is a convenience for producing/refreshing the list; the
 * REVIEWED-then-FROZEN `lab/census/burned-list.json` (pinned in the freeze
 * manifest) is the authority. Regenerating after later prose edits yields a
 * PROPOSED diff for review, never an in-place authority change post-freeze (a
 * post-freeze change to the pinned list voids the experiment, PRD section 11).
 *
 * Matching is at PROVIDER-PRODUCT granularity: `isBurned` matches only when BOTH
 * the normalized provider AND the normalized product are equal to a burned entry.
 * Provider identity alone never burns — a USGS *water* product is eligible despite
 * USGS *earthquake* being burned, and NOAA CO-OPS / NDBC are eligible despite NOAA
 * *SWPC space-weather* products being burned (same provider, different product).
 *
 * @module lab/census/burned-list
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root = two directories up from lab/census/. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The seeded known-burned families (arch section 8-1:222). Each family declares
 * its provider-product identity plus DISTINCTIVE evidence patterns:
 *   - `fixturePatterns` — substrings matched against fixture paths (basenames).
 *   - `contentPatterns` — substrings matched against scanned file contents.
 * Patterns are intentionally distinctive (fixture basenames, rule ids, construct
 * ids) so evidence is meaningful, never a generic-word false positive.
 * @type {ReadonlyArray<{provider:string, product:string, fixturePatterns:string[], contentPatterns:string[], note?:string}>}
 */
export const KNOWN_BURNED = Object.freeze([
  {
    provider: 'USGS',
    product: 'seismic (earthquake magnitude)',
    fixturePatterns: ['usgs-m4.5', 'forge-snapshots-tremor'],
    contentPatterns: ['seismic_threshold_gate', 'TREMOR/', 'seismic_cascade', 'seismic_anomaly'],
    note: 'USGS *water*/NWIS products are a different USGS data product and are NOT burned (residual author-familiarity only).',
  },
  {
    provider: 'NOAA',
    product: 'SWPC GOES X-ray flux',
    fixturePatterns: ['swpc-goes-xray'],
    contentPatterns: ['space_weather_flare_gate', 'CORONA/FlareGate'],
    note: 'NOAA CO-OPS and NOAA NDBC are different NOAA data products and are NOT burned (same provider, different product).',
  },
  {
    provider: 'NOAA',
    product: 'SWPC planetary K-index (Kp)',
    fixturePatterns: [],
    contentPatterns: ['space_weather_kp_gate', 'CORONA/GeomagGate'],
    note: 'NOAA CO-OPS and NOAA NDBC are different NOAA data products and are NOT burned (same provider, different product).',
  },
  {
    provider: 'NOAA',
    product: 'SWPC DONKI solar flares (FLR)',
    fixturePatterns: ['donki-flr-cme'],
    contentPatterns: ['space_weather_flare_gate', 'CORONA/FlareGate'],
    note: 'NOAA CO-OPS and NOAA NDBC are different NOAA data products and are NOT burned (same provider, different product).',
  },
  {
    provider: 'NOAA',
    product: 'SWPC DONKI CME arrival',
    fixturePatterns: ['donki-flr-cme'],
    contentPatterns: ['space_weather_cme_gate', 'CORONA/CMEArrivalGate'],
    note: 'NOAA CO-OPS and NOAA NDBC are different NOAA data products and are NOT burned (same provider, different product).',
  },
  {
    provider: 'NOAA',
    product: 'SWPC solar wind',
    fixturePatterns: [],
    contentPatterns: ['space_weather_solar_wind_divergence', 'CORONA/SolarWindDivergence'],
    note: 'NOAA CO-OPS and NOAA NDBC are different NOAA data products and are NOT burned (same provider, different product).',
  },
  {
    provider: 'AirNow',
    product: 'AQI',
    fixturePatterns: ['airnow-sf-bay', 'forge-snapshots-breath'],
    contentPatterns: ['aqi_threshold_gate', 'BREATH/AQIGate', "settlement_source: 'airnow'"],
  },
  {
    provider: 'PurpleAir',
    product: 'AQI',
    fixturePatterns: ['purpleair-sf-bay'],
    contentPatterns: ['BREATH/', 'air_quality_sensor_divergence'],
  },
  { provider: 'FORGE-snapshots', product: 'tremor snapshot', fixturePatterns: ['forge-snapshots-tremor'], contentPatterns: [] },
  { provider: 'FORGE-snapshots', product: 'corona snapshot', fixturePatterns: ['forge-snapshots-corona'], contentPatterns: [] },
  { provider: 'FORGE-snapshots', product: 'breath snapshot', fixturePatterns: ['forge-snapshots-breath'], contentPatterns: [] },
  { provider: 'synthetic-robustness', product: 'correlated-upstream', fixturePatterns: ['robustness/correlated-upstream'], contentPatterns: [] },
  { provider: 'synthetic-robustness', product: 'cross-domain-transplant', fixturePatterns: ['robustness/cross-domain-transplant'], contentPatterns: [] },
  { provider: 'synthetic-robustness', product: 'no-ground-truth', fixturePatterns: ['robustness/no-ground-truth'], contentPatterns: [] },
  { provider: 'synthetic-robustness', product: 'synthetic-adversarial', fixturePatterns: ['robustness/synthetic-adversarial'], contentPatterns: [] },
  { provider: 'synthetic-robustness', product: 'threshold-straddle', fixturePatterns: ['robustness/threshold-straddle'], contentPatterns: [] },
]);

/** Normalize an identifier for the provider-product join (lowercase; non-alphanumerics -> single '-'). */
export function normalizeToken(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Provider-product join predicate. Returns the matching burned entry, or `null`
 * when the candidate is NOT burned. A match requires BOTH the normalized provider
 * AND the normalized product to be equal — provider identity alone never burns.
 *
 * @param {{provider:string, product:string}} candidate
 * @param {{entries: Array<{provider:string, product:string}>}} burnedList - the frozen authority
 * @returns {{provider:string, product:string}|null}
 */
export function isBurned(candidate, burnedList) {
  if (candidate === null || typeof candidate !== 'object') throw new Error('isBurned: candidate must be an object');
  if (burnedList === null || typeof burnedList !== 'object' || !Array.isArray(burnedList.entries)) {
    throw new Error('isBurned: burnedList must be an object with an entries array');
  }
  const cp = normalizeToken(candidate.provider);
  const cq = normalizeToken(candidate.product);
  for (const e of burnedList.entries) {
    if (normalizeToken(e.provider) === cp && normalizeToken(e.product) === cq) return e;
  }
  return null;
}

/**
 * Deterministically generate the burned-list authority from scanned surfaces.
 * Pure: no filesystem or network access. `surfaces` is `{ fixturePaths, contentSurfaces }`
 * where `fixturePaths` is a list of repo-relative POSIX fixture paths and
 * `contentSurfaces` maps repo-relative POSIX paths to their file contents.
 *
 * @param {{fixturePaths: string[], contentSurfaces: Object<string,string>}} surfaces
 * @returns {{authority:string, status:string, schema_version:string, description:string, provenance:string, entries: Array<{provider:string, product:string, evidence:string[], note?:string}>}}
 */
export function generateBurnedList(surfaces) {
  if (surfaces === null || typeof surfaces !== 'object') throw new Error('generateBurnedList: surfaces required');
  const fixturePaths = Array.isArray(surfaces.fixturePaths) ? surfaces.fixturePaths : [];
  const contentSurfaces = surfaces.contentSurfaces && typeof surfaces.contentSurfaces === 'object' ? surfaces.contentSurfaces : {};
  const contentPaths = Object.keys(contentSurfaces).sort();

  const entries = KNOWN_BURNED.map((fam) => {
    const evidence = new Set();
    for (const fp of fixturePaths) {
      if (fam.fixturePatterns.some(pat => fp.includes(pat))) evidence.add(fp);
    }
    for (const cp of contentPaths) {
      const content = String(contentSurfaces[cp]);
      if (fam.contentPatterns.some(pat => content.includes(pat))) evidence.add(cp);
    }
    const entry = {
      provider: fam.provider,
      product: fam.product,
      evidence: [...evidence].sort(),
    };
    if (fam.note) entry.note = fam.note;
    return entry;
  }).sort((a, b) => {
    const ap = normalizeToken(a.provider), bp = normalizeToken(b.provider);
    if (ap !== bp) return ap < bp ? -1 : 1;
    const aq = normalizeToken(a.product), bq = normalizeToken(b.product);
    return aq < bq ? -1 : aq > bq ? 1 : 0;
  });

  return {
    authority: 'burned-list',
    status: 'generated-then-frozen',
    schema_version: '1.0.0',
    description: 'Burned-family authority for the Cycle-005 held-out census (FR-11a). Mechanically generated from FORGE local exposure surfaces (fixtures, selector rules, top-level docs) then reviewed and frozen. Provider-product granularity: `isBurned` matches only when BOTH provider AND product are equal. NO candidate feed inspected; NO network contact.',
    provenance: 'arch section 8-1:222 / section 9:249; PRD FR-11a; SDD Lane L5 (07-cycle-004-sdd.md:533)',
    entries,
  };
}

/**
 * FILESYSTEM LAYER (kept separate from the pure generator). Collect the real
 * local exposure surfaces from the repository. Reads local repo files ONLY.
 * @param {string} [repoRoot]
 * @returns {{fixturePaths: string[], contentSurfaces: Object<string,string>}}
 */
export function collectSurfaces(repoRoot = REPO_ROOT) {
  const fixturePaths = [];
  const fixturesDir = join(repoRoot, 'fixtures');
  const walk = (dir, relPrefix) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(join(dir, ent.name), rel);
      else if (ent.isFile() && ent.name.endsWith('.json')) fixturePaths.push(`fixtures/${rel}`);
    }
  };
  if (existsSync(fixturesDir)) walk(fixturesDir, '');
  fixturePaths.sort();

  const contentSurfaces = {};
  for (const rel of ['src/selector/rules.js', 'README.md', 'BUTTERFREEZONE.md']) {
    const abs = join(repoRoot, rel);
    if (existsSync(abs)) contentSurfaces[rel] = readFileSync(abs, 'utf8');
  }
  return { fixturePaths, contentSurfaces };
}

/** Deterministic serialization for the tracked authority (2-space pretty JSON + trailing LF). */
export function serializeBurnedList(list) {
  return JSON.stringify(list, null, 2) + '\n';
}

// Regenerate + print when invoked directly: `node lab/census/burned-list.js`.
// Writing the tracked authority is an operator step (review before freeze); this
// entry point prints to stdout so a diff can be reviewed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(serializeBurnedList(generateBurnedList(collectSurfaces())));
}
