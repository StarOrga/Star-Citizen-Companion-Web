import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { STEP_KINDS, STEP_SHAPES, ScStepComponent, StepKind } from '../../shared/step/sc-step.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { HqEinsatzService, einsatzBadge } from '../data/hq-einsatz.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqSuppliesPopupComponent } from '../hq-supplies-popup.component';
import { HqSuppliesService } from '../hq-supplies.service';
import { HqStartFeedService } from '../start/hq-start-feed.service';
import { HqMoodTogglesComponent } from './hq-mood-toggles.component';
import { MoodPair, MoodSide, activeMoodKeys } from './hq-moods';
import { buildPlanNeeds, buildPlanSets, placesFromEinsaetze } from './hq-plan-needs';
import {
  PlanSelection,
  applyMood,
  clearSelection,
  initialSelection,
  passesFilters,
  saveSelection,
  setPlaces,
  soonSetKeys,
  toMapNeed,
  toggleNeed,
  toggleSet,
  toggleStepKind,
  top3Selection,
  visibleNeeds,
} from './hq-plan-selection';
import { HqPlaceTreeComponent } from './hq-place-tree.component';
import { HqSetRingsComponent } from './hq-set-rings.component';
import { HqCommunityOptinComponent } from './hq-community-optin.component';
import { HqPlanMapComponent } from './map/hq-plan-map.component';
import { buildRoute } from './map/hq-route';
import type { MapPlace, PlanView } from './map/hq-map.types';

/**
 * HQ page "Planen" (concept D23-D31): what do I need (Was) and how do I get there (Wie).
 *
 * - "Auswahl" (only in Was): sets as rings, mood pairs, step-kind chips, the Ort tree. There is
 *   no mode toggle - Top 3 is the default, a mood click is "Nach Lust", any other change "Gezielt".
 *   The selection is remembered per tab session (sessionStorage).
 * - Unselected needs are gone from the list AND the map. Wie shows the route as unified `sc-step`
 *   rows, without filters, and saves it as an Einsatz.
 * - Nachschub (the supplies list) opens from here.
 * The section frame (`<section id="planen">`) belongs to `HqPagesComponent`.
 */
@Component({
  selector: 'sc-hq-plan',
  standalone: true,
  imports: [
    TranslatePipe,
    ScStepComponent,
    ScTristateComponent,
    ScTooltipDirective,
    HqMoodTogglesComponent,
    HqPlaceTreeComponent,
    HqSetRingsComponent,
    HqSuppliesPopupComponent,
    HqPlanMapComponent,
    HqCommunityOptinComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="page-title" id="hq-plan-title">{{ 'hq.pages.planen' | translate }}</h2>
      <div class="switch" role="group" [attr.aria-label]="'hq.plan.switch.label' | translate">
        <button type="button" class="seg" [attr.aria-pressed]="view() === 'what'" (click)="view.set('what')">
          {{ 'hq.plan.switch.what' | translate }}
        </button>
        <button type="button" class="seg" [attr.aria-pressed]="view() === 'how'" (click)="view.set('how')">
          {{ 'hq.plan.switch.how' | translate }}
        </button>
      </div>
      <button type="button" class="sc-btn nach" aria-haspopup="dialog" (click)="suppliesOpen.set(true)">
        {{ 'hq.supplies.button' | translate }} <b class="mono">{{ supplies.open().length }}</b>
      </button>
    </header>

    @if (syncError(); as key) {
      <p class="err" role="alert">
        {{ key | translate }}
        <button type="button" class="sc-btn small ghost" (click)="retry()">{{ 'hq.plan.retry' | translate }}</button>
      </p>
    }

    @if (view() === 'what') {
      <section class="select" aria-labelledby="hq-plan-sel">
        <div class="sel-head">
          <h3 id="hq-plan-sel">{{ 'hq.plan.selection' | translate }}</h3>
          <span class="state" role="status">{{ stateLabel() }}</span>
        </div>
        <sc-hq-set-rings [sets]="sets()" [needs]="needs()" [selection]="selection()" (setToggled)="onSet($event)" />
        <sc-hq-mood-toggles [moods]="selection().moods" (moodChange)="onMood($event.pair, $event.side)" />
        <ul class="kinds" [attr.aria-label]="'hq.plan.stepsAria' | translate">
          @for (k of kinds; track k) {
            <li>
              <button type="button" class="kind" [attr.aria-pressed]="selection().steps.has(k)" (click)="commit(toggleStep(k))">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  @if (shapes[k] === 'circle') { <circle cx="12" cy="12" r="9.5" /> } @else { <polygon [attr.points]="shapes[k]" /> }
                </svg>
                {{ 'hq.step.kind.' + k | translate }}
              </button>
            </li>
          }
        </ul>
        <sc-hq-place-tree [places]="allPlaces()" [selected]="selection().places" (selectedChange)="commit(placesSel($event))" />
      </section>
    }

    <sc-hq-plan-map [needs]="mapNeeds()" [route]="route()" [view]="view()" />
    <sc-hq-community-optin />

    @if (view() === 'what') {
      @if (listNeeds().length === 0) {
        <p class="empty" role="status">{{ 'hq.plan.empty' | translate }}</p>
      } @else {
        <ul class="needs" [attr.aria-label]="'hq.supplies.title' | translate">
          @for (n of listNeeds(); track n.id) {
            <li class="need" [class.sel]="selection().supplyIds.has(n.id)" [class.ready]="n.status === 'done'">
              <sc-tristate variant="checkbox" [label]="n.label" [value]="selection().supplyIds.has(n.id) ? 1 : 0" (toggled)="commit(toggleOne(n.id))" />
              <span class="n-body">
                <span class="n-name">{{ n.label }}<b class="mono qty"> ×{{ n.qty }}</b></span>
                <span class="n-meta">
                  @if (n.setName) { {{ 'hq.supply.forSet' | translate: { name: n.setName } }} }
                </span>
              </span>
              <span class="kind-tag">{{ 'hq.step.kind.' + n.kind | translate }}</span>
              @if (n.status === 'done') { <span class="ready-tag">{{ 'hq.supply.ready' | translate }}</span> }
            </li>
          }
        </ul>
      }
    } @else {
      <section class="route" aria-labelledby="hq-plan-route">
        <h3 id="hq-plan-route">{{ 'hq.plan.route' | translate }}</h3>
        @if (route().length === 0) {
          <p class="empty" role="status">{{ 'hq.plan.routeEmpty' | translate }}</p>
        } @else {
          <div class="steps" role="list">
            @for (s of route(); track s.ord) {
              <sc-step [kind]="s.kind" [label]="s.label" [location]="s.place.location" />
            }
          </div>
        }
        <button type="button" class="sc-btn sc-btn-primary save" [disabled]="route().length === 0" (click)="saveEinsatz()">
          {{ 'hq.plan.saveEinsatz' | translate }}
        </button>
      </section>

      <section class="einsaetze" aria-labelledby="hq-plan-ein">
        <h3 id="hq-plan-ein">{{ 'hq.einsatz.title' | translate }}</h3>
        @if (einsatz.items().length === 0) {
          <p class="empty">{{ 'hq.einsatz.empty' | translate }}</p>
        } @else {
          <ul class="ein-list">
            @for (e of einsatz.items(); track e.id) {
              <li class="ein">
                <div class="ein-head">
                  <strong class="ein-title">{{ e.title }}</strong>
                  <span class="badge" [scTooltip]="badge(e).multi ? ('hq.einsatz.stepsTooltip' | translate: { n: badge(e).n }) : null">
                    {{ badge(e).multi ? ('hq.einsatz.multi' | translate: { n: badge(e).n }) : ('hq.einsatz.single' | translate) }}
                  </span>
                  <button type="button" class="sc-btn tiny ghost rm" [attr.aria-label]="'hq.einsatz.remove' | translate: { name: e.title }"
                          [scTooltip]="'hq.einsatz.remove' | translate: { name: e.title }" scTooltipTier="label" (click)="removeEinsatz(e.id, e.title)">✕</button>
                </div>
                <div class="steps" role="list">
                  @for (s of e.steps; track s.ord) {
                    <div class="ein-step">
                      <sc-tristate variant="checkbox" [label]="s.label" [value]="s.state === 'done' ? 1 : 0" (toggled)="einsatz.toggleStep(e.id, s.ord)" />
                      <sc-step [kind]="s.kind" [state]="s.state" [label]="s.label" [qty]="s.qty" [location]="s.location"
                               [undoable]="s.doneBy === 'live'" (undo)="einsatz.unmarkStep(e.id, s.ord)" />
                    </div>
                  }
                </div>
              </li>
            }
          </ul>
        }
      </section>
    }

    @if (suppliesOpen()) {
      <sc-hq-supplies-popup (closed)="suppliesOpen.set(false)" />
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-4, 16px); }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .page-title { margin: 0; margin-right: auto; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .switch { display: inline-flex; padding: 3px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); }
      .seg { min-height: 40px; padding: 0 var(--sc-space-4, 16px); border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .seg:hover { color: var(--sc-fg); }
      .seg[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 12px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .seg:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .nach { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 40px; }
      .select { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); padding: var(--sc-space-4, 16px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .sel-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sc-space-3, 12px); }
      .sel-head h3, .route h3, .einsaetze h3 { margin: 0; font-size: 1rem; }
      .state { color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .kinds { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .kind { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 36px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .kind svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
      .kind:hover { color: var(--sc-fg); border-color: var(--sc-fg-2); }
      .kind[aria-pressed='true'] { color: var(--sc-fg); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .kind[aria-pressed='true'] svg { stroke: var(--sc-accent); }
      .kind:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .empty { margin: 0; color: var(--sc-fg-2); }
      .err { margin: 0; display: flex; align-items: center; gap: var(--sc-space-3, 12px); color: var(--sc-warning); }
      .needs, .ein-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .need { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; }
      .need.sel { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
      .n-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .n-name { overflow-wrap: anywhere; }
      .qty { color: var(--sc-fg-2); }
      .n-meta { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .kind-tag, .ready-tag, .badge { flex: none; padding: 1px 10px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .ready-tag { color: var(--sc-accent); border-color: var(--sc-accent); }
      .badge { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); }
      .route, .einsaetze { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .steps { display: flex; flex-direction: column; border-top: 1px solid var(--sc-border); }
      .steps > * + * { border-top: 1px solid var(--sc-border); }
      .save { align-self: flex-start; min-height: var(--sc-tap-min, 44px); }
      .ein { padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .ein-head { display: flex; align-items: center; gap: var(--sc-space-3, 12px); margin-bottom: var(--sc-space-2, 8px); }
      .ein-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .ein-step { display: flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .ein-step sc-step { flex: 1; min-width: 0; }
      @media (pointer: coarse) { .seg, .kind, .nach { min-height: 48px; } .rm { min-width: 48px; min-height: 48px; } }
      @media (max-width: 640px) { .page-title { flex-basis: 100%; } }
    `,
  ],
})
export class HqPlanComponent {
  protected readonly supplies = inject(HqSuppliesService);
  protected readonly einsatz = inject(HqEinsatzService);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly feed = inject(HqStartFeedService);
  private readonly confirm = inject(ScConfirmService);
  private readonly i18n = inject(TranslateService);

  protected readonly kinds = STEP_KINDS;
  protected readonly shapes = STEP_SHAPES;
  protected readonly view = signal<PlanView>('what');
  protected readonly suppliesOpen = signal(false);

  protected readonly sets = computed(() =>
    buildPlanSets(this.hangar.ships(), this.ownership.configs(), this.hangar.roleLoadouts(), this.supplies.items()),
  );
  private readonly placeMap = computed(() => placesFromEinsaetze(this.einsatz.items()));
  protected readonly needs = computed(() => buildPlanNeeds(this.supplies.items(), this.sets(), this.placeMap()));
  private readonly ctx = computed(() => ({
    needs: this.needs(),
    sets: this.sets(),
    soonSets: soonSetKeys(this.einsatz.items(), this.needs()),
  }));

  /** What the user changed in this tab session; null = the live Top 3 default. */
  private readonly userSel = signal<PlanSelection | null>(this.restore());
  protected readonly selection = computed<PlanSelection>(() => this.userSel() ?? top3Selection(this.ctx()));

  protected readonly allPlaces = computed<MapPlace[]>(() => this.needs().flatMap((n) => (n.place ? [n.place] : [])));
  /** The list in Was: everything inside the filters; the checkbox shows what is selected. */
  protected readonly listNeeds = computed(() => this.needs().filter((n) => n.wanted && passesFilters(this.selection(), n)));
  protected readonly mapNeeds = computed(() => visibleNeeds(this.selection(), this.needs()).map(toMapNeed));
  protected readonly route = computed(() => (this.view() === 'how' ? buildRoute(this.mapNeeds(), null) : []));

  protected readonly stateLabel = computed(() => {
    const s = this.selection();
    if (s.origin === 'top3') return this.i18n.instant('hq.plan.state.top3');
    if (s.origin === 'mood') {
      const moods = activeMoodKeys(s.moods).map((k) => this.i18n.instant(k)).join(' + ');
      return this.i18n.instant('hq.plan.state.mood', { moods });
    }
    return this.i18n.instant('hq.plan.state.custom');
  });

  constructor() {
    void this.ownership.ensureLoaded();
    const destroyRef = inject(DestroyRef);
    // "Jetzt wichtig" chips on Start: upcoming Einsaetze, then a set whose Nachschub is all ready.
    effect(() => {
      const upcoming = this.einsatz.upcoming().slice(0, 3).map((e) => ({
        id: `einsatz-${e.id}`,
        label: einsatzBadge(e).multi ? `${e.title} ×${e.steps.length}` : e.title,
        link: ['/hq'],
        fragment: 'planen',
      }));
      const ready = this.sets()
        .filter((s) => {
          const own = this.needs().filter((n) => n.setKey === s.key && n.wanted);
          return own.length > 0 && own.every((n) => n.status === 'done');
        })
        .slice(0, 1)
        .map((s) => ({
          id: `supply-ready-${s.key}`,
          label: this.i18n.instant('hq.supply.setReady', { name: s.name }),
          link: ['/hq'],
          fragment: 'planen',
        }));
      this.feed.chips.set([...upcoming, ...ready].slice(0, 4));
    });
    destroyRef.onDestroy(() => this.feed.chips.set([]));
  }

  protected badge = einsatzBadge;

  protected readonly syncError = computed(() => this.supplies.syncError() ?? this.einsatz.syncError());

  protected retry(): void {
    void this.supplies.sync();
    void this.einsatz.sync();
  }

  protected onMood(pair: MoodPair, side: MoodSide): void {
    this.commit(applyMood(this.selection(), pair, side, this.ctx()));
  }

  protected onSet(key: string): void {
    this.commit(toggleSet(this.selection(), key, this.needs()));
  }

  protected toggleStep(k: StepKind): PlanSelection {
    return toggleStepKind(this.selection(), k);
  }

  protected toggleOne(id: string): PlanSelection {
    return toggleNeed(this.selection(), id);
  }

  protected placesSel(ids: ReadonlySet<string>): PlanSelection {
    return setPlaces(this.selection(), ids);
  }

  /** A user change: remember it for this tab session (back on Top 3 = forget it). */
  protected commit(next: PlanSelection): void {
    const session = sessionOrNull();
    if (next.origin === 'top3') {
      this.userSel.set(null);
      clearSelection(session);
    } else {
      this.userSel.set(next);
      saveSelection(session, next);
    }
  }

  protected async saveEinsatz(): Promise<void> {
    const steps = this.route();
    if (steps.length === 0) return;
    const first = this.needs().find((n) => steps[0].needIds.includes(n.id));
    const suggestion = first?.setName ?? steps[0].label;
    const name = await this.confirm.prompt({
      titleKey: 'hq.plan.saveEinsatz',
      inputLabelKey: 'hq.einsatz.nameLabel',
      inputMaxLength: 120,
    });
    if (name === null) return;
    const byId = new Map(this.needs().map((n) => [n.id, n] as const));
    const saved = this.einsatz.create({
      title: name.trim() || suggestion,
      startLocation: steps[0].place.location,
      steps: steps.map((s) => {
        const need = byId.get(s.needIds[0]);
        return {
          kind: s.kind,
          label: s.label,
          location: s.place.location,
          system: s.place.system,
          className: need?.className ?? null,
          qty: need?.qty ?? null,
          supplyId: need?.id ?? null,
          missionRef: null,
        };
      }),
    });
    if (saved) this.view.set('how');
  }

  protected async removeEinsatz(id: string, title: string): Promise<void> {
    const ok = await this.confirm.confirm({
      titleKey: 'hq.einsatz.removeTitle',
      messageKey: 'hq.einsatz.removeMessage',
      params: { name: title },
      tone: 'danger',
    });
    if (ok) this.einsatz.remove(id);
  }

  private restore(): PlanSelection | null {
    const session = sessionOrNull();
    if (!session) return null;
    const sel = initialSelection(session, { needs: [], sets: [] });
    // Nothing stored (or unchanged) yields the empty Top 3 snapshot: use the live default instead.
    return sel.origin === 'top3' ? null : sel;
  }
}

function sessionOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
