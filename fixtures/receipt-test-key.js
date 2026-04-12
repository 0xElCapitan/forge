/**
 * fixtures/receipt-test-key.js
 * Deterministic ed25519 key pair for receipt signing tests.
 *
 * !! FOR TESTING ONLY — NEVER USE IN PRODUCTION !!
 *
 * These keys are committed to the repository and are public.
 * Production keys are loaded from FORGE_SIGNING_KEY env var
 * and are never committed.
 */

export const TEST_KEY_ID = 'forge-test-001';

export const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIKtIKQclVFNN9QuJCYBqOtQ2oZTmME7Ci4vK6uErBS4Z
-----END PRIVATE KEY-----`;

export const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0ZrtrPqiWvocp6Pm3yNtZ1Mh5L7Oe7xba1Twg8w3aig=
-----END PUBLIC KEY-----`;
