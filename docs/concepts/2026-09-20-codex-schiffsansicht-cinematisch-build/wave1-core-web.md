# Wave 1 — core-web handoff

Branch: `claude/codex-schiffsansicht-design-d0ab3a-core-web` (off `claude/codex-schiffsansicht-design-d0ab3a`).

## Migrations

1. `supabase/migrations/20260920150000_codex_silhouettes.sql` — new table
   `codex_silhouettes(build_id, channel, patch_version, build_number, kind,
   class_name, view_box, path, bbox, anchors, unresolved, meta, generated_at)`,
   natural key `(channel, patch_version, build_number, kind, class_name)`,
   `kind in ('ship','weapon','component','item','armor')`. RLS mirrors
   `codex_*`: viewer + anon SELECT, service-role-only writes. Index
   `(build_id, kind, class_name)` for the current-build lookup. Additive.
2. `supabase/migrations/20260920160000_hangar_loadout_sharing.sql` — additive
   columns on `hangar_ship_configs` (`source_config_id`, `follows_owner`,
   `owner_user_id`, `forked_at`); new table `hangar_share_links` (owner-only
   RLS, no public/anon read); two `SECURITY DEFINER` RPCs:
   `adopt_shared_loadout(p_token text) returns uuid` and
   `hangar_follow_snapshot(p_config_id uuid) returns jsonb`. Token generator
   `public.new_hangar_share_token()` (two v4 UUIDs, same technique as the
   existing `new_share_token()`, but its own function — see comment in the
   migration for why it can't reuse that one).

Neither migration has been applied (`db:push` was explicitly out of scope —
the ship pipeline applies them).

## Edge function (`supabase/functions/ingest-catalog/index.ts`)

Two new ops, same shape/discipline as `ports`/`clear_ports`:

- `{ op: "silhouettes", build_id, rows: [...] }` → `{ ok, upserted }`. Rows are
  sanitized through a pinned `SILHOUETTE_COLUMNS` set (mirrors `PORT_COLUMNS`)
  and upserted on `channel,patch_version,build_number,kind,class_name`.
  Forward-compat degrade: if `codex_silhouettes` does not exist yet (project
  hasn't applied migration 1), returns `{ ok: true, upserted: 0, degraded:
  'no_silhouettes_table' }` instead of failing the whole catalog run.
- `{ op: "clear_silhouettes", build_id }` → `{ ok }`, same degrade behaviour.

Row shape the uploader sends (matches wave0-research §C1 exactly, DB-column
names): `{ kind, class_name, channel, patch_version, build_number, view_box,
path, bbox, anchors, unresolved, meta, generated_at }`. `bbox`/`anchors`/
`unresolved`/`meta` are JSON, not stringified.

## Pure modules

- `src/app/codex/holo-silhouette.ts`
  - `parseHoloSilhouette(row) => HoloSilhouette | null` — validates a
    `codex_silhouettes` row (finite bbox numbers, non-empty path under a
    200k-char cap, non-empty viewBox/class_name, anchors clamped to
    finite+0..100% or dropped). Returns `null` for anything invalid; caller
    renders the same §C3 neutral placeholder as a missing row.
  - `SilhouetteKind = 'ship' | 'weapon' | 'component' | 'item' | 'armor'`,
    `isSilhouetteKind()`.
  - Spec: `holo-silhouette.spec.ts` (16 cases).
- `src/app/codex/codex-build-compare.ts`
  - `compareKpiSheets(from, to, keys?) => KpiCellDelta[]` — reuses
    `computeKpiDelta` from `codex-loadout-stats.ts` (same "±0 renders
    nothing" rule as the existing KPI band); never re-implements the math.
  - `buildPerspectiveDeltas(cells) => PerspectiveDelta[]` — groups into the
    four `strip_final` tiles: `offensive` (alpha/burstDps/sustainedDps/
    missiles), `defensive` (shieldHp/shieldRegen/hullHp/effectiveHp/armorHp),
    `movement` (scm/maxSpeed/boost/agility/quantumSpeed/quantumRange/spool/
    mass/cargo), `signature` (ir/emIdle/emMax/crossSection).
  - `comparePortOccupants(from, to) => PortOccupantDelta[]` — port→className
    map diff, sorted by port name, includes ports that only exist on one side.
  - `compareShipBuilds({build,kpiSheet,occupants}, {...}) => ShipBuildCompareResult`
    — the one call the frontend needs for the patch-Δ view.
  - Spec: `codex-build-compare.spec.ts` (10 cases).

## `CodexService` additions (`src/app/codex/codex.service.ts`)

- `silhouette(kind: SilhouetteKind, className: string): Promise<HoloSilhouette | null>`
  (line ~779) — current-build only, memoized per `${buildId}:${kind}:${className}`.
- `shipDetailForBuild(className: string, buildId: string): Promise<CodexDetail | null>`
  (line ~700) — same shape as the existing `getDetail`, but for an ARBITRARY
  build id. `getDetail` was refactored to share a new private
  `fetchDetailForBuild(kind, classNameSlug, buildId)` — behaviour unchanged,
  confirmed by the full hangar+codex spec run (1190/1190 green).
- `buildsForChannel(channel = 'LIVE', limit = 30): Promise<CodexBuild[]>`
  (line ~763) — patch-selector list, newest first (same query shape as the
  existing `recentLiveBuilds`, just parametrized + a bigger default limit).

**Frontend recipe for the patch-Δ view:** call `buildsForChannel()` to
populate the selector → on pick, call `shipDetailForBuild(className, buildId)`
for both the previously-active and the newly-picked build → build a
`KpiShipInput`/`SummaryOccupant[]` from each `CodexDetail.payload` the exact
same way `codex-detail.component.ts` already does today (this wave does not
touch that resolution logic — it is loadout-draft-aware and lives entirely in
the frontend component) → `computeKpiSheet()` (existing, `codex-loadout-stats.ts`)
on each side → `compareShipBuilds()` for the Δ.

## `HangarService` additions (`src/app/hangar/hangar.service.ts`)

All in a new "loadout sharing" section at the end of the class:

- `createShareLink(config, shipClassName, channel, patchVersion, expiresAt?)`
  → `Promise<HangarShareLink | null>` — snapshots `config.loadout/name/role`
  into `hangar_share_links`, `source_config_id = config.id`.
- `revokeShareLink(id)` → `Promise<boolean>`.
- `adoptSharedLoadout(token)` → `Promise<HangarShipConfig | null>` — calls the
  `adopt_shared_loadout` RPC, reads back the new row.
- `refreshFollowedLoadout(configId)` → `Promise<HangarShipConfig | null>` —
  calls `hangar_follow_snapshot`, writes the fresh loadout/name/role into the
  follower's own row (self-only RLS UPDATE, not a fan-out from the owner).
  Frontend should call this when displaying a `followsOwner: true` config —
  there is no server-side push, this is pull-on-view.
- `forkFollowedLoadout(id, patch)` → `Promise<HangarShipConfig | null>` — the
  recipient's first real edit: flips `follows_owner` false + stamps
  `forked_at`, in the SAME write as the edit itself. **Frontend must call this
  instead of the existing `updateConfig()` the first time a `followsOwner:
  true` config is edited** — `updateConfig()` still works for everything else
  (own configs, already-forked configs) unchanged.

`hangar.types.ts`: `HangarShipConfig` gained `sourceConfigId`, `followsOwner`,
`ownerUserId`, `forkedAt`. New `HangarShareLink` + `mapHangarShareLink`. New
`LoadoutVariantHint`/`loadoutVariantHint(config)` — returns `{kind: 'savedAt'
| 'managedByOwner', updatedAt, ownerUserId}` for the hv-s4 display rule
("gespeichert heute/gestern/Datum" vs. "verwaltet von <owner>"); the frontend
resolves `ownerUserId` to a display name via whatever profile-lookup it
already uses elsewhere, and formats `updatedAt` itself.

## Deliberately NOT done (frontend / Wave 2 scope)

- No component/template/style changes anywhere (Wave-1 rule).
- No i18n keys added (services return raw facts or, where the concept implies
  user-facing text, nothing — see `LoadoutVariantHint`, which carries a
  `kind` discriminator, not text).
- Owner display-name resolution for `managedByOwner` — frontend's existing
  profile-lookup, not built here.
- Automatic/periodic sync of a followed config (`refreshFollowedLoadout` is
  pull-on-demand, no realtime/webhook push from the owner's edits).
- The KPI-sheet / occupant resolution a `shipDetailForBuild` result feeds into
  `computeKpiSheet`/`comparePortOccupants` — that resolution (loadout-draft
  merge, default-loadout fallback) is existing frontend logic in
  `codex-detail.component.ts`; this wave supplies the build-scoped fetch and
  the diff math only, per the "reuse, never reimplement" instruction.
- `data-uploader/` untouched (owned by core-uploader).

## Questions for the user

None — every ambiguous point (share model shape, no "source" column, token
generation technique, forward-compat degrade for `silhouettes`) was resolved
by re-reading the concept decisions/wave0-research rather than guessed; see
the migration comments for the reasoning trail on each.

## Wave 1.5 web — red-team fix (core-fix-web)

Branch: `claude/codex-schiffsansicht-design-d0ab3a-fix-web` (off
`claude/codex-schiffsansicht-design-d0ab3a` @ `a3c3c3d`). Edited the two
Wave-1 migrations **in place** (neither had been applied — `db:push` still
out of scope). Pushed SHA: `6938d37`.

- **A (blocker 3, trigger + mechanism)** —
  `supabase/migrations/20260920160000_hangar_loadout_sharing.sql:186-268`
  (`hangar_ship_configs_share_guard()` + trigger). **Chosen mechanism: a
  transaction-local GUC**, `hangar.internal_write`, set via
  `set_config('hangar.internal_write', 'on', true)` immediately around the
  one statement each trusted SECURITY DEFINER path is trusted for
  (`adopt_shared_loadout`'s insert at `:406-421`, `hangar_follow_snapshot`'s
  own follower-row update at `:459-462`), reset straight after. A plain
  client INSERT/UPDATE via PostgREST never sets it, so `current_setting`
  reads back `'off'`. Rejected the "move the write fully into the RPC"
  alternative: the fork-on-edit half of the rule (auto-fork on
  name/role/loadout while following) must fire for ANY client write path —
  `updateConfig()`, `activateConfig()`, the future Codex save bar — not just
  one dedicated write, so the trigger has to see every UPDATE regardless of
  which service method issued it; a GUC lets one trigger cover all of them
  while still trusting exactly two call sites for the immutable columns.
  INSERT: `owner_user_id`/`source_config_id`/`follows_owner=true`/
  `shared_channel`/`shared_patch_version` raise `42501` on a client insert
  instead of being silently nulled (`:207-217`). UPDATE: the four sharing
  columns are immutable (`42501` on change), `follows_owner` may go
  true→false but never false→true (`42501`), and editing
  name/role/loadout on a still-following row auto-forks it
  (`follows_owner:=false`, `forked_at:=now()`) in the same statement
  (`:227-235`). `hangar_follow_snapshot` (`:432-472`) no longer checks the
  share link at all (user decision 1) — the now-immutable
  `source_config_id`/`owner_user_id` are the only provenance checked.

- **B (blocker 4, owner name + patch context)** — `adopt_shared_loadout`
  (`:375-436`) and `hangar_follow_snapshot` (`:432-472`) both `return jsonb`
  (changed from `returns uuid`; `drop function` + recreate at `:375-376`
  since Postgres cannot change a function's return type in place). Both
  resolve `profiles.display_name`/`username` (coalesced) the same way
  `list_loadout_shares`/`get_shared_loadout` do (20260904020000). Exact
  shapes:
  - `adopt_shared_loadout(p_token text) returns jsonb` →
    `{configId, ownerName, ownerUserId, ownerUpdatedAt, channel, patchVersion}`.
  - `hangar_follow_snapshot(p_config_id uuid) returns jsonb` →
    `{loadout, name, role, ownerName, ownerUserId, ownerUpdatedAt, channel, patchVersion}`
    or SQL `null`.
  `channel`/`patchVersion` come from two new immutable columns,
  `hangar_ship_configs.shared_channel`/`.shared_patch_version`
  (`:100-102`), copied from the link at adopt time — `hangar_follow_snapshot`
  has no share-link argument, so this context has to live on the row itself
  once the link may be revoked or re-issued. `src/app/hangar/hangar.types.ts`:
  `HangarShipConfig` gains `ownerName`, `ownerUpdatedAt`, `sharedChannel`,
  `sharedPatchVersion` (all `string | null`, lines ~104-118); `mapHangarShipConfig`
  defaults `ownerName`/`ownerUpdatedAt` to `null` (only the RPCs populate them)
  and reads `sharedChannel`/`sharedPatchVersion` off the real columns
  (~193-198). `hangar.service.ts` `adoptSharedLoadout`/`refreshFollowedLoadout`
  merge the RPC's fields onto the freshly-read row. `loadoutVariantHint`
  (`hangar.types.ts:147-160`) now reads `config.ownerUpdatedAt ?? config.updatedAt`
  for the `managedByOwner` case instead of the follower row's own
  `updatedAt` (every pull bumps that).

- **C (moderation)** — `adopt_shared_loadout`/`hangar_follow_snapshot` call
  `public.social_actor()` instead of raw `auth.uid()` (raises on
  unauthenticated/suspended/unapproved); `adopt_shared_loadout` additionally
  refuses an owner (`v_link.created_by`) who `is_suspended()`
  (`:397-399`); `hangar_follow_snapshot` treats a suspended owner like a
  deleted config — returns `null`, same soft "keep the last-known copy"
  contract (`:451-453`). `hangar_share_links` gains a RESTRICTIVE
  `hangar_share_links_approved_gate` policy (`:296-299`), same
  `is_approved()` (approved AND not-suspended, per the 20260904020000
  redefinition) gate every other self-scoped table carries.

- **D (revoke, user decision 1)** — `hangar_share_links.revoked_at`
  (`:264`), guarded by `hangar_share_links_revoke_guard` (`:302-327`, BEFORE
  UPDATE): rejects any change to a column other than `revoked_at`, rejects
  clearing it once set, rejects updating an already-revoked row. Replaced
  the (previously commented-as-deliberate) "no update policy" with
  `hangar_share_links_self_update` (`:257-258`), scoped down to
  revoke-only by the trigger. `HangarService.revokeShareLink`
  (`hangar.service.ts`, "loadout sharing" section) now `UPDATE ... SET
  revoked_at = now()` instead of `DELETE`. `adopt_shared_loadout` refuses a
  revoked (`v_link.revoked_at is not null`) or expired link (`:390-395`).

- **E (adopt hygiene)** — partial unique index
  `hangar_ship_configs_user_source_unique on (user_id, source_config_id)
  where source_config_id is not null` (`:108-110`); `adopt_shared_loadout`
  checks for an existing follow of the same `source_config_id` first and
  returns it instead of duplicating (`:399-405`), backstopped by
  `on conflict (user_id, source_config_id) where source_config_id is not
  null do nothing` on the insert itself for the concurrent-adopt race
  (`:421-429`, same idiom as `create_loadout_link`'s
  check-then-insert-then-reselect). Self-adopt refused
  (`v_link.created_by = v_uid` → `22023`, `:392-394`). Adopted ship status
  stays `'owned'` (unchanged, user decision 2).

- **F (user decision 3, anon peek)** — `peek_shared_loadout(p_token text)
  returns table (ship_class_name, loadout, name, role, channel,
  patch_version, owner_name)` (`:500-524`), `language sql security definer`,
  `grant ... to anon, authenticated`. Same revoked/expired/
  `is_suspended(owner)`/`profiles.is_approved` guards as
  `get_shared_loadout` (20260904020000). `HangarService.peekSharedLoadout(token)`
  → `Promise<PeekedSharedLoadout | null>` (new type + `mapPeekedSharedLoadout`,
  `hangar.types.ts`).

- **G (refresh guard)** — `HangarService.refreshFollowedLoadout` now reads
  with `.eq('id', configId).eq('follows_owner', true)` after calling the RPC
  (belt-and-braces against a concurrent fork). The actual sync-write moved
  INTO `hangar_follow_snapshot` itself (see A) rather than staying a
  separate client `.update()` call — a session GUC set inside one RPC
  invocation cannot reliably survive into a second, independent PostgREST
  request (pgbouncer transaction pooling may hand the next request a
  different backend), so "the trigger must not auto-fork this refresh" can
  only hold if the guarded write and the GUC happen in the same
  transaction. This is the one point where the fix deliberately diverges
  from the literal two-step description in the redteam item while keeping
  its invariant (documented as a discretion call, not a guess — flagged
  here rather than left silent).

- **H (silhouette null-memo + batch + kind)** — `codex.service.ts`
  `silhouette()`: `if (error) return null;` before memoizing, so only a
  genuine empty/invalid result is cached, not a transport error (fix at the
  top of the method, ~line 795 pre-fix). New
  `silhouettes(kind: SilhouetteKind, classNames: string[]): Promise<Map<string,
  HoloSilhouette>>` — dedupes input, skips already-cached class names,
  `.in('class_name', chunk)` at `CHUNK = 200`, memoizes per entry
  (including negative/invalid results, skipping a chunk entirely on
  transport error so it stays retryable). `holo-silhouette.ts`
  `parseHoloSilhouette`: an unknown `kind` now returns `null` instead of
  falling back to `'ship'`; updated the one pinning assertion in
  `holo-silhouette.spec.ts` ("rejects a row with an unknown kind value
  instead of guessing 'ship'").

- **I (migration hygiene)** — both migrations stay additive; every new
  object (trigger, functions, columns, index, policies) documented in the
  `20260920160000_hangar_loadout_sharing.sql` header and inline comments;
  `create policy`/`create table`/`create trigger` stay non-idempotent
  (`drop ... if exists` only ahead of the two `create trigger` statements
  and the return-type-changing `adopt_shared_loadout`, matching how the
  rest of the schema re-runs a migration file).

### Not built (kind/armor emit, python/uploader items)

Items outside `supabase/` and `src/` in the redteam list — the projection-
axis fix (`silhouette_export.py`), anchor-space-vs-viewBox fix, capital-ship
path-cap tolerance, blob/hole-winding fixes, cache-key fix, `_flood_label`
performance, the two divergent `_safe_filename` helpers, and the uploader
emitting `kind='armor'` for entities that should be `item` — all live under
`data-uploader/`, owned by the sibling core-fix-uploader agent. Not touched
here.

### SQL reasoning trail (could not execute — db:push out of scope)

Reasoned through both migration files statement-by-statement:
`hangar_ship_configs_share_guard` correctly falls through to `return new;`
for every ordinary (non-sharing) insert/update since all six sharing
columns default to their old values when unspecified in a partial
`UPDATE ... SET` (columns not listed keep `OLD.<col>`, standard SQL UPDATE
semantics) — verified this is what lets `updateConfig()` keep working
unchanged for non-shared configs and still trip the auto-fork branch for a
followed one. The `on conflict (user_id, source_config_id) where
source_config_id is not null do nothing returning id into v_config_id`
clause matches the partial unique index's exact predicate, which Postgres
requires for `ON CONFLICT` inference against a partial index; a lost race
leaves `v_config_id` `NULL` (RETURNING INTO with zero affected rows), which
the follow-up re-select branch handles. `citext` (used for
`v_owner_handle`) is already an enabled extension (profiles.username is
`citext` since 20260706221138). Did not verify against a live database —
flagging this as reasoning, not a substitute for `db:push` + manual QA
before Wave 2 ships.

## Questions for the user (wave 1.5 addendum)

None outstanding for the items in scope (A-I) — the one genuine ambiguity
(G's literal "two-step client update" vs. the GUC's transaction-scoping
constraint) was resolved by keeping the concept's INVARIANT (no auto-fork on
a legitimate refresh) rather than the literal mechanism, and is called out
above rather than guessed silently.
