import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { StageSearchDirective } from '../shell/fusion-bar/stage-search.directive';
import { STAGE_SLOT_MOVED, StageHeroDirective } from '../shell/fusion-bar/stage-hero.directive';
import { CodexSearchBarComponent } from './search/codex-search-bar.component';
import { CodexLandingDataService } from './landing/codex-landing-data.service';
import { Filmstrip, LandingItem, LandingPaint } from './landing/codex-landing-data.types';
import { CodexLandingHolotableComponent, CATEGORY_GLYPH } from './landing/codex-landing-holotable.component';
import { CodexLandingCardComponent } from './landing/codex-landing-card.component';
import { CodexLandingFilmstripComponent, FilmstripMode } from './landing/codex-landing-filmstrip.component';
import { CodexLandingNewsComponent } from './landing/codex-landing-news.component';

/** Filmstrip tiles before the "+ N weitere" tile (round 6: five + the rest). */
export const FILM_TILES = 5;
/** One rotation step (brief A4: ≈ 8 s per category). */
export const ROTATION_MS = 8000;
/**
 * Where the staged search field stands on this page (fraction of the viewport).
 * Higher than the shell's 41 % so the hologram gets the room below it, with a
 * healthy gap to the header above (round 6 feedback).
 */
export const CODEX_STAGE_TOP = 0.3;
/** Phones stack everything under the hero (News chip above it): the field stays below the two-row header. */
export const CODEX_STAGE_TOP_PHONE = 0.3;
const PHONE_QUERY = '(max-width: 720px)';

/** Category side rail (brief A8): index links, keybindings as the quiet last entry. */
export const LANDING_RAIL = [
  { key: 'ships', glyph: CATEGORY_GLYPH.ship, link: '/codex/index', query: { kind: 'ship' } },
  { key: 'components', glyph: CATEGORY_GLYPH.component, link: '/codex/index', query: { kind: 'component' } },
  { key: 'weapons', glyph: CATEGORY_GLYPH.fpsWeapon, link: '/codex/index', query: { kind: 'weapon', weaponClass: 'Ship' } },
  { key: 'armor', glyph: CATEGORY_GLYPH.armor, link: '/codex/index', query: { kind: 'armor' } },
  { key: 'tools', glyph: CATEGORY_GLYPH.tool, link: '/codex/index', query: { kind: 'weapon', wg: 'ship', wsg: 'utility' } },
] as const;

/**
 * The Codex landing (concept 2026-10-29-codex-landing-neu, round 6): one
 * viewport, no page scroll. Hero with the staged search, the holotable with the
 * newest flight-ready item per category in rotation, the Datenkarte left, News
 * + category rail right, the filmstrip at the bottom. Nothing personal.
 *
 * The rotation advances every {@link ROTATION_MS}; it holds while a segment is
 * held, the card is enlarged, the tab is hidden, or the reader prefers reduced
 * motion.
 */
@Component({
  selector: 'sc-codex-landing',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    StageSearchDirective,
    StageHeroDirective,
    CodexSearchBarComponent,
    CodexLandingHolotableComponent,
    CodexLandingCardComponent,
    CodexLandingFilmstripComponent,
    CodexLandingNewsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--cx-top.px]': 'top()', '[style.--cx-hero-top.px]': 'heroTop()', '[class.shell]': 'shellOn()' },
  template: `
    <section class="landing">
      @if (shellOn()) {
        <div class="hero" scStageHero [scStageHeroTop]="stageTop()">
          <p class="eyebrow">{{ 'codex.landing.hero.eyebrow' | translate }}</p>
          <h1 class="title">{{ 'codex.landing.hero.title' | translate }}</h1>
          <div scStageSearch></div>
        </div>
      } @else {
        <div class="hero">
          <p class="eyebrow">{{ 'codex.landing.hero.eyebrow' | translate }}</p>
          <h1 class="title">{{ 'codex.landing.hero.title' | translate }}</h1>
          <sc-codex-search-bar class="search" variant="terminal" />
        </div>
      }

      <sc-codex-landing-news class="news" [summary]="data.patchSummary()" [unread]="data.newsUnread()"
                             (opened)="data.markNewsSeen()" />

      @if (current(); as it) {
        <sc-codex-landing-card class="card" [item]="it" [paints]="paints()" [(open)]="cardOpen" />
      }

      <div class="stage">
        @if (failed()) {
          <div class="err" role="alert">
            <p>{{ 'codex.error.title' | translate }} — {{ data.error()! | translate }}</p>
            <button type="button" (click)="load()">{{ 'codex.error.retry' | translate }}</button>
          </div>
        } @else if (!loading() && !items().length) {
          <p class="empty">{{ 'codex.landing.holo.empty' | translate }}</p>
        }
        <sc-codex-landing-holotable class="holotable" [item]="current()" [categories]="categories()" [active]="active()"
                                    [held]="held()" [paused]="paused()" [still]="still()" [loading]="loading()"
                                    [cycle]="cycle()" [cycleMs]="rotationMs" (pick)="pick($event)" />
      </div>

      <nav class="rail" [attr.aria-label]="'codex.landing.rail.label' | translate">
        @for (r of rail; track r.key) {
          <a [routerLink]="r.link" [queryParams]="r.query"><span>{{ 'codex.landing.rail.' + r.key | translate }}</span><i aria-hidden="true">{{ r.glyph }}</i></a>
        }
        <a class="quiet" routerLink="/codex/keybinds"><span aria-hidden="true">⌨</span> {{ 'codex.landing.rail.keybinds' | translate }}</a>
      </nav>

      <sc-codex-landing-filmstrip class="film" [ready]="ready()" [announced]="announced()" [(mode)]="filmMode"
                                  [activeId]="activeTileId()" />
    </section>
  `,
  styleUrl: './codex-landing.component.scss',
})
export class CodexLandingComponent {
  protected readonly data = inject(CodexLandingDataService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly shellOn = inject(BetaService).isEnabled('shell');
  protected readonly rail = LANDING_RAIL;
  private readonly phone = signal(typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches);
  protected readonly stageTop = computed(() => (this.phone() ? CODEX_STAGE_TOP_PHONE : CODEX_STAGE_TOP));
  protected readonly rotationMs = ROTATION_MS;

  readonly items = signal<LandingItem[]>([]);
  readonly loading = signal(true);
  readonly active = signal(0);
  readonly held = signal(false);
  readonly cardOpen = signal(false);
  readonly cycle = signal(0);
  readonly hidden = signal(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  readonly still = signal(
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  readonly paints = signal<LandingPaint[]>([]);
  readonly ready = signal<Filmstrip | null>(null);
  readonly announced = signal<Filmstrip | null>(null);
  readonly filmMode = signal<FilmstripMode>('ready');
  /** Page offset of the landing (px) — sizes it to the rest of the viewport. */
  readonly top = signal(0);
  /** Top of the hero block inside the landing (px): News and the card start on it. */
  readonly heroTop = signal(0);

  readonly current = computed(() => this.items()[this.active()] ?? null);
  readonly categories = computed(() => this.items().map((i) => i.category));
  readonly paused = computed(
    () => this.held() || this.cardOpen() || this.hidden() || this.still() || this.items().length < 2,
  );
  readonly failed = computed(() => !this.loading() && !this.items().length && !!this.data.error());
  readonly activeTileId = computed(() => {
    const it = this.current();
    return it?.category === 'ship' ? (it.detailRoute[2] ?? null) : null;
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stepStart = 0;
  private remaining = ROTATION_MS;
  private paintsToken = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.load();
    void this.data.loadPatchSummary();
    const langSub = this.translate.onLangChange.subscribe(() => void this.data.loadPatchSummary());

    // Rotation clock: runs while not paused, keeps the rest of a step across a pause.
    effect(() => {
      const paused = this.paused();
      this.cycle();
      untracked(() => (paused ? this.pauseClock() : this.runClock()));
    });

    // Paints of the item on the table (ships only); a stale answer is dropped.
    effect(() => {
      const it = this.current();
      const token = ++this.paintsToken;
      untracked(() => this.paints.set([]));
      if (!it || it.category !== 'ship') return;
      void this.data.paintsFor(it.className, it.name).then((list) => {
        if (token === this.paintsToken) this.paints.set(list);
      });
    });

    const phoneMq = typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null;
    const onPhone = (e: MediaQueryListEvent) => this.phone.set(e.matches);
    phoneMq?.addEventListener('change', onPhone);
    destroyRef.onDestroy(() => phoneMq?.removeEventListener('change', onPhone));

    const onVisibility = () => this.hidden.set(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);

    afterNextRender(() => {
      const measure = () => {
        const landing = this.host.querySelector<HTMLElement>('.landing');
        const hero = this.host.querySelector<HTMLElement>('.hero');
        if (!landing) return;
        this.top.set(Math.round(this.host.getBoundingClientRect().top + window.scrollY));
        if (hero) this.heroTop.set(Math.round(hero.getBoundingClientRect().top - landing.getBoundingClientRect().top));
      };
      measure();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
      ro?.observe(document.body);
      window.addEventListener(STAGE_SLOT_MOVED, measure);
      window.addEventListener('resize', measure, { passive: true });
      const lates = [300, 1000].map((ms) => setTimeout(measure, ms));
      destroyRef.onDestroy(() => {
        ro?.disconnect();
        window.removeEventListener(STAGE_SLOT_MOVED, measure);
        window.removeEventListener('resize', measure);
        lates.forEach(clearTimeout);
      });
    });

    destroyRef.onDestroy(() => {
      langSub.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      this.clearTimer();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [items, ready, announced] = await Promise.all([
      this.data.rotationItems(),
      this.data.flightReadyFilmstrip(FILM_TILES),
      this.data.announcedFilmstrip(FILM_TILES),
    ]);
    this.items.set(items);
    this.ready.set(ready);
    this.announced.set(announced);
    this.active.set(0);
    this.loading.set(false);
  }

  /** Segment click: jump + hold; the held segment again resumes the rotation. */
  pick(i: number): void {
    if (this.held() && i === this.active()) {
      this.held.set(false);
      this.advance();
      return;
    }
    this.active.set(i);
    this.held.set(true);
    this.remaining = ROTATION_MS;
    this.cycle.update((c) => c + 1);
  }

  private advance(): void {
    const n = this.items().length;
    if (n) this.active.set((this.active() + 1) % n);
    this.remaining = ROTATION_MS;
    this.cycle.update((c) => c + 1);
  }

  private runClock(): void {
    this.clearTimer();
    this.stepStart = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, this.remaining);
  }

  private pauseClock(): void {
    if (this.timer) this.remaining = Math.max(0, this.remaining - (Date.now() - this.stepStart));
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
