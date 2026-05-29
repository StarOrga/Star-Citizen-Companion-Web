// GET /docs — Scalar API Reference UI.
// Concept §2: chosen for modern UX, dark-mode default, OpenAPI 3.1 native,
// and trivial embed via a single <script> tag.
//
// The page MUST include an "Embed in your own tool" section per concept §2
// (user's explicit wish — pastable snippet so they can drop the docs into
// other tools / AI agents).

import type { Context } from './_router.ts';

const HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SC Companion API — Reference</title>
  <link rel="icon" href="/favicon.ico" />
  <style>
    body { margin: 0; font-family: 'Inter', system-ui, sans-serif; background: #050810; color: #e8eef9; }
    .embed-bar {
      background: linear-gradient(180deg, #11182b, #0a0e1a);
      border-bottom: 1px solid rgba(0, 212, 255, 0.18);
      padding: 18px 24px;
    }
    .embed-bar h2 {
      margin: 0 0 8px;
      font-size: 0.9rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #00d4ff;
    }
    .embed-bar p {
      margin: 0 0 10px;
      font-size: 0.88rem;
      color: #b8c3d9;
      max-width: 80ch;
    }
    .embed-bar code {
      background: #050810;
      border: 1px solid rgba(0, 212, 255, 0.25);
      color: #e8eef9;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      font-family: 'Fira Code', Consolas, monospace;
    }
    .embed-bar pre {
      background: #050810;
      border: 1px solid rgba(0, 212, 255, 0.25);
      color: #e8eef9;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 0.78rem;
      font-family: 'Fira Code', Consolas, monospace;
      overflow-x: auto;
      margin: 0;
    }
    .embed-bar .embed-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .embed-bar .embed-row pre { flex: 1; min-width: 280px; }
    .embed-bar button {
      background: #00d4ff;
      color: #050810;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .embed-bar button:hover { background: #4de3ff; }
    .embed-bar .ack { font-size: 0.74rem; color: #4ade80; margin-left: 8px; }
  </style>
</head>
<body>
  <section class="embed-bar">
    <h2>Embed in your own tool</h2>
    <p>
      Drop these two <code>&lt;script&gt;</code> tags into any HTML page (or AI tool that
      accepts script-based widgets) to render this API reference, pointing at our live
      OpenAPI spec.
    </p>
    <div class="embed-row">
      <pre id="embed-snippet">&lt;script id=&quot;api-reference&quot; data-url=&quot;https://sc-companion.vercel.app/openapi.json&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/@scalar/api-reference&quot;&gt;&lt;/script&gt;</pre>
      <button type="button" id="copy-embed">Copy snippet</button>
      <span class="ack" id="copy-ack" hidden>Copied</span>
    </div>
  </section>

  <script
    id="api-reference"
    data-url="/openapi.json"
    data-configuration='{"theme":"deepSpace","darkMode":true,"hideClientButton":false,"layout":"modern","metaData":{"title":"SC Companion API","description":"Star Citizen Verse data — patches, news, ships, components"}}'>
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>

  <script>
    const btn = document.getElementById('copy-embed');
    const ack = document.getElementById('copy-ack');
    const pre = document.getElementById('embed-snippet');
    if (btn && pre && ack) {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent || '');
          ack.hidden = false;
          setTimeout(() => { ack.hidden = true; }, 2000);
        } catch {
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }
      });
    }
  </script>
</body>
</html>
`;

export function serve(ctx: Context): Response {
  ctx.responseHeaders.set('content-type', 'text/html; charset=utf-8');
  ctx.responseHeaders.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return new Response(HTML, { status: 200, headers: ctx.responseHeaders });
}
