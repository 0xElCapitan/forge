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
 * @param {string}  [opts.keyringPath] - Path to public keyring
 * @param {boolean} [opts.verbose=false]
 * @returns {{ verdict: string, exit_code: number, details: Object }}
 */
export function verifyReceipt({ receipt, inputData, keyringPath, verbose = false }) {
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

  // 2. Verify input hash
  const canonicalInput = canonicalize(inputData);
  const computedInputHash = sha256(canonicalInput);
  if (computedInputHash !== receipt.input_hash) {
    details.checks.input_hash = { expected: receipt.input_hash, computed: computedInputHash };
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
        input_hash: receipt.input_hash,
        input_canonicalization: receipt.input_canonicalization,
        code_version: receipt.code_version,
        policy_hash: receipt.policy_hash,
        rule_set_hash: receipt.rule_set_hash,
        policy_version_tag: receipt.policy_version_tag,
        output_hash: receipt.output_hash,
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
  if (receipt.code_version?.node_version) {
    const currentNode = process.version.replace(/^v/, '');
    if (currentNode !== receipt.code_version.node_version) {
      details.warnings.push(
        `Node version mismatch: receipt=${receipt.code_version.node_version}, current=${currentNode}`
      );
    }
  }

  // 5. Replay pipeline
  //    Use a fixed timestampBase to ensure deterministic ingestion.
  //    The exact value doesn't matter for hash comparison — what matters is
  //    that both the original run and the replay use the same one.
  //    We use emitted_at from the envelope if available via the receipt,
  //    otherwise a fixed constant.
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

  // 6. Hash the replayed envelope
  const replayedOutputHash = sha256(canonicalize(envelope));

  // 7. Compare
  if (replayedOutputHash === receipt.output_hash) {
    details.checks.output_hash = 'pass';
    details.replayed_output_hash = replayedOutputHash;
    return result('MATCH', EXIT_MATCH, details);
  }

  details.checks.output_hash = {
    expected: receipt.output_hash,
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
      input:   { type: 'string', short: 'i' },
      keyring: { type: 'string', short: 'k' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help:    { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Usage: forge-verify <receipt.json> --input <input.json> [--keyring <path>] [--verbose]

Exit codes:
  0  MATCH    Replayed output hash matches receipt
  1  MISMATCH Replayed output hash differs
  2  ERROR    Verification could not complete`);
    process.exit(values.help ? 0 : 2);
  }

  const receiptPath = positionals[0];
  const inputPath = values.input;

  if (!inputPath) {
    console.error(JSON.stringify({ verdict: 'ERROR', exit_code: 2, reason: 'Missing --input argument' }));
    process.exit(EXIT_ERROR);
  }

  let receipt, inputData;
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

  const output = verifyReceipt({
    receipt,
    inputData,
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
