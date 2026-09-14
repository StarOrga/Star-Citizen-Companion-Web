// The SHIM — injected as the FIRST child of <head> into every hosted concept
// document, before the page's own scripts run.
//
// The concept engine (docs/concepts/*.html) was written for a local Python
// bridge and talks to it with root-relative fetches: `/decisions`,
// `/heartbeat`, `/reload`, `/draft`, `/attachments`. Hosted, the document's
// origin is the Supabase functions origin, so those paths would hit nothing.
// The shim rewrites exactly those five paths to
//   <origin>/functions/v1/concept-page/<id><path>?t=<ticket>
// and leaves every other fetch untouched. The ticket is read from the
// document's own query string (it is what authorised the document load), so
// nothing secret is baked into this script. `navigator.sendBeacon` gets the
// same treatment because the engine flushes the draft mirror through it on
// pagehide.
//
// Kept as a string constant (not a .js asset) so the function stays one
// self-contained deploy unit. Plain ES5-ish on purpose: it runs inside the
// page's CSP (`script-src 'self' 'unsafe-inline'`), not in Deno.
export const SHIM = `<script data-concept-shim>
(function () {
  var BRIDGE = /^\\/(decisions|heartbeat|reload|draft|attachments)(\\?|$)/;
  var base = location.origin + location.pathname.replace(/\\/+$/, '');
  var ticket = new URLSearchParams(location.search).get('t') || '';
  function rewrite(input) {
    var raw = typeof input === 'string' ? input
            : (input && typeof input.url === 'string') ? input.url
            : (input instanceof URL) ? input.href : null;
    if (raw === null) return null;
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
    if (typeof input === 'string' || input instanceof URL) return origFetch(target, init);
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
})();
</script>`;
