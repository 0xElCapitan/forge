// lab/test/acquisition-contact.spec.js
//
// Cycle-005 S01 pre-Gate-A security correction (closes audit finding —
// grimoires/loa/a2a/cycle-005/09-cycle-005-s01-audit-report.md §3 MEDIUM,
// contact.js:44-51,107-110). PRD NFR-SEC; SDD DR-3 G4 ("the key is never an
// argument, never in a record, never echoed"). Proves `contactRoute` itself
// (not just `matchRoute`/`redactUrl` in isolation) resolves the EIA credential
// from env at send time, injects it internally immediately before URL
// construction, refuses any caller-supplied credential argument outright, fails
// closed on an absent/empty env credential, and never lets a planted key
// surface in a thrown error or a returned/redacted URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contactRoute, ContactRefusal } from '../acquisition/contact.js';

const ROUTE = 'eia-electricity-demand-count';
const BASE_PARAMS = Object.freeze({ period_of_record_start: '2015-01-01' });

/** A conformant EIA envelope (data:[] despite length=0) — never triggers contamination. */
function fakeConformantFetch() {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ response: { total: '0', data: [] } })),
      body: null,
    };
  };
  return { fetchImpl, capturedUrl: () => capturedUrl };
}

test('G4: the env credential is resolved at send time and injected into the outgoing request URL', async () => {
  const REAL_KEY = 'REAL_ENV_KEY_ABC123';
  const { fetchImpl, capturedUrl } = fakeConformantFetch();
  const result = await contactRoute(ROUTE, BASE_PARAMS, { fetchImpl, env: { FORGE_EIA_API_KEY: REAL_KEY } });
  assert.equal(result.status, 200);
  assert.ok(capturedUrl().includes(`api_key=${REAL_KEY}`), 'the real outgoing request carries the env-resolved key');
});

test('G4: a caller-supplied params.api_key is refused outright — never accepted, never silently used', async () => {
  const fetchImpl = async () => { throw new Error('fetchImpl must never be invoked on a credential-argument refusal'); };
  await assert.rejects(
    () => contactRoute(ROUTE, { ...BASE_PARAMS, api_key: 'CALLER_SUPPLIED_KEY' }, { fetchImpl, env: { FORGE_EIA_API_KEY: 'REAL_ENV_KEY' } }),
    (err) => {
      assert.ok(err instanceof ContactRefusal);
      assert.equal(err.outcome_class, 'credential_argument_refused');
      return true;
    },
  );
});

test('G4: fails closed when the env credential is entirely absent', async () => {
  const fetchImpl = async () => { throw new Error('fetchImpl must never be invoked when the credential is missing'); };
  await assert.rejects(
    () => contactRoute(ROUTE, BASE_PARAMS, { fetchImpl, env: {} }),
    (err) => {
      assert.ok(err instanceof ContactRefusal);
      assert.equal(err.outcome_class, 'credential_missing');
      return true;
    },
  );
});

test('G4: fails closed when the env credential is present but empty', async () => {
  const fetchImpl = async () => { throw new Error('fetchImpl must never be invoked when the credential is empty'); };
  await assert.rejects(
    () => contactRoute(ROUTE, BASE_PARAMS, { fetchImpl, env: { FORGE_EIA_API_KEY: '' } }),
    (err) => {
      assert.ok(err instanceof ContactRefusal);
      assert.equal(err.outcome_class, 'credential_missing');
      return true;
    },
  );
});

test('G4: a planted credential never appears in the caller-supplied-argument refusal message', async () => {
  const PLANTED = 'PLANTED_SECRET_XYZ_789';
  const fetchImpl = async () => { throw new Error('fetchImpl must never be invoked on a credential-argument refusal'); };
  let caught;
  try {
    await contactRoute(ROUTE, { ...BASE_PARAMS, api_key: PLANTED }, { fetchImpl, env: { FORGE_EIA_API_KEY: PLANTED } });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.ok(!caught.message.includes(PLANTED), 'the refusal error never echoes the planted value');
});

test('G4: redaction remains effective — the injected credential never survives into url_redacted or a transport-error message', async () => {
  const PLANTED = 'PLANTED_SECRET_XYZ_789';

  // Success path: url_redacted masks the internally-injected key.
  const { fetchImpl } = fakeConformantFetch();
  const result = await contactRoute(ROUTE, BASE_PARAMS, { fetchImpl, env: { FORGE_EIA_API_KEY: PLANTED } });
  assert.ok(!result.url_redacted.includes(PLANTED), 'url_redacted never carries the credential');
  assert.match(result.url_redacted, /api_key=REDACTED/);

  // Transport-error path: the ContactRefusal message is built from redactUrl(currentUrl) too.
  const failingFetch = async () => { throw new Error('simulated transport failure'); };
  let transportErr;
  try {
    await contactRoute(ROUTE, BASE_PARAMS, { fetchImpl: failingFetch, env: { FORGE_EIA_API_KEY: PLANTED } });
  } catch (e) { transportErr = e; }
  assert.ok(transportErr instanceof ContactRefusal);
  assert.ok(!transportErr.message.includes(PLANTED), 'a transport-error message never carries the credential');
  assert.match(transportErr.message, /api_key=REDACTED/);
});
