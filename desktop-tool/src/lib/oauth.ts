/**
 * Loopback-OAuth — concept § 6 / B2.
 *
 * 1. Start an ephemeral HTTP server on 127.0.0.1:<random-port>.
 * 2. Open the user's default browser at `${apiBase}/desktop/auth?cb=<loopback>&state=<csrf>`.
 * 3. Web app authenticates the user (Supabase), then redirects back to `<loopback>?state=...&token=...`.
 * 4. Loopback handler validates `state`, captures `token`, closes server, resolves.
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

export async function runOAuthFlow(apiBase: string): Promise<AuthResult> {
  const port = await pickPort();
  if (port === null) return { ok: false, error: 'no free loopback port in 46800-46899' };

  const state = randomBytes(16).toString('hex');

  return new Promise<AuthResult>((resolve) => {
    let resolved = false;
    const finish = (r: AuthResult): void => {
      if (resolved) return;
      resolved = true;
      server.close();
      clearTimeout(timer);
      resolve(r);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/cb') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const gotState = url.searchParams.get('state');
      const token = url.searchParams.get('token');
      const email = url.searchParams.get('email');
      const error = url.searchParams.get('error');
      if (gotState !== state) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(renderPage('SC Companion · Fehler', 'CSRF-Mismatch — versuch es erneut.', false));
        finish({ ok: false, error: 'state mismatch' });
        return;
      }
      if (error || !token) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(renderPage('SC Companion · Fehler', error ?? 'kein Token erhalten', false));
        finish({ ok: false, error: error ?? 'no token' });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(renderPage('SC Companion · Verbunden', 'Du kannst dieses Fenster schließen.', true));
      finish({ ok: true, accessToken: token, userEmail: email ?? undefined });
    });

    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), TIMEOUT_MS);

    server.listen(port, '127.0.0.1', () => {
      const loopback = `http://127.0.0.1:${port}/cb`;
      const authUrl = `${apiBase}/desktop/auth?cb=${encodeURIComponent(loopback)}&state=${state}`;
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
