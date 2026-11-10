// The SHIM — injected as the FIRST child of <head> into every hosted concept
// document, before the page's own scripts run.
//
// The concept engine (docs/concepts/*.html) was written for a local Python
// bridge and talks to it with root-relative fetches: `/decisions`,
// `/heartbeat`, `/reload`, `/draft`, `/attachments` (one of them, the
// heartbeat, as `location.origin + '/heartbeat'`). Hosted, the document does
// NOT run on this function's origin: Supabase rewrites every `text/html`
// response of an edge function on the default `*.supabase.co` domain to
// `text/plain` with `content-security-policy: default-src 'none'; sandbox`, so
// a browser only ever shows the source (admin feedback #330). The app's
// static loader `public/concept-frame.html` fetches the document as text and
// writes it into its own app-origin document instead.
//
// So the shim rewrites exactly those five paths — root-relative or on the
// document's own origin — to the ABSOLUTE function URL
//   <SUPABASE_URL>/functions/v1/concept-page/<id><path>?t=<ticket>
// which the function bakes in when it serves the document (`buildShim`), and
// leaves every other fetch untouched. The ticket is the one that authorised
// the document fetch, so nothing new leaks into the page. Without a baked-in
// base (an old caller) it falls back to the document's own location, the
// pre-#330 behaviour. `navigator.sendBeacon` gets the same treatment because
// the engine flushes the draft mirror through it on pagehide.
//
// Kept as a string (not a .js asset) so the function stays one self-contained
// deploy unit. Plain ES5-ish on purpose: it runs inside the page's CSP
// (`script-src 'self' 'unsafe-inline'`), not in Deno.

export interface ShimConfig {
  /** Absolute `…/functions/v1/concept-page/<id>` (no trailing slash). */
  base: string;
  /** The ticket that authorised the document load. */
  ticket: string;
}

/** JSON that is safe inside an inline <script> (no `</script>`, no U+2028/9). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}

/** The shim's body without the <script> wrapper — exported for the tests. */
export function shimSource(cfg: ShimConfig | null): string {
  return `(function () {
  var cfg = ${scriptJson(cfg ?? {})};
  var BRIDGE = /^\\/(decisions|heartbeat|reload|draft|attachments)(\\?|$)/;
  var base = cfg.base ? String(cfg.base).replace(/\\/+$/, '')
           : location.origin + location.pathname.replace(/\\/+$/, '');
  var ticket = cfg.ticket || new URLSearchParams(location.search).get('t') || '';
  function rewrite(input) {
    var raw = typeof input === 'string' ? input
            : (typeof URL !== 'undefined' && input instanceof URL) ? input.href
            : (input && typeof input.url === 'string') ? input.url : null;
    if (raw === null) return null;
    var origin = location.origin;
    if (origin && origin !== 'null' && raw.indexOf(origin + '/') === 0) raw = raw.slice(origin.length);
    var m = BRIDGE.exec(raw);
    if (!m) return null;
    var path = '/' + m[1];
    var qs = raw.slice(path.length);
    var sep = qs.indexOf('?') === 0 ? '&' : '?';
    return base + path + qs + sep + 't=' + encodeURIComponent(ticket);
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var target = rewrite(input);
    if (target === null) return origFetch(input, init);
    if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) return origFetch(target, init);
    return origFetch(new Request(target, input), init);
  };
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var target = rewrite(String(url));
      return origBeacon(target === null ? url : target, data);
    };
  }
  document.documentElement.dataset.conceptHosted = '1';
})();`;
}

/** The <script> block the function puts first into <head>. */
export function buildShim(cfg: ShimConfig | null): string {
  return `<script data-concept-shim>\n${shimSource(cfg)}\n</script>`;
}

/** The location-relative shim (no baked-in base) — the pre-#330 form. */
export const SHIM = buildShim(null);
