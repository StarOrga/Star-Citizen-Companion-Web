import { Injectable, TemplateRef, computed, signal } from '@angular/core';
import type { PageCrumb } from '../../shared/page-header/nav-origin.service';

/**
 * Where the stage's own search line stands relative to the bar (cinematic hubs):
 * - `none`    not a main page — the bar is the docked subheader;
 * - `stage`   main page at its top — the bar's search field stands in the scene;
 * - `docked`  scrolled past the threshold — the same field widened into the subheader.
 * Set by the bar itself (its scroll state machine); the main header reads it to compress.
 */
export type StageSearchState = 'none' | 'stage' | 'docked';

/** How long an eased (route-driven) condense glides. */
export const DOCK_EASE_MS = 1100;

/**
 * The hub's title sequence as the shell sees it: `k` scales every second of
 * the sequence (1 on the first Verse visit of a session, ~0.18 afterwards),
 * `full` is that first visit. The staged search field is revealed at 3.4 s * k
 * and, on the full intro only, the main header appears at 4.85 s * k.
 */
export interface HeroIntro {
  k: number;
  full: boolean;
}

/** Seconds at k = 1: the staged search field ignites / the main header appears. */
export const HERO_INTRO_FIELD_S = 3.4;
export const HERO_INTRO_HEADER_S = 4.85;

/** What a page publishes about its own header for the bar (crumbs + title). */
export interface ChromeCrumbs {
  crumbs: readonly PageCrumb[];
  title: string | null;
}

/** One active filter of a tool page, shown as a removable token inside the bar's search field. */
export interface BarFilterToken {
  id: string;
  /** i18n key of the facet ("Hersteller"). */
  labelKey: string;
  /** The picked value as shown ("Aegis"); null for a plain switch (variants on). */
  value: string | null;
  remove: () => void;
}

/** One facet of the bar's filter panel: a column of checkboxes, at most one picked. */
export interface BarFacet {
  id: string;
  /** i18n key of the column head ("Hersteller"). */
  labelKey: string;
  options: readonly { value: string; label?: string; labelKey?: string }[];
  selected: string | null;
  set: (value: string | null) => void;
}

/** What a tool page tells the bar about its filters (Codex index). */
export interface BarFilters {
  /** Hits after filtering; null while unknown. */
  count: number | null;
  /** Unfiltered size of the current kind, for the kind switch ("Schiffe 368"); null when unknown. */
  kindTotal: number | null;
  tokens: readonly BarFilterToken[];
  /** The panel's checkbox columns; absent → the page's own toolbar fills the panel. */
  facets?: readonly BarFacet[];
  reset: () => void;
}

/**
 * Cross-component state of the Fusion bar (beta `shell`). The bar reads it;
 * pages (and the shared page header) feed it. Nothing here changes behaviour
 * while the β is off — every producer only publishes, and only the bar consumes.
 *
 * Producers:
 * - `sc-page-header` publishes its crumbs + title (`publishCrumbs`);
 * - a hub stage marks its search line with `[scStageSearch]` (StageSearchDirective),
 *   or drives `setStageSearch()` itself;
 * - a tool page hands its filter toolbar over with `*scBarToolbar`
 *   (BarToolbarDirective) — the bar renders it as the drawer under the search;
 * - a long page names the section in view with `setSection()`.
 */
@Injectable({ providedIn: 'root' })
export class ShellChromeService {
  private readonly crumbOwners = signal<readonly { owner: object; value: ChromeCrumbs }[]>([]);
  private readonly toolbars = signal<readonly TemplateRef<unknown>[]>([]);
  private readonly stage = signal<StageSearchState>('none');
  private readonly sectionLabel = signal<string | null>(null);
  private readonly hiddenState = signal(false);
  private readonly snapState = signal(false);
  private readonly fullState = signal(false);
  private readonly dockTargets = new Set<HTMLElement>();
  private dockP: number | null = null;
  private easeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly introState = signal<HeroIntro | null>(null);
  private readonly anchors = signal<readonly HTMLElement[]>([]);
  private readonly filterOwners = signal<readonly { owner: object; read: () => BarFilters }[]>([]);
  private readonly pageSearchOwners = signal<readonly { owner: object; apply: (term: string) => void }[]>([]);

  /** The newest page that filters itself by the bar's typed term, or null (the bar then only searches the Codex). */
  readonly pageSearch = computed<((term: string) => void) | null>(() => this.pageSearchOwners().at(-1)?.apply ?? null);

  /** The hub's running title sequence, or null (set by the hub, read by the bar and the main header). */
  readonly heroIntro = this.introState.asReadonly();

  /** The newest page header's crumbs + title, or null. */
  readonly crumbs = computed<ChromeCrumbs | null>(() => {
    const list = this.crumbOwners();
    return list[list.length - 1]?.value ?? null;
  });
  /** The tool toolbar the bar shows as its filter drawer (newest registration wins). */
  readonly toolbar = computed<TemplateRef<unknown> | null>(() => {
    const list = this.toolbars();
    return list[list.length - 1] ?? null;
  });
  /** Cinematic morph state of the stage search line. */
  readonly stageSearch = this.stage.asReadonly();
  /** Label of the section in view (shown left next to the crumbs), or null. */
  readonly section = this.sectionLabel.asReadonly();
  /** The element the staged search stands on (newest `[scStageSearch]` slot), or null. */
  readonly stageAnchor = computed<HTMLElement | null>(() => {
    const list = this.anchors();
    return list[list.length - 1] ?? null;
  });
  /** The tool page's filter state for the bar (kind switch, tokens, count, panel footer), or null. */
  readonly filters = computed<BarFilters | null>(() => {
    const list = this.filterOwners();
    return list[list.length - 1]?.read() ?? null;
  });
  /**
   * True for the frames in which the bar and the main header jump to a new
   * state without their transitions (a route change or a programmatic scroll
   * reset — never the user's own scroll).
   */
  readonly snap = this.snapState.asReadonly();
  /**
   * The condense is complete (progress 1 on a main page, or any page that is
   * not one): the header is inert and gone, the bar carries logo and account.
   * Turning true after an eased route change waits for the glide to land.
   */
  readonly dockFull = this.fullState.asReadonly();
  /** True while the bar is slid away (content pages, scrolling down). */
  readonly barHidden = this.hiddenState.asReadonly();

  /** The hub's title sequence starts (never call it under reduced motion). */
  startHeroIntro(k: number, full: boolean): void {
    this.introState.set({ k, full });
  }

  /** The hub's title sequence is over or the hub left. */
  endHeroIntro(): void {
    this.introState.set(null);
  }

  /** Publish a page header's crumbs + title; returns the unpublish function. */
  publishCrumbs(owner: object, value: ChromeCrumbs): () => void {
    this.crumbOwners.update((list) => [...list.filter((e) => e.owner !== owner), { owner, value }]);
    return () => this.crumbOwners.update((list) => list.filter((e) => e.owner !== owner));
  }

  /** Hand a toolbar template to the bar; returns the unregister function. */
  registerToolbar(tpl: TemplateRef<unknown>): () => void {
    this.toolbars.update((list) => [...list.filter((t) => t !== tpl), tpl]);
    return () => this.toolbars.update((list) => list.filter((t) => t !== tpl));
  }

  /** Mark the stage slot of a main page; returns the unregister function. */
  registerStageAnchor(el: HTMLElement): () => void {
    this.anchors.update((list) => [...list.filter((e) => e !== el), el]);
    return () => this.anchors.update((list) => list.filter((e) => e !== el));
  }

  /** A tool page hands its filter state to the bar (`read` is reactive — call signals inside); returns the unregister function. */
  registerFilters(owner: object, read: () => BarFilters): () => void {
    this.filterOwners.update((list) => [...list.filter((e) => e.owner !== owner), { owner, read }]);
    return () => this.filterOwners.update((list) => list.filter((e) => e.owner !== owner));
  }

  /** A page with its own list (News feed, patch board) follows the bar's typed term; returns the unregister function. */
  registerPageSearch(owner: object, apply: (term: string) => void): () => void {
    this.pageSearchOwners.update((list) => [...list.filter((e) => e.owner !== owner), { owner, apply }]);
    return () => this.pageSearchOwners.update((list) => list.filter((e) => e.owner !== owner));
  }

  /** A hub page reports where its stage search line is (`'none'` when it leaves). */
  setStageSearch(state: StageSearchState): void {
    this.stage.set(state);
    // Off the main pages the header is condensed; arriving on one the bar drives it from the scroll.
    if (state === 'none') this.setDockProgress(1, true);
    else if (state === 'stage' && this.dockP !== 0) this.setDockProgress(0, this.dockP !== null);
  }

  /** The current condense progress (0 … 1), or null before the first one. */
  get dockProgress(): number | null {
    return this.dockP;
  }

  /**
   * Paint the condense progress `p` (0 = header expanded, 1 = docked) as
   * `--sc-dock-p` on the header, the bar and the β chip. `eased` (route
   * changes) lets the registered property glide for a moment; scrolling sets it
   * directly. The first value never glides.
   */
  setDockProgress(p: number, eased = false): void {
    const next = Math.min(1, Math.max(0, p));
    const first = this.dockP === null;
    this.dockP = next;
    const glide = eased && !first;
    if (this.easeTimer) clearTimeout(this.easeTimer);
    this.easeTimer = null;
    for (const el of this.dockTargets) this.paint(el, next, glide);
    this.paintChip(next);
    if (next < 1) {
      this.fullState.set(false);
    } else if (glide) {
      this.easeTimer = setTimeout(() => {
        this.easeTimer = null;
        for (const el of this.dockTargets) el.removeAttribute('data-ease');
        this.fullState.set(this.dockP === 1);
      }, DOCK_EASE_MS);
    } else {
      this.fullState.set(true);
    }
  }

  /** Header / bar register their host to receive the progress; returns the unregister function. */
  registerDockTarget(el: HTMLElement): () => void {
    this.dockTargets.add(el);
    if (this.dockP !== null) this.paint(el, this.dockP, false);
    return () => this.dockTargets.delete(el);
  }

  private paint(el: HTMLElement, p: number, glide: boolean): void {
    if (glide) el.setAttribute('data-ease', '');
    else el.removeAttribute('data-ease');
    el.style.setProperty('--sc-dock-p', String(p));
  }

  private paintChip(p: number): void {
    if (typeof document === 'undefined') return;
    const chip = document.querySelector<HTMLElement>('sc-beta-chip');
    chip?.style.setProperty('--sc-dock-p', String(p));
  }

  /** The section in view on a long page (null = none). */
  setSection(label: string | null): void {
    this.sectionLabel.set(label);
  }

  /** Bar-internal: switch the transitions off for a silent state jump. */
  setSnap(on: boolean): void {
    this.snapState.set(on);
  }

  /** Bar-internal: the hide/reveal state, published for pages with their own sticky bars. */
  setBarHidden(hidden: boolean): void {
    this.hiddenState.set(hidden);
  }
}
