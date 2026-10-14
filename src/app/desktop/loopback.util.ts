/**
 * Loopback callback-URL validation for the desktop OAuth handoff.
 *
 * Shared by `desktop-read-auth.component.ts` (/desktop/connect) and
 * `desktop-auth.component.ts` (/uploader/auth). Both receive a `cb` query
 * parameter pointing at the desktop app's local loopback server and must
 * confirm it is a genuine 127.0.0.1 HTTP endpoint before form-POSTing the
 * user's Supabase JWT to it.
 *
 * PORT POLICY — any port (per docs/contracts/codex-connect.md §"Port range"):
 * the desktop app binds its loopback with `listen(0)`, so the OS assigns an
 * arbitrary ephemeral port (typically 49152–65535 on Windows). Restricting the
 * accepted port to a fixed range would reject the legitimate OS-assigned port
 * and break the whole Connect flow (the page would show "bad callback"). The
 * real security boundary is:
 *   1. `http:` + `127.0.0.1` host  → the token can never leave the local machine
 *      to an external origin (this function),
 *   2. the single-use CSRF `state` handshake echoed in the POST body, and
 *   3. the app-side Origin allowlist on `POST /scc/callback`.
 * A port-range check adds no meaningful protection on top of these (local
 * malware can listen on any port anyway) and only breaks legitimate use.
 */
export function isLoopbackCallback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== '127.0.0.1') return false;
    // Require an explicit, valid TCP port (1–65535). URL.port is '' when the
    // caller omitted it → Number('') === 0 → rejected below.
    const port = Number(u.port);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  } catch {
    return false;
  }
}

/**
 * Make the next loopback form-POST carry a real `Origin` header.
 *
 * The site ships `Referrer-Policy: strict-origin-when-cross-origin`
 * (vercel.json). Under every `strict-*` policy the Fetch spec serialises the
 * request origin as `null` when an https: page sends to a non-https: URL —
 * and `http://127.0.0.1` is exactly that downgrade. The desktop loopback
 * allowlists `Origin` against the SCC-Web origin, so it answered the handoff
 * with 403 "Forbidden". Switching this document to `origin` (origin only, never
 * path or query) right before the top-level POST restores the header without
 * loosening the policy for any other page: the handoff navigates away anyway.
 */
export function sendOriginOnLoopbackPost(doc: Document = document): void {
  const meta = doc.createElement('meta');
  meta.name = 'referrer';
  meta.content = 'origin';
  doc.head.appendChild(meta);
}
