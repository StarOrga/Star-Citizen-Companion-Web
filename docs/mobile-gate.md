# Mobile & Tablet Gate

A machine-checkable responsive quality gate. It drives a real Chromium over the
DevTools Protocol, emulates iOS and Android phones and tablets, walks the app's
public routes and fails the build when a mobile-usability rule is violated.

It exists because "mobile looks fine" kept being a judgement call. The gate
turns the judgement into assertions that run at the latest at ship time.

- Runner: [`scripts/mobile-gate.mjs`](../scripts/mobile-gate.mjs)
- Config: [`scripts/mobile-gate.config.json`](../scripts/mobile-gate.config.json)
- Ship hook: `.claude/skills/ship/SKILL.md` (and the legacy-named
  `.claude/skills/devops-ship/SKILL.md`) — Step 2 quality gates
- Test-plan hook: `.claude/skills/devops-test-plan/profile.json`

---

## Running it

```bash
npm run gate:mobile             # full run — 4 devices x 11 routes
npm run gate:mobile:quick       # 2 devices x 4 routes (fast inner loop)
npm run gate:mobile:selftest    # prove the checks themselves still work

# explicit target (preview deployment, prod, another port)
node scripts/mobile-gate.mjs --base-url=https://sc-companion.vercel.app

# narrow it down while fixing something
node scripts/mobile-gate.mjs --devices=iphone-14 --routes=/news,/codex

# artefacts
node scripts/mobile-gate.mjs --json=mobile-gate.json --screenshots=.mobile-gate
```

Exit codes: `0` green · `1` at least one `error` finding (the gate failed) ·
`2` the gate could not run at all (no browser, no target, bad config).

On a machine that genuinely has no Chromium (a bare CI container), pass
`--skip-if-unavailable` (or set `MOBILE_GATE_SKIP_IF_UNAVAILABLE=1`). The gate
then prints a loud `SKIPPED` line and exits `0` instead of `2`, so an automated
pipeline is not hard-blocked by a missing browser. A skip is *not* a pass — a
ship that skipped the gate must say so (see the `/ship` rule below).

### What it tests against

Resolution order, first match wins:

1. `--base-url=…` / `MOBILE_GATE_BASE_URL` / `baseUrl` in the config
2. a dev server already listening on `http://127.0.0.1:4200`
3. the production build in `dist/sc-companion/browser`, served by a built-in
   static server on port 4271 (SPA fallback included)

In the ship pipeline case 3 is the normal one: `ship_build` has already run
`npm run build`, so the gate audits exactly the bundle that is about to ship.
If none of the three exist, the gate exits `2` with instructions — it never
silently passes.

### Requirements

Google Chrome or Edge installed (auto-discovered; override with `CHROME_BIN`
or `MOBILE_GATE_CHROME`). No npm dependencies — the script uses `node:http`,
the built-in `WebSocket` client and the Chrome DevTools Protocol directly, so
it cannot rot with the Angular dependency tree.

> Git Bash mangles `--routes=/news` into a Windows path. Either prefix-free
> (`--routes=news,codex`, the script re-adds the slash) or `MSYS_NO_PATHCONV=1`.

---

## Devices

| Key | Device | Viewport | DPR | OS profile |
|-----|--------|----------|-----|------------|
| `iphone-14` | iPhone 14/15 | 390 × 844 | 3 | iOS (Safari UA, `platform: iPhone`) |
| `pixel-7` | Pixel 7 | 393 × 851 | 2.625 | Android (Chrome UA) |
| `ipad-air` | iPad Air | 820 × 1180 | 2 | iOS (iPadOS Safari UA) |
| `galaxy-tab-s9` | Galaxy Tab S9 | 800 × 1280 | 2 | Android (Chrome UA) |
| `iphone-se` | iPhone SE | 375 × 667 | 2 | iOS — not in the default set, the tightest width |

Each profile sets device metrics, `deviceScaleFactor`, touch emulation
(`maxTouchPoints: 5`) and the platform user-agent, so media queries,
`pointer: coarse`, `hover: none` and UA sniffing all behave like the real
device.

**Honest limitation:** the rendering engine is always Blink. This catches
layout, sizing, overflow and touch-affordance defects on iOS *viewports*, not
WebKit-only rendering bugs (e.g. `-webkit-fill-available`, Safari's dynamic
toolbar `100vh` behaviour). Those still need a real device or a WebKit runner —
the gate is a floor, not a replacement for the occasional real-iPhone check.

---

## Checks

Every check is measured in-page, on every device × route combination. All are
`error` (they fail the gate) except where noted.

| Check | Fails when | Why |
|-------|-----------|-----|
| `horizontal-overflow` | the page can **actually** be dragged sideways — the check scrolls right and reads `scrollX` back, so a wide-but-clipped `scrollWidth` (horizontal carousels, `overflow-x: hidden` wrappers) does not false-positive | the page scrolls sideways — the #1 broken-mobile symptom. The report names the deepest elements that stick out un-clipped, and falls back to "possible cause: this box is N px wide" when everything is inside a clip/scroll container |
| `tap-target-too-small` | an interactive element's box is smaller than 44 × 44 px | Apple HIG 44pt / WCAG 2.5.8. Wrapper "touch-target" child elements count as the real hit area; inline links inside running prose are exempt; off-canvas (closed drawer) controls are skipped |
| `text-too-small` | rendered text has `font-size < 12px` | below ~12px body text stops being comfortably readable at arm's length on a phone |
| `content-clipped` | a box with `overflow: hidden/clip` has `scrollWidth`/`scrollHeight` beyond its client box **and** no `text-overflow: ellipsis` / `-webkit-line-clamp` | text silently cut in half. Deliberate truncation (ellipsis, line-clamp) passes |
| `overlapping-content` | the center point of a control hit-tests to a foreign element | the tap does not reach the control |
| `fixed-overlay-covers-control` | the covering element (or an ancestor) is `position: fixed`/`sticky` | sticky headers/bottom bars swallowing buttons — checked at every scroll step, not only at the top of the page |
| `viewport-meta` | the viewport meta is missing `width=device-width`, or blocks pinch-zoom (`user-scalable=no`, `maximum-scale=1`) | zoom-blocking is an accessibility failure |
| `console-error` | `console.error`, an uncaught exception or an error-level log entry occurs on the mobile viewport | mobile-only runtime errors (touch handlers, `matchMedia`, layout observers) |
| `network-error` (**warn**) | a request fails or returns ≥ 400 | hot-linked third-party media makes this noisy, so it reports without failing |

Mechanics that keep the results honest:

- Every route is loaded, then **scroll-swept** in 85 %-viewport steps (max 8).
  Occlusion checks run at each step, so a sticky bar that only covers content
  further down the page is still caught.

  > The sweep drives `window.scrollTo` and measures against
  > `document.documentElement.scrollHeight`, so it only works while **the
  > viewport is the scroll container**. If a global rule ever moves the scroll
  > port into a nested element — `height: 100%` plus `overflow-x: hidden` on
  > `<body>` is enough, because `overflow-x: hidden` forces `overflow-y` to
  > compute to `auto` — every sweep step silently re-audits the top of the page
  > and the gate goes green on layouts it never looked at. That was the state
  > until admin feedback 4e54ad2c; `src/styles.scss` now keeps
  > `overflow-x: hidden` on `<html>` alone.
- The occlusion checks are skipped while a modal/`cdk-overlay` is open — a modal
  is *supposed* to cover the page.
- Findings are de-duplicated per route and capped at 8 per check, so one broken
  list does not produce 300 lines of output.

---

## Interpreting a red run

The report prints, per device and route:

```
FAIL  iPhone 14/15 390×844 iOS   /news
   x tap-target-too-small: tap target is 48×28px (min 44×44)
       at div.filter-bar > button.chip.all   ("Alle")
   x fixed-overlay-covers-control: fixed/sticky element "header.topbar" covers this control at its center point
       at section.news-page > a.card:nth-of-type(3)
       visible at scrollY=1420px
```

Each line names the check, the measured value against the limit, a CSS-ish path
to the element, its visible label, and — for occlusion findings — the scroll
position where it happens. With `--screenshots=<dir>` a PNG per failing
device/route is written as well.

**A red run is not a reason to move the threshold.** 44 px and 12 px are the
platform minimums; lowering them makes the gate lie.

---

## Skipping a check deliberately

Three levels, from narrowest to widest. All of them live in
`scripts/mobile-gate.config.json` and are visible in review — there is no
environment variable that quietly disables the gate.

1. **Waive one element.** Regex against the reported selector path:

   ```json
   "ignore": { "selectors": { "text-too-small": ["span\\.badge-label$"] } }
   ```

2. **Waive noise from a check that is not about layout.** Console/network
   messages match by message text:

   ```json
   "ignore": { "consolePatterns": ["ERR_BLOCKED_BY_CLIENT", "posthog\\.com"] }
   ```

3. **Downgrade or disable a whole check** via `severity`: `error` → `warn`
   (reported, does not fail) → `off` (not reported).

Every entry must be accompanied by an entry in the `$waivers` array of the
config naming the reason and the follow-up issue. A waiver without a follow-up
is a silent quality regression.

**Skipping the whole gate for one ship** is a conscious act: state
`SKIP-MOBILE-GATE: <reason>` in the ship report so it shows up on the
completion card, exactly like `SKIP-VERIFICATION`. Do it only when the ship
cannot touch the frontend at all (e.g. a docs-only or edge-function-only
change) — for those, the ship skill skips the gate automatically anyway.

---

## Self-test — who watches the watchman

`npm run gate:mobile:selftest` serves
[`scripts/mobile-gate.fixture.html`](../scripts/mobile-gate.fixture.html) — a
page that violates every rule on purpose — and asserts that **each check fires**:

```
   ok   viewport-meta
   ok   horizontal-overflow
   ok   tap-target-too-small
   ok   text-too-small
   ok   content-clipped
   ok   overlapping-content
   ok   fixed-overlay-covers-control
   ok   console-error
  RESULT: GREEN — all checks detect their fixture violation.
```

Exit `0` when all checks are alive, `1` when one has gone blind. Run it after
touching `scripts/mobile-gate.mjs`, and whenever a green gate run feels too good
to be true — a check that silently stopped detecting is worse than no gate.

## Adding routes

`routes` in the config is the authoritative list; it covers the **public**
surface (auth-gated routes redirect to `/login` when the gate visits them, so
they are not included). When a new public route ships, add it there in the same
PR — an untested route is an untested phone.
