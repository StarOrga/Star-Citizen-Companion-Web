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
import { Params, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { BetaService } from '../../core/beta.service';
import { AuthService } from '../../auth/auth.service';
import { NewsListComponent } from '../../news/news-list.component';
import { NewsService } from '../../news/news.service';
import { NavOriginService } from '../../shared/page-header/nav-origin.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import { VerseDigestItem, VerseDoor } from '../data/verse.models';
import { STARS_PER_PATCH } from '../starmap/starmap.model';
import { BriefingMoonComponent, MoonTiming, moonSchedule } from './briefing/briefing-moon.component';
import { BriefingSkyComponent } from './briefing/briefing-sky.component';
import {
  BriefingStatus,
  IntroMode,
  briefingStatus,
  claimIntro,
  explorerLit,
  liveStatusKey,
  newestFor,
  nextStatusKey,
  uniqueStories,
} from './briefing/briefing.model';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many stories the hero rotates through (one story pill each). */
export const HERO_STORIES = 3;

/** Entrance length in seconds: the full "Anflug" once per session, a short one afterwards. */
export const INTRO_SECONDS: Readonly<Record<IntroMode, number>> = { full: 3.4, short: 0.6 };

/** An item's link, split for `[routerLink]` (in-app) or `[href]` (external). */
export interface VerseItemLink {
  internal: boolean;
  path: string;
  query: Params | null;
}

export function verseItemLink(url: string | null): VerseItemLink | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) {
    const u = new URL(url, 'https://x.invalid');
    const query: Params = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    return { internal: true, path: u.pathname, query: Object.keys(query).length ? query : null };
  }
  return /^https:\/\//.test(url) ? { internal: false, path: url, query: null } : null;
}

interface Gate {
  door: VerseDoor;
  link: string;
  count: number;
  total: number | null;
}

/** Identity of a resolved link for the hero dedupe. */
export function linkKey(link: VerseItemLink): string {
  return `${link.internal ? 'in' : 'ex'}:${link.path}?${link.query ? JSON.stringify(link.query) : ''}`;
}

interface HeroStory {
  item: VerseDigestItem;
  link: VerseItemLink;
  unseen: boolean;
}

/**
 * `/verse` — the briefing, "Anflug": a cinematic stage (nebula, sun and the
 * current patch's constellation from frame 0, a static planet horizon) that
 * flies in once per session. One viewport on desktop: the instrument strip
 * (patch status left, constellation + star-map button in the far top-right
 * corner), the hero (the newest stories rotate; pills only switch, the CTA is
 * the one way in) and the gate band of three moons above the footer strip.
 * One pause control holds all auto motion. β off: the legacy landing (the
 * Verse News list) renders instead.
 */
@Component({
  selector: 'sc-verse-briefing',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, NewsListComponent, BriefingMoonComponent, BriefingSkyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing/verse-briefing.component.html',
  styleUrl: './briefing/verse-briefing.component.scss',
})
export class VerseBriefingComponent {
  protected readonly api = inject(VerseApiService);
  private readonly news = inject(NewsService);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  readonly enabled = inject(BetaService).isEnabled('verse');
  readonly total = STARS_PER_PATCH;

  readonly top = this.api.topItems;

  /** Claimed only when the cinematic actually renders. */
  readonly intro: IntroMode = this.enabled() ? claimIntro() : 'short';
  readonly introSeconds = INTRO_SECONDS[this.intro];

  /** The rotating stories: up to {@link HERO_STORIES} distinct top items with a usable link (see `uniqueStories`). */
  readonly stories = computed<HeroStory[]>(() => {
    const seen = this.api.seen();
    // The top list first; the rest of the digest (rank order) fills what the dedupe removed.
    const rest = [...(this.api.digest()?.items ?? [])].sort((x, y) => x.rank - y.rank);
    return uniqueStories([...this.top(), ...rest], (i) => verseItemLink(i.url), linkKey, HERO_STORIES).map(({ item, link }) => ({
      item,
      link,
      unseen: !seen.has(item.key),
    }));
  });

  /** All auto motion on the stage (hero rotation, moon relay, glows) holds while true. */
  readonly paused = signal(false);

  private readonly _index = signal(0);
  /** True until the first story bar ran out: its fill waits for the entrance. */
  readonly firstRun = signal(true);
  readonly index = computed(() => {
    const n = this.stories().length;
    return n ? this._index() % n : 0;
  });
  readonly current = computed<HeroStory | null>(() => this.stories()[this.index()] ?? null);
  /** One-element list so the headline re-enters (and the old one leaves) on every switch. */
  readonly currentList = computed(() => {
    const c = this.current();
    return c ? [c] : [];
  });

  /** The call to action follows the story on screen. */
  readonly cta = computed(() => {
    const c = this.current();
    return c ? { item: c.item, link: c.link } : null;
  });

  readonly status = computed<BriefingStatus | null>(() =>
    briefingStatus(this.news.patchLines(), this.api.digest()?.patch ?? null, Date.now()),
  );

  private readonly patch = computed(() => this.api.explorer()?.patches[0] ?? null);
  readonly points = computed(() => this.patch()?.constellation?.points ?? null);
  readonly lit = computed(() => Math.min(STARS_PER_PATCH, this.patch()?.starCount ?? 0));
  /** The star map's placement of the lit stars, so both pages light the same ones. */
  readonly litSet = computed(() => explorerLit(this.patch()));
  /** The next line for the Patches hook ("Wann 4.11 kommt …"). */
  readonly nextLine = computed(() => this.status()?.next?.line ?? null);

  /** News count from the digest; the live feed fills in while news_cache is empty. */
  readonly gates = computed<Gate[]>(() => {
    const counts = this.api.digest()?.counts;
    const now = Date.now();
    const feedRecent = this.news
      .stream()
      .filter((i) => now - Date.parse(i.publishedAt) <= WEEK_MS).length;
    const newsRecent = counts?.news.recent || feedRecent;
    const newsTotal = counts?.news.total ?? (this.news.streamCount() || null);
    return [
      { door: 'news', link: '/verse/news', count: newsRecent, total: newsTotal },
      {
        door: 'patches',
        link: '/verse/patches',
        count: counts?.patches.recent ?? 0,
        total: counts?.patches.total ?? (this.news.patchLines().filter((g) => g.line).length || null),
      },
      { door: 'gallery', link: '/verse/gallery', count: counts?.gallery.recent ?? 0, total: counts?.gallery.total ?? null },
    ];
  });

  /** The moons' relay clock, one entry per gate in render order. */
  readonly timings = computed<MoonTiming[]>(() => {
    const n = this.gates().length;
    return this.gates().map((_, i) => moonSchedule(i, n, this.introSeconds));
  });

  /** Per moon: the newest unseen top item of its kind, else null (the count line takes over). */
  readonly moonItems = computed<Record<VerseDoor, VerseDigestItem | null>>(() => {
    const items = this.top();
    const seen = this.api.seen();
    return {
      news: newestFor('news', items, seen),
      patches: newestFor('patches', items, seen),
      gallery: newestFor('gallery', items, seen),
    };
  });

  private stopTracking: (() => void) | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    if (this.api.digestState() === 'idle') void this.api.loadDigest();
    void this.api.loadSeen();
    if (!this.news.feed() && !this.news.loading()) void this.news.refresh(true);

    effect(() => {
      if (this.enabled() && this.auth.isAuthenticated() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });

    // "Gesehen": a story counts as shown once it stood in the hero for 5 s of
    // focused time; the clock restarts with every switch.
    effect(() => {
      const key = this.enabled() ? (this.current()?.item.key ?? null) : null;
      untracked(() => {
        this.stopTracking?.();
        this.stopTracking = key ? this.api.trackShown([key]) : null;
      });
    });
    inject(DestroyRef).onDestroy(() => this.stopTracking?.());

    // One viewport: the stage is 100dvh minus whatever chrome sits above it
    // (topbar height differs per width, banners come and go), measured here
    // and published as --brief-chrome on the host.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const measure = (): void => {
      // Layout offsets, not getBoundingClientRect: the route reveal moves the
      // page with a transform while it enters.
      let top = 0;
      for (let el: HTMLElement | null = host; el; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      host.style.setProperty('--brief-chrome', `${Math.ceil(top)}px`);
    };
    afterNextRender(() => {
      measure();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      ro?.observe(document.body);
      window.addEventListener('resize', measure);
      this.destroyRef.onDestroy(() => {
        ro?.disconnect();
        window.removeEventListener('resize', measure);
      });
    });

    // The briefing carries no page header, so it names itself for the
    // detail pages' origin crumb here.
    const origin = inject(NavOriginService, { optional: true });
    const translate = inject(TranslateService);
    if (origin) {
      const sub = translate.stream('verse.crumb').subscribe((t: string) => origin.rememberTitle('/verse', t));
      inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    }
  }

  /** The active story pill ran out: next story. */
  advance(): void {
    const n = this.stories().length;
    if (n < 2) return;
    this.firstRun.set(false);
    this._index.update((i) => (i + 1) % n);
  }

  /** A pill was pressed: show that story (no navigation) and restart its clock. */
  select(i: number): void {
    if (i < 0 || i >= this.stories().length || i === this.index()) return;
    this.firstRun.set(false);
    this._index.set(i);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  /** Pill fill finished — only the active pill's fill counts. */
  barEnded(i: number, ev: AnimationEvent): void {
    if (ev.target !== ev.currentTarget || i !== this.index()) return;
    this.advance();
  }

  liveKey(days: number | null): string {
    return liveStatusKey(days);
  }

  nextKey(next: NonNullable<BriefingStatus['next']>): string {
    return nextStatusKey(next);
  }

  reload(): void {
    void this.api.loadDigest();
  }

  openItem(item: VerseDigestItem): void {
    void this.api.markSeen([item.key]);
    this.analytics.captureVerse('verse_top_open', {
      key: item.key,
      kind: item.kind,
      rank: item.rank,
      pinned: item.pinned,
    });
  }

  openDoor(door: VerseDoor): void {
    this.analytics.captureVerse('verse_door_open', { door });
  }
}
