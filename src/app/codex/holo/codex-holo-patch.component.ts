import { NgTemplateOutlet } from '@angular/common';
// Holotable patch chooser + Δ view (concept p2-inline/p2-table/p2-scope).
// Self-contained: fetches its own comparison-build list and its own
// comparison-side detail, and hands the host everything it needs to paint
// ghost values / delta chips on the KPI band and pin badges on the ports —
// it never touches the strip/port DOM itself (Wave 2.5 hosts this via the
// outputs below).
//
// KPI-sheet / port-occupant RESOLUTION for the comparison side is NOT
// reimplemented here — `codex-detail.component.ts` already resolves
// `KpiShipInput`/`SummaryOccupant[]` from a `CodexDetail` via a private,
// ASYNC pipeline (`loadoutPayloads`/`ammoPayloads` signals populated by
// `CodexService` batch reads, `resolvedLoadout` derived from those, ~100
// lines). Per the "reuse, never reimplement" instruction this component
// takes that resolution as an INPUT function (`resolveComparisonSide`, itself
// async — the comparison build's classNames need their own payload batch
// read, same shape as the host's own) the host supplies, generalised from its
// own per-detail logic — see wave2-patch-share.md for the exact host signals
// to adapt it from.
import { toErrorKey } from '../../core/describe-error';
import { ChangeDetectionStrategy, Component, ElementRef, TemplateRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { LocaleService } from '../../core/locale/locale.service';
import { formatScDate } from '../../core/locale/date-format';
import { CodexService } from '../codex.service';
import { CodexBuild, isReExtractPending } from '../codex.types';
import { CodexDetail } from '../codex.service';
import { totalRecordCount } from '../codex-patch-timeline';
import { KpiSheet } from '../codex-loadout-stats';
import {
  BuildRef,
  KpiCellDelta,
  PortOccupantMap,
  buildPerspectiveDeltas,
  compareKpiSheets,
  comparePortOccupants,
} from '../codex-build-compare';
import { CodexHoloPatchDeltaComponent } from './codex-holo-patch-delta.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/** One port's Δ badge — keyed by port name in {@link CodexHoloPatchComponent.portPins}'s emitted map. */
export interface PortPinBadge {
  portName: string;
  fromClassName: string | null;
  toClassName: string | null;
  /** The port itself does not exist on the `to` (comparison) side — the host renders the unresolved ring, never guesses an occupant. */
  unresolved: boolean;
}

/** Ghost values + delta chips for the KPI band, one full set per comparison pick. */
export interface HoloPatchKpiGhosts {
  toBuild: BuildRef;
  cells: readonly KpiCellDelta[];
}

/** What the host's `resolveComparisonSide` must return for one build-scoped detail. */
export interface HoloPatchComparisonSide {
  kpiSheet: KpiSheet;
  occupants: PortOccupantMap;
}

/** One side of the comparison line: a listed build, or the build on the table. */
export type HoloPatchSide = CodexBuild | 'active';

@Component({
  selector: 'sc-codex-holo-patch',
  standalone: true,
  imports: [TranslatePipe, CodexHoloPatchDeltaComponent, ScTooltipDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- One line (r4 d1 s6, C18): "4.10.1 [Live] ▾ → 4.10.2 [Live] ● aktuell ▾".
         The right side is always the newer patch; each list disables what would break that. -->
    <div class="pline">
      <span class="pw">
        <button #trigger type="button" class="patch-trigger pv mono" [class.on]="openSide() === 'from'"
                (click)="toggle()" aria-haspopup="listbox" [attr.aria-expanded]="openSide() === 'from'"
                [attr.aria-controls]="panelId" [attr.aria-keyshortcuts]="hotkey()"
                [attr.aria-label]="'codex.holo.patch.fromAria' | translate: { patch: fromLabel() }"
                [scTooltip]="'codex.holo.patch.trigger.hotkeyHint' | translate">
          @if (from(); as f) {
            {{ sideVersion(f) }}
            <!-- Two extracts of one patch (4.10.2 → 4.10.2): the build tells them apart. -->
            @if (f !== 'active' && f.patchVersion === sideVersion(to())) { <small class="bn">#{{ f.buildNumber.slice(-4) }}</small> }
            <em class="ch">{{ channelLabel(sideChannel(f)) }}</em>
            @if (sideCurrent(f)) { <span class="cur">{{ 'codex.holo.patch.current' | translate }}</span> }
          } @else {
            <span class="ph">{{ 'codex.holo.patch.pickFrom' | translate }}</span>
          }
          @if (hotkey(); as hk) { <kbd class="hk" aria-hidden="true">{{ hk }}</kbd> }
          <span class="car" aria-hidden="true">{{ openSide() === 'from' ? '▴' : '▾' }}</span>
        </button>
        @if (openSide() === 'from') { <ng-container *ngTemplateOutlet="list; context: { side: 'from' }" /> }
      </span>
      <span class="ar" aria-hidden="true">→</span>
      <span class="pw">
        <button type="button" class="pv pv-to mono" [class.on]="openSide() === 'to'"
                (click)="toggleTo()" aria-haspopup="listbox" [attr.aria-expanded]="openSide() === 'to'"
                [attr.aria-controls]="panelId"
                [attr.aria-label]="'codex.holo.patch.toAria' | translate: { patch: sideVersion(to()) }">
          {{ sideVersion(to()) }} <em class="ch">{{ channelLabel(sideChannel(to())) }}</em>
          @if (sideCurrent(to())) { <span class="cur">{{ 'codex.holo.patch.current' | translate }}</span> }
          <span class="car" aria-hidden="true">{{ openSide() === 'to' ? '▴' : '▾' }}</span>
        </button>
        @if (openSide() === 'to') { <ng-container *ngTemplateOutlet="list; context: { side: 'to' }" /> }
      </span>
    </div>

    <ng-template #list let-side="side">
      <div #pop class="patch-pop" [id]="panelId" role="dialog" tabindex="-1"
           animate.enter="pp-enter" animate.leave="pp-leave"
           [attr.aria-label]="(side === 'from' ? 'codex.holo.patch.fromTitle' : 'codex.holo.patch.toTitle') | translate">
        @if (loading()) {
          <p class="pop-state">{{ 'codex.holo.patch.loading' | translate }}</p>
        } @else if (loadFailed()) {
          <div class="pop-err" role="alert">
            <p class="pop-state err">{{ 'codex.error.title' | translate }}</p>
            <button type="button" class="patch-clear" (click)="retryBuilds()">{{ 'codex.error.retry' | translate }}</button>
          </div>
        } @else if (builds().length === 0) {
          <p class="pop-state">{{ 'codex.holo.patch.empty' | translate }}</p>
        } @else {
          <ul class="build-list" role="listbox" [attr.aria-describedby]="panelId + '-why'">
            @for (b of builds(); track b.id) {
              <li>
                <span class="row-wrap" [scTooltip]="blockReason(b, side) ?? rowTitle(b)" scTooltipTier="label">
                  <button type="button" role="option" class="build-row"
                          [class.selected]="isPicked(b, side)"
                          [class.dis]="!!blockReason(b, side)"
                          [attr.aria-selected]="isPicked(b, side)"
                          [disabled]="!!blockReason(b, side)"
                          [attr.aria-disabled]="!!blockReason(b, side)"
                          [style.--r]="$index"
                          (click)="side === 'from' ? pickFrom(b) : pickTo(b)">
                    <span class="row-ver mono">{{ b.patchVersion }}</span>
                    @if (ambiguous(b)) { <span class="row-build mono">{{ b.buildNumber }}</span> }
                    <em class="ch">{{ channelLabel(b.channel) }}</em>
                    @if (b.isCurrent) { <span class="cur">{{ 'codex.holo.patch.current' | translate }}</span> }
                    @if (blockReason(b, side); as why) { <small class="row-flag">{{ why }}</small> }
                  </button>
                </span>
              </li>
            }
          </ul>
          <p class="pop-why" [id]="panelId + '-why'">{{ 'codex.holo.patch.orderHint' | translate }}</p>
          @if (selected()) {
            <button type="button" class="patch-clear" (click)="clear()">{{ 'codex.holo.patch.clear' | translate }}</button>
          }
        }
      </div>
    </ng-template>

    @if (compareLoading()) {
      <p class="delta-state">{{ 'codex.holo.patch.comparing' | translate }}</p>
    }
    @if (compareError(); as e) {
      <p class="delta-state err" role="alert">{{ e | translate }}</p>
    }

    <!-- The comparison's body, for the host that docks it below its switch. -->
    <ng-template #deltaBody>
      @if (perspectives(); as groups) {
        <div class="delta-head">
          <span class="pop-label">{{ 'codex.holo.patch.changedOn' | translate: { name: shipName() } }}</span>
          <button type="button" class="patch-clear" (click)="clear()">{{ 'codex.holo.patch.clear' | translate }}</button>
        </div>
        <div class="delta-view">
          @for (g of groups; track g.perspective) {
            <sc-codex-holo-patch-delta [group]="g" />
          }
        </div>
        @if (roles.isCollaborator()) {
          <div class="admin-schema-row" role="note">
            <span class="sc-sr-only">{{ 'codex.holo.patch.adminOnly' | translate }}</span>
            <dl>
              <dt>{{ 'codex.holo.patch.schema.version' | translate }}</dt>
              <dd>{{ selected()?.schemaVersion }}</dd>
              <dt>{{ 'codex.holo.patch.schema.extractedAt' | translate }}</dt>
              <dd>{{ selected()?.extractedAt ?? '—' }}</dd>
              <dt>{{ 'codex.holo.patch.schema.entityCount' | translate }}</dt>
              <dd>{{ entityCount(selected()) ?? '—' }}</dd>
              @if (reExtractPending()) {
                <dt>{{ 'codex.holo.patch.schema.reExtractPending' | translate }}</dt>
                <dd>{{ 'codex.holo.patch.schema.reExtractPendingYes' | translate }}</dd>
              }
            </dl>
          </div>
        }
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }
    /* One line in the 358 px card (C18): compact pickers, the channel as a tag inside, nothing wraps. */
    .pline { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; min-width: 0; }
    .pw { position: relative; display: inline-flex; min-width: 0; }
    .ar { flex: none; color: var(--sc-fg-2); }
    .pv {
      display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
      min-height: max(30px, var(--sc-tap-min, 0px)); padding: 2px 7px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border)); border-radius: 4px;
      background: var(--sc-bg-0); color: var(--sc-fg-0);
      font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer;
      transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
    }
    .pv:hover, .pv.on { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); }
    .pv.on { background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .pv:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--sc-accent); }
    .ph { font-family: var(--sc-font-body, inherit); color: var(--sc-fg-2); }
    /* The channel as a small tag, never "-LIVE" glued to the number. */
    .ch { font-style: normal; font-family: var(--sc-font-body, inherit); font-size: max(0.64rem, var(--sc-fs-floor));
      padding: 1px 5px; border-radius: 3px; border: 1px solid var(--sc-border); color: var(--sc-fg-1); letter-spacing: 0.04em; }
    .cur { display: inline-flex; align-items: center; gap: 4px; font-family: var(--sc-font-body, inherit);
      font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .cur::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--sc-accent); }
    .car { font-size: 0.62rem; color: var(--sc-fg-2); }
    .bn { font-size: max(0.62rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .patch-pop {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 80;
      width: min(280px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px; border-radius: var(--holo-r);
      background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
      transform-origin: 24px 0;
    }
    .pv-to + .patch-pop { left: auto; right: 0; transform-origin: calc(100% - 24px) 0; }
    .pp-enter { animation: pp-in var(--holo-t-base) var(--holo-e-out); }
    .pp-leave { animation: pp-out var(--holo-t-fast) var(--holo-e-io) forwards; }
    @keyframes pp-in { from { opacity: 0; transform: translateY(calc(-1 * var(--holo-rise))) scale(0.97); } }
    @keyframes pp-out { to { opacity: 0; transform: translateY(-4px) scale(0.98); } }
    .patch-pop:focus { outline: none; }
    .pop-label { font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
    .pop-state { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .pop-state.err, .delta-state.err { color: var(--sc-danger); }
    .pop-err { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .pop-why { margin: 2px 4px 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .build-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; }
    .row-wrap { display: block; }
    .build-row {
      width: 100%; display: flex; align-items: center; gap: 8px;
      min-height: max(36px, var(--sc-tap-min, 0px)); padding: 6px 9px; border-radius: 4px;
      border: 1px solid transparent; background: transparent; color: var(--sc-fg-1);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; text-align: left;
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
      animation: row-in 260ms var(--holo-e-out) backwards; animation-delay: calc(min(var(--r, 0), 10) * 22ms);
    }
    @keyframes row-in { from { opacity: 0; transform: translateX(6px); } }
    .build-row:hover:not(:disabled), .build-row.selected {
      border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
      color: var(--sc-fg-0);
    }
    .build-row:disabled { opacity: 0.5; cursor: not-allowed; }
    .row-build { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .row-flag { margin-left: auto; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }

    .patch-clear { align-self: flex-start; min-height: 32px; padding: 4px 10px;
      border-radius: var(--holo-r); border: 1px solid var(--sc-border); background: var(--sc-bg-0);
      color: var(--sc-fg-2); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; }
    /* Clearing a comparison is not destructive — accent, never danger. */
    .patch-clear:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    .delta-state { margin: 6px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    /* Hotkey badge (#644): discreet, hidden on touch. */
    /* Out of the flow: the hidden hint never widens the picker. */
    .hk { position: absolute; top: -9px; right: -4px; background: var(--sc-bg-0); padding: 0 4px; border: 1px solid var(--sc-border); border-radius: 2px; font-family: var(--font-monospace, monospace); font-size: 9px;
      color: var(--sc-fg-2); opacity: 0; transition: opacity 0.16s ease; }
    .pv:hover .hk, .pv:focus-visible .hk { opacity: 1; }
    @media (hover: none), (pointer: coarse) { .hk { display: none; } }
    .delta-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .delta-head .patch-clear { flex: none; }
    .delta-head .pop-label { flex: 1; min-width: 0; }
    .delta-view { display: flex; flex-direction: column; gap: 6px; }

    /* Collaborator-only info: the copper marks it, the words stay for assistive tech. */
    .admin-schema-row {
      margin-top: 10px; padding: 8px 10px; border-radius: var(--holo-r);
      border: 1px solid color-mix(in srgb, var(--sc-accent-collab) 45%, var(--sc-border));
      background: color-mix(in srgb, var(--sc-accent-collab) 8%, transparent);
    }
    .admin-schema-row dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
    .admin-schema-row dt { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .admin-schema-row dd { margin: 0; color: var(--sc-fg-0); font-size: max(0.72rem, var(--sc-fs-floor)); }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  `],
})
export class CodexHoloPatchComponent {
  readonly className = input.required<string>();
  readonly channel = input('LIVE');
  readonly activeBuild = input.required<BuildRef>();
  readonly activeKpiSheet = input.required<KpiSheet>();
  readonly activeOccupants = input.required<PortOccupantMap>();
  readonly resolveComparisonSide =
    input.required<(detail: CodexDetail) => HoloPatchComparisonSide | Promise<HoloPatchComparisonSide>>();
  /** The ship's name for "Was sich an der Gladius geändert hat". */
  readonly shipName = input('');
  /** The comparison is on screen: once the list is read, pick the patch before the table's on its own. */
  readonly autoCompare = input(false);

  /** Ghost values + delta chips for the KPI band cells; `null` = comparison cleared. */
  readonly kpiGhosts = output<HoloPatchKpiGhosts | null>();
  /** Pin badges per port, keyed by port name; `null` = comparison cleared. */
  readonly portPins = output<Readonly<Record<string, PortPinBadge>> | null>();
  /** The build compared with the table's, or `null` once cleared (or when neither side is the table's). */
  readonly comparisonBuild = output<CodexBuild | null>();

  private readonly svc = inject(CodexService);
  readonly roles = inject(RoleService);
  private readonly locale = inject(LocaleService);
  private readonly i18n = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly panelId = 'codex-holo-patch-pop';
  /** The holodeck's key for this chooser (#644) — shown as a <kbd> in the trigger. */
  readonly hotkey = input<string | null>(null);
  /** Which of the two lists is open. */
  readonly openSide = signal<'from' | 'to' | null>(null);
  readonly open = computed(() => this.openSide() !== null);
  readonly loading = signal(false);
  readonly compareLoading = signal(false);
  /** The channel's builds, newest first (`created_at` desc) — the order IS the age. */
  readonly builds = signal<CodexBuild[]>([]);
  /** The build list could not be read — not the same as "no other patches". */
  readonly loadFailed = signal(false);
  /** i18n key of a failed comparison (never raw text). */
  readonly compareError = signal<string | null>(null);
  /** Left ("von"), null until picked; right ("bis"), the table's build by default. */
  readonly from = signal<HoloPatchSide | null>(null);
  readonly to = signal<HoloPatchSide>('active');
  /** The compared build that is not the table's (the admin row's subject). */
  readonly selected = signal<CodexBuild | null>(null);
  readonly perspectives = signal<ReturnType<typeof buildPerspectiveDeltas> | null>(null);
  /** The comparison's body, for the host that docks it. */
  readonly deltaBody = viewChild<TemplateRef<unknown>>('deltaBody');
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  /** Cleared by hand: the auto pick stays off until the ship changes. */
  private userCleared = false;
  private compareSeq = 0;

  readonly reExtractPending = computed(() => isReExtractPending(this.selected()?.schemaVersion ?? null));
  readonly fromLabel = computed(() => {
    const f = this.from();
    return f ? this.sideVersion(f) : '—';
  });

  constructor() {
    // Reset the whole picked comparison whenever the ship or channel changes
    // under us — a stale Δ for a different ship/channel is worse than none.
    effect(() => {
      this.className();
      this.channel();
      untracked(() => {
        this.userCleared = false;
        this.clear();
        this.userCleared = false;
        this.builds.set([]);
      });
    });
    // Patch-Vergleich on screen with nothing picked: compare with the patch before.
    effect(() => {
      if (!this.autoCompare() || this.from() || this.compareLoading()) return;
      untracked(() => void this.autoPick());
    });
  }

  isFinalised(b: CodexBuild): boolean {
    return (totalRecordCount(b.entityCounts) ?? 0) > 0 && b.schemaVersion > 0;
  }

  /** The build the table shows right now. */
  isActive(b: CodexBuild): boolean {
    return b.id === this.activeBuild().id;
  }

  /** A patch label shared with another row ("4.x" three times) needs the
   * build number beside it to tell the rows apart. */
  ambiguous(b: CodexBuild): boolean {
    return this.builds().filter((o) => o.patchVersion === b.patchVersion).length > 1;
  }

  entityCount(b: CodexBuild | null): number | null {
    return b ? totalRecordCount(b.entityCounts) : null;
  }

  rowTitle(b: CodexBuild): string | null {
    if (!this.isFinalised(b)) return null;
    return b.extractedAt ? `${b.patchVersion} · ${this.stamp(b.extractedAt)}` : null;
  }

  /** The listed build of the table, when the list carries it. */
  private activeListed(): CodexBuild | null {
    return this.builds().find((b) => this.isActive(b)) ?? null;
  }

  sideVersion(s: HoloPatchSide): string {
    return s === 'active' ? this.activeBuild().patchVersion : s.patchVersion;
  }

  sideChannel(s: HoloPatchSide): string {
    return s === 'active' ? this.activeListed()?.channel ?? this.channel() : s.channel;
  }

  sideCurrent(s: HoloPatchSide): boolean {
    return s === 'active' ? !!this.activeListed()?.isCurrent : s.isCurrent;
  }

  /** "LIVE" → "Live", "PTU" stays — a small tag, never glued to the number. */
  channelLabel(ch: string | null | undefined): string {
    const c = (ch ?? '').toUpperCase();
    if (!c) return '';
    const key = `codex.holo.patch.channel.${c}`;
    const t = this.i18n.instant(key);
    return t && t !== key ? t : c;
  }

  /** Age rank: 0 = newest. The table's build missing from the list counts as the newest. */
  private age(s: HoloPatchSide): number {
    const id = s === 'active' ? this.activeBuild().id : s.id;
    return this.builds().findIndex((b) => b.id === id);
  }

  private sameSide(b: CodexBuild, s: HoloPatchSide | null): boolean {
    if (!s) return false;
    return s === 'active' ? this.isActive(b) : s.id === b.id;
  }

  isPicked(b: CodexBuild, side: 'from' | 'to'): boolean {
    return this.sameSide(b, side === 'from' ? this.from() : this.to());
  }

  /** Why `b` cannot go on `side` (the reason tooltip), or null when it can. */
  blockReason(b: CodexBuild, side: 'from' | 'to'): string | null {
    if (!this.isFinalised(b)) return this.i18n.instant('codex.holo.patch.notFinalised');
    const t = (key: string, patch: string) => this.i18n.instant(key, { patch });
    const ageB = this.builds().indexOf(b);
    if (side === 'from') {
      const other = this.to();
      if (this.sameSide(b, other)) return t('codex.holo.patch.onOtherSide', this.sideVersion(other));
      return ageB <= this.age(other) ? t('codex.holo.patch.newerThan', this.sideVersion(other)) : null;
    }
    const other = this.from();
    if (!other) return null;
    if (this.sameSide(b, other)) return t('codex.holo.patch.onOtherSide', this.sideVersion(other));
    return ageB >= this.age(other) ? t('codex.holo.patch.olderThan', this.sideVersion(other)) : null;
  }

  /** Localised date + time for a build stamp — never the raw ISO string (AUD-188). */
  private stamp(iso: string): string {
    return formatScDate(iso, { language: this.locale.language(), region: this.locale.region(), style: 'datetime' });
  }

  /** Opens the left ("von") list — the P key and the left trigger. */
  toggle(): void {
    this.openList('from');
  }

  toggleTo(): void {
    this.openList('to');
  }

  private openList(side: 'from' | 'to'): void {
    if (this.openSide() === side) {
      this.close();
      return;
    }
    this.openSide.set(side);
    void this.loadOnce();
  }

  close(): void {
    this.openSide.set(null);
  }

  /** The popover's retry after a failed build list. */
  retryBuilds(): void {
    this.builds.set([]);
    void this.loadOnce();
  }

  private async loadOnce(): Promise<void> {
    if (this.builds().length > 0 || this.loading()) return;
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const { builds, failed } = await this.svc.buildsForChannel(this.channel());
      this.builds.set(builds);
      this.loadFailed.set(failed);
    } finally {
      this.loading.set(false);
    }
  }

  private async autoPick(): Promise<void> {
    if (this.userCleared) return;
    await this.loadOnce();
    if (this.from() || this.userCleared || !this.autoCompare()) return;
    // "From" = the previous PATCH: a re-extract of the table's own patch (4.10.2 again) is skipped when an older patch exists.
    const open = this.builds().filter((b) => !this.blockReason(b, 'from'));
    const toVersion = this.sideVersion(this.to());
    const prev = open.find((b) => b.patchVersion !== toVersion) ?? open[0];
    if (prev) await this.pickFrom(prev);
  }

  /** Compare `build` with the table's: the older one goes left, the newer right. */
  async pick(build: CodexBuild): Promise<void> {
    if (!this.isFinalised(build) || this.isActive(build)) return;
    const newer = this.age(build) >= 0 && this.age(build) < this.age('active');
    this.from.set(newer ? 'active' : build);
    this.to.set(newer ? build : 'active');
    await this.run();
  }

  async pickFrom(build: CodexBuild): Promise<void> {
    if (this.blockReason(build, 'from')) return;
    this.from.set(this.isActive(build) ? 'active' : build);
    await this.run();
  }

  async pickTo(build: CodexBuild): Promise<void> {
    if (this.blockReason(build, 'to')) return;
    this.to.set(this.isActive(build) ? 'active' : build);
    if (this.from()) await this.run();
    else this.close();
  }

  private async sideData(s: HoloPatchSide): Promise<HoloPatchComparisonSide | null> {
    if (s === 'active') return { kpiSheet: this.activeKpiSheet(), occupants: this.activeOccupants() };
    const detail = await this.svc.shipDetailForBuild(this.className(), s.id);
    return detail ? this.resolveComparisonSide()(detail) : null;
  }

  private async run(): Promise<void> {
    const from = this.from();
    const to = this.to();
    this.close();
    if (!from) return;
    const seq = ++this.compareSeq;
    this.compareLoading.set(true);
    this.compareError.set(null);
    try {
      const [a, b] = await Promise.all([this.sideData(from), this.sideData(to)]);
      if (seq !== this.compareSeq) return;
      if (!a || !b) {
        this.clear();
        return;
      }
      // Old → new: the delta reads the way the line does.
      this.perspectives.set(buildPerspectiveDeltas(compareKpiSheets(a.kpiSheet, b.kpiSheet)));
      // Ghosts and pins on the table only make sense against the table's own build.
      const other = from === 'active' ? to : to === 'active' ? from : null;
      const otherSide = from === 'active' ? b : a;
      this.selected.set(other !== 'active' ? other : null);
      if (other && other !== 'active') {
        const pins: Record<string, PortPinBadge> = {};
        for (const d of comparePortOccupants(this.activeOccupants(), otherSide.occupants)) {
          pins[d.portName] = {
            portName: d.portName,
            fromClassName: d.fromClassName,
            toClassName: d.toClassName,
            // Port present on the table's side but absent as a KEY on the other
            // side = the port itself doesn't exist on that build (wave1-redteam note).
            unresolved: d.portName in this.activeOccupants() && !(d.portName in otherSide.occupants),
          };
        }
        this.kpiGhosts.emit({
          toBuild: { id: other.id, patchVersion: other.patchVersion },
          cells: compareKpiSheets(this.activeKpiSheet(), otherSide.kpiSheet),
        });
        this.portPins.emit(pins);
        this.comparisonBuild.emit(other);
      } else {
        this.selected.set(from !== 'active' ? from : null);
        this.kpiGhosts.emit(null);
        this.portPins.emit(null);
        this.comparisonBuild.emit(null);
      }
    } catch (err) {
      // A click handler must not end in an unhandled rejection.
      const id = from !== 'active' ? from.id : to !== 'active' ? to.id : this.activeBuild().id;
      this.compareError.set(toErrorKey('codex', 'compare', err, { buildId: id }));
      this.clear();
    } finally {
      if (seq === this.compareSeq) this.compareLoading.set(false);
    }
  }

  /** Ends the comparison (by hand: the auto pick stays off until the ship changes). */
  clear(): void {
    this.userCleared = true;
    this.compareSeq++;
    this.compareLoading.set(false);
    this.from.set(null);
    this.to.set('active');
    this.selected.set(null);
    this.perspectives.set(null);
    this.kpiGhosts.emit(null);
    this.portPins.emit(null);
    this.comparisonBuild.emit(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open()) return;
    this.close();
    this.trigger()?.nativeElement.focus({ preventScroll: true });
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    if (this.host.nativeElement.contains(ev.target as Node)) return;
    this.close();
  }
}
