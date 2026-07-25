/**
 * lab/acquisition/acquire.js
 *
 * Cycle-005 S01 + pre-G0 remediation (PRD FR-A5/FR-A7, FR-B1/FR-B4,
 * NFR-CONTAM-1..4, NFR-HALT; SDD DR-2, DR-3 contamination procedure, §6.2/§6.3;
 * Sprint Plan T1.4, T2.2).
 *
 * The operator acquisition CLI — the ONLY execution surface for provider contact.
 * There is no sidecar driver: the code that decides which candidates are contacted,
 * with which parameters, in which order, lives inside the pinned apparatus and is
 * therefore covered by the DR-2 identity the operator accepts at Gate A.
 *
 * Before a single transport call, `main --execute` mechanically verifies the whole
 * authority chain (FR-B1); presence of a gate file is NOT sufficient:
 *
 *   1. DR-2 self-verify — every apparatus asset re-hashes to the accepted manifest.
 *      This is the contact-side SEATBELT, re-implemented from ONLY Lane-A-allowlisted
 *      primitives (`sha256` + LF-normalize + `canonicalize`) because G9 forbids
 *      importing the Lane B `identity.js` verifier.
 *   2. `gate-a-acceptance.json` — well-formed, self-consistent `record_id`, and its
 *      accepted `manifest_companion_digest` EQUAL to the live apparatus identity. A
 *      Gate-A record accepted at an earlier identity is STALE AUTHORITY: it remains
 *      historical evidence and is never edited, but it cannot authorize contact.
 *   3. `g0-authorization.json` — well-formed, self-consistent `record_id`,
 *      referencing that exact Gate-A record AND the live apparatus identity, with a
 *      scope (providers / method ids / route classes / pinned contact parameters /
 *      credential posture / exclusions) that is validated against the frozen route
 *      table and the accepted method set. The authorized and excluded method ids must
 *      PARTITION the route table — an omitted route is a refusal, never a default.
 *   4. Credential posture — only `uncredentialed` is executable here, and every
 *      authorized route must carry `credential: null`. EIA is therefore excluded by
 *      construction and `FORGE_EIA_API_KEY` is never read or exercised.
 *   0. …and ahead of all of it: NO governing `halt-<n>.json` may exist. A DR-3
 *      contamination HALT is terminal for the cycle, so a second invocation after a
 *      HALT performs zero transport, appends nothing, and restarts no sequence
 *      numbering until an operator-governed adjudication authorizes otherwise.
 *   0b. …and NO acquisition evidence from a prior run may exist. Acquisition is
 *      ONE-SHOT per authorized run: a completed, class-3, halted or interrupted run
 *      leaves a contact log, and a second `--execute` over it would restart sequence
 *      numbering at 0 and duplicate the `seq` / `contact_ref` identities the first
 *      run earned. `--preflight` (which contacts nothing and appends nothing) is
 *      deliberately still available to the operator.
 *
 * Per-candidate (FR-A5 complete-pool) loop: contact (contact.js) → guard (guards.js)
 * → on a G2 value-bearing/indeterminate outcome, execute the DR-3 CONTAMINATION
 * procedure immediately (write the durable `halt-<n>.json` record, append the
 * contamination event referencing it, §9.1 class 4, HALT further contact, mark every
 * later candidate NOT_ATTEMPTED_DUE_TERMINAL_HALT under that one governing HALT) —
 * never softened by unpersisted status; else extract → classify → (where lawful)
 * assemble the census-input file. A contact or extraction refusal is EVIDENCED as
 * §9.1 class 3 and the pool continues — it never abandons already-earned candidate
 * evidence. Appends the FR-B4 contact log + FR-A7 provenance. Every contact-log line
 * records the HTTP status where a response exists plus a stable `reason_code` and a
 * truthful `reason` for any non-`ok` outcome, so no rejection is unexplained. A final
 * response outside the accepted HTTP success range is one such lawful class-3
 * refusal: contact.js refuses it before the guard or the extractor ever sees the
 * body, and the line carries the real status and the G4-redacted route.
 *
 * S01/pre-G0 CONSTRAINT: built + unit-tested for its REFUSAL, scope-binding and
 * contamination behavior with an INJECTED transport and fixtures only. No live
 * provider request occurs before the operator accepts the apparatus at Gate A and
 * authorizes G0; with no current-identity Gate-A acceptance and no G0 record on
 * disk, contact is mechanically unreachable.
 *
 * @module lab/acquisition/acquire
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import { contentAddress } from '../harness/manifests.js';
import { appendLedgerLine } from '../harness/ledgers.js';
import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';
import { ROUTES, templateParams, assertPathParamValue } from './routes.js';
import { contactRoute, CREDENTIAL_PARAM_NAME } from './contact.js';
import { guardResponse, RESPONSE_DECLS, VALUE_EXPOSURE, redactUrl } from './guards.js';
import { extractors } from './extract.js';
import { classifyField, appendProvenance } from './classify.js';
import { writeCandidateMetadata } from './assemble.js';

/** Map a route method_id to its guards.js response-declaration id. */
export const ROUTE_DECL = Object.freeze({
  'usgs-nwis-site-metadata': 'usgs-nwis-site-rdb',
  'noaa-coops-station-metadata': 'noaa-coops-mdapi-json',
  'noaa-ndbc-station-metadata': 'noaa-ndbc-station-table',
  'nws-isd-station-inventory': 'nws-isd-history-csv',
  'eia-electricity-demand-count': 'eia-v2-envelope',
});

/** The gate-3 hard-input measured fields (both must be lawful for a census-input file, DR-4.4). */
const HARD_GATE_MEASURED = Object.freeze(['history_years', 'n_observations']);

/** The measured fields classified + provenanced per contacted candidate (FR-A6/FR-A7). */
const MEASURED_FIELDS = Object.freeze(['history_years', 'n_observations', 'span']);

/** The only credential posture this execution path will run under (Cycle-005 UD-2). */
const EXECUTABLE_CREDENTIAL_POSTURE = 'uncredentialed';

/** Repo-relative path of the Gate-A accepted method set. */
const METHOD_SET_REL = 'lab/acquisition/method-set.json';

/** An acquisition refusal — DR-2 self-verify failure or a gate-authority breach (HALT). */
export class AcquisitionRefusal extends Error {
  constructor(message) { super(message); this.name = 'AcquisitionRefusal'; }
}

/** `sha256(LF-normalized bytes)` composed from the frozen primitive (no reimplementation). */
export function sha256LF(textOrBuffer) {
  const text = Buffer.isBuffer(textOrBuffer) ? textOrBuffer.toString('utf8') : String(textOrBuffer);
  return sha256(text.replace(/\r\n/g, '\n'));
}

/** Companion-digest path for the acquisition manifest. */
function companionPath(manifestPath) {
  return manifestPath.endsWith('.json') ? manifestPath.slice(0, -'.json'.length) + '.sha256' : manifestPath + '.sha256';
}

/**
 * Contact-side self-verify (the DR-2 seatbelt). Loads `acquisition-manifest.json` +
 * `.sha256`, recomputes the companion digest over the manifest bytes, and re-hashes
 * EVERY listed apparatus asset against its recorded digest. Throws
 * {@link AcquisitionRefusal} on the first mismatch (no partial effect).
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.manifestPath - lab/evidence/cycle-005/acquisition-manifest.json
 * @returns {{companion_digest:string, asset_count:number}}
 */
export function selfVerifyAcquisitionManifest({ repoRoot, manifestPath }) {
  if (!existsSync(manifestPath)) throw new AcquisitionRefusal(`acquire refuses: acquisition manifest not found: ${manifestPath}`);
  const cPath = companionPath(manifestPath);
  if (!existsSync(cPath)) throw new AcquisitionRefusal(`acquire refuses: acquisition companion digest missing: ${cPath}`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (e) { throw new AcquisitionRefusal(`acquire refuses: malformed acquisition manifest JSON: ${e.message}`); }
  const companion = readFileSync(cPath, 'utf8').trim();
  const recomputed = sha256LF(manifestText);
  if (companion !== recomputed) throw new AcquisitionRefusal('acquire refuses: acquisition companion digest mismatch (apparatus identity drift — re-accept at Gate A)');
  if (!Array.isArray(manifest.assets)) throw new AcquisitionRefusal('acquire refuses: acquisition manifest has no assets[]');
  for (const a of manifest.assets) {
    const abs = join(repoRoot, a.path);
    if (!existsSync(abs)) throw new AcquisitionRefusal(`acquire refuses: apparatus asset missing on disk: ${a.path}`);
    const actual = sha256LF(readFileSync(abs, 'utf8'));
    if (actual !== a.sha256) throw new AcquisitionRefusal(`acquire refuses: apparatus asset digest mismatch (identity drift): ${a.path}`);
  }
  return { companion_digest: recomputed, asset_count: manifest.assets.length };
}

/** Assert the Gate-A acceptance + G0 authorization records exist (FR-B1). */
export function assertGateRecordsPresent(evidenceDir) {
  for (const name of ['gate-a-acceptance.json', 'g0-authorization.json']) {
    const p = join(evidenceDir, name);
    if (!existsSync(p)) throw new AcquisitionRefusal(`acquire refuses: required gate record absent: ${name} (Gate A + G0 must precede any contact, FR-B1)`);
  }
}

// ─── Gate-record authority binding (FR-B1; presence alone is never sufficient) ──

/** Read + parse a gate record, refusing on absence or malformed JSON. */
export function readGateRecord(evidenceDir, name) {
  const p = join(evidenceDir, name);
  if (!existsSync(p)) throw new AcquisitionRefusal(`acquire refuses: required gate record absent: ${name} (FR-B1)`);
  let rec;
  try { rec = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new AcquisitionRefusal(`acquire refuses: malformed gate record ${name}: ${e.message}`); }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) throw new AcquisitionRefusal(`acquire refuses: gate record ${name} is not a JSON object`);
  return rec;
}

/**
 * A gate record's `record_id` must equal its own self-excluded content address
 * (the DR-4.3 one-shot-record contract). A record whose id does not verify has been
 * edited after signing and carries no authority.
 */
export function assertRecordIntegrity(record, name) {
  const { record_id, ...rest } = record;
  if (typeof record_id !== 'string' || record_id.length === 0) {
    throw new AcquisitionRefusal(`acquire refuses: gate record ${name} carries no record_id (DR-4.3)`);
  }
  if (record_id !== contentAddress(rest)) {
    throw new AcquisitionRefusal(`acquire refuses: gate record ${name} record_id does not match its content (edited after acceptance; no authority)`);
  }
  return record_id;
}

/** Non-empty-string assertion for a required gate-record field. */
function requireString(record, key, name) {
  const v = record[key];
  if (typeof v !== 'string' || v.length === 0) throw new AcquisitionRefusal(`acquire refuses: ${name}.${key} must be a non-empty string`);
  return v;
}

/** Non-empty string-array assertion for a required scope field. */
function requireStringArray(obj, key, name, { allowEmpty = false } = {}) {
  const v = obj[key];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || x.length === 0)) {
    throw new AcquisitionRefusal(`acquire refuses: ${name}.${key} must be an array of non-empty strings`);
  }
  if (!allowEmpty && v.length === 0) throw new AcquisitionRefusal(`acquire refuses: ${name}.${key} must not be empty`);
  if (new Set(v).size !== v.length) throw new AcquisitionRefusal(`acquire refuses: ${name}.${key} carries duplicate entries`);
  return v;
}

/**
 * Validate the Gate-A acceptance record against the LIVE apparatus identity.
 * The record is read-only historical evidence; drift is reported as stale authority,
 * never repaired here (FR-A4: HALT → re-accept at a new identity → fresh G0).
 *
 * @param {Object} record
 * @param {{companion_digest:string, asset_count:number}} live
 * @returns {string} the Gate-A record id
 */
export function validateGateAAcceptance(record, live) {
  const name = 'gate-a-acceptance.json';
  if (record.record_kind !== 'gate-a-acceptance') throw new AcquisitionRefusal(`acquire refuses: ${name} record_kind must be "gate-a-acceptance"`);
  if (record.gate !== 'A') throw new AcquisitionRefusal(`acquire refuses: ${name} gate must be "A"`);
  if (record.cycle !== 'cycle-005') throw new AcquisitionRefusal(`acquire refuses: ${name} cycle must be "cycle-005"`);
  const recordId = assertRecordIntegrity(record, name);
  const accepted = requireString(record, 'manifest_companion_digest', name);
  if (accepted !== live.companion_digest) {
    throw new AcquisitionRefusal(
      `acquire refuses: STALE GATE-A AUTHORITY — the accepted apparatus identity ${accepted} is not the live identity ${live.companion_digest}. ` +
      'The existing acceptance record stands as historical evidence; contact requires a fresh Gate-A acceptance at the current identity (FR-A4).',
    );
  }
  if ('apparatus_asset_count' in record && record.apparatus_asset_count !== live.asset_count) {
    throw new AcquisitionRefusal(`acquire refuses: ${name} apparatus_asset_count ${record.apparatus_asset_count} != live asset count ${live.asset_count}`);
  }
  return recordId;
}

/**
 * The contact parameters a route template REQUIRES, derived from the frozen route
 * table itself. The credential placeholder is never among them: contact.js injects
 * the credential from env immediately before URL construction and refuses a
 * caller-supplied one (G4).
 *
 * @param {string} routeId
 * @returns {Set<string>}
 */
export function requiredContactParams(routeId) {
  if (!ROUTES[routeId]) throw new AcquisitionRefusal(`acquire refuses: unknown route id "${routeId}" (not in the Gate-A allowlist)`);
  const { path, query } = templateParams(routeId);
  const out = new Set([...path, ...query]);
  out.delete(CREDENTIAL_PARAM_NAME);
  return out;
}

/**
 * Validate the G0 authorization record: it must reference THIS Gate-A record and the
 * live apparatus identity, and its scope must be executable against the frozen route
 * table without a single unauthorized provider, method, route class or parameter.
 *
 * @param {Object} record
 * @param {{gateARecordId:string, companion_digest:string, methodSet:Object}} ctx
 * @returns {{record_id:string, method_ids:string[], excluded_method_ids:string[], contact_params:Object}}
 */
export function validateG0Authorization(record, { gateARecordId, companion_digest, methodSet }) {
  const name = 'g0-authorization.json';
  if (record.record_kind !== 'g0-authorization') throw new AcquisitionRefusal(`acquire refuses: ${name} record_kind must be "g0-authorization"`);
  if (record.cycle !== 'cycle-005') throw new AcquisitionRefusal(`acquire refuses: ${name} cycle must be "cycle-005"`);
  const recordId = assertRecordIntegrity(record, name);
  requireString(record, 'operator_statement', name);
  requireString(record, 'at', name);

  const gateRef = requireString(record, 'gate_a_ref', name);
  if (gateRef !== gateARecordId) {
    throw new AcquisitionRefusal(`acquire refuses: ${name} gate_a_ref ${gateRef} does not reference the current Gate-A record ${gateARecordId}`);
  }
  const apparatusRef = requireString(record, 'apparatus_manifest_companion_digest', name);
  if (apparatusRef !== companion_digest) {
    throw new AcquisitionRefusal(`acquire refuses: ${name} apparatus_manifest_companion_digest ${apparatusRef} is not the live apparatus identity ${companion_digest}`);
  }

  const scope = record.scope;
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) throw new AcquisitionRefusal(`acquire refuses: ${name} scope block required`);
  const scopeName = `${name} scope`;
  const providers = requireStringArray(scope, 'providers', scopeName);
  const methodIds = requireStringArray(scope, 'method_ids', scopeName);
  const routeClasses = requireStringArray(scope, 'route_classes', scopeName);
  const excludedMethodIds = requireStringArray(scope, 'excluded_method_ids', scopeName, { allowEmpty: true });
  const excludedProviders = requireStringArray(scope, 'excluded_providers', scopeName, { allowEmpty: true });

  if (scope.credential_posture !== EXECUTABLE_CREDENTIAL_POSTURE) {
    throw new AcquisitionRefusal(
      `acquire refuses: ${scopeName}.credential_posture must be "${EXECUTABLE_CREDENTIAL_POSTURE}" — this apparatus executes no credentialed route; ` +
      'authorizing a credential is an operator-reserved act requiring a new apparatus identity',
    );
  }

  // The authorized and excluded method ids must PARTITION the frozen route table:
  // every route is either authorized or explicitly excluded, never silently omitted.
  const allRouteIds = Object.keys(ROUTES).sort();
  const overlap = methodIds.filter(id => excludedMethodIds.includes(id));
  if (overlap.length > 0) throw new AcquisitionRefusal(`acquire refuses: ${scopeName} method(s) both authorized and excluded: ${overlap.join(', ')}`);
  const declared = [...methodIds, ...excludedMethodIds].sort();
  const unknown = declared.filter(id => !(id in ROUTES));
  if (unknown.length > 0) throw new AcquisitionRefusal(`acquire refuses: ${scopeName} names route id(s) absent from the frozen table: ${unknown.join(', ')}`);
  const undeclared = allRouteIds.filter(id => !declared.includes(id));
  if (undeclared.length > 0) {
    throw new AcquisitionRefusal(`acquire refuses: ${scopeName} does not dispose of every frozen route — undeclared: ${undeclared.join(', ')} (authorize or exclude explicitly)`);
  }

  // Every authorized route must be uncredentialed, in an authorized route class, and
  // present in the accepted method set. Any credentialed route must be excluded.
  const candidates = (methodSet && typeof methodSet.candidates === 'object' && methodSet.candidates !== null) ? methodSet.candidates : null;
  if (candidates === null) throw new AcquisitionRefusal(`acquire refuses: accepted method set carries no candidates block (${METHOD_SET_REL})`);
  const byMethodId = new Map();
  for (const [key, c] of Object.entries(candidates)) {
    if (c === null || typeof c !== 'object') throw new AcquisitionRefusal(`acquire refuses: method set candidate "${key}" is not an object`);
    byMethodId.set(c.route_method_id, c);
  }

  const authorizedProviders = new Set();
  const contactParams = {};
  const scopeParams = scope.contact_params === undefined ? {} : scope.contact_params;
  if (scopeParams === null || typeof scopeParams !== 'object' || Array.isArray(scopeParams)) {
    throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params must be an object keyed by method_id`);
  }
  for (const key of Object.keys(scopeParams)) {
    if (!methodIds.includes(key)) throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params names unauthorized method "${key}"`);
  }

  for (const id of methodIds) {
    const route = ROUTES[id];
    if (route.credential !== null) {
      throw new AcquisitionRefusal(`acquire refuses: ${scopeName} authorizes credentialed route "${id}" (credential ${route.credential}) under an uncredentialed posture`);
    }
    if (!routeClasses.includes(route.route_class)) {
      throw new AcquisitionRefusal(`acquire refuses: ${scopeName} authorizes "${id}" whose route_class "${route.route_class}" is not in route_classes [${routeClasses.join(', ')}]`);
    }
    if (!(id in ROUTE_DECL) || !RESPONSE_DECLS[ROUTE_DECL[id]]) {
      throw new AcquisitionRefusal(`acquire refuses: no response declaration for authorized method "${id}" — the guard could not clear its response (fail-closed, pre-contact)`);
    }
    if (typeof extractors[id] !== 'function') {
      throw new AcquisitionRefusal(`acquire refuses: no extractor for authorized method "${id}" (fail-closed, pre-contact)`);
    }
    const candidate = byMethodId.get(id);
    if (!candidate) throw new AcquisitionRefusal(`acquire refuses: authorized method "${id}" has no candidate in the accepted method set`);
    if (typeof candidate.provider !== 'string' || !providers.includes(candidate.provider)) {
      throw new AcquisitionRefusal(`acquire refuses: ${scopeName} authorizes "${id}" whose provider "${candidate.provider}" is not in providers [${providers.join(', ')}]`);
    }
    authorizedProviders.add(candidate.provider);

    // Pinned parameters: EXACTLY the placeholders the frozen template requires — no
    // missing param (unconstructable URL) and no extra param (unauthorized input).
    // A PATH placeholder additionally carries bounded path-SEGMENT data: the G0 record
    // chooses WHICH pinned identifier a template names, never WHICH path of an
    // allowlisted host it resolves to. Refused here (pre-contact) and again in
    // routes.js at URL construction — two independent layers (F1).
    const required = requiredContactParams(id);
    const pathParams = new Set(templateParams(id).path);
    const supplied = scopeParams[id] === undefined ? {} : scopeParams[id];
    if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {
      throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params["${id}"] must be an object`);
    }
    const suppliedKeys = Object.keys(supplied);
    if (suppliedKeys.includes(CREDENTIAL_PARAM_NAME)) {
      throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params["${id}"] carries "${CREDENTIAL_PARAM_NAME}" — a credential is never a scope parameter (G4)`);
    }
    for (const k of suppliedKeys) {
      if (!required.has(k)) throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params["${id}"] carries unauthorized parameter "${k}" (template requires: ${[...required].join(', ') || 'none'})`);
      const v = supplied[k];
      if (typeof v !== 'string' || v.length === 0) throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params["${id}"].${k} must be a non-empty string`);
      if (pathParams.has(k)) {
        try {
          assertPathParamValue(k, v, `${scopeName}.contact_params["${id}"]`);
        } catch (e) {
          throw new AcquisitionRefusal(`acquire refuses: ${e.message}`);
        }
      }
    }
    for (const k of required) {
      if (!suppliedKeys.includes(k)) throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.contact_params["${id}"] is missing pinned parameter "${k}" required by the frozen template`);
    }
    contactParams[id] = { ...supplied };
  }

  // No dangling provider authority, and the exclusion list must name exactly the
  // providers that acquire no authorized method under this scope.
  const dangling = providers.filter(p => !authorizedProviders.has(p));
  if (dangling.length > 0) throw new AcquisitionRefusal(`acquire refuses: ${scopeName}.providers names provider(s) with no authorized method: ${dangling.join(', ')}`);
  const excludedActual = new Set();
  for (const id of excludedMethodIds) {
    const c = byMethodId.get(id);
    if (c && typeof c.provider === 'string' && !authorizedProviders.has(c.provider)) excludedActual.add(c.provider);
  }
  const expectedExcluded = [...excludedActual].sort();
  const declaredExcluded = [...excludedProviders].sort();
  if (expectedExcluded.join('|') !== declaredExcluded.join('|')) {
    throw new AcquisitionRefusal(
      `acquire refuses: ${scopeName}.excluded_providers [${declaredExcluded.join(', ')}] does not match the providers excluded by scope [${expectedExcluded.join(', ')}]`,
    );
  }

  return { record_id: recordId, method_ids: [...methodIds], excluded_method_ids: [...excludedMethodIds], contact_params: contactParams };
}

/**
 * Read the operator's UD-1 acceptance for one candidate/field out of the Gate-A
 * record. Fail-closed: anything other than an explicit `accepted` status is NOT an
 * acceptance, so an unrecognised shape trends the field to FR-A6 (iii) → §9.1 class 3,
 * never to a lawful gate input.
 */
export function operatorAcceptedFields(gateA, rank) {
  const out = {};
  const ud1 = gateA && typeof gateA.ud1_status === 'object' && gateA.ud1_status !== null ? gateA.ud1_status : {};
  for (const field of MEASURED_FIELDS) {
    const block = ud1[field];
    const perCandidate = block && typeof block === 'object' && block.candidates && typeof block.candidates === 'object' ? block.candidates[String(rank)] : null;
    out[field] = Boolean(block && block.decision === 'accepted' && perCandidate && perCandidate.status === 'accepted');
  }
  return out;
}

/**
 * Derive the authorized, rank-ordered candidate list from the accepted method set,
 * the frozen route table and the validated G0 scope. Nothing outside this
 * intersection can enter execution.
 *
 * @returns {Array<Object>} rank-ascending candidates for {@link acquirePool}
 */
export function deriveAuthorizedCandidates({ methodSet, g0, gateA }) {
  const out = [];
  for (const [key, c] of Object.entries(methodSet.candidates)) {
    if (!g0.method_ids.includes(c.route_method_id)) continue;
    const rank = Number.isInteger(c.rank) ? c.rank : Number(key);
    if (!Number.isInteger(rank) || rank < 1) throw new AcquisitionRefusal(`acquire refuses: method set candidate "${key}" carries no positive integer rank`);
    out.push({
      rank,
      provider: c.provider,
      product: c.product,
      route_method_id: c.route_method_id,
      route_class: ROUTES[c.route_method_id].route_class, // the route table is the authority (never a default)
      contact_params: g0.contact_params[c.route_method_id] || {},
      authored_inputs: c.authored_inputs,
      measured_methods: c.measured_methods,
      operator_accepted: operatorAcceptedFields(gateA, rank),
    });
  }
  if (out.length !== g0.method_ids.length) {
    throw new AcquisitionRefusal(`acquire refuses: derived ${out.length} candidate(s) for ${g0.method_ids.length} authorized method(s) — scope and method set disagree`);
  }
  out.sort((a, b) => a.rank - b.rank);
  const ranks = out.map(c => c.rank);
  if (new Set(ranks).size !== ranks.length) throw new AcquisitionRefusal(`acquire refuses: duplicate candidate ranks in the authorized scope [${ranks.join(', ')}]`);
  return out;
}

/**
 * The complete pre-contact authority check (FR-B1 + DR-2 + G0 scope binding).
 * Performs NO transport. Throws {@link AcquisitionRefusal} on any breach.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.evidenceDir
 * @returns {{companion_digest:string, asset_count:number, gate_a_record_id:string, g0_record_id:string, candidates:Array<Object>, excluded_method_ids:string[]}}
 */
export function verifyContactAuthority({ repoRoot, evidenceDir }) {
  // A governing HALT is the strongest prohibition in the cycle: refuse before the
  // identity self-verify, before pin-invariance preparation, before any evidence
  // mutation and before any transport.
  assertNoGoverningHalt(evidenceDir);
  const manifestPath = join(evidenceDir, 'acquisition-manifest.json');
  const live = selfVerifyAcquisitionManifest({ repoRoot, manifestPath });
  assertGateRecordsPresent(evidenceDir);

  const gateA = readGateRecord(evidenceDir, 'gate-a-acceptance.json');
  const gateARecordId = validateGateAAcceptance(gateA, live);

  const methodSetPath = join(repoRoot, METHOD_SET_REL);
  if (!existsSync(methodSetPath)) throw new AcquisitionRefusal(`acquire refuses: accepted method set absent: ${METHOD_SET_REL}`);
  let methodSet;
  try { methodSet = JSON.parse(readFileSync(methodSetPath, 'utf8')); } catch (e) { throw new AcquisitionRefusal(`acquire refuses: malformed method set JSON: ${e.message}`); }

  const g0Record = readGateRecord(evidenceDir, 'g0-authorization.json');
  const g0 = validateG0Authorization(g0Record, { gateARecordId, companion_digest: live.companion_digest, methodSet });
  const candidates = deriveAuthorizedCandidates({ methodSet, g0, gateA });

  return {
    companion_digest: live.companion_digest,
    asset_count: live.asset_count,
    gate_a_record_id: gateARecordId,
    g0_record_id: g0.record_id,
    candidates,
    excluded_method_ids: g0.excluded_method_ids,
  };
}

/**
 * Validate the `pin-invariance-g0` evidence prepared immediately before first
 * contact (FR-E3 / Sprint Plan T2.1). The record itself is produced by the Lane B
 * verifier — G9 forbids importing it here — so the operator entry point supplies it
 * through `io.preparePinInvariance`, and this apparatus refuses to proceed unless it
 * attests 43/43 + companion with no mismatches.
 */
export function assertPinInvarianceRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new AcquisitionRefusal('acquire refuses: pin-invariance evidence is not a record');
  if (record.record_kind !== 'pin-invariance') throw new AcquisitionRefusal('acquire refuses: pin-invariance record_kind must be "pin-invariance"');
  if (record.event !== 'g0') throw new AcquisitionRefusal(`acquire refuses: pin-invariance event must be "g0" immediately before first contact (got "${record.event}")`);
  if (record.all_match !== true) throw new AcquisitionRefusal('acquire refuses: pin-invariance all_match is not true (pinned-asset drift — void condition 1)');
  if (record.companion_match !== true) throw new AcquisitionRefusal('acquire refuses: pin-invariance companion_match is not true');
  if (!Array.isArray(record.mismatches) || record.mismatches.length !== 0) throw new AcquisitionRefusal('acquire refuses: pin-invariance reports mismatches');
  return record;
}

// ─── Evidence appenders ────────────────────────────────────────────────────────

/** Append a FR-B4 contact-log line (wall-clock governance record, DR-10.3). */
function appendContactLog(contactLogPath, line, seq) {
  const rec = { record_kind: 'contact-log', seq, ...line };
  appendLedgerLine(contactLogPath, rec);
  return rec;
}

/** Append a DR-3 contamination event (NEVER the exposed values, per G3). */
function appendContaminationEvent(contaminationPath, { seq, candidate_rank, exposure_class, contact_ref, halt_ref, halt_record_id, at }) {
  const rec = {
    record_kind: 'contamination-event',
    seq,
    event: 'value_boundary_breach',
    candidate_rank,
    exposure_class,
    resulting_classification: 'class4_contamination',
    contact_ref,
    halt_ref,
    halt_record_id,
    at,
    adjudication_ref: null,
  };
  appendLedgerLine(contaminationPath, rec);
  return rec;
}

// ─── DR-3 step (5): the durable contamination HALT record ──────────────────────

/**
 * The contamination HALT record's filename (SDD §7 `halt-<n>.json`). A DR-3
 * contamination HALT is TERMINAL for the whole apparatus — further contact is
 * prohibited until the operator adjudicates (NFR-CONTAM-2) — so at most ONE HALT
 * record can lawfully exist per evidence directory. A pre-existing record means an
 * unadjudicated prior HALT: {@link writeContaminationHalt} refuses rather than
 * overwrite it or silently allocate `halt-2.json`.
 */
export const HALT_RECORD_NAME = 'halt-1.json';

/**
 * The SDD §7 governing-HALT filename pattern (`halt-<n>.json`), any allocation.
 * Matched case-INSENSITIVELY: on a case-insensitive filesystem a differently-cased
 * name is the SAME file the writer would collide with, so a case-exact match would
 * be a way to hide a governing record from this gate. Over-matching here can only
 * refuse; under-matching could contact.
 */
const HALT_RECORD_RE = /^halt-\d+\.json$/i;

/**
 * Every governing Cycle-005 HALT record currently on disk, by filename, sorted.
 * Reads the whole `halt-<n>.json` namespace rather than only
 * {@link HALT_RECORD_NAME}: a HALT written under any allocation still governs.
 *
 * @param {string} evidenceDir
 * @returns {string[]}
 */
export function findHaltRecords(evidenceDir) {
  if (!existsSync(evidenceDir)) return [];
  return readdirSync(evidenceDir).filter(n => HALT_RECORD_RE.test(n)).sort();
}

/**
 * STRUCTURE-ONLY description of a HALT record for a refusal message: its class and
 * whether its DR-4.3 self-excluded `record_id` verifies. Never its prose, never a
 * provider value, never a raw fragment. Malformed or conflicting evidence is
 * described as such — it is a reason to fail closed, never a reason to proceed.
 */
function describeHaltRecord(path) {
  let rec;
  try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch { return 'unreadable or malformed JSON — fails closed'; }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return 'not a JSON object — fails closed';
  if (rec.record_kind !== 'halt') return 'record_kind is not "halt" — conflicting HALT evidence, fails closed';
  if (rec.cycle !== 'cycle-005') return 'not a cycle-005 record — conflicting HALT evidence, fails closed';
  const cls = typeof rec.class === 'string' && /^[a-z-]{1,32}$/.test(rec.class) ? rec.class : '(unrecognised class)';
  const { record_id, ...rest } = rec;
  let verified = false;
  try { verified = typeof record_id === 'string' && record_id === contentAddress(rest); } catch { verified = false; }
  return verified ? `class ${cls}, record_id ${record_id} verifies` : `class ${cls}, record_id does NOT verify — fails closed`;
}

/**
 * Fail-closed authority gate: refuse while ANY governing Cycle-005 HALT record is
 * on disk. A HALT is terminal for the whole apparatus — it prohibits further
 * contact within this cycle until a separate operator-governed adjudication
 * mechanism explicitly authorizes otherwise (NFR-CONTAM-2), and no such mechanism
 * exists in this apparatus. Malformed or conflicting HALT evidence refuses too:
 * an unreadable governing record is a reason to stop, never a reason to continue.
 *
 * Called at the top of {@link verifyContactAuthority} AND at the top of
 * {@link acquirePool}, so the refusal precedes pin-invariance preparation, any
 * evidence mutation and any transport — on the CLI path and for a direct caller
 * alike. Nothing is written, no contact-log sequence restarts, and every existing
 * record is left byte-for-byte intact.
 *
 * @param {string} evidenceDir
 * @returns {string[]} the (empty) HALT-record list when execution may proceed
 */
export function assertNoGoverningHalt(evidenceDir) {
  const names = findHaltRecords(evidenceDir);
  if (names.length === 0) return names;
  const described = names.map(n => `${n} [${describeHaltRecord(join(evidenceDir, n))}]`);
  throw new AcquisitionRefusal(
    `acquire refuses: a governing Cycle-005 HALT record is already on disk — ${described.join('; ')}. ` +
    'A HALT prohibits all further contact within this cycle until an operator-governed adjudication explicitly authorizes otherwise (NFR-CONTAM-2). ' +
    'No provider is contacted, no contact-log line is appended, no sequence numbering restarts, and every existing record is left byte-for-byte intact.',
  );
}

// ─── One-shot execution: prior-run evidence prohibits a second acquisition ─────

/**
 * The durable evidence ledgers whose presence means a Cycle-005 acquisition run has
 * already begun. `contact-log.jsonl` is the EARLIEST of the three — {@link acquirePool}
 * appends a candidate's contact-log line before any provenance row, census-input
 * file, contamination event or HALT record — so a non-empty log is the marker for
 * "contact has begun", whether the run completed, landed class 3, halted, or was
 * interrupted part-way through the pool. The other two are read as well so a
 * partially cleaned evidence directory still fails closed.
 *
 * Deriving the state from evidence already written is deliberate: no new one-shot
 * record, marker file or resume protocol is introduced, so there is nothing extra to
 * keep consistent with the ledgers it would describe.
 */
const RUN_EVIDENCE_LEDGERS = Object.freeze(['contact-log.jsonl', 'acquisition-provenance.jsonl', 'contamination-events.jsonl']);

/** The DR-4.4 census-input directory a candidate that resolved class 1/2 writes into. */
const RUN_EVIDENCE_METADATA_DIR = 'metadata';

/**
 * Everything on disk that shows a Cycle-005 acquisition already ran. A ledger that is
 * absent, or present at ZERO bytes (the tracked, never-written baseline state of
 * `contamination-events.jsonl`), is not evidence of a run. Anything present that is
 * not a regular file is reported too — unreadable governing evidence is a reason to
 * stop, never a reason to continue.
 *
 * The census-input directory is read as well. Under this apparatus's own ordering a
 * census-input file can only follow a contact-log line, so that check is unreachable
 * from any path a run can take; it catches a hand-edited evidence directory whose log
 * was removed but whose acquired results were not.
 *
 * @param {string} evidenceDir
 * @returns {Array<{name:string, detail:string}>}
 */
export function findPriorAcquisitionEvidence(evidenceDir) {
  const found = [];
  for (const name of RUN_EVIDENCE_LEDGERS) {
    let st;
    try { st = statSync(join(evidenceDir, name)); } catch { continue; } // absent — no evidence of a prior run here
    if (!st.isFile()) found.push({ name, detail: 'present but not a regular file — fails closed' });
    else if (st.size > 0) found.push({ name, detail: `${st.size} bytes` });
  }
  let entries;
  try { entries = readdirSync(join(evidenceDir, RUN_EVIDENCE_METADATA_DIR)); } catch { entries = []; }
  if (entries.length > 0) found.push({ name: `${RUN_EVIDENCE_METADATA_DIR}/`, detail: `${entries.length} census-input file(s)` });
  return found;
}

/**
 * Fail-closed one-shot gate: refuse to execute while ANY Cycle-005 acquisition
 * evidence is already on disk. Cycle-005 acquisition is one-shot per authorized run
 * (FR-A5 is a COMPLETE-POOL pass, not a resumable one), and `contactSeq` restarts at
 * 0 on every entry to {@link acquirePool} — so a second run over an evidence
 * directory that already holds a log would append duplicate `seq` values and
 * duplicate `contact_ref` identities to the evidence the first run earned, silently
 * de-referencing the provenance rows that point at them.
 *
 * Called at the top of {@link acquirePool} — after {@link assertNoGoverningHalt}, so a
 * contamination HALT remains governed by the HALT rule and keeps its own refusal —
 * and again in {@link main} before `io.preparePinInvariance`, so on the CLI path the
 * refusal precedes pin-invariance preparation as well as every transport. Nothing is
 * written and every existing record is left byte-for-byte intact.
 *
 * `--preflight` is deliberately NOT gated: it performs no transport under any
 * circumstances and appends nothing, and inspecting the authority chain is exactly
 * what an operator holding a completed run needs to be able to do.
 *
 * No override, resume flag or environment escape is offered. Deciding what to do with
 * a completed or partial run — a fresh evidence directory, or adjudication of the
 * evidence already earned — is operator-reserved, and this apparatus has no path to it.
 *
 * @param {string} evidenceDir
 * @returns {Array<Object>} the (empty) prior-evidence list when execution may proceed
 */
export function assertNoPriorAcquisition(evidenceDir) {
  const found = findPriorAcquisitionEvidence(evidenceDir);
  if (found.length === 0) return found;
  const described = found.map(f => `${f.name} [${f.detail}]`);
  throw new AcquisitionRefusal(
    `acquire refuses: Cycle-005 acquisition evidence already exists — ${described.join('; ')}. ` +
    'Acquisition is ONE-SHOT per authorized run: contact has already begun (a completed, class-3, halted or interrupted run). ' +
    'Re-running would restart contact-log sequence numbering at 0, appending duplicate `seq` values and duplicate `contact_ref` ' +
    'identities to the evidence already earned. No provider is contacted, no contact-log line is appended, and every existing ' +
    'record is left byte-for-byte intact. Resuming or restarting is an operator-governed decision (a fresh evidence directory, ' +
    'or adjudication of the existing evidence); this apparatus offers no path to either.',
  );
}

/**
 * Build the SDD §6.5 / §7 HALT record body for a class-4 contamination (`class:
 * "contamination"`). Structure + provenance ONLY: the candidate identity, the
 * exposure class, the guard events, the pointer to the contact-log line, and the
 * blast radius. NEVER an exposed provider value, a raw response fragment, a URL, or
 * a credential (G3/G4) — the guard's prose reasons are deliberately not copied here.
 *
 * @returns {Object} the record body WITHOUT `record_id` (computed at write)
 */
export function buildContaminationHaltRecord({ candidate_rank, provider, product, method_id, route_class, exposure_class, guard_events, contact_ref, not_attempted_ranks, at }) {
  if (!Number.isInteger(candidate_rank) || candidate_rank < 1) throw new AcquisitionRefusal('acquire refuses: HALT record requires a positive integer candidate_rank');
  if (typeof at !== 'string' || at.length === 0) throw new AcquisitionRefusal('acquire refuses: HALT record requires a wall-clock `at` (DR-10.3)');
  return {
    record_kind: 'halt',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    class: 'contamination',
    evidence: {
      candidate_rank,
      provider,
      product,
      method_id,
      route_class,
      exposure_class,
      guard_events: [...(guard_events || [])],
      note: 'guards.js classified the response value-bearing or indeterminate (DR-3 G2). The response bytes were never persisted (G3); no exposed value, response fragment, URL or credential appears in this record.',
    },
    blast_radius: {
      further_contact_prohibited: true,
      halted_at_rank: candidate_rank,
      not_attempted_ranks: [...(not_attempted_ranks || [])],
      operator_adjudication_required: 'NFR-CONTAM-2',
    },
    refs: {
      contact_log: 'contact-log.jsonl',
      contact_ref,
      contamination_events: 'contamination-events.jsonl',
    },
    at,
  };
}

/**
 * Write the governing HALT record ONE-SHOT and atomically (DR-4.3 self-excluded
 * `record_id`; DR-10 canonical + atomic). Returns the written record so the
 * contamination event can reference an artifact that already exists on disk — a
 * `halt_ref` is never appended before the record it names.
 *
 * @param {string} evidenceDir
 * @param {Object} body - from {@link buildContaminationHaltRecord}
 * @returns {{path:string, name:string, record:Object}}
 */
function writeContaminationHalt(evidenceDir, body) {
  const path = join(evidenceDir, HALT_RECORD_NAME);
  const record = { ...body, record_id: contentAddress(body) };
  writeCanonicalJsonAtomic(path, record);
  return { path, name: HALT_RECORD_NAME, record };
}

/**
 * Fail-closed one-shot write check: refuse to write a contamination HALT while any
 * governing HALT record exists. Runs BEFORE any evidence for this candidate is
 * appended, so a duplicate leaves no partial contamination trail — and never
 * overwrites the existing record. Delegates the "does a HALT govern?" question to
 * {@link assertNoGoverningHalt} so the write path and the authority path share one
 * interpretation. Defence in depth behind the pool-entry gate: unreachable within a
 * single run, and insurance against a future caller that bypasses it.
 */
function assertHaltRecordAvailable(evidenceDir) {
  assertNoGoverningHalt(evidenceDir);
  return join(evidenceDir, HALT_RECORD_NAME);
}

/**
 * Acquire the complete pool (FR-A5) in frozen rank order, one attempt per candidate,
 * no retry. `candidates` is the authorized subset of the accepted method set; each
 * carries `{ rank, provider, product, route_method_id, authored_inputs,
 * measured_methods, contact_params, operator_accepted }`. `route_class` is taken from
 * the frozen route table, never from the candidate record.
 *
 * A contact or extraction refusal is EVIDENCED (contact-log line + §9.1 class 3) and
 * the loop continues — a lawful class-3 outcome never abandons the pool nor erases
 * the evidence already earned by earlier candidates. The DR-3 contamination procedure
 * (value-bearing OR indeterminate) short-circuits the loop immediately, writes the
 * governing `halt-<n>.json` record, and is never softened. A HALT record that cannot
 * be written (one-shot breach or IO fault) aborts the pool — contact never continues
 * past a contamination the apparatus could not evidence.
 *
 * @returns {Promise<{results:Array<Object>, halted:boolean, contamination:(Object|null)}>}
 */
export async function acquirePool({ candidates, evidenceDir, io = {}, now = () => new Date().toISOString() }) {
  // Second layer of the same gate, for a caller that did not come through
  // verifyContactAuthority: an unadjudicated HALT means ZERO transport and zero
  // evidence mutation, not one contact and then a refusal.
  assertNoGoverningHalt(evidenceDir);
  // …and this pool is ONE-SHOT: evidence from a prior run (complete, class-3, halted
  // or interrupted) prohibits a second pass over the same evidence directory, because
  // `contactSeq` below restarts at 0 and would duplicate the `seq` / `contact_ref`
  // identities the earlier run earned. Ordered AFTER the HALT gate so a contamination
  // HALT keeps its own, stronger refusal.
  assertNoPriorAcquisition(evidenceDir);
  const contactLogPath = join(evidenceDir, 'contact-log.jsonl');
  const provenancePath = join(evidenceDir, 'acquisition-provenance.jsonl');
  const contaminationPath = join(evidenceDir, 'contamination-events.jsonl');
  const fetchImpl = io.fetchImpl;
  const env = io.env || process.env;

  const results = [];
  let contamination = null;
  let contactSeq = 0;

  const ordered = candidates.slice().sort((a, b) => a.rank - b.rank);
  for (let idx = 0; idx < ordered.length; idx++) {
    const c = ordered[idx];
    // The route table is the authority for route_class (never the candidate record).
    const routeClass = ROUTES[c.route_method_id] ? ROUTES[c.route_method_id].route_class : null;
    if (contamination) {
      // A terminal HALT already prohibits contact with every later candidate. Every
      // one of them names the SAME governing HALT record (ref + content id).
      results.push({
        rank: c.rank, provider: c.provider, product: c.product,
        status: 'NOT_ATTEMPTED_DUE_TERMINAL_HALT',
        governing_halt_ref: contamination.halt_ref,
        governing_halt_record_id: contamination.halt_record_id,
      });
      continue;
    }
    const decl = RESPONSE_DECLS[ROUTE_DECL[c.route_method_id]];
    const at0 = now();

    // One attempt, no retry. A refusal (timeout, transport error, redirect escape,
    // unknown route) is a LAWFUL class-3 outcome with its own evidence line — never
    // an uncaught rejection that abandons the pool mid-run.
    let response;
    try {
      response = await contactRoute(c.route_method_id, c.contact_params || {}, { fetchImpl, env });
    } catch (e) {
      // `refusal_class`/`reason_code` name the refusal as raised (transport,
      // redirect, credential, route, non-success status) and `reason` carries the
      // true, URL-redacted message. `http_status` and `url_redacted` are taken from
      // the refusal itself: populated where a response genuinely arrived and a URL
      // was genuinely constructed (the `http_error` path), `null` — never a
      // fabricated code — on every path where no response exists.
      const reason = redactUrl(`${e.name || 'Error'}: ${e.message}`);
      const refusedRec = appendContactLog(contactLogPath, {
        candidate_rank: c.rank, provider: c.provider, product: c.product,
        route_class: routeClass, method_id: c.route_method_id,
        url_redacted: e.url_redacted ?? null, at: at0, outcome_class: 'contact_refused',
        http_status: e.http_status ?? null, content_type: null, byte_length: 0,
        guard_events: [], value_exposure_status: VALUE_EXPOSURE.NONE,
        refusal_class: e.outcome_class || null,
        reason_code: e.outcome_class || 'unclassified_refusal',
        reason,
      }, contactSeq++);
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', reason, contact_ref: refusedRec.seq });
      continue;
    }

    const guard = guardResponse(decl, response);
    const at = now();

    if (guard.value_exposure_status === VALUE_EXPOSURE.DETECTED || guard.value_exposure_status === VALUE_EXPOSURE.INDETERMINATE) {
      // DR-3 contamination procedure: class 4, HALT, later candidates NOT_ATTEMPTED.
      // Order is load-bearing: the one-shot check runs BEFORE any evidence for this
      // candidate is appended, and the HALT record is on disk BEFORE the contamination
      // event that references it — a `halt_ref` can never dangle.
      assertHaltRecordAvailable(evidenceDir);
      const contactRec = appendContactLog(contactLogPath, {
        candidate_rank: c.rank, provider: c.provider, product: c.product,
        route_class: routeClass, method_id: c.route_method_id,
        url_redacted: response.url_redacted, at, outcome_class: 'contamination_detected',
        http_status: response.status,
        content_type: response.contentType, byte_length: response.bodyBuffer.length,
        guard_events: guard.guard_events, value_exposure_status: guard.value_exposure_status,
        reason_code: guard.reason_code, reason: guard.reasons.join('; '),
      }, contactSeq++);
      const halt = writeContaminationHalt(evidenceDir, buildContaminationHaltRecord({
        candidate_rank: c.rank, provider: c.provider, product: c.product,
        method_id: c.route_method_id, route_class: routeClass,
        exposure_class: guard.value_exposure_status, guard_events: guard.guard_events,
        contact_ref: contactRec.seq,
        not_attempted_ranks: ordered.slice(idx + 1).map(rest => rest.rank),
        at,
      }));
      const contEvent = appendContaminationEvent(contaminationPath, {
        seq: 0, candidate_rank: c.rank,
        exposure_class: guard.value_exposure_status,
        contact_ref: contactRec.seq, halt_ref: halt.name, halt_record_id: halt.record.record_id, at,
      });
      contamination = { halt_ref: halt.name, halt_record_id: halt.record.record_id, event: contEvent, candidate_rank: c.rank };
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class4_contamination', contact_ref: contactRec.seq, halt_ref: halt.name, halt_record_id: halt.record.record_id });
      continue; // remaining candidates flagged NOT_ATTEMPTED on the next iterations
    }

    // Non-contaminating outcomes. Extraction is attempted BEFORE the contact-log line
    // is written so the recorded `outcome_class` is the truthful per-contact outcome.
    let extracted = null;
    let extractionError = null;
    if (guard.outcome === 'conformant') {
      try {
        extracted = extractors[c.route_method_id](guard.parsed);
      } catch (e) {
        extractionError = `${e.name || 'Error'}: ${e.message}`;
      }
    }
    const outcomeClass = guard.outcome !== 'conformant' ? 'guard_rejected' : (extractionError ? 'extraction_refused' : 'ok');
    // A rejection is never unexplained: the HTTP status of the response that was
    // actually received, the stable code for WHY, and the truthful prose reason —
    // for the guard branch as well as the extraction branch (F3).
    const reasonText = guard.outcome !== 'conformant' ? guard.reasons.join('; ') : extractionError;
    const contactRec = appendContactLog(contactLogPath, {
      candidate_rank: c.rank, provider: c.provider, product: c.product,
      route_class: routeClass, method_id: c.route_method_id,
      url_redacted: response.url_redacted, at, outcome_class: outcomeClass,
      http_status: response.status,
      content_type: response.contentType, byte_length: response.bodyBuffer.length,
      guard_events: guard.guard_events, value_exposure_status: guard.value_exposure_status,
      reason_code: extractionError ? 'extractor_threw' : guard.reason_code,
      ...(reasonText ? { reason: reasonText } : {}),
    }, contactSeq++);

    if (guard.outcome !== 'conformant') {
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', reason: guard.reasons.join('; '), contact_ref: contactRec.seq });
      continue;
    }
    if (extractionError) {
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', reason: extractionError, contact_ref: contactRec.seq });
      continue;
    }

    // Classify each declared field (FR-A6) and record provenance (FR-A7).
    const classifications = {};
    for (const field of MEASURED_FIELDS) {
      const spec = c.measured_methods?.[field] || {};
      const cls = classifyField({
        field,
        value: extracted.fields[field],
        intended_class: spec.intended_class,
        operator_accepted: Boolean(c.operator_accepted?.[field]),
      });
      classifications[field] = cls;
      appendProvenance(provenancePath, {
        candidate_rank: c.rank, provider: c.provider, product: c.product, field,
        method_id: c.route_method_id, classification: cls.classification,
        value_recorded: extracted.fields[field] ?? null, contact_refs: [contactRec.seq], at,
        notes: extracted.notes?.[field] || cls.reason,
      });
    }

    // DR-4.4: a census-input file exists ONLY when every hard-gate input is lawful.
    const hardLawful = HARD_GATE_MEASURED.every(f => classifications[f]?.gate_eligible);
    if (!hardLawful) {
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', classifications, contact_ref: contactRec.seq });
      continue;
    }
    try {
      const metaPath = writeCandidateMetadata(join(evidenceDir, 'metadata'), {
        rank: c.rank, provider: c.provider, product: c.product,
        authored_inputs: c.authored_inputs, measured: extracted.fields,
      });
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class1or2_resolved', metadata_file: metaPath, classifications, contact_ref: contactRec.seq });
    } catch (e) {
      // An assembly refusal is a lawful unresolved outcome for THIS candidate, evidenced
      // and non-fatal to the pool (DR-4.4: no census-input file for an unresolved candidate).
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', reason: `${e.name || 'Error'}: ${e.message}`, classifications, contact_ref: contactRec.seq });
    }
  }
  return { results, halted: contamination !== null, contamination };
}

/** Parse the operator CLI arguments. Unknown arguments are refused (fail-closed). */
export function parseArgs(argv = []) {
  const opts = { execute: false };
  for (const a of argv) {
    if (a === '--execute') opts.execute = true;
    else if (a === '--preflight') opts.execute = false;
    else throw new AcquisitionRefusal(`acquire refuses: unknown argument "${a}" (accepted: --preflight | --execute)`);
  }
  return opts;
}

/**
 * Operator CLI entry point.
 *
 * `--preflight` (default) validates the whole authority chain and reports the
 * candidate scope that WOULD be contacted. It performs no transport under any
 * circumstances. `--execute` additionally requires `io.preparePinInvariance` — the
 * FR-E3 pin-invariance evidence for the `g0` event, produced immediately before the
 * first contact — and then runs the complete-pool acquisition.
 *
 * Exit codes: 0 completed (preflight, or a pool run that ran to the end),
 * 1 refusal (no transport, no partial effect), 2 terminal contamination HALT.
 *
 * @returns {Promise<number>} process exit code
 */
export async function main(argv = [], { repoRoot, evidenceDir, io = {}, now = () => new Date().toISOString(), stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s) } = {}) {
  let args;
  let authority;
  try {
    args = parseArgs(argv);
    authority = verifyContactAuthority({ repoRoot, evidenceDir });
  } catch (e) {
    stderr(`${e.name || 'Error'}: ${e.message}\n`);
    return 1;
  }

  const scopeLines = authority.candidates.map(c => `  rank ${c.rank}  ${c.provider} — ${c.route_method_id} [${c.route_class}] params=${canonicalize(c.contact_params)}`).join('\n');
  stdout(
    `acquire: authority verified\n` +
    `  apparatus identity : ${authority.companion_digest} (${authority.asset_count} assets)\n` +
    `  gate-a record      : ${authority.gate_a_record_id}\n` +
    `  g0 record          : ${authority.g0_record_id}\n` +
    `  authorized scope   : ${authority.candidates.length} candidate(s), rank order\n${scopeLines}\n` +
    `  excluded methods   : ${authority.excluded_method_ids.join(', ') || 'none'}\n`,
  );

  if (!args.execute) {
    stdout('acquire: --preflight — no provider was contacted. Re-run with --execute to acquire under this authority.\n');
    return 0;
  }

  try {
    // One-shot: refuse a second execution over evidence a prior run already earned,
    // BEFORE pin-invariance preparation and therefore before any transport.
    assertNoPriorAcquisition(evidenceDir);
    if (typeof io.preparePinInvariance !== 'function') {
      throw new AcquisitionRefusal('acquire refuses: --execute requires io.preparePinInvariance (the FR-E3 pin-invariance evidence written immediately before first contact, Sprint Plan T2.1)');
    }
    const pin = await io.preparePinInvariance({ event: 'g0', apparatus_identity: authority.companion_digest, g0_record_id: authority.g0_record_id });
    assertPinInvarianceRecord(pin);
  } catch (e) {
    stderr(`${e.name || 'Error'}: ${e.message}\n`);
    return 1;
  }

  let out;
  try {
    out = await acquirePool({ candidates: authority.candidates, evidenceDir, io, now });
  } catch (e) {
    // An apparatus/IO failure mid-pool is a §9.1 class-6 tooling outcome: the
    // evidence already appended stands, the run does not continue, and the operator
    // decides. It is never retried silently (one attempt per candidate).
    stderr(`${e.name || 'Error'}: acquire aborted mid-pool — ${e.message}. Evidence appended before the abort stands; the remaining candidates were not attempted.\n`);
    return 1;
  }
  for (const r of out.results) stdout(`  rank ${r.rank}  ${r.provider} — ${r.status}${r.reason ? ` (${r.reason})` : ''}\n`);
  if (out.halted) {
    stderr(`acquire: TERMINAL HALT — DR-3 contamination at rank ${out.contamination.candidate_rank}. ` +
      `HALT record ${out.contamination.halt_ref} (${out.contamination.halt_record_id}). ` +
      'Further contact is prohibited; NFR-CONTAM-2 operator adjudication is required.\n');
    return 2;
  }
  stdout('acquire: complete-pool acquisition finished.\n');
  return 0;
}
