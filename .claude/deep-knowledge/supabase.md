# Supabase — SC Companion

Cloud project: **`hcnqhvzlavdycidqyaai`** (region `eu-central-1`, free tier, organization "Jerrys Projects").

## URLs and keys

- Project URL: `https://hcnqhvzlavdycidqyaai.supabase.co`
- Publishable key (frontend): `sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ` (in `src/environments/environment.ts`)
- Anon legacy JWT: kept for SDK compat — same effect, prefer the publishable key for new code
- Service-role key: **never commit**, never in frontend. Edge functions read it from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

## Schema (migrations directory)

| Migration | What |
|---|---|
| `00001_init_schema.sql` | `profiles` (auto-created on signup), `p4k_uploads`, enum types, RLS policies, `handle_new_user` trigger |
| `00002_storage_bucket_p4k.sql` | Storage bucket `p4k-uploads` + per-user-folder RLS |
| … | (additive migrations 00003–20260603: roles/releases/bundles, codex catalog, public API tokens, invite-only access, ship skins, …) |
| `20260604_news_image_cache.sql` | Public bucket `news-images` + `verse_image_cache` index for server-side caching of RSI news thumbnails |
| `20260727170000_news_image_variants.sql` | `verse_image_cache.top_width` / `.bytes` — the compacted variant ladder (see **News-image storage** below). `top_width IS NULL` = not yet migrated |
| `20260724130000_user_ship_links.sql` | User-supplied RSI pledge links: `is_rsi_pledge_ship_url()` allowlist + `user_ship_links` (private) + `ship_pledge_links` (global, admin-only) |
| `20260726170000_user_feedback_channel.sql` | Non-admin feedback channel on the shared `admin_feedback` board: `source`/`triaged`/`decision_note` columns, `feedback_author_messages`, the author-facing `public.my_feedback` view (**its `revoke all … / grant select` pair is load-bearing**) |
| `20260726220000_ship_hardpoint_transforms.sql` | `codex_item_ports.helper_name` / `.position` / `.rotation` — where a hardpoint sits on the hull. All nullable; NULL = position unknown (the state of every row until the uploader re-runs). Coordinates are metres in hull model space, CryEngine axes (`+X` starboard, `+Y` nose, `+Z` up). The ship-level map incl. default-loadout mounts rides in `codex_ships.payload.hardpointTransforms` + `.hardpointFrame`. |
| `20260726230000_admin_feedback_seq.sql` | `admin_feedback.seq` — the board's stable topic number ("#42"), sequence-fed, backfilled oldest-first, admin-only (not in `my_feedback`) |
| `20260903120000_admin_feedback_area.sql` | `admin_feedback.area` — which part of the app a topic is about (`news`/`codex`/`hangar`/`starscape`/`desktop`/`settings`/`admin`/`other`, pinned by `admin_feedback_area_check`). Nullable; every pre-existing topic stays untagged and renders as nothing. The composer pre-selects it from the sender's current route, so it is normally confirmed rather than chosen. Vocabulary mirrors `FEEDBACK_AREAS` in `src/app/feedback/feedback-area.types.ts` — change both or neither. Recreates `public.my_feedback` with the column added (**keep the `revoke all … / grant select` pair**) so an author sees their own tag |
| `20260903163000_feedback_read_state.sql` | `feedback_read_state` (PK `(user_id, feedback_id)`) — when a feedback author last looked at one of their own topics and which coarse `author_status` they saw. Drives the unread badge on the non-admin feedback FAB. Owner-only in all four verbs, **no admin policy** (read receipts are not board data); `feedback_read_state_guard` pins `last_read_at` to the server clock and refuses a topic `owns_feedback()` rejects. `last_seen_status` is deliberately the client's "what I saw", not a re-derivation — a status that flips right after a read must still count as news. The badge itself is computed client-side in `topicHasNews()` (`src/app/feedback/user-feedback.types.ts`); nothing here is kept in sync by a trigger on the board |
| `20260903230000_user_feedback_withdraw.sql` | An author may WITHDRAW their own topic (feedback 892013b6). `feedback_withdrawable(uuid)` (SECURITY DEFINER, like `feedback_awaits_author`) is the window — own `source='user'` topic, still `status='open'`, **and no message in either thread** — and it is used by BOTH the new `admin_feedback_delete_author` DELETE policy and the new `my_feedback.can_delete` column, so the offered button and the enforced rule cannot drift. The empty-thread half is the load-bearing one: a topic can return to `open` long after it was worked on (reaper, reopen trigger, "Gespräch wieder aufnehmen") and every child FK is `ON DELETE CASCADE`, so `status='open'` alone would let one click take an admin's conversation with it. Additive: the admin-only `admin_feedback_delete` policy is untouched (policies are OR'd). Recreates `public.my_feedback` (**keep the `revoke all … / grant select` pair**) |
| `20260802080000_protected_admins.sql` | Founder-admin protection — `protected_admins`, the `profiles_protected_admin_guard` + `profiles_role_write_guard` triggers, `protect_admin()`/`unprotect_admin()` (service_role only), the `protected_admin_removal_requests` seam. See **Protected admin accounts** below |
| `20260805120000_email_allowlist.sql` | `allowed_emails` (admin-managed sign-in allowlist), extends `handle_new_user()` with the allowlist branch, admin RPCs `list_allowed_emails()`/`remove_allowed_email()`, service-role helper `email_to_user_id()`, and the `is_approved()` RESTRICTIVE RLS gate on self-scoped hangar/loadout/link/draft tables. See **Email allowlist & access control** below |
| `20260901182500_starscape_wallpaper_votes.sql` | Starscape thumbs-up: `wallpaper_votes` (PK `(image_id, user_id)` = one vote per user per image; self-read only, so nobody can see who voted), the two SECURITY DEFINER read paths `starscape_vote_state(text[])` (counts + "did I", no user_id) and `starscape_top_wallpapers(int)` (global ranking, `votes desc, published_at desc` — the newest wallpapers fill the slots nobody has voted for yet), plus `profiles.starscape_top_only` + `set_starscape_top_only()` for the per-user "Top 7 only" toggle the Starscape desktop app will share |
| `20260903170000_verse_wallpapers_variant_groups.sql` | Starscape variant groups (feedback fcd956cf) — additive only: `verse_wallpapers.width`/`height` (largest known artwork size), `thumb` (crop-tolerant signature, `v1:<w>x<h>:<base64 rgb>`, written by `variant-signature.ts`), `variant_group` + `variant_role` (`single`\|`primary`\|`ratio`\|`duplicate`, CHECK-constrained, default `single` so an ungrouped row is fully visible), plus a partial index on the visible roles and one on the group key. RSI publishes one artwork in several CROPS under separate media ids, which `phash` cannot see (a crop moves every cell of a global hash — the live duplicate pairs measured 78–115 bits apart while the gate is 48). Look-alikes are **grouped, never deleted**: consumers list `single`+`primary`, `ratio` rows stay available for a client picking the shape closest to its screen, `duplicate` rows are same-shape lower-res copies. No policy or grant change — the table-level `select` grant already covers new columns |
| `20260903220000_social_graph_reports.sql` | The social graph, phase 1 of admin feedback cf0ddf7d: `friend_requests`, `friendships` (stored once as the ordered pair `user_low < user_high`), `user_blocks`, `user_reports`. **No table has a write policy** — `send_friend_request()` / `respond_friend_request()` / `withdraw_friend_request()` / `remove_friend()` / `block_user()` / `unblock_user()` / `report_user()` are the only write paths, all SECURITY DEFINER and all pinning the actor to `auth.uid()`. Reads go through `list_my_friend_edges()` (one round trip, four `kind`s) because `profiles` is self-read only; `find_user_by_username()` is EXACT-match on purpose (a prefix search would be a user-enumeration endpoint). `list_users_for_admin()` gains `report_count`; `list_reports_for_admin()` is the admin's read-only report feed. Account suspension and loadout sharing are deliberately **not** here — phase 2 |
| `20260904030000_verse_wallpapers_hide_roadmap_roundup.sql` | Takes the "Roadmap Roundup" series out of the Starscape gallery. `verse_wallpaper_series_visible(text)` is the single predicate; the `verse_wallpapers_public_read` policy and `starscape_top_wallpapers()` both call it (the RPC is SECURITY DEFINER, so the policy does **not** reach it — that is why it is patched too). **Read filter, not a delete**: excluded rows stay in the table, invisible to `anon`/`authenticated`, so the change is reversible and `wallpaper_votes`' FK cascade never fires. It lives in RLS because the Starscape desktop app queries `verse_wallpapers` through PostgREST itself (`wallpaper-app/src/net.rs`) — a policy reaches installed apps, a client-side filter would need a Rust release. Write side: `isWallpaperSeries()` in `supabase/functions/fetch-verse-news/wallpaper-series.ts`; change both or neither |
| `20260823130000_desktop_connections.sql` | `desktop_connections` — per `(account, desktop product)` check-in ledger behind the "is your desktop app connected?" line in the download menu. Written **only** through `desktop_touch_connection(product, app_version)` (SECURITY DEFINER, keyed on `auth.uid()`), read through `my_desktop_connections()` (own rows + a `p4k_bundles` fallback so pre-ledger uploaders are not "never connected"). 30 days is the connected/expired split and lives in `src/app/desktop/desktop-access.ts`, not in SQL |

### RLS summary

- `profiles`: self-only (read + insert + update on `auth.uid() = id`). **Role/approval columns are not self-writable** — `profiles_role_write_guard` rejects any `role`/`is_approved` change coming from a raw `authenticated`/`anon` PostgREST session, so `set_user_role()` (SECURITY DEFINER) and service_role are the only write paths.
- `protected_admins`: `select` for admins, **no write policy at all** — `service_role`/DB owner only. See below.
- `p4k_uploads`: self-only (select + insert + delete on `auth.uid() = user_id`). Updates blocked for authenticated users — **only the service role (edge functions) writes status/result back**.
- `storage.objects` in `p4k-uploads`: scoped to `(storage.foldername(name))[1] = auth.uid()::text`. Files MUST be uploaded under `<userId>/<filename>` paths or the policy rejects.
- `user_ship_links`: self-only, all four verbs (`auth.uid() = user_id`, writes additionally require `created_by = auth.uid()`). A user's pinned RSI pledge link is **private** — no admin path reads it.
- `ship_pledge_links`: public `select` (anon + authenticated), **admin-only** insert/update/delete (`public.is_admin()`). This is the only table that makes a user-supplied link globally visible, and it is only ever written by an explicit admin promotion.
- `wallpaper_votes`: `select`/`insert`/`delete` on own rows only (`auth.uid() = user_id`), **no update policy at all** (a vote has nothing to update, and without one a row cannot be re-keyed onto somebody else's user id), plus the same RESTRICTIVE `is_approved()` gate the other self-scoped tables carry. `anon` has no grant whatsoever. The AGGREGATE is deliberately not a table read: `starscape_vote_state()` / `starscape_top_wallpapers()` are SECURITY DEFINER and return counts without ever returning a `user_id`, so "12 people liked this" is public and "who" is not.
- `verse_wallpapers`: public `select` for anon + authenticated, but **filtered**: `using (public.verse_wallpaper_series_visible(series))` hides series whose artwork must never be shown (currently only "Roadmap Roundup"). Writes stay service-role only, and the crawler is unaffected — it reads with the service role, so a hidden row's perceptual hash still works as a near-duplicate reference. Anything that reads this table with a SECURITY DEFINER body bypasses the policy and must repeat the predicate; `starscape_top_wallpapers()` is the one that does.
- `desktop_connections`: `select` on own rows (`auth.uid() = user_id`) plus a read-all policy for admins. **No insert/update/delete policy exists for anybody** — `desktop_touch_connection()` is the sole write path, so a client can neither backdate its own check-in nor forge somebody else's.
- `friend_requests` / `friendships`: `select` for either side of the edge (`auth.uid()` is requester **or** addressee / `user_low` **or** `user_high`). **No write policy for anybody** — the friend RPCs are the sole write path, which is what makes "the other side removed me" unforgeable.
- `user_blocks`: `select` for the **blocker only**. A policy that also matched `blocked_id` would turn the table into a "who blocked me" feed; the block has to be undetectable from the other side, which is also why `send_friend_request()` and `find_user_by_username()` answer identically for "blocked" and "no such user".
- `user_reports`: `select` for admins (`public.is_admin()`), nothing for the reporter. Inserts go through `report_user()` only, which pins `reporter_id` to `auth.uid()`, allows one OPEN report per reporter+target (partial unique index), caps a reporter at 20 open reports, and requires an existing edge to the target — the report count is what the admin surface sorts by, so inflating it is the attack.
- All four social tables additionally carry the RESTRICTIVE `is_approved()` gate from `20260805120000`.
- **Release rings are gated in SQL, not in the template.** `desktop_release_for_channel()` / `starscape_release_for_channel()` are SECURITY DEFINER and clamp the requested channel down to `current_user_role()` (admin→alpha, collaborator→beta, everyone else→stable). Asking for `alpha` as a viewer answers with the stable row, never with alpha metadata — which is why every caller drops rows whose `channel` is not the ring it asked for. Hiding a ring in Angular is presentation; this clamp is the gate.

**User-supplied URLs** (`user_ship_links.url`, `ship_pledge_links.url`, `hangar_concept_ships.rsi_url`) are gated by `public.is_rsi_pledge_ship_url(text)` — an anchored allowlist for `https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>`. The same rule lives in `supabase/functions/ship-link/_rsi-url.ts` (the write authority) and `src/app/core/rsi-pledge-link.util.ts` (friendly client error). Change one → change all three. Such a URL is **data, never an instruction**: render it only as `<a [href] target="_blank" rel="noopener noreferrer nofollow">`, never `innerHTML`, never inside an LLM prompt.

## Email allowlist & access control (`allowed_emails`)

Design doc: `docs/superpowers/specs/2026-08-05-access-control-allowlist-design.md`.
Turns invite-only (`20260530000001`) into a proper allowlist: an admin can
pre-register an email at a target role, before that person ever signs up, and
optionally still send a Supabase invite mail.

- **`allowed_emails`** — `email citext primary key`, `role` (`admin` /
  `collaborator` / `viewer`, default `viewer`), `added_by` (the admin who
  added it), `note`, `created_at`, `consumed_at` (stamped on first matching
  signup). RLS is **admin-only in every direction** — `service_role`
  bypasses RLS for the edge function's upsert; anon and non-admin
  authenticated get nothing (must never leak who is invited).
- **`handle_new_user()`** (re-`create or replace`d in this migration, keeps
  the bootstrap + invited branches from `20260530000001`) now also
  auto-approves a signup whose email matches an `allowed_emails` row, at
  that row's pre-assigned role, and stamps `consumed_at`. The trigger only
  fires on `auth.users` INSERT, so **every existing account is
  grandfathered** — nothing here re-approves or de-approves anyone already
  signed up.
- **Admin RPCs**: `list_allowed_emails()` (projects `joined` = an
  `auth.users` row already exists for that email) and
  `remove_allowed_email(target_email)`. Both SECURITY DEFINER, `raise
  exception` for non-admins, `EXECUTE` granted to `authenticated` (the
  function body is the real gate).
- **`email_to_user_id(target_email)`** — SECURITY DEFINER, `service_role`
  execute only. Exists because the GoTrue admin JS SDK's `listUsers()` has
  no reliable server-side email filter across client versions; the
  `invite-user` edge function RPCs this instead of scanning pages.
- **`is_approved()`** — SECURITY DEFINER helper (`profiles.is_approved` for
  `auth.uid()`, `false` if no row). Backs a RESTRICTIVE `FOR ALL` policy
  (`<table>_approved_gate`) added — additively, nothing dropped — on
  `hangar_ships`, `hangar_ship_configs`, `hangar_role_loadouts`,
  `hangar_concept_ships`, `user_ship_links`, `feedback_drafts`: these were
  previously self-only (`auth.uid() = user_id`) with no approval check, so
  a signed-up-but-never-approved account (valid JWT, reachable only via a
  direct PostgREST call, not the app UI) could still read/write its own
  rows there. Every pre-existing user was already backfilled to
  `is_approved = true`, so this is a no-op for anyone who could already use
  the app. `profiles` itself is deliberately **not** gated this way — an
  unapproved user must still be able to read their own `is_approved: false`
  so the client `approvedGuard` can bounce them.
- **`invite-user` edge function** (name kept for route stability; UI labels
  it "Registrieren"). Body `{ email, role, sendInvite }`. Always upserts
  `allowed_emails`; if an `auth.users` row already exists for that email it
  is approved + role-set in place (`approved_existing`); otherwise, only if
  `sendInvite` is true, it also calls `inviteUserByEmail` (`invited`) —
  without `sendInvite` it stays allowlist-only (`allowlisted`). Response is
  a discriminated `{ status: 'allowlisted' | 'approved_existing' | 'invited', ... }`.

## Protected admin accounts (`protected_admins`)

Threat model (admin_feedback #83): a **compromised admin account** must not be able to
lock the founders out. Before this, an admin could demote a founder via `set_user_role()`,
via a direct `UPDATE public.profiles SET role = …` (the blanket `profiles_admin_role_update`
policy from `00003` allows it, bypassing the last-admin guard), soft-lock them out with
`is_approved = false`, or delete them through the `delete-user` Edge Function.

Enforcement is **in the database** — a UI guard would be pointless against a stolen token:

| Layer | Object | Effect |
|---|---|---|
| 1 | FK `protected_admins.user_id → auth.users(id) ON DELETE RESTRICT` | GoTrue `admin.deleteUser()` on a protected account fails before any trigger runs |
| 2 | Trigger `profiles_protected_admin_guard` (BEFORE UPDATE OR DELETE, SECURITY DEFINER) | Rejects `role`/`is_approved`/`id` changes and deletes of protected accounts for **every** caller, service_role included |
| 3 | Trigger `profiles_role_write_guard` (BEFORE UPDATE, **SECURITY INVOKER** — it reads `current_user`) | Blocks direct `role`/`is_approved` writes from `authenticated`/`anon`; closes the old self-promotion hole in `profiles_self_update` |

The protected set is data, not a hardcoded string: rows in `public.protected_admins`,
seeded by matching `auth.users.email` against **two exact addresses** (the two founder
accounts). Address identity is the key on purpose: display names and handles are
user-editable, so a fuzzy predicate could protect the wrong account (a second admin
shares one founder's family name) or silently none. The migration **aborts** if either
account has no profile — the seed is never half-applied.

The addresses themselves are **not in the repo**: the predicate compares
`encode(sha256(convert_to(lower(email),'UTF8')),'hex')` against two digest constants
(core PostgreSQL, no pgcrypto). The repo is public, so a literal address here is a
personal address published and scraped for good — feedback #83, 2026-08-07. It is
anti-scraping, not secrecy: a digest confirms an address you already guessed, and it
cannot un-publish what older revisions already wrote into the git history.
`npm run check:emails` (also part of `prebuild`) fails the build if a new personal
address is added — that is the durable half of the fix. To resolve or rotate a digest:
`node -e "console.log(require('crypto').createHash('sha256').update('<addr>'.toLowerCase()).digest('hex'))"`.
**Legitimate removal** (the only way through) needs the service key:

```sql
select public.unprotect_admin('<uuid>');   -- service_role only, EXECUTE revoked from authenticated
-- … now demote/delete normally …
select public.protect_admin('<uuid>', 'founder');
```

`list_users_for_admin()` projects a `protected boolean`; the admin table renders a
"Geschützt/Protected" badge and disables the role + delete buttons for those rows
(`src/app/admin/admin-protection.ts`).

**E-mail confirmation is NOT implemented.** The repo has no outbound transactional-mail
path — the only mail we send is GoTrue's built-in invite (`functions/invite-user`), whose
templates are auth-flow only, and `config.toml` configures no custom SMTP. Adding a provider
means a new secret, i.e. a separate decision. `public.protected_admin_removal_requests` is
the prepared seam (request row → signed link in a mail → confirmed token → `unprotect_admin`
+ delete); only `service_role` can advance a request's `status`.

## Edge Functions (`supabase/functions/`)

| Function | Purpose | `verify_jwt` |
|---|---|---|
| `fetch-verse-news` | Proxies `api.star-citizen.wiki` Comm-Link + RSI status RSS into a single `VerseFeed` JSON. Also **server-side caches** each news image into the public `news-images` bucket (service-role download w/ RSI `Referer`, re-encoded variant ladder, `verse_image_cache` index, ≤4 new images/request, processed sequentially) and rewrites the urls — fixes broken hotlinked RSI CDN thumbnails. | `true` |
| `process-p4k` | Analyzes a P4K upload's first 64KB, writes back via service-role. | `true` |
| `ship-link` | Write authority for user-supplied RSI pledge links (`set`/`remove` own, admin `promote`/`unpromote` global). Enforces the URL allowlist server-side + a per-user rate limit (20 writes / 5 min, in-isolate) + a hard ceiling of 500 links per user. Uses **no service-role key** — it writes through the caller's own client so RLS still applies. | `true` |

Both functions deployed via Supabase MCP (`mcp__10628b5d-*__deploy_edge_function`).

## News-image storage (`news-images` bucket)

The free plan gives **1 GB of storage in total**, and this bucket was 809 MB of it
(496 objects) before 2026-07-27 — the single biggest quota risk in the project.
Two causes, both fixed:

1. Every source was written **twice**, as `<hash>/post.<ext>` and
   `<hash>/cover.<ext>`, and for most sources both downloads returned the *same*
   file → a byte-identical twin of everything.
2. The bytes were stored **verbatim at RSI resolution** — PNGs up to 9.2 MB, 8K
   originals — to serve tiles that render at ~320 CSS px.

**Current scheme.** `<hash>/w<width>.<ext>`, one object per real pixel width,
re-encoded (JPEG, or PNG when the source has real alpha), `cache-control:
max-age=31536000, immutable`. The ladder is
`[400, 800].filter(w => w < top).concat(top)` where `top` = source width capped at
1600 — so the *whole ladder is derivable from the top url alone*, which is the one
the feed returns. `w0` is the reserved "single object, unknown width" case for a
source we cannot decode.

- Sizing/quality/naming: `supabase/functions/fetch-verse-news/image-variants.ts`
  (shared, pure). Codec bindings: `image-codecs.ts` (Deno) and
  `scripts/lib/node-image-codecs.mjs` (Node) — both jpeg-js + pngjs, pure JS.
- Client side: `src/app/news/news-image-variants.ts` mirrors the ladder constants
  and builds the truthful `srcset`. Change one → change both (a spec pins it).
- **WebP/AVIF output was rejected on purpose**: no lightweight pure-JS encoder
  exists, and a wasm codec in a request-scoped function that serves the whole news
  page is a bad trade for the last ~35 %. The order-of-magnitude win is resizing +
  de-duplication. WebP *sources* are consequently undecodable for us and end up as
  a single `w0` passthrough.

**Backfill:** `npm run news:compact` (`scripts/news-image-compact.mjs`). Dry run by
default; `--apply` writes. Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from
the environment. Idempotent and resumable — it recomputes the plan from bucket + DB
state, never deletes before verifying the replacement exists, and refuses to delete
anything the surviving `verse_image_cache` row still references. `--prune-orphans`
additionally removes objects with no cache row (only when older than `--orphan-age`
hours, default 24, because live ingest uploads objects seconds before it writes the
row).

## MCP access

Use the no-OAuth shared MCP `mcp__10628b5d-14d2-4872-a01b-5c41055eb300__*`. Tools used in this project:

- `list_projects`, `get_project_url`, `get_publishable_keys`
- `apply_migration` — DDL
- `execute_sql` — data + introspection only (NOT DDL)
- `deploy_edge_function` — edge-function deploys
- `get_logs(service=...)` — debug runtime issues
- `get_advisors(type=security|performance)` — automated lint

## What MCP does NOT give us

- **Auth provider config** (toggling Google, SMTP, email confirmation). Dashboard-only: <https://supabase.com/dashboard/project/hcnqhvzlavdycidqyaai/auth/providers>.
- **Setting edge-function secrets.** Dashboard or `npx supabase secrets set KEY=value --project-ref hcnqhvzlavdycidqyaai`.

## Deployment checklist (after merging to main)

1. Frontend: pushed to main → Vercel auto-deploys.
2. Migration changes: `npm run db:push` against cloud (or `apply_migration` via MCP for one-off DDL).
3. Edge-function changes: `npm run functions:deploy` (or `deploy_edge_function` via MCP).
4. Auth provider / secrets changes: dashboard, manual.

## Alpha-phase data policy

The app is in alpha until `appPhase` in `src/environments/environment*.ts` flips to `beta`. Migrations are allowed to drop legacy data, **except** anything in `auth.users` and `public.profiles`. Always document drops in the migration comment.
