#!/usr/bin/env node

/**
 * bin/forge-verify.js
 * Independent replay verifier for FORGE ProposalReceipts.
 *
 * Usage:
 *   node bin/forge-verify.js <receipt.json> --input <input.json> [--verbose]
 *
 * Exit codes:
 *   0 = MATCH   — replayed output hash matches receipt
 *   1 = MISMATCH — replayed output hash differs from receipt
 *   2 = ERROR    — verification could not complete
 *
 * FR-8 (Replay Verifier)
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { ingest }           from '../src/ingester/generic.js';
import { classify }         from '../src/classifier/feed-grammar.js';
import { selectTemplates }  from '../src/selector/template-selector.js';
import { emitEnvelope }     from '../src/ir/emit.js';
import { canonicalize }     from '../src/receipt/canonicalize.js';
import { sha256 }           from '../src/receipt/hash.js';
import { verifySignature }  from '../src/receipt/sign.js';
import { loadKeyring }      from '../src/receipt/keyring.js';

// ─── Exit codes ────────────────────────────────────────────────────────────

const EXIT_MATCH    = 0;
const EXIT_MISMATCH = 1;
const EXIT_ERROR    = 2;

// ─── Core verification logic (exported for testing) ────────────────────────

/**
 * Verify a receipt against its input data by replaying the FORGE pipeline.
 *
 * @param {Object} opts
 * @param {Object}  opts.receipt     - Parsed ProposalReceipt object
 * @param {any}     opts.inputData   - Raw pre-ingest input data
 * @param {Object}  [opts.envelope]  - Original ProposalEnvelope for direct hash verification.
 *   When provided, output_hash is verified by hashing this envelope directly
 *   (no replay needed). When omitted, falls back to pipeline replay.
 * @param {string}  [opts.keyringPath] - Path to public keyring
 * @param {boolean} [opts.verbose=false]
 * @returns {{ verdict: string, exit_code: number, details: Object }}
 */
export function verifyReceipt({ receipt, inputData, envelope: originalEnvelope, keyringPath, verbose = false }) {
  const details = {
    schema: receipt.schema,
    checks: {},
    warnings: [],
  };

  // 1. Validate schema identifier
  if (receipt.schema !== 'forge-receipt/v0') {
    return result('ERROR', EXIT_ERROR, details, `Unknown schema: ${receipt.schema}`);
  }
  details.checks.schema = 'pass';

  // 2. Verify input hash (materials.digest)
  const canonicalInput = canonicalize(inputData);
  const computedInputHash = sha256(canonicalInput);
  if (computedInputHash !== receipt.materials.digest) {
    details.checks.input_hash = { expected: receipt.materials.digest, computed: computedInputHash };
    return result('MISMATCH', EXIT_MISMATCH, details, 'Input hash mismatch');
  }
  details.checks.input_hash = 'pass';

  // 3. Verify signature (if signed)
  if (receipt.signature && receipt.key_id) {
    try {
      const keyring = loadKeyring(keyringPath);
      const entry = keyring.get(receipt.key_id);
      if (!entry) {
        details.checks.signature = `unknown key_id: ${receipt.key_id}`;
        return result('ERROR', EXIT_ERROR, details, `Unknown key_id: ${receipt.key_id}`);
      }
      const signedPayload = canonicalize({
        schema: receipt.schema,
        predicateType: receipt.predicateType,
        subject: receipt.subject,
        materials: receipt.materials,
        policy: receipt.policy,
        builder: receipt.builder,
        http_transcript_receipts: receipt.http_transcript_receipts,
        signer: receipt.signer,
      });
      const valid = verifySignature(signedPayload, receipt.signature, entry.publicKey);
      if (!valid) {
        details.checks.signature = 'invalid';
        return result('ERROR', EXIT_ERROR, details, 'Signature verification failed');
      }
      details.checks.signature = 'pass';
    } catch (e) {
      if (e.code === 'KEYRING_NOT_FOUND') {
        details.checks.signature = 'keyring not found';
        return result('ERROR', EXIT_ERROR, details, e.message);
      }
      throw e;
    }
  } else {
    details.checks.signature = 'unsigned (skipped)';
  }

  // 4. Check node version
  if (receipt.builder?.node_version) {
    const currentNode = process.version.replace(/^v/, '');
    if (currentNode !== receipt.builder.node_version) {
      details.warnings.push(
        `Node version mismatch: receipt=${receipt.builder.node_version}, current=${currentNode}`
      );
    }
  }

  // 5. Verify output hash (subject.digest)
  //    Two modes:
  //    a) Direct: when the original envelope is provided, hash it and compare
  //    b) Replay: re-run the pipeline and compare (requires matching feed_id/timestamps)
  if (originalEnvelope) {
    // Direct verification — hash the provided envelope
    const envelopeHash = sha256(canonicalize(originalEnvelope));
    if (envelopeHash === receipt.subject.digest) {
      details.checks.output_hash = 'pass';
      details.checks.output_hash_mode = 'direct';
      return result('MATCH', EXIT_MATCH, details);
    }
    details.checks.output_hash = {
      expected: receipt.subject.digest,
      computed: envelopeHash,
    };
    return result('MISMATCH', EXIT_MISMATCH, details, 'Output hash mismatch (direct envelope verification)');
  }

  // Replay verification — re-run pipeline with fixed timestamps
  const REPLAY_TIMESTAMP_BASE = 1700000000000;
  const events = ingest(inputData, { timestampBase: REPLAY_TIMESTAMP_BASE });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({
    feed_id: 'replay-verify',
    feed_profile: profile,
    proposals,
    now: REPLAY_TIMESTAMP_BASE + 1000,
  });

  const replayedOutputHash = sha256(canonicalize(envelope));

  if (replayedOutputHash === receipt.subject.digest) {
    details.checks.output_hash = 'pass';
    details.checks.output_hash_mode = 'replay';
    details.replayed_output_hash = replayedOutputHash;
    return result('MATCH', EXIT_MATCH, details);
  }

  details.checks.output_hash = {
    expected: receipt.subject.digest,
    replayed: replayedOutputHash,
  };
  details.replayed_output_hash = replayedOutputHash;
  return result('MISMATCH', EXIT_MISMATCH, details, 'Output hash mismatch after replay');
}

function result(verdict, exit_code, details, reason) {
  return {
    verdict,
    exit_code,
    reason: reason ?? null,
    details,
  };
}

// ─── CLI entry point ───────────────────────────────────────────────────────

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input:    { type: 'string', short: 'i' },
      envelope: { type: 'string', short: 'e' },
      keyring:  { type: 'string', short: 'k' },
      verbose:  { type: 'boolean', short: 'v', default: false },
      help:     { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Usage: forge-verify <receipt.json> --input <input.json> [--envelope <envelope.json>] [--keyring <path>] [--verbose]

Exit codes:
  0  MATCH    Output hash matches receipt
  1  MISMATCH Output hash differs
  2  ERROR    Verification could not complete

When --envelope is provided, output hash is verified directly (no replay).
When omitted, the pipeline is replayed to produce the output hash.`);
    process.exit(values.help ? 0 : 2);
  }

  const receiptPath = positionals[0];
  const inputPath = values.input;

  if (!inputPath) {
    console.error(JSON.stringify({ verdict: 'ERROR', exit_code: 2, reason: 'Missing --input argument' }));
    process.exit(EXIT_ERROR);
  }

  let receipt, inputData, envelope;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (e) {
    console.error(JSON.stringify({ verdict: 'ERROR', exit_code: 2, reason: `Failed to read receipt: ${e.message}` }));
    process.exit(EXIT_ERROR);
  }

  try {
    inputData = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(JSON.stringify({ verdict: 'ERROR', exit_code: 2, reason: `Failed to read input: ${e.message}` }));
    process.exit(EXIT_ERROR);
  }

  if (values.envelope) {
    try {
      envelope = JSON.parse(readFileSync(values.envelope, 'utf8'));
    } catch (e) {
      console.error(JSON.stringify({ verdict: 'ERROR', exit_code: 2, reason: `Failed to read envelope: ${e.message}` }));
      process.exit(EXIT_ERROR);
    }
  }

  const output = verifyReceipt({
    receipt,
    inputData,
    envelope,
    keyringPath: values.keyring,
    verbose: values.verbose,
  });

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.exit_code);
}

// Only run CLI when executed directly (not imported for testing)
const isDirectExecution = process.argv[1]?.endsWith('forge-verify.js');
if (isDirectExecution) {
  main();
}
