/**
 * lab/acquisition/contact.js
 *
 * Cycle-005 S01 (PRD FR-B2/FR-B3, NFR-SEC; SDD DR-3 G1/G4/G5/G8; Sprint Plan T1.2).
 *
 * THE ONLY NETWORKING MODULE in the whole cycle. Every executable networking API
 * reference lives here and nowhere else (enforced by the DR-3 G9 boundary lint,
 * lab/test/acquisition-boundaries.spec.js). It accepts a ROUTE OBJECT + params —
 * NEVER a raw URL string — so a URL outside the Gate-A allowlist is structurally
 * unconstructable (FR-B3). Guarantees:
 *
 *   - TLS-only (https) — the route table shape forbids any other scheme (G8);
 *   - manual redirects, ≤ 3 hops, EACH hop's host re-checked against the allowlist,
 *     a non-allowlisted target refused (`redirect_refused`) rather than followed (G8);
 *   - a request timeout via `AbortSignal.timeout`;
 *   - a streamed size cap: the body is read incrementally and the read is aborted
 *     once the cap is exceeded, marking the response `truncated` (→ guards.js
 *     classifies it indeterminate / fail-closed);
 *   - GET-only (no request body; a non-GET method is refused, G5);
 *   - credential read from env AT SEND TIME only, and never returned in any field
 *     that leaves this module except as a G4-redacted URL.
 *
 * S01 CONSTRAINT: this module is built and unit-tested with an INJECTED fetch only;
 * it makes NO live provider request in S01 (pre-G0). The default `fetchImpl` is the
 * Node-stdlib global `fetch` (undici; NFR-DEP: no new dependency), used only in S02
 * under an explicit operator G0 authorization.
 *
 * @module lab/acquisition/contact
 */

import { matchRoute, isAllowlistedHost, RouteRefusal } from './routes.js';
import { redactUrl } from './guards.js';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 3;

/** A contact-level failure (timeout, transport error, redirect escape). */
export class ContactRefusal extends Error {
  constructor(message, outcome_class) { super(message); this.name = 'ContactRefusal'; this.outcome_class = outcome_class; }
}

/** Read the value of a URL's sensitive query param into the credential slot, keeping it out of records. */
function resolveCredential(credentialEnv, env) {
  if (!credentialEnv) return null;
  const v = env[credentialEnv];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ContactRefusal(`credential env ${credentialEnv} is not set (operator must provide it personally; NFR-SEC)`, 'credential_missing');
  }
  return v;
}

/**
 * Read a fetch Response body incrementally, aborting once `maxBytes` is exceeded.
 * Returns `{ bodyBuffer, truncated }`. The raw bytes never leave memory here (G3).
 */
async function readCappedBody(response, maxBytes, controller) {
  const chunks = [];
  let total = 0;
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // No stream available: fall back to arrayBuffer, then enforce the cap post-hoc.
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) return { bodyBuffer: buf.subarray(0, maxBytes), truncated: true };
    return { bodyBuffer: buf, truncated: false };
  }
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* already closing */ }
      try { controller.abort(); } catch { /* best effort */ }
      chunks.push(Buffer.from(value));
      return { bodyBuffer: Buffer.concat(chunks).subarray(0, maxBytes), truncated: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { bodyBuffer: Buffer.concat(chunks), truncated: false };
}

/**
 * Contact one allowlisted route. Returns
 * `{ status, contentType, bodyBuffer, truncated, url_redacted, hops }`.
 * The `bodyBuffer` is handed to `guards.js` for classification and NEVER persisted
 * by this module (G3). Throws {@link ContactRefusal} / {@link RouteRefusal} on
 * refusal (redirect escape, timeout, transport error, credential missing).
 *
 * @param {string} routeId
 * @param {Object} params
 * @param {Object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] - injected for tests; defaults to global fetch
 * @param {Object} [opts.env] - environment source for the credential (defaults to process.env)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @returns {Promise<{status:number, contentType:(string|null), bodyBuffer:Buffer, truncated:boolean, url_redacted:string, hops:number}>}
 */
export async function contactRoute(routeId, params = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const env = opts.env || process.env;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  if (typeof fetchImpl !== 'function') throw new ContactRefusal('no fetch implementation available', 'no_transport');

  const plan = matchRoute(routeId, params); // builds the URL from the allowlist ONLY
  const credential = resolveCredential(plan.credential, env);
  // The credential (if any) is already bound into the URL by the route template's
  // {api_key} placeholder via matchRoute(params). We never echo the live URL; every
  // returned/logged URL is G4-redacted.
  let currentUrl = plan.url;
  let hops = 0;

  for (;;) {
    const { host } = new URL(currentUrl);
    if (!isAllowlistedHost(host)) {
      throw new ContactRefusal(`redirect/target host "${host}" is not allowlisted — refused (G8)`, 'redirect_refused');
    }
    const controller = new AbortController();
    const signal = AbortSignal.any
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
      : controller.signal;
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'accept': 'application/json, text/plain, text/csv, */*' },
      });
    } catch (e) {
      throw new ContactRefusal(`transport error contacting ${redactUrl(currentUrl)}: ${e.message}`, 'timeout');
    }

    // Manual redirect handling with per-hop allowlist re-check (G8).
    if (response.status >= 300 && response.status < 400) {
      const location = typeof response.headers?.get === 'function' ? response.headers.get('location') : null;
      if (!location) {
        throw new ContactRefusal(`redirect status ${response.status} with no Location header — refused`, 'redirect_refused');
      }
      hops += 1;
      if (hops > MAX_REDIRECT_HOPS) {
        throw new ContactRefusal(`exceeded ${MAX_REDIRECT_HOPS} redirect hops — refused (G8)`, 'redirect_refused');
      }
      const next = new URL(location, currentUrl);
      if (next.protocol !== 'https:') {
        throw new ContactRefusal(`redirect to non-https "${next.protocol}" — refused (G8 TLS-only)`, 'redirect_refused');
      }
      if (!isAllowlistedHost(next.host)) {
        throw new ContactRefusal(`redirect target host "${next.host}" is not allowlisted — refused (G8)`, 'redirect_refused');
      }
      currentUrl = next.toString();
      continue;
    }

    const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') : null;
    const { bodyBuffer, truncated } = await readCappedBody(response, maxBytes, controller);
    return {
      status: response.status,
      contentType,
      bodyBuffer,
      truncated,
      url_redacted: redactUrl(currentUrl),
      hops,
    };
  }
}
