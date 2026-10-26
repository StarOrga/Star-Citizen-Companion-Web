# Contract: "Auf dem Handy weitermachen" (hand-off), backend + service

Wave 1 delivers the backend and the Angular API; Wave 2 builds the desktop popup on top of it.

## Flow

1. Desktop (signed in) calls `HandoffService.create()` -> edge function `handoff-create` -> one-time code (256 bit, shown once, 60 s TTL).
2. Desktop renders `created.url` (`https://<origin>/handoff?c=<code>`) as QR + copyable link.
3. Phone opens it -> `/handoff` route (`HandoffComponent`, layout `plain`, ungated) -> `HandoffService.redeem(code)` -> `handoff-redeem` mints a NEW session (see "Why this mint path") -> `auth.setSession` -> `navigateByUrl(target_path, { replaceUrl: true })`.
4. Desktop sees `status() === 'connected'` and `device()` ("Android - Chrome"); `revoke()` signs that phone out.
5. Fallback without camera: `sendMagicLink()` mails a sign-in link to the user's own address.

## Angular API (`src/app/core/handoff/handoff.service.ts`, providedIn root)

| Member | Meaning |
| --- | --- |
| `create(targetPath?) : Promise<HandoffCreated>` | `{ id, code, url, expiresAt (epoch ms) }`. `targetPath` defaults to the current location; sanitised through `handoffTargetPath()` (same-origin, never `/handoff` or `/login`, else `/`). Starts the status polling. Rejects with the raw error -> show `toErrorKey('handoff','create',err)`. A 429 (`rate_limited`) maps to `errors.rateLimit`. |
| `status : Signal<'idle'｜'pending'｜'connected'｜'expired'｜'revoked'｜'error'>` | Polls the own row every 2 s (`HANDOFF_POLL_MS`). `expired` once `expiresAt` passed unredeemed. `connected` keeps polling so a revoke from another tab shows up; call `stopWatching()` when the popup closes. |
| `device : Signal<string｜null>` | Coarse label of the redeeming browser. |
| `current : Signal<HandoffCreated｜null>`, `connected : Signal<boolean>` | Convenience. |
| `revoke() : Promise<void>` | `handoff-revoke`: deletes the phone's `auth.sessions` row (or burns an unredeemed code). |
| `sendMagicLink(targetPath?) : Promise<void>` | Mail to `AuthService.realUser().email` only (no address input). Redirect = `origin + handoffTargetPath(path)`. Implicit-flow throwaway client, because a PKCE verifier would live on the desktop and a link opened on the phone could never complete. Supabase's own redirect allow-list (Auth URL config) applies on top. |
| `redeem(code) : Promise<string>` | Phone side; returns the sanitised target path. Used by `HandoffComponent` only. |
| `stopWatching()` | Clears the poll timer (also on destroy). |

Suggested i18n for Wave 2: reuse `handoff.title`; add popup keys yourself (`handoff.*` namespace exists with `title`, `working`, `invalid`, `toLogin`).

## Edge functions

- `handoff-create` (JWT on): `POST { target_path }` -> `{ id, code, expires_at }` | `400 invalid_path` `401` `429 rate_limited` (5 codes / 10 min / user).
- `handoff-redeem` (`verify_jwt = false`): `POST { code }` -> `{ access_token, refresh_token, expires_at, target_path }` | `404 invalid_code` (unknown, expired, used - indistinguishable) `429` `502 mint_failed` (code stays burned; request a new one).
- `handoff-revoke` (JWT on): `POST { id }` -> `{ revoked }` | `404 not_found`.

Table `public.handoff_codes` (migration `20261026120000_handoff_codes.sql`): only `sha256(code)` stored; RLS select-own with a column grant that hides `code_hash` and `session_id`; writes service-role only; `handoff_redeem()` / `handoff_revoke_session()` are service-role-only security-definer functions; pg_cron `handoff-codes-cleanup` every 15 min plus on-read cleanup in `handoff-create`.

NOT deployed, NOT pushed to the DB by Wave 1: the close-out must `db:push` the migration and deploy the three functions (CI deploys on merge; `handoff-redeem` needs the `config.toml` entry, already added).

## Why this mint path

GoTrue has no "create session for user" call. `auth.admin.generateLink({type:'magiclink'})` returns a hashed OTP without sending mail; a throwaway anon client redeems it with `verifyOtp`. This is the same supported path `desktop-session` has used in production since 2026-08, yields an independent `auth.sessions` row with its own refresh chain, and never reads or copies the desktop's tokens. Alternatives rejected: sending the desktop's refresh token (shared rotation chain, the exact bug desktop-session removed), signing our own JWT (needs the JWT secret in a function and bypasses sessions/revocation).

Limitation: `generateLink` invalidates a previous unused magic-link OTP of that user; irrelevant in practice (OTPs are consumed immediately).

## Threat model

| Threat | Mitigation |
| --- | --- |
| QR shoulder-surfing / photographed screen | 60 s TTL, single use (atomic UPDATE), the popup should show the QR only while `pending` and hide it on `connected`/`expired`; the owner sees the connected device label and can `revoke()`. Residual: a stranger who scans within the 60 s wins the race - revoke is the answer; the UI must say so. |
| Replay of a used / expired code | `handoff_redeem` is a single `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`; parallel redeems cannot both win; failures are uniform 404. |
| Code leak from DB / logs | Only SHA-256 stored; column-level grant hides the hash from the owner; codes and tokens are never logged; `cache-control: no-store`. The code is in the URL only on the phone, and `replaceUrl` removes it from history; `Referrer-Policy` is already `strict-origin-when-cross-origin` on Vercel, so the query string never leaves the origin. |
| Brute force | 256-bit code (guessing infeasible); shape check before any DB work; best-effort 10-failures/10 min per-IP throttle per isolate; creation rate-limited per user. |
| Open redirect | `target_path` validated at create (server) and again before navigating (client): must start with a single `/`, no `//`, no backslash, no whitespace/control chars, <= 512, never `/handoff` or `/login`; DB check constraint as last line. Magic link `redirectTo` is built as `origin + validated path` and is additionally bound by Supabase's redirect allow-list. |
| Session fixation | The phone never accepts an attacker-chosen session: redeem returns a freshly minted session for the code's owner, created server-side after the code was consumed; the code is bound to `user_id` at creation under the verified JWT (no user id in the body). |
| Stolen-code abuse of another account | A code only ever yields a session for the user who created it while authenticated. |
| Desktop token exposure | Never touched: the new session has its own refresh chain; `revoke()` deletes only it. A global sign-out on the website still revokes everything (same as desktop-session). |
| Email magic link fallback abuse | Sent only to the signed-in user's own address, `shouldCreateUser: false`, Supabase's built-in OTP rate limit. |

Revocation caveat: an already-issued access JWT of the phone lives at most its own lifetime (1 h); GoTrue rejects it on `/user` once the session row is gone, while PostgREST calls with the stateless JWT may still pass until expiry. Acceptable for this feature, stated here so nobody assumes instant kill.
