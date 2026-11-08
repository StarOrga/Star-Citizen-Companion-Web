import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HQ_LIST_PARAM, HQ_PICK_PARAM, hqListTabOf, hqPicksOf } from '../hq-routes';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqPageNavService } from '../hq-page-nav.service';
import { NachschubFocusService } from '../nachschub/nachschub-focus.service';
import { NachschubService, type NachschubResult } from '../nachschub/nachschub.service';
import { isEventNachschub } from '../events/event-nachschub';
import { EventHqService } from '../events/event-hq.service';
import { HqNachschubBoardComponent } from './hq-nachschub-board.component';
import { HqNachschubArchiveDialogComponent, HqNachschubRemoveDialogComponent } from './hq-nachschub-dialogs.component';
import { HqNachschubFlowComponent } from './hq-nachschub-flow.component';
import { HqNachschubPanelComponent } from './hq-nachschub-panel.component';

/**
 * HQ page "Planen": the Nachschub slots on top, the take-over sheet (new Nachschub flow), and the chosen Nachschub
 * with its lines and Einsaetze (concept rounds 3/4). The older Auswahl / Route builder, the community opt-in, Blueprint
 * progress, commodity prices and shared Einsaetze are gone from this page (Wave 5, W5.2).
 * The section frame (`<section id="planen">`) belongs to `HqPagesComponent`.
 */
@Component({
  selector: 'sc-hq-plan',
  standalone: true,
  imports: [
    TranslatePipe,
    ScActionDirective,
    HqNachschubBoardComponent,
    HqNachschubPanelComponent,
    HqNachschubFlowComponent,
    HqNachschubRemoveDialogComponent,
    HqNachschubArchiveDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="page-title" id="hq-plan-title">{{ 'hq.pages.planen' | translate }}</h2>
      @if (ns.newBlock(); as block) {
        <span class="hint" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.4" /></svg>{{ block | translate }}
        </span>
      }
    </header>

    <div class="ns-page">
      @if (ns.error() && !ns.loaded()) {
        <p class="err" role="alert">
          {{ ns.error()! | translate }}
          <button type="button" scAction tier="secondary" (click)="retryNachschub()">{{ 'hq.plan.retry' | translate }}</button>
        </p>
      }
      <sc-hq-nachschub-board
        [selectedId]="focus.selected()?.id ?? null"
        [eventAvailable]="events.hasOpen()"
        (selectNachschub)="focus.select($event)"
        (create)="flow.set({ mode: 'new', id: null, step: 1 })"
        (remove)="askRemove($event, 'remove')"
        (openArchive)="archiveOpen.set(true)" />
      @if (focus.selected(); as sel) {
        <sc-hq-nachschub-panel
          [nachschub]="sel"
          (edit)="flow.set({ mode: 'edit', id: sel.id, step: $event })"
          (remove)="askRemove(sel.id, 'remove')" />
      } @else if (ns.loaded() || !ns.error()) {
        <section class="intro">
          <p class="intro-title">{{ 'hq.slots.introTitle' | translate }}</p>
          <p class="intro-text">{{ 'hq.slots.introText' | translate }}</p>
        </section>
      }
    </div>

    @if (flow(); as f) {
      <sc-hq-nachschub-flow [mode]="f.mode" [nachschubId]="f.id" [startStep]="f.step" [preselect]="flowPicks()" (closed)="closeFlow()" (done)="onFlowDone($event)" />
    }
    @if (removing(); as r) {
      <sc-hq-nachschub-remove-dialog [name]="nameOf(r.id)" [mode]="r.kind" [open]="openCountOf(r.id)" (cancelled)="removing.set(null)" (confirmed)="doRemove($event)" />
    }
    @if (archiveOpen()) {
      <sc-hq-nachschub-archive-dialog (closed)="archiveOpen.set(false)" (reactivate)="reactivate($event)" />
    }
    @if (notice(); as n) {
      <div class="notice" role="status">
        <span>{{ n.key | translate: n.params }}@if (n.warn) { {{ n.warn.key | translate: n.warn.params }} }</span>
        @if (n.undo) { <button type="button" scAction tier="secondary" (click)="undoNotice()">{{ 'hq.log.undo' | translate }}</button> }
      </div>
    }

  `,
  styles: [
    `
      /* One page without scrolling the page: on desktop the host is as tall as the page area, the panels scroll inside. */
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); height: var(--hq-page-h, auto); min-height: 0; }
      .ns-page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .hint { display: inline-flex; align-items: center; gap: 6px; color: var(--sc-fg-2); font-size: 0.85rem; max-width: 60ch; }
      .hint svg { width: 18px; height: 18px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; flex: none; }
      .intro { flex: 1; display: grid; align-content: center; justify-items: center; gap: var(--sc-space-2, 8px); text-align: center; border: 1px dashed var(--sc-border); border-radius: 14px; padding: var(--sc-space-5, 24px); }
      .intro-title { margin: 0; font: 600 1.1rem var(--sc-font-display, inherit); }
      .intro-text { margin: 0; max-width: var(--sc-measure, 62ch); color: var(--sc-fg-2); }
      .notice { position: fixed; z-index: 60; left: 50%; transform: translateX(-50%); bottom: var(--sc-float-bottom, 16px); display: flex; align-items: center; gap: var(--sc-space-3, 12px); max-width: min(520px, calc(100vw - 2 * var(--sc-space-3, 12px))); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px); background: var(--sc-surface, var(--sc-bg-1)); box-shadow: 0 8px 28px rgb(0 0 0 / 0.45); }
      @media (max-width: 760px) { .notice { left: var(--sc-fab-clear-inline, 12px); right: var(--sc-fab-clear-inline, 12px); transform: none; max-width: none; } }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .page-title { margin: 0; margin-right: auto; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .err { margin: 0; display: flex; align-items: center; gap: var(--sc-space-3, 12px); color: var(--sc-warning); }
      @media (max-width: 640px) { .page-title { flex-basis: 100%; } }
    `,
  ],
})
export class HqPlanComponent {
  protected readonly einsatz = inject(HqEinsatzService);
  protected readonly ns = inject(NachschubService);
  protected readonly events = inject(EventHqService);
  protected readonly focus = inject(NachschubFocusService);
  private readonly nav = inject(HqPageNavService);
  protected readonly flow = signal<{ mode: 'new' | 'edit'; id: string | null; step: 1 | 2 } | null>(null);
  protected readonly removing = signal<{ id: string; kind: 'remove' | 'empty' } | null>(null);
  protected readonly archiveOpen = signal(false);
  protected readonly notice = signal<{ key: string; params?: Record<string, string | number>; warn?: NachschubResult['warn']; undo?: () => Promise<NachschubResult> } | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listRoute = inject(ActivatedRoute);
  protected readonly cart = inject(WishCartService);
  private readonly pickRouter = inject(Router);
  protected readonly flowPicks = signal<readonly { key: string; qty: number }[]>([]);

  /** `/hq?list=wish#planen` (the item path's anchors): open the popup on that tab. */
  private readonly listParam = this.listRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
    const tab = hqListTabOf(q.get(HQ_LIST_PARAM));
    // Nachschub lives on this page (the slots); the wishlist is the cart, which the shell opens on `?cart=1` (an old
    // `list=wish` link opens it too).
    if (tab === 'wish') void this.cart.open();
    // "In einen Nachschub" from the cart: the new-Nachschub flow opens with those wishlist positions picked.
    const picks = hqPicksOf(q.get(HQ_PICK_PARAM));
    if (picks.length && !this.flow()) {
      this.flowPicks.set(picks);
      this.pendingPick.set(true);
    }
  });
  /** The picks wait for the Nachschub list: whether a slot is free decides new vs. add-to-existing. */
  private readonly pendingPick = signal(false);
  private readonly openPick = effect(() => {
    if (!this.pendingPick() || (!this.ns.loaded() && !this.ns.error())) return;
    untracked(() => {
      this.pendingPick.set(false);
      if (this.flow()) return;
      // All 7 slots taken: a new Nachschub is impossible, so the picks go into an existing one (the shown one, else the first).
      // The selection was made in the cart already: the flow opens on its Einsätze, "Zurück" still shows the wishlist.
      const target = this.ns.newBlock() ? (this.focus.selected() ?? this.ns.active()[0] ?? null) : null;
      this.flow.set(target ? { mode: 'edit', id: target.id, step: 2 } : { mode: 'new', id: null, step: 2 });
    });
  });

  /** The flow closed: the picks from the URL are spent, so a reload does not reopen it. */
  protected closeFlow(): void {
    this.flow.set(null);
    this.dropPickParam();
  }

  private dropPickParam(): void {
    if (this.flowPicks().length === 0) return;
    this.flowPicks.set([]);
    void this.pickRouter.navigate([], { queryParams: { [HQ_PICK_PARAM]: null }, queryParamsHandling: 'merge', preserveFragment: true, replaceUrl: true });
  }
  private handledRoute: { id: string } | null = null;

  constructor() {
    void this.ns.ensureLoaded();
    this.events.ensure();
    const destroyRef = inject(DestroyRef);
    // An Einsatz opened from Start / Jetzt / a shared URL: its Nachschub is the one shown.
    effect(() => {
      const focus = this.nav.routeFocus();
      if (!focus) return;
      untracked(() => {
        if (this.handledRoute === focus) return;
        const pkg = this.einsatz.items().find((e) => e.id === focus.id)?.packageId;
        if (!pkg) return;
        this.handledRoute = focus;
        this.focus.select(pkg);
      });
    });
    destroyRef.onDestroy(() => clearTimeout(this.noticeTimer));
  }

  protected retryNachschub(): void {
    void this.ns.ensureLoaded();
  }

  protected nameOf(id: string): string {
    return this.ns.packages().find((p) => p.id === id)?.name ?? '';
  }

  /** Lines of a Nachschub that would leave it (open ones), for the delete / empty dialog. */
  protected openCountOf(id: string): number {
    const ev = this.ns.evaluation(id);
    return this.ns.linesOf(id).filter((l) => !l.done && !(ev?.statuses.get(l.id)?.closed ?? false)).length;
  }

  protected askRemove(id: string, kind: 'remove' | 'empty'): void {
    this.removing.set({ id, kind });
  }

  protected async doRemove(back: boolean): Promise<void> {
    const r = this.removing();
    this.removing.set(null);
    if (!r) return;
    const res = r.kind === 'remove' ? await this.ns.remove(r.id, back) : await this.ns.empty(r.id, back);
    this.announce(res);
  }

  protected async reactivate(id: string): Promise<void> {
    const pkg = this.ns.packages().find((p) => p.id === id);
    if (pkg && isEventNachschub(pkg)) {
      const ok = await this.events.resume(id);
      if (ok) {
        this.archiveOpen.set(false);
        this.focus.select(id);
      }
      return;
    }
    const res = await this.ns.reactivate(id);
    if (res.ok) {
      this.archiveOpen.set(false);
      this.focus.select(id);
    }
    this.announce(res);
  }

  protected onFlowDone(res: NachschubResult): void {
    this.flow.set(null);
    this.dropPickParam();
    if (res.id) this.focus.select(res.id);
    this.announce(res);
  }

  /** A result with its undo as a notice at the bottom (8 s). */
  private announce(res: NachschubResult): void {
    clearTimeout(this.noticeTimer);
    this.notice.set({ key: res.key, params: res.params, warn: res.warn, undo: res.undo });
    this.noticeTimer = setTimeout(() => this.notice.set(null), NOTICE_MS);
  }

  protected async undoNotice(): Promise<void> {
    const n = this.notice();
    clearTimeout(this.noticeTimer);
    this.notice.set(null);
    if (n?.undo) this.announce(await n.undo());
  }
}

/** How long the result notice (with its undo) stays. */
const NOTICE_MS = 8000;
