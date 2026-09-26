import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { CodexService, ResolvedEntity } from '../codex.service';
import { HangarPickerItem } from '../stage/hangar-picker.component';
import { CodexSetGearComponent } from './codex-set-gear.component';
import { CodexSetStageComponent } from './codex-set-stage.component';
import { CodexSetRankCardComponent } from './codex-set-rank-card.component';
import { CodexSetMissionBarComponent } from './codex-set-mission-bar.component';
import { ArmorRatingRow, SET_LENSES, SetLensId, setLensStorageKey } from './set-rating';
import { LoadoutSharePanelComponent } from '../../social/loadout-share-panel.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import {
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
 * Masthead (concept 2026-09-26 "Set-Seite Doppelungen", round 3, design C1
 * "ausgebaut" — AUD-065): ONE figure. The stage (`sc-codex-set-stage`) holds
 * set picker, role, "Rüstung n/6", set name, readiness and the figure with its
 * six armour tiles and leader lines; beside it (stacked under it on narrow
 * frames) the Einordnung card. Below: the Einsatz strip, whose lens adds a
 * readout line to every tile (persisted per set), then the weapons hotbar.
 * The old six-slot board panel, which repeated figure, name and role under
 * the hero, is gone.
 */
@Component({
  selector: 'sc-codex-set',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CodexSetStageComponent,
    CodexSetRankCardComponent,
    CodexSetMissionBarComponent,
    CodexSetGearComponent,
    LoadoutSharePanelComponent,
    ScTooltipDirective,
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
              [scTooltip]="'codex.set.share' | translate"
              scTooltipTier="label"
              [attr.aria-expanded]="shareOpen()"
              [attr.aria-controls]="shareOpen() ? 'set-share-panel' : null"
              (click)="shareOpen.set(!shareOpen())"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <circle cx="18" cy="5" r="2.6" />
                <circle cx="6" cy="12" r="2.6" />
                <circle cx="18" cy="19" r="2.6" />
                <path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" />
              </svg>
            </button>
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
          <a class="create-set" routerLink="/hangar">{{ 'codex.set.createInHangar' | translate }}</a>
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

        <div class="masthead">
          <sc-codex-set-stage
            class="set-hero"
            [set]="activeSet()!"
            [resolved]="resolvedArmor()"
            [payloads]="armorPayloads()"
            [archiveDepth]="archiveDepth()"
            [ratingRows]="ratingRows()"
            [lens]="lens()"
            [pickerItems]="setPickerItems()"
            (pick)="onSetPick($event)"
            (open)="onHangarOpen()"
          />
          <sc-codex-set-rank-card class="rank" [rows]="ratingRows()" [loading]="ratingLoading()" />
        </div>

        <sc-codex-set-mission-bar [lens]="lens()" (lensChange)="setLens($event)" />

        <sc-codex-set-gear
          class="set-gear"
          [setId]="activeSet()!.id"
          [role]="activeSet()!.role"
          [items]="activeSet()!.items"
          [resolved]="resolvedArmor()"
        />
      }
    </section>
  `,
  styles: [
    `
      /* The full page frame (styles.scss, "PAGE FRAME") — no width or side/top
         padding of its own. */
      .set-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 96px; }
      .top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }
      .back { color: var(--sc-fg-2); font-size: 0.82rem; text-decoration: none; }
      .back:hover, .back:focus-visible { color: var(--sc-accent); }
      /* Share is a set action: an icon button beside the back link. Its label
         is the app tooltip ([scTooltip], Label tier: the icon is its only
         visible name) — one tooltip, not a second CSS one next to it. */
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
      .hint { color: var(--sc-fg-2); }
      .hint a { color: var(--sc-accent); }
      /* No own padding: .sc-card's density scale (--sc-pad-1) tightens it on phones. */
      .load-err { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--sc-danger); }
      .load-err .retry {
        margin-left: auto; padding: 6px 14px; border-radius: 6px; cursor: pointer;
        background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); font-family: inherit;
      }
      .load-err .retry:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
      .load-err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }
      /* The empty state's only action: a real thumb target, not a line of running text. */
      .hint .create-set { display: inline-flex; align-items: center; min-height: var(--sc-tap-min); }
      .hint.note { color: var(--sc-warning); }

      /* Masthead: stage + Einordnung card side by side from ~1100px of page
         width, stacked below that (container query: the page frame decides,
         not the viewport). */
      .set-page { container: setpage / inline-size; }
      .masthead { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
      @container setpage (min-width: 1100px) {
        .masthead { grid-template-columns: minmax(0, 1fr) 360px; }
      }
      .set-hero, .rank { display: block; min-width: 0; }
      .set-gear { display: block; }
    `,
  ],
})
export class CodexSetComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Where the sign-in hint sends the visitor back to — read live, as the page outlives the URL it opened on. */
  protected get currentPath(): string {
    return this.router.url;
  }

  readonly loading = signal(true);
  /** The inline share panel under the top row; closes when the page moves to another set. */
  readonly shareOpen = signal(false);
  readonly requestedId = signal<string | null>(null);
  /** Bumped per load, so a late answer for a set the page has left never lands on the next one. */
  private loadSeq = 0;

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

  /** Rating rows of the equipped armour — null until the SQL function answers (an honest gap in the card). */
  readonly ratingRows = signal<ArmorRatingRow[] | null>(null);
  readonly ratingLoading = signal(false);

  /** The Einsatz lens, remembered per set. */
  readonly lens = signal<SetLensId>('all');

  readonly setPickerItems = computed<HangarPickerItem[]>(() => {
    const current = this.activeSet()?.id ?? null;
    return this.hangar.recentSets().map((l) => ({ id: l.id, label: l.name, active: l.id === current }));
  });

  /**
   * Params are SUBSCRIBED, not snapshotted: the stage's own set picker routes
   * `codex/set/:id` to itself, and the router reuses this page across that
   * params-only navigation — and across back/forward between two set pages —
   * so a snapshot read leaves the new URL over the old set. The first emission
   * is synchronous, so a deep link loads exactly as before.
   */
  constructor() {
    // Each set remembers its own lens; a set switch reads that set's choice.
    effect(() => {
      const id = this.activeSet()?.id ?? null;
      untracked(() => this.lens.set(readLens(id)));
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.load(params.get('id'));
    });
  }

  /**
   * A set switch keeps the page up (no loading state over hero and board):
   * the new id re-picks the active set at once, and only what it carries is
   * resolved again. The maps are keyed by class name and attach type, not by
   * set, so the previous answers stand until the new ones land.
   */
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
      this.ratingRows.set(null);
      this.ratingLoading.set(false);
      return;
    }
    const classNames = active.items.map((i) => i.className).filter((c): c is string => !!c);
    const slots = armorSlotsFromLoadout(active.items);
    const emptySlots = slots.filter((s) => !s.className);
    const armorClassNames = slots.map((s) => s.className).filter((c): c is string => !!c);
    // Each answer lands as it arrives — unless the page has moved on to
    // another set meanwhile, then it is dropped.
    const land = <T>(state: WritableSignal<T>, value: T) => {
      if (seq === this.loadSeq) state.set(value);
    };

    await Promise.all([
      this.svc
        .resolveEntities(classNames)
        .then((m) => land(this.resolvedArmor, m))
        .catch(() => land(this.resolvedArmor, new Map())),
      this.svc
        .getEntityPayloads(classNames)
        .then((m) => land(this.armorPayloads, m))
        .catch(() => land(this.armorPayloads, new Map())),
      // "N im Archiv" on the open positions: head-only counts, cached per build
      // (a set switch used to fetch one full payload row per open position).
      this.svc
        .countItemsByAttachType(emptySlots.map((s) => s.attachType))
        .then((m) => land(this.archiveDepth, m))
        .catch(() => land(this.archiveDepth, new Map())),
      // Rating of the equipped armour (card + lens readouts). null = the SQL
      // function is not deployed yet — the card names that gap.
      (async () => {
        land(this.ratingLoading, true);
        try {
          land(this.ratingRows, await this.svc.armorRating(armorClassNames));
        } catch {
          land(this.ratingRows, null);
        } finally {
          land(this.ratingLoading, false);
        }
      })(),
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

  /** The Einsatz strip's choice — kept per set in localStorage. */
  setLens(lens: SetLensId): void {
    this.lens.set(lens);
    const id = this.activeSet()?.id;
    if (!id) return;
    try {
      localStorage.setItem(setLensStorageKey(id), lens);
    } catch {
      // Private mode / storage full: the lens still applies for this visit.
    }
  }
}

/** The stored lens for a set, if it is still a known, enabled lens; else 'all'. */
function readLens(setId: string | null): SetLensId {
  if (!setId) return 'all';
  try {
    const raw = localStorage.getItem(setLensStorageKey(setId));
    const def = SET_LENSES.find((l) => l.id === raw);
    return def && !def.disabled ? def.id : 'all';
  } catch {
    return 'all';
  }
}
