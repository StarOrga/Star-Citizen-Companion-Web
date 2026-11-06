import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { NavOriginService } from '../../shared/page-header/nav-origin.service';
import { TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { CodexService, PolySearchResult, SearchAllFilters, toLang } from '../codex.service';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { HqSuppliesService } from '../../hq/hq-supplies.service';
import { SearchWishlistService } from './search-wishlist.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import { NewsService } from '../../news/news.service';
import { SearchContext, neutralContext } from '../../shell/fusion-bar/search-context';
import { composeSearchResult } from './search-compose';
import { FitItemPort, FitLoadoutEntry, FitPort, buildFitPorts, fitVerdict } from './search-compat';
import { AliasReading, aliasReadings, setAliasLanguage } from './search-aliases';
import { OwnSources, searchOwn } from './search-own';
import { OwnSetEntry, ownSetGroups, ownSetOf } from './search-own-sets';
import { WishNamesService } from './wish-names.service';
import { parseQuery, switchChip } from './search-query-parse';
import { RowOwnership, SearchChip, SearchResult, SearchResultRow } from './search-result-model';
import { SearchSignalsService } from './search-signals.service';
import {
  GalleryMatch, GalleryRpcRow, MissionMatch, MissionRpcRow, SourceResult, mapGalleryRows, mapMissionRows, searchPatches,
} from './search-sources';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { PolyHitKind, PolySearchHit, toPolyHit } from '../codex-poly-search';
import { mergeSuggestions } from '../codex-did-you-mean.component';
import { humanizeClassName } from '../codex-format';
import { Lang, LoadoutEntry } from '../codex.types';
import { stockLoadoutClassNames } from '../stock-loadout';
import {
  CodexSearchGroup,
  GroupCounts,
  SearchOption,
  SearchTarget,
  clearRecentSearches,
  groupHits,
  pushRecentSearch,
  readRecentSearches,
  resultOptions,
  suggestionOptions,
  targetUrl,
} from './codex-search-model';

export const SEARCH_DEBOUNCE_MS = 220;
/** How many of the patch's new ships an empty field offers. */
const FRESH_SHIPS_SHOWN = 4;

/** Aliases / chips named in the "gelesen als" line at most. */
const READINGS_SHOWN = 3;

/** What the search understood from the typed words (C6). */
export interface SearchReadings {
  aliases: AliasReading[];
  chips: { word: string; chip: SearchChip }[];
}

/** What a key press in the search field asks the host to do. */
export type SearchKeyAction = 'open' | 'open-new-tab' | 'escape' | null;

/**
 * The ONE Codex search: debounced term → `CodexService.searchAll` (every kind
 * plus announced ships) → shared ranking (codex-poly-search) → groups by kind
 * with a per-group cap, totals and "all N in the index" targets, plus recent
 * searches and suggestions for an empty field and the listbox keyboard model.
 *
 * Deliberately NOT providedIn root: every search surface (the Ctrl+K overlay,
 * the landing terminal, the Codex page bar) provides its own instance, so two
 * surfaces never share a half-typed term. Everything that should be shared —
 * the data, the ranking, the recent searches (localStorage) — already is.
 */
@Injectable()
export class CodexSearchEngine {
  private readonly codex = inject(CodexService);
  // Resolved on first use: the diff is only needed once an empty field opens.
  private readonly injector = inject(Injector);
  private readonly t = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly navOrigin = inject(NavOriginService);

  /** Hits shown per kind (5 in the overlay, more on the landing). */
  readonly perGroup = signal(5);
  /** What is in the field right now. */
  readonly input = signal('');
  /** The term the results belong to (the debounced input). */
  readonly term = signal('');
  readonly loading = signal(false);
  /** i18n key of a failed search — never raw text, never shown as "no results". */
  readonly error = signal<string | null>(null);
  /**
   * i18n key of a PARTIAL failure: some kinds could not be searched, the rest
   * answered. The hits stay; the UI adds a quiet "some areas missing — retry".
   */
  readonly partialError = signal<string | null>(null);
  readonly hits = signal<PolySearchHit[]>([]);
  readonly totals = signal<Partial<Record<PolyHitKind, number>>>({});
  /** Per kind: distinct cards and rows read — the group pill counts cards. */
  readonly counts = signal<GroupCounts>({});
  /** "Did you mean" names for a search that found nothing. */
  readonly didYouMean = signal<string[]>([]);
  readonly recent = signal<string[]>(readRecentSearches(storage()));
  /** Ships new in this patch, offered while the field is empty. */
  readonly fresh = signal<PolySearchHit[]>([]);
  /** Index into `options()`, or -1 for "nothing active". */
  readonly activeIndex = signal(-1);

  readonly hasTerm = computed(() => this.term().trim().length > 0);
  /**
   * The catalog groups of the term. "gemerkt" / "fehlt mir" make the reader's own set the pool
   * (the term only narrows it, A10), "lager" / "inventar" take the catalog out altogether.
   */
  readonly groups = computed<CodexSearchGroup[]>(() => {
    if (!this.hasTerm()) return [];
    const chips = this.activeChips();
    const set = ownSetOf(chips);
    if (set) return ownSetGroups(this.ownSetEntries(set), this.searchText(), this.wishNames().nameOf);
    if (chips.some((c) => c.filter.ownOnly)) return [];
    return groupHits(this.searchText(), this.hits(), this.totals(), this.perGroup(), this.counts());
  });
  /** Server-filtered groups plus the unfiltered extras (candidates for the outside group). */
  private readonly mergedGroups = computed<CodexSearchGroup[]>(() => {
    const inside = this.groups();
    const base = this.baseResult();
    if (!base || ownSetOf(this.activeChips()) || this.activeChips().some((c) => c.filter.ownOnly)) return inside;
    const extra = groupHits(this.searchText(), base.hits, base.totals, this.perGroup(), { distinct: base.distinct, read: base.read });
    const out = inside.map((g) => ({ ...g }));
    for (const e of extra) {
      const mine = out.find((g) => g.kind === e.kind);
      if (!mine) {
        out.push(e);
        continue;
      }
      const have = new Set(mine.hits.map((h) => h.classNameSlug));
      mine.hits = [...mine.hits, ...e.hits.filter((h) => !have.has(h.classNameSlug))];
    }
    return out;
  });
  readonly options = computed<SearchOption[]>(() =>
    this.input().trim() ? resultOptions(this.groups()) : suggestionOptions(this.recent(), this.fresh()),
  );
  readonly activeOption = computed<SearchOption | null>(() => this.options()[this.activeIndex()] ?? null);

  // -- context, chips and the composed result (concept 2026-11-02) ---------------
  /** Where the reader stands; the host sets it (route + section). Its chips filter. */
  readonly context = signal<SearchContext>(neutralContext());
  /** Chips the reader removed (x / Backspace), by id. Reset when the page's chips change. */
  readonly dismissedChips = signal<ReadonlySet<string>>(new Set());
  private readonly chipOverrides = signal<ReadonlyMap<string, { from: string; chip: SearchChip }>>(new Map());
  /** The field parsed right now (chips appear as you type). */
  readonly inputParsed = computed(() => parseQuery(this.input()));
  /** The searched text: the term without the words that became chips. */
  readonly searchText = computed(() => parseQuery(this.term()).rest);
  /** Context chips plus chips from the text, minus removed ones, with menu switches applied. */
  readonly activeChips = computed<SearchChip[]>(() => {
    const dismissed = this.dismissedChips();
    const overrides = this.chipOverrides();
    return [...this.context().chips, ...parseQuery(this.term()).chips]
      .filter((c) => !dismissed.has(c.id))
      .map((c) => {
        const o = overrides.get(c.id);
        return o && o.from === JSON.stringify(c.filter) ? o.chip : c;
      });
  });
  /**
   * What the search read for the reader: aliases that fired ("rep" → Repeater) and words that
   * became chips ("s4" → Größe 4). Drives the quiet line at the top of the panel (C6).
   */
  readonly readings = computed<SearchReadings>(() => {
    const parsed = parseQuery(this.term());
    const active = new Set(this.activeChips().map((c) => c.id));
    return {
      aliases: aliasReadings(parsed.rest, this.lang()).slice(0, READINGS_SHOWN),
      chips: parsed.chips
        .filter((c) => active.has(c.id) && parsed.words[c.id])
        .map((c) => ({ word: parsed.words[c.id], chip: this.activeChips().find((a) => a.id === c.id) ?? c }))
        .slice(0, READINGS_SHOWN),
    };
  });
  /** The unfiltered hits beside a size/grade-filtered search: outside group and menu counts. */
  private readonly baseResult = signal<PolySearchResult | null>(null);
  private readonly facets = signal<PolySearchResult['facets'] | null>(null);
  private readonly galleryRows = signal<SourceResult<GalleryMatch> | null>(null);
  private readonly missionRows = signal<SourceResult<MissionMatch> | null>(null);
  private readonly compatPorts = signal<{ key: string; ports: FitPort[] } | null>(null);
  private readonly shipNames = signal<ReadonlyMap<string, string>>(new Map());
  private ownDataRequested = false;
  private compatRequested: string | null = null;
  private readonly namesRequested = new Set<string>();

  /** The composed result the fusion bar renders (search-result-model.ts). */
  readonly result = computed<SearchResult>(() => {
    const text = this.searchText();
    const chips = this.activeChips();
    const ctx = this.context();
    const hasText = text.trim().length > 0;
    const signedIn = this.signedIn();
    const ownership = this.ownershipFn();
    const signals = this.signals().signals((cls) => this.owns(cls));
    const ownKinds = chips.find((c) => c.filter.ownKinds)?.filter.ownKinds;
    // "lager" alone lists the whole Inventar (an empty term would match nothing otherwise).
    const ownOnly = chips.some((c) => c.filter.ownOnly);
    const own = signedIn && (hasText || ownOnly)
      ? searchOwn(text, this.ownSources(), {
          limit: this.perGroup(),
          nameOf: (c) => this.shipNames().get(c.toLowerCase()) ?? null,
          kinds: ownKinds,
          all: ownOnly,
        })
      : null;
    const compat = chips.find((c) => c.filter.compatWith)?.filter.compatWith;
    const ports = compat?.kind === 'ship' && this.compatPorts()?.key === compat.className ? this.compatPorts()!.ports : null;
    return composeSearchResult({
      term: text,
      groups: this.mergedGroups(),
      context: ctx,
      chips,
      own,
      patches: hasText ? searchPatches(text, this.news().patchLines(), this.perGroup()) : null,
      gallery: hasText ? this.galleryRows() : null,
      missions: hasText ? this.missionRows() : null,
      signals,
      ownership,
      fit: compat?.kind === 'ship' ? (hit) => fitVerdict(hit, ports) : undefined,
      signedIn,
      flagshipClassName: signedIn ? this.hangar().flagshipClassName() : null,
      // Montieren (Chip Schiff): the reader's own ship of that class, from the local hangar list.
      ownShipIdFor: signedIn
        ? (cls) => this.hangar().ships().find((s) => s.shipClassName.toLowerCase() === cls.toLowerCase())?.id ?? null
        : undefined,
      wished: signedIn ? (hit) => this.wishlist().has(hit.kind, hit.classNameSlug, hit.nameLocalized) : undefined,
      needed: signedIn ? this.neededFn() : undefined,
      didYouMean: this.didYouMean(),
      facets: this.facets(),
      ownSet: ownSetOf(chips) !== null,
    });
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private freshRequested = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
  }

  lang(): Lang {
    return toLang(this.t.getCurrentLang() ?? this.t.getFallbackLang());
  }

  /** The field changed: debounce the search; an empty field drops results at once. */
  setInput(value: string): void {
    this.input.set(value);
    this.activeIndex.set(-1);
    this.cancelTimer();
    this.trySignals()?.cancelMiss();
    if (!value.trim()) {
      this.setTerm('');
      return;
    }
    this.timer = setTimeout(() => this.setTerm(value), SEARCH_DEBOUNCE_MS);
  }

  /** Run the field's term now (Enter before the debounce fired). True when it started a search. */
  commit(): boolean {
    if (this.input().trim() === this.term().trim()) return false;
    this.cancelTimer();
    this.setTerm(this.input());
    return true;
  }

  /** Put `term` in the field and search it immediately (a suggestion, a recent search, `?q=`). */
  searchFor(term: string): void {
    this.cancelTimer();
    this.input.set(term);
    this.activeIndex.set(-1);
    this.setTerm(term);
  }

  clear(): void {
    this.searchFor('');
  }

  retry(): void {
    if (this.term().trim()) void this.run();
  }

  // -- context, chips ---------------------------------------------------------

  /** The host reports where the reader stands. Resets removed chips when the page's chips changed. */
  setContext(ctx: SearchContext): void {
    const sig = (c: SearchChip): string => c.id + JSON.stringify(c.filter);
    const was = this.context().chips.map(sig).join();
    this.context.set(ctx);
    if (ctx.chips.map(sig).join() !== was) {
      this.dismissedChips.set(new Set());
      this.chipOverrides.set(new Map());
    }
    this.loadCompat();
    if (this.hasTerm()) void this.run();
  }

  /** Remove a chip (x, or Backspace at the start of the field for the last one). */
  removeChip(id: string): void {
    this.dismissedChips.set(new Set([...this.dismissedChips(), this.originalChipId(id)]));
    if (this.hasTerm()) void this.run();
  }

  /** Remove the last chip (Backspace at the start of the field). Returns its id or null. */
  removeLastChip(): string | null {
    const last = this.activeChips().at(-1);
    if (!last) return null;
    this.removeChip(last.id);
    return last.id;
  }

  /** Pick another value from a chip's menu (S1 to S3). */
  setChipValue(id: string, value: string): void {
    id = this.originalChipId(id);
    const original = [...this.context().chips, ...parseQuery(this.term()).chips].find((c) => c.id === id);
    if (!original) return;
    const next = switchChip(original, value);
    if (next === original) return;
    this.chipOverrides.set(new Map(this.chipOverrides()).set(id, { from: JSON.stringify(original.filter), chip: next }));
    if (this.hasTerm()) void this.run();
  }

  /** A chip switched from its menu carries a new id; menus and x act on the chip it came from. */
  private originalChipId(id: string): string {
    for (const [orig, o] of this.chipOverrides()) if (o.chip.id === id) return orig;
    return id;
  }

  /** Load what the extra sources need (own HQ data, news for patches). Safe to call on every open. */
  ensureSources(): void {
    this.trySignals()?.ensurePopularity();
    if (this.ownDataRequested) return;
    this.ownDataRequested = true;
    try {
      const news = this.news();
      if (!news.feed() && !news.loading()) void news.refresh(true);
      if (this.signedIn()) {
        void this.ownership().ensureLoaded();
        this.wishlist().ensureLoaded();
        const inv = this.inventory();
        if (!inv.loaded() && !inv.loading()) void inv.load();
      }
    } catch {
      /* the extra sources are a courtesy */
    }
  }

  /** A result row was opened: remember it (recent searches, recent opens) and count the open. */
  noteOpened(row: SearchResultRow): void {
    this.remember();
    if (row.type === 'hit') {
      this.trySignals()?.recordOpen(row.hit.kind, row.hit.classNameSlug);
      this.navOrigin.noteSearchArrival(this.term(), row.target.link);
    }
  }

  /** Remember the current term — called when a hit is opened from it. */
  remember(term = this.term()): void {
    if (term.trim()) this.recent.set(pushRecentSearch(storage(), this.recent(), term));
  }

  /**
   * A hit or a "show all" row is being opened: keep the term as a recent
   * search, and tell the page history that a hit's page was reached from this
   * search, so its breadcrumb leads back to the results (NavOriginService).
   */
  opening(opt: SearchOption): void {
    if (opt.type !== 'hit' && opt.type !== 'more') return;
    this.remember();
    if (opt.type === 'hit') {
      this.navOrigin.noteSearchArrival(this.term(), opt.target.link);
      this.trySignals()?.recordOpen(opt.hit.kind, opt.hit.classNameSlug);
    }
  }

  forgetRecent(): void {
    clearRecentSearches(storage());
    this.recent.set([]);
  }

  /** Load the patch's new ships once, for the empty-field suggestions. */
  ensureSuggestions(): void {
    if (this.freshRequested) return;
    this.freshRequested = true;
    void this.injector
      .get(CodexBuildDiffService)
      .addedShipsMemo()
      .then((rows) => this.fresh.set(rows.slice(0, FRESH_SHIPS_SHOWN).map((r) => toPolyHit('ship', r))))
      .catch(() => this.fresh.set([]));
  }

  setActive(index: number): void {
    const n = this.options().length;
    this.activeIndex.set(n === 0 ? -1 : Math.max(-1, Math.min(n - 1, index)));
  }

  /**
   * The listbox keyboard model. Arrows move across groups (wrapping), Home/End
   * jump to the ends — handled here. Enter, Ctrl/⌘+Enter and Escape are
   * returned for the host, which owns navigation and its own open/closed state.
   */
  keyAction(ev: KeyboardEvent): SearchKeyAction {
    const n = this.options().length;
    switch (ev.key) {
      case 'ArrowDown':
        if (!n) return null;
        ev.preventDefault();
        this.activeIndex.set(this.activeIndex() >= n - 1 ? 0 : this.activeIndex() + 1);
        return null;
      case 'ArrowUp':
        if (!n) return null;
        ev.preventDefault();
        this.activeIndex.set(this.activeIndex() <= 0 ? n - 1 : this.activeIndex() - 1);
        return null;
      case 'Home':
      case 'End':
        // In the field, Home/End move the caret — only claim them once a row is active.
        if (!n || this.activeIndex() < 0) return null;
        ev.preventDefault();
        this.activeIndex.set(ev.key === 'Home' ? 0 : n - 1);
        return null;
      case 'Enter':
        ev.preventDefault();
        if (this.commit()) return null; // results are not there yet
        return ev.ctrlKey || ev.metaKey ? 'open-new-tab' : 'open';
      case 'Escape':
        ev.preventDefault();
        return 'escape';
      default:
        return null;
    }
  }

  /** The option Enter opens: the active one, else the first hit. */
  enterOption(): SearchOption | null {
    return this.activeOption() ?? (this.input().trim() ? (this.options()[0] ?? null) : null);
  }

  /**
   * Open an option the way its anchor would. A recent search runs in place
   * ('searched'); everything else navigates ('navigated') or, with
   * `newTab`, opens a new tab and leaves the search as it is ('new-tab').
   */
  open(opt: SearchOption, newTab = false): 'navigated' | 'searched' | 'new-tab' {
    if (opt.type === 'recent' && !newTab) {
      this.searchFor(opt.term);
      return 'searched';
    }
    this.opening(opt);
    if (newTab) {
      window.open(this.location.prepareExternalUrl(targetUrl(opt.target)), '_blank', 'noopener');
      return 'new-tab';
    }
    void this.navigate(opt.target);
    return 'navigated';
  }

  /** The href of a target, for anchors built without routerLink. */
  href(target: SearchTarget): string {
    return this.location.prepareExternalUrl(targetUrl(target));
  }

  private navigate(t: SearchTarget): Promise<boolean> {
    return this.router.navigate(t.link, {
      queryParams: t.queryParams ?? undefined,
      ...(t.fragment ? { fragment: t.fragment } : {}),
    });
  }

  private setTerm(term: string): void {
    this.term.set(term);
    if (!term.trim()) {
      this.clearResults();
      return;
    }
    void this.run();
  }

  /** Invalidate a search still in flight, or its hits land after the clear, and empty every source. */
  private clearResults(): void {
    this.seq++;
    this.hits.set([]);
    this.totals.set({});
    this.counts.set({});
    this.baseResult.set(null);
    this.facets.set(null);
    this.galleryRows.set(null);
    this.missionRows.set(null);
    this.error.set(null);
    this.partialError.set(null);
    this.didYouMean.set([]);
    this.loading.set(false);
  }

  private async run(): Promise<void> {
    const term = parseQuery(this.term().trim()).rest;
    const attrs = serverAttrs(this.activeChips());
    const hasAttrs = attrs.size != null || !!attrs.grade;
    if (!term && !hasAttrs) {
      // Own-data words alone ("gemerkt") read no catalog: drop what an earlier term left behind.
      this.clearResults();
      return;
    }
    setAliasLanguage(this.lang());
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.partialError.set(null);
    this.didYouMean.set([]);
    try {
      const { hits, totals, distinct, read, failed, failure, facets } = await (hasAttrs ? this.codex.searchAll(term, this.perGroup(), attrs) : this.codex.searchAll(term, this.perGroup()));
      if (seq !== this.seq) return; // a newer search superseded this one
      this.hits.set(hits);
      this.totals.set(totals);
      this.counts.set({ distinct, read });
      this.baseResult.set(null);
      this.facets.set(facets ?? null);
      if (hasAttrs && term) {
        // Beside a size/grade filter: the same search unfiltered feeds the menu counts and the outside group.
        const base = await this.codex.searchAll(term, this.perGroup()).catch(() => null);
        if (seq !== this.seq) return;
        this.baseResult.set(base);
        this.facets.set(base?.facets ?? facets ?? null);
      }
      this.galleryRows.set(null);
      void this.loadGallery(seq, term);
      this.missionRows.set(null);
      void this.loadMissions(seq, term);
      if (failed?.length) this.partialError.set(toErrorKey('codex', 'search', failure, { term, failed }));
      this.activeIndex.set(-1);
      if (hits.length === 0) void this.loadDidYouMean(seq, term);
      this.noteMissIfEmpty(seq, term);
    } catch (err) {
      if (seq === this.seq) {
        this.hits.set([]);
        this.totals.set({});
        this.counts.set({});
        this.partialError.set(null);
        this.error.set(toErrorKey('codex', 'search', err, { term }));
      }
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  /** Gallery images: asked right away on the gallery page, otherwise a low-priority add-on. */
  private async loadGallery(seq: number, term: string): Promise<void> {
    if (term.length < 2) return;
    try {
      const { data, error } = await this.injector.get(SupabaseClientProvider).client.rpc('search_gallery', { p_query: term, p_limit: 8 });
      if (error || seq !== this.seq) return;
      this.galleryRows.set(mapGalleryRows(data as GalleryRpcRow[]));
    } catch {
      /* degrade silently: no gallery group */
    }
  }

  /** Missions (contracts of the current LIVE build): a low-priority add-on like the gallery. */
  private async loadMissions(seq: number, term: string): Promise<void> {
    if (term.length < 2) return;
    try {
      const { data, error } = await this.injector.get(SupabaseClientProvider).client.rpc('search_missions', { p_query: term, p_limit: 8 });
      if (error || seq !== this.seq) return;
      this.missionRows.set(mapMissionRows(data as MissionRpcRow[]));
    } catch {
      /* degrade silently: no mission group */
    }
  }

  /** A committed search with nothing anywhere is counted (anonymous text only). */
  private noteMissIfEmpty(seq: number, term: string): void {
    setTimeout(() => {
      if (seq !== this.seq || this.loading()) return;
      try {
        if (this.hits().length === 0 && this.result().empty) this.trySignals()?.logMiss(term);
      } catch {
        /* counting a miss must never break a search */
      }
    }, 0);
  }

  private trySignals(): SearchSignalsService | null {
    try {
      return this.signals();
    } catch {
      return null;
    }
  }

  /** The ship of a "passt auf" chip: its ports, once per chip (not per row). */
  private loadCompat(): void {
    const compat = this.context().chips.find((c) => c.filter.compatWith)?.filter.compatWith;
    if (!compat || compat.kind !== 'ship' || this.compatRequested === compat.className) return;
    this.compatRequested = compat.className;
    void this.codex
      .getDetail('ship', compat.className)
      .then(async (d) => {
        if (this.compatRequested !== compat.className) return;
        const top = d?.ports ?? [];
        // The sub-ports of what the stock loadout seats (turret → gimbal → gun seat): one batched read per chip.
        const loadout = (d?.payload as { defaultLoadout?: FitLoadoutEntry[] } | null)?.defaultLoadout ?? [];
        const names = stockLoadoutClassNames(loadout as LoadoutEntry[]);
        let seats = new Map<string, FitItemPort[]>();
        if (names.length && top.length) {
          try {
            const payloads = await this.codex.getEntityPayloads(names);
            seats = new Map(
              [...payloads].map(([cls, v]) => [cls, ((v.payload as { itemPorts?: FitItemPort[] } | null)?.itemPorts ?? [])]),
            );
          } catch {
            /* sub-ports unknown: mounts stay opaque, the badge says ? */
          }
        }
        if (this.compatRequested !== compat.className) return;
        this.compatPorts.set({ key: compat.className, ports: buildFitPorts(top, loadout, (cls) => seats.get(cls)) });
      })
      .catch(() => this.compatPorts.set(null));
  }

  private readonly signals = (): SearchSignalsService => this.injector.get(SearchSignalsService);
  private readonly news = (): NewsService => this.injector.get(NewsService);
  private readonly hangar = (): HangarService => this.injector.get(HangarService);
  private readonly ownership = (): HqOwnershipService => this.injector.get(HqOwnershipService);
  private readonly inventory = (): HqInventoryService => this.injector.get(HqInventoryService);
  private readonly wishlist = (): SearchWishlistService => this.injector.get(SearchWishlistService);
  private readonly supplies = (): HqSuppliesService => this.injector.get(HqSuppliesService);
  private readonly wishNames = (): WishNamesService => this.injector.get(WishNamesService);
  private readonly wishStore = (): WishlistStore => this.injector.get(WishlistStore);

  /** The entries of the reader's wishlist / open Nachschub: the pool "gemerkt" and "fehlt mir" filter. */
  private ownSetEntries(set: 'wished' | 'needed'): OwnSetEntry[] {
    if (!this.signedIn()) return [];
    let entries: OwnSetEntry[];
    if (set === 'wished') {
      this.wishlist().ensureLoaded();
      entries = [
        ...this.wishStore().rows().map((r) => ({ kind: r.kind, className: r.className, name: r.name, manufacturerCode: r.manufacturer })),
        ...this.hangar().ships().filter((s) => s.status === 'wishlist').map((s) => ({ kind: 'ship', className: s.shipClassName, name: null })),
      ];
    } else {
      entries = this.supplies().open().filter((i) => i.className).map((i) => ({ kind: i.entityKind ?? 'item', className: i.className!, name: i.name }));
    }
    // Rows without a stored name resolve from the catalog (asynchronously, the class name shows meanwhile).
    this.wishNames().request(entries.filter((e) => !e.name && e.kind !== 'upcoming').map((e) => e.className));
    return entries;
  }
  /** Open Nachschub lines by class name, for the "fehlt mir" filter. */
  private readonly neededFn = (): ((hit: PolySearchHit) => boolean) => {
    const open = new Set(this.supplies().open().map((i) => (i.className ?? '').toLowerCase()).filter(Boolean));
    return (hit) => open.has(hit.classNameSlug.toLowerCase());
  };
  private readonly signedIn = (): boolean => this.injector.get(AuthService).isAuthenticated();

  /** The reader's own data as the matcher reads it (empty while signed out). */
  private readonly ownSources = (): OwnSources => {
    if (!this.signedIn()) return { ships: [], configs: [], sets: [], items: [] };
    const hangar = this.hangar();
    const ships = hangar.ships();
    this.requestShipNames(ships.map((s) => s.shipClassName));
    return { ships, configs: this.ownership().configs(), sets: hangar.roleLoadouts(), items: this.inventory().items() };
  };

  /** Catalog names of the owned ship classes (one lookup per new class set). */
  private requestShipNames(classNames: string[]): void {
    const fresh = [...new Set(classNames)].filter((c) => c && !this.namesRequested.has(c.toLowerCase()));
    if (!fresh.length) return;
    fresh.forEach((c) => this.namesRequested.add(c.toLowerCase()));
    void this.codex
      .getShipsByClassNames(fresh)
      .then((rows) => {
        const next = new Map(this.shipNames());
        for (const [cls, row] of rows) if (row.nameLocalized) next.set(cls.toLowerCase(), row.nameLocalized);
        this.shipNames.set(next);
      })
      .catch(() => undefined);
  }

  /** What the reader owns of a hit: drives "Mein Loadout" / "Wo gelagert?". Null while signed out. */
  private readonly ownershipFn = (): ((hit: PolySearchHit) => RowOwnership | null) => {
    if (!this.signedIn()) return () => null;
    const index = this.ownership().index();
    const stock = new Map<string, number>();
    for (const i of this.inventory().items()) {
      const cls = (i.class_name ?? '').toLowerCase();
      if (cls) stock.set(cls, (stock.get(cls) ?? 0) + (i.qty > 0 ? i.qty : 1));
    }
    const catalogNames = this.shipNames();
    return (hit) => {
      const slug = hit.classNameSlug.toLowerCase();
      const e = index.get(slug);
      const shipId = e?.ship && e.ship.status === 'owned' ? e.ship.id : null;
      const equippedOnShipId = e?.equippedOn[0]?.hangarShipId ?? null;
      const inSetIds = e?.inSets.map((s) => s.setId) ?? [];
      const lagerQty = stock.get(slug) ?? 0;
      const inLager = lagerQty > 0;
      const fitted = new Map<string, { shipId: string; name: string; count: number }>();
      for (const ref of e?.equippedOn ?? []) {
        const have = fitted.get(ref.hangarShipId);
        if (have) have.count++;
        else {
          const name = ref.shipName?.trim() || catalogNames.get(ref.shipClassName.toLowerCase()) || humanizeClassName(ref.shipClassName);
          fitted.set(ref.hangarShipId, { shipId: ref.hangarShipId, name, count: 1 });
        }
      }
      return shipId || equippedOnShipId || inSetIds.length || inLager
        ? { shipId, equippedOnShipId, inSetIds, inLager, lagerQty, fittedOn: [...fitted.values()] }
        : null;
    };
  };

  private owns(className: string): boolean {
    if (!this.signedIn()) return false;
    const e = this.ownership().index().get(className.toLowerCase());
    return !!e && ((!!e.ship && e.ship.status === 'owned') || e.equippedOn.length > 0 || e.inSets.length > 0);
  }

  private async loadDidYouMean(seq: number, term: string): Promise<void> {
    try {
      const lists = await Promise.all(
        (['ship', 'weapon', 'item'] as const).map((k) => this.codex.suggestNames(k, term)),
      );
      if (seq === this.seq) this.didYouMean.set(mergeSuggestions(lists, 3));
    } catch {
      /* suggestions are a courtesy */
    }
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The size / grade chips as server filters. */
function serverAttrs(chips: readonly SearchChip[]): SearchAllFilters {
  const out: SearchAllFilters = {};
  for (const c of chips) {
    if (c.filter.size !== undefined) out.size = c.filter.size;
    if (c.filter.grade) out.grade = c.filter.grade;
  }
  return out;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
