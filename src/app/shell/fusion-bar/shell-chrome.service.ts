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

/** What a tool page tells the bar about its filters (Codex index). */
export interface BarFilters {
  /** Hits after filtering; null while unknown. */
  count: number | null;
  /** Unfiltered size of the current kind, for the kind switch ("Schiffe 368"); null when unknown. */
  kindTotal: number | null;
  tokens: readonly BarFilterToken[];
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
  private readonly anchors = signal<readonly HTMLElement[]>([]);
  private readonly filterOwners = signal<readonly { owner: object; read: () => BarFilters }[]>([]);

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
  /** True while the bar is slid away (content pages, scrolling down). */
  readonly barHidden = this.hiddenState.asReadonly();

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

  /** A hub page reports where its stage search line is (`'none'` when it leaves). */
  setStageSearch(state: StageSearchState): void {
    this.stage.set(state);
  }

  /** The section in view on a long page (null = none). */
  setSection(label: string | null): void {
    this.sectionLabel.set(label);
  }

  /** Bar-internal: the hide/reveal state, published for pages with their own sticky bars. */
  setBarHidden(hidden: boolean): void {
    this.hiddenState.set(hidden);
  }
}
