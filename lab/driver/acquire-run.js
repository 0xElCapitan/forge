/**
 * lab/driver/acquire-run.js
 *
 * Cycle-005 S02 (PRD FR-B1/FR-E3; SDD DR-2; Sprint Plan T2.1/T2.2;
 * 24-cycle-005-pre-g0-apparatus-audit.md §7;
 * 25-cycle-005-replacement-gate-a-decision-brief.md §5;
 * 27-cycle-005-task-2-2-pre-contact-pin-invariance-review.md §5 — operator Design A).
 *
 * The PRODUCTION composition root: the one operator-invocable execution vehicle for
 * Cycle-005 acquisition. It exists because the two apparatus lanes cannot legally
 * reference one another — the G9 import fence is BIDIRECTIONAL (acquisition may not
 * import resolution, resolution may not import acquisition) — so the wiring that hands
 * Lane B's `prepareG0PinInvariance` to Lane A's `main` has to live in a third place.
 *
 * `lab/driver` is that third place, and it is an APPARATUS NAMESPACE: `identity.js`
 * enumerates it into `acquisition-manifest.json` alongside the two lanes, so this file
 * is content-addressed and the DR-2 seatbelt inside `verifyContactAuthority` re-hashes
 * it BEFORE the Gate-A / G0 checks and long before the first transport call. A driver
 * edited after Gate-A acceptance refuses at `apparatus asset digest mismatch (identity
 * drift)`. That property is the whole reason the driver lives here rather than in
 * `tools/`: the one component that names the pin-invariance preparer is exactly the
 * component whose bytes must be pinned, because `acquire.js` cannot verify WHICH
 * function was injected — only that the artifact it produced is durable, canonical,
 * self-addressed and bound to this identity, this freeze anchor and this G0 record.
 *
 * The composition root carries NO POLICY. It names three things — the repository root,
 * the Cycle-005 evidence directory, and the production preparer — and delegates. It
 * chooses no provider, candidate, rank, method, route, parameter, credential, retry
 * policy or contact order; it parses no G0 scope; it weakens no Gate-A / G0 check; it
 * bypasses no one-shot, HALT, contamination or pin-invariance control; it performs no
 * transport. Every one of those decisions is derived and enforced inside the pinned
 * acquisition apparatus, from the frozen route table, the accepted `method-set.json`
 * and the operator's G0 record. Anything more here and this file becomes the unpinned
 * contact controller the pre-G0 remediation removed.
 *
 * Two structural consequences, both deliberate:
 *
 *   - `argv` is passed through UNTOUCHED. The driver adds no flag of its own, so
 *     `acquire.js parseArgs` remains the sole argument authority and keeps refusing
 *     everything except `--preflight` | `--execute`.
 *   - the `io` bag is CONSTRUCTED here and cannot be supplied by a caller. There is no
 *     seam through which a different pin-invariance preparer, a transport
 *     implementation or an environment bag could be substituted; the overrides this
 *     module accepts are ordinary process I/O and repository paths only.
 *
 * @module lab/driver/acquire-run
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { main } from '../acquisition/acquire.js';
import { prepareG0PinInvariance } from '../resolution/pin-invariance.js';

/** The repository root, derived from this module's own location (never from env or argv). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The Cycle-005 evidence directory, repo-relative (SDD §7). */
export const EVIDENCE_DIR_REL = 'lab/evidence/cycle-005';

/**
 * Run the accepted acquisition entry point under the production pin-invariance
 * preparer.
 *
 * `argv` reaches `acquire.js parseArgs` verbatim: `--preflight` (the default) verifies
 * the whole authority chain and contacts nothing; `--execute` additionally requires the
 * FR-E3 `pin-invariance-g0.json` evidence to be persisted and verified immediately
 * before the first transport call, which is what {@link prepareG0PinInvariance}
 * produces.
 *
 * The `overrides` bag is ordinary process I/O and repository paths — the values a CLI
 * needs to name where it is running and where to write. It deliberately carries no
 * `io`, no transport, no environment and no clock: those would be substitutions of
 * apparatus behaviour, not of process context.
 *
 * @param {string[]} [argv] - passed through unchanged to `acquire.js parseArgs`
 * @param {Object} [overrides]
 * @param {string} [overrides.repoRoot]
 * @param {string} [overrides.evidenceDir]
 * @param {(s:string)=>void} [overrides.stdout]
 * @param {(s:string)=>void} [overrides.stderr]
 * @returns {Promise<number>} the process exit code `main` decided
 *   (0 completed, 1 refusal with no transport and no partial effect, 2 terminal HALT)
 */
export async function runAcquisition(argv = [], overrides = {}) {
  const repoRoot = overrides.repoRoot === undefined ? REPO_ROOT : overrides.repoRoot;
  const evidenceDir = overrides.evidenceDir === undefined ? join(repoRoot, EVIDENCE_DIR_REL) : overrides.evidenceDir;
  const opts = {
    repoRoot,
    evidenceDir,
    // Constructed here, never accepted from a caller: the production preparer is the
    // only thing this driver injects, and it is the only thing it may inject.
    io: { preparePinInvariance: prepareG0PinInvariance },
  };
  if (overrides.stdout !== undefined) opts.stdout = overrides.stdout;
  if (overrides.stderr !== undefined) opts.stderr = overrides.stderr;
  return main(argv, opts);
}

// Operator-invocable CLI. Structurally cannot reach a provider before the apparatus
// self-verifies at the accepted identity, a current-identity Gate-A acceptance exists,
// a G0 authorization scoped against the frozen route table exists, no governing HALT
// or prior-run evidence exists, and the pin-invariance evidence is durable on disk.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runAcquisition(process.argv.slice(2)));
}
