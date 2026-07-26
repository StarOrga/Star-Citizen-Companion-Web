# RSI hangar import via browser extension

**Status:** implemented · **Date:** 2026-07-26 · **Source:** admin feedback
"Connection zu RSI machen, damit man seine Schiffe direkt aus dem Hangar
importieren kann"

## The problem

Users want their RSI hangar in the app without typing 40 ship names. There is
no public RSI hangar API, and the browser's same-origin policy forbids the web
app from reading `robertsspaceindustries.com` — with or without the user's
session. A server-side scrape would require the user's RSI credentials, which
is a hard no: we would be building a credential honeypot for a third-party
account we cannot secure.

## The decision

A **browser extension** is the only context where the page the user is already
looking at can legitimately be read. The extension parses the ship list from
the user's own hangar page and hands it to the web app, where the user confirms
it. Nothing else changes.

Explicitly rejected alternatives:

| Option | Why not |
| --- | --- |
| Server-side scrape with RSI login | Stores third-party credentials. Non-starter. |
| CORS proxy / edge function fetching RSI | Still needs the user's RSI session cookie. Same problem, more infrastructure. |
| Manual file export only (status quo) | Works, but relies on a third-party extension (HangarXPLOR) and a file round-trip. Kept as the fallback. |
| Extension talks to our backend directly | Would need a new endpoint plus a token in the extension. Avoided entirely — see handover below. |

## Handover without new auth surface

The hard constraint was: **no new endpoint, no new token, no service-role key,
no new RLS policy.** The extension therefore never talks to a server of ours.

```
RSI hangar page                  chrome.storage.local            Companion tab
parse → fingerprint → offer
[Import clicked]  ────────────►  pendingImport  ────────────►  companion-bridge
window.open(/hangar/import)                                    │ postMessage
                                                               ▼
                                                       Angular review screen
                                                       [user confirms rows]
                  ◄──── nudgeState.lastImport ◄──── committed(fingerprint)
```

The Angular page writes the confirmed ships through the existing
`HangarService` with the visitor's own Supabase session, hitting the same
self-only RLS as manual ship adding. The extension holds no credential of any
kind and needs none.

## The update-nudge policy

The explicit ask was: do not send the same message ten times a day for an
unchanged hangar, but do re-offer when something actually changed.

Implemented in `shouldOfferImport()` (`browser-extension/src/lib/hangar-core.js`):

1. The fleet is reduced to an FNV-1a fingerprint over the sorted
   `shipName#count` list. Order-independent, count-sensitive, case-insensitive.
2. Offer when never imported, or when the fingerprint differs from the last
   imported one.
3. Identical fingerprint → complete silence. This is the "10x a day" fix.
4. "Not now" suppresses **that fingerprint** for 7 days. A hangar that changes
   the next day gets a new fingerprint and therefore a fresh offer; an
   unchanged one stays quiet after a single dismissal.
5. The popup can clear the cooldown, so a dismissal can never lock a user out.

Serial numbers were considered for the fingerprint but RSI's pledges page does
not render them; ship name + count is the strongest signal available and is
exactly what "did my fleet change" means for this feature.

Page crawling is throttled to once per 15 minutes and capped at 10 pages /
500 ships. Only the fingerprint and the ship count are persisted between
visits — never the ship list itself (that is written only after an explicit
Import click, and deleted again once the app confirms).

## Privacy stance

Stated in the extension popup, in `browser-extension/PRIVACY.md`, and on
`/tools/extension`: only personalised **game content** (ship names and the
pledge label they came from) is read. No credentials, cookies, tokens, account
name, e-mail, pledge value or order data — and no network call to anything
except robertsspaceindustries.com itself, for the further pages of the user's
own list.

Permissions: `storage` plus host permissions narrowed to
`robertsspaceindustries.com/…/account/pledges*` and the two Companion origins.
No `tabs`, no `scripting`, no `<all_urls>`, no background service worker
(`window.open` under a user gesture replaces `chrome.tabs.create`).

## Web-app footprint

- `/hangar/import` (private) — review/confirm screen fed by `postMessage`.
- `/tools/extension` (public) — install + privacy page; public because the
  privacy notice must be readable before installing.
- Dismissible promo on the Codex landing, self-hiding when the extension is
  installed or the browser is not Chromium.
- `HangarImportComponent` gained a `preloadedRows` input so the file import and
  the extension import share one matching + confirm code path.

## Known fragility

RSI's hangar markup is not a contract. `parseHangarDocument()` uses layered
selector candidates and an allow-list of ship item kinds, and drops anything it
is unsure about. With the per-row confirm screen in front of every write, a
selector break degrades to "fewer ships offered", never to "wrong data
imported". Fixture-based tests live in
`src/app/hangar/rsi-hangar-core.spec.ts` and run in the normal `npm test` gate.

The parser could not be validated against a real logged-in RSI hangar during
implementation (no test account) — the first live run may need a selector
update. That is the one open risk in this feature.
