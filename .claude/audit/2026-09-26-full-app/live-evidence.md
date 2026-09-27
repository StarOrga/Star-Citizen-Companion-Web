# Live evidence — full-app audit 2026-09-26/27

Environment: cloud container (4 vCPU, Node 22.22.2 → Node 24.21.0 installed for the
gates, Chromium 141 via Playwright `chromium-1194`, all HTTPS through an intercepting
egress proxy). No test account (`SC_TEST_*` unset), no Supabase MCP (401) — every
signed-in route is **blocked** for the live half; the public surface, the production
site and the built dist were exercised. Signed-in behaviour is covered by the static
lenses and the 3 167 Karma specs only.

## Gates (this branch at 720743c = main a0acfb2)

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` | clean, 7.6 s | baseline/typecheck.log |
| `npm run build` (Node 24) | green, 38 s; initial 695.90 kB raw / 178.66 kB transfer; no budget warning printed; largest lazy chunks 717.98 kB (three.js), 588.92 kB `codex-detail-component` | baseline/build.log |
| `npm run build` (Node 22.22.2, the container default) | **fails before building**: "The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0" — no `engines`/`.nvmrc` in the repo | baseline/build.log (first run) |
| `npm test` | **3167 / 3167 green**, 41 s, ChromeHeadless (needs `--no-sandbox` as root; wrapper) | baseline/test.log |
| `npm audit` | 2 moderate (`qs` array-limit bypass / isBuffer DoS via `body-parser`, dev tree: karma), fix available | baseline/npm-audit.json |
| `npm run gate:mobile` (dist, public routes) | GREEN, 8 page audits, 0 findings, 9 signed-in routes UNCHECKED; the first run showed 24 `network-error` warnings that were the proxy CA blocking `fonts.gstatic.com`, gone once the proxy CA was pinned | baseline/gate.log, gate2.log |
| `gate:mobile --base-url=https://sc-companion.vercel.app` | GREEN, 8 audits, 0 findings | baseline/gate2.log |
| `gate:mobile --selftest` | GREEN, 9 checks detect their fixture | baseline/gate.log |

## Production (https://sc-companion.vercel.app, 2026-09-26 21:4x UTC)

- Served version `v0.103.1` (`<meta name="app-version">`, `?ngsw-bypass=true`) = repo `package.json` = CHANGELOG top = `public/release-notes.json[0]`.
- Security headers present and equal to `vercel.json`: HSTS 1 y, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy, COOP same-origin-allow-popups, CSP (default-src 'self'; `style-src 'unsafe-inline'`; `form-action 'self' http://127.0.0.1:*`).
- Entry bundle (brotli): `main` 32.7 kB, `polyfills` 13.5 kB, `styles` 5.7 kB; i18n `de.json` 58 kB gzip, `en.json` 53 kB gzip.
- `ngsw.json` served fresh (`cache-control: public, max-age=0, must-revalidate`); its `assetGroups` cover `/*.js|css|html|json(root)|icons/**` only — `/i18n/*.json` is not in the SW manifest (see finding on offline i18n).
- Edge functions without JWT: `fetch-verse-news` 200 / 75 kB, `rsi-upcoming-ships` 200 / 158 kB, `rsi-roadmap` 200 / 13 kB, `patch-stability-sample` 200, `starscape-summary` 200 / **1.99 MB PNG per anonymous GET**, `uex-proxy` 400 without params, `api` 404 route table, `ingest-*` 405 on GET, `concept-page` 404, `desktop-latest` 401. CORS preflight on `fetch-verse-news`: `access-control-allow-origin: *`.
- Anonymous PostgREST reads with the publishable key: `codex_builds` 200, `profiles` 200 (RLS-filtered rows), `patch_stability_samples` 200, `hangar_ships` 401, `news_items` 404 (no such table).
- Google Fonts: `index.html` links `fonts.googleapis.com` (Orbitron + Inter) **and** StarUI's `design-tokens.css` `@import`s a second stylesheet with Inter, Orbitron, Caveat and Share Tech Mono → two font-CSS requests, two families the app never uses. Disclosed in the privacy policy (`de.json` `legal.privacy…fonts`).

### Playwright walk — 11 public routes × 3 viewports (desktop 1280×800, iPhone 14 390×844, Pixel 7 393×851), locale de, dark

| Route | Result |
|---|---|
| `/login`, `/about`, `/legal/privacy`, `/legal/imprint`, `/unavailable` | render; `lang="de"`; h1 present; 21–23 requests; JS transfer 210–224 kB (brotli); FCP 256–608 ms; CLS 0; 0 long tasks; no horizontal overflow on any viewport; text < 12 px only on desktop (9–13 elements, the documented `--sc-fs-floor` desktop exception), 0 on phones |
| `/shared/loadout/<bogus>`, `/hangar/shared/<bogus>` | public layout renders, **no `<h1>`** on the "link invalid" state (a11y: page without heading) |
| `/news`, `/codex/set/none`, `/desktop/connect`, `/does-not-exist` | redirect to `/login?redirect=…` (`**` → `news` → login); the redirect keeps the target path |
| Document title | `"Star Citizen Companion"` on every route — no per-route title (WCAG 2.4.2) |
| Service worker | not registered within the 1.2 s window on any route (`registerWhenStable` strategy; expected) |
| Console | on every route: `GoTrueClient … The "lock" option is deprecated and will be removed in v3` (supabase-js 2.117.1, caused by `lock: lockPassthrough` in `src/app/core/supabase.client.ts`); `Deprecated API for given entry type` is the probe's own `PerformanceObserver` use; the `Refused to execute inline script` errors on production are the probe injecting axe-core (CSP works as intended); four `502 Bad Gateway` on chunk requests and one follow-on `NG0908` (Zone.js chunk missing) in a single phone run are the egress proxy's relay, not reproducible with curl |
| axe-core (WCAG 2A/2AA/2.1AA + best-practice, local dist, 5 rendering routes × 3 viewports) | **0 violations** |
| Tab walk `/login` (desktop) | order: hero CTA → e-mail → password → "Passwort vergessen?" → Google → "Jetzt bewerben" → footer links (Über, Datenschutz, Impressum) → consent buttons; inputs show the app glow (`box-shadow`), buttons the 2 px accent outline. `.sc-btn` buttons read `outline: solid 0px` immediately after Tab because `.sc-btn { transition: all 0.18s }` animates the outline in — not a missing ring |
| Mobile gate on the same routes | see § Gates: green on iPhone 14, Pixel 7, iPad Air, Galaxy Tab S9 |

Screenshots: `scratchpad/live/prod/*.png` and `scratchpad/live/local/*.png` (33 each), mobile-gate shots in `scratchpad/baseline/mobile-gate-shots/`.

## Not exercised live (honest coverage)

- Every route behind `authGuard`/`approvedGuard` (news, codex, hangar, admin, settings, feedback FAB, quick search, set page, Holotable): **blocked — no test account in this container**. Their static evidence is in findings.md; their unit coverage in the 3 167 specs.
- Audio: n/a — no audio API or sound asset in the web app (grep `AudioContext|new Audio(|<audio|Howler|Tone.` over `src/app` → 0 outside the Holotable's WebAudio-free stage).
- Animation timing on the signed-in pages (arrival choreography, view transition REQ-5): static only.
- Supabase DB state (RLS matrix, retention job, RPC timing REQ-1): static only (migrations read), no MCP.
