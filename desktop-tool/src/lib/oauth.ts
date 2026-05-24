/**
 * Loopback-OAuth — concept § 6 / B2 + Codex-2026-05-24 MED-6 hardening.
 *
 * Flow (the JWT NEVER appears in any URL → never in browser history):
 *  1. Start an ephemeral HTTPS-equivalent (HTTP-on-loopback) server on
 *     127.0.0.1:<port>. The server exposes:
 *       - POST /cb  (JSON body: {state, token, email}) — the real handoff.
 *                    CORS headers allow the web-app origin to fetch() it.
 *       - GET  /cb  — fallback browser-redirect endpoint. Renders a success
 *                    page only (carries `state` + an `ack` flag, NEVER a token).
 *  2. Open the user's default browser at
 *     `${apiBase}/desktop/auth?cb=<loopback>&state=<csrf>`.
 *  3. Web app authenticates, then does a cross-origin fetch() POST to
 *     `<loopback>/cb` with `{state, token, email}` in the JSON body.
 *  4. Once the loopback acknowledges (200), the web app navigates the
 *     browser tab to `<loopback>/cb?state=<csrf>&ack=1` — a clean URL with
 *     NO token. The browser history sees only the ack URL.
 *  5. Loopback validates state, resolves with the captured token.
 *
 * Token is held in memory only. Re-auth on next tool launch.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';

export interface AuthResult {
  ok: boolean;
  accessToken?: string;
  userEmail?: string;
  error?: string;
}

const PORT_MIN = 46800;
const PORT_MAX = 46899;
const TIMEOUT_MS = 5 * 60 * 1000;
// Body cap defends against malicious clients spamming the loopback — a real
// Supabase JWT + email is well under 8 KB.
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Open the user's browser at the WEB app's /desktop/auth page (NOT the
 * Supabase API — that has no UI). The web app authenticates the user and
 * POSTs the resulting JWT back to the loopback. Pass `webBase` from
 * `WEB_BASE` constant in `release-token.ts`.
 */
export async function runOAuthFlow(webBase: string): Promise<AuthResult> {
  const port = await pickPort();
  if (port === null) return { ok: false, error: 'no free loopback port in 46800-46899' };

  const state = randomBytes(16).toString('hex');
  // Capture the web app's origin so the loopback can echo it back as the
  // Access-Control-Allow-Origin header (browsers reject "*" + credentials,
  // and we don't accept credentials anyway, but echoing the actual origin
  // is the standard hardening over a wildcard).
  const webOrigin = (() => {
    try {
      return new URL(webBase).origin;
    } catch {
      return '*';
    }
  })();

  return new Promise<AuthResult>((resolve) => {
    let resolved = false;
    let captured: { token: string; email?: string } | null = null;

    const finish = (r: AuthResult): void => {
      if (resolved) return;
      resolved = true;
      server.close();
      clearTimeout(timer);
      resolve(r);
    };

    const corsHeaders = (): Record<string, string> => ({
      'access-control-allow-origin': webOrigin,
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      // Loopback responses are uncacheable — never let a browser cache the
      // POST result accidentally.
      'cache-control': 'no-store',
    });

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/cb') {
        res.writeHead(404, { 'content-type': 'text/plain', ...corsHeaders() });
        res.end('not found');
        return;
      }

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      // POST = real handoff (JSON body, no URL params)
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (c: Buffer) => {
          total += c.length;
          if (total > MAX_BODY_BYTES) {
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => {
          if (total > MAX_BODY_BYTES) {
            res.writeHead(413, { 'content-type': 'text/plain', ...corsHeaders() });
            res.end('body too large');
            return;
          }
          let body: { state?: string; token?: string; email?: string; error?: string };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            res.writeHead(400, { 'content-type': 'text/plain', ...corsHeaders() });
            res.end('invalid json');
            return;
          }
          if (body.state !== state) {
            res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify({ ok: false, error: 'state_mismatch' }));
            finish({ ok: false, error: 'state mismatch' });
            return;
          }
          if (body.error || !body.token) {
            res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify({ ok: false, error: body.error ?? 'no_token' }));
            finish({ ok: false, error: body.error ?? 'no token' });
            return;
          }
          captured = { token: body.token, email: body.email };
          res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders() });
          res.end(JSON.stringify({ ok: true }));
          // Don't finish yet — wait for the GET /cb?ack=1 from the browser so
          // we can render the success page in the user's tab. The web app
          // navigates there immediately after the fetch resolves.
        });
        req.on('error', () => {
          res.writeHead(400, { 'content-type': 'text/plain', ...corsHeaders() });
          res.end('request error');
        });
        return;
      }

      // GET = browser navigation after the POST succeeded — renders the
      // "you can close this window" page. No token in this URL.
      if (req.method === 'GET') {
        const gotState = url.searchParams.get('state');
        const ack = url.searchParams.get('ack');
        const browserError = url.searchParams.get('error');

        if (gotState !== state) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
          res.end(renderPage('SC Companion · Fehler', 'CSRF-Mismatch — versuch es erneut.', false));
          finish({ ok: false, error: 'state mismatch' });
          return;
        }
        if (browserError) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
          res.end(renderPage('SC Companion · Fehler', browserError, false));
          finish({ ok: false, error: browserError });
          return;
        }
        if (ack === '1' && captured) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
          res.end(renderPage('SC Companion · Verbunden', 'Du kannst dieses Fenster schließen.', true));
          finish({ ok: true, accessToken: captured.token, userEmail: captured.email });
          return;
        }
        // Browser hit GET /cb before the POST completed, or with a stale ack.
        res.writeHead(202, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(renderPage('SC Companion · Warte…', 'Token wird übertragen — gleich fertig.', true));
        return;
      }

      res.writeHead(405, { 'content-type': 'text/plain', ...corsHeaders() });
      res.end('method not allowed');
    });

    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), TIMEOUT_MS);

    server.listen(port, '127.0.0.1', () => {
      const loopback = `http://127.0.0.1:${port}/cb`;
      const authUrl = `${webBase}/desktop/auth?cb=${encodeURIComponent(loopback)}&state=${state}`;
      void shell.openExternal(authUrl);
    });

    server.on('error', (err) => finish({ ok: false, error: err.message }));
  });
}

async function pickPort(): Promise<number | null> {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

function renderPage(title: string, body: string, ok: boolean): string {
  const accent = ok ? '#00d4ff' : '#f87171';
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;background:#050810;color:#e8eef9;font-family:Inter,'Segoe UI',sans-serif;
       display:grid;place-items:center;min-height:100vh}
  .card{background:#11182b;border:1px solid ${accent}33;padding:40px;border-radius:12px;
        text-align:center;max-width:420px;box-shadow:0 0 32px ${accent}33}
  h1{font-family:Orbitron,sans-serif;color:${accent};margin:0 0 12px;letter-spacing:.04em}
  p{margin:0;color:#b8c3d9;line-height:1.5}
</style></head><body>
<div class="card"><h1>${title}</h1><p>${body}</p></div>
</body></html>`;
}
