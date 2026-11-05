# Social area: backend contract for wave 2

Migration: `supabase/migrations/20261105120000_social_area.sql`. Client: `src/app/social/social.service.ts`, `social-presence.service.ts`, `social.types.ts`. Error and label keys: `i18n/core.json` next to this file (the orchestrator merges it into `public/i18n`).

Existing and unchanged: `FriendsService` (graph, requests, block, report, `incomingCount()`), `LoadoutShareService` (set shares, links, `listSharedWithMe()`).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Redeeming an invite creates a **request**; the inviter still accepts. A crossing request becomes a friendship, as in `send_friend_request()`. | The round says "Klick stellt die Anfrage", the link is meant for Discord, and a friend sees the whole hangar by default. An auto-friendship would give that hangar to anyone holding the link. |
| D2 | One live invite per owner, 7 days. `create_friend_invite()` is idempotent; "new link" = `revokeInvite()` then `createInvite()`. | Same shape as `create_loadout_link()`. |
| D3 | `send_friend_request()` has **no rate limit** today, so there was nothing to copy. New limits, on invites only: 10 new links in 24 h per owner, 20 fresh pending requests in 1 h per redeemer, 50 pending per inviter. The plain username path stays unlimited. | The brief assumed a limit that does not exist. |
| D4 | A **group share is expanded at read time** for Einsätze and ship variants: adding a friend to the group later grants access, removing them or deleting the group revokes it. | The group is the audience, and revocation needs no cleanup. The UI should say so where a friend is added to a group that has shares. |
| D5 | A **set shared with a group fans out at share time** into `loadout_shares`; later members do not get it. | That table has no group column and its reader is existing code. |
| D6 | Revoking a `friend_shares` row deletes it. `loadout_shares` keeps revoke-never-delete. | 500 MB budget. |
| D7 | Adopting a friend's ship variant makes a **copy that does not follow** (`follows_owner = false`, `forked_at` set, `source_config_id` only for idempotence, `owner_user_id` as the "from" hint). | `hangar_follow_snapshot()` does not re-check a friendship, so a follower would keep reading after un-friending. |
| D8 | Adopting a ship variant adds the ship to the recipient's hangar as `owned` if it is missing, exactly as `adopt_shared_loadout()` does. An existing wishlist row is used and stays a wishlist row. A tombstoned row is never revived: while `hangar_ships_user_ship_key` counts it, the answer is `ship_unavailable`. | One behaviour for both adopt paths. Consequence: a newly added ship counts in `stats.ships`. The web client hard-deletes today, so the tombstone case cannot occur yet. |
| D9 | All four visibility facets default to ON; no row = all on. | R4 for the hangar; flagship is a subset of it; presence and stats would otherwise make C06 and C07 empty. |
| D10 | Friend-visible hangar = `hangar_ships` with `ship_class_name`, `custom_name`, `status` (owned **and** wishlist), `pinned_rank`. Never `notes`, `selected_skin_id`, configs or `hangar_concept_ships`. | "Deinen ganzen Hangar", without free-text notes. Render `status` so a wishlist entry does not read as owned. |
| D11 | Crew names: the owner sees all. A friend sees the name on a slot only for the owner, themselves and their own friends, otherwise `taken: true, taker: null`. The answer list `rsvps` is owner-only, friends get `counts`. | A share must not introduce two people who are not friends. |
| D12 | The Einsatz owner may answer and take a slot on their own Einsatz. | A planner usually flies along. |
| D13 | `done` and `archived` Einsätze take no more answers. `archived` also leaves the shared lists. | |
| D14 | Presence has its own table and RPC. `profiles.last_seen_at` stays the admin's. | Its 5-minute throttle and 15-minute client tick cannot back a 5-minute online window. |
| D15 | Presence exposes a boolean only, never a timestamp. | The feature asked for "online". |
| D16 | Invite route is `/invite/<token>`, public, not `/social/invite/<token>`. | A signed-out visitor must reach it and `/social/<name>` belongs to the handles. |
| D17 | `/social/<x>` accepts a handle or a user id; use `friendPath()`. | 8 of 10 accounts have no handle. |
| D18 | When a friendship ends (remove, block), the trigger `friendships_after_delete` removes in both directions: group memberships, `friend_shares`, RSVPs on each other's Einsätze, visibility overrides, and it revokes `loadout_shares` between the two. A re-friend starts clean. Adopted copies stay. **This changes existing set-share behaviour:** a set share used to come back on re-friending. | Read-time checks alone restored everything after block + unblock + re-friend. |
| D19 | `active_days_30` and `desktop_connected` follow the **presence** facet, not stats: null for a friend who hides presence, with the other numbers still there. | Both tell when somebody was around. |
| D20 | `source_loadout_id` and `source_owner_id` on `hangar_role_loadouts` are frozen by the trigger `hangar_role_loadouts_source_guard` outside `adopt_friend_loadout()`, except the one-way FK detach to null. | The table's self-only policies have no column list: a client could fake "from <friend>" and probe account existence through the FK. |

**Comparison numbers.** Real and included: ships (owned), sets, Einsätze planned (planned + active), Einsätze done, missions in 30 days (same count as `hq_stats`), Kartograph rank (patch lines with at least 7 stars, the rule of `verse_explorer_state`), active days in 30, desktop connected.

`desktop_connected` is true for a `desktop_connections` check-in **or** an `hq_live_events` row within 30 days: that ledger only knows `uploader` and `starscape`, the SCC App's proof of life is its live events.

**Dropped although the server knows them:** aUEC earned/spent, deaths, claims, crimestat, refinery, blueprints (all in `hq_live_events`). These describe in-game conduct and money, and nobody asked to expose them. Stars and suns as separate numbers: the rank is enough for now.

**Dropped because the server does not know it:** web page use. There is no per-user usage data, telemetry is anonymous by design. `active_days_30` is the closest real number.

**Not built:** joint goals (R3).

## RPCs

All are SECURITY DEFINER. "Actor" = `social_actor()`, which raises `not authenticated`, `account_suspended` or `not approved`. Reads marked `*` are silent instead (`is_approved()` in the WHERE, zero rows). Reads are in `READ_RPCS` (`core/deadline.ts`), writes are not. Tables have RLS on, no policy and no grant.

### Invites

| RPC | Args | Returns | Errors | Grant |
|---|---|---|---|---|
| `create_friend_invite` | none | jsonb `{token, expires_at}` | `invite_limit` | authenticated |
| `revoke_friend_invite` | none | void, idempotent | | authenticated |
| `my_friend_invite`* | none | rows `(token, expires_at)`, 0 or 1 | | authenticated |
| `peek_friend_invite` | `p_token text` | rows `(display_handle)`, 0 or 1; handle may be null | none: every dead link and a block = 0 rows | **anon**, authenticated |
| `redeem_friend_invite` | `p_token text` | jsonb `{verdict, user_id, display_name, username}`, verdict `pending` / `accepted` / `already_friends` | `invite_not_found` (also blocked), `invite_expired`, `invite_self`, `invite_rate_limited`, `invite_full` | authenticated |

### Groups

| RPC | Args | Returns | Errors |
|---|---|---|---|
| `create_friend_group` | `p_kind text`, `p_name text` | uuid | `invalid_group_kind`, `invalid_group_name`, `group_limit`, `group_name_taken` |
| `rename_friend_group` | `p_group uuid`, `p_name text` | void | `group_not_found`, `invalid_group_name`, `group_name_taken` |
| `delete_friend_group` | `p_group uuid` | void | `group_not_found` |
| `set_friend_group_member` | `p_group uuid`, `p_member uuid`, `p_in boolean` | void | `group_not_found`, `invalid_target`, `not_friends`, `group_full` |
| `list_my_friend_groups`* | none | rows `(id, kind, name, created_at, members jsonb)`; members = current friends only | |

### Visibility

| RPC | Args | Returns | Errors |
|---|---|---|---|
| `get_my_social_visibility` | none | jsonb `{general: {hangar, flagship, presence, stats}, overrides: [{user_id, display_name, username, hangar, flagship, presence, stats}]}` | |
| `set_my_social_visibility` | `p_hangar`, `p_flagship`, `p_presence`, `p_stats` boolean, all required | void | `invalid_target` |
| `set_friend_visibility` | `p_friend uuid`, the same four, null = inherit, all null = remove | void | `invalid_target`, `not_friends` |

### Presence

| RPC | Args | Returns | Errors |
|---|---|---|---|
| `touch_presence` | none | void, at most one write per 2 minutes | none, silent when not allowed |
| `list_online_friends`* | none | rows `(user_id)`: friends seen within 5 minutes who show it to me | |

### Shares

| RPC | Args | Returns | Errors |
|---|---|---|---|
| `share_einsatz` | `p_einsatz uuid`, `p_friend uuid`, `p_group uuid`, exactly one audience | `created` / `duplicate` | `einsatz_not_found`, `invalid_target`, `not_friends`, `group_not_found` |
| `share_ship_config` | `p_config uuid`, `p_friend uuid`, `p_group uuid` | `created` / `duplicate` | `config_not_found`, `invalid_target`, `not_friends`, `group_not_found` |
| `share_loadout_with_group` | `p_loadout uuid`, `p_group uuid` | integer, new rows | `loadout_not_found`, `group_not_found` |
| `revoke_friend_share` | `p_share uuid` | void | `share_not_found` |
| `list_friend_shares`* | `p_kind` (`einsatz` / `ship_config`), `p_subject uuid` | rows `(share_id, shared_with, friend_name, friend_handle, group_id, group_name, group_kind, created_at)` | |
| `list_einsaetze_shared_with_me`* | none | rows, see `SharedEinsatz`; one per Einsatz even when it reaches me twice; no `archived`; steps without `supply_id` and `done_by` | |
| `list_ship_configs_shared_with_me`* | none | rows, see `SharedShipConfig`; one per config | |
| `adopt_friend_loadout` | `p_share uuid`, a `loadout_shares.id` | jsonb `{loadoutId, existed}` | `share_not_found` |
| `adopt_friend_ship_config` | `p_share uuid`, a `friend_shares.id` | jsonb `{configId, shipClassName, existed}` | `share_not_found`, `ship_unavailable` |

Set shares to one friend stay on `share_loadout_with_friend` / `list_loadouts_shared_with_me` / `revoke_loadout_share`.

### Crew

Every crew RPC returns the `EinsatzCrew` jsonb: `{slots: [{id, ord, label, taken, mine, taker}], counts: {yes, maybe, no}, my_answer, my_slot, rsvps}`.

| RPC | Args | Errors | Who |
|---|---|---|---|
| `set_einsatz_slots` | `p_einsatz uuid`, `p_labels text[]`, the whole list, at most 12, each 1-40 chars | `einsatz_not_found`, `too_many_slots`, `invalid_slot_label` | owner |
| `respond_einsatz` | `p_einsatz uuid`, `p_answer text`, `p_slot uuid` (null = no slot, pass the current one to keep it; `no` always frees it) | `einsatz_not_found`, `einsatz_closed`, `invalid_answer`, `slot_not_found`, `slot_taken` | owner, friend with access |
| `get_einsatz_crew` | `p_einsatz uuid` | `einsatz_not_found` (also: no access) | owner, friend with access |

### Friend page and comparison

| RPC | Args | Returns | Errors |
|---|---|---|---|
| `friend_overview` | `p_friend text`, handle or user id | jsonb, see `FriendOverview`, or **null** for a non-friend, a block, a suspended or missing account | actor only |
| `list_friend_compare` | none | jsonb `{me: stats, friends: [{user_id, display_name, username, stats}]}`; `stats` null when hidden | actor only |

A hidden facet arrives as `null`, never as an empty list: `hangar`, `friend.flagship_ship_class`, `friend.online`, `compare.friend`. Inside a friend's stats, `active_days_30` and `desktop_connected` are null when presence is hidden. Render them as "not shared", not as 0 or "not connected"; `compareRows` already gives `friend: null, standing: null` for that row.

A suspended or unapproved account counts as gone everywhere: it has no access, its crew answer and slot disappear from every read, and anyone taking that slot evicts it.

## `SocialService`

Signals: `invite`, `groups`, `orgs`, `einsatzgruppen`, `visibility`, `onlineIds` (`ReadonlySet<string>`), `sharedEinsaetze`, `sharedShipConfigs`, `compare`, `busy`, `error`, `loadError`.

`error` is the last failed action, `loadError` the last failed load (render the error state with retry). A load failure keeps the last good value. Both hold i18n keys: `social.error.*` for a known code, `errors.*` otherwise.

| Method | Calls | Resolves to | Side effect |
|---|---|---|---|
| `loadInvite()` | `my_friend_invite` | void | `invite` |
| `loadGroups()` | `list_my_friend_groups` | void | `groups` |
| `loadVisibility()` | `get_my_social_visibility` | void | `visibility` |
| `loadOnline()` | `list_online_friends` | void | `onlineIds` |
| `loadSharedEinsaetze()` | `list_einsaetze_shared_with_me` | void | `sharedEinsaetze` |
| `loadSharedShipConfigs()` | `list_ship_configs_shared_with_me` | void | `sharedShipConfigs` |
| `loadCompare()` | `list_friend_compare` | void | `compare` |
| `friendOverview(handleOrId)` | `friend_overview` | `FriendOverviewResult`: `ok` / `missing` / `error` | none |
| `createInvite()` | `create_friend_invite` | `FriendInvite \| null` | `invite` |
| `revokeInvite()` | `revoke_friend_invite` | boolean | `invite` cleared |
| `peekInvite(token)` | `peek_friend_invite`, real client | `{display_handle} \| null`; null + `error` = failed call, null alone = dead link | |
| `redeemInvite(token)` | `redeem_friend_invite` | `InviteRedeemResult \| null` | caller reloads `FriendsService` |
| `createGroup(kind, name)` | `create_friend_group` | id or null | reloads groups |
| `renameGroup(id, name)` | `rename_friend_group` | boolean | reloads groups |
| `deleteGroup(id)` | `delete_friend_group` | boolean | reloads groups |
| `setGroupMember(id, memberId, inGroup)` | `set_friend_group_member` | boolean | reloads groups |
| `setVisibility(v)` | `set_my_social_visibility` | boolean | reloads visibility |
| `setFriendVisibility(friendId, override)` | `set_friend_visibility` | boolean | reloads visibility |
| `shareEinsatz(id, {friendId} \| {groupId})` | `share_einsatz` | `ShareVerdict \| null` | |
| `shareShipConfig(id, {friendId} \| {groupId})` | `share_ship_config` | `ShareVerdict \| null` | |
| `shareLoadoutWithGroup(loadoutId, groupId)` | `share_loadout_with_group` | count or null | |
| `listShares(kind, subjectId)` | `list_friend_shares` | rows or null | |
| `revokeShare(shareId)` | `revoke_friend_share` | boolean | |
| `adoptLoadout(shareId)` | `adopt_friend_loadout` | `AdoptedLoadout \| null` | caller runs `HangarService.loadAll()` |
| `adoptShipConfig(shareId)` | `adopt_friend_ship_config` | `AdoptedShipConfig \| null` | caller runs `HangarService.loadAll()` before opening |
| `crew(einsatzId)` | `get_einsatz_crew` | `EinsatzCrew \| null` | |
| `setSlots(einsatzId, labels)` | `set_einsatz_slots` | `EinsatzCrew \| null` | |
| `respond(einsatzId, answer, slotId = null)` | `respond_einsatz` | `EinsatzCrew \| null` | updates that row in `sharedEinsaetze` |

`SocialPresenceService`: `init()`, `touch()`. Ticks every 3 minutes while the tab is visible, on the real session.

Pure helpers in `social.types.ts`: `friendPath`, `inviteLinkFor`, `isValidInviteToken`, `isValidGroupName`, `effectiveVisibility`, `isEmptyOverride`, `compareRows`, `socialErrorKey`, constants `FRIEND_GROUP_KINDS`, `GROUP_NAME_MAX`, `GROUPS_MAX`, `GROUP_MEMBERS_MAX`, `VISIBILITY_FACETS`, `RSVP_ANSWERS`, `SLOTS_MAX`, `SLOT_LABEL_MAX`, `COMPARE_METRICS`. `compareRows` sets `standing: 'behind'`, which renders in `--sc-warning`, never `--sc-danger`.

## What wave 2 must wire

Nothing runs until this is done:

- **App start:** add `inject(SocialPresenceService).init()` next to `this.presence.init()` in `src/app/app.component.ts:187`. Without it nobody is ever online and `active_days_30` stays 0.
- **Counter (C11):** `FriendsService.load()` at app start for a signed-in user, `incomingCount()` on the account menu.

| Bundle | Calls |
|---|---|
| `/social` page (C01, C07, C08, C18) | `FriendsService.*`, `loadGroups`, group CRUD, `loadOnline`, `loadCompare` + `compareRows` |
| Invite box + `/invite/<token>` route, public (C20) | `loadInvite`, `createInvite`, `revokeInvite`, `inviteLinkFor`, `peekInvite`, `redeemInvite`, then `friendPath` |
| Visibility popup (C21) | `loadVisibility`, `setVisibility`, `setFriendVisibility`, `effectiveVisibility` |
| `/social/<name>` (C19) | `friendOverview`; `missing` = not-found state, `error` = retry state; `friendPath` on every friend name |
| HQ Einsatz, owner (C03, C05) | `shareEinsatz`, `listShares('einsatz', id)`, `revokeShare`, `crew`, `setSlots`, `respond` |
| HQ, friend's view (C03, C05, C10) | `loadSharedEinsaetze`, `respond` |
| Share panel, ship variant (C04, C12) | `shareShipConfig`, `listShares('ship_config', id)`, `revokeShare`, `loadSharedShipConfigs`, `adoptShipConfig` + `HangarService.loadAll()` + `holoConfigLink` |
| Share panel, set + HQ Bestand (C02, C13, C14) | `LoadoutShareService.listSharedWithMe`, `adoptLoadout`, `shareLoadoutWithGroup` |
| Privacy page (C22) | Must name: hangar, flagship, online status and comparison numbers are visible to friends by default, with the switches; `user_presence` stores last visit and a 30-day activity mask. |

`hangar_role_loadouts` gains `source_loadout_id` and `source_owner_id`; `select('*')` readers get them without a change. `source_owner_id` has no name attached, so a "from <friend>" label has to resolve it through `FriendsService.graph()`.

## Storage

All rows are small and bounded: one presence row per account, at most one live invite per owner plus dead rows for 30 days, 50 groups × 100 members, 12 slots per Einsatz. An adopted set or ship variant is a normal row of a table that already exists. At the current 10 accounts this is well under 1 MB.
