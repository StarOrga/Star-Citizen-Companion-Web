# Wave 1 — red-team gate (7a29bfe..1da2b0d) — GATE FAIL, fixed in wave 1.5

Reviewed by `devops:redteam` on the merged Wave-1 diff. User decisions taken
2026-09-20 after the gate (see bottom). Items marked **core-fix** are handled
by the wave-1.5 fix agents before Wave 2; **wave2-frontend** items go into the
Wave-2 prompts.

## Blockers

1. **`silhouette_export.py:120-169` + `silhouette.py:64-66` — wrong projection axis.**
   cgf-converter emits glTF = Y-up (`src/app/codex/glb-hardpoints.ts:16`);
   `project_topdown` drops glTF-Z = −Cry-Y (nose axis) → front cross-section,
   not top-down; anchors (Cry-XY) live in a different projection than the
   contour. → core-fix: convert (x,y,z)→(x,−z,y) in `world_triangles_from_glb`,
   Y-up glb fixture test.
2. **`silhouette.py:483-493` vs `holo-silhouette.ts:31-34` / migration / §C1 — anchor space ≠ viewBox.**
   `project_anchors` emits % of the `hardpointFrame` AABB; contract says % of
   viewBox and the path is centred with an offset (`silhouette.py:421-427`).
   Frame comes from the `.cga` AABB, contour bounds from glb triangles — two
   boxes. → core-fix: push anchors through the same min/scale/offset as the
   path (silhouette bounds), keep `clamped`. Never fix client-side.
3. **`20260920160000_hangar_loadout_sharing.sql:193-226` — `hangar_follow_snapshot` trusts client-writable columns.**
   `source_config_id`/`follows_owner` are plain columns under self-only RLS →
   any user can point their own row at any config id and read its
   name/role/loadout; fork is reversible. → core-fix: BEFORE UPDATE trigger
   (follows_owner false→true forbidden; source_config_id/owner_user_id
   immutable after insert; auto-fork on name/role/loadout edit while
   following → follows_owner=false + forked_at).
4. **Owner display name unreachable — hv-s4 „verwaltet von <user>“ not renderable.**
   `profiles` is self-read + admin. → core-fix: `adopt_shared_loadout` /
   `hangar_follow_snapshot` return `owner_name`/`owner_handle` (+
   `owner_updated_at`) via SECURITY DEFINER join, same technique as
   `20260904020000_social_moderation_sharing.sql:933-952`.

## Should-fix

- Moderation invariant bypassed: new RPCs use raw `auth.uid()`; use
  `social_actor()` / `is_suspended()` like every other share path. → core-fix
- Revoke = DELETE (`:123-125`, `hangar.service.ts:714-721`) vs repo convention
  `revoked_at`. → core-fix per user decision (below).
- `hangar.service.ts:760-765` refresh overwrites a fork edit (no
  `.eq('follows_owner', true)`); `updateConfig`/`activateConfig`/Codex save
  bar write into a following config without forking. → core-fix (trigger
  auto-fork, refresh guarded) + wave2-frontend (hv-s4 owner question before
  the first edit of a followed config).
- Kind mismatch: uploader emits `kind='armor'` for entities that land in
  `codex_items` (web kind `item`); no batch read for the tile view. →
  core-fix: emit `item` for armor entities (web kind wins; `armor` stays in the
  enum unused), add `silhouettes(kind, classNames[])` with `.in()`.
- `silhouette.py:411/416` + `holo-silhouette.ts:67` — capital ships exceed the
  200k path cap: `tol_px` computed, never used; DP tolerance 0.15 m absolute.
  → core-fix: tolerance = max(0.15 m, 0.3 % span, 1.5 px), point-count log,
  400 m noisy-rectangle test.
- `silhouette.py:266-274, :160` — only largest blob kept + open() erosion
  drops nacelles/arms on thin struts. → core-fix: keep all components ≥ N px
  as subpaths, log dropped area.
- `silhouette.py:284-296` vs `:374-381` — hole winding never reversed. →
  core-fix: reverse hole rings (contract: nonzero fill works) AND
  wave2-frontend sets `fill-rule="evenodd"` as belt-and-braces.
- `silhouette_export.py:257` — cache key hashes `.cga` only, not `.cgam`, nor
  tuning constants. → core-fix.
- Runtime unproven: `_flood_label` is pure-Python over 1024² cells, twice per
  entity, × thousands of entities + a cgf-converter subprocess each. →
  core-fix: vectorise labelling (numpy-only, no scipy in requirements), log
  per-entity timing.
- `codex.service.ts:755-770` `buildsForChannel` lists never-finalised builds.
  → wave2-frontend filter/mark by `entity_counts`/`schema_version`.
- `codex.service.ts:795-796` memoises `null` on transport error. → core-fix.
- `adopt_shared_loadout`: no unique (user_id, source_config_id) → duplicate
  copies per click; self-adopt allowed; patch context lost. → core-fix: unique
  + self-adopt refused + return channel/patch_version from adopt (and store on
  the link row read path).
- Anonymous recipients: adopt requires auth, no anon read path. → core-fix
  per user decision (below); wave2-frontend keeps today's `?loadout=` share
  (inventory #14) in the Holotable.

## Notes

- `catalog-map.ts:498` passes `bbox: null` into a `not null` column → skip
  rows without bbox. (core-fix)
- `holo-silhouette.ts:154` maps unknown `kind` to `'ship'` → return null. (core-fix)
- `silhouette_build.py:28-30` vs `dataforge_extract.py:202-204`: two different
  `_safe_filename` → anchors + unresolved silently empty on special names.
  Import the one helper. (core-fix)
- `silhouette.py:472-473`: missing frame → `([], [])`; Wave 2 derives pins
  from `detail.ports`, not from `anchors ∪ unresolved`. (wave2-frontend)
- `loadoutVariantHint` uses `config.updatedAt`, which every pull bumps → use
  `owner_updated_at` from the RPC. (core-fix returns it; wave2 uses it)
- `silhouette()` is current-build-only; Δ-view ports that exist only in the
  old build get the unresolved ring. (wave2-frontend)
- Dimension D (`getDetail` → `fetchDetailForBuild` refactor): identical, no
  key collision, no silent fallback to current build. Clean.
- Contract B otherwise consistent 1:1 (`mapSilhouettes` ↔ `SILHOUETTE_COLUMNS`
  ↔ `parseHoloSilhouette`).

## "Nothing lost" (E)

All 59 inventory rows are reachable through existing components/services.
Only NEW concept functions were unreachable after Wave 1 — all covered by the
core-fix list above (owner name, patch context, armor kind + batch, anon peek,
revoke semantics). Accepted losses stay: Vergleichen (#12/#53), Schiff
wechseln (#15), Holotable view only.

## User decisions (2026-09-20)

1. **Revoke** = stop new adoptions only; existing followers keep following
   until the owner deletes the config. Implement as `revoked_at` (no DELETE),
   `adopt_shared_loadout` refuses revoked/expired links, `hangar_follow_snapshot`
   does NOT check the link.
2. **Adopted ship status** = `owned` (as Wave 1 built it) — keep.
3. **Anonymous recipients** = view without login, adopt with login: add
   `peek_shared_loadout(p_token)` (SECURITY DEFINER, anon-callable, read-only,
   returns ship class, loadout, name, role, channel, patch_version,
   owner_name; refuses revoked/expired; moderation-aware).
