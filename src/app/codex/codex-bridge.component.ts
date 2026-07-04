import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexListRow, CodexService, pickLocalized, toLang } from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { HangarService } from '../hangar/hangar.service';

const SEARCH_DEBOUNCE_MS = 250;
const LANE_SIZE = 18;

// "Popular to compare" — a small curated set of well-known ship classNames.
// Kept honest: these are only SHOWN if the current build actually holds them
// (missing ones are silently skipped; the lane hides if none resolve). No
// synthetic rows — every card here is a real catalog row.
const POPULAR_CLASSNAMES: readonly string[] = [
  'AEGS_Gladius',
  'ANVL_Arrow',
  'ORIG_300i',
  'DRAK_Cutlass_Black',
  'MISC_Freelancer',
  'RSI_Constellation_Andromeda',
  'AEGS_Avenger_Titan',
  'CNOU_Mustang_Alpha',
  'ANVL_Carrack',
  'MISC_Prospector',
  'AEGS_Vanguard_Warden',
  'RSI_Aurora_MR',
];

interface Lane {
  id: string;
  titleKey: string;
  subtitleKey: string;
  rows: CodexListRow[];
}

/**
 * "The Bridge" — the Codex landing (Slice 1 of the Codex rethink). Replaces the
 * filter-list front door with: a prominent Scanner (fast debounced search),
 * ONE focal hero (first hangar ship, else a featured catalog ship), and
 * horizontal, scannable lanes (Your Hangar · Fresh this patch · Popular to
 * compare · Explore by role). The full facet filter-list survives verbatim as
 * the opt-in Index mode (routerLink /codex/index).
 *
 * No schema/data change: reuses CodexService (list/detail/previewUrl/compare)
 * and HangarService only. Atmosphere-dose rules apply — transitions < 300ms,
 * prefers-reduced-motion safe, 2D WebP renders only (NO 3D). Route stays gated.
 */
@Component({
  selector: 'sc-codex-bridge',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    TranslateModule,
    CodexCompareTrayComponent,
    CodexCategoryIconComponent,
    CodexStatusBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bridge">
      <!-- Scanner: the always-present fast path -->
      <div class="scanner">
        <div class="scanner-row">
          <span class="scanner-icon" aria-hidden="true">⌕</span>
          <input class="scanner-input" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearchInput($event)"
                 (keydown.enter)="openFirstResult()"
                 [attr.aria-label]="'codex.search.label' | translate"
                 [attr.placeholder]="'codex.bridge.scannerPlaceholder' | translate" />
          @if (searchInput()) {
            <button class="scanner-clear" type="button" (click)="clearSearch()"
                    [attr.aria-label]="'codex.search.clear' | translate">×</button>
          }
          <a class="index-link" routerLink="/codex/index">{{ 'codex.bridge.indexMode' | translate }}</a>
        </div>
        <sc-codex-status-banner />
      </div>

      @if (error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}
          <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      }

      <!-- Scanner mode: search results replace hero + lanes while typing -->
      @if (searchTerm()) {
        <div class="results-head">
          <span class="count">{{ 'codex.bridge.scannerResults' | translate: { term: searchTerm() } }}</span>
        </div>
        @if (searching()) {
          <div class="lane-track">
            @for (s of skeletons; track s) { <div class="lane-card skel"></div> }
          </div>
        } @else if (searchResults().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ 'codex.empty.filtered' | translate }}</p>
          </div>
        } @else {
          <div class="lane-track">
            @for (r of searchResults(); track r.classNameSlug) {
              <ng-container [ngTemplateOutlet]="laneCard" [ngTemplateOutletContext]="{ $implicit: r }" />
            }
          </div>
        }
      } @else {
        <!-- One focal hero -->
        @if (hero(); as h) {
          <article class="hero" [class.is-hangar]="heroFromHangar()">
            <div class="hero-art" [class.icon-only]="!heroThumb()">
              @if (heroThumb(); as src) {
                <img [src]="src" [alt]="rowName(h)" (error)="onHeroThumbError()" />
              } @else {
                <sc-codex-icon kind="ship" />
              }
            </div>
            <div class="hero-body">
              @if (heroFromHangar()) {
                <span class="hero-eyebrow hangar">{{ 'codex.bridge.hero.fromHangar' | translate }}</span>
              } @else {
                <span class="hero-eyebrow">{{ 'codex.bridge.hero.featured' | translate }}</span>
              }
              <h1 class="hero-name">{{ rowName(h) }}</h1>
              @if (h.manufacturerCode) {
                <p class="hero-mfr">{{ h.manufacturerCode }}</p>
              }
              <div class="hero-stats">
                @if (heroHeadline(); as stat) {
                  <div class="hero-stat">
                    <span class="stat-label">{{ stat.labelKey | translate }}</span>
                    <span class="stat-value">{{ stat.value }}</span>
                  </div>
                }
                @if (freshness(); as fresh) {
                  <div class="hero-fresh" [attr.title]="'codex.provenance.tooltip' | translate">
                    <span class="fresh-dot" aria-hidden="true"></span>
                    <span>{{ fresh }}</span>
                  </div>
                }
              </div>
              <div class="hero-actions">
                <a class="btn primary" [routerLink]="['/codex', 'ship', h.classNameSlug]">
                  {{ 'codex.bridge.hero.open' | translate }}
                </a>
                <button type="button" class="btn ghost" [class.pinned]="isPinned(h.classNameSlug)"
                        (click)="togglePin(h.classNameSlug)">
                  {{ (isPinned(h.classNameSlug) ? 'codex.compare.pinned' : 'codex.bridge.addCompare') | translate }}
                </button>
              </div>
            </div>
          </article>
        } @else if (loading()) {
          <div class="hero skel-hero"></div>
        }

        <!-- Lanes -->
        @for (lane of lanes(); track lane.id) {
          <section class="lane">
            <header class="lane-head">
              <h2>{{ lane.titleKey | translate }}</h2>
              <span class="lane-sub">{{ lane.subtitleKey | translate }}</span>
            </header>
            <div class="lane-track">
              @for (r of lane.rows; track r.classNameSlug) {
                <ng-container [ngTemplateOutlet]="laneCard" [ngTemplateOutletContext]="{ $implicit: r }" />
              }
            </div>
          </section>
        }

        @if (!loading() && lanes().length === 0 && !hero()) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ 'codex.empty.noBuild' | translate }}</p>
          </div>
        }
      }

      <!-- Reusable lane / result card -->
      <ng-template #laneCard let-r>
        <a class="lane-card" [routerLink]="['/codex', 'ship', r.classNameSlug]">
          <div class="lane-thumb" [class.icon-only]="!thumb(r)">
            @if (thumb(r); as src) {
              <img [src]="src" [alt]="rowName(r)" loading="lazy" (error)="onThumbError(r)" />
            } @else {
              <sc-codex-icon kind="ship" />
            }
          </div>
          <div class="lane-info">
            <h3 class="lane-name">{{ rowName(r) }}</h3>
            @if (r.manufacturerCode) { <span class="lane-mfr">{{ r.manufacturerCode }}</span> }
          </div>
          <div class="lane-actions">
            @if (inHangarSet().has(r.classNameSlug)) {
              <span class="in-hangar" [attr.title]="'codex.card.inHangar' | translate">✓</span>
            } @else {
              <button type="button" class="chip-btn" (click)="addToHangar($event, r.classNameSlug)"
                      [attr.aria-label]="'quickSearch.addToHangar' | translate"
                      [attr.title]="'quickSearch.addToHangar' | translate">＋⌂</button>
            }
            <button type="button" class="chip-btn compare" [class.pinned]="isPinned(r.classNameSlug)"
                    (click)="togglePin($event, r.classNameSlug)"
                    [attr.aria-label]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.bridge.addCompare') | translate"
                    [attr.title]="(isPinned(r.classNameSlug) ? 'codex.compare.pinned' : 'codex.bridge.addCompare') | translate">
              {{ isPinned(r.classNameSlug) ? '★' : '☆' }}
            </button>
          </div>
        </a>
      </ng-template>

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .bridge { display: flex; flex-direction: column; gap: 24px; padding-bottom: 90px; }

    /* Scanner */
    .scanner { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .scanner-row { position: relative; display: flex; align-items: center; gap: 8px; flex: 1 1 320px; }
    .scanner-icon { position: absolute; left: 14px; color: var(--sc-accent); font-size: 1.1rem; pointer-events: none; }
    .scanner-input {
      flex: 1; padding: 13px 40px 13px 40px; border-radius: 10px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 1rem;
    }
    .scanner-input:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.22); }
    .scanner-clear { position: absolute; right: 96px; border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.4rem; cursor: pointer; line-height: 1; }
    .scanner-clear:hover { color: var(--sc-danger); }
    .index-link {
      position: absolute; right: 10px; padding: 6px 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 34%, transparent);
      color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.7rem; letter-spacing: 0.05em;
      text-transform: uppercase; text-decoration: none; white-space: nowrap;
    }
    .index-link:hover { background: color-mix(in srgb, var(--sc-accent) 22%, transparent); }

    /* Hero */
    .hero {
      display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 4px;
      border-radius: 16px; overflow: hidden; min-height: 300px;
      border: 1px solid var(--sc-border);
      background:
        radial-gradient(120% 80% at 78% 30%, color-mix(in srgb, var(--sc-accent) 12%, transparent), transparent 60%),
        var(--sc-bg-1);
    }
    .hero.is-hangar { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); box-shadow: 0 0 30px color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .hero-art { display: flex; align-items: center; justify-content: center; padding: 24px;
      background: radial-gradient(circle at 45% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .hero-art img { max-width: 100%; max-height: 340px; object-fit: contain; filter: drop-shadow(0 8px 26px rgba(0,0,0,0.6)); }
    .hero-art.icon-only sc-codex-icon { width: 60%; height: 60%; }
    .hero-body { display: flex; flex-direction: column; gap: 8px; padding: 28px 30px; justify-content: center; }
    .hero-eyebrow { font-family: var(--sc-font-display); font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2); }
    .hero-eyebrow.hangar { color: var(--sc-accent); }
    .hero-name { margin: 0; font-size: clamp(1.6rem, 3vw, 2.4rem); line-height: 1.1; }
    .hero-mfr { margin: 0; color: var(--sc-fg-1); font-family: var(--sc-font-display); letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.8rem; }
    .hero-stats { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; margin: 10px 0 4px; }
    .hero-stat { display: flex; flex-direction: column; gap: 2px; }
    .stat-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .stat-value { font-family: var(--sc-font-display); font-size: 1.5rem; color: var(--sc-fg-0); }
    .hero-fresh { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-success, #5fd698) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-success, #5fd698) 34%, transparent);
      color: var(--sc-fg-1); font-size: 0.74rem; }
    .fresh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-success, #5fd698); box-shadow: 0 0 8px var(--sc-success, #5fd698); }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .btn { padding: 11px 22px; border-radius: 9px; font-family: var(--sc-font-display); font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
    .btn.primary { background: var(--sc-accent); color: var(--sc-bg-0); }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn.ghost { background: transparent; border-color: var(--sc-accent); color: var(--sc-accent); }
    .btn.ghost:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .btn.ghost.pinned { background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }

    /* Lanes */
    .lane { display: flex; flex-direction: column; gap: 12px; }
    .lane-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .lane-head h2 { margin: 0; font-size: 1.05rem; }
    .lane-sub { color: var(--sc-fg-2); font-size: 0.76rem; }
    .results-head { display: flex; align-items: baseline; }
    .count { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.06em; color: var(--sc-accent); text-transform: uppercase; }
    .lane-track {
      display: grid; grid-auto-flow: column; grid-auto-columns: 216px; gap: 12px;
      overflow-x: auto; scroll-snap-type: x proximity; padding: 4px 2px 10px;
      scrollbar-width: thin;
    }
    .lane-track::-webkit-scrollbar { height: 8px; }
    .lane-track::-webkit-scrollbar-thumb { background: var(--sc-border); border-radius: 999px; }

    .lane-card {
      scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px;
      padding: 12px; border-radius: 10px; border: 1px solid var(--sc-border);
      background: var(--sc-bg-1); color: inherit; text-decoration: none;
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
    }
    .lane-card:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 26%, transparent); }
    .lane-thumb { height: 108px; display: flex; align-items: center; justify-content: center; border-radius: 8px;
      background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); }
    .lane-thumb img { max-height: 100px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .lane-thumb.icon-only sc-codex-icon { width: 100%; height: 100%; }
    .lane-info { display: flex; flex-direction: column; gap: 2px; min-height: 40px; }
    .lane-name { margin: 0; font-size: 0.9rem; font-weight: 600; line-height: 1.2; }
    .lane-mfr { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .lane-actions { display: flex; align-items: center; gap: 8px; margin-top: auto; }
    .chip-btn { border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-2);
      font-size: 0.82rem; line-height: 1; min-width: 30px; height: 26px; border-radius: 7px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; }
    .chip-btn:hover { color: var(--sc-success, #5fd698); border-color: var(--sc-success, #5fd698); }
    .chip-btn.compare:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .chip-btn.compare.pinned { color: var(--sc-accent); border-color: var(--sc-accent); }
    .in-hangar { font-size: 0.92rem; color: var(--sc-success, #5fd698); line-height: 1; padding: 0 4px; }

    /* Skeletons */
    .skel, .skel-hero { background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    .lane-card.skel { min-height: 200px; }
    .skel-hero { min-height: 300px; border-radius: 16px; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .hero-art { padding: 18px; }
      .hero-art img { max-height: 220px; }
      .hero-body { padding: 20px 22px; }
      .scanner-clear { right: 108px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .lane-card, .btn.primary { transition: none; }
      .lane-track { scroll-behavior: auto; }
      .skel, .skel-hero { animation: none; }
    }
  `],
})
export class CodexBridgeComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  private readonly router = inject(Router);

  readonly skeletons = Array.from({ length: 6 }, (_, i) => i);

  // Scanner state (mirrors the Index list's debounced search contract).
  readonly searchInput = signal('');
  readonly searchTerm = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<CodexListRow[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Ship catalog rows for the current build (lane + hero source).
  private readonly catalog = signal<CodexListRow[]>([]);
  // Hangar ship catalog rows, keyed in hangar order (Your Hangar lane + hero).
  private readonly hangarRows = signal<CodexListRow[]>([]);
  private readonly popularRows = signal<CodexListRow[]>([]);
  private readonly heroThumbBroken = signal(false);
  private readonly brokenThumbs = signal<ReadonlySet<string>>(new Set<string>());

  // Class names already in the hangar — read-overlay over hangar.ships().
  readonly inHangarSet = computed(() => new Set(this.hangar.ships().map((s) => s.shipClassName)));

  /** Hero = first hangar ship (resolved to a catalog row), else featured. */
  readonly heroFromHangar = computed(() => this.hangarRows().length > 0);
  readonly hero = computed<CodexListRow | null>(() => {
    const fromHangar = this.hangarRows()[0];
    if (fromHangar) return fromHangar;
    return this.catalog()[0] ?? null;
  });

  // Your Hangar lane (hide if empty) — hangar ships beyond the hero too.
  readonly lanes = computed<Lane[]>(() => {
    const out: Lane[] = [];
    const hangar = this.hangarRows();
    if (hangar.length > 0) {
      out.push({
        id: 'hangar',
        titleKey: 'codex.bridge.lanes.hangar',
        subtitleKey: 'codex.bridge.lanes.hangarSub',
        rows: hangar,
      });
    }
    const fresh = this.catalog();
    if (fresh.length > 0) {
      out.push({
        id: 'fresh',
        titleKey: 'codex.bridge.lanes.fresh',
        subtitleKey: 'codex.bridge.lanes.freshSub',
        rows: fresh.slice(0, LANE_SIZE),
      });
    }
    const popular = this.popularRows();
    if (popular.length > 0) {
      out.push({
        id: 'popular',
        titleKey: 'codex.bridge.lanes.popular',
        subtitleKey: 'codex.bridge.lanes.popularSub',
        rows: popular,
      });
    }
    for (const group of this.roleGroups()) {
      out.push({
        id: 'role-' + group.key,
        titleKey: 'codex.bridge.lanes.role',
        subtitleKey: 'codex.bridge.lanes.roleSub',
        rows: group.rows,
      });
    }
    return out;
  });

  /**
   * "Explore by role" — group catalog ships. `role` is a raw localization key
   * (often unresolved) so it is unreliable; we group by manufacturer code as the
   * honest, always-present shaping dimension (per the brief's "else by
   * manufacturer" fallback). Largest groups first; only groups with ≥2 ships.
   */
  private readonly roleGroups = computed(() => {
    const byMfr = new Map<string, CodexListRow[]>();
    for (const r of this.catalog()) {
      const key = r.manufacturerCode || '—';
      const arr = byMfr.get(key) ?? [];
      arr.push(r);
      byMfr.set(key, arr);
    }
    return Array.from(byMfr.entries())
      .filter(([k, rows]) => k !== '—' && rows.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([key, rows]) => ({ key, rows: rows.slice(0, LANE_SIZE) }));
  });

  constructor() {
    // Debounced scanner search over ship name + className (reuses the service's
    // trigram-backed .or(ilike) contract). Empty term clears results.
    effect(() => {
      const term = this.searchTerm().trim();
      if (!term) {
        this.searchResults.set([]);
        this.searching.set(false);
        return;
      }
      void this.runSearch(term);
    });
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.svc.loadCurrentBuild();
      if (this.hangar.ships().length === 0) await this.hangar.loadAll();
      const [catalog, popular] = await Promise.all([
        this.svc.listBridgeShips(60),
        this.svc.getShipsByClassNames([...POPULAR_CLASSNAMES]),
      ]);
      this.catalog.set(catalog);
      // Keep the curated order for the popular lane (only ships present in build).
      this.popularRows.set(
        POPULAR_CLASSNAMES.map((cn) => popular.get(cn)).filter((r): r is CodexListRow => !!r),
      );
      await this.resolveHangarRows();
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve the user's hangar ship classNames to catalog rows, in hangar order. */
  private async resolveHangarRows(): Promise<void> {
    const classNames = this.hangar.ships().map((s) => s.shipClassName);
    if (classNames.length === 0) {
      this.hangarRows.set([]);
      return;
    }
    const map = await this.svc.getShipsByClassNames(classNames);
    // Preserve hangar order; drop names not present in the current build.
    this.hangarRows.set(
      classNames.map((cn) => map.get(cn)).filter((r): r is CodexListRow => !!r),
    );
  }

  reload(): void {
    void this.ngOnInit();
  }

  // ── scanner ──────────────────────────────────────────────────────────────
  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.searchTerm.set(value), SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    this.searchInput.set('');
    this.searchTerm.set('');
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const res = await this.svc.listByKind('ship', { search: term, limit: LANE_SIZE });
      if (seq !== this.searchSeq) return;
      this.searchResults.set(res.rows);
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  /** Enter in the scanner opens the first result (fast keyboard path). */
  openFirstResult(): void {
    const first = this.searchResults()[0];
    if (first) void this.router.navigate(['/codex', 'ship', first.classNameSlug]);
  }

  // ── card helpers (shared hero + lanes) ─────────────────────────────────────
  rowName(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const localized = p?.name ? pickLocalized(p.name, toLang(this.t.currentLang)) : '';
    return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  thumb(r: CodexListRow): string | null {
    if (this.brokenThumbs().has(r.classNameSlug)) return null;
    const p = r.payload as { previewImage?: string | null } | undefined;
    return this.svc.previewUrl(p?.previewImage);
  }

  onThumbError(r: CodexListRow): void {
    const next = new Set(this.brokenThumbs());
    next.add(r.classNameSlug);
    this.brokenThumbs.set(next);
  }

  readonly heroThumb = computed<string | null>(() => {
    if (this.heroThumbBroken()) return null;
    const h = this.hero();
    if (!h) return null;
    const p = h.payload as { previewImage?: string | null } | undefined;
    return this.svc.previewUrl(p?.previewImage);
  });

  onHeroThumbError(): void {
    this.heroThumbBroken.set(true);
  }

  /** ONE headline stat for the hero: crew, else SCM speed if present. */
  readonly heroHeadline = computed<{ labelKey: string; value: string } | null>(() => {
    const h = this.hero();
    if (!h) return null;
    if (h.crewSize != null && h.crewSize > 0) {
      return { labelKey: 'codex.detail.crew', value: String(h.crewSize) };
    }
    const flight = (h.payload as { flight?: { scmSpeed?: number | null } } | undefined)?.flight;
    if (flight?.scmSpeed != null && flight.scmSpeed > 0) {
      return { labelKey: 'codex.detail.speed', value: `${Math.round(flight.scmSpeed)} m/s` };
    }
    return null;
  });

  /** Freshness badge from the current build (patch + build number). */
  readonly freshness = computed<string | null>(() => {
    const b = this.svc.build();
    if (!b) return null;
    return this.t.instant('codex.bridge.hero.freshness', {
      patch: b.patchVersion,
      build: b.buildNumber,
    });
  });

  // ── compare + hangar ───────────────────────────────────────────────────────
  isPinned(className: string): boolean {
    return this.svc.isPinned('ship', className);
  }

  togglePin(evOrClass: Event | string, className?: string): void {
    if (typeof evOrClass === 'string') {
      this.svc.togglePin('ship', evOrClass);
      return;
    }
    evOrClass.preventDefault();
    evOrClass.stopPropagation();
    if (className) this.svc.togglePin('ship', className);
  }

  addToHangar(ev: Event, className: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    void this.hangar.addShip(className, 'owned').then(() => void this.resolveHangarRows());
  }
}
