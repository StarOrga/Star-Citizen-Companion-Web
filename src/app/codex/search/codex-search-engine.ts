import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { CodexService, toLang } from '../codex.service';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { PolyHitKind, PolySearchHit, toPolyHit } from '../codex-poly-search';
import { mergeSuggestions } from '../codex-did-you-mean.component';
import { Lang } from '../codex.types';
import {
  CodexSearchGroup,
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
  /** "Did you mean" names for a search that found nothing. */
  readonly didYouMean = signal<string[]>([]);
  readonly recent = signal<string[]>(readRecentSearches(storage()));
  /** Ships new in this patch, offered while the field is empty. */
  readonly fresh = signal<PolySearchHit[]>([]);
  /** Index into `options()`, or -1 for "nothing active". */
  readonly activeIndex = signal(-1);

  readonly hasTerm = computed(() => this.term().trim().length > 0);
  readonly groups = computed<CodexSearchGroup[]>(() =>
    this.hasTerm() ? groupHits(this.term(), this.hits(), this.totals(), this.perGroup()) : [],
  );
  readonly options = computed<SearchOption[]>(() =>
    this.input().trim() ? resultOptions(this.groups()) : suggestionOptions(this.recent(), this.fresh()),
  );
  readonly activeOption = computed<SearchOption | null>(() => this.options()[this.activeIndex()] ?? null);

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
    const term = this.term().trim();
    if (term) void this.run(term);
  }

  /** Remember the current term — called when a hit is opened from it. */
  remember(term = this.term()): void {
    if (term.trim()) this.recent.set(pushRecentSearch(storage(), this.recent(), term));
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
    if (opt.type === 'hit' || opt.type === 'more') this.remember();
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
    return this.router.navigate(t.link, { queryParams: t.queryParams ?? undefined });
  }

  private setTerm(term: string): void {
    this.term.set(term);
    if (!term.trim()) {
      // Invalidate a search still in flight, or its hits land after the clear.
      this.seq++;
      this.hits.set([]);
      this.totals.set({});
      this.error.set(null);
      this.partialError.set(null);
      this.didYouMean.set([]);
      this.loading.set(false);
      return;
    }
    void this.run(term.trim());
  }

  private async run(term: string): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.partialError.set(null);
    this.didYouMean.set([]);
    try {
      const { hits, totals, failed, failure } = await this.codex.searchAll(term, this.perGroup());
      if (seq !== this.seq) return; // a newer search superseded this one
      this.hits.set(hits);
      this.totals.set(totals);
      if (failed?.length) this.partialError.set(toErrorKey('codex', 'search', failure, { term, failed }));
      this.activeIndex.set(-1);
      if (hits.length === 0) void this.loadDidYouMean(seq, term);
    } catch (err) {
      if (seq === this.seq) {
        this.hits.set([]);
        this.totals.set({});
        this.partialError.set(null);
        this.error.set(toErrorKey('codex', 'search', err, { term }));
      }
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
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

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
