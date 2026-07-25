/**
 * lab/resolution/pin-invariance.js
 *
 * Cycle-005 S02 (PRD FR-E3; SDD DR-2/DR-4.3/§7; Sprint Plan T2.1/T2.2;
 * 24-cycle-005-pre-g0-apparatus-audit.md §7; 25-cycle-005-replacement-gate-a-decision-brief.md §5).
 *
 * The PRODUCTION `io.preparePinInvariance` for the `g0` event: the pre-contact
 * pin-invariance boundary that `acquire.js main --execute` requires immediately
 * before the first transport call.
 *
 * The FR-E3 obligation is not "compute a pin verification" — `verify-pins.js`
 * already does that — it is "make the verification DURABLE before the wire is
 * touched". The C-3 interruption window (a crash between the first transport call
 * and the first durable evidence append) exists precisely because, until this
 * record lands, nothing on disk proves a run began. Persisting it BEFORE transport
 * converts that window from a silent restart into an artifact the CLI entry-point
 * one-shot gate refuses on — operator adjudication, not a second contact.
 *
 * This module therefore does four things, in this order, and refuses at each:
 *
 *   1. Refuse if `pin-invariance-g0.json` is ALREADY on disk. A pre-existing
 *      artifact is prior-run evidence, never a slot to overwrite (DR-4.5: status is
 *      conferred by later records, never by editing bytes).
 *   2. Bind the freeze authority: the Gate-A-accepted `freeze_ref.companion_digest`
 *      must equal the live `lab/freeze/freeze-manifest.sha256`.
 *   3. Verify 43/43 pinned Cycle-004 assets + the freeze companion via the frozen
 *      Lane B verifier (`verifyAllPins`) and refuse on ANY drift, any mismatch, or
 *      an asset count that is not the frozen {@link FROZEN_PIN_ASSET_COUNT}.
 *   4. Persist the record through the frozen one-shot writer (canonical + atomic +
 *      DR-4.3 self-excluded `record_id`), then RE-READ it from disk and verify the
 *      persisted bytes. A record that cannot be read back and verified is a refusal
 *      with the artifact left in place — never a proceed.
 *
 * No scientific or hash logic is reimplemented here: `verifyAllPins` +
 * `buildPinInvarianceRecord` (verify-pins.js), `writeOneShotRecord` +
 * `verifyRecordId` (evidence.js) and `canonicalize` are the accepted primitives.
 * This module only composes them and adds the authority binding the record needs to
 * be checkable at the contact boundary.
 *
 * G9 note: `acquire.js` (Lane A) may not import this module — the fence is one-way
 * and deliberate. The operator entry point supplies {@link prepareG0PinInvariance}
 * as `io.preparePinInvariance`, and Lane A re-verifies the persisted artifact
 * independently with its own allowlisted primitives.
 *
 * @module lab/resolution/pin-invariance
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { AcquisitionRefusal } from './identity.js';
import { verifyAllPins, buildPinInvarianceRecord, companionDigestPath } from './verify-pins.js';
import { writeOneShotRecord, verifyRecordId } from './evidence.js';

/** The pre-contact pin-invariance artifact's filename (SDD §7 `pin-invariance-<event>.json`). */
export const PIN_INVARIANCE_G0_NAME = 'pin-invariance-g0.json';

/**
 * The frozen Cycle-004 pinned-asset count. A `pin-invariance-g0` record that attests
 * a different count is not attesting THIS freeze, whatever else it says (SDD §7
 * records `asset_count: 43` in the accepted schema).
 */
export const FROZEN_PIN_ASSET_COUNT = 43;

/** Repo-relative path of the Cycle-004 freeze manifest (the FR-E1 anchor). */
export const FREEZE_MANIFEST_REL = 'lab/freeze/freeze-manifest.json';

/** The single event this module prepares. `gate-a` / `pre-census` / `terminal` are other ceremonies. */
const G0_EVENT = 'g0';

/** Refuse unless `v` is a non-empty string. */
function requireString(v, what) {
  if (typeof v !== 'string' || v.length === 0) throw new AcquisitionRefusal(`pin-invariance refuses: ${what} must be a non-empty string`);
  return v;
}

/**
 * Compose the `g0` pin-invariance record body from the frozen builder plus the
 * authority binding the contact boundary checks: WHICH apparatus prepared it and
 * WHICH freeze and G0 authorization it was prepared under. Without those a record
 * verifying 43/43 is true but unattributable — it could have been produced under any
 * apparatus identity, at any time, for any authorization.
 *
 * Deliberately carries NO wall-clock: every field is a digest or a verification
 * result, so the record is byte-deterministic and its content address is stable
 * (the `buildPinInvarianceRecord` contract).
 *
 * @param {Object} p
 * @param {ReturnType<typeof verifyAllPins>} p.result
 * @param {string} p.apparatus_identity - the live acquisition-manifest companion digest
 * @param {string} p.freeze_companion_digest - the Cycle-004 freeze companion digest
 * @param {string} p.g0_record_id - the governing `g0-authorization.json` record id
 * @returns {Object} the record body WITHOUT `record_id` (computed at write)
 */
export function buildG0PinInvarianceRecord({ result, apparatus_identity, freeze_companion_digest, g0_record_id }) {
  return {
    ...buildPinInvarianceRecord(G0_EVENT, result),
    apparatus_identity,
    freeze_companion_digest,
    refs: { g0: g0_record_id },
  };
}

/**
 * Read the persisted `pin-invariance-g0.json` back from disk and verify it against
 * the authority it claims. Used by {@link prepareG0PinInvariance} immediately after
 * its own write (a write that cannot be read back is a refusal), and available to
 * any caller that needs to re-check the artifact.
 *
 * Malformed, stale (another apparatus identity), mismatched (another freeze or
 * another G0 authorization) or drifted evidence all fail closed. The artifact is
 * never repaired, rewritten or removed — it stays exactly as found.
 *
 * @param {Object} p
 * @param {string} p.evidenceDir
 * @param {string} p.apparatus_identity
 * @param {string} p.freeze_companion_digest
 * @param {string} p.g0_record_id
 * @returns {Object} the verified on-disk record
 */
export function verifyPersistedG0PinInvariance({ evidenceDir, apparatus_identity, freeze_companion_digest, g0_record_id }) {
  const path = join(evidenceDir, PIN_INVARIANCE_G0_NAME);
  let st;
  try { st = statSync(path); } catch { throw new AcquisitionRefusal(`pin-invariance refuses: ${PIN_INVARIANCE_G0_NAME} was not persisted`); }
  if (!st.isFile()) throw new AcquisitionRefusal(`pin-invariance refuses: ${PIN_INVARIANCE_G0_NAME} is present but not a regular file — fails closed`);

  const text = readFileSync(path, 'utf8');
  let rec;
  try { rec = JSON.parse(text); } catch (e) { throw new AcquisitionRefusal(`pin-invariance refuses: malformed ${PIN_INVARIANCE_G0_NAME}: ${e.message}`); }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) throw new AcquisitionRefusal(`pin-invariance refuses: ${PIN_INVARIANCE_G0_NAME} is not a JSON object`);

  if (rec.record_kind !== 'pin-invariance') throw new AcquisitionRefusal('pin-invariance refuses: persisted record_kind must be "pin-invariance"');
  if (rec.cycle !== 'cycle-005') throw new AcquisitionRefusal('pin-invariance refuses: persisted record is not a cycle-005 record');
  if (rec.event !== G0_EVENT) throw new AcquisitionRefusal(`pin-invariance refuses: persisted event must be "${G0_EVENT}" (got "${rec.event}")`);
  if (rec.asset_count !== FROZEN_PIN_ASSET_COUNT) throw new AcquisitionRefusal(`pin-invariance refuses: persisted asset_count must be ${FROZEN_PIN_ASSET_COUNT} (got ${rec.asset_count})`);
  if (rec.all_match !== true) throw new AcquisitionRefusal('pin-invariance refuses: persisted all_match is not true (pinned-asset drift — void condition 1)');
  if (rec.companion_match !== true) throw new AcquisitionRefusal('pin-invariance refuses: persisted companion_match is not true');
  if (!Array.isArray(rec.mismatches) || rec.mismatches.length !== 0) throw new AcquisitionRefusal('pin-invariance refuses: persisted record reports mismatches');
  if (!verifyRecordId(rec)) throw new AcquisitionRefusal('pin-invariance refuses: persisted record_id does not verify — the artifact was edited after it was written');
  if (rec.apparatus_identity !== apparatus_identity) throw new AcquisitionRefusal('pin-invariance refuses: persisted record was prepared under another apparatus identity (STALE PIN EVIDENCE)');
  if (rec.freeze_companion_digest !== freeze_companion_digest) throw new AcquisitionRefusal('pin-invariance refuses: persisted record names another freeze companion digest');
  if (rec.refs === null || typeof rec.refs !== 'object' || rec.refs.g0 !== g0_record_id) throw new AcquisitionRefusal('pin-invariance refuses: persisted record does not reference the governing G0 authorization');
  if (text !== canonicalize(rec) + '\n') throw new AcquisitionRefusal(`pin-invariance refuses: ${PIN_INVARIANCE_G0_NAME} bytes are not the canonical form of the record they contain`);
  return rec;
}

/**
 * The production `io.preparePinInvariance` for the `g0` event: persist and verify
 * `pin-invariance-g0.json` immediately before the first transport call.
 *
 * Returns the RE-READ record, so the caller validates what is on disk rather than
 * what this function intended to write. Any refusal leaves the evidence directory
 * exactly as found except for an artifact that was successfully written and then
 * failed verification — which is deliberately left in place: it is evidence that a
 * run reached the pre-contact boundary, and removing it would restore the silent
 * restart this boundary exists to prevent.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.evidenceDir - lab/evidence/cycle-005
 * @param {string} [p.event] - must be `"g0"`
 * @param {string} p.apparatus_identity - the live acquisition-manifest companion digest
 * @param {string} p.freeze_companion_digest - the Gate-A-accepted `freeze_ref.companion_digest`
 * @param {string} p.g0_record_id
 * @returns {Object} the verified, persisted record
 */
export function prepareG0PinInvariance({ repoRoot, evidenceDir, event = G0_EVENT, apparatus_identity, freeze_companion_digest, g0_record_id }) {
  if (event !== G0_EVENT) throw new AcquisitionRefusal(`pin-invariance refuses: this preparer produces the "${G0_EVENT}" event only (got "${event}")`);
  requireString(repoRoot, 'repoRoot');
  requireString(evidenceDir, 'evidenceDir');
  requireString(apparatus_identity, 'apparatus_identity');
  requireString(freeze_companion_digest, 'freeze_companion_digest');
  requireString(g0_record_id, 'g0_record_id');

  // (1) One-shot: an artifact already on disk is prior evidence, never a slot.
  const path = join(evidenceDir, PIN_INVARIANCE_G0_NAME);
  if (existsSync(path)) {
    throw new AcquisitionRefusal(
      `pin-invariance refuses: ${PIN_INVARIANCE_G0_NAME} already exists — a prior run reached the pre-contact boundary. ` +
      'It is never overwritten: whether that run contacted a provider is an operator-governed adjudication, and this apparatus offers no path to it.',
    );
  }

  // (2) Freeze authority: the accepted anchor must still be the live freeze.
  const freezeManifestPath = join(repoRoot, FREEZE_MANIFEST_REL);
  if (!existsSync(freezeManifestPath)) throw new AcquisitionRefusal(`pin-invariance refuses: freeze manifest absent: ${FREEZE_MANIFEST_REL}`);
  const freezeCompanionPath = companionDigestPath(freezeManifestPath);
  if (!existsSync(freezeCompanionPath)) throw new AcquisitionRefusal(`pin-invariance refuses: freeze companion digest absent: ${companionDigestPath(FREEZE_MANIFEST_REL)}`);
  const liveFreezeCompanion = readFileSync(freezeCompanionPath, 'utf8').trim();
  if (liveFreezeCompanion !== freeze_companion_digest) {
    throw new AcquisitionRefusal('pin-invariance refuses: the accepted freeze anchor does not match the live freeze companion digest (freeze drift — re-accept at Gate A)');
  }

  // (3) 43/43 pinned assets + companion, via the frozen Lane B verifier.
  const result = verifyAllPins({ repoRoot, freezeManifestPath });
  if (result.asset_count !== FROZEN_PIN_ASSET_COUNT) {
    throw new AcquisitionRefusal(`pin-invariance refuses: the freeze manifest enumerates ${result.asset_count} pinned assets, not the frozen ${FROZEN_PIN_ASSET_COUNT}`);
  }
  if (!result.companion_match) throw new AcquisitionRefusal('pin-invariance refuses: freeze companion digest mismatch');
  if (!result.all_match || result.mismatches.length !== 0) {
    const named = result.mismatches.map(m => `${m.path} [${m.reason}]`).join('; ');
    throw new AcquisitionRefusal(`pin-invariance refuses: pinned-asset drift (void condition 1) — ${named}`);
  }

  // (4) Persist through the frozen one-shot writer, then read it back and verify.
  writeOneShotRecord(path, buildG0PinInvarianceRecord({ result, apparatus_identity, freeze_companion_digest, g0_record_id }));
  return verifyPersistedG0PinInvariance({ evidenceDir, apparatus_identity, freeze_companion_digest, g0_record_id });
}
