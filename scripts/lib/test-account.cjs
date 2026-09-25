/**
 * The SC Companion test account — where its credentials live, how a session is
 * obtained for it, and which origins may receive one.
 *
 * Shared by the Playwright-MCP init page (`scripts/playwright/test-session.cjs`,
 * which Playwright loads with `require`, hence CommonJS), `scripts/test-account.mjs`
 * and the mobile gate's `--auth` pass.
 *
 * Why an account of its own. Claude must never type a password, and the admin's
 * own session cannot be shared either: Supabase rotates the refresh token on every
 * refresh and revokes the whole session family when a rotated token is used
 * again, so two browsers holding one copied session log each other out — the
 * admin included — within the hour. A dedicated account lets every browser sign
 * in on its own, with a password the model never sees: the admin stores it once
 * in the Windows Credential Manager, and only scripts read it.
 *
 * Credential sources, first match wins:
 *   1. SC_TEST_EMAIL / SC_TEST_PASSWORD           (environment)
 *   2. SC_GATE_EMAIL / SC_GATE_PASSWORD           (legacy names of the mobile gate)
 *   3. Windows Credential Manager, generic credential `sc-companion/test-account`
 *      — create it with:  cmdkey /generic:sc-companion/test-account /user:<email> /pass
 *
 * Setup and rules: .claude/deep-knowledge/test-account.md
 */
'use strict';

const { execFileSync } = require('node:child_process');
const { appendFileSync, existsSync, readFileSync, statSync, truncateSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CREDENTIAL_TARGET = 'sc-companion/test-account';
const LOG_FILE = join(tmpdir(), 'sc-test-session.log');
const LOG_MAX_BYTES = 256 * 1024;

// Which origins may receive a session: local dev servers (`ng serve` 4200,
// worktree ports, the mobile gate's static server) — a port range rather than
// "any port", so a session never lands in some other app on localhost — plus
// production and the project's Vercel preview deployments. Plain data, because
// the init page hands it to the browser along with `isAppOrigin` itself.
const APP_ORIGIN_RULES = {
  localHosts: ['127.0.0.1', 'localhost'],
  localPortMin: 4200,
  localPortMax: 4399,
  deployHosts: ['^sc-companion\\.vercel\\.app$', '^star-citizen-companion-website(-[a-z0-9-]+)?\\.vercel\\.app$'],
};

/**
 * True when `url` belongs to a running copy of this app that may receive a
 * session. Self-contained on purpose: the init page injects its source into the
 * page, so it must not reference anything outside its own body.
 */
function isAppOrigin(url, rules = APP_ORIGIN_RULES) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (rules.localHosts.includes(u.hostname)) {
    const port = Number(u.port || 80);
    return u.protocol === 'http:' && port >= rules.localPortMin && port <= rules.localPortMax;
  }
  return u.protocol === 'https:' && rules.deployHosts.some((re) => new RegExp(re).test(u.hostname));
}

/**
 * Supabase URL + publishable key, read from `src/environments/environment.ts` so
 * the scripts can never drift from the app. Null outside an SC Companion checkout.
 */
function readSupabaseConfig(repoRoot) {
  const file = join(repoRoot, 'src', 'environments', 'environment.ts');
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const block = /supabase:\s*\{([^}]*)\}/.exec(src)?.[1] ?? '';
  const url = /url:\s*'([^']+)'/.exec(block)?.[1];
  const publishableKey = /publishableKey:\s*'([^']+)'/.exec(block)?.[1];
  return url && publishableKey ? { url, publishableKey } : null;
}

/**
 * The test account's credentials, or null when none is configured.
 * `credentialManager: false` skips the Windows lookup (tests, non-Windows).
 */
function readTestAccount({ env = process.env, credentialManager = true } = {}) {
  for (const [emailVar, passwordVar] of [
    ['SC_TEST_EMAIL', 'SC_TEST_PASSWORD'],
    ['SC_GATE_EMAIL', 'SC_GATE_PASSWORD'],
  ]) {
    if (env[emailVar] && env[passwordVar]) {
      return { email: env[emailVar], password: env[passwordVar], source: `env ${emailVar}` };
    }
  }
  if (!credentialManager || process.platform !== 'win32') return null;
  const cred = readWindowsCredential(CREDENTIAL_TARGET);
  if (!cred || !cred.user || !cred.secret) return null;
  return { email: cred.user, password: cred.secret, source: `Windows Credential Manager (${CREDENTIAL_TARGET})` };
}

// CredReadW through a compiled P/Invoke shim — Windows ships no CLI that prints
// a stored secret. The script goes in as -EncodedCommand so no quoting layer can
// mangle it; the secret comes back base64-encoded on stdout and never touches disk.
const CRED_READ_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScCredRead {
  [StructLayout(LayoutKind.Sequential)]
  struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  public static string[] Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] blob = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, blob, 0, c.CredentialBlobSize);
      return new string[] { Marshal.PtrToStringUni(c.UserName), Convert.ToBase64String(blob) };
    } finally { CredFree(p); }
  }
}
'@
$r = [ScCredRead]::Read('__TARGET__')
if ($r) { @{ user = $r[0]; blob = $r[1] } | ConvertTo-Json -Compress }
`;

function readWindowsCredential(target) {
  const script = CRED_READ_PS.replace('__TARGET__', target.replace(/'/g, "''"));
  let out;
  try {
    out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return null;
  }
  if (!out) return null;
  try {
    const { user, blob } = JSON.parse(out);
    return { user, secret: decodeCredentialBlob(Buffer.from(blob, 'base64')) };
  } catch {
    return null;
  }
}

/**
 * cmdkey and the Credential Manager dialog store the secret as UTF-16LE; tools
 * built on other keyrings (the Supabase CLI, Go's keyring) store UTF-8. Tell
 * them apart by the zero high bytes UTF-16 leaves on ASCII text.
 */
function decodeCredentialBlob(buf) {
  if (buf.length === 0) return '';
  if (buf.length % 2 === 0) {
    let zeroHighBytes = 0;
    for (let i = 1; i < buf.length; i += 2) if (buf[i] === 0) zeroHighBytes++;
    if (zeroHighBytes >= buf.length / 4) return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

/** The session object exactly as supabase-js persists it under its storage key. */
function toStoredSession(token, nowSeconds = Math.round(Date.now() / 1000)) {
  return {
    access_token: token.access_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    expires_at: token.expires_at ?? nowSeconds + token.expires_in,
    refresh_token: token.refresh_token,
    user: token.user,
  };
}

/**
 * Signs the test account in (password grant) and returns a fresh session. Every
 * call is a new, independent session — nothing is shared, nothing rotates under
 * anybody else's feet.
 */
async function mintSession(config, account, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = body.error_description || body.msg || body.error || body.error_code || 'no session in response';
    throw new Error(`sign-in refused (HTTP ${res.status}): ${reason}`);
  }
  return toStoredSession(body);
}

/** "jo***@example.test" — enough to recognise the account, not enough to copy it. */
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * One line to %TEMP%/sc-test-session.log. The Playwright-MCP server's stderr is
 * invisible to the session, so this file is the only way to see why a browser
 * came up signed out. Never pass it a token or a password.
 */
function log(message) {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) truncateSync(LOG_FILE, 0);
    appendFileSync(LOG_FILE, `${new Date().toISOString()} [pid ${process.pid}] ${message}\n`);
  } catch {
    /* logging must never break a browser launch */
  }
}

module.exports = {
  APP_ORIGIN_RULES,
  CREDENTIAL_TARGET,
  LOG_FILE,
  decodeCredentialBlob,
  isAppOrigin,
  log,
  maskEmail,
  mintSession,
  readSupabaseConfig,
  readTestAccount,
  toStoredSession,
};
