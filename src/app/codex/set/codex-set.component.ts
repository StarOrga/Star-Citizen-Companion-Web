import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { CodexService, ResolvedEntity } from '../codex.service';
import { CodexStageComponent } from '../stage/codex-stage.component';
import { HangarPickerItem } from '../stage/hangar-picker.component';
import { CodexBoardFigureComponent } from '../codex-board-figure.component';
import { CodexBoardPanelComponent } from '../codex-board-panel.component';
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
  imports: [RouterLink, TranslatePipe, CodexStageComponent, CodexBoardFigureComponent, CodexBoardPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="set-page">
      <a class="back" routerLink="/codex">{{ 'codex.set.back' | translate }}</a>

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
        </div>
      }
    </section>
  `,
  styles: [
    `
      /* The full page frame (styles.scss, "PAGE FRAME") — no width or side/top
         padding of its own. */
      .set-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 96px; }
      .back { align-self: flex-start; color: var(--sc-fg-2); font-size: 0.85rem; text-decoration: none; }
      .back:hover, .back:focus-visible { color: var(--sc-accent); }
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
