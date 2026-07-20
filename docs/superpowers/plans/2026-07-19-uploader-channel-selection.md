# Uploader Channel Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the desktop uploader (self-update + download) and its web download page a role-gated alpha/beta/stable release-channel selector, backed by a promotion-pointer model.

**Architecture:** `desktop_releases` becomes an immutable build catalog; a new `desktop_channels(channel → release_id)` pointer table decides which build each channel serves (promotion = move the pointer). A `SECURITY DEFINER` RPC `desktop_release_for_channel` resolves a channel to a release with server-side role-clamping (admin→alpha, collaborator→beta, viewer→stable). The `desktop-latest` edge function becomes channel-aware. The web app gets a role-gated picker on `/uploader` and a new viewer-accessible `/download` route. The Electron tool persists an `updateChannel` preference, learns the user's role via a new IPC, and drives electron-updater's channel accordingly.

**Tech Stack:** Postgres (Supabase migrations), Deno (edge function), Angular 21 (standalone components, signals, ngx-translate), Electron + electron-updater + electron-vite, GitHub Actions.

## Global Constraints

- **Channel set:** exactly `alpha`, `beta`, `stable`. Invariant `stable ⊆ beta ⊆ alpha` (a stable release is also valid on beta and alpha).
- **Role → max channel / default:** admin → alpha (default alpha); collaborator → beta (default beta, NO alpha); viewer → stable (default stable, NO picker).
- **Naming:** the release channel is named `releaseChannel` / `updateChannel` in code. NEVER reuse the identifier `channel` alone for it — `channel` already means the SC game data channel (LIVE/PTU/EPTU/TECH-PREVIEW) throughout the codebase.
- **i18n:** every user-facing string localized via ngx-translate (web: `public/i18n/{de,en}.json`; tool: `data-uploader/src/i18n/{de,en}.json`). Never hardcode DE/EN UI text.
- **Angular:** standalone components, signals, `providedIn: 'root'` services, `ChangeDetectionStrategy.OnPush`.
- **No secrets in repo/client bundle.** Third-party keys stay in edge-function secrets.
- **Alpha-phase data policy:** dropping legacy columns/tables is allowed (document drops in the migration comment). Never touch `auth.users` / `public.profiles` data.
- **Branch:** `feat/uploader-channel-selection` off `main`. Commit per task.
- **Supabase writes** (registering releases / applying migrations) may be unavailable headlessly this session — see Task notes; the executor applies via `npm run db:push` / dashboard when available.

---

## File Structure

**Create**
- `supabase/migrations/20260719_desktop_channels.sql` — pointer table, seed, drop is_current machinery, `desktop_release_for_channel` + `promote_desktop_channel` RPCs.
- `src/app/desktop/download.component.ts` — minimal viewer+ download surface (`/download`).
- `src/app/desktop/channel-picker.component.ts` — reusable role-gated channel `<select>`.
- `src/app/admin/desktop-releases/desktop-releases.component.ts` — admin promotion control.

**Modify**
- `supabase/functions/desktop-latest/index.ts` — channel-aware resolution.
- `src/app/core/database.types.ts` — add `desktop_channels` + RPC signatures; drop `is_current`.
- `src/app/desktop/desktop-download.component.ts` — call RPC + embed picker.
- `src/app/app.routes.ts` — add `/download` + `/admin/desktop-releases`.
- `public/i18n/de.json`, `public/i18n/en.json` — channel/download/admin keys.
- `data-uploader/src/lib/settings-store.ts` — `updateChannel` field.
- `data-uploader/src/preload/index.ts` — `session.role()`, channel in `update`/`settings`.
- `data-uploader/src/main/index.ts` — `sc:session:role` handler; feed `updateChannel` to the updater.
- `data-uploader/src/main/updater.ts` — channel-parameterised feed.
- `data-uploader/src/renderer/main.ts` + `styles.css` — role-gated picker in the update banner + settings panel.
- `data-uploader/src/i18n/de.json`, `data-uploader/src/i18n/en.json` — picker strings.
- `.github/workflows/data-uploader-build.yml` — register build into catalog + move alpha pointer (drop `is_current`).

---

## Phase 1 — Database

### Task 1: Migration — pointer table, seed, RPCs

**Files:**
- Create: `supabase/migrations/20260719_desktop_channels.sql`

**Interfaces:**
- Produces (consumed by edge function + web):
  - `public.desktop_channels(channel text pk, release_id uuid, updated_at timestamptz)`
  - `public.desktop_release_for_channel(p_channel text) → table(channel text, version text, platforms jsonb, notes text, created_at timestamptz)`
  - `public.promote_desktop_channel(p_version text, p_to_channel text) → void`

- [ ] **Step 1: Write the migration**

```sql
-- 20260719_desktop_channels.sql
-- Release-channel selection for the desktop uploader (alpha/beta/stable).
-- Promotion-pointer model: desktop_releases becomes an immutable build catalog;
-- desktop_channels decides which build each channel currently serves.
-- Alpha-phase policy: drops desktop_releases.is_current + its dedupe trigger
-- (superseded by the per-channel pointer). No auth.users / profiles data touched.

-- 1. Pointer table -------------------------------------------------------------
create table if not exists public.desktop_channels (
  channel     text primary key check (channel in ('alpha','beta','stable')),
  release_id  uuid not null references public.desktop_releases(id) on delete restrict,
  updated_at  timestamptz not null default now()
);

alter table public.desktop_channels enable row level security;

-- Reads go exclusively through the SECURITY DEFINER RPC below, so no broad
-- SELECT policy. Admin may inspect/repair directly.
drop policy if exists "desktop_channels_admin_all" on public.desktop_channels;
create policy "desktop_channels_admin_all" on public.desktop_channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Seed: current build → all three channels (stable ⊆ beta ⊆ alpha) ----------
insert into public.desktop_channels (channel, release_id)
select c.channel, r.id
from (values ('alpha'),('beta'),('stable')) as c(channel)
cross join lateral (
  select id from public.desktop_releases
  where is_current order by created_at desc limit 1
) r
on conflict (channel) do nothing;

-- 3. Retire the single-global-current machinery --------------------------------
drop trigger if exists desktop_releases_dedupe on public.desktop_releases;
drop function if exists public.dr_dedupe_current();
drop index if exists public.desktop_releases_current_idx;
alter table public.desktop_releases drop column if exists is_current;

-- 4. Role-clamped resolver -----------------------------------------------------
create or replace function public.desktop_release_for_channel(p_channel text)
returns table (channel text, version text, platforms jsonb, notes text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  r    text := public.current_user_role();               -- 'viewer' when anon
  maxc text := case r when 'admin' then 'alpha'
                      when 'collaborator' then 'beta'
                      else 'stable' end;
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  eff  text;
begin
  if p_channel is null or not (rank ? p_channel) then
    p_channel := 'stable';
  end if;
  -- clamp requested channel down to the caller's max tier
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;
  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff;
end $$;

grant execute on function public.desktop_release_for_channel(text) to authenticated, anon;

-- 5. Admin promotion (roll-forward only, monotonic) ----------------------------
create or replace function public.promote_desktop_channel(p_version text, p_to_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  v_release_id uuid;
  v_new_created timestamptz;
  higher text;
  v_higher_created timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  if not (rank ? p_to_channel) then
    raise exception 'invalid channel: %', p_to_channel;
  end if;
  select id, created_at into v_release_id, v_new_created
    from public.desktop_releases where version = p_version;
  if v_release_id is null then
    raise exception 'unknown release version: %', p_version;
  end if;
  -- Monotonicity: a release may only enter stable if it is already the beta
  -- pointer's release-or-newer, and beta only if alpha's-or-newer.
  higher := case p_to_channel when 'stable' then 'beta' when 'beta' then 'alpha' else null end;
  if higher is not null then
    select dr.created_at into v_higher_created
      from public.desktop_channels dc join public.desktop_releases dr on dr.id = dc.release_id
      where dc.channel = higher;
    if v_higher_created is null or v_new_created > v_higher_created then
      raise exception 'monotonicity: % must reach % before %', p_version, higher, p_to_channel;
    end if;
  end if;
  insert into public.desktop_channels (channel, release_id, updated_at)
  values (p_to_channel, v_release_id, now())
  on conflict (channel) do update set release_id = excluded.release_id, updated_at = now();
end $$;

grant execute on function public.promote_desktop_channel(text, text) to authenticated;
```

- [ ] **Step 2: Apply against a local stack and verify**

Run (requires local Supabase stack — `npm run db:reset`):
```bash
npm run db:reset
```
Then verify seed + clamp with SQL (psql or Supabase SQL editor):
```sql
-- expect three rows, all pointing at the same (only) release
select channel, release_id from public.desktop_channels order by channel;
-- expect the stable release for an anon/viewer caller
select * from public.desktop_release_for_channel('alpha');   -- clamps to stable for non-admin
```
Expected: `desktop_channels` has 3 rows; `desktop_release_for_channel('alpha')` returns the stable pointer's release when called without an admin JWT.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719_desktop_channels.sql
git commit -m "feat(db): desktop release-channel pointer table + resolver/promote RPCs"
```

**Note (Supabase auth):** if no local stack and MCP is unauthenticated, defer `db:reset`; still commit the migration. The executor applies via `npm run db:push` when Supabase write access is available.

---

## Phase 2 — Edge function

### Task 2: `desktop-latest` channel-aware

**Files:**
- Modify: `supabase/functions/desktop-latest/index.ts`

**Interfaces:**
- Consumes: `desktop_channels`, `desktop_release_for_channel` (Task 1).
- Produces: same YAML/JSON shape as today, now per requested channel. Channel resolved from URL path `…/desktop-latest/<channel>.yml` (electron-updater native) OR `?channel=<c>`; default `stable`; `latest.yml`/`latest` → `stable`.

- [ ] **Step 1: Add a channel parser**

Insert near the top of the module (after the `CORS` const):
```ts
const CHANNELS = new Set(['alpha', 'beta', 'stable']);

/** Resolve the requested release channel from path suffix or ?channel=. */
function resolveChannel(req: Request): string {
  const url = new URL(req.url);
  const q = url.searchParams.get('channel');
  if (q && CHANNELS.has(q)) return q;
  // electron-updater requests `<feed>/<channel>.yml`; `latest.yml` = legacy stable.
  const last = url.pathname.split('/').pop() ?? '';
  const stem = last.replace(/\.ya?ml$/i, '');
  return CHANNELS.has(stem) ? stem : 'stable';
}
```

- [ ] **Step 2: Route the token path through the channel**

Replace the token-path `respondWithLatest(adminClient, req)` call so it serves the requested channel from `desktop_channels` (service client, no role clamp — binaries are public, UI-gated):
```ts
    if (!tokenRow) return jsonResp({ error: 'invalid_or_revoked_release_token' }, 401);
    return await respondForChannel(adminClient, req, resolveChannel(req), /* clamp */ false);
```

- [ ] **Step 3: Route the JWT path through the role-clamped RPC**

Replace the JWT-path `respondWithLatest(userClient, req)` tail:
```ts
  // profile role already fetched above; still call the RPC so clamping is central
  return await respondForChannel(userClient, req, resolveChannel(req), /* clamp */ true);
```

- [ ] **Step 4: Implement `respondForChannel` (replaces `respondWithLatest`)**

```ts
async function respondForChannel(
  client: ReturnType<typeof createClient>,
  req: Request,
  channel: string,
  clamp: boolean,
): Promise<Response> {
  let release: ReleaseRow | null = null;
  if (clamp) {
    // role-clamped resolver (RLS/security-definer decides effective channel)
    const { data, error } = await client.rpc('desktop_release_for_channel', { p_channel: channel });
    if (error) return jsonResp({ error: 'query_failed', message: error.message }, 500);
    release = (Array.isArray(data) ? data[0] : data) as unknown as ReleaseRow ?? null;
  } else {
    const { data, error } = await client
      .from('desktop_channels')
      .select('desktop_releases!inner(id, version, platforms, notes, created_at)')
      .eq('channel', channel)
      .maybeSingle();
    if (error) return jsonResp({ error: 'query_failed', message: error.message }, 500);
    release = (data as { desktop_releases?: ReleaseRow } | null)?.desktop_releases ?? null;
  }
  if (!release) return jsonResp({ error: 'no_release' }, 404);

  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('yaml') || accept.includes('yml')) {
    return new Response(toLatestYaml(release), {
      status: 200,
      headers: { 'content-type': 'application/yaml; charset=utf-8', ...CORS },
    });
  }
  return jsonResp({
    version: release.version,
    notes: release.notes,
    releaseDate: release.created_at,
    platforms: release.platforms,
    channel,
  });
}
```
Delete the old `respondWithLatest` function.

- [ ] **Step 5: Verify (manual curl against a deployed/local function)**

```bash
# token path, beta channel
curl -H "X-SC-Release-Token: <token>" -H "Accept: application/yaml" \
  "$SUPABASE_URL/functions/v1/desktop-latest/beta.yml"
```
Expected: YAML with the beta pointer's `version:`. `stable.yml` and `latest.yml` return the stable pointer. An unknown suffix returns stable.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/desktop-latest/index.ts
git commit -m "feat(edge): desktop-latest serves per-channel releases with role clamp"
```

**Note:** deploy with `--no-verify-jwt` (unchanged) via `npm run functions:deploy` or MCP when available.

---

## Phase 3 — Web app

### Task 3: Regenerate/extend `database.types.ts`

**Files:**
- Modify: `src/app/core/database.types.ts`

- [ ] **Step 1: Drop `is_current` from the `desktop_releases` Row/Insert/Update** (lines ~869-895) — remove the three `is_current` lines.

- [ ] **Step 2: Add the `desktop_channels` table type** (alongside `desktop_releases`):
```ts
      desktop_channels: {
        Row: { channel: string; release_id: string; updated_at: string }
        Insert: { channel: string; release_id: string; updated_at?: string }
        Update: { channel?: string; release_id?: string; updated_at?: string }
        Relationships: [
          {
            foreignKeyName: "desktop_channels_release_id_fkey"
            columns: ["release_id"]
            referencedRelation: "desktop_releases"
            referencedColumns: ["id"]
          }
        ]
      }
```

- [ ] **Step 3: Add the RPC signatures** to the `Functions` block:
```ts
      desktop_release_for_channel: {
        Args: { p_channel: string }
        Returns: {
          channel: string; version: string; platforms: Json; notes: string | null; created_at: string
        }[]
      }
      promote_desktop_channel: {
        Args: { p_version: string; p_to_channel: string }
        Returns: undefined
      }
```

- [ ] **Step 4: typecheck + commit**

```bash
npm run typecheck
git add src/app/core/database.types.ts
git commit -m "chore(types): desktop_channels + channel RPCs; drop is_current"
```
Expected: `tsc` passes (there are still `is_current` readers — Task 4 removes them; if typecheck fails only on those, do Task 4 in the same commit).

### Task 4: Role-gated channel picker component

**Files:**
- Create: `src/app/desktop/channel-picker.component.ts`
- Test: `src/app/desktop/channel-picker.component.spec.ts`

**Interfaces:**
- Produces: `<sc-channel-picker [(channel)]="sig" />` — emits the selected channel; renders nothing for viewers (only `stable`).
- Consumes: `RoleService.role()` (Task refs: `src/app/auth/role.service.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChannelPickerComponent } from './channel-picker.component';
import { RoleService } from '../auth/role.service';

describe('ChannelPickerComponent', () => {
  function setup(role: 'admin' | 'collaborator' | 'viewer') {
    const roleSig = signal(role);
    TestBed.configureTestingModule({
      imports: [ChannelPickerComponent],
      providers: [{ provide: RoleService, useValue: { role: roleSig.asReadonly() } }],
    });
    const fixture = TestBed.createComponent(ChannelPickerComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('offers alpha/beta/stable and defaults alpha for admin', () => {
    const f = setup('admin');
    expect(f.componentInstance.options()).toEqual(['alpha', 'beta', 'stable']);
    expect(f.componentInstance.channel()).toBe('alpha');
  });

  it('offers beta/stable and defaults beta for collaborator', () => {
    const f = setup('collaborator');
    expect(f.componentInstance.options()).toEqual(['beta', 'stable']);
    expect(f.componentInstance.channel()).toBe('beta');
  });

  it('renders no picker for viewer (stable only)', () => {
    const f = setup('viewer');
    expect(f.componentInstance.options()).toEqual(['stable']);
    expect(f.nativeElement.querySelector('select')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`ChannelPickerComponent` not defined).

Run: `npm test`

- [ ] **Step 3: Implement the component**

```ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';

export type ReleaseChannel = 'alpha' | 'beta' | 'stable';

const ALLOWED: Record<string, ReleaseChannel[]> = {
  admin: ['alpha', 'beta', 'stable'],
  collaborator: ['beta', 'stable'],
  viewer: ['stable'],
};

@Component({
  selector: 'sc-channel-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 1) {
      <label class="chan">
        <span>{{ 'desktop.channel.label' | translate }}</span>
        <select [value]="channel()" (change)="pick($event)">
          @for (c of options(); track c) {
            <option [value]="c">{{ 'desktop.channel.' + c | translate }}</option>
          }
        </select>
      </label>
    }
  `,
  styles: [`
    .chan { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8rem; }
    .chan select { background: var(--sc-bg-2); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; padding: 4px 8px; }
  `],
})
export class ChannelPickerComponent {
  private readonly roles = inject(RoleService);
  readonly channel = model<ReleaseChannel>('stable');
  readonly options = computed<ReleaseChannel[]>(() => ALLOWED[this.roles.role() ?? 'viewer'] ?? ['stable']);

  constructor() {
    // Default to the role's top channel whenever the allowed set changes.
    effect(() => {
      const opts = this.options();
      if (!opts.includes(this.channel())) this.channel.set(opts[0]);
    });
  }

  pick(ev: Event): void {
    this.channel.set((ev.target as HTMLSelectElement).value as ReleaseChannel);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS.** Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add src/app/desktop/channel-picker.component.ts src/app/desktop/channel-picker.component.spec.ts
git commit -m "feat(web): role-gated release-channel picker component"
```

### Task 5: `/uploader` page uses RPC + picker

**Files:**
- Modify: `src/app/desktop/desktop-download.component.ts`

**Interfaces:**
- Consumes: `desktop_release_for_channel` RPC, `ChannelPickerComponent`.

- [ ] **Step 1: Replace the direct query with an RPC keyed on the picked channel**

Swap the `ngOnInit` body for a channel-reactive loader:
```ts
  readonly channel = signal<ReleaseChannel>('stable');

  constructor() {
    effect(() => { void this.load(this.channel()); });
  }

  private async load(channel: ReleaseChannel) {
    this.busy.set(true);
    const { data, error } = await this.sb.client.rpc('desktop_release_for_channel', { p_channel: channel });
    if (error) this.errorMsg.set(error.message);
    else this.release.set(((data as ReleaseInfo[])?.[0] ?? null));
    this.busy.set(false);
  }
```
Add `ChannelPickerComponent` to `imports`, add `signal`/`effect` to the `@angular/core` import, and drop `OnInit`.

- [ ] **Step 2: Add the picker to the section header** (next to `desktop.currentVersion`):
```html
        <div class="sec-head">
          <span class="t">{{ 'desktop.currentVersion' | translate }}</span>
          <sc-channel-picker [(channel)]="channel" />
        </div>
```

- [ ] **Step 3: Typecheck + a spec asserting the RPC is called with the channel**

Run: `npm run typecheck && npm test`
Expected: passes; switching the picker re-queries the RPC.

- [ ] **Step 4: Commit**

```bash
git add src/app/desktop/desktop-download.component.ts
git commit -m "feat(web): /uploader resolves downloads per selected channel"
```

### Task 6: New `/download` route (viewer+)

**Files:**
- Create: `src/app/desktop/download.component.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `desktop_release_for_channel`, `ChannelPickerComponent`. Renders ONLY the download card (no bundle history).

- [ ] **Step 1: Implement the minimal component** (reuse the release-card markup from `desktop-download.component.ts` Section 1, minus `sc-p4k-history`; embed `<sc-channel-picker>`; identical `load()` logic). Title/subtitle keys: `download.title` / `download.subtitle`.

- [ ] **Step 2: Register the route** in `src/app/app.routes.ts` (inside the guarded children block, near `/uploader`):
```ts
      {
        path: 'download',
        canActivate: [...PRIVATE],
        loadComponent: () =>
          import('./desktop/download.component').then((m) => m.DownloadComponent),
      },
```
(`[...PRIVATE]` = `authGuard` + `approvedGuard`; NO `roleGuard`, so invited viewers reach it. The picker self-hides for viewers → stable-only.)

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck && npm test
git add src/app/desktop/download.component.ts src/app/app.routes.ts
git commit -m "feat(web): viewer-accessible /download route (stable, no history)"
```

### Task 7: Admin promotion control

**Files:**
- Create: `src/app/admin/desktop-releases/desktop-releases.component.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `desktop_channels` (admin RLS read), `desktop_releases`, `promote_desktop_channel` RPC.

- [ ] **Step 1: Implement** — list the three channel pointers (current version each) + a promote action (pick a version, pick a target channel → `rpc('promote_desktop_channel', { p_version, p_to_channel })`), showing the RPC error message on monotonicity/forbidden failures. Keys under `admin.desktopReleases.*`.

- [ ] **Step 2: Register route** (mirror the other admin routes):
```ts
      {
        path: 'admin/desktop-releases',
        canActivate: [...PRIVATE, roleGuard('admin')],
        loadComponent: () =>
          import('./admin/desktop-releases/desktop-releases.component').then((m) => m.DesktopReleasesComponent),
      },
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck && npm test
git add src/app/admin/desktop-releases/desktop-releases.component.ts src/app/app.routes.ts
git commit -m "feat(web): admin desktop-channel promotion control"
```

### Task 8: i18n keys (web)

**Files:**
- Modify: `public/i18n/en.json`, `public/i18n/de.json`

- [ ] **Step 1: Extend the `desktop` object** (both files) with a `channel` sub-object; add top-level `download` and `admin.desktopReleases` objects. English:
```json
  "desktop": {
    "...": "(existing keys unchanged)",
    "channel": {
      "label": "Channel",
      "alpha": "Alpha",
      "beta": "Beta",
      "stable": "Stable"
    }
  },
  "download": {
    "title": "Download",
    "subtitle": "Get the Data Uploader for your local Star Citizen install."
  }
```
German mirrors: `"label": "Channel"`, `"alpha": "Alpha"`, `"beta": "Beta"`, `"stable": "Stabil"`; `download.title` = `"Download"`, `download.subtitle` = `"Hol dir den Data Uploader für deinen lokalen Star-Citizen-Install."`. Add `admin.desktopReleases` (title, promote, currentPointer, targetChannel, version, promoteAction) in both.

- [ ] **Step 2: Verify JSON parses + keys resolve**

Run: `npm run build` (fails on malformed JSON). Manually confirm no missing-key `[translate]` fallbacks on `/download`.

- [ ] **Step 3: Commit**

```bash
git add public/i18n/en.json public/i18n/de.json
git commit -m "i18n(web): channel picker, download page, admin promotion strings"
```

---

## Phase 4 — Electron tool

### Task 9: `updateChannel` setting

**Files:**
- Modify: `data-uploader/src/lib/settings-store.ts`
- Test: `data-uploader/test/settings-store.spec.ts`

**Interfaces:**
- Produces: `Settings.updateChannel: 'alpha'|'beta'|'stable'` (default `'stable'`).

- [ ] **Step 1: Add a failing test** (append to the existing spec):
```ts
it('defaults updateChannel to stable and round-trips a patch', () => {
  const store = new SettingsStore(memIO(), () => 'id-1');
  expect(store.load().updateChannel).toBe('stable');
  expect(store.patch({ updateChannel: 'beta' }).updateChannel).toBe('beta');
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd data-uploader && npm test`

- [ ] **Step 3: Implement** — add to the `Settings` interface and `load()` defaults:
```ts
  /** Auto-update ring the operator opted into. Default 'stable' (role-gated in UI). */
  updateChannel: 'alpha' | 'beta' | 'stable';
```
```ts
    updateChannel:
      parsed?.updateChannel === 'alpha' || parsed?.updateChannel === 'beta'
        ? parsed.updateChannel
        : 'stable',
```
(`patch()` already accepts it via `Partial<Omit<Settings,'installId'>>`.)

- [ ] **Step 4: Run — expect PASS.** Run: `cd data-uploader && npm test`

- [ ] **Step 5: Commit**

```bash
git add data-uploader/src/lib/settings-store.ts data-uploader/test/settings-store.spec.ts
git commit -m "feat(uploader): persist updateChannel preference (default stable)"
```

### Task 10: Channel-parameterised updater

**Files:**
- Modify: `data-uploader/src/main/updater.ts`

**Interfaces:**
- Consumes: `updateChannel` from settings (passed in by `main/index.ts`, Task 11).
- Produces: `initAutoUpdater(channel: ReleaseChannel)` + `setUpdateChannel(channel)` that re-points the feed and re-checks.

- [ ] **Step 1:** Add `export type ReleaseChannel = 'alpha' | 'beta' | 'stable';` and a module var `let currentChannel: ReleaseChannel = 'stable';`.

- [ ] **Step 2:** In `initAutoUpdater`, accept `channel: ReleaseChannel`, set `currentChannel = channel`, and set `autoUpdater.channel = channel` before `setFeedURL`. electron-updater then requests `<feed>/<channel>.yml`.

- [ ] **Step 3:** For the portable manual check, pass the channel to the feed:
```ts
    const res = await fetch(`${FEED_URL}/${currentChannel}.yml`, {
      headers: { 'X-SC-Release-Token': RELEASE_TOKEN, 'X-SC-Tool-Version': TOOL_VERSION, Accept: 'application/yaml' },
    });
```
(Replaces the bare `fetch(FEED_URL, …)` in `fetchLatestVersion`.)

- [ ] **Step 4:** Add:
```ts
export function setUpdateChannel(channel: ReleaseChannel): void {
  currentChannel = channel;
  if (IS_UNSIGNED_DEV_BUILD || IS_PORTABLE_BUILD) { void checkPortableForUpdate(); return; }
  autoUpdater.channel = channel;
  checkForUpdatesSilently();
}
```

- [ ] **Step 5:** Typecheck. Run: `cd data-uploader && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add data-uploader/src/main/updater.ts
git commit -m "feat(uploader): channel-parameterised auto-update feed"
```

### Task 11: `sc:session:role` IPC + wire channel

**Files:**
- Modify: `data-uploader/src/main/index.ts`, `data-uploader/src/preload/index.ts`

**Interfaces:**
- Produces (preload): `window.sc.session.role(): Promise<'admin'|'collaborator'|'viewer'>`; `window.sc.settings.patch({ updateChannel })` already available.
- Consumes: `ensureAccessToken()` from `data-uploader/src/main/session.ts` (already imported into `index.ts:42-49`); `API_BASE`, `SUPABASE_ANON_KEY` from `../lib/release-token.js` (already imported into `session.ts:22`).

- [ ] **Step 1: preload** — add to the `session` bridge:
```ts
    role: (): Promise<'admin' | 'collaborator' | 'viewer'> => ipcRenderer.invoke('sc:session:role'),
```

- [ ] **Step 2: session.ts** — export a `fetchUserRole()` that reuses the existing token source (`ensureAccessToken`) and calls the `current_user_role` RPC over REST, mirroring `runSync`/`syncServerCatalog` (`session.ts:176`, `sync.ts:82`). Add near `runSync`:
```ts
export async function fetchUserRole(): Promise<'admin' | 'collaborator' | 'viewer'> {
  const { token } = await ensureAccessToken();
  if (!token) return 'viewer';
  try {
    const res = await fetch(`${API_BASE}/rest/v1/rpc/current_user_role`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return 'viewer';
    const role = (await res.json()) as string;
    return role === 'admin' || role === 'collaborator' ? role : 'viewer';
  } catch {
    return 'viewer';
  }
}
```

- [ ] **Step 2b: index.ts** — register the handler next to the other `sc:session:*` handlers (`index.ts:361-371`), and add `fetchUserRole` to the existing `./session.js` import block (`index.ts:42-49`):
```ts
ipcMain.handle('sc:session:role', async () => fetchUserRole());
```

- [ ] **Step 3: main** — feed the persisted channel to the updater at startup and on change. At the `initAutoUpdater()` call site, pass the setting:
```ts
initAutoUpdater(settings.load().updateChannel);
```
And in the `sc:settings:patch` handler, after persisting, if the patch touched `updateChannel`, call `setUpdateChannel(next.updateChannel)`:
```ts
import { initAutoUpdater, setUpdateChannel } from './updater.js';
// inside patch handler, after store.patch(partial):
if (partial.updateChannel) setUpdateChannel(next.updateChannel);
```

- [ ] **Step 4: Typecheck.** Run: `cd data-uploader && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add data-uploader/src/main/index.ts data-uploader/src/preload/index.ts
git commit -m "feat(uploader): expose session role + drive updater channel from settings"
```

### Task 12: Renderer picker (update banner + settings)

**Files:**
- Modify: `data-uploader/src/renderer/main.ts`, `data-uploader/src/renderer/styles.css`
- Modify: `data-uploader/src/i18n/de.json`, `data-uploader/src/i18n/en.json`

**Interfaces:**
- Consumes: `window.sc.session.role()`, `window.sc.settings.get()/patch()`.

- [ ] **Step 1:** On startup, fetch the role (`await window.sc.session.role()`) and current `updateChannel` (`(await window.sc.settings.get()).updateChannel`). Compute allowed channels: admin `['alpha','beta','stable']`, collaborator `['beta','stable']`, viewer `[]` (hidden).

- [ ] **Step 2:** Render a `<select>` in the settings panel and next to the update banner ONLY when allowed.length > 1. On change: `await window.sc.settings.patch({ updateChannel: value })` (this triggers `setUpdateChannel` in main → re-check). Label/options via the tool i18n dictionary.

- [ ] **Step 3:** Add tool i18n keys mirroring the settings idiom already in `data-uploader/src/i18n/{de,en}.json` (e.g. `settings.updateChannel.label`, `.alpha`, `.beta`, `.stable`).

- [ ] **Step 4:** Typecheck + build the renderer. Run: `cd data-uploader && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add data-uploader/src/renderer/main.ts data-uploader/src/renderer/styles.css data-uploader/src/i18n/de.json data-uploader/src/i18n/en.json
git commit -m "feat(uploader): role-gated channel picker in banner + settings"
```

---

## Phase 5 — CI

### Task 13: Register build into catalog + move alpha pointer

**Files:**
- Modify: `.github/workflows/data-uploader-build.yml`

**Interfaces:**
- Consumes: `desktop_channels`, `desktop_releases` (Task 1).

- [ ] **Step 1:** Rewrite the printed SQL (lines 218-242) so it registers the catalog row AND moves the alpha pointer atomically, dropping `is_current`. Replace the `Write-Host` block that prints the INSERT with:
```powershell
          Write-Host "WITH new_rel AS ("
          Write-Host "  INSERT INTO public.desktop_releases (version, release_token, platforms, notes)"
          Write-Host "  VALUES ("
          Write-Host "    '$binVersion',"
          Write-Host "    '<UUID-from-release-token-artefact>',"
          Write-Host "    jsonb_build_object("
          Write-Host "      'win-x64-setup', jsonb_build_object('url','$setupUrl','kind','nsis','sha512','$setupSha','size_bytes',$setupSize),"
          Write-Host "      'win-x64-portable', jsonb_build_object('url','$portableUrl','kind','portable','sha512','$portableSha','size_bytes',$portableSize)"
          Write-Host "    ),"
          Write-Host "    'TODO: release notes here'"
          Write-Host "  ) RETURNING id"
          Write-Host ")"
          Write-Host "INSERT INTO public.desktop_channels (channel, release_id)"
          Write-Host "SELECT 'alpha', id FROM new_rel"
          Write-Host "ON CONFLICT (channel) DO UPDATE SET release_id = EXCLUDED.release_id, updated_at = now();"
```
Remove the old `UPDATE public.desktop_releases SET is_current = false …` reminder lines (240-242) — the pointer model makes them obsolete. Update the step name/comment to say "register + point alpha".

- [ ] **Step 2:** Update the release-notes handoff text (private-release body, ~line 154) to say "register via the CTE printed in the build log, then promote alpha→beta→stable in /admin/desktop-releases".

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/data-uploader-build.yml
git commit -m "ci(uploader): register build into catalog + move alpha channel pointer"
```

---

## Rollout order

Phase 1 → 2 (migration + edge deploy together, so the dropped `is_current` never breaks a live function) → 3 (web) → 4 (tool; ships to alpha first, promote after verification) → 5 (CI). See the spec (`docs/superpowers/specs/2026-07-19-release-channel-selection-design.md`) §8.

## Verification (end-to-end, after all tasks)

- DB: `desktop_release_for_channel` clamps per role (admin/collaborator/viewer/anon × alpha/beta/stable); `promote_desktop_channel` enforces admin + monotonicity; seed correct.
- Edge: `beta.yml` / `stable.yml` / `latest.yml` / `?channel=` resolve correctly on token + JWT paths; back-compat `latest.yml` → stable.
- Web: `/download` (viewer) shows stable, no picker; `/uploader` (collaborator) picker beta/stable; admin alpha; `/admin/desktop-releases` promotes.
- Tool: picker visibility per role; changing it re-checks the correct channel; portable manual check hits `/<channel>.yml`.
- Back-compat: an already-installed build (electron-updater channel `latest`) still updates on stable.
