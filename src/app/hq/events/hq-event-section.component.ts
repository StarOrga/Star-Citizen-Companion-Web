import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { humanizeClassName } from '../../codex/codex-format';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import type { Nachschub } from '../nachschub/nachschub.model';
import { EventHqService } from './event-hq.service';
import { prereqView, type PrereqView } from './event-hq.util';
import { reachedTier, resolveEventEnd, type EventRow } from './event-logic';
import { rewardLineState } from './event-nachschub';
import type { EventReward, ProgressTrack } from './event-sheet';
import { HqEventClaimDialogComponent } from './hq-event-claim-dialog.component';
import { HqEventEndComponent } from './hq-event-end.component';

interface AreaView {
  readonly kind: string;
  readonly systems: readonly string[];
  readonly places: readonly string[];
}

/**
 * Body of a Nachschub that is bound to events (type event / sightseeing): per event its area (system / allowed places)
 * with Arena Commander as an extra element next to it, progress per track with tiers (editable, live from the SCC-App),
 * the rewards with their claim, and the prerequisites as AND / OR gear groups. Several events in one Nachschub are
 * possible; a quiet hint says it is not recommended.
 */
@Component({
  selector: 'sc-hq-event-section',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, ScActionDirective, HqEventEndComponent, HqEventClaimDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="evs">
      @if (ids().length > 1) { <p class="quiet" role="note">{{ 'hq.events.severalHint' | translate }}</p> }
      @for (e of eventRows(); track e.id) {
        @let sheet = e.sheet;
        <section class="ev" [attr.aria-label]="e.name">
          <header class="ev-head">
            <h4>{{ e.name }}</h4>
            <small><sc-hq-event-end [end]="endOf(e)" /></small>
            @if (state(e.id).status === 'done') { <span class="done-tag">{{ 'hq.events.doneTag' | translate }}</span> }
            <span class="sp"></span>
            <button type="button" scAction tier="secondary" (click)="abortAsk.emit()">{{ 'hq.events.abort' | translate }}</button>
            @if (state(e.id).status !== 'done') {
              <button type="button" scAction tier="secondary" [busy]="busy()" (click)="complete(e.id)">{{ 'hq.events.complete' | translate }}</button>
            }
          </header>
          @if (events.error(); as err) { <p class="err" role="alert">{{ err | translate }}</p> }

          <div class="cols">
            <div class="col">
              <h5>{{ 'hq.events.area.title' | translate }}</h5>
              <p class="chips">
                @let area = areaOf(e);
                @if (area; as a) {
                  @if (a.kind === 'any') { <span class="chip">{{ 'hq.events.area.any' | translate }}</span> }
                  @for (s of a.systems; track s) { <span class="chip">{{ label(s) }}</span> }
                  @for (p of a.places; track p) { <span class="chip">{{ label(p) }}</span> }
                  @if (a.kind === 'none' && !a.systems.length && !a.places.length) { <span class="chip mute">{{ 'hq.events.area.none' | translate }}</span> }
                } @else if (!hasAc(e)) {
                  <span class="chip mute">{{ 'hq.events.area.unknown' | translate }}</span>
                }
                @if (hasAc(e)) { <span class="chip ac">{{ 'hq.events.area.ac' | translate }}</span> }
              </p>

              <h5>{{ 'hq.events.prereq.title' | translate }}</h5>
              @if (prereq(e); as p) {
                <ng-container *ngTemplateOutlet="node; context: { $implicit: p }" />
              } @else {
                <p class="mute">{{ 'hq.events.prereq.none' | translate }}</p>
              }
            </div>

            <div class="col">
              <h5>{{ 'hq.events.progress.title' | translate }}</h5>
              @for (t of tracks(e); track t.id) {
                @let cur = state(e.id).progress[t.id];
                @let idx = tier(t, cur?.value ?? 0);
                <div class="track">
                  <label [for]="'trk-' + e.id + t.id">{{ t.label }}</label>
                  <input [id]="'trk-' + e.id + t.id" class="input num" type="number" min="0" step="1" [value]="cur?.value ?? 0" (change)="setValue(e.id, t.id, $any($event.target).value)" />
                  @if (t.unit) { <small>{{ t.unit }}</small> }
                  @if (cur?.source === 'live') { <span class="live">{{ 'hq.events.progress.live' | translate }}</span> }
                  <ol class="tiers" [attr.aria-label]="'hq.events.progress.tiers' | translate">
                    @for (ti of t.tiers; track $index) {
                      <li [class.on]="$index <= idx"><b>{{ ti.at }}</b> {{ ti.label }}</li>
                    }
                  </ol>
                </div>
              } @empty {
                <p class="mute">{{ 'hq.events.progress.none' | translate }}</p>
              }
              @if (events.appConnected()) { <p class="quiet">{{ 'hq.events.progress.appHint' | translate }}</p> }

              <h5>{{ 'hq.events.rewards.title' | translate }}</h5>
              <ul class="rewards">
                @for (r of rewards(e); track r.id) {
                  @let st = lineState(e.id, r);
                  <li [class]="'st-' + st">
                    <span class="nm">{{ r.name }}</span>
                    <span class="state">{{ 'hq.events.rewards.state.' + st | translate }}</span>
                    @if (st !== 'claimed') {
                      <button type="button" scAction tier="secondary" (click)="claiming.set({ eventId: e.id, reward: r })">{{ 'hq.events.rewards.claim' | translate }}</button>
                    }
                  </li>
                } @empty {
                  <li class="mute">{{ (sheet ? 'hq.events.rewards.sightseeing' : 'hq.events.rewards.unknown') | translate }}</li>
                }
              </ul>
            </div>
          </div>
        </section>
      } @empty {
        <p class="mute">{{ 'hq.events.gone' | translate }}</p>
      }
    </div>
    @if (claiming(); as c) {
      <sc-hq-event-claim-dialog [eventId]="c.eventId" [reward]="c.reward" (closed)="claiming.set(null)" (claimed)="claiming.set(null)" />
    }

    <ng-template #node let-n>
      @if (n.kind === 'gear') {
        <span class="gear">{{ gearLabel(n) }}</span>
      } @else {
        <span class="grp" [class.or]="n.op === 'or'">
          @for (it of n.items; track $index) {
            @if (!$first) { <i class="op">{{ 'hq.events.prereq.' + n.op | translate }}</i> }
            <ng-container *ngTemplateOutlet="node; context: { $implicit: it }" />
          }
        </span>
      }
    </ng-template>
  `,
  styles: [
    `
      :host { display: block; min-height: 0; overflow: auto; }
      .evs { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .ev { border: 1px solid var(--sc-border); border-radius: 12px; padding: var(--sc-space-3, 12px); background: var(--sc-bg-0); }
      .ev-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .ev-head h4 { margin: 0; font: 600 1.05rem var(--sc-font-display, inherit); }
      .sp { flex: 1; }
      .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--sc-space-4, 16px); margin-top: var(--sc-space-2, 8px); }
      h5 { margin: var(--sc-space-2, 8px) 0 4px; color: var(--sc-fg-2); font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
      .chip, .gear { padding: 3px 10px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: 0.85rem; }
      .chip.ac { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .mute, .quiet { color: var(--sc-fg-2); font-size: 0.85rem; margin: 0; }
      .grp { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 8px; border: 1px dashed var(--sc-border); border-radius: 10px; }
      .op { font-style: normal; color: var(--sc-accent); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; }
      .track { display: grid; grid-template-columns: 1fr auto auto auto; gap: 4px 8px; align-items: center; margin-bottom: var(--sc-space-2, 8px); }
      .num { width: 6rem; }
      .live { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-success) 18%, transparent); color: var(--sc-success); font-size: 0.72rem; }
      .tiers { grid-column: 1 / -1; list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
      .tiers li { padding: 2px 8px; border-radius: 8px; border: 1px solid var(--sc-border); font-size: 0.8rem; color: var(--sc-fg-2); }
      .tiers li.on { border-color: var(--sc-success); color: var(--sc-success); }
      .rewards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .rewards li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .rewards .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .state { color: var(--sc-fg-2); font-size: 0.8rem; }
      .st-claimed .state { color: var(--sc-success); }
      .st-waiting .state { color: var(--sc-warning); }
      .done-tag { color: var(--sc-success); font-size: 0.8rem; }
      .err { color: var(--sc-warning); margin: 0; }
    `,
  ],
})
export class HqEventSectionComponent {
  readonly nachschub = input.required<Nachschub>();
  /** The reader wants to abort this Nachschub (the panel owns the confirmation). */
  readonly abortAsk = output<void>();

  protected readonly events = inject(EventHqService);
  private readonly i18n = inject(TranslateService);
  protected readonly claiming = signal<{ eventId: string; reward: EventReward } | null>(null);
  protected readonly busy = signal(false);

  protected readonly ids = computed(() => this.events.eventIdsOf(this.nachschub()));
  protected readonly eventRows = computed(() => this.ids().map((id) => this.events.eventById(id)).filter((e): e is EventRow => !!e));

  constructor() {
    this.events.ensure();
    this.events.startLive(inject(DestroyRef));
  }

  protected state = (id: string) => this.events.stateOf(id);
  protected endOf = (e: EventRow) => resolveEventEnd(e, this.events.nextPatchIso());
  protected tracks = (e: EventRow): readonly ProgressTrack[] => e.sheet?.fields.progress.value?.tracks ?? [];
  protected rewards = (e: EventRow): readonly EventReward[] => e.sheet?.fields.rewards.value ?? [];
  protected tier = (t: ProgressTrack, v: number) => reachedTier(t, v);
  protected lineState = (eventId: string, r: EventReward) => rewardLineState(r, this.events.stateOf(eventId).claimed);
  protected hasAc = (e: EventRow) => (e.sheet?.fields.venues.value ?? []).includes('arena-commander');
  protected areaOf = (e: EventRow): AreaView | null => e.sheet?.fields.area.value ?? null;
  protected prereq = (e: EventRow): PrereqView | null => prereqView(e.sheet?.fields.prerequisites.value ?? null);

  protected label(slug: string): string {
    return humanizeClassName(slug.replace(/-/g, '_'));
  }

  protected gearLabel(n: { gear: string; label: string | null }): string {
    if (n.label) return n.label;
    const key = `hq.events.gear.${n.gear}`;
    const t = this.i18n.instant(key);
    return t === key ? this.label(n.gear) : t;
  }

  protected setValue(eventId: string, trackId: string, raw: string): void {
    const v = Number(raw);
    if (Number.isFinite(v)) void this.events.setProgress(eventId, trackId, v);
  }

  protected async complete(eventId: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.events.complete(eventId);
    } finally {
      this.busy.set(false);
    }
  }
}
