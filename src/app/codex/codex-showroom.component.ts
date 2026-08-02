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
    .sp-eyebrow { font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent); }
    .sp-body h2 { margin: 0; font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.1; }
    .sp-mfr { margin: 0; color: var(--sc-fg-1); text-transform: uppercase; letter-spacing: 0.08em; font-size: max(0.78rem, var(--sc-fs-floor)); }
    .sp-meta { margin: 4px 0; color: var(--sc-fg-2); font-size: 0.84rem; }
    .btn.primary { width: fit-content; margin-top: 8px; padding: 10px 20px; border-radius: 9px; background: var(--sc-accent); color: var(--sc-bg-0); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase; }

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
    .sr-mfr { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .sr-liveries { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-accent); }

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
