import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  BlueprintListFilters,
  CodexListRow,
  CodexService,
  pickLocalized,
} from './codex.service';
import {
  cleanLocaleValue,
  formatCraftTime,
  humanizeBlueprintCategory,
  humanizeBlueprintName,
} from './codex-format';
import { BlueprintPayload } from './codex.types';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

@Component({
  selector: 'sc-blueprint-list',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="blueprint-page">
      <header class="head">
        <div class="title-block">
          <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>
          <h1>{{ 'blueprint.title' | translate }}</h1>
          <p class="hint">{{ 'blueprint.subtitle' | translate }}</p>
        </div>
        @if (svc.build(); as b) {
          <div class="provenance">
            <span class="prov-label">{{ 'codex.provenance.label' | translate }}</span>
            <strong>{{ 'codex.provenance.build' | translate: { channel: b.channel, patch: b.patchVersion, build: b.buildNumber } }}</strong>
          </div>
        }
      </header>

      <!-- Search + filters -->
      <div class="controls sc-card">
        <div class="search-row">
          <input class="search" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearchInput($event)"
                 [attr.aria-label]="'blueprint.search.label' | translate"
                 [attr.placeholder]="'blueprint.search.placeholder' | translate" />
          @if (searchInput()) {
            <button class="search-clear" type="button" (click)="clearSearch()"
                    [attr.aria-label]="'codex.search.clear' | translate">×</button>
          }
        </div>
        <div class="facets">
          @if (categories().length > 0) {
            <label class="facet">
              <span>{{ 'blueprint.filters.category' | translate }}</span>
              <select class="sc-select" [ngModel]="category()" (ngModelChange)="setCategory($event)">
                <option value="">{{ 'codex.filters.all' | translate }}</option>
                @for (c of categories(); track c) {
                  <option [value]="c">{{ categoryLabel(c) }}</option>
                }
              </select>
            </label>
          }
          @if (hasActiveFilters()) {
            <button class="reset" type="button" (click)="resetFilters()">
              {{ 'codex.filters.reset' | translate }}
            </button>
          }
        </div>
      </div>

      <!-- Results -->
      @if (error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}
          <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else {
        <div class="result-head">
          <span class="count">
            {{ (total() === 1 ? 'codex.results.countOne' : 'codex.results.count') | translate: { count: total() } }}
          </span>
          @if (rows().length < total()) {
            <span class="showing">{{ 'codex.results.showingOf' | translate: { shown: rows().length, total: total() } }}</span>
          }
        </div>

        @if (loading() && rows().length === 0) {
          <div class="grid">
            @for (s of skeletons; track s) { <div class="card skel"></div> }
          </div>
        } @else if (rows().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ (hasActiveFilters() || searchInput() ? 'codex.empty.filtered' : 'blueprint.empty') | translate }}</p>
          </div>
        } @else {
          <div class="grid">
            @for (r of rows(); track r.classNameSlug) {
              <a class="card" [routerLink]="['/codex/blueprint', r.classNameSlug]">
                <div class="card-top">
                  <h3 class="name">{{ cardName(r) }}</h3>
                </div>
                <code class="cls">{{ r.classNameSlug }}</code>
                <div class="badges">
                  @if (r.blueprintCategory) {
                    <span class="badge cat">{{ categoryLabel(r.blueprintCategory) }}</span>
                  }
                  @if (r.blueprintTier != null) {
                    <span class="badge">{{ 'blueprint.card.tier' | translate: { tier: r.blueprintTier } }}</span>
                  }
                  @if (craftTimeLabel(r); as ct) {
                    <span class="badge subtle">{{ ct }}</span>
                  }
                </div>
              </a>
            }
          </div>

          @if (rows().length < total()) {
            <div class="more-row">
              <button type="button" class="load-more" [disabled]="loading()" (click)="loadMore()">
                {{ (loading() ? 'codex.results.loading' : 'codex.results.loadMore') | translate }}
              </button>
            </div>
          }
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .blueprint-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }

    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; }
    .back:hover { color: var(--sc-accent); }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .title-block { display: flex; flex-direction: column; gap: 4px; }
    .title-block h1 { margin: 4px 0 0; }
    .title-block .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 60ch; }

    .provenance {
      display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
      padding: 8px 14px; border-radius: 8px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .provenance .prov-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .provenance strong { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.04em; color: var(--sc-accent); }

    .controls { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }
    .search-row { position: relative; display: flex; }
    .search {
      flex: 1; padding: 10px 36px 10px 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.92rem;
    }
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.22); }
    .search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.3rem; cursor: pointer; }
    .search-clear:hover { color: var(--sc-danger); }

    .facets { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .facet { display: flex; flex-direction: column; gap: 4px; }
    .facet > span { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; min-width: 160px; }
    .sc-select:focus { outline: none; border-color: var(--sc-accent); }
    .reset { align-self: center; padding: 7px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.76rem; cursor: pointer; }
    .reset:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .result-head { display: flex; align-items: baseline; gap: 12px; }
    .count { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.06em; color: var(--sc-accent); text-transform: uppercase; }
    .showing { font-size: 0.74rem; color: var(--sc-fg-2); }

    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 14px; border-radius: 8px; min-height: 100px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: inherit; text-decoration: none;
      transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
    }
    .card:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 28%, transparent); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card .name { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
    .card .cls { font-size: 0.72rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); word-break: break-all; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .badge { font-size: 0.66rem; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.cat { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }

    .card.skel { min-height: 100px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .more-row { display: flex; justify-content: center; }
    .load-more { padding: 10px 24px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .load-more:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .load-more:disabled { opacity: 0.6; cursor: progress; }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
      .provenance { align-items: flex-start; }
    }
  `],
})
export class BlueprintListComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);

  /**
   * Facet buckets from the build itself. This used to be a hardcoded snake_case
   * list (`ship_components`, `fps_weapons`, …) that matched nothing the
   * extractor writes (CIG emits `FPSArmours`, `VehicleComponentS1`, …), so
   * every filter pick returned zero rows and every badge leaked its i18n key.
   */
  readonly categories = signal<string[]>([]);
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  readonly searchInput = signal('');
  private readonly searchTerm = signal('');
  readonly category = signal('');

  readonly rows = signal<CodexListRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private offset = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  readonly hasActiveFilters = computed(() => !!this.category());

  constructor() {
    effect(() => {
      this.searchTerm();
      this.category();
      this.runQuery(true);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.svc.loadCurrentBuild();
    try {
      this.categories.set(await this.svc.blueprintCategories());
    } catch {
      // Advisory facet — a failure hides the filter, it never breaks the list.
      this.categories.set([]);
    }
  }

  /** Translated bucket label, humanized fallback for buckets we have no key for. */
  categoryLabel(c: string): string {
    const key = `blueprint.category.${c}`;
    const translated = this.t.instant(key);
    return translated && translated !== key ? translated : humanizeBlueprintCategory(c);
  }

  cardName(r: CodexListRow): string {
    const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return en || cleanLocaleValue(r.nameLocalized) || humanizeBlueprintName(r.classNameSlug);
  }

  craftTimeLabel(r: CodexListRow): string | null {
    return formatCraftTime(r.craftTimeSec);
  }

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.searchTerm.set(value), SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    this.searchInput.set('');
    this.searchTerm.set('');
  }

  setCategory(v: string): void { this.category.set(v); }

  resetFilters(): void {
    this.category.set('');
  }

  reload(): void { this.runQuery(true); }

  loadMore(): void {
    this.offset += PAGE_SIZE;
    this.runQuery(false);
  }

  private buildFilters(): BlueprintListFilters {
    return {
      search: this.searchTerm() || undefined,
      category: this.category() || undefined,
      limit: PAGE_SIZE,
      offset: this.offset,
    };
  }

  private async runQuery(reset: boolean): Promise<void> {
    if (reset) this.offset = 0;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.svc.listBlueprints(this.buildFilters());
      if (seq !== this.loadSeq) return;
      this.rows.set(reset ? res.rows : [...this.rows(), ...res.rows]);
      this.total.set(res.count);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
      if (reset) {
        this.rows.set([]);
        this.total.set(0);
      }
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }
}
