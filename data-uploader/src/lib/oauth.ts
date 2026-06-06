/**
 * Loopback-OAuth — concept § 6 / B2 + Codex-2026-05-24 MED-6 hardening.
 *
 * Flow (the JWT NEVER appears in any URL → never in browser history):
 *  1. Start an ephemeral HTTP-on-loopback server on 127.0.0.1:<port>
 *     exposing POST /cb — the real handoff.
 *  2. Open the user's default browser at
 *     `${webBase}/desktop/auth?cb=<loopback>&state=<csrf>`.
 *  3. The web app authenticates, then submits a TOP-LEVEL form-POST
 *     navigation to `<loopback>/cb` with `{state, token, email}` in the
 *     request body (application/x-www-form-urlencoded).
 *
 *     Why a navigation and not a fetch(): Chrome's Private/Local Network
 *     Access blocks subresource requests (fetch/XHR) from a public HTTPS
 *     origin to a private address (127.0.0.1) — even with the CORS
 *     `Access-Control-Allow-Private-Network` header. A top-level navigation
 *     is exempt, so the form-POST gets through. The token rides in the body,
 *     so it still never lands in the URL or browser history.
 *  4. The loopback validates `state`, renders its "you can close this
 *     window" page straight into the navigated tab, and resolves with the
 *     token. (A JSON body is still accepted for backward compatibility.)
 *
 * The web app additionally posts the `refresh_token` + `expires_at` (web build
 * ≥ the one that ships this change). The caller persists them encrypted via
 * `SessionStore` so the operator signs in ONCE; older web builds simply omit
 * them and the tool re-auths when the access token expires.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';

export interface AuthResult {
  ok: boolean;
  accessToken?: string;
  /** Supabase refresh token — present when the web build supports it. */
  refreshToken?: string;
  /** Unix seconds the access token expires (Supabase `expires_at`). */
  expiresAt?: number;
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

    const finish = (r: AuthResult): void => {
      if (resolved) return;
      resolved = true;
      // Browsers keep the loopback TCP connection alive (HTTP keep-alive) after
      // the handoff page loads. server.close() alone waits on those idle
      // sockets, leaving an open handle that can keep the process from exiting
      // cleanly — force them shut so the app closes properly.
      server.closeAllConnections?.();
      server.close();
      clearTimeout(timer);
      resolve(r);
    };

    const corsHeaders = (): Record<string, string> => ({
      'access-control-allow-origin': webOrigin,
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      // Chrome's Private Network Access (PNA) blocks fetches from a
      // public (HTTPS) origin to a private network (127.0.0.1) unless the
      // preflight response carries this header. Without it, the browser
      // surfaces a generic "Failed to fetch" — the upload flow then dies
      // at "Loopback unreachable". See
      // https://wicg.github.io/private-network-access/
      'access-control-allow-private-network': 'true',
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

      // POST = the real handoff. The web app at /desktop/auth submits a
      // TOP-LEVEL form-POST navigation (application/x-www-form-urlencoded),
      // NOT a background fetch(): Chrome's Private/Local Network Access
      // blocks subresource requests from the public HTTPS origin to this
      // 127.0.0.1 loopback even when the CORS preflight carries
      // `Access-Control-Allow-Private-Network: true`. A navigation is exempt.
      // We still accept a JSON body so an older web build keeps working.
      // The token is always in the body — never in any URL.
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
            res.writeHead(413, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
            res.end(renderPage('SC Data Uploader · Fehler', 'Anfrage zu groß.', false));
            return;
          }
          const raw = Buffer.concat(chunks).toString('utf-8');
          const contentType = (req.headers['content-type'] ?? '').toLowerCase();
          let body: {
            state?: string;
            token?: string;
            email?: string;
            error?: string;
            refresh_token?: string;
            expires_at?: string | number;
          };
          if (contentType.includes('application/json')) {
            try {
              body = JSON.parse(raw);
            } catch {
              res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
              res.end(renderPage('SC Data Uploader · Fehler', 'Ungültige Anfrage.', false));
              return;
            }
          } else {
            // application/x-www-form-urlencoded (top-level form POST)
            const params = new URLSearchParams(raw);
            body = {
              state: params.get('state') ?? undefined,
              token: params.get('token') ?? undefined,
              email: params.get('email') ?? undefined,
              error: params.get('error') ?? undefined,
              refresh_token: params.get('refresh_token') ?? undefined,
              expires_at: params.get('expires_at') ?? undefined,
            };
          }
          if (body.state !== state) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
            res.end(renderPage('SC Data Uploader · Fehler', 'CSRF-Mismatch — versuch es erneut.', false));
            finish({ ok: false, error: 'state mismatch' });
            return;
          }
          if (body.error || !body.token) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
            res.end(renderPage('SC Data Uploader · Fehler', body.error ?? 'Kein Token erhalten.', false));
            finish({ ok: false, error: body.error ?? 'no token' });
            return;
          }
          // Success: render the "you can close this window" page directly
          // into the navigated tab and resolve. No separate ack round-trip.
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
          res.end(renderPage('SC Data Uploader · Verbunden', 'Du kannst dieses Fenster schließen.', true));
          const expiresAt =
            body.expires_at !== undefined && body.expires_at !== ''
              ? Number(body.expires_at)
              : undefined;
          finish({
            ok: true,
            accessToken: body.token,
            refreshToken: body.refresh_token,
            expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
            userEmail: body.email,
          });
        });
        req.on('error', () => {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
          res.end(renderPage('SC Data Uploader · Fehler', 'Übertragungsfehler.', false));
        });
        return;
      }

      // GET = a direct browser hit (e.g. user reloaded or opened the URL by
      // hand). The real handoff is the POST above, so just render a neutral
      // info page; don't resolve the flow.
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(
          renderPage(
            'SC Data Uploader',
            'Bitte den Login im Data Uploader Fenster starten.',
            true,
          ),
        );
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
