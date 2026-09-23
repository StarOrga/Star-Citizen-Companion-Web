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
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
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

@Component({
  selector: 'sc-codex-holo-patch',
  standalone: true,
  imports: [TranslatePipe, CodexHoloPatchDeltaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-patch">
      <button
        #trigger
        type="button"
        class="patch-trigger mono"
        [class.on]="open()"
        [class.active]="!!selected()"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        [attr.aria-controls]="panelId"
        [attr.title]="'codex.holo.patch.trigger.hotkeyHint' | translate"
      >
        <span>{{ (selected() ? 'codex.holo.patch.trigger.comparing' : 'codex.holo.patch.trigger.idle') | translate: { patch: $safeNavigationMigration(selected()?.patchVersion), active: activeBuild().patchVersion, channel: channel() } }}</span>
        <span class="chev" [class.on]="open()" aria-hidden="true">▾</span>
      </button>

      @if (open()) {
        <div #pop class="patch-pop" [id]="panelId" role="dialog" tabindex="-1"
             [attr.aria-label]="'codex.holo.patch.popTitle' | translate">
          <span class="pop-label">{{ 'codex.holo.patch.popTitle' | translate }}</span>

          @if (loading()) {
            <p class="pop-state">{{ 'codex.holo.patch.loading' | translate }}</p>
          } @else if (builds().length === 0) {
            <p class="pop-state">{{ 'codex.holo.patch.empty' | translate }}</p>
          } @else {
            <ul class="build-list" role="listbox">
              @for (b of builds(); track b.id) {
                <li>
                  <button
                    type="button"
                    role="option"
                    class="build-row"
                    [class.selected]="selected()?.id === b.id"
                    [class.nodata]="!isFinalised(b)"
                    [attr.aria-selected]="selected()?.id === b.id"
                    [disabled]="!isFinalised(b)"
                    [attr.aria-disabled]="!isFinalised(b)"
                    [attr.title]="rowTitle(b)"
                    (click)="pick(b)"
                  >
                    <span class="row-ver mono">{{ b.patchVersion }}</span>
                    @if (!isFinalised(b)) {
                      <span class="row-flag">{{ 'codex.holo.patch.notFinalised' | translate }}</span>
                    }
                  </button>
                </li>
              }
            </ul>
            @if (selected()) {
              <button type="button" class="patch-clear" (click)="clear()">
                {{ 'codex.holo.patch.clear' | translate }}
              </button>
            }
          }
        </div>
      }

      @if (compareLoading()) {
        <p class="delta-state">{{ 'codex.holo.patch.comparing' | translate }}</p>
      }

      <!-- The Δ tables live in an anchored panel, never in the top bar's
           flow (wave 5 A2.6) — the bar keeps its height, the table keeps
           its ghosts/pins, and the panel can be dismissed and reopened. -->
      @if (selected() && !deltaOpen()) {
        <button #deltaReopen type="button" class="delta-reopen" (click)="deltaOpen.set(true)" [attr.aria-expanded]="false">
          Δ {{ 'codex.holo.patch.deltaShow' | translate }}
        </button>
      }
      @if (perspectives(); as groups) {
        @if (deltaOpen()) {
          <div #deltaPanel class="delta-panel" role="region" tabindex="-1" [attr.aria-label]="'codex.holo.patch.trigger.comparing' | translate: { patch: $safeNavigationMigration(selected()?.patchVersion), active: activeBuild().patchVersion, channel: channel() }">
            <div class="delta-head">
              <span class="pop-label">{{ 'codex.holo.patch.trigger.comparing' | translate: { patch: $safeNavigationMigration(selected()?.patchVersion), active: activeBuild().patchVersion, channel: channel() } }}</span>
              <button type="button" class="patch-clear" (click)="clear()">{{ 'codex.holo.patch.clear' | translate }}</button>
              <button type="button" class="delta-close" (click)="deltaOpen.set(false)" [attr.aria-label]="'codex.holo.patch.deltaHide' | translate" [attr.title]="'codex.holo.patch.deltaHide' | translate">✕</button>
            </div>
            <div class="delta-view">
              @for (g of groups; track g.perspective) {
                <sc-codex-holo-patch-delta [group]="g" />
              }
            </div>
            @if (roles.isCollaborator()) {
              <div class="admin-schema-row" role="note">
          <span class="admin-flag">{{ 'codex.holo.patch.adminOnly' | translate }}</span>
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
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }
    .holo-patch { position: relative; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

    .patch-trigger {
      display: inline-flex; align-items: center; gap: 6px;
      min-height: 48px; padding: 7px 12px;
      border: 1px solid var(--sc-border); border-radius: 6px;
      background: var(--sc-bg-1); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
      cursor: pointer; transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
    }
    .patch-trigger:hover, .patch-trigger:focus-visible, .patch-trigger.on {
      outline: none; color: var(--sc-fg-0);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
    }
    .patch-trigger.active { border-color: var(--sc-accent); color: var(--sc-accent); }
    .chev { font-size: 0.62rem; transition: transform 0.16s ease; }
    .chev.on { transform: rotate(180deg); }

    .patch-pop {
      position: absolute; top: calc(100% + 8px); left: 0; z-index: 80;
      width: min(320px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    }
    .patch-pop:focus { outline: none; }
    .pop-label { font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
    .pop-state { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .build-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .build-row {
      width: 100%; display: flex; align-items: center; gap: 8px;
      min-height: 44px; padding: 7px 9px; border-radius: 6px;
      border: 1px solid transparent; background: transparent; color: var(--sc-fg-1);
      font: inherit; cursor: pointer; text-align: left;
    }
    .build-row:hover:not(:disabled), .build-row.selected {
      border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
    }
    .build-row:disabled { opacity: 0.5; cursor: not-allowed; }
    .row-flag { margin-left: auto; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-warn, #ffc14d); }

    .patch-clear { align-self: flex-start; min-height: 40px; padding: 5px 10px;
      border-radius: 6px; border: 1px solid var(--sc-border); background: var(--sc-bg-0);
      color: var(--sc-fg-2); font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer; }
    .patch-clear:hover { border-color: var(--sc-danger, #ff5252); color: var(--sc-danger, #ff5252); }

    .delta-state { margin: 0; white-space: nowrap; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .delta-reopen { min-height: 40px; padding: 4px 10px; border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); background: var(--sc-bg-1); color: var(--sc-accent);
      font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; white-space: nowrap; transition: border-color 0.16s ease, color 0.16s ease; }
    .delta-reopen:hover, .delta-reopen:focus-visible { border-color: var(--sc-accent); outline: none; color: var(--sc-fg-0); }
    .delta-panel {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 70;
      width: min(420px, calc(100vw - 32px)); max-height: min(70vh, 640px); overflow: auto;
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    }
    .delta-panel:focus { outline: none; }
    .delta-panel:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .delta-head { display: flex; align-items: center; gap: 8px; }
    .delta-head .pop-label { flex: 1; min-width: 0; }
    .delta-head .patch-clear { min-height: 32px; padding: 3px 8px; }
    .delta-close { background: none; border: none; color: var(--sc-fg-2); cursor: pointer; min-height: 32px; min-width: 32px; font: inherit; }
    .delta-close:hover { color: var(--sc-fg-0); }
    .delta-view { display: flex; flex-direction: column; gap: 6px; }

    /* --sc-accent-hot: admin/collaborator-only info, marked in words too. */
    .admin-schema-row {
      margin-top: 10px; padding: 8px 10px; border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--sc-accent-hot) 45%, var(--sc-border));
      background: color-mix(in srgb, var(--sc-accent-hot) 8%, transparent);
    }
    .admin-flag { display: block; margin-bottom: 4px; font-family: var(--sc-font-display);
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--sc-accent-hot); }
    .admin-schema-row dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
    .admin-schema-row dt { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .admin-schema-row dd { margin: 0; color: var(--sc-fg-0); font-size: max(0.72rem, var(--sc-fs-floor)); }
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

  /** Ghost values + delta chips for the KPI band cells; `null` = comparison cleared. */
  readonly kpiGhosts = output<HoloPatchKpiGhosts | null>();
  /** Pin badges per port, keyed by port name; `null` = comparison cleared. */
  readonly portPins = output<Readonly<Record<string, PortPinBadge>> | null>();
  /** The picked comparison build, or `null` once cleared. */
  readonly comparisonBuild = output<CodexBuild | null>();

  private readonly svc = inject(CodexService);
  readonly roles = inject(RoleService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly panelId = 'codex-holo-patch-pop';
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly compareLoading = signal(false);
  readonly builds = signal<CodexBuild[]>([]);
  readonly selected = signal<CodexBuild | null>(null);
  readonly perspectives = signal<ReturnType<typeof buildPerspectiveDeltas> | null>(null);
  /** The Δ panel under the trigger — opens with a pick, dismissable, reopenable. */
  readonly deltaOpen = signal(false);
  private readonly deltaPanel = viewChild<ElementRef<HTMLElement>>('deltaPanel');
  private readonly deltaReopen = viewChild<ElementRef<HTMLElement>>('deltaReopen');
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly focusEffect = effect(() => {
    // Keyboard users follow the panel: focus moves in when it opens and back
    // to the reopen control (or the trigger) when it closes.
    const open = this.deltaOpen();
    const panel = this.deltaPanel()?.nativeElement;
    const back = this.deltaReopen()?.nativeElement ?? this.trigger()?.nativeElement;
    if (open && panel) panel.focus({ preventScroll: true });
    else if (!open && back && this.selected()) back.focus({ preventScroll: true });
  });

  readonly reExtractPending = computed(() => isReExtractPending(this.selected()?.schemaVersion ?? null));

  constructor() {
    // Reset the whole picked comparison whenever the ship or channel changes
    // under us — a stale Δ for a different ship/channel is worse than none.
    effect(() => {
      this.className();
      this.channel();
      this.clear();
      this.builds.set([]);
    });
  }

  isFinalised(b: CodexBuild): boolean {
    return (totalRecordCount(b.entityCounts) ?? 0) > 0 && b.schemaVersion > 0;
  }

  entityCount(b: CodexBuild | null): number | null {
    return b ? totalRecordCount(b.entityCounts) : null;
  }

  rowTitle(b: CodexBuild): string | null {
    if (!this.isFinalised(b)) return null;
    return b.extractedAt ? `${b.patchVersion} · ${b.extractedAt}` : null;
  }

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    void this.loadOnce();
  }

  close(): void {
    this.open.set(false);
  }

  private async loadOnce(): Promise<void> {
    if (this.builds().length > 0) return;
    this.loading.set(true);
    try {
      this.builds.set(await this.svc.buildsForChannel(this.channel()));
    } finally {
      this.loading.set(false);
    }
  }

  async pick(build: CodexBuild): Promise<void> {
    if (!this.isFinalised(build)) return;
    this.close();
    this.compareLoading.set(true);
    try {
      const detail = await this.svc.shipDetailForBuild(this.className(), build.id);
      if (!detail) {
        this.clear();
        return;
      }
      const side = await this.resolveComparisonSide()(detail);
      const toRef: BuildRef = { id: build.id, patchVersion: build.patchVersion };
      const kpiCells = compareKpiSheets(this.activeKpiSheet(), side.kpiSheet);
      const portDeltas = comparePortOccupants(this.activeOccupants(), side.occupants);

      const pins: Record<string, PortPinBadge> = {};
      for (const d of portDeltas) {
        pins[d.portName] = {
          portName: d.portName,
          fromClassName: d.fromClassName,
          toClassName: d.toClassName,
          // Port present in the active ("from") side but absent as a KEY on
          // the comparison ("to") side = the port itself doesn't exist on
          // that build, not merely an empty bay (wave1-redteam note).
          unresolved: d.portName in this.activeOccupants() && !(d.portName in side.occupants),
        };
      }

      this.selected.set(build);
      this.perspectives.set(buildPerspectiveDeltas(kpiCells));
      this.deltaOpen.set(true);
      this.kpiGhosts.emit({ toBuild: toRef, cells: kpiCells });
      this.portPins.emit(pins);
      this.comparisonBuild.emit(build);
    } finally {
      this.compareLoading.set(false);
    }
  }

  clear(): void {
    this.selected.set(null);
    this.perspectives.set(null);
    this.deltaOpen.set(false);
    this.kpiGhosts.emit(null);
    this.portPins.emit(null);
    this.comparisonBuild.emit(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.close();
      return;
    }
    // The Δ panel closes like the picker; the comparison itself stays
    // active (ghosts, pins) until "Vergleich beenden".
    this.deltaOpen.set(false);
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open() && !this.deltaOpen()) return;
    if (this.host.nativeElement.contains(ev.target as Node)) return;
    this.close();
    this.deltaOpen.set(false);
  }
}
