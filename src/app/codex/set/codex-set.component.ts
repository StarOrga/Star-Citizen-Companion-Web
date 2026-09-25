import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { CodexService, ResolvedEntity } from '../codex.service';
import { CodexStageComponent } from '../stage/codex-stage.component';
import { HangarPickerItem } from '../stage/hangar-picker.component';
import { CodexBoardFigureComponent } from '../codex-board-figure.component';
import { CodexBoardPanelComponent } from '../codex-board-panel.component';
import { CodexSetGearComponent } from './codex-set-gear.component';
import { LoadoutSharePanelComponent } from '../../social/loadout-share-panel.component';
import {
  ArmorSlotState,
  EntityPayloadEntry,
  armorSlotsFromLoadout,
  sortByRecency,
  withSelectedFirst,
} from '../codex-landing-kpi';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';

/**
 * The set page (concept 2026-09-20, round 2 decision T1 / round 17 N5) —
 * "Zu Fuß" equivalent of the ship detail page: the codex is the on-foot
 * loadout EDITOR here, not just an overview. The landing (round 14-17) only
 * shows the person "grob" (the Spot person stage + the loadout tiles); every
 * configurable piece — the six slots, armour class, readiness, set-switch —
 * lives here, one click away.
 *
 * Hero: the same `sc-codex-stage kind="person"` construction the landing
 * uses, full width, 420px (N5 — no archive line in this hero, the page
 * navigation is the way out). Below it: the existing on-foot editor
 * (`sc-codex-board-panel`, unchanged) reused as-is — six slots, item art,
 * armour-class bars, readiness glyphs, set switcher.
 */
@Component({
  selector: 'sc-codex-set',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CodexStageComponent,
    CodexBoardFigureComponent,
    CodexBoardPanelComponent,
    CodexSetGearComponent,
    LoadoutSharePanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="set-page">
      <div class="top-row">
        <a class="back" routerLink="/codex">{{ 'codex.set.back' | translate }}</a>
        @if (!loading() && auth.user() && activeSet()) {
          <span class="share-wrap">
            <button
              type="button"
              class="share-btn"
              [class.on]="shareOpen()"
              [attr.aria-label]="'codex.set.share' | translate"
              [attr.aria-expanded]="shareOpen()"
              aria-controls="set-share-panel"
              (click)="shareOpen.set(!shareOpen())"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <circle cx="18" cy="5" r="2.6" />
                <circle cx="6" cy="12" r="2.6" />
                <circle cx="18" cy="19" r="2.6" />
                <path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" />
              </svg>
            </button>
            <span class="share-tip" aria-hidden="true">{{ 'codex.set.share' | translate }}</span>
          </span>
        }
      </div>

      @if (loading()) {
        <p class="hint" role="status">{{ 'codex.set.loading' | translate }}</p>
      } @else if (!auth.user()) {
        <p class="hint">
          <a routerLink="/login" [queryParams]="{ redirect: currentPath }">{{ 'codex.set.signInHint' | translate }}</a>
        </p>
      } @else if (!activeSet() && hangar.error()) {
        <!-- loadAll() never throws — it parks the failure in hangar.error. Without
             this branch a failed read read as "no set commissioned yet". -->
        <div class="sc-card load-err" role="alert">
          <span>{{ 'codex.set.loadFailed' | translate }}</span>
          <button type="button" class="retry" (click)="retry()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else if (!activeSet()) {
        <p class="hint">
          {{ 'codex.set.noSets' | translate }}
          <a routerLink="/hangar">{{ 'codex.set.createInHangar' | translate }}</a>
        </p>
      } @else {
        @if (shareOpen()) {
          <div class="share-box" id="set-share-panel">
            <sc-loadout-share-panel [loadoutId]="activeSet()!.id" />
          </div>
        }

        @if (notFound()) {
          <p class="hint note">{{ 'codex.set.notFound' | translate }}</p>
        }

        <sc-codex-stage
          class="set-hero"
          kind="person"
          [eyebrow]="roleLabel()"
          [eyebrowSuffix]="equipSuffix()"
          [title]="activeSet()!.name"
          pickerKind="set"
          [pickerItems]="setPickerItems()"
          (pick)="onSetPick($event)"
          (open)="onHangarOpen()"
        >
          <sc-codex-board-figure stageFigure [filled]="filledSlots()" [decorative]="true" />
        </sc-codex-stage>

        <div class="board-wrap">
          <sc-codex-board-panel
            [loadouts]="orderedLoadouts()"
            [resolved]="resolvedArmor()"
            [payloads]="armorPayloads()"
            [archiveDepth]="archiveDepth()"
          />
          <sc-codex-set-gear
            class="set-gear"
            [setId]="activeSet()!.id"
            [role]="activeSet()!.role"
            [items]="activeSet()!.items"
            [resolved]="resolvedArmor()"
          />
        </div>
      }
    </section>
  `,
  styles: [
    `
      /* The full page frame (styles.scss, "PAGE FRAME") — no width or side/top
         padding of its own. */
      .set-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 96px; }
      .top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }
      .back { color: var(--sc-fg-2); font-size: 0.85rem; text-decoration: none; }
      .back:hover, .back:focus-visible { color: var(--sc-accent); }
      /* Share is a set action: an icon button beside the back link. Its label
         shows as an app-styled tooltip (Label tier: the icon is its only
         visible name) — instantly on keyboard focus, after 400 ms on hover. */
      .share-wrap { position: relative; display: inline-flex; }
      .share-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; min-width: var(--sc-tap-min, 0px); min-height: var(--sc-tap-min, 0px);
        padding: 0; border-radius: 4px; cursor: pointer;
        background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      }
      .share-btn svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
      .share-btn:hover, .share-btn.on { color: var(--sc-accent); border-color: var(--sc-accent); }
      .share-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .share-tip {
        position: absolute; top: calc(100% + 6px); right: 0; z-index: 5; white-space: nowrap;
        padding: 5px 9px; border-radius: 4px; pointer-events: none;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
        font-size: max(0.72rem, var(--sc-fs-floor, 0.7rem));
        opacity: 0; visibility: hidden; transition: opacity 0.12s ease, visibility 0s linear 0.12s;
      }
      .share-btn:hover + .share-tip {
        opacity: 1; visibility: visible; transition: opacity 0.12s ease 400ms, visibility 0s linear 400ms;
      }
      .share-btn:focus-visible + .share-tip { opacity: 1; visibility: visible; transition: none; }
      @media (hover: none) { .share-btn:hover + .share-tip { opacity: 0; visibility: hidden; } }
      .hint { color: var(--sc-fg-2); }
      .hint a { color: var(--sc-accent); }
      .load-err { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 16px; color: var(--sc-danger); }
      .load-err .retry {
        margin-left: auto; padding: 6px 14px; min-height: var(--sc-tap-min, 44px); border-radius: 6px; cursor: pointer;
        background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); font-family: inherit;
      }
      .hint.note { color: var(--amber, #f0c27b); }

      .set-hero { display: block; height: 420px; border-radius: 4px; overflow: hidden; border: 1px solid var(--sc-border); }
      /* N5: title 30px on the set page's full-width hero (the landing's
         person stage stays at the shared 24px — see codex-stage.component.ts). */
      .set-hero ::ng-deep .stage-title { font-size: 30px; }
      /* N5: no archive line in this hero — nothing is projected into the
         stage's [stageArchive] slot, so its (empty) row stays invisible. */
      .set-hero ::ng-deep .stage-archive { display: none; }

      .board-wrap {
        --tint: var(--sc-warning, #ffc14d);
        position: relative;
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        padding: 16px;
        background: var(--sc-bg-1);
      }
      .set-gear {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid color-mix(in srgb, var(--tint) 18%, var(--sc-border));
      }
    `,
  ],
})
export class CodexSetComponent {
  readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);

  protected readonly currentPath = typeof location !== 'undefined' ? location.pathname : '/';

  readonly loading = signal(true);
  /** The inline share panel under the top row; closes when the page moves to another set. */
  readonly shareOpen = signal(false);
  readonly requestedId = signal<string | null>(null);

  readonly resolvedArmor = signal<Map<string, ResolvedEntity>>(new Map());
  readonly archiveDepth = signal<Map<string, number>>(new Map());
  readonly armorPayloads = signal<Map<string, EntityPayloadEntry>>(new Map());

  /** All the user's sets, most-recently-touched first, the requested id (if it still exists) pinned to [0]. */
  readonly orderedLoadouts = computed<HangarRoleLoadout[]>(() =>
    withSelectedFirst(sortByRecency(this.hangar.roleLoadouts()), this.requestedId()),
  );

  readonly activeSet = computed<HangarRoleLoadout | null>(() => this.orderedLoadouts()[0] ?? null);

  /** True once loadouts exist but the requested `:id` isn't among them — the fallback is showing set [0] instead. */
  readonly notFound = computed(() => {
    const id = this.requestedId();
    if (!id) return false;
    return !this.hangar.roleLoadouts().some((l) => l.id === id);
  });

  private readonly slots = computed<ArmorSlotState[]>(() =>
    armorSlotsFromLoadout(this.activeSet()?.items ?? []),
  );
  readonly filledSlots = computed<ReadonlySet<string>>(
    () => new Set(this.slots().filter((s) => s.className).map((s) => s.roleSlot)),
  );

  readonly roleLabel = computed(() => {
    const set = this.activeSet();
    return set ? this.t.instant('hangar.roles.' + set.role) : '';
  });

  readonly equipSuffix = computed(
    () => '· ' + this.t.instant('codex.stage.equipped', { filled: this.filledSlots().size, total: 6 }),
  );

  readonly setPickerItems = computed<HangarPickerItem[]>(() => {
    const current = this.activeSet()?.id ?? null;
    return this.hangar.recentSets().map((l) => ({ id: l.id, label: l.name, active: l.id === current }));
  });

  /** Bumped per load, so a slow answer for the set left behind never lands on the set picked after it. */
  private loadSeq = 0;

  constructor() {
    // The picker navigates /codex/set/A → /codex/set/B, and the router REUSES
    // this component for that — a one-time snapshot read would keep showing A
    // under B's URL. So the page follows the param, not its first value.
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => void this.load(params.get('id')));
  }

  private async load(id: string | null): Promise<void> {
    const seq = ++this.loadSeq;
    // The share panel reads its loadout id once — never leave set A's shares
    // open under set B's title.
    if (id !== this.requestedId()) this.shareOpen.set(false);
    this.requestedId.set(id);
    // Only the first load blanks the page; a set switch swaps the data in place.
    if (!this.activeSet()) this.loading.set(true);
    try {
      if (this.auth.user()) {
        const known = this.hangar.roleLoadouts();
        // An empty cache, or a set created since it was filled (another tab,
        // another device): refresh once before calling the id "not found".
        if (known.length === 0 || (id && !known.some((l) => l.id === id))) {
          await this.hangar.loadAll();
        }
      }
      if (seq === this.loadSeq) await this.resolveActiveSet(seq);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  private async resolveActiveSet(seq: number): Promise<void> {
    const active = this.activeSet();
    if (!active) {
      this.resolvedArmor.set(new Map());
      this.archiveDepth.set(new Map());
      this.armorPayloads.set(new Map());
      return;
    }
    const classNames = active.items.map((i) => i.className).filter((c): c is string => !!c);
    const slots = armorSlotsFromLoadout(active.items);
    const emptySlots = slots.filter((s) => !s.className);
    const current = () => seq === this.loadSeq;

    await Promise.all([
      this.svc
        .resolveEntities(classNames)
        .catch(() => new Map<string, ResolvedEntity>())
        .then((m) => current() && this.resolvedArmor.set(m)),
      this.svc
        .getEntityPayloads(classNames)
        .catch(() => new Map<string, EntityPayloadEntry>())
        .then((m) => current() && this.armorPayloads.set(m)),
      Promise.all(
        emptySlots.map((s) =>
          this.svc
            .listByKind('item', { attachType: s.attachType, limit: 1 })
            .then((r) => [s.attachType, r.count] as const)
            .catch(() => [s.attachType, null] as const),
        ),
      ).then((entries) => {
        if (!current()) return;
        const m = new Map<string, number>();
        for (const [attachType, count] of entries) if (count != null) m.set(attachType, count);
        this.archiveDepth.set(m);
      }),
    ]);
  }

  retry(): void {
    void this.load(this.requestedId());
  }

  onSetPick(id: string): void {
    this.hangar.markSetPicked(id);
    void this.router.navigate(['/codex', 'set', id]);
  }

  onHangarOpen(): void {
    void this.router.navigateByUrl('/hangar');
  }
}
