import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScStepComponent, StepKind } from '../../shared/step/sc-step.component';
import { SocialService } from '../../social/social.service';
import { RSVP_ANSWERS, RsvpAnswer, SharedEinsatz, friendPath } from '../../social/social.types';

/**
 * Einsätze friends shared with me (C03/C05), in "Planen" below the reader's own list. Read-only on
 * purpose: no step toggle, no rename, no remove, and the head says who shared it. The one thing a
 * reader may do is answer (Zusage / Vielleicht / Absage) and take a crew slot. The block does not
 * exist when nothing is shared, so an account without friends sees Planen as it was.
 */
@Component({
  selector: 'sc-hq-shared-einsaetze',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScDatePipe, ScSelectComponent, ScStepComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <section class="shared" aria-labelledby="hq-shared-ein">
        <h3 id="hq-shared-ein">{{ 'hq.friends.shared.title' | translate }}</h3>
        <ul class="list">
          @for (e of rows(); track e.einsatz_id) {
            <li class="ein">
              <div class="head">
                <strong class="title">{{ e.title }}</strong>
                <span class="by">
                  {{ 'hq.friends.shared.by' | translate }}
                  <a [routerLink]="ownerPath(e)">{{ e.owner_name || e.owner_handle || '—' }}</a>
                </span>
                @if (e.planned_at) {
                  <span class="when">{{ e.planned_at | scDate: 'datetime' }}</span>
                }
                <span class="ro">{{ 'hq.friends.shared.readOnly' | translate }}</span>
              </div>
              @if (e.steps.length) {
                <div class="steps">
                  @for (s of e.steps; track s.ord) {
                    <sc-step [kind]="stepKind(s.kind)" [state]="s.state" [label]="s.label" [qty]="s.qty" [location]="s.location" />
                  }
                </div>
              }
              <div class="rsvp" role="group" [attr.aria-label]="'hq.friends.shared.answer' | translate">
                @for (a of answers; track a) {
                  <button type="button" class="seg" [attr.aria-pressed]="e.crew.my_answer === a" [disabled]="closed(e) || social.busy()"
                          (click)="answer(e, a)">{{ 'social.rsvp.' + a | translate }}</button>
                }
                <span class="counts">{{ 'hq.friends.crew.counts' | translate: { yes: e.crew.counts.yes, maybe: e.crew.counts.maybe, no: e.crew.counts.no } }}</span>
              </div>
              @if (e.crew.slots.length) {
                <div class="slot">
                  <span class="lbl">{{ 'hq.friends.shared.slot' | translate }}</span>
                  <sc-select [options]="slotOptions(e)" [value]="e.crew.my_slot" [ariaLabel]="'hq.friends.shared.slot' | translate"
                             placeholderKey="hq.friends.shared.noSlot" [disabled]="closed(e) || e.crew.my_answer === null || e.crew.my_answer === 'no'"
                             (valueChange)="take(e, $event)" />
                </div>
              }
            </li>
          }
        </ul>
        @if (social.error(); as key) {
          <p class="err" role="alert">{{ key | translate }}</p>
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .shared { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      h3 { margin: 0; font-size: 1rem; }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .ein { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sc-space-2, 8px) var(--sc-space-3, 12px); }
      .title { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; }
      .by, .when, .counts, .lbl { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .ro { padding: 0 8px; border: 1px solid var(--sc-border); border-radius: 999px; color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
      a { color: var(--sc-accent); }
      a:focus-visible, .seg:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .steps { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
      .rsvp { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .seg { min-height: 36px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .seg:hover:not(:disabled) { color: var(--sc-fg); border-color: var(--sc-fg-2); }
      .seg[aria-pressed='true'] { color: var(--sc-fg); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .seg:disabled { cursor: default; opacity: 0.6; }
      .slot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .slot sc-select { flex: 0 1 16rem; min-width: 10rem; }
      .err { margin: 0; color: var(--sc-warning); }
      @media (pointer: coarse) { .seg { min-height: 48px; } }
    `,
  ],
})
export class HqSharedEinsaetzeComponent implements OnInit {
  protected readonly social = inject(SocialService);
  protected readonly answers = RSVP_ANSWERS;

  protected readonly rows = computed(() => this.social.sharedEinsaetze());

  ngOnInit(): void {
    void this.social.loadSharedEinsaetze();
  }

  protected ownerPath(e: SharedEinsatz): string[] {
    return friendPath({ user_id: e.owner_id, username: e.owner_handle });
  }

  protected stepKind(k: string): StepKind {
    return k as StepKind;
  }

  protected closed(e: SharedEinsatz): boolean {
    return e.status === 'done';
  }

  /** A free slot, my own, or one a friend of mine holds (shown with the name); other takers read as taken. */
  protected slotOptions(e: SharedEinsatz): ScSelectOption[] {
    return e.crew.slots.map((s) => ({
      value: s.id,
      labelKey: '',
      label: s.taken && !s.mine ? `${s.label} (${s.taker?.display_name || s.taker?.username || '…'})` : s.label,
      disabled: s.taken && !s.mine,
    }));
  }

  protected async answer(e: SharedEinsatz, a: RsvpAnswer): Promise<void> {
    await this.social.respond(e.einsatz_id, a, e.crew.my_slot);
  }

  protected async take(e: SharedEinsatz, slotId: string | null): Promise<void> {
    if (e.crew.my_answer === null || e.crew.my_answer === 'no') return;
    await this.social.respond(e.einsatz_id, e.crew.my_answer, slotId);
  }
}
