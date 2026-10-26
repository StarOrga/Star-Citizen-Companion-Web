# Contract: "Auf dem Handy weitermachen" (hand-off), backend + service

Wave 1 delivers the backend and the Angular API; Wave 2 builds the desktop popup on top of it. Revised after the red-team review (R1-R12).

## Flow

1. Desktop (signed in) calls `HandoffService.create()` -> edge function `handoff-create` -> one-time code (256 bit, shown once, 60 s TTL).
2. Desktop renders `created.url` (`https://<origin>/handoff#c=<code>`, code in the FRAGMENT) as QR + copyable link.
3. Phone opens it -> `/handoff` route (`HandoffComponent`, layout `plain`, ungated). The page strips the fragment from the address bar, makes a read-only `peek` and shows "Als j***@g***.test anmelden". **Nothing is signed in until the user taps** (login-CSRF guard). If another account is already signed in on the phone, the tap first needs a `ScConfirmService` confirmation.
4. Tap -> `redeem` -> `handoff-redeem` mints a NEW session -> `auth.setSession` -> `navigateByUrl(target_path, { replaceUrl: true })`.
5. Desktop sees `status() === 'connected'` and `device()`; `revoke()` signs that phone out. `listConnected()` + `revoke(id)` survive a page reload.

There is no email magic-link fallback (R1, see Open items).

## Angular API (`src/app/core/handoff/handoff.service.ts`, providedIn root)

| Member | Meaning |
| --- | --- |
| `create(targetPath?) : Promise<HandoffCreated>` | `{ id, code, url, expiresAt (epoch ms) }`. Path sanitised by `handoffTargetPath()` (same rules as the server: single leading `/`, no `//`, no backslash, no whitespace/control chars, <= 512, never `/handoff` or `/login`; else `/`). Starts polling. Rejects with the raw error: render `await errorKey('create', err)`. |
| `status : Signal<'idle'｜'pending'｜'connected'｜'expired'｜'revoked'｜'error'>` | Polls the own row every 2 s. `expired` only when the clock passed `expiresAt` and the row is readable and unredeemed. A failed poll or vanished row counts as an error; 3 in a row -> `error` (never a false `expired`). After `connected` the poll continues for 2 minutes (to see a revoke from another tab), then stops; status stays `connected`. |
| `device`, `current`, `connected` | Signals: device label, last created hand-off, convenience boolean. |
| `listConnected() : Promise<{id, device, connectedAt}[]>` | Own redeemed, unrevoked hand-offs (RLS read). Use on popup open to show "Handy verbunden" after a reload. |
| `revoke(id?) : Promise<void>` | `handoff-revoke`. Defaults to the last created hand-off. Throws when nothing was revoked. Show `handoff.revoke.note` next to the button and `handoff.revoke.done` after: the phone loses access **at the latest within one hour**. |
| `peek(code)`, `redeem(code)` | Phone side; used by `HandoffComponent` only. |
| `errorKey(op, err) : Promise<string>` | i18n key: specific `handoff.errors.*` (`invalidCode` expired/used, `rateLimit`, `authRateLimit`, `mintFailed`, `revoked`, `revokeUnavailable`, `invalidPath`, `notFound`) when the function named the reason, else `errors.*` via `toErrorKey`. |
| `stopWatching()` | Clears the poll timer (also on destroy). Call when the popup closes. |

## Edge functions

- `handoff-create` (JWT on): `POST { target_path }` -> `{ id, code, expires_at }` | `400 invalid_path` `401` `429 rate_limited` (5 codes / 10 min / user, counted over ALL rows of the window before any cleanup).
- `handoff-redeem` (`verify_jwt = false`):
  - `POST { code, peek: true }` -> `{ email_masked }` (read-only, consumes nothing).
  - `POST { code }` -> `{ access_token, refresh_token, expires_at, target_path }`.
  - Errors: `404 invalid_code` (unknown/expired/used/revoked, indistinguishable) `409 revoked` `429 rate_limited` (our per-IP throttle: every call counts, failures extra) `429 auth_rate_limited` (GoTrue quota) `502 mint_failed` `500 server_error`.
  - Fail closed: after minting, `handoff_attach_session()` stores the session id unless the owner revoked in the meantime; if that fails or the session id is unreadable, the just-minted session is killed and no tokens are returned.
- `handoff-revoke` (JWT on): `POST { id }` -> `{ revoked, outcome }` where `revoked: true` only when a row actually changed (`revoked` session deleted, `pending` redeem in flight will fail closed, `burned` unredeemed code killed); `already` -> `revoked: false`; `404 not_found`; `501 revoke_unavailable` (no DELETE on `auth.sessions`).

Table `public.handoff_codes` (migration `20261026120000_handoff_codes.sql`): only `sha256(code)` stored; RLS select-own with a column grant hiding `code_hash` and `session_id`; all writes via service-role-only security-definer functions (`handoff_peek/redeem/attach_session/kill_session/revoke`). pg_cron `handoff-codes-cleanup` deletes expired unredeemed rows and rows revoked > 1 day ago; **consumed, unrevoked rows are kept** (their session may still live). Verified read-only on the cloud project 2026-10-26: `has_table_privilege('postgres','auth.sessions','DELETE') = true`; the kill function still maps `insufficient_privilege` to the distinct `revoke_unavailable`.

## Why this mint path

GoTrue has no "create session for user" call. `auth.admin.generateLink({type:'magiclink'})` returns a hashed OTP without sending mail; a throwaway anon client redeems it with `verifyOtp`. This is the path `desktop-session` already uses: an independent `auth.sessions` row with its own refresh chain, and the desktop's tokens are never touched. Rejected: sending the desktop's refresh token (shared rotation chain), signing our own JWT (JWT secret in a function, bypasses sessions/revocation).

## Rollout (R12)

1. `db:push` the migration FIRST, then merge/deploy the three functions (functions call the SQL functions; the reverse order 500s).
2. `handoff-redeem` needs `verify_jwt = false` (in `supabase/config.toml`; CI deploy honours it).
3. `generateLink` replaces a pending magic-link/recovery OTP of that user: if a user requests a password-reset mail and a phone redeem happens in the same minute, the mail link can be dead. Acceptable; tell support if it is reported.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Login CSRF (attacker's QR/link signs a victim's browser into the attacker's account) | No auto-redeem: the page peeks (masked account) and requires an explicit tap; a different signed-in account requires an extra confirmation dialog. |
| QR shoulder-surfing / photographed screen | 60 s TTL, single use (atomic UPDATE); popup should show the QR only while `pending`; owner sees the device label and can `revoke()`. A stranger scanning within the 60 s still wins the race; the UI must say so. |
| Replay of used / expired / revoked code | `handoff_redeem` is one `UPDATE ... WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`; uniform 404. |
| Revoke races a redeem in flight | `handoff_revoke` sets `revoked_at` atomically; `handoff_attach_session` refuses a revoked row and redeem kills the session it just minted and returns nothing. `revoked:true` only when something changed. |
| Code leak (DB, logs, Referer, history) | Only SHA-256 stored, hash column unreadable even for the owner; code in the URL fragment (never sent to a server or Referer), stripped via `history.replaceState` before the first request; `no-store`; no code/token logging. |
| Brute force | 256-bit code; shape check before any DB work; per-IP throttle counting peek and redeem (30 calls, 10 failures / 10 min, best effort per isolate); per-user create limit. |
| Identity oracle via peek | Peek reveals only a masked address for a live code; invalid codes are the uniform 404 and count as failures. |
| Open redirect | `target_path` validated on the server, again by the client validator (same rules, `/` fallback), and a DB check constraint. |
| Session fixation | The phone never accepts an attacker-chosen session; redeem mints a fresh session for the code's owner server-side; the code is bound to `user_id` taken from the verified JWT. |
| Desktop token exposure | Never touched; `revoke()` deletes only the phone's session. A password change or global sign-out still revokes everything. |

Revocation caveat: deleting the session kills the refresh chain immediately; an access JWT already issued stays valid at the stateless PostgREST layer until its own expiry (<= 1 h). Copy therefore says "at the latest within one hour".

## Round-2 changes

- **Account identity is the user id, not the mask.** `peek` returns `{ email_masked, user_id, target_path }` (the code holder would get a session for that user anyway, so nothing new leaks). The page compares `user_id` with `auth.realUser()?.id`: same id -> no redeem, navigate to `target_path`; different id and someone signed in -> `ScConfirmService` warning; the masked address is display only (`jane@gamma.test` and `jx@gmx.test` mask identically).
- **"Connected" = session attached.** Column `session_attached` (generated from `session_id is not null`, granted to the owner) drives `status` and `listConnected()`. Every failure after the consume (user lookup, generateLink, verifyOtp, GoTrue 429, attach) calls `handoff_fail()` which sets `revoked_at`; the cron also deletes rows whose `session_id` is no longer in `auth.sessions` and consumed rows never attached after 10 minutes.
- Without a `session_id` claim the fail-closed path only logs (no GoTrue `/logout`, which could fall back to a global sign-out); tokens never leave the function.
- Throttle: expired entries pruned on each call; key = `cf-connecting-ip`, else the LAST `x-forwarded-for` hop (the first is client-forgeable). Not verified against Supabase docs.
- The double-tap on the sign-in button sends one redeem (busy claimed before the first await).

## Migration history

`20261026120000_handoff_codes.sql` was never `db:push`ed anywhere, which is why it was rewritten in place across the review rounds instead of adding follow-up migrations.

## Open items

- **Close-out smoke test for `verify_jwt` (R3).** `handoff-create` and `handoff-revoke` keep the default `verify_jwt = true`, copied from `desktop-session`. Run a real create -> revoke round trip with a live web session before shipping. If the gateway answers 401, add `[functions.handoff-create]` / `[functions.handoff-revoke]` with `verify_jwt = false` (both call `getUser()` themselves). `supabase/config.toml` carries conflicting comments on this: around lines 105-115 (`ingest-bundle`) say the gateway cannot validate live session tokens signed with the asymmetric keys, while `desktop-session` (JWT on) demonstrably works with a session token.

- **Email magic-link fallback (R1) dropped.** An implicit-flow link lands `#access_token=...` on the PKCE `realClient` (auth-js throws "Not a valid PKCE flow url" and leaves the tokens in the address bar), and the Supabase redirect allow-list only has `/news` and `/uploader/auth`. If a camera-less fallback is wanted later: a dedicated landing route that handles the implicit hash itself plus an allow-list entry, designed deliberately.
