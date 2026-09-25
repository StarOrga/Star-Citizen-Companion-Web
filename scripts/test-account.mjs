#!/usr/bin/env node
/**
 * `npm run test-account` — is the test account set up, and what may it do?
 *
 * Signs the account in once, reads its profile through RLS exactly like the app
 * does, reports role and approval, then revokes that one session again (scope
 * `local` — the account's other sessions, e.g. open Playwright browsers, stay
 * valid). Prints neither the password nor a token.
 *
 * Exit codes: 0 usable (signed in + approved) · 1 broken · 2 not configured.
 *
 * Setup and rules: .claude/deep-knowledge/test-account.md
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import testAccount from './lib/test-account.cjs';

const { CREDENTIAL_TARGET, LOG_FILE, maskEmail, mintSession, readSupabaseConfig, readTestAccount } = testAccount;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const config = readSupabaseConfig(REPO_ROOT);
  if (!config) {
    console.error('Could not read the Supabase config from src/environments/environment.ts.');
    return 1;
  }

  const account = readTestAccount();
  if (!account) {
    console.log(
      [
        'No test account configured.',
        '',
        'Store it once — the password prompt is hidden and nothing lands in the repo:',
        `  cmdkey /generic:${CREDENTIAL_TARGET} /user:<email> /pass`,
        '',
        'or set SC_TEST_EMAIL / SC_TEST_PASSWORD. Details: .claude/deep-knowledge/test-account.md',
      ].join('\n'),
    );
    return 2;
  }

  console.log(`Test account: ${maskEmail(account.email)} — ${account.source}`);

  let session;
  try {
    session = await mintSession(config, account);
  } catch (e) {
    console.log(`  sign-in   ✗ ${e.message}`);
    return 1;
  }
  console.log('  sign-in   ✓');

  const headers = { apikey: config.publishableKey, authorization: `Bearer ${session.access_token}` };
  let profile = null;
  try {
    const res = await fetch(
      `${config.url}/rest/v1/profiles?select=role,is_approved&id=eq.${encodeURIComponent(session.user.id)}`,
      { headers, signal: AbortSignal.timeout(20_000) },
    );
    profile = res.ok ? ((await res.json())[0] ?? null) : null;
  } catch {
    profile = null;
  }
  console.log(
    profile
      ? `  profile   role ${profile.role} · ${profile.is_approved ? 'approved' : 'NOT approved'}`
      : '  profile   ✗ no profile row readable',
  );

  try {
    const res = await fetch(`${config.url}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    console.log(res.ok ? '  cleanup   ✓ check session revoked' : `  cleanup   ⚠ logout answered HTTP ${res.status}`);
  } catch (e) {
    console.log(`  cleanup   ⚠ ${e.message}`);
  }

  if (!profile?.is_approved) {
    console.log('\n✗ The account signs in but is not approved — the app would bounce it to /login?denied=invite.');
    return 1;
  }
  console.log(`\n✓ Ready — Playwright browsers in this repo now start signed in. Diagnostics: ${LOG_FILE}`);
  return 0;
}

// exitCode, never process.exit(): Node 24 on Windows aborts when exiting right
// after a failed fetch (#589).
process.exitCode = await main();
