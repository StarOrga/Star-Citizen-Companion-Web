# Release-Channel Selection — Uploader & Website

**Date:** 2026-07-19
**Status:** Approved design → implementation planning
**Scope:** Two independent sub-projects sharing the alpha/beta/stable channel vocabulary.

---

## 1. Context — two separate release worlds

The repo already has an alpha→beta→stable **ring**, but it only tags the **web-app root
version** (git tags `alpha|beta|stable/vX.Y.Z`, promoted by re-tagging the same SHA via
`ship_promote`). These tags are metadata only — they trigger **no** website build; the site
always deploys from `main` via Vercel.

The **desktop uploader** is a completely separate, **channel-less** release model:

- Source of truth: one `public.desktop_releases` row with `is_current=true`
  (`supabase/migrations/00003_roles_releases_bundles.sql:121-150`). A trigger
  `dr_dedupe_current` enforces exactly **one** current release globally.
- Served by edge function `desktop-latest`
  (`supabase/functions/desktop-latest/index.ts`) as electron-updater YAML.
- Self-update client: `data-uploader/src/main/updater.ts` — electron-updater `generic`
  provider → `${API_BASE}/functions/v1/desktop-latest`, auth via `X-SC-Release-Token`
  header baked into the binary (`data-uploader/src/lib/release-token.ts`).
- Website download: `src/app/desktop/desktop-download.component.ts`, route `/uploader`,
  guarded by `roleGuard('admin','collaborator')` (`src/app/app.routes.ts:113-116`). Reads
  `desktop_releases` directly (RLS read = collaborator+). The page **also embeds the
  collaborator-only bundle history** (`sc-p4k-history`).
- Binaries live on the public GitHub mirror `StarOrga/Star-Citizen-Companion-Binaries`;
  `desktop_releases.platforms[*].url` points there. CI: `.github/workflows/data-uploader-build.yml`.

**Roles:** `profiles.role ∈ {admin, collaborator, viewer}` (default viewer). Helpers
`is_admin()`, `is_collaborator()`, `current_user_role()`
(`00003_roles_releases_bundles.sql:19-32`). The **Electron tool does not know the user's
role today** — it only holds a session/JWT.

**Naming collision (important):** in the codebase `channel` almost always means the **Star
Citizen game data channel** (LIVE / PTU / EPTU / TECH-PREVIEW) — e.g.
`data-uploader/src/preload/index.ts:104`. The release channel introduced here is therefore
consistently named **`releaseChannel` / `updateChannel`** to avoid confusion.

---

## 2. Goals / Non-goals

**Goals**
- Uploader: role-gated channel picker on **both** self-update and download.
  - admin: alpha/beta/stable, default **alpha**
  - collaborator: beta/stable, default **beta** (no alpha)
  - viewer: **stable only, no picker**
- Website: pre-release channels reachable via **subdomain prefix** (`alpha.` / `beta.` /
  none = stable), backed by branch deployments.

**Non-goals**
- No path-prefix (`/alpha`) channel — breaks service-worker scope and `base-href`.
- No per-channel divergent desktop binaries — same binary is promoted (pointer model).
- No change to the existing git-ring for the web-app **version** number.

---

## 3. Decisions locked in brainstorming

1. **Website channel = separate branch deployments** (real pre-release site versions), via
   subdomain prefix.
2. **Uploader access:** collaborator = beta+stable (default beta, no alpha); viewer =
   stable download, no picker (needs a new read path since `desktop_releases` is
   collaborator-gated today).
3. **Uploader binary model = promotion-pointer** (one build registered to alpha, promotion
   moves a per-channel pointer — same binary), mirroring the web ring.
4. Viewer download via a **new dedicated `/download` route** (do not open `/uploader` to
   viewers — it would leak the upload history).
5. Uploader **promotion via a small admin surface under `/admin`** (+ a scriptable RPC).
6. Website ships **on Vercel branch URLs first**; a custom domain for clean `alpha./beta.`
   prefixes is a later, purchase-gated step.

---

## 4. Sub-project A — Uploader channels

### A1. Data model — promotion-pointer

New pointer table; `desktop_releases` becomes an **immutable build catalog**.

```sql
-- New: one row per channel, points at the current release for that channel.
create table public.desktop_channels (
  channel     text primary key check (channel in ('alpha','beta','stable')),
  release_id  uuid not null references public.desktop_releases(id),
  updated_at  timestamptz not null default now()
);

-- Seed: current build → all three channels (stable ⊆ beta ⊆ alpha), so every
-- existing installation keeps updating seamlessly.
insert into public.desktop_channels (channel, release_id)
select c.channel, r.id
from (values ('alpha'),('beta'),('stable')) as c(channel),
     lateral (select id from public.desktop_releases
              where is_current order by created_at desc limit 1) r
on conflict (channel) do nothing;
```

Then **drop** the single-global-current machinery (Alpha-phase policy allows it; document in
the migration comment):
- drop trigger `desktop_releases_dedupe` + function `dr_dedupe_current`
- drop column `desktop_releases.is_current` (and its partial index)

`release_token` / `token_revoked` semantics stay unchanged.

### A2. Role → channel policy (single source of truth)

`SECURITY DEFINER STABLE` function that both the web app and the edge-function JWT path call:

```sql
create or replace function public.desktop_release_for_channel(p_channel text)
returns table (channel text, version text, platforms jsonb, notes text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  r  text := public.current_user_role();     -- 'viewer' when anon
  maxc text := case r when 'admin' then 'alpha'
                      when 'collaborator' then 'beta'
                      else 'stable' end;
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}';
  eff text;
begin
  -- clamp requested channel down to the caller's max tier (defense-in-depth)
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;
  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff;
end $$;
grant execute on function public.desktop_release_for_channel(text) to authenticated, anon;
```

| Role | Allowed channels | Default | Picker |
|------|------------------|---------|--------|
| admin | alpha, beta, stable | alpha | yes |
| collaborator | beta, stable | beta | yes |
| viewer | stable | stable | **no** |

### A3. Edge function `desktop-latest` — channel-aware

- Resolve requested channel from **path** (`…/desktop-latest/<channel>.yml` — how
  electron-updater natively requests when `autoUpdater.channel` is set) **or** query
  (`?channel=`). Default `stable`. `latest.yml` (old builds) → `stable`.
- **Token path** (pre-login, current builds): validate token (unchanged) → serve the
  requested channel's pointer. No server role-check here (binaries are public; the picker is
  UI-gated and only appears after login). Old builds keep hitting `latest.yml` → stable.
- **JWT path**: resolve via `desktop_release_for_channel` (role-clamped).
- Keep `--no-verify-jwt` deploy flag.

### A4. Tool (Electron)

- `SettingsStore` (`data-uploader/src/lib/settings-store.ts`): add
  `updateChannel: 'alpha'|'beta'|'stable'` (default `'stable'`; schema-compatible — `load()`
  fills defaults for missing fields).
- New IPC `auth.role()` → resolves the logged-in user's role via `current_user_role()` RPC
  (or `select role from profiles`) after OAuth login. Exposed through `preload/index.ts`
  alongside the existing `settings` / `update` bridges.
- Renderer: a **role-gated picker** (admin: 3 options; collaborator: beta+stable; viewer:
  hidden). Placement: the **update banner** and the **settings panel**. On change →
  persist via `settings.patch({ updateChannel })`, set `autoUpdater.channel`, re-check.
- `updater.ts`: read `updateChannel` at init and on change; set `autoUpdater.channel`
  accordingly. Portable manual check (`fetchLatestVersion`) appends `?channel=<c>`.

### A5. Website download surfaces

- **`/uploader`** (collaborator+): keeps the upload workflow + bundle history; **adds** the
  role-gated channel picker. Switch the direct `desktop_releases` query in
  `desktop-download.component.ts` to `desktop_release_for_channel(channel)`.
- **New `/download`** route (any authenticated role, viewer+): minimal surface, shows **only
  the caller's allowed channel** (viewer → stable, no picker), **no** bundle history.
  Reuses `desktop_release_for_channel`. Route guard: authenticated (not role-gated).

### A6. CI / publish + promotion

- `data-uploader-build.yml`: after building + registering the catalog row, move the **alpha**
  pointer to it (`update desktop_channels set release_id=… where channel='alpha'`) — the
  auto "ship to alpha" step, analogous to the web ring. Remove the `is_current` INSERT/flip.
- Promotion alpha→beta→stable: admin RPC
  `promote_desktop_channel(p_version text, p_to_channel text)` with a monotonicity guard
  (target version ≤ next-higher channel's version, preserving stable ≤ beta ≤ alpha).
  Surfaced via a small **admin control under `/admin`** (admin-only); also callable
  headless.

---

## 5. Sub-project B — Website channels (branch deployments + subdomains)

### B1. Branch model
`alpha` branch (bleeding edge) → promote → `beta` → promote → `main` (= stable). Each
branch is its own Vercel deployment. This is a real workflow change: day-to-day feature work
targets `alpha`, not `main`.

### B2. Subdomain prefix (NOT path prefix)
`alpha.<domain>`, `beta.<domain>`, `<domain>` = stable. Subdomains are **separate origins**,
so each channel has its own service-worker scope at `/` — **zero SW/base-href breakage and
no app code change**. A path prefix `/alpha` would break `ngsw-config.json`'s root-absolute
asset globs and the root-scoped SW (`app.config.ts:21-24`) — explicitly rejected.

### B3. Channel badge
Build-time field `channel`, derived from `VERCEL_GIT_COMMIT_REF` via a tiny prebuild step,
injected into the Angular build; renders a subtle `ALPHA`/`BETA` badge in the shell. The
dormant `environment.appPhase` field is left untouched (different meaning: product-maturity
phase, not release channel).

### B4. Automation boundary
- **Autonomous:** create `alpha`/`beta` branches, Vercel deployments/config, prebuild
  channel injection, badge.
- **Gated:** clean `alpha./beta.` prefixes need a **custom domain** (none exists yet). Domain
  purchase is a confirmation-gated action. Until then, functional but ugly Vercel branch
  URLs (`…-git-alpha-…vercel.app`) work immediately.

---

## 6. Error handling
- `desktop_release_for_channel`: unknown/empty channel or missing pointer → empty result;
  UI shows the existing "no release" state (`desktop.noRelease`).
- Edge function: unknown channel path → treat as stable (back-compat), never 500 on a bad
  channel token.
- Tool: an invalid persisted `updateChannel` (e.g. downgraded role) → clamp to stable on
  read; server clamps again.
- Promotion RPC: non-admin → raise `forbidden`; monotonicity violation → raise with a clear
  message; no demotion (roll forward only, like the ring).

## 7. Testing
- **DB:** RPC role-clamping (admin/collaborator/viewer/anon × alpha/beta/stable), promotion
  monotonicity guard, seed correctness.
- **Edge function:** channel resolution from path & query; token path per channel; JWT path
  clamping; `latest.yml` → stable back-compat.
- **Tool:** `SettingsStore` default + patch of `updateChannel`; picker visibility per role;
  `updater` sets `autoUpdater.channel`. Unit-testable via injected I/O (existing pattern).
- **Web:** `/download` viewer sees stable-only no picker; `/uploader` collaborator picker;
  admin alpha. Light browser snapshot.
- **Back-compat:** an already-installed build (channel `latest`) still updates on stable.

## 8. Rollout / migration order
1. Migration: `desktop_channels` + seed + `desktop_release_for_channel` + drop is_current
   machinery + `promote_desktop_channel`.
2. Edge function channel-awareness (deploy).
3. Web: `/uploader` picker + new `/download` route + admin promotion control + i18n keys
   (de/en).
4. Tool: settings field + `auth.role()` IPC + picker + updater wiring. Ships to **alpha**
   first; promote once verified.
5. CI workflow: alpha-pointer move; drop is_current writes.
6. (B) Branch deployments — separate, after A is verified; domain is a later gated step.

## 9. Open items / risks
- **Tool role fetch** must run only after login; pre-login self-update stays on the persisted
  channel (default stable). Low risk.
- **Old builds** rely on `latest.yml` → stable mapping — must be preserved exactly.
- **Branch workflow (B)** changes the mental model of "where do I commit"; confirm before
  flipping day-to-day work onto `alpha`.
- **Domain purchase (B)** is out of scope until explicitly approved.

## 10. Key file touchpoints
- `supabase/migrations/<new>_desktop_channels.sql` (new)
- `supabase/functions/desktop-latest/index.ts`
- `src/app/app.routes.ts`, `src/app/desktop/desktop-download.component.ts`,
  `src/app/desktop/<new download component>`, admin promotion control under `src/app/admin/`
- `public/i18n/{de,en}.json`
- `data-uploader/src/lib/settings-store.ts`, `data-uploader/src/preload/index.ts`,
  `data-uploader/src/main/updater.ts`, renderer picker
- `.github/workflows/data-uploader-build.yml`
- `angular.json` / prebuild script + shell badge (B)
