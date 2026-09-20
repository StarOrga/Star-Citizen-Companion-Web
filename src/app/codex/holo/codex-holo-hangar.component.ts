// Holotable hangar tab (concept 2026-09-20, iterations 3/5/6, wave2 scope B).
// A golden (`--sc-accent`, never `--sc-accent-hot` — a plain viewer reaches
// their own hangar) tab docked on the table's top edge. Opens a FIXED
// 236px-tall overlay with NO scrollbars: search is always visible and full
// width; more ships than fit the fixed height are grouped by Einsatz
// (mission role of their active config) with counts, a group expands (i.e.
// filters the same fixed area to just that group) instead of growing it.
// "Hangar-Halle" opens a fullscreen grid of the same tile. Loadout variants
// show only a time hint or "verwaltet von <owner>" — never a source
// (concept hv3-s2 / hv-s4). Signed-out users see only the login hint.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShip, HangarShipConfig, ShipConfigRole, loadoutVariantHint } from '../../hangar/hangar.types';
import { relativeDayBucket } from '../../core/locale/date-format';
import { CodexService } from '../codex.service';
import { HoloSilhouette } from '../holo-silhouette';

/** Above this many ships the flat tile grid is replaced by role groups —
 * chosen so the fixed 236px overlay never needs to scroll on a typical
 * laptop width (chosen attribute, documented in the wave2 handoff). */
const GROUP_THRESHOLD = 8;

interface HangarTile {
  ship: HangarShip;
  silhouette: HoloSilhouette | null;
  role: ShipConfigRole | null;
  variantHintKey: string | null;
  variantHintParams: Record<string, string> | null;
  variantCount: number;
}

@Component({
  selector: 'sc-codex-holo-hangar',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-hangar">
      <button
        type="button"
        class="hh-tab"
        [class.open]="open()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
        [title]="'codex.holo.hangar.tab' | translate"
        (click)="toggleOpen()"
      >
        {{ 'codex.holo.hangar.tab' | translate }}
      </button>

      @if (open()) {
        <div class="hh-overlay" [id]="panelId">
          @if (!signedIn()) {
            <p class="signin-hint">
              <a routerLink="/login" [queryParams]="{ redirect: currentPath }">{{ 'codex.holo.hangar.signInHint' | translate }}</a>
            </p>
          } @else {
            <input
              class="hh-search"
              type="search"
              [attr.aria-label]="'codex.holo.hangar.search' | translate"
              [placeholder]="'codex.holo.hangar.search' | translate"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />

            <div class="hh-body">
              @if (filteredTiles().length === 0) {
                <p class="empty">{{ 'codex.holo.hangar.empty' | translate }}</p>
              } @else if (!groupBy() || activeGroup() !== null) {
                <div class="hh-grid">
                  @for (t of visibleTiles(); track t.ship.id) {
                    <a class="hh-tile" [routerLink]="['/codex', 'ship', t.ship.shipClassName]">
                      <span class="thumb">
                        @if (t.silhouette; as s) {
                          <svg [attr.viewBox]="s.viewBox" aria-hidden="true"><path [attr.d]="s.path" /></svg>
                        } @else {
                          <span class="ring" [attr.title]="'codex.holo.hangar.noGeometry' | translate" aria-hidden="true"></span>
                        }
                      </span>
                      <span class="name">{{ t.ship.customName ?? t.ship.shipClassName }}</span>
                      @if (t.variantHintKey; as key) {
                        <span class="variant">{{ key | translate: t.variantHintParams }}</span>
                      }
                      @if (t.variantCount > 1) {
                        <span class="variant-count">{{ 'codex.holo.hangar.variants' | translate: { n: t.variantCount } }}</span>
                      }
                    </a>
                  }
                </div>
                @if (groupBy()) {
                  <button type="button" class="hh-back" (click)="activeGroup.set(null)">←</button>
                }
              } @else {
                <div class="hh-groups">
                  @for (grp of groups(); track grp.role) {
                    <button type="button" class="hh-group" (click)="activeGroup.set(grp.role)">
                      {{ (grp.role ? 'hangar.roles.' + grp.role : 'codex.holo.hangar.unassigned') | translate }}
                      <span class="count">{{ grp.tiles.length }}</span>
                    </button>
                  }
                </div>
              }
            </div>

            <button type="button" class="hh-hall" (click)="hallOpen.set(true)">
              {{ 'codex.holo.hangar.hall' | translate }}
            </button>
          }
        </div>
      }

      @if (hallOpen()) {
        <div class="hh-hall-full" role="dialog" [attr.aria-label]="'codex.holo.hangar.hallTitle' | translate">
          <div class="hh-hall-head">
            <h2>{{ 'codex.holo.hangar.hallTitle' | translate }}</h2>
            <button type="button" (click)="hallOpen.set(false)">{{ 'codex.holo.hangar.close' | translate }}</button>
          </div>
          <div class="hh-grid hall">
            @for (t of tiles(); track t.ship.id) {
              <a class="hh-tile" [routerLink]="['/codex', 'ship', t.ship.shipClassName]">
                <span class="thumb">
                  @if (t.silhouette; as s) {
                    <svg [attr.viewBox]="s.viewBox" aria-hidden="true"><path [attr.d]="s.path" /></svg>
                  } @else {
                    <span class="ring" aria-hidden="true"></span>
                  }
                </span>
                <span class="name">{{ t.ship.customName ?? t.ship.shipClassName }}</span>
              </a>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      /* The host places this at the table's top edge, absolutely positioned
         (see the wave2 handoff's contract D) — this component only supplies
         its own box, never the outer placement. */
      .holo-hangar { position: relative; display: flex; justify-content: center; }
      .hh-tab {
        border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
        border-radius: 0 0 6px 6px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 20%, var(--sc-bg-2)), var(--sc-bg-1));
        color: var(--sc-accent);
        padding: 4px 16px;
        min-block-size: var(--sc-tap-min);
        font-size: max(11px, var(--sc-fs-floor));
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .hh-tab.open { background: color-mix(in srgb, var(--sc-accent) 30%, var(--sc-bg-2)); }
      .hh-overlay {
        position: absolute;
        inset-block-start: 100%;
        inset-inline: 10%;
        block-size: 236px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 14px;
        background: var(--sc-bg-1);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, var(--sc-bg-0));
        border-radius: 6px;
        box-shadow: 0 18px 40px rgb(0 0 0 / 0.6);
        z-index: 16;
      }
      .hh-search { inline-size: 100%; min-block-size: var(--sc-tap-min); padding: 6px 10px;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); border-radius: 4px; color: var(--sc-fg-0); }
      .hh-body { flex: 1 1 auto; min-block-size: 0; overflow: hidden; position: relative; }
      .hh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; block-size: 100%; align-content: start; }
      .hh-tile { display: flex; flex-direction: column; align-items: center; gap: 2px; text-decoration: none; color: var(--sc-fg-1);
        border: 1px solid var(--sc-border); border-radius: 4px; padding: 6px; }
      .hh-tile:hover, .hh-tile:focus-visible { border-color: var(--sc-accent); }
      .thumb { inline-size: 100%; block-size: 48px; display: flex; align-items: center; justify-content: center; }
      .thumb svg { max-inline-size: 100%; max-block-size: 100%; fill: none; stroke: var(--sc-accent); stroke-width: 2; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--sc-accent) 55%, transparent)); }
      .thumb .ring { inline-size: 32px; block-size: 32px; border-radius: 50%; border: 2px dashed var(--sc-fg-2); }
      .name { font-size: max(10.5px, var(--sc-fs-floor)); text-align: center; }
      .variant, .variant-count { font-size: max(9px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .hh-groups { display: flex; flex-wrap: wrap; gap: 6px; }
      .hh-group { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--sc-border);
        border-radius: 4px; background: transparent; color: var(--sc-fg-1); padding: 6px 10px; min-block-size: var(--sc-tap-min); cursor: pointer; }
      .hh-group .count { color: var(--sc-accent); font-variant-numeric: tabular-nums; }
      .hh-back { position: absolute; inset-block-start: 0; inset-inline-start: 0; border: none; background: transparent; color: var(--sc-fg-2); cursor: pointer; }
      .hh-hall { align-self: center; border: 1px solid var(--sc-border); border-radius: 4px; background: transparent;
        color: var(--sc-fg-1); padding: 4px 10px; min-block-size: var(--sc-tap-min); cursor: pointer; }
      .empty { color: var(--sc-fg-2); font-size: max(12px, var(--sc-fs-floor)); }
      .signin-hint { margin: 0; }
      .signin-hint a { color: var(--sc-accent); }

      .hh-hall-full { position: fixed; inset: 0; z-index: 60; background: var(--sc-bg-0); overflow-y: auto; padding: 20px; }
      .hh-hall-head { display: flex; align-items: center; justify-content: space-between; margin-block-end: 12px; }
      .hh-hall-head button { border: 1px solid var(--sc-border); border-radius: 4px; background: transparent; color: var(--sc-fg-1);
        padding: 6px 12px; min-block-size: var(--sc-tap-min); cursor: pointer; }
      .hh-grid.hall { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }

      @media (max-width: 640px) {
        .hh-overlay { inset-inline: 4%; }
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    `,
  ],
})
export class CodexHoloHangarComponent {
  private readonly hangar = inject(HangarService);
  private readonly auth = inject(AuthService);
  private readonly codex = inject(CodexService);
  private readonly translate = inject(TranslateService);

  protected readonly currentPath = typeof location !== 'undefined' ? location.pathname : '/';
  protected readonly panelId = 'holo-hangar-panel';

  protected readonly open = signal(false);
  protected readonly hallOpen = signal(false);
  protected readonly query = signal('');
  protected readonly activeGroup = signal<ShipConfigRole | null>(null);

  protected readonly signedIn = computed(() => this.auth.user() !== null);

  private readonly silhouettes = signal<Map<string, HoloSilhouette>>(new Map());
  /** ShipConfigRole of each ship's ACTIVE config, keyed by hangarShipId — populated on open. */
  private readonly roles = signal<Map<string, ShipConfigRole | null>>(new Map());
  private readonly variantHints = signal<Map<string, { hint: HangarShipConfig; count: number }>>(new Map());

  protected readonly tiles = computed<HangarTile[]>(() => {
    const sil = this.silhouettes();
    const roles = this.roles();
    const hints = this.variantHints();
    return this.hangar.ships().map((ship) => {
      const hint = hints.get(ship.id);
      const variant = hint ? loadoutVariantHint(hint.hint) : null;
      let variantHintKey: string | null = null;
      let variantHintParams: Record<string, string> | null = null;
      if (variant) {
        if (variant.kind === 'managedByOwner') {
          variantHintKey = 'codex.holo.hangar.managedBy';
          variantHintParams = { owner: hint!.hint.ownerName ?? variant.ownerUserId ?? '' };
        } else {
          const bucket = relativeDayBucket(variant.updatedAt);
          if (bucket === 'today') variantHintKey = 'codex.holo.hangar.savedToday';
          else if (bucket === 'yesterday') variantHintKey = 'codex.holo.hangar.savedYesterday';
          else variantHintKey = 'codex.holo.hangar.savedOn';
          variantHintParams = { date: new Date(variant.updatedAt).toLocaleDateString(this.translate.currentLang) };
        }
      }
      return {
        ship,
        silhouette: sil.get(ship.shipClassName) ?? null,
        role: roles.get(ship.id) ?? null,
        variantHintKey,
        variantHintParams,
        variantCount: hint?.count ?? 0,
      };
    });
  });

  protected readonly filteredTiles = computed<HangarTile[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.tiles();
    if (!q) return all;
    return all.filter(
      (t) => t.ship.shipClassName.toLowerCase().includes(q) || (t.ship.customName ?? '').toLowerCase().includes(q),
    );
  });

  protected readonly groupBy = computed(() => this.filteredTiles().length > GROUP_THRESHOLD);

  protected readonly groups = computed(() => {
    const byRole = new Map<ShipConfigRole | null, HangarTile[]>();
    for (const t of this.filteredTiles()) {
      const arr = byRole.get(t.role) ?? [];
      arr.push(t);
      byRole.set(t.role, arr);
    }
    return Array.from(byRole.entries()).map(([role, tiles]) => ({ role, tiles }));
  });

  protected readonly visibleTiles = computed<HangarTile[]>(() => {
    if (!this.groupBy()) return this.filteredTiles();
    const active = this.activeGroup();
    if (active === null) return [];
    return this.filteredTiles().filter((t) => t.role === active);
  });

  private loadedOnce = false;

  constructor() {
    effect(() => {
      if (!this.open() || !this.signedIn() || this.loadedOnce) return;
      this.loadedOnce = true;
      void this.load();
    });
  }

  /** Lazy-loads the ship list, per-ship active-config role and silhouette
   * batch exactly once per component lifetime (on first open while signed
   * in) — never on every keystroke of the search field, which only filters
   * the already-loaded tiles. */
  private async load(): Promise<void> {
    if (this.hangar.ships().length === 0) await this.hangar.loadAll();
    const ships = this.hangar.ships();

    const sil = await this.codex.silhouettes(
      'ship',
      ships.map((s) => s.shipClassName),
    );
    this.silhouettes.set(sil);

    const roles = new Map<string, ShipConfigRole | null>();
    const hints = new Map<string, { hint: HangarShipConfig; count: number }>();
    await Promise.all(
      ships.map(async (ship) => {
        const configs = await this.hangar.listConfigs(ship.id);
        let active = configs.find((cfg) => cfg.isActive) ?? configs[0] ?? null;
        roles.set(ship.id, active?.role ?? null);
        // A plain row read never carries `ownerName` (only the adopt/refresh
        // RPC does, per wave1.5 fix B) — a still-following config needs the
        // pull-on-demand refresh to resolve the owner's display name; this
        // IS the app's existing profile-lookup path for a shared loadout
        // (there is no generic "look up any user's name" client call).
        if (active?.followsOwner) {
          const fresh = await this.hangar.refreshFollowedLoadout(active.id);
          if (fresh) active = fresh;
        }
        if (active) hints.set(ship.id, { hint: active, count: configs.length });
      }),
    );
    this.roles.set(roles);
    this.variantHints.set(hints);
  }

  protected toggleOpen(): void {
    this.open.set(!this.open());
    if (!this.open()) this.activeGroup.set(null);
  }
}
