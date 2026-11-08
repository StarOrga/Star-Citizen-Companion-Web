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
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { StageSearchDirective } from '../shell/fusion-bar/stage-search.directive';
import { STAGE_SLOT_MOVED, StageHeroDirective } from '../shell/fusion-bar/stage-hero.directive';
import { CodexSearchBarComponent } from './search/codex-search-bar.component';
import { CodexLandingDataService } from './landing/codex-landing-data.service';
import { LandingCategory, LandingCodex, LandingCodexEntry, LandingItem, LandingPaint } from './landing/codex-landing-data.types';
import { CodexLandingHolotableComponent } from './landing/codex-landing-holotable.component';
import { CodexLandingValuesPaneComponent } from './landing/codex-landing-values-pane.component';
import { CodexLandingCodexPaneComponent } from './landing/codex-landing-codex-pane.component';
import { CodexLandingNewsComponent } from './landing/codex-landing-news.component';
import { CLAIM_MS, ClaimCursor, buildClaims } from './landing/codex-landing-claims';
import { PauseOffscreenDirective } from '../shared/pause-offscreen.directive';

/** One rotation step (brief A4: ≈ 8 s per category). */
export const ROTATION_MS = 8000;
/** New items listed per category in the Codex list before "+ N weitere in der Suche". */

/**
 * The Codex landing (concept 2026-10-30-codex-holo-buehne, round 4 "Zugewandte
 * Kante"): one viewport, no page scroll on desktop. Hero with the category's
 * claims and the staged search; the holotable in the centre with the newest
 * flight-ready item per category in rotation; the Codex list left (where the
 * index keeps its area tree) and the data sheet right, both light panes whose
 * glowing edges face the screen edge and stand in the light the table spills
 * across the floor. Wheeling on past the page end opens the Codex index.
 * Nothing personal.
 *
 * The rotation advances every {@link ROTATION_MS}; it holds while a category
 * is held, a paint preview is open, the hero is hovered/focused, the tab is
 * hidden, or the reader prefers reduced motion.
 */
@Component({
  selector: 'sc-codex-landing',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    StageSearchDirective,
    StageHeroDirective,
    CodexSearchBarComponent,
    CodexLandingHolotableComponent,
    CodexLandingValuesPaneComponent,
    CodexLandingCodexPaneComponent,
    CodexLandingNewsComponent,
    PauseOffscreenDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--cx-top.px]': 'top()',
    '[style.--cx-hero-top.px]': 'heroTop()',
    '[class.shell]': 'shellOn()',
    '[class.still]': 'still()',
    '[class.lit]': '!!current()',
  },
  templateUrl: './codex-landing.component.html',
  styleUrl: './codex-landing.component.scss',
})
export class CodexLandingComponent {
  protected readonly data = inject(CodexLandingDataService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly shellOn = inject(BetaService).isEnabled('shell');
  protected readonly rotationMs = ROTATION_MS;
  private readonly lang = this.translate.currentLang;

  readonly items = signal<LandingItem[]>([]);
  readonly loading = signal(true);
  readonly active = signal(0);
  readonly held = signal(false);
  readonly paintOpen = signal(false);
  /** Pointer over / focus inside the hero: claims and rotation stand still (WCAG 2.2.2). */
  readonly heroHold = signal(false);
  readonly cycle = signal(0);
  readonly hidden = signal(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  readonly still = signal(
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  readonly paints = signal<LandingPaint[]>([]);
  readonly codex = signal<LandingCodex | null>(null);
  /** 0 until the first item stood on the table; +1 on every item change after it (a switch). */
  readonly switchNo = signal(0);
  readonly claimIndex = signal(0);
  /** Page offset of the landing (px) — sizes it to the rest of the viewport. */
  readonly top = signal(0);
  /** Top of the hero block inside the landing (px): News and the panes start on it. */
  readonly heroTop = signal(0);

  /** An entry of the Codex list the reader put on the table (B2.1); it wins over the rotation's item until the rotation moves on. */
  readonly picked = signal<LandingItem | null>(null);
  private entryToken = 0;

  readonly current = computed(() => this.picked() ?? this.items()[this.active()] ?? null);
  readonly category = computed(() => this.current()?.category ?? null);
  readonly paused = computed(
    () =>
      this.held() || this.paintOpen() || this.heroHold() || this.hidden() || this.still() || this.items().length < 2,
  );
  /**
   * Claims advance every {@link CLAIM_MS} whether the rotation runs or stands
   * (concept 2026-11-01 cx-claims); a category change restarts the dwell with
   * that category's next claim. Hover/focus on the hero, a hidden tab and
   * reduced motion hold them (WCAG 2.2.2).
   */
  readonly claimsRun = computed(() => !this.still() && !this.hidden() && !this.heroHold() && !!this.current());
  readonly failed = computed(() => !this.loading() && !this.items().length && !!this.data.error());

  readonly claims = computed(() => {
    this.lang();
    const cat = this.category();
    if (!cat) return [];
    const codex = this.codex();
    return buildClaims(this.translate, cat, {
      patch: codex?.patch ?? null,
      news: codex?.categories.find((c) => c.category === cat) ?? null,
    });
  });
  readonly claim = computed(() => {
    const list = this.claims();
    return list.length ? list[this.claimIndex() % list.length] : null;
  });

  private readonly claimCursor = new ClaimCursor();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private stepStart = 0;
  private remaining = ROTATION_MS;
  private paintsToken = 0;
  private lastKey = '';

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

    // A new item on the table: count the switch, take the category's next claim.
    effect(() => {
      const it = this.current();
      const key = it ? `${it.category}:${it.className}` : '';
      untracked(() => {
        if (!key) return;
        if (this.lastKey && key !== this.lastKey) this.switchNo.update((n) => n + 1);
        this.lastKey = key;
        this.claimIndex.set(this.claimCursor.enter(it!.category));
      });
    });

    // Claim dwell inside a held category (CLAIM_MS per line).
    effect(() => {
      const run = this.claimsRun();
      this.claimIndex();
      untracked(() => {
        if (this.claimTimer) clearTimeout(this.claimTimer);
        this.claimTimer = run
          ? setTimeout(() => {
              this.claimTimer = null;
              this.claimIndex.set(this.claimCursor.step());
            }, CLAIM_MS)
          : null;
      });
    });

    // Paints of the item on the table (ships only); a stale answer is dropped.
    effect(() => {
      const it = this.current();
      const token = ++this.paintsToken;
      untracked(() => this.paints.set([]));
      if (!it || it.category !== 'ship' || it.announced) return;
      void this.data.paintsFor(it.className, it.name).then((list) => {
        if (token === this.paintsToken) this.paints.set(list);
      });
    });


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

      // The way on into the overview ("Mehr in Codex") belongs to the page around the landing (CodexPageComponent).

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
      if (this.claimTimer) clearTimeout(this.claimTimer);
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [items, codex] = await Promise.all([this.data.rotationItems(), this.data.codexNews()]);
    this.items.set(items);
    this.codex.set(codex);
    this.picked.set(null);
    this.active.set(0);
    this.loading.set(false);
  }

  /** Category click: jump + hold; the held category again resumes the rotation. */
  pick(i: number): void {
    this.entryToken++;
    this.picked.set(null);
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

  /**
   * Plain left click on an entry of the Codex list: that entry goes onto the
   * holotable of this page and is held (B2.1). An announced ship stands there
   * with name and category icon only, no values (B2.3, d-announced `preview`).
   */
  async pickEntry(category: LandingCategory, entry: LandingCodexEntry): Promise<void> {
    const token = ++this.entryToken;
    const index = this.items().findIndex((i) => i.category === category && i.className === entry.id);
    let item: LandingItem | null = null;
    if (index < 0) {
      item = entry.announced ? announcedItem(entry) : await this.data.itemByClass(category, entry.id);
      if (token !== this.entryToken) return;
      if (!item) return;
    }
    const catIndex = this.items().findIndex((i) => i.category === category);
    this.picked.set(item);
    this.active.set(index >= 0 ? index : Math.max(0, catIndex));
    this.held.set(true);
    this.remaining = ROTATION_MS;
    this.cycle.update((c) => c + 1);
  }

  onHeroLeave(ev: FocusEvent | MouseEvent): void {
    const hero = ev.currentTarget as HTMLElement | null;
    const next = (ev as FocusEvent).relatedTarget as Node | null;
    if (ev.type === 'focusout' && hero && next && hero.contains(next)) return;
    if (ev.type === 'mouseleave' && hero?.contains(document.activeElement)) return;
    this.heroHold.set(false);
  }

  private advance(): void {
    this.entryToken++;
    this.picked.set(null);
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

/** An announced ship on the table: name and category icon, no values; the route is its upcoming page. */
function announcedItem(entry: LandingCodexEntry): LandingItem {
  return {
    category: 'ship',
    kind: 'ship',
    className: entry.id,
    name: entry.name,
    eyebrow: { manufacturer: null, descriptor: null },
    detailRoute: entry.route,
    imageUrl: null,
    previewUrl: null,
    overview: [],
    topValues: [],
    announced: true,
  };
}
