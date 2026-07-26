# SC Companion — Hangar Import (Chrome MV3 extension)

Imports the ship list from the user's **own** RSI hangar page into
[Star Citizen Companion](https://sc-companion.vercel.app).

The web app cannot read robertsspaceindustries.com itself — the same-origin
policy and RSI's lack of a public hangar API make server- or browser-side
scraping impossible. A browser extension is the only place where the page the
user is *already looking at* can be read, which is exactly what this does.

## Design constraints

- **No bundler, no npm dependencies.** Plain ES modules and one manifest. The
  whole extension is reviewable by reading five files.
- **No new backend surface.** No edge function, no service-role key, no RLS
  policy, no token. The extension never talks to a Supabase or Companion
  server; the web app writes the ships with the user's own existing session.
- **Minimal permissions.** `storage` plus host permissions scoped to
  `robertsspaceindustries.com/…/account/pledges*` and the two Companion
  origins. No `tabs`, no `scripting`, no `<all_urls>`, no background worker.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — permissions, content-script matches |
| `src/lib/hangar-core.js` | Pure logic: DOM parsing, fingerprint, nudge policy, payload shape. No `chrome.*`, no network. Unit-tested by the web app's Karma suite (`src/app/hangar/rsi-hangar-core.spec.ts`) |
| `src/lib/hangar-core.d.ts` | Type surface for the TypeScript test |
| `src/content/rsi-hangar.js` | Runs on the RSI hangar page: login check, crawl, offer banner, handover |
| `src/content/companion-bridge.js` | Runs on the Companion origin: hands the payload to the page via `postMessage`, records the commit |
| `src/popup/*` | Status, privacy notice, "offer again", "forget stored data" |
| `_locales/{en,de}` | All user-facing strings (`chrome.i18n`) |

## Handover flow

```
RSI hangar page                     chrome.storage.local            Companion tab
──────────────────                  ────────────────────            ─────────────
parse ship names  ──┐
fingerprint         │
nudge decision      │
[user clicks Import]├──► pendingImport ─────────────────────► companion-bridge
window.open(/hangar/import)                                        │ postMessage
                                                                   ▼
                                                          Angular review screen
                                                          [user confirms]
                    ◄──── nudgeState.lastImport ◄──────── committed(fingerprint)
```

No credential, cookie or token is read at any point, and nothing leaves the
browser. The payload contains ship names and the pledge label they came from —
nothing else.

## The update nudge

The "don't nag me ten times a day" rule lives in `shouldOfferImport()`:

1. Hash the fleet into a stable fingerprint (FNV-1a over the sorted
   `shipName#count` list).
2. Offer the import when the fleet has **never** been imported, or when the
   fingerprint **differs** from the last imported one.
3. Stay silent when the fingerprint is unchanged — an untouched hangar never
   asks again.
4. A "Not now" suppresses **that exact fingerprint** for 7 days. Buy a ship the
   next day and the fingerprint changes, so the offer returns immediately;
   change nothing and it stays quiet.

The popup can always re-open an offer that was dismissed, so the cooldown can
never lock a user out.

Page crawling is throttled: the pledge pages are re-read at most every 15
minutes, and only the fingerprint plus the ship count are persisted between
visits — never the ship list itself.

## Install (developer mode)

Until the Chrome Web Store review is done:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `browser-extension/` directory.
3. Open <https://robertsspaceindustries.com/en/account/pledges> while signed in.

Also documented in-app at `/tools/extension`.

### Local development against a dev server

`http://127.0.0.1:4200` is deliberately **not** in the manifest. To test the
handover locally, add `"http://127.0.0.1:4200/*"` to `host_permissions`, to the
companion content-script `matches`, and to `COMPANION_ORIGINS` in
`hangar-core.js` — and do not commit that.

## Selector drift

RSI's hangar markup is not a contract. `parseHangarDocument()` is deliberately
tolerant (multiple selector candidates, allow-list of ship item kinds) and
drops anything it is unsure about. Combined with the per-row confirm screen in
the web app, a broken selector degrades to "fewer ships offered", never to
"wrong data imported". If RSI reshuffles the page, update
`PLEDGE_ROW_SELECTORS` / `ITEM_LIST_SELECTORS` and the spec fixtures.
