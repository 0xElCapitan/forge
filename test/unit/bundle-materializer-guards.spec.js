/**
 * test/unit/bundle-materializer-guards.spec.js
 * S03-F hardening regression — materializer interpolation safety + BREATH-only gate.
 *
 * Target 3 (closes S03-E audit A1): identifiers interpolated into markdown/YAML
 * surfaces (handoff.md `settlement_source_id`) are validated against a safe charset
 * BEFORE interpolation, so a malicious newline/colon/quote cannot inject YAML keys.
 *
 * Target 4 (closes S03-E review L1): final materialization is BREATH-only for now —
 * the materializers hardcode the BREATH AQI worked path, so a non-BREATH slug FAILS
 * instead of silently emitting BREATH AQI content under another construct's name.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  materializeSkillMd,
  materializeHandoffMd,
  assertSafeIdentifier,
  BREATH_CONSTRUCT_SLUG,
} from '../../src/bundle/markdown-members.js';
import { assembleBundle } from '../../src/bundle/assemble.js';
import { authorBreathManifestParts } from '../../src/bundle/settlement.js';

const PINNED_NOW = 1735689600000;
const { oracleDeclarations, settlementAuthority } = authorBreathManifestParts();

function breathFinalInput(overrides = {}) {
  return {
    constructSlug: 'breath',
    constructVersion: '0.1.0',
    capabilityFlags: ['binary_resolution'],
    oracleDeclarations,
    settlementAuthority,
    final: true,
    now: PINNED_NOW,
    ...overrides,
  };
}

// ── Target 3: markdown/YAML interpolated-identifier safety (A1) ───────────────

describe('markdown-members — assertSafeIdentifier (interpolation guard, A1)', () => {
  it('accepts the worked-path and registry-style identifiers', () => {
    for (const ok of ['airnow', 'epa_aqs', 'usgs_reviewed', 'epa_airnow_aqi', 'purpleair']) {
      assert.equal(assertSafeIdentifier(ok), ok);
    }
  });

  it('rejects newline / colon / quote / space / empty / non-string', () => {
    assert.throws(() => assertSafeIdentifier('a\nb: evil'), /unsafe/);
    assert.throws(() => assertSafeIdentifier('a: b'), /unsafe/);
    assert.throws(() => assertSafeIdentifier('a"b'), /unsafe/);
    assert.throws(() => assertSafeIdentifier('a b'), /unsafe/);
    assert.throws(() => assertSafeIdentifier(''), /unsafe/);
    assert.throws(() => assertSafeIdentifier(null), /unsafe/);
    // Anchored `$` (no `m` flag): a trailing newline cannot satisfy the pattern.
    assert.throws(() => assertSafeIdentifier('airnow\n'), /unsafe/);
  });
});

describe('markdown-members — handoff.md YAML-injection negative coverage (A1)', () => {
  it('emits a clean single settlement_source_id for a safe id', () => {
    const md = materializeHandoffMd({ settlementSourceId: 'airnow' });
    assert.match(md, /settlement_source_id: "airnow"/);
    const occurrences = md.split('settlement_source_id:').length - 1;
    assert.equal(occurrences, 1, 'exactly one settlement_source_id key is emitted');
  });

  it('rejects a YAML-key-injection settlement_source_id (newline + new key)', () => {
    // The attack would inject "injected_key: evil" as a sibling YAML key.
    const attack = 'airnow"' + String.fromCharCode(10) + 'injected_key: evil';
    assert.throws(() => materializeHandoffMd({ settlementSourceId: attack }), /unsafe/);
  });

  it('rejects a colon-injection settlement_source_id', () => {
    assert.throws(() => materializeHandoffMd({ settlementSourceId: 'airnow: pwned' }), /unsafe/);
  });
});

// ── Target 4: BREATH-only final materialization gate (L1) ─────────────────────

describe('markdown-members — BREATH-only materializer gate (L1)', () => {
  it('BREATH_CONSTRUCT_SLUG is "breath"', () => {
    assert.equal(BREATH_CONSTRUCT_SLUG, 'breath');
  });

  it('materializeSkillMd emits BREATH content for the breath slug', () => {
    const md = materializeSkillMd({ slug: 'breath' });
    assert.match(md, /skill_name: breath/);
    assert.match(md, /AQI/);
    assert.match(md, /bundle_member_hash: null/);
  });

  it('materializeSkillMd refuses any non-breath slug', () => {
    assert.throws(() => materializeSkillMd({ slug: 'tremor' }), /BREATH-only/i);
    assert.throws(() => materializeSkillMd({ slug: 'corona' }), /BREATH-only/i);
    assert.throws(() => materializeSkillMd({}), /BREATH-only/i); // undefined slug
  });
});

describe('assemble — final materialization is BREATH-only (L1 chokepoint)', () => {
  it('assembles the BREATH final bundle (5 members, no error)', () => {
    const b = assembleBundle(breathFinalInput());
    assert.equal(Object.keys(b.members).length, 5);
    assert.match(b.members['SKILL.md'], /skill_name: breath/);
  });

  it('refuses a non-BREATH final bundle instead of emitting BREATH AQI content', () => {
    assert.throws(() => assembleBundle(breathFinalInput({ constructSlug: 'tremor' })), /BREATH-only/i);
  });

  it('leaves the (non-final) skeleton path generic — no BREATH AQI leak', () => {
    const skeleton = assembleBundle({ constructSlug: 'tremor', constructVersion: '0.1.0', now: PINNED_NOW });
    assert.equal(Object.keys(skeleton.members).length, 5);
    assert.ok(!skeleton.members['SKILL.md'].includes('AQI'), 'skeleton SKILL.md must not contain BREATH AQI content');
    assert.match(skeleton.members['SKILL.md'], /skill_name: tremor/);
  });
});
