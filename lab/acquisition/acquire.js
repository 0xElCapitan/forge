/**
 * lab/acquisition/acquire.js
 *
 * Cycle-005 S01 (PRD FR-A5/FR-A7, FR-B1/FR-B4, NFR-CONTAM-1..4, NFR-HALT;
 * SDD DR-2, DR-3 contamination procedure, §6.2/§6.3; Sprint Plan T1.4).
 *
 * The operator acquisition CLI. It REFUSES to run unless (1) an acquisition-manifest
 * self-verify passes (the apparatus is byte-identical to the accepted Gate-A
 * identity) AND (2) the referenced Gate-A acceptance + G0 authorization records are
 * present. The self-verify here is the contact-side SEATBELT — it re-hashes the
 * apparatus against `acquisition-manifest.json` using ONLY Lane-A-allowlisted
 * primitives (`sha256` + LF-normalize + `canonicalize`), independent of the Lane B
 * `identity.js` verifier (G9 forbids importing it). Any drift throws before a single
 * request.
 *
 * Per-candidate (FR-A5 complete-pool) loop: contact (contact.js) → guard (guards.js)
 * → on a G2 value-bearing/indeterminate outcome, execute the DR-3 CONTAMINATION
 * procedure immediately (append contamination event, §9.1 class 4, HALT further
 * contact, mark every later candidate NOT_ATTEMPTED_DUE_TERMINAL_HALT, write a HALT
 * record) — never softened by unpersisted status; else extract → classify → (where
 * lawful) assemble the census-input file. Appends the FR-B4 contact log + FR-A7
 * provenance.
 *
 * S01 CONSTRAINT: built + unit-tested for its REFUSAL and contamination behavior
 * with an INJECTED fetch and fixtures only. NO live provider request occurs in S01
 * (pre-G0). Live contact happens in S02, post-operator-G0, with the real fetch.
 *
 * @module lab/acquisition/acquire
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import { appendLedgerLine } from '../harness/ledgers.js';
import { contactRoute } from './contact.js';
import { guardResponse, RESPONSE_DECLS, VALUE_EXPOSURE } from './guards.js';
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

/** An acquisition refusal — DR-2 self-verify failure or a missing gate record (HALT). */
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

/** Append a FR-B4 contact-log line (wall-clock governance record, DR-10.3). */
function appendContactLog(contactLogPath, line, seq) {
  const rec = { record_kind: 'contact-log', seq, ...line };
  appendLedgerLine(contactLogPath, rec);
  return rec;
}

/** Append a DR-3 contamination event (NEVER the exposed values, per G3). */
function appendContaminationEvent(contaminationPath, { seq, candidate_rank, exposure_class, contact_ref, halt_ref, at }) {
  const rec = {
    record_kind: 'contamination-event',
    seq,
    event: 'value_boundary_breach',
    candidate_rank,
    exposure_class,
    resulting_classification: 'class4_contamination',
    contact_ref,
    halt_ref,
    at,
    adjudication_ref: null,
  };
  appendLedgerLine(contaminationPath, rec);
  return rec;
}

/**
 * Acquire the complete pool (FR-A5). This is the S02 execution body; in S01 it runs
 * only under injected fetch + fixtures. `candidates` is the accepted method set
 * (rank-ordered); each carries `{ rank, provider, product, route_method_id,
 * authored_inputs, measured_methods, contact_params }`. The DR-3 contamination
 * procedure short-circuits the loop on the first value-bearing/indeterminate guard
 * outcome.
 *
 * @returns {Promise<{results:Array<Object>, halted:boolean, contamination:(Object|null)}>}
 */
export async function acquirePool({ candidates, evidenceDir, io = {}, now = () => new Date().toISOString() }) {
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
    if (contamination) {
      // A terminal HALT already prohibits contact with every later candidate.
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'NOT_ATTEMPTED_DUE_TERMINAL_HALT', governing_halt_ref: contamination.halt_ref });
      continue;
    }
    const decl = RESPONSE_DECLS[ROUTE_DECL[c.route_method_id]];
    const response = await contactRoute(c.route_method_id, c.contact_params || {}, { fetchImpl, env });
    const guard = guardResponse(decl, response);
    const at = now();

    if (guard.value_exposure_status === VALUE_EXPOSURE.DETECTED || guard.value_exposure_status === VALUE_EXPOSURE.INDETERMINATE) {
      // DR-3 contamination procedure: class 4, HALT, later candidates NOT_ATTEMPTED.
      const contactRec = appendContactLog(contactLogPath, {
        candidate_rank: c.rank, provider: c.provider, product: c.product,
        route_class: c.route_class || 'metadata', method_id: c.route_method_id,
        url_redacted: response.url_redacted, at, outcome_class: 'contamination_detected',
        content_type: response.contentType, byte_length: response.bodyBuffer.length,
        guard_events: guard.guard_events, value_exposure_status: guard.value_exposure_status,
      }, contactSeq++);
      const haltRef = `halt-contamination-rank-${c.rank}`;
      const contEvent = appendContaminationEvent(contaminationPath, {
        seq: 0, candidate_rank: c.rank,
        exposure_class: guard.value_exposure_status,
        contact_ref: contactRec.seq, halt_ref: haltRef, at,
      });
      contamination = { halt_ref: haltRef, event: contEvent, candidate_rank: c.rank };
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class4_contamination', contact_ref: contactRec.seq });
      continue; // remaining candidates flagged NOT_ATTEMPTED on the next iterations
    }

    // Non-contaminating outcomes: log, then (if conformant) extract → classify → assemble.
    const outcomeClass = guard.outcome === 'conformant' ? 'ok' : 'guard_rejected';
    const contactRec = appendContactLog(contactLogPath, {
      candidate_rank: c.rank, provider: c.provider, product: c.product,
      route_class: c.route_class || 'metadata', method_id: c.route_method_id,
      url_redacted: response.url_redacted, at, outcome_class: outcomeClass,
      content_type: response.contentType, byte_length: response.bodyBuffer.length,
      guard_events: guard.guard_events, value_exposure_status: guard.value_exposure_status,
    }, contactSeq++);

    if (guard.outcome !== 'conformant') {
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', reason: guard.reasons.join('; '), contact_ref: contactRec.seq });
      continue;
    }

    // Extract declared fields, classify each (FR-A6), and record provenance (FR-A7).
    const extracted = extractors[c.route_method_id](guard.parsed);
    const classifications = {};
    for (const field of ['history_years', 'n_observations', 'span']) {
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
    if (hardLawful) {
      const metaPath = writeCandidateMetadata(join(evidenceDir, 'metadata'), {
        rank: c.rank, provider: c.provider, product: c.product,
        authored_inputs: c.authored_inputs, measured: extracted.fields,
      });
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class1or2_resolved', metadata_file: metaPath, classifications, contact_ref: contactRec.seq });
    } else {
      results.push({ rank: c.rank, provider: c.provider, product: c.product, status: 'class3_acq_unresolved', classifications, contact_ref: contactRec.seq });
    }
  }
  return { results, halted: contamination !== null, contamination };
}

/**
 * Operator CLI entry point. Refuses (exit non-zero, no partial effect) unless the
 * self-verify passes AND the gate records are present. In S01 this path is exercised
 * only for its refusal behavior; the acquire body runs live only in S02 (post-G0).
 *
 * @returns {Promise<number>} process exit code
 */
export async function main(argv, { repoRoot, evidenceDir, stderr = (s) => process.stderr.write(s) } = {}) {
  try {
    const manifestPath = join(evidenceDir, 'acquisition-manifest.json');
    selfVerifyAcquisitionManifest({ repoRoot, manifestPath });
    assertGateRecordsPresent(evidenceDir);
  } catch (e) {
    stderr(`${e.name || 'Error'}: ${e.message}\n`);
    return 1;
  }
  stderr('acquire: self-verify + gate records present. Live contact is an S02 operation (post-G0).\n');
  return 0;
}
