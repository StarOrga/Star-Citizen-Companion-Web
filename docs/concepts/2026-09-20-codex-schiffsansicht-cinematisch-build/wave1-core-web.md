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
