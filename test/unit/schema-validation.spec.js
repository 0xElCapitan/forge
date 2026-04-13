/**
 * test/unit/schema-validation.spec.js
 * Validates live pipeline output against JSON schemas.
 *
 * H-5 (Docs/code contract verification)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { emitEnvelope } from '../../src/ir/emit.js';
import { buildReceipt } from '../../src/receipt/receipt-builder.js';
import { toInTotoStatement } from '../../src/receipt/to-intoto.js';

// ─── Schema loading ────────────────────────────────────────────────────────

const envelopeSchema = JSON.parse(readFileSync('spec/proposal-ir.json', 'utf8'));
const receiptSchema = JSON.parse(readFileSync('spec/receipt-v0.json', 'utf8'));

// ─── Lightweight JSON Schema validator ─────────────────────────────────────
// Supported keywords: required, properties, type (incl. integer), const,
// pattern, additionalProperties, nested object recursion.
// NOT supported: $ref, oneOf, allOf, anyOf, if/then/else, enum, format,
// minItems, maxItems, minLength, maxLength, minimum, maximum.
// Sufficient for contract tests; extend if schemas adopt new keywords.

function validateAgainstSchema(obj, schema, path = '') {
  const errors = [];

  if (schema.type === 'object' && typeof obj !== 'object') {
    errors.push(`${path}: expected object, got ${typeof obj}`);
    return errors;
  }

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj)) {
        errors.push(`${path}: missing required field '${field}'`);
      }
    }
  }

  // Check properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in obj) || obj[key] === undefined) continue;
      const val = obj[key];
      const propPath = path ? `${path}.${key}` : key;

      // const check
      if ('const' in propSchema && val !== propSchema.const) {
        errors.push(`${propPath}: expected const '${propSchema.const}', got '${val}'`);
      }

      // type check
      if (propSchema.type) {
        const types = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
        const actualType = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
        let matches = types.includes(actualType);
        // JSON Schema "integer" maps to JS "number" + Number.isInteger()
        if (!matches && types.includes('integer') && typeof val === 'number' && Number.isInteger(val)) {
          matches = true;
        }
        // Skip type check for null values on non-required optional fields
        if (!matches && val === null && !schema.required?.includes(key)) {
          matches = true;
        }
        if (!matches) {
          errors.push(`${propPath}: expected type ${types.join('|')}, got ${actualType}`);
        }
      }

      // pattern check (for strings)
      if (propSchema.pattern && typeof val === 'string') {
        if (!new RegExp(propSchema.pattern).test(val)) {
          errors.push(`${propPath}: value '${val}' does not match pattern '${propSchema.pattern}'`);
        }
      }

      // Recurse into nested objects
      if (propSchema.type === 'object' && typeof val === 'object' && val !== null) {
        errors.push(...validateAgainstSchema(val, propSchema, propPath));
      }
    }
  }

  // additionalProperties check
  if (schema.additionalProperties === false && schema.properties) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        errors.push(`${path}: unexpected additional property '${key}'`);
      }
    }
  }

  return errors;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIXED_TIMESTAMP_BASE = 1700000000000;
const FIXED_NOW = 1700000001000;

// ─── Envelope schema validation ─────────────────────────────────────────────

describe('Schema validation — envelope against spec/proposal-ir.json', () => {
  it('emitEnvelope() output validates against proposal-ir.json schema', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const envelope = emitEnvelope({
      feed_id: 'schema-test',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
    });

    const errors = validateAgainstSchema(envelope, envelopeSchema);
    assert.deepStrictEqual(errors, [],
      `Envelope schema validation errors:\n${errors.join('\n')}`);
  });
});

// ─── Receipt schema validation ──────────────────────────────────────────────

describe('Schema validation — receipt against spec/receipt-v0.json', () => {
  it('buildReceipt() output validates against receipt-v0.json schema', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const envelope = emitEnvelope({
      feed_id: 'schema-test',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
    });
    const receipt = buildReceipt({ rawInput: rawData, envelope });

    const errors = validateAgainstSchema(receipt, receiptSchema);
    assert.deepStrictEqual(errors, [],
      `Receipt schema validation errors:\n${errors.join('\n')}`);
  });

  it('receipt has no additional properties at any level', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const envelope = emitEnvelope({
      feed_id: 'schema-test',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
    });
    const receipt = buildReceipt({ rawInput: rawData, envelope });

    // Root level
    const allowedRoot = new Set(Object.keys(receiptSchema.properties));
    for (const key of Object.keys(receipt)) {
      assert.ok(allowedRoot.has(key), `Unexpected root field: '${key}'`);
    }

    // Nested: subject
    const allowedSubject = new Set(Object.keys(receiptSchema.properties.subject.properties));
    for (const key of Object.keys(receipt.subject)) {
      assert.ok(allowedSubject.has(key), `Unexpected subject field: '${key}'`);
    }

    // Nested: materials
    const allowedMaterials = new Set(Object.keys(receiptSchema.properties.materials.properties));
    for (const key of Object.keys(receipt.materials)) {
      assert.ok(allowedMaterials.has(key), `Unexpected materials field: '${key}'`);
    }

    // Nested: policy
    const allowedPolicy = new Set(Object.keys(receiptSchema.properties.policy.properties));
    for (const key of Object.keys(receipt.policy)) {
      assert.ok(allowedPolicy.has(key), `Unexpected policy field: '${key}'`);
    }

    // Nested: builder
    const allowedBuilder = new Set(Object.keys(receiptSchema.properties.builder.properties));
    for (const key of Object.keys(receipt.builder)) {
      assert.ok(allowedBuilder.has(key), `Unexpected builder field: '${key}'`);
    }
  });
});

// ─── toInTotoStatement input validation ─────────────────────────────────────

describe('toInTotoStatement — input validation', () => {
  it('throws TypeError on null receipt', () => {
    assert.throws(() => toInTotoStatement(null), {
      name: 'TypeError',
      message: /receipt must have subject, materials, and builder/,
    });
  });

  it('throws TypeError on receipt missing subject', () => {
    assert.throws(() => toInTotoStatement({ materials: {}, builder: {} }), {
      name: 'TypeError',
      message: /receipt must have subject, materials, and builder/,
    });
  });

  it('throws TypeError on receipt missing materials', () => {
    assert.throws(() => toInTotoStatement({ subject: {}, builder: {} }), {
      name: 'TypeError',
      message: /receipt must have subject, materials, and builder/,
    });
  });

  it('throws TypeError on receipt missing builder', () => {
    assert.throws(() => toInTotoStatement({ subject: {}, materials: {} }), {
      name: 'TypeError',
      message: /receipt must have subject, materials, and builder/,
    });
  });
});
