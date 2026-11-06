import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SccAppLauncherService } from '../../desktop/scc-app-launcher.service';
import { HangarService } from '../../hangar/hangar.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqEinsatzService, einsatzBadge } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqStatsService } from '../data/hq-stats.service';
import { HqAppLaunchComponent } from '../hq-app-launch.component';
import { HqOwnershipService } from '../hq-ownership.service';
import { HQ_PAGE_ICONS, HqPageNavService, hqPageHotkey } from '../hq-page-nav.service';
import { HqPageId, hqEinsatzHref, hqHangar } from '../hq-routes';
import { HqSuppliesService } from '../hq-supplies.service';
import { HqLiveService } from '../now/hq-live.service';
import { formatLocationName, isGameLive, presenceAt, readLocation, readShip } from '../now/hq-live.util';
import { currentEinsatz } from '../now/hq-now-path';
import { isStale } from '../stock/hq-stock-model';

const PRESENCE_TICK_MS = 30_000;
const DAY_MS = 86_400_000;

/** Missions counted since this week's Monday (the series' buckets are UTC days or Monday weeks). */
export function missionsThisWeek(series: readonly { bucket: string; value: number }[], now: number = Date.now()): number {
  const d = new Date(now);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  const from = monday.toISOString().slice(0, 10);
  return series.reduce((sum, p) => (p.bucket.slice(0, 10) >= from ? sum + p.value : sum), 0);
}

/** "vor 2 Tagen" in the reader's language, from the largest unit that fits. */
export function agoText(iso: string, lang: string | undefined, now: number = Date.now()): string {
  const fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const min = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(min) < 60) return fmt.format(min, 'minute');
  const h = Math.round(min / 60);
  return Math.abs(h) < 24 ? fmt.format(h, 'hour') : fmt.format(Math.round(h / 24), 'day');
}

/**
 * The three ways on below the Start search: Bestand and Planen in the Lichtkante style, Jetzt open in
 * the centre, Statistik as a quiet line beneath. A whole tile is a real anchor stretched behind its
 * content (plain click through `HqPageNavService`, modified clicks to the browser); an own target
 * inside sits above that anchor and does its own thing, so anchors never nest.
 *
 * A first visit needs no block of its own: the tiles say what is missing and Bestand is marked as
 * the next step. Every number comes from the service its page reads; a load failure is an error
 * state with retry, never the empty state.
 */
@Component({
  selector: 'sc-hq-start-tiles',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScTooltipDirective, HqAppLaunchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="tile side edge left" data-tile="bestand" [class.next]="stock() === 'empty'">
        <ng-container [ngTemplateOutlet]="stretch" [ngTemplateOutletContext]="{ $implicit: 'inventar' }" />
        <span class="side-k"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.inventar" /></svg>{{ 'hq.pages.inventar' | translate }}</span>
        @switch (stock()) {
          @case ('loading') {
            <small role="status">{{ 'hq.start.loading' | translate }}</small>
          }
          @case ('error') {
            <small class="err" role="alert">{{ hangar.error()! | translate }}</small>
            <span class="cta"><button type="button" class="own retry" (click)="loadStock()">{{ 'hq.start.retry' | translate }}</button></span>
          }
          @case ('empty') {
            <b>{{ 'hq.start.bestand.empty' | translate }}</b>
            <small>{{ 'hq.start.bestand.emptyHint' | translate }}</small>
            <span class="cta"><a class="own" [routerLink]="hangarLink">{{ 'hq.start.bestand.import' | translate }} ›</a></span>
          }
          @default {
            <b>{{ (ownedShips() === 1 ? 'hq.start.bestand.shipsOne' : 'hq.start.bestand.ships') | translate: { n: ownedShips() } }}</b>
            <small>
              {{ (setCount() === 1 ? 'hq.start.bestand.setsOne' : 'hq.start.bestand.sets') | translate: { n: setCount() } }}
              @if (blueprints(); as n) {
                · {{ (n === 1 ? 'hq.start.bestand.blueprintsOne' : 'hq.start.bestand.blueprints') | translate: { n } }}
              }
            </small>
            @if (staleDays(); as n) {
              <small class="warn">{{ 'hq.start.bestand.stale' | translate: { n } }}</small>
            } @else if (inv.error() && !inv.loaded()) {
              <small class="err" role="alert">{{ inv.error()! | translate }}</small>
            }
            <span class="cta">{{ 'hq.start.bestand.open' | translate }} ›</span>
          }
        }
      </div>

      <div class="tile now" data-tile="jetzt" [class.on]="gameLive()">
        <ng-container [ngTemplateOutlet]="stretch" [ngTemplateOutletContext]="{ $implicit: 'jetzt' }" />
        <span class="now-k">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.jetzt" /></svg>
          {{ (gameLive() ? 'hq.start.now.live' : 'hq.pages.jetzt') | translate }}
        </span>
        @if (gameLive()) {
          @if (location()?.system; as sys) { <span class="sys">{{ sys }}</span> }
          <b>{{ place() || ('hq.now.anchor.unknown' | translate) }}</b>
          @if (ship(); as s) { <small>{{ s }}</small> }
          @if (next(); as n) {
            <a class="own go" [href]="routeHref()" [scTooltip]="'hq.start.now.nextTip' | translate" (click)="openRoute($event)">{{ 'hq.start.now.step.' + n.kind | translate: { label: n.label } }} ›</a>
          }
        } @else if (signedIn() && !live.loaded()) {
          <small role="status">{{ 'hq.start.loading' | translate }}</small>
        } @else if (live.error() && !live.state()) {
          <small class="err" role="alert">{{ live.error()! | translate }}</small>
          <button type="button" class="own retry" (click)="live.refresh()">{{ 'hq.start.retry' | translate }}</button>
        } @else {
          @if (hasSignal()) {
            <b>{{ 'hq.start.now.off' | translate }}</b>
            @if (ago(); as when) {
              <small>
                @if (place(); as where) {
                  {{ 'hq.start.now.last' | translate: { place: where, ago: when } }}
                } @else {
                  {{ 'hq.start.now.lastTime' | translate: { ago: when } }}
                }
              </small>
            }
          } @else {
            <b>{{ 'hq.start.now.none' | translate }}</b>
            <small>{{ 'hq.start.now.noneHint' | translate }}</small>
          }
          <sc-hq-app-launch class="own launch" look="pill" [tipped]="true" [mode]="appMode()" />
        }
      </div>

      <div class="tile side edge right" data-tile="planen">
        <ng-container [ngTemplateOutlet]="stretch" [ngTemplateOutletContext]="{ $implicit: 'planen' }" />
        <span class="side-k"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.planen" /></svg>{{ 'hq.pages.planen' | translate }}</span>
        @switch (plan()) {
          @case ('loading') {
            <small role="status">{{ 'hq.start.loading' | translate }}</small>
          }
          @case ('error') {
            <small class="err" role="alert">{{ einsatz.syncError()! | translate }}</small>
            <span class="cta"><button type="button" class="own retry" (click)="einsatz.sync()">{{ 'hq.start.retry' | translate }}</button></span>
          }
          @case ('plans') {
            @let e = current()!;
            <b>{{ 'hq.start.planen.count' | translate: { n: einsatz.upcoming().length } }}</b>
            <small>
              {{ e.title }} ·
              {{ badge(e).multi ? ('hq.einsatz.multi' | translate: { n: badge(e).n }) : ('hq.einsatz.single' | translate) }}
            </small>
            <span class="cta"><a class="own" [href]="routeHref()" (click)="openRoute($event)">{{ 'hq.start.planen.route' | translate }} ›</a></span>
          }
          @case ('needs') {
            <b>{{ 'hq.start.planen.needs' | translate: { n: supplies.open().length } }}</b>
            <small>{{ 'hq.start.planen.emptyHint' | translate }}</small>
            <span class="cta">{{ 'hq.start.planen.go' | translate }} ›</span>
          }
          @default {
            <b>{{ 'hq.start.planen.empty' | translate }}</b>
            <small>{{ 'hq.start.planen.emptyHint' | translate }}</small>
            <span class="cta">{{ 'hq.start.planen.go' | translate }} ›</span>
          }
        }
      </div>
    </div>

    @if (!firstVisit()) {
      <div class="after">
        <a class="stat" [href]="nav.href('statistik')" (click)="nav.go($event, 'statistik')"
           [attr.aria-keyshortcuts]="hotkey('statistik')"
           [scTooltip]="'hq.hotkey' | translate: { key: hotkey('statistik') }" [scTooltipDisabled]="nav.noHover">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.statistik" /></svg>
          <span>
            @if (weekMissions(); as n) {
              <b>{{ (n === 1 ? 'hq.start.stats.missionsOne' : 'hq.start.stats.missions') | translate: { n } }}</b>
              {{ 'hq.start.stats.week' | translate }} ·
            }
            {{ 'hq.start.stats.open' | translate }} ›
          </span>
        </a>
      </div>
    }

    <ng-template #stretch let-page>
      <a class="stretch" [href]="nav.href(page)" (click)="nav.go($event, page)"
         [attr.aria-label]="'hq.pages.' + page | translate"
         [attr.aria-keyshortcuts]="hotkey(page)"
         [scTooltip]="'hq.hotkey' | translate: { key: hotkey(page) }" [scTooltipDisabled]="nav.noHover"></a>
    </ng-template>
  `,
  styles: [
    `
      :host { display: block; container-type: inline-size; text-align: center; text-shadow: 0 0 0.3em color-mix(in srgb, var(--sc-bg-0) 45%, transparent); }
      .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: center; }
      .tile { position: relative; isolation: isolate; display: flex; flex-direction: column; min-width: 0; }
      /* The launch hint is fixed to the viewport: its tile has to rise above the rail and the cue. */
      .tile:has(.hint) { z-index: 60; }
      .stretch { position: absolute; inset: 0; z-index: 1; border-radius: 4px; }
      .stretch:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .own { position: relative; z-index: 2; }
      a.own { color: var(--sc-accent); text-decoration: none; }
      a.own:hover { text-decoration: underline; text-underline-offset: 3px; }
      a.own:focus-visible, .retry:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .retry { padding: 0; border: 0; background: none; color: var(--sc-accent); font: inherit; cursor: pointer; }
      .retry:hover { text-decoration: underline; text-underline-offset: 3px; }
      .ico { flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      small { font-size: max(0.8125rem, var(--sc-fs-floor)); color: var(--sc-fg-1); overflow-wrap: anywhere; }
      .warn { color: var(--sc-warning); }
      .err { color: var(--sc-danger); }

      .side { gap: 5px; min-height: 148px; padding: 16px 18px; box-sizing: border-box; text-align: left; }
      .side-k { display: flex; align-items: center; gap: 8px; color: var(--sc-accent); font: 600 0.656rem / 1 var(--sc-font-display); letter-spacing: 0.18em; text-transform: uppercase; }
      .side-k .ico { width: 18px; height: 18px; }
      .side b { margin-top: 6px; font: 500 1.125rem / 1.25 var(--sc-font-display); color: var(--sc-fg-0); overflow-wrap: anywhere; }
      .cta { margin-top: auto; padding-top: 8px; color: var(--sc-accent); }
      /* Light edge: no box, a lit top line fading downwards; the text leans to the centre. */
      .edge::before {
        content: ''; position: absolute; z-index: -1; inset: 0;
        border-top: 1px solid color-mix(in srgb, var(--sc-accent) 60%, transparent);
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 9%, transparent), transparent 72%);
      }
      .edge.left { text-align: right; align-items: flex-end; }
      .edge.left .side-k { flex-direction: row-reverse; }
      .edge.next::before { border-top-color: var(--sc-accent); background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 20%, transparent), transparent 80%); }
      .edge:hover::before { background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 18%, transparent), transparent 80%); }

      .now { align-self: stretch; align-items: center; justify-content: center; gap: 4px; min-height: 216px; padding: 8px; box-sizing: border-box; }
      .now-k { display: inline-flex; align-items: center; gap: 7px; color: var(--sc-fg-2); font: 600 0.656rem / 1 var(--sc-font-display); letter-spacing: 0.18em; text-transform: uppercase; }
      .now-k .ico { width: 16px; height: 16px; }
      .side:hover .side-k, .now:hover .now-k { color: var(--sc-accent); }
      .now b { margin-top: 8px; font: 500 1.5625rem / 1.2 var(--sc-font-display); color: var(--sc-fg-0); overflow-wrap: anywhere; }
      .sys { margin-top: 6px; font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-fg-2); }
      .sys + b { margin-top: 2px; }
      .launch, .go { margin-top: 10px; }
      .go {
        display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, transparent); border-radius: 999px;
        background: color-mix(in srgb, var(--sc-bg-1) 75%, transparent);
        font: 500 max(0.84rem, var(--sc-fs-floor)) / 1.1 var(--sc-font-body);
      }
      a.go:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); text-decoration: none; }
      /* Connected: green label, soft blurred rings breathing well behind the text. */
      .now.on .now-k, .now.on:hover .now-k { color: var(--sc-success); }
      .now.on::before, .now.on::after {
        content: ''; position: absolute; z-index: -1; left: 50%; top: 50%; border-radius: 50%; box-sizing: border-box;
        width: 208px; height: 208px; margin: -104px 0 0 -104px;
        border: 5px solid color-mix(in srgb, var(--sc-success) 22%, transparent);
        filter: blur(6px);
        animation: hq-breathe 7s ease-in-out infinite;
      }
      .now.on::after { width: 152px; height: 152px; margin: -76px 0 0 -76px; border-color: color-mix(in srgb, var(--sc-success) 14%, transparent); animation-delay: 3.5s; }
      @keyframes hq-breathe { 0%, 100% { transform: scale(0.94); opacity: 0.35; } 50% { transform: scale(1.06); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .now.on::before, .now.on::after { animation: none; opacity: 0.6; } }

      .after { display: flex; justify-content: center; margin-top: 22px; }
      .stat { display: inline-flex; align-items: center; gap: 8px; font-size: max(0.8125rem, var(--sc-fs-floor)); color: var(--sc-fg-1); text-decoration: none; }
      .stat .ico { width: 15px; height: 15px; color: var(--sc-accent); }
      .stat b { font-weight: 500; color: var(--sc-fg-0); }
      .stat:hover { color: var(--sc-accent); }
      .stat:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }

      /* Touch: every own target and the quiet link keep a full tap height. */
      @media (pointer: coarse) {
        a.own, .retry, .stat { display: inline-flex; align-items: center; min-height: 48px; }
        /* A plain line and an own target end on the same baseline. */
        .cta { display: flex; align-items: center; min-height: 48px; padding-top: 0; }
      }
      /* Phone: Jetzt on top, Bestand and Planen side by side with equal height, all text left. */
      @container (max-width: 520px) {
        .row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch; }
        .now { grid-column: 1 / -1; grid-row: 1; min-height: 132px; }
        .now b { margin-top: 2px; font-size: 1.125rem; }
        .now.on::before { width: 124px; height: 124px; margin: -62px 0 0 -62px; }
        .now.on::after { width: 88px; height: 88px; margin: -44px 0 0 -44px; }
        .launch, .go { margin-top: 6px; }
        .side { min-height: 124px; padding: 12px; }
        .side b { font-size: 0.875rem; }
        small { font-size: max(0.75rem, var(--sc-fs-floor)); }
        .edge.left { text-align: left; align-items: flex-start; }
        .edge.left .side-k { flex-direction: row; }
        .after { margin-top: 10px; }
      }
    `,
  ],
})
export class HqStartTilesComponent {
  private readonly auth = inject(AuthService);
  protected readonly hangar = inject(HangarService);
  protected readonly inv = inject(HqInventoryService);
  protected readonly einsatz = inject(HqEinsatzService);
  protected readonly supplies = inject(HqSuppliesService);
  protected readonly live = inject(HqLiveService);
  protected readonly nav = inject(HqPageNavService);
  private readonly stats = inject(HqStatsService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly launcher = inject(SccAppLauncherService);
  private readonly i18n = inject(TranslateService);

  protected readonly icons = HQ_PAGE_ICONS;
  protected readonly hangarLink = hqHangar;
  protected readonly badge = einsatzBadge;
  protected readonly hotkey = (page: HqPageId): number | null => hqPageHotkey(page);

  /** Re-evaluates the life sign's and the stand's age while the page stays open. */
  private readonly clock = signal(Date.now());
  /** The hangar's first load for this reader is through. */
  private readonly hangarLoaded = signal(false);
  protected readonly signedIn = computed(() => !!this.auth.user());

  // Bestand
  protected readonly ownedShips = computed(() => this.hangar.ships().filter((s) => s.status === 'owned').length);
  protected readonly setCount = computed(() => this.ownership.configs().length + this.hangar.roleLoadouts().length);
  /** Blueprints the Statistik data knows of; there is no total to compare them with. */
  protected readonly blueprints = computed(() => this.stats.stats()?.blueprints.total ?? 0);
  protected readonly staleDays = computed(() => {
    const now = this.clock();
    const oldest = this.inv
      .snapshots()
      .filter((s) => isStale(s.taken_at, now))
      .reduce<number | null>((min, s) => {
        const t = Date.parse(s.taken_at);
        return min === null || t < min ? t : min;
      }, null);
    return oldest === null ? 0 : Math.floor((now - oldest) / DAY_MS);
  });
  protected readonly stock = computed<'loading' | 'error' | 'empty' | 'full'>(() => {
    if (this.ownedShips() > 0) return 'full';
    if (!this.signedIn()) return 'empty';
    if (this.hangar.error()) return 'error';
    return this.hangarLoaded() ? 'empty' : 'loading';
  });

  // Jetzt
  protected readonly gameLive = computed(() => isGameLive(this.live.state(), this.live.events(), this.clock()));
  /** The account has a game signal: the SCC app has reported a state or an event. */
  protected readonly hasSignal = computed(() => this.live.state() !== null || this.live.events().length > 0);
  protected readonly location = computed(() => readLocation(this.live.state()));
  protected readonly place = computed(() => {
    const at = this.location();
    return at ? formatLocationName(at.name) : null;
  });
  protected readonly ship = computed(() => readShip(this.live.state()));
  protected readonly ago = computed(() => {
    const at = presenceAt(this.live.state()) ?? this.live.stateUpdatedAt() ?? this.live.events()[0]?.at ?? null;
    return at ? agoText(at, this.i18n.getCurrentLang() || undefined, this.clock()) : null;
  });
  protected readonly appMode = computed<'launch' | 'download'>(() =>
    this.hasSignal() || this.launcher.remembered() ? 'launch' : 'download',
  );

  // Planen
  protected readonly current = computed(() => currentEinsatz(this.einsatz.upcoming()));
  /** The next open step of the first planned Einsatz; none means no button at all. */
  protected readonly next = computed(() => this.current()?.steps.find((s) => s.state === 'todo') ?? null);
  protected readonly routeHref = computed(() => {
    const e = this.current();
    return e ? hqEinsatzHref(e.id) : this.nav.href('planen');
  });
  protected readonly plan = computed<'loading' | 'error' | 'plans' | 'needs' | 'empty'>(() => {
    if (this.current()) return 'plans';
    if (this.signedIn() && !this.einsatz.ready()) return this.einsatz.syncError() ? 'error' : 'loading';
    return this.supplies.open().length > 0 ? 'needs' : 'empty';
  });

  // Statistik
  protected readonly weekMissions = computed(() => missionsThisWeek(this.stats.stats()?.missions.series ?? [], this.clock()));
  /** Nothing to report yet: the tiles speak, the quiet line stays away. */
  protected readonly firstVisit = computed(
    () => this.stock() === 'empty' && this.plan() === 'empty' && !this.hasSignal(),
  );

  constructor() {
    const ticker = setInterval(() => this.clock.set(Date.now()), PRESENCE_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(ticker));
    effect(() => {
      if (!this.signedIn()) return;
      untracked(() => {
        void this.loadStock();
        if (!this.inv.loaded()) void this.inv.load();
      });
    });
    // The running game seen here means the app is on this machine's account: the button may say
    // "starten" from now on, also once the game is closed again.
    effect(() => {
      if (this.gameLive()) untracked(() => this.launcher.rememberLaunch());
    });
  }

  protected async loadStock(): Promise<void> {
    if (this.hangar.ships().length === 0 && this.hangar.roleLoadouts().length === 0) await this.hangar.loadAll();
    this.hangarLoaded.set(true);
  }

  protected openRoute(ev: MouseEvent): void {
    const e = this.current();
    if (e) this.nav.openRoute(ev, e.id);
  }
}
