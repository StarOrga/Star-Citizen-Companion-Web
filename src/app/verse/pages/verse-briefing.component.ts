import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AppNoticeComponent } from '../../desktop/app-notice.component';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { BetaService } from '../../core/beta.service';
import { AuthService } from '../../auth/auth.service';
import { NewsListComponent } from '../../news/news-list.component';
import { NewsService, VerseNewsItem } from '../../news/news.service';
import { PatchStabilityService } from '../../news/patch-stability.service';
import { PatchStabilityVotesService } from '../../news/patch-stability-votes.service';
import { stabilityTrend } from '../../news/patch-stability';
import { NavOriginService } from '../../shared/page-header/nav-origin.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import { VerseDigestItem, VerseDoor } from '../data/verse.models';
import { STARS_PER_PATCH, defaultPatch } from '../starmap/starmap.model';
import { BriefingMoonComponent, MoonTiming, moonSchedule } from './briefing/briefing-moon.component';
import { BriefingSkyComponent } from './briefing/briefing-sky.component';
import { BriefingBeaconsComponent } from './briefing/briefing-beacons.component';
import { BriefingHubComponent } from './briefing/briefing-hub.component';
import { BriefingPlanetComponent } from './briefing/briefing-planet.component';
import { BriefingAsteroidComponent } from './briefing/briefing-asteroid.component';
import { BriefingTransmitComponent, TransmitItem } from './briefing/briefing-transmit.component';
import {
  BriefingStatus,
  IntroMode,
  briefingStatus,
  claimIntro,
  explorerLit,
  liveStatusKey,
  newestFor,
  nextStatusKey,
  splitChars,
  uniqueStories,
} from './briefing/briefing.model';
import { HUB_NEWS, hubChannel, hubChannels, hubGallery, holoBody, kickerVersion, patchImage } from './briefing/briefing-hub';
import { DockState, wireDock } from './briefing/briefing-dock';
import { VerseItemLink, verseItemLink } from './verse-item-link';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { StageSearchDirective } from '../../shell/fusion-bar/stage-search.directive';
import { StageHeroDirective } from '../../shell/fusion-bar/stage-hero.directive';

export { verseItemLink } from './verse-item-link';
export type { VerseItemLink } from './verse-item-link';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many stories the hero rotates through (one story pill each). */
export const HERO_STORIES = 3;

/** β shell: the hero switches to the next story after this long (held while hovered / focused). */
export const HERO_MS = 7000;
/** The hero title never takes a third line: it shrinks down to this scale first. */
export const TITLE_MIN_SCALE = 0.55;

/** Entrance length in seconds: the full "Anflug" once per session, a short one afterwards. */
export const INTRO_SECONDS: Readonly<Record<IntroMode, number>> = { full: 3.4, short: 0.6 };

/** Hub title sequence (beta shell), seconds at --k 1: letterbox, title cascade, search, calm, details, comet. */
export const HUB_INTRO_SECONDS: Readonly<Record<IntroMode, number>> = { full: 6.4, short: 6.4 * (0.6 / 3.4) };

interface Gate {
  door: VerseDoor;
  link: string;
  count: number;
  total: number | null;
}

/** Stable reorder: the first item of each kind leads (one story per theme), the rest keeps its order. */
export function themesFirst<T extends { kind: string }>(items: readonly T[]): T[] {
  const kinds = new Set<string>();
  const lead: T[] = [];
  const tail: T[] = [];
  for (const it of items) {
    if (kinds.has(it.kind)) tail.push(it);
    else {
      kinds.add(it.kind);
      lead.push(it);
    }
  }
  return [...lead, ...tail];
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

/** From this many characters the hero title starts to shrink (in steps), before the line fit does the rest. */
export const TITLE_SHRINK_FROM = 40;

/** Start scale for a title of `len` characters: 1 up to {@link TITLE_SHRINK_FROM}, then one step per 12 characters. */
export function titleStartScale(len: number): number {
  if (len <= TITLE_SHRINK_FROM) return 1;
  const steps = Math.ceil((len - TITLE_SHRINK_FROM) / 12);
  return Math.max(TITLE_MIN_SCALE, 1 - steps * 0.1);
}

/**
 * Keeps the hero title at two lines at most: starts smaller for long titles
 * ({@link titleStartScale}), shrinks the font (down to {@link TITLE_MIN_SCALE})
 * before a third line would appear, then sizes the heading to its longest line
 * so the chevrons hang at the text, not the box. Only a title that still needs
 * more than two lines at the smallest size is cut (CSS ellipsis); returns true
 * then, so the full title can go into a tooltip.
 */
export function fitTitle(h: HTMLElement): boolean {
  const a = h.querySelector<HTMLElement>('.tl');
  if (!a) return false;
  h.style.width = '';
  let scale = titleStartScale((a.textContent ?? '').trim().length);
  h.style.setProperty('--fit', scale.toFixed(2));
  const lines = (): number => {
    const lh = parseFloat(getComputedStyle(a).lineHeight) || a.getBoundingClientRect().height || 1;
    return Math.round(a.getBoundingClientRect().height / lh);
  };
  while (lines() > 2 && scale > TITLE_MIN_SCALE) {
    scale = Math.max(TITLE_MIN_SCALE, scale - 0.06);
    h.style.setProperty('--fit', scale.toFixed(2));
  }
  const clipped = lines() > 2;
  // One line (the normal case): the heading already hugs its text — a fixed
  // width would only freeze a measurement taken before the display font loaded.
  if (lines() <= 1) return false;
  const w = Array.from(a.getClientRects()).reduce((m, r) => Math.max(m, r.width), 0);
  if (w > 0) h.style.width = `${Math.ceil(w) + 1}px`;
  return clipped;
}

/**
 * `/verse` — the briefing.
 *
 * β "shell" (concept "Funkfeuer 2"): one cinematic stage on its own big
 * planet (the bottom third). Top right the beacons — the sun (patch status)
 * and the current patch's constellation (star map). The hero stands centred
 * in the upper two thirds: area kicker, the story title as the link (two lines
 * at most, chevrons at the text on hover/focus, auto switch every 7 s held
 * while hovered) and the search capsule. Above the rim, Crusader (News),
 * ArcCorp (Patches) and microTech (Galerie) take turns transmitting their
 * newest item to the holo in the planet. Below, the hub columns on the
 * planet's night side.
 *
 * Without the shell β: the "Anflug" stage (nebula, horizon, story pills,
 * moon gates). β "verse" off: the legacy landing (the Verse News list).
 */

@Component({
  selector: 'sc-verse-briefing',
  standalone: true,
  imports: [
    StageSearchDirective,
    StageHeroDirective,
    RouterLink, TranslatePipe, ScTooltipDirective, AppNoticeComponent, NewsListComponent, BriefingMoonComponent, BriefingSkyComponent,
    BriefingBeaconsComponent, BriefingTransmitComponent, BriefingHubComponent, BriefingPlanetComponent, BriefingAsteroidComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing/verse-briefing.component.html',
  styleUrls: ['./briefing/verse-briefing.component.scss', './briefing/verse-briefing-planet.scss'],
})
export class VerseBriefingComponent {
  protected readonly api = inject(VerseApiService);
  protected readonly news = inject(NewsService);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly beta = inject(BetaService);
  private readonly stability = inject(PatchStabilityService);
  private readonly votes = inject(PatchStabilityVotesService);
  private readonly translate = inject(TranslateService);
  private readonly chrome = inject(ShellChromeService);
  readonly enabled = this.beta.isEnabled('verse');
  /** β "shell": the "Funkfeuer 2" stage and the hub columns below it. */
  readonly shell = this.beta.isEnabled('shell');
  readonly total = STARS_PER_PATCH;

  readonly top = this.api.topItems;

  /** Claimed only when the cinematic actually renders. */
  readonly intro: IntroMode = this.enabled() ? claimIntro() : 'short';
  readonly introSeconds = INTRO_SECONDS[this.intro];

  /**
   * The newest editorial news from the live feed as a digest item — the digest
   * reads news_cache, which stays empty while the feed comes from the
   * fetch-verse-news edge function, so the hero would otherwise never show news.
   */
  private readonly feedNews = computed<VerseDigestItem[]>(() => {
    const newest = (this.news.feed()?.news ?? [])
      .filter((n) => n.source !== 'patch-notes' && n.source !== 'status')
      .reduce<VerseNewsItem | null>((a, n) => (!a || n.publishedAt > a.publishedAt ? n : a), null);
    if (!newest) return [];
    return [{
      key: `news:${newest.source}:${newest.id}`,
      kind: 'news',
      title: newest.title,
      url: newest.url,
      summary: newest.summary ?? null,
      image: newest.thumbnail ?? null,
      at: newest.publishedAt,
      pinned: false,
      score: 0,
      rank: Number.MAX_SAFE_INTEGER,
    }];
  });

  /** The rotating stories: up to {@link HERO_STORIES} distinct top items with a usable link (see `uniqueStories`), one per theme first. */
  readonly stories = computed<HeroStory[]>(() => {
    const seen = this.api.seen();
    // The top list first; the rest of the digest (rank order) fills what the dedupe removed.
    const rest = [...(this.api.digest()?.items ?? [])].sort((x, y) => x.rank - y.rank);
    const candidates = themesFirst([...this.top(), ...rest, ...this.feedNews()]);
    return uniqueStories(candidates, (i) => verseItemLink(i.url), linkKey, HERO_STORIES).map(({ item, link }) => ({
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

  /** The current patch (the map's default), never a tipped line still in testing. */
  private readonly patch = computed(() => {
    const st = this.api.explorer();
    return st ? defaultPatch(st) : null;
  });
  /**
   * The constellation renders only for a loaded patch: before that (and signed
   * out, where nothing loads) there is no figure at all, so the reader never
   * sees a stand-in that then jumps to the real one.
   */
  readonly skyReady = computed(() => this.patch() !== null);
  readonly points = computed(() => this.patch()?.constellation?.points ?? null);
  readonly lit = computed(() => Math.min(STARS_PER_PATCH, this.patch()?.starCount ?? 0));
  /** The star map's placement of the lit stars, so both pages light the same ones. */
  readonly litSet = computed(() => explorerLit(this.patch()));
  /** The constellation's patch, in the star map's wording ("Sternbild von Patch 4.4"). */
  readonly starPatch = computed(() => this.patch()?.patchLine ?? null);
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

  /** The LIVE build and its stability, for the sun's hover line ("LIVE 4.3.1 · Stabilität 50 %"). */
  readonly kicker = computed(() => {
    const patch = this.api.digest()?.patch ?? null;
    const line = this.status()?.live.line ?? patch?.line ?? null;
    const version = kickerVersion(patch?.channels, line);
    if (!version) return null;
    const v = line ? this.stability.verdictFor(line) : null;
    const base = v && !v.insufficient && v.stability !== null ? v.stability : null;
    if (base === null || !v) return { version, stability: null, trend: null };
    // The same number the LIVE chip shows: computed stability plus the community correction (once the votes are loaded).
    const corr = this.votes.line() === v.line ? (this.votes.correctionFor(base)?.correction ?? 0) : 0;
    const shown = Math.min(100, Math.max(0, Math.round(base + corr)));
    const prev = this.stability.previousOf(v.line);
    return { version, stability: shown, trend: v.early ? null : stabilityTrend(shown, prev?.percent ?? null) };
  });

  // ── β shell: hub data ────────────────────────────────────────────────
  readonly hubNews = computed<VerseNewsItem[]>(() => {
    const st = this.news.stage();
    // Newest first, whatever order the stage item and the stream arrive in.
    return [...(st ? [st] : []), ...this.news.stream()]
      .filter((n, i, all) => all.findIndex((m) => m.id === n.id) === i)
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
      .slice(0, HUB_NEWS);
  });
  /** Known patch lines (feed + stability table) for "the line before". */
  private readonly knownLines = computed(() => [
    ...new Set([...this.news.patchLines().map((g) => g.line).filter(Boolean), ...(this.stability.allTime?.() ?? []).map((v) => v.line)]),
  ]);
  private readonly channelMap = computed<Readonly<Record<string, string>> | null>(() => {
    const ch = this.api.digest()?.patch?.channels ?? null;
    const line = this.status()?.live.line ?? null;
    return ch?.['live'] || !line ? ch : { ...(ch ?? {}), live: line };
  });
  /** The LIVE feature (null until a LIVE build is known). */
  readonly hubLive = computed(() => {
    const c = hubChannel('live', this.channelMap(), this.knownLines(), (l) => this.stability.verdictFor(l));
    return c.version ? c : null;
  });
  /** Hotfix / PTU / Evocati — always three slots. */
  readonly hubChannels = computed(() =>
    hubChannels(this.channelMap(), this.knownLines(), (l) => this.stability.verdictFor(l), this.api.digest()?.patch?.channelInfo ?? null),
  );
  readonly hubPatchImage = computed(() => patchImage(this.news.patchLines()));
  readonly hubGallery = computed(() => hubGallery(this.api.digest()?.items ?? []));
  readonly liveDays = computed(() => this.status()?.live.days ?? null);
  /** The sun leads to the LIVE patch's status. */
  readonly sunLink = computed<string | string[]>(() => {
    const line = this.hubLive()?.line ?? this.status()?.live.line ?? null;
    return line ? ['/verse/patches', line] : '/verse/patches';
  });

  /** Bumped on a language switch: the holo types plain strings. */
  private readonly lang = signal(0);

  /** The holo's messages, News → Patches → Galerie: each area's newest item. */
  readonly transmit = computed<TransmitItem[]>(() => {
    this.lang();
    const t = (k: string, p?: object): string => this.translate.instant(k, p);
    const digest = [...this.top(), ...(this.api.digest()?.items ?? [])];
    const none = new Set<string>();
    const out: TransmitItem[] = [];
    const n = this.hubNews()[0];
    const dn = newestFor('news', digest, none);
    if (n) {
      out.push({
        key: `news:${n.id}`, door: 'news', title: n.title, body: holoBody(n.summary || t('verse.gates.news.hook')),
        internal: true, path: '/verse/news', query: { item: n.id },
      });
    } else if (dn) {
      out.push(this.txItem(dn, 'news', t('verse.gates.news.hook')));
    }
    const next = this.nextLine();
    const pHook = next ? t('verse.gates.patches.hook', { next }) : t('verse.gates.patches.hookNoLine');
    const p = newestFor('patches', digest, none);
    const lv = this.hubLive();
    if (p) out.push(this.txItem(p, 'patches', pHook));
    else if (lv) {
      out.push({
        key: `patch:${lv.version}`, door: 'patches', title: t('verse.hub.patchTitle', { v: lv.version }), body: holoBody(pHook),
        internal: true, path: `/verse/patches/${lv.line}`, query: null,
      });
    }
    const g = newestFor('gallery', digest, none);
    if (g) out.push(this.txItem(g, 'gallery', t('verse.gates.gallery.hook')));
    return out;
  });

  /** The scroll flight stage → hub (briefing-dock): where the page stands, and whether the planets fly. */
  readonly dock = signal<DockState>('top');
  readonly dockFlying = signal(false);

  /** Pointer / focus on the hero title: the auto switch holds. */
  readonly heroHold = signal(false);
  private readonly titleEl = viewChild<ElementRef<HTMLElement>>('titleEl');
  /** The asteroid's closest pass: stage and planet shake once. */
  readonly quake = signal(false);
  private quakeTimer: ReturnType<typeof setTimeout> | undefined;

  shake(): void {
    clearTimeout(this.quakeTimer);
    this.quake.set(true);
    this.quakeTimer = setTimeout(() => this.quake.set(false), 600);
  }

  private stopTracking: (() => void) | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  constructor() {
    if (this.api.digestState() === 'idle') void this.api.loadDigest();
    void this.api.loadSeen();
    if (!this.news.feed() && !this.news.loading()) void this.news.refresh(true);

    effect(() => {
      if (this.enabled() && this.auth.isAuthenticated() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });

    if (this.shell()) this.wireStage();
    if (this.shell()) this.startTitleIntro();

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
      // One frame later: the custom property resizes the page, i.e. the observed body
      // (a synchronous write here is a ResizeObserver loop on phones).
      let frame = 0;
      const later = () => {
        if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
      };
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
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
    if (origin) {
      const sub = this.translate.stream('verse.crumb').subscribe((t: string) => origin.rememberTitle('/verse', t));
      inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    }
  }

  /** β shell: stability load, the hero's auto switch, the title fit, language bumps. */
  private wireStage(): void {
    const on = (): boolean => this.enabled() && this.shell();
    effect(() => {
      if (on()) void this.stability.load();
    });
    effect(() => {
      const line = this.hubLive()?.line;
      if (on() && line) untracked(() => this.votes.ensure(line));
    });
    // Auto switch every HERO_MS; any switch (chevron or auto) restarts the clock.
    effect((onCleanup) => {
      const n = this.stories().length;
      this.index();
      if (!on() || this.heroHold() || n < 2) return;
      const id = setTimeout(() => this.advance(), HERO_MS);
      onCleanup(() => clearTimeout(id));
    });
    const sub = this.translate.onLangChange.subscribe(() => this.lang.update((v) => v + 1));
    this.destroyRef.onDestroy(() => sub.unsubscribe());
    afterRenderEffect(() => {
      this.current();
      const el = this.titleEl()?.nativeElement;
      if (el) this.titleClipped.set(fitTitle(el));
    });
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const zone = inject(NgZone);
    afterNextRender(() => {
      const d = wireDock(host, zone);
      this.glide = d.glide;
      effect(() => {
        this.dock.set(d.state());
        this.dockFlying.set(d.flying());
      }, { injector: this.injector });
      this.destroyRef.onDestroy(d.destroy);
    });
    afterNextRender(() => {
      const refit = (): void => {
        const el = this.titleEl()?.nativeElement;
        if (el) this.titleClipped.set(fitTitle(el));
      };
      window.addEventListener('resize', refit);
      // The display font arrives after the first fit: measure again with it.
      document.fonts?.ready.then(refit).catch(() => undefined);
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', refit));
    });
  }

  private txItem(item: VerseDigestItem, door: VerseDoor, fallback: string): TransmitItem {
    const l = verseItemLink(item.url);
    return {
      key: item.key, door, title: item.title, body: holoBody(item.summary || fallback),
      internal: l?.internal ?? true, path: l?.path ?? `/verse/${door}`, query: (l?.query as Record<string, string> | null) ?? null,
    };
  }

  holdHero(hold: boolean): void {
    this.heroHold.set(hold);
  }

  heroFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next)) this.heroHold.set(false);
  }

  /** Chevron: previous / next story (restarts the auto clock, does not stop it). */
  step(dir: 1 | -1): void {
    const n = this.stories().length;
    if (n < 2) return;
    this.firstRun.set(false);
    this._index.set((this.index() + dir + n) % n);
  }

  /** True while the title letters cascade in; afterwards the title renders as plain text again. */
  readonly titleIntro = signal(false);
  /** The hero title needed more than two lines even at the smallest size: it is cut with an ellipsis. */
  readonly titleClipped = signal(false);

  /** Splits the hub title into letters for the entrance only (never under reduced motion). */
  private startTitleIntro(): void {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !this.enabled()) return;
    this.titleIntro.set(true);
    // The shell reveals its search field and (first visit) the main header in step with it.
    this.chrome.startHeroIntro(this.intro === 'full' ? 1 : INTRO_SECONDS.short / INTRO_SECONDS.full, this.intro === 'full');
    const id = setTimeout(() => {
      this.titleIntro.set(false);
      this.chrome.endHeroIntro();
    }, (HUB_INTRO_SECONDS[this.intro] + 0.4) * 1000);
    this.destroyRef.onDestroy(() => {
      clearTimeout(id);
      this.chrome.endHeroIntro();
    });
  }

  /** Letters of a (translated) title for the cascade. */
  chars(text: string): readonly { readonly c: string; readonly i: number }[] {
    return splitChars(text);
  }

  /** The dock's glide (briefing-dock), set once the stage rendered. */
  private glide: ((dir: number) => boolean) | null = null;

  /** "Mehr im Verse": all the way down — the hub and the footer fill the last viewport. */
  toHub(): void {
    if (this.glide?.(1)) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }

  openTransmit(item: TransmitItem): void {
    const d = [...this.top(), ...(this.api.digest()?.items ?? [])].find((i) => i.key === item.key);
    if (d) this.openItem(d);
    else this.openDoor(item.door);
  }

  /** The stage search line opens the app search (same path as Ctrl+K). */
  openSearch(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
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

  retryNews(): void {
    void this.news.refresh(true);
  }

  itemLink(item: VerseDigestItem): VerseItemLink | null {
    return verseItemLink(item.url);
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
