import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

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
  imports: [RouterLink, TranslateModule, CodexStageComponent, CodexBoardFigureComponent, CodexBoardPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="set-page">
      <a class="back" routerLink="/codex">{{ 'codex.set.back' | translate }}</a>

      @if (loading()) {
        <p class="hint">…</p>
      } @else if (!auth.user()) {
        <p class="hint">
          <a routerLink="/login" [queryParams]="{ redirect: currentPath }">{{ 'codex.set.signInHint' | translate }}</a>
        </p>
      } @else if (!activeSet()) {
        <p class="hint">{{ 'codex.set.noSets' | translate }}</p>
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
      .set-page { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; padding: 16px 16px 96px; }
      .back { align-self: flex-start; color: var(--sc-fg-2); font-size: 0.85rem; text-decoration: none; }
      .back:hover, .back:focus-visible { color: var(--sc-accent); }
      .hint { color: var(--sc-fg-2); }
      .hint a { color: var(--sc-accent); }
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
export class CodexSetComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);
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

  async ngOnInit(): Promise<void> {
    this.requestedId.set(this.route.snapshot.paramMap.get('id'));
    this.loading.set(true);
    try {
      if (this.auth.user() && this.hangar.roleLoadouts().length === 0) {
        await this.hangar.loadAll();
      }
      await this.resolveActiveSet();
    } finally {
      this.loading.set(false);
    }
  }

  private async resolveActiveSet(): Promise<void> {
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

    await Promise.all([
      this.svc
        .resolveEntities(classNames)
        .then((m) => this.resolvedArmor.set(m))
        .catch(() => this.resolvedArmor.set(new Map())),
      this.svc
        .getEntityPayloads(classNames)
        .then((m) => this.armorPayloads.set(m))
        .catch(() => this.armorPayloads.set(new Map())),
      Promise.all(
        emptySlots.map((s) =>
          this.svc
            .listByKind('item', { attachType: s.attachType, limit: 1 })
            .then((r) => [s.attachType, r.count] as const)
            .catch(() => [s.attachType, null] as const),
        ),
      ).then((entries) => {
        const m = new Map<string, number>();
        for (const [attachType, count] of entries) if (count != null) m.set(attachType, count);
        this.archiveDepth.set(m);
      }),
    ]);
  }

  onSetPick(id: string): void {
    this.hangar.markSetPicked(id);
    void this.router.navigate(['/codex', 'set', id]);
  }

  onHangarOpen(): void {
    void this.router.navigateByUrl('/hangar');
  }
}
