/**
 * test/unit/bundle-oracle-trust-tier.spec.js
 * S03-F hardening regression — forge-side trust_tier must be a TRUST_TIER enum
 * string (target 2; closes S03-C audit A1).
 *
 * getTrustTier() reads a plain-object registry, so a prototype-ish source_id
 * ('__proto__' → Object.prototype, 'constructor' → the Object constructor) resolves
 * to a NON-STRING value that the legacy `=== 'unknown'` check did not catch — it
 * authored a malformed `trust_tier: {}` declaration. The S03-F guard in
 * authorOracleDeclaration rejects any non-string / non-enum tier at the authoring
 * entrypoint, WITHOUT modifying src/trust/oracle-trust.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { authorOracleDeclaration, authorBreathOracleDeclarations } from '../../src/bundle/oracles.js';
import { getTrustTier } from '../../src/trust/oracle-trust.js';
import { TRUST_TIER } from '../../src/bundle/enums.js';

describe('oracles — prototype-key / non-enum trust_tier hardening (A1)', () => {
  it('the underlying registry quirk still exists (we did NOT modify oracle-trust.js)', () => {
    // Documents WHY the bundle-layer guard is needed: the registry returns a
    // non-string for an all-lowercase prototype key. The fix lives in the bundle
    // layer, not the trust registry.
    assert.notEqual(typeof getTrustTier('__proto__'), 'string');
    assert.notEqual(typeof getTrustTier('constructor'), 'string');
  });

  it('rejects a "__proto__" forge source_id (was: malformed trust_tier: {})', () => {
    assert.throws(
      () => authorOracleDeclaration({ sourceId: '__proto__', sourceSide: 'forge', role: 'signal' }),
      /non-string \/ non-enum trust_tier|prototype-key/,
    );
  });

  it('rejects a "constructor" forge source_id (was: trust_tier dropped at serialization)', () => {
    assert.throws(
      () => authorOracleDeclaration({ sourceId: 'constructor', sourceSide: 'forge', role: 'signal' }),
      /non-string \/ non-enum trust_tier|prototype-key/,
    );
  });

  it('still rejects a plain non-registry forge source_id as unverifiable (unknown)', () => {
    assert.throws(
      () => authorOracleDeclaration({ sourceId: 'not_a_registry_key', sourceSide: 'forge', role: 'signal' }),
      /not a TRUST_REGISTRY key|unverifiable/,
    );
  });

  it('every authored forge trust_tier is a TRUST_TIER enum string', () => {
    const airnow = authorOracleDeclaration({ sourceId: 'airnow', sourceSide: 'forge', role: 'settlement' });
    assert.equal(typeof airnow.trust_tier, 'string');
    assert.ok(TRUST_TIER.includes(airnow.trust_tier));
    assert.equal(airnow.trust_tier, 'T1');

    const purpleair = authorOracleDeclaration({ sourceId: 'purpleair', sourceSide: 'forge', role: 'signal' });
    assert.equal(purpleair.trust_tier, 'T3');
  });

  it('leaves the BREATH worked path unchanged (airnow T1 settlement, purpleair T3 signal)', () => {
    const decls = authorBreathOracleDeclarations();
    assert.equal(decls.length, 2);
    const airnow = decls.find((d) => d.source_id === 'airnow');
    const purpleair = decls.find((d) => d.source_id === 'purpleair');
    assert.deepEqual(
      { tier: airnow.trust_tier, role: airnow.role, authority_ref: airnow.authority_ref },
      { tier: 'T1', role: 'settlement', authority_ref: null },
    );
    assert.deepEqual(
      { tier: purpleair.trust_tier, role: purpleair.role, authority_ref: purpleair.authority_ref },
      { tier: 'T3', role: 'signal', authority_ref: null },
    );
  });

  it('does not affect the echelon/lattice path (trust_tier null, authority_ref carried)', () => {
    // The guard lives inside the forge branch only; echelon/lattice tier is always null.
    const echelon = authorOracleDeclaration({
      sourceId: 'partner_sensor',
      sourceSide: 'echelon',
      role: 'primary',
      authorityRef: 'echelon://authority/abc',
    });
    assert.equal(echelon.trust_tier, null);
    assert.equal(echelon.authority_ref, 'echelon://authority/abc');
  });
});
