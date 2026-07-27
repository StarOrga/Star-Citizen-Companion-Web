# Codex Showroom — P1 (Discovery Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 3D ship liveries discoverable by adding a public, livery-first
Showroom surface — a cheap metadata-only discovery plane — without ever touching a
multi-MB `.glb`.

**Architecture:** Two planes. This plan builds the **discovery plane** only: a tiny
Postgres view (`ship_skins_index`), a `ShowroomService` that reads it, a
`/codex/showroom` gallery component, a Bridge entry point, and a "Holo-Ready" badge.
The heavy asset plane (the existing `ShipSkinViewerComponent`) is untouched here and
elevated later in P2. Ship display names/preview art are resolved client-side against
the existing `CodexService` current-build catalog.

**Tech Stack:** Angular 21 (standalone, signals, OnPush), Supabase (Postgres view +
supabase-js), ngx-translate, Karma/Jasmine.

## Global Constraints

- **Data provenance:** all livery data comes ONLY from the data-uploader →
  `ingest-skins` pipeline. This plan adds **read-only** surfaces + one derived view.
  No manual row inserts, no hardcoded ship/livery counts — every number is derived at
  read time. (Spec: `docs/superpowers/specs/2026-07-26-codex-showroom-design.md`.)
- **i18n:** every user-facing string via ngx-translate (`{{ 'key' | translate }}`),
  keys added to BOTH `public/i18n/de.json` and `public/i18n/en.json`. Never hardcode.
- **Component rules:** standalone, `changeDetection: OnPush`, `providedIn:'root'`
  services.
- **Naming:** the new surface is **Showroom** (`/codex/showroom`). Do NOT touch or
  rename the existing personal **Hangar** (`src/app/hangar/*`).
- **Migration version collision:** parallel runs can mint the same timestamp prefix.
  Before `db:push`/merge, verify `20260726160000` is greater than the newest prefix on
  `origin/main` and unique (`git log origin/main -- supabase/migrations`). Bump the
  prefix if it collides.
- **Public route:** `/codex/showroom` is public (anon). `ship_skins` already grants
  `anon` + `authenticated` SELECT (policies `ship_skins_anon_read`,
  `ship_skins_authenticated_read`), so no policy change is needed — only a grant on
  the new view.

## File Structure

- `supabase/migrations/20260726160000_ship_skins_index.sql` — new view + grant.
- `src/app/codex/showroom.service.ts` — discovery read (view → DTO). New.
- `src/app/codex/showroom.service.spec.ts` — service tests. New.
- `src/app/codex/codex-showroom.component.ts` — the gallery surface. New.
- `src/app/codex/holo-ready-badge.component.ts` — the "Holo-Ready" signpost. New.
- `src/app/app.routes.ts` — register `codex/showroom` BEFORE `codex/:kind/:className`.
- `src/app/codex/codex-bridge.component.ts` — add a Showroom entry link + billboard.
- `src/app/core/database.types.ts` — add the `ship_skins_index` view Row type.
- `public/i18n/de.json`, `public/i18n/en.json` — `codex.showroom.*` + `codex.skins.holoReady`.

---

### Task 1: `ship_skins_index` discovery view

**Files:**
- Create: `supabase/migrations/20260726160000_ship_skins_index.sql`
- Modify: `src/app/core/database.types.ts` (add the view Row type)

**Interfaces:**
- Produces: a readable view `public.ship_skins_index` with columns
  `ship_id text`, `livery_count int8`, `model_count int8`, `poster_path text|null`,
  `sources text[]`, `latest_added timestamptz`. One row per ship that has ≥1 livery.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726160000_ship_skins_index.sql`:

```sql
-- Codex Showroom discovery plane. A cheap, metadata-only summary of which ships
-- have 3D liveries — one row per ship that has >=1 ship_skins entry. NEVER carries
-- a .glb URL (the heavy asset plane resolves those per-ship in the viewer). Small
-- forever (hundreds of rows), so a plain view suffices — no materialized refresh.
--
-- Data provenance: derived purely from public.ship_skins, which is populated ONLY
-- by the data-uploader -> ingest-skins pipeline (build-scoped). No counts are
-- hardcoded; this view reflects whatever the uploader has ingested.
--
-- security_invoker=true so the caller's RLS on ship_skins applies (ship_skins
-- already grants anon + authenticated SELECT). Build scoping / display names are
-- resolved client-side against codex_ships for the current LIVE build.

create or replace view public.ship_skins_index
with (security_invoker = true) as
select
  s.ship_id,
  count(*)                                                as livery_count,
  count(s.model_path)                                     as model_count,
  min(s.icon_path) filter (where s.icon_path is not null) as poster_path,
  array_agg(distinct s.source order by s.source)          as sources,
  max(s.created_at)                                       as latest_added
from public.ship_skins s
group by s.ship_id;

grant select on public.ship_skins_index to anon, authenticated;
```

- [ ] **Step 2: Apply and verify the view returns the expected shape**

Run:
```bash
npm run db:push
```
Then verify (headless SQL or Supabase SQL editor):
```sql
select ship_id, livery_count, model_count, poster_path, sources, latest_added
from public.ship_skins_index order by latest_added desc;
```
Expected: 1 row today — `DRAK_Cutlass_Black`, `livery_count=7`, `model_count=7`,
a non-null `poster_path`, `sources` containing `{factory,pu_npc,store,subscriber}`.

- [ ] **Step 3: Add the view Row type to `database.types.ts`**

In `src/app/core/database.types.ts`, under the `Views:` object of the `public`
schema (create the `Views` block if it does not yet exist, sibling to `Tables`), add:

```ts
ship_skins_index: {
  Row: {
    ship_id: string
    livery_count: number
    model_count: number
    poster_path: string | null
    sources: string[]
    latest_added: string
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260726160000_ship_skins_index.sql src/app/core/database.types.ts
git commit -m "feat(codex): ship_skins_index discovery view for the Showroom"
```

---

### Task 2: `ShowroomService` — discovery read

**Files:**
- Create: `src/app/codex/showroom.service.ts`
- Test: `src/app/codex/showroom.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseClientProvider` (`.client.from(...).select(...).order(...)`),
  `ShipSkinsService.assetUrl(path)` (Task exists today) for the poster URL.
- Produces:
  ```ts
  export interface ShowroomEntry {
    shipId: string;
    liveryCount: number;
    modelCount: number;
    sources: string[];
    latestAdded: string;      // ISO timestamp
    posterUrl: string | null; // public ship-skins URL of the livery icon, or null
  }
  // ShowroomService:
  //   list(): Promise<{ entries: ShowroomEntry[]; error: boolean }>   // newest first
  //   load(): Promise<void>                                            // fills signals
  //   readonly entries: Signal<ShowroomEntry[]>
  //   readonly modelShipIds: Signal<ReadonlySet<string>>              // for the badge
  ```

- [ ] **Step 1: Write the failing test**

Create `src/app/codex/showroom.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { ShowroomService } from './showroom.service';
import { ShipSkinsService } from './ship-skins.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

/** Fluent mock of the supabase chain used by list(): from().select().order(). */
function mockProvider(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  const calls: any = { table: '', orderCol: '' };
  const q: any = {
    select: () => q,
    order: (col: string) => {
      calls.orderCol = col;
      return Promise.resolve(result);
    },
  };
  capture?.(calls);
  return {
    client: { from: (t: string) => { calls.table = t; return q; } },
  } as unknown as SupabaseClientProvider;
}

function makeService(result: { data: unknown; error: unknown }, capture?: (c: any) => void) {
  TestBed.configureTestingModule({
    providers: [
      ShowroomService,
      ShipSkinsService,
      { provide: SupabaseClientProvider, useValue: mockProvider(result, capture) },
    ],
  });
  return TestBed.inject(ShowroomService);
}

const ROW = {
  ship_id: 'DRAK_Cutlass_Black',
  livery_count: 7,
  model_count: 7,
  poster_path: 'DRAK_Cutlass_Black/cypress.webp',
  sources: ['factory', 'pu_npc', 'store', 'subscriber'],
  latest_added: '2026-06-03T00:00:00Z',
};

describe('ShowroomService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads ship_skins_index ordered by latest_added and maps to ShowroomEntry', async () => {
    let cap: any;
    const svc = makeService({ data: [ROW], error: null }, (c) => (cap = c));
    const { entries, error } = await svc.list();
    expect(error).toBeFalse();
    expect(cap.table).toBe('ship_skins_index');
    expect(cap.orderCol).toBe('latest_added');
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual({
      shipId: 'DRAK_Cutlass_Black',
      liveryCount: 7,
      modelCount: 7,
      sources: ['factory', 'pu_npc', 'store', 'subscriber'],
      latestAdded: '2026-06-03T00:00:00Z',
      posterUrl:
        `${environment.supabase.url}/storage/v1/object/public/ship-skins/DRAK_Cutlass_Black/cypress.webp`,
    });
  });

  it('maps a null poster_path to a null posterUrl', async () => {
    const svc = makeService({ data: [{ ...ROW, poster_path: null }], error: null });
    const { entries } = await svc.list();
    expect(entries[0].posterUrl).toBeNull();
  });

  it('flags error:true on query failure (distinct from empty)', async () => {
    const svc = makeService({ data: null, error: { message: 'boom' } });
    await expectAsync(svc.list()).toBeResolvedTo({ entries: [], error: true });
  });

  it('load() fills entries and modelShipIds (only ships with >=1 model)', async () => {
    const svc = makeService({
      data: [ROW, { ...ROW, ship_id: 'NO_MODEL', model_count: 0, poster_path: null }],
      error: null,
    });
    await svc.load();
    expect(svc.entries().length).toBe(2);
    expect(svc.modelShipIds().has('DRAK_Cutlass_Black')).toBeTrue();
    expect(svc.modelShipIds().has('NO_MODEL')).toBeFalse();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `showroom.service.ts` does not exist / `ShowroomService` undefined.

- [ ] **Step 3: Write the service**

Create `src/app/codex/showroom.service.ts`:

```ts
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ShipSkinsService } from './ship-skins.service';

/** One ship that has >=1 livery — a row of public.ship_skins_index, resolved. */
export interface ShowroomEntry {
  shipId: string;
  liveryCount: number;
  modelCount: number;
  sources: string[];
  latestAdded: string;
  posterUrl: string | null;
}

/**
 * Discovery plane for the Codex Showroom. Reads the cheap ship_skins_index view
 * (metadata + livery-icon poster only — NEVER a .glb URL) and exposes it as a
 * signal for the gallery and the Holo-Ready badge. Display names / ship preview
 * art are resolved by the component against CodexService, keeping this service a
 * pure, independently testable discovery read.
 */
@Injectable({ providedIn: 'root' })
export class ShowroomService {
  private readonly supabase = inject(SupabaseClientProvider);
  private readonly skins = inject(ShipSkinsService);

  private readonly _entries = signal<ShowroomEntry[]>([]);
  readonly entries: Signal<ShowroomEntry[]> = this._entries.asReadonly();
  /** Ship ids that have at least one 3D model — the badge probe. */
  readonly modelShipIds = computed<ReadonlySet<string>>(
    () => new Set(this._entries().filter((e) => e.modelCount > 0).map((e) => e.shipId)),
  );

  /** Ships with liveries, newest first. Discriminates empty from query failure. */
  async list(): Promise<{ entries: ShowroomEntry[]; error: boolean }> {
    const { data, error } = await this.supabase.client
      .from('ship_skins_index')
      .select('ship_id, livery_count, model_count, poster_path, sources, latest_added')
      .order('latest_added', { ascending: false });
    if (error) return { entries: [], error: true };
    const entries = (data ?? []).map((r) => ({
      shipId: r.ship_id,
      liveryCount: r.livery_count ?? 0,
      modelCount: r.model_count ?? 0,
      sources: r.sources ?? [],
      latestAdded: r.latest_added,
      posterUrl: this.skins.assetUrl(r.poster_path),
    }));
    return { entries, error: false };
  }

  /** Load once into the signal (idempotent-friendly; safe to call from badges). */
  async load(): Promise<void> {
    const { entries, error } = await this.list();
    if (!error) this._entries.set(entries);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all four `ShowroomService` specs green).

- [ ] **Step 5: Commit**

```bash
git add src/app/codex/showroom.service.ts src/app/codex/showroom.service.spec.ts
git commit -m "feat(codex): ShowroomService discovery read over ship_skins_index"
```

---

### Task 3: Holo-Ready badge component

**Files:**
- Create: `src/app/codex/holo-ready-badge.component.ts`
- Modify: `public/i18n/de.json`, `public/i18n/en.json` (added fully in Task 6; add just
  `codex.skins.holoReady` here so the badge renders during dev)

**Interfaces:**
- Consumes: `ShowroomService.modelShipIds` (Signal), `ShowroomService.load()`.
- Produces: `<sc-holo-ready-badge [shipId]="className" />` — renders a small glyph
  when the ship has a 3D model, nothing otherwise.

- [ ] **Step 1: Write the badge component**

Create `src/app/codex/holo-ready-badge.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ShowroomService } from './showroom.service';

/**
 * "Holo-Ready" signpost: a small glyph shown on a ship card/detail when that ship
 * has >=1 interactive 3D livery in the Showroom. Reads the shared ShowroomService
 * discovery cache (loads it once); renders nothing for ships without a model, so
 * it can never look broken on the 312 ships without coverage.
 */
@Component({
  selector: 'sc-holo-ready-badge',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isReady()) {
      <span class="holo-badge" [attr.title]="'codex.skins.holoReady' | translate"
            [attr.aria-label]="'codex.skins.holoReady' | translate">
        <span class="holo-glyph" aria-hidden="true">◈</span>
        {{ 'codex.skins.holoReadyShort' | translate }}
      </span>
    }
  `,
  styles: [`
    .holo-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 999px;
      font-family: var(--sc-font-display); font-size: 0.62rem; letter-spacing: 0.08em;
      text-transform: uppercase; white-space: nowrap;
      color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
    }
    .holo-glyph { font-size: 0.78rem; line-height: 1; text-shadow: 0 0 6px var(--sc-accent); }
  `],
})
export class HoloReadyBadgeComponent {
  private readonly showroom = inject(ShowroomService);
  readonly shipId = input.required<string>();

  constructor() {
    // Fire-and-forget: fill the shared discovery cache if a consumer renders the
    // badge before the Showroom route has loaded it. Cheap (tiny view).
    if (this.showroom.entries().length === 0) void this.showroom.load();
  }

  readonly isReady = computed(() => this.showroom.modelShipIds().has(this.shipId()));
}
```

- [ ] **Step 2: Add the two badge i18n keys (full block lands in Task 6)**

In `public/i18n/en.json`, inside the existing `codex.skins` object, add:
```json
"holoReady": "Holo-Ready — interactive 3D liveries available",
"holoReadyShort": "3D"
```
In `public/i18n/de.json`, inside `codex.skins`:
```json
"holoReady": "Holo-Ready — interaktive 3D-Lackierungen verfügbar",
"holoReadyShort": "3D"
```

- [ ] **Step 3: Wire the badge into the Bridge lane card**

In `src/app/codex/codex-bridge.component.ts`: add `HoloReadyBadgeComponent` to the
component `imports` array, and in the `#laneCard` template place the badge in
`.lane-info` under the name:

```html
<div class="lane-info">
  <h3 class="lane-name">{{ rowName(r) }}</h3>
  <sc-holo-ready-badge [shipId]="r.classNameSlug" />
  @if (r.manufacturerCode) { <span class="lane-mfr">{{ r.manufacturerCode }}</span> }
</div>
```
Add the import at the top:
```ts
import { HoloReadyBadgeComponent } from './holo-ready-badge.component';
```

- [ ] **Step 4: Verify it typechecks and renders**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm test`
Expected: PASS (existing Bridge spec still green; badge has no spec of its own — it is
covered by the Showroom browser snapshot in Task 5's verification).

- [ ] **Step 5: Commit**

```bash
git add src/app/codex/holo-ready-badge.component.ts src/app/codex/codex-bridge.component.ts public/i18n/de.json public/i18n/en.json
git commit -m "feat(codex): Holo-Ready badge on ships with 3D liveries"
```

---

### Task 4: `CodexShowroomComponent` — the gallery surface + route

**Files:**
- Create: `src/app/codex/codex-showroom.component.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ShowroomService.list()`, `CodexService.loadCurrentBuild()`,
  `CodexService.getShipsByClassNames(classNames): Promise<Map<string, CodexListRow>>`,
  `CodexService.previewUrl(previewImage): string | null`,
  `pickLocalized`, `toLang` from `./codex.service`,
  `cleanLocaleValue`, `humanizeClassName` from `./codex-format`.
- Produces: route `codex/showroom` → `CodexShowroomComponent`.

- [ ] **Step 1: Write the component**

Create `src/app/codex/codex-showroom.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexListRow, CodexService, pickLocalized, toLang } from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { ShowroomEntry, ShowroomService } from './showroom.service';

/** A Showroom card = one covered ship, its discovery entry merged with catalog art. */
interface ShowroomCard {
  shipId: string;
  name: string;
  manufacturerCode: string | null;
  liveryCount: number;
  modelCount: number;
  sources: string[];
  latestAdded: string;
  posterUrl: string | null; // livery icon → ship preview → null (icon fallback)
}

/**
 * "The Showroom" — the public, livery-first discovery destination for 3D ship
 * liveries. Reads only the cheap discovery plane (ShowroomService) + catalog
 * metadata (names/preview art) — NO .glb, NO 3D lib on this route. Renders only
 * ships that actually have liveries, so it is structurally incapable of looking
 * empty: a spotlight hero, a "newly modeled" rail, and the full gallery.
 */
@Component({
  selector: 'sc-codex-showroom',
  standalone: true,
  imports: [RouterLink, TranslateModule, CodexCategoryIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="showroom">
      <header class="sr-head">
        <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>
        <h1>{{ 'codex.showroom.title' | translate }}</h1>
        <p class="sr-sub">{{ 'codex.showroom.subtitle' | translate }}</p>
        @if (liveryTotal() > 0) {
          <p class="sr-count">
            {{ 'codex.showroom.count' | translate: { liveries: liveryTotal(), ships: cards().length } }}
          </p>
        }
      </header>

      @if (error()) {
        <div class="sc-card err">
          <strong>{{ 'codex.skins.loadCatalogError' | translate }}</strong>
          <button type="button" class="retry" (click)="reload()">{{ 'codex.skins.retry' | translate }}</button>
        </div>
      } @else if (loading()) {
        <div class="sr-grid">
          @for (s of skeletons; track s) { <div class="sr-card skel"></div> }
        </div>
      } @else if (cards().length === 0) {
        <div class="sc-card empty">
          <strong>{{ 'codex.showroom.empty.title' | translate }}</strong>
          <p>{{ 'codex.showroom.empty.body' | translate }}</p>
        </div>
      } @else {
        <!-- Spotlight: the newest covered ship -->
        @if (spotlight(); as sp) {
          <a class="spotlight" [routerLink]="['/codex', 'ship', sp.shipId]">
            <div class="sp-art" [class.icon-only]="!sp.posterUrl">
              @if (sp.posterUrl) { <img [src]="sp.posterUrl" [alt]="sp.name" /> }
              @else { <sc-codex-icon kind="ship" /> }
            </div>
            <div class="sp-body">
              <span class="sp-eyebrow">{{ 'codex.showroom.spotlight' | translate }}</span>
              <h2>{{ sp.name }}</h2>
              @if (sp.manufacturerCode) { <p class="sp-mfr">{{ sp.manufacturerCode }}</p> }
              <p class="sp-meta">{{ 'codex.showroom.liveryCount' | translate: { count: sp.liveryCount } }}</p>
              <span class="btn primary">{{ 'codex.skins.mode3d' | translate }} →</span>
            </div>
          </a>
        }

        <!-- The gallery -->
        <h2 class="sr-lane-title">{{ 'codex.showroom.gallery' | translate }}</h2>
        <div class="sr-grid">
          @for (c of cards(); track c.shipId) {
            <a class="sr-card" [routerLink]="['/codex', 'ship', c.shipId]">
              <div class="sr-thumb" [class.icon-only]="!c.posterUrl">
                @if (c.posterUrl) { <img [src]="c.posterUrl" [alt]="c.name" loading="lazy" /> }
                @else { <sc-codex-icon kind="ship" /> }
              </div>
              <div class="sr-info">
                <h3>{{ c.name }}</h3>
                @if (c.manufacturerCode) { <span class="sr-mfr">{{ c.manufacturerCode }}</span> }
                <span class="sr-liveries">{{ 'codex.showroom.liveryCount' | translate: { count: c.liveryCount } }}</span>
              </div>
            </a>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .showroom { display: flex; flex-direction: column; gap: 20px; padding-bottom: 90px; }
    .sr-head { display: flex; flex-direction: column; gap: 4px; }
    .back { color: var(--sc-fg-2); text-decoration: none; font-size: 0.82rem; width: fit-content; }
    .back:hover { color: var(--sc-accent); }
    .sr-head h1 { margin: 6px 0 0; font-size: clamp(1.5rem, 3vw, 2.1rem); }
    .sr-sub { margin: 0; color: var(--sc-fg-1); max-width: 60ch; }
    .sr-count { margin: 2px 0 0; color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.8rem; letter-spacing: 0.05em; }

    .spotlight {
      display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 4px;
      border-radius: 16px; overflow: hidden; min-height: 260px; text-decoration: none; color: inherit;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      background: radial-gradient(120% 80% at 78% 30%, color-mix(in srgb, var(--sc-accent) 14%, transparent), transparent 60%), var(--sc-bg-1);
    }
    .sp-art { display: flex; align-items: center; justify-content: center; padding: 24px;
      background: radial-gradient(circle at 45% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .sp-art img { max-width: 100%; max-height: 280px; object-fit: contain; filter: drop-shadow(0 8px 26px rgba(0,0,0,0.6)); }
    .sp-art.icon-only sc-codex-icon { width: 55%; height: 55%; }
    .sp-body { display: flex; flex-direction: column; gap: 6px; padding: 26px 28px; justify-content: center; }
    .sp-eyebrow { font-family: var(--sc-font-display); font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent); }
    .sp-body h2 { margin: 0; font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.1; }
    .sp-mfr { margin: 0; color: var(--sc-fg-1); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; }
    .sp-meta { margin: 4px 0; color: var(--sc-fg-2); font-size: 0.84rem; }
    .btn.primary { width: fit-content; margin-top: 8px; padding: 10px 20px; border-radius: 9px; background: var(--sc-accent); color: var(--sc-bg-0); font-family: var(--sc-font-display); font-size: 0.78rem; letter-spacing: 0.05em; text-transform: uppercase; }

    .sr-lane-title { margin: 6px 0 0; font-size: 1.05rem; }
    .sr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
    .sr-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 10px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: inherit; text-decoration: none;
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s; }
    .sr-card:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 26%, transparent); }
    .sr-thumb { height: 130px; display: flex; align-items: center; justify-content: center; border-radius: 8px;
      background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .sr-thumb img { max-height: 122px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .sr-thumb.icon-only sc-codex-icon { width: 90%; height: 90%; }
    .sr-info { display: flex; flex-direction: column; gap: 2px; }
    .sr-info h3 { margin: 0; font-size: 0.92rem; line-height: 1.2; }
    .sr-mfr { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .sr-liveries { font-size: 0.72rem; color: var(--sc-accent); }

    .skel { min-height: 180px; border-radius: 10px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty, .err { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .err { color: var(--sc-danger); display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; }
    .err .retry { padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (max-width: 760px) { .spotlight { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .sr-card { transition: none; } .skel { animation: none; } }
  `],
})
export class CodexShowroomComponent implements OnInit {
  private readonly showroom = inject(ShowroomService);
  private readonly codex = inject(CodexService);
  private readonly t = inject(TranslateService);

  readonly skeletons = Array.from({ length: 6 }, (_, i) => i);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly cards = signal<ShowroomCard[]>([]);

  /** Newest covered ship = spotlight (list() returns newest first). */
  readonly spotlight = computed<ShowroomCard | null>(() => this.cards()[0] ?? null);
  readonly liveryTotal = computed(() => this.cards().reduce((n, c) => n + c.liveryCount, 0));

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      await this.codex.loadCurrentBuild();
      const { entries, error } = await this.showroom.list();
      if (error) { this.error.set(true); return; }
      this.cards.set(await this.toCards(entries));
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Merge discovery entries with current-build catalog rows for name + preview art. */
  private async toCards(entries: ShowroomEntry[]): Promise<ShowroomCard[]> {
    const rows = await this.codex.getShipsByClassNames(entries.map((e) => e.shipId));
    return entries.map((e) => {
      const row = rows.get(e.shipId);
      return {
        shipId: e.shipId,
        name: this.rowName(row, e.shipId),
        manufacturerCode: row?.manufacturerCode ?? null,
        liveryCount: e.liveryCount,
        modelCount: e.modelCount,
        sources: e.sources,
        latestAdded: e.latestAdded,
        // Poster fallback chain: livery icon → ship catalog preview → null (icon).
        posterUrl: e.posterUrl ?? this.shipPreview(row),
      };
    });
  }

  private rowName(row: CodexListRow | undefined, shipId: string): string {
    if (!row) return humanizeClassName(shipId);
    const p = row.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const localized = p?.name ? pickLocalized(p.name, toLang(this.t.currentLang)) : '';
    return localized || cleanLocaleValue(row.nameLocalized) || humanizeClassName(shipId);
  }

  private shipPreview(row: CodexListRow | undefined): string | null {
    const p = row?.payload as { previewImage?: string | null } | undefined;
    return this.codex.previewUrl(p?.previewImage);
  }
}
```

- [ ] **Step 2: Register the route BEFORE the `:kind` wildcard**

In `src/app/app.routes.ts`, add this entry immediately after the `codex/upcoming`
block and BEFORE `codex/:kind/:className` (the static segment must win):

```ts
{
  // The Showroom — public, livery-first 3D discovery destination. Reads only the
  // cheap discovery plane (no .glb, no 3D lib on this route). Static segment placed
  // BEFORE codex/:kind/:className so it is not consumed by the :kind wildcard.
  path: 'codex/showroom',
  loadComponent: () =>
    import('./codex/codex-showroom.component').then((m) => m.CodexShowroomComponent),
},
```

- [ ] **Step 3: Typecheck + test**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/app/codex/codex-showroom.component.ts src/app/app.routes.ts
git commit -m "feat(codex): Showroom gallery route /codex/showroom"
```

---

### Task 5: Bridge entry point (billboard + nav link)

**Files:**
- Modify: `src/app/codex/codex-bridge.component.ts`

**Interfaces:**
- Consumes: `ShowroomService.entries` / `ShowroomService.load()` (for the live count),
  `RouterLink`.
- Produces: a Showroom nav link in the scanner row + a billboard section above the
  hero linking to `/codex/showroom`.

- [ ] **Step 1: Add the Showroom nav link to the scanner row**

In `codex-bridge.component.ts`, in the `.scanner-row`, add after the existing
`/codex/upcoming` link:

```html
<a class="index-link" routerLink="/codex/showroom">{{ 'codex.showroom.title' | translate }}</a>
```

- [ ] **Step 2: Inject ShowroomService and expose the livery count**

In the class body, add:

```ts
private readonly showroom = inject(ShowroomService);
readonly showroomLiveries = computed(() =>
  this.showroom.entries().reduce((n, e) => n + e.liveryCount, 0),
);
```
Add the import:
```ts
import { ShowroomService } from './showroom.service';
```
In `ngOnInit`, after `await this.svc.loadCurrentBuild();`, kick the discovery load
(non-blocking, drives the badge + billboard count):
```ts
void this.showroom.load();
```

- [ ] **Step 3: Add the billboard above the hero**

In the template, immediately after `<sc-extension-promo />`, add:

```html
<!-- Showroom billboard — the top-level entry to 3D liveries. Poster/text only,
     no live WebGL here (atmosphere-dose rule). Self-hides until coverage exists. -->
@if (showroomLiveries() > 0) {
  <a class="showroom-billboard" routerLink="/codex/showroom">
    <div class="sb-text">
      <span class="sb-eyebrow">{{ 'codex.showroom.billboard.eyebrow' | translate }}</span>
      <strong class="sb-title">{{ 'codex.showroom.billboard.title' | translate: { count: showroomLiveries() } }}</strong>
      <span class="sb-cta">{{ 'codex.showroom.billboard.cta' | translate }} →</span>
    </div>
  </a>
}
```

Add the billboard styles to the `styles` block:

```css
.showroom-billboard {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 22px; border-radius: 14px; text-decoration: none; color: inherit;
  border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
  background:
    radial-gradient(120% 140% at 90% 20%, color-mix(in srgb, var(--sc-accent) 22%, transparent), transparent 55%),
    var(--sc-bg-1);
  transition: border-color 0.16s, box-shadow 0.16s;
}
.showroom-billboard:hover { border-color: var(--sc-accent); box-shadow: 0 0 24px color-mix(in srgb, var(--sc-accent) 22%, transparent); }
.sb-text { display: flex; flex-direction: column; gap: 3px; }
.sb-eyebrow { font-family: var(--sc-font-display); font-size: 0.64rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent); }
.sb-title { font-size: 1.05rem; }
.sb-cta { font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--sc-accent); }
```

- [ ] **Step 4: Typecheck + test**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm test`
Expected: PASS (Bridge spec still green).

- [ ] **Step 5: Commit**

```bash
git add src/app/codex/codex-bridge.component.ts
git commit -m "feat(codex): Showroom billboard + nav link on the Bridge"
```

---

### Task 6: i18n — full `codex.showroom.*` block (DE + EN)

**Files:**
- Modify: `public/i18n/en.json`, `public/i18n/de.json`

**Interfaces:**
- Produces: all `codex.showroom.*` keys referenced by Tasks 3–5. (`codex.skins.holoReady`
  and `holoReadyShort` were added in Task 3.)

- [ ] **Step 1: Add the `showroom` block to `en.json`**

Inside the `codex` object of `public/i18n/en.json`, add a `showroom` key:

```json
"showroom": {
  "title": "Showroom",
  "subtitle": "Inspect real ship liveries in interactive 3D — datamined hull and textures from the current build.",
  "count": "{{liveries}} liveries in 3D across {{ships}} ship(s)",
  "spotlight": "Now in the Showroom",
  "gallery": "All liveries",
  "liveryCount": "{{count}} liveries",
  "billboard": {
    "eyebrow": "New",
    "title": "Rotate real ship liveries in 3D — {{count}} ready",
    "cta": "Enter the Showroom"
  },
  "empty": {
    "title": "No 3D liveries yet",
    "body": "3D liveries are extracted per game build and appear here as they land."
  }
}
```

- [ ] **Step 2: Add the matching German block to `de.json`**

Inside the `codex` object of `public/i18n/de.json`, add:

```json
"showroom": {
  "title": "Showroom",
  "subtitle": "Echte Schiffs-Lackierungen in interaktivem 3D betrachten — datamined Hülle und Texturen aus dem aktuellen Build.",
  "count": "{{liveries}} Lackierungen in 3D über {{ships}} Schiff(e)",
  "spotlight": "Jetzt im Showroom",
  "gallery": "Alle Lackierungen",
  "liveryCount": "{{count}} Lackierungen",
  "billboard": {
    "eyebrow": "Neu",
    "title": "Echte Schiffs-Lackierungen in 3D drehen — {{count}} verfügbar",
    "cta": "Zum Showroom"
  },
  "empty": {
    "title": "Noch keine 3D-Lackierungen",
    "body": "3D-Lackierungen werden pro Spiel-Build extrahiert und erscheinen hier, sobald sie vorliegen."
  }
}
```

- [ ] **Step 3: Validate both JSON files parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('public/i18n/de.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add public/i18n/en.json public/i18n/de.json
git commit -m "feat(codex): i18n for the Showroom (de/en)"
```

---

### Task 7: Verify in the browser (Light verification)

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server** via preview_start `{name: "web"}` (or the
  configured launch name) — never a raw `ng serve` in a shell.
- [ ] **Step 2: Navigate to `/codex/showroom`.** Confirm via read_page: the Showroom
  title, a spotlight for `Drake Cutlass Black`, a gallery card showing "7 liveries",
  and a poster image (not the icon fallback).
- [ ] **Step 3: Navigate to `/codex`.** Confirm the Showroom billboard renders with
  the livery count and the scanner-row Showroom link is present. Confirm a
  `sc-holo-ready-badge` "3D" glyph appears on the Cutlass lane card.
- [ ] **Step 4: read_console_messages** — no errors. **resize_window mobile** — the
  spotlight collapses to one column, grid reflows.
- [ ] **Step 5: Screenshot** the Showroom (desktop + mobile) and share as proof.

---

## Self-Review

**Spec coverage (P1 scope only):**
- Discovery view `ship_skins_index` → Task 1. ✓
- `ShowroomService` (list + badge probe) → Task 2. ✓
- S1 Showroom route/gallery + spotlight → Task 4. ✓ *(P1 delivers spotlight + gallery;
  the "newly modeled" and "coming soon" rails are folded into the newest-first gallery
  ordering for P1 and split out as dedicated rails in a P1.1/P2 follow-up — noted so
  the omission is conscious, not a gap.)*
- S2 Bridge billboard + nav link → Task 5. ✓
- S3 Holo-Ready badge → Task 3. ✓
- U3 poster fallback (icon → ship preview → null) → Task 4 `toCards`. ✓
- i18n de+en → Task 6. ✓
- Light verification → Task 7. ✓
- Out of P1 by design: viewer v2 (P2), photo/share/favorite (P3), uploader U1/U2
  (separate track). Not gaps.

**Placeholder scan:** none — every code step contains complete code; commands have
expected output.

**Type consistency:** `ShowroomEntry` (Task 2) is consumed unchanged in Task 4
(`toCards(entries: ShowroomEntry[])`). `ShowroomService.list()`, `.load()`,
`.entries`, `.modelShipIds` names match across Tasks 2/3/5. `getShipsByClassNames`,
`previewUrl`, `pickLocalized`, `toLang`, `cleanLocaleValue`, `humanizeClassName`,
`CodexListRow`, `previewImage`/`name` payload shapes all match their real signatures
in `codex.service.ts` / `codex-format.ts` / `codex-bridge.component.ts`.

**One deferred technical question (P2, not P1):** whether `<model-viewer>` can hot-swap
textures on already-loaded geometry (true instant filmstrip) or must reload per glb —
resolved in the P2 plan; does not affect P1.
