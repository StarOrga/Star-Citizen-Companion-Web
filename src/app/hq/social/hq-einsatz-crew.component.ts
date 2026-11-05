import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { FriendsService } from '../../social/friends.service';
import { SocialService } from '../../social/social.service';
import { EinsatzCrew, SLOTS_MAX, SLOT_LABEL_MAX, friendPath } from '../../social/social.types';

/**
 * The owner's side of the crew of one Einsatz (C05): name the slots, see who answered what. Shown
 * only for an account with friends, behind a disclosure, so a plain Einsatz list stays as it was.
 * `setSlots` writes the whole label list; positions keep their taker, so editing a label never
 * kicks anyone out.
 */
@Component({
  selector: 'sc-hq-einsatz-crew',
  standalone: true,
  imports: [TranslatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (friends.friendCount() > 0) {
      <div class="crew">
        <button type="button" class="sc-btn tiny ghost" [attr.aria-expanded]="open()" (click)="toggle()">
          {{ 'hq.friends.crew.open' | translate }}
        </button>
        @if (open()) {
          <div class="panel">
            @if (loadFailed()) {
              <p class="err" role="alert">{{ social.error() ?? 'errors.generic' | translate }}</p>
              <button type="button" class="sc-btn tiny" (click)="load()">{{ 'hq.stock.retry' | translate }}</button>
            } @else {
              <p class="hint">{{ 'hq.friends.crew.hint' | translate }}</p>
              <ul class="slots">
                @for (l of labels(); track $index) {
                  <li>
                    <input type="text" [ngModel]="l" (ngModelChange)="setLabel($index, $event)" [attr.maxlength]="labelMax"
                           [attr.aria-label]="'hq.friends.crew.slotLabel' | translate" />
                    <button type="button" class="sc-btn tiny ghost" [attr.aria-label]="'hq.friends.crew.removeSlot' | translate" (click)="removeSlot($index)">✕</button>
                  </li>
                }
              </ul>
              <div class="actions">
                <button type="button" class="sc-btn tiny ghost" [disabled]="labels().length >= slotsMax" (click)="addSlot()">{{ 'hq.friends.crew.addSlot' | translate }}</button>
                <button type="button" class="sc-btn tiny" [disabled]="social.busy()" (click)="save()">{{ 'hq.friends.crew.save' | translate }}</button>
              </div>
              @if (social.error(); as key) {
                <p class="err" role="alert">{{ key | translate }}</p>
              }
              @if (crew(); as c) {
                <p class="counts">
                  {{ 'hq.friends.crew.counts' | translate: { yes: c.counts.yes, maybe: c.counts.maybe, no: c.counts.no } }}
                </p>
                @if (c.rsvps?.length) {
                  <ul class="rsvps">
                    @for (r of c.rsvps; track r.user_id) {
                      <li>
                        <a [routerLink]="path(r)">{{ r.display_name || r.username || '—' }}</a>
                        <span class="ans">{{ 'social.rsvp.' + r.answer | translate }}</span>
                        @if (slotLabel(c, r.slot_id); as s) { <span class="ans">· {{ s }}</span> }
                      </li>
                    }
                  </ul>
                }
              }
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .crew { display: grid; gap: var(--sc-space-2, 8px); justify-items: start; }
      .panel { display: grid; gap: var(--sc-space-2, 8px); width: 100%; padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); background: var(--sc-bg-1); }
      .hint, .counts { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .slots, .rsvps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-1, 4px); }
      .slots li { display: flex; gap: var(--sc-space-2, 8px); align-items: center; }
      input { flex: 1; min-width: 0; font: inherit; color: var(--sc-fg); background: var(--sc-bg-0, var(--sc-bg-1)); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); padding: var(--sc-space-2, 8px); min-height: 2.5rem; box-sizing: border-box; }
      input:focus-visible, a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .actions { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .rsvps li { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      a { color: var(--sc-accent); }
      .ans { color: var(--sc-fg-2); }
      .err { margin: 0; color: var(--sc-danger); }
      @media (pointer: coarse) { .sc-btn { min-height: 48px; } input { min-height: 48px; } }
    `,
  ],
})
export class HqEinsatzCrewComponent {
  protected readonly friends = inject(FriendsService);
  protected readonly social = inject(SocialService);

  readonly einsatzId = input.required<string>();

  protected readonly slotsMax = SLOTS_MAX;
  protected readonly labelMax = SLOT_LABEL_MAX;
  protected readonly open = signal(false);
  protected readonly crew = signal<EinsatzCrew | null>(null);
  protected readonly labels = signal<string[]>([]);
  protected readonly loadFailed = signal(false);
  protected readonly hasCrew = computed(() => this.crew() !== null);

  protected async toggle(): Promise<void> {
    this.open.update((o) => !o);
    if (this.open()) await this.load();
  }

  protected async load(): Promise<void> {
    const c = await this.social.crew(this.einsatzId());
    this.loadFailed.set(c === null);
    if (c) this.adopt(c);
  }

  private adopt(c: EinsatzCrew): void {
    this.crew.set(c);
    this.labels.set(c.slots.map((s) => s.label));
  }

  protected setLabel(i: number, v: string): void {
    this.labels.update((ls) => ls.map((l, j) => (j === i ? v : l)));
  }

  protected addSlot(): void {
    if (this.labels().length < SLOTS_MAX) this.labels.update((ls) => [...ls, '']);
  }

  protected removeSlot(i: number): void {
    this.labels.update((ls) => ls.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    const labels = this.labels().map((l) => l.trim()).filter((l) => l.length > 0);
    const c = await this.social.setSlots(this.einsatzId(), labels);
    if (c) this.adopt(c);
  }

  protected path(p: { user_id: string; username: string | null }): string[] {
    return friendPath(p);
  }

  protected slotLabel(c: EinsatzCrew, slotId: string | null): string | null {
    return slotId ? (c.slots.find((s) => s.id === slotId)?.label ?? null) : null;
  }
}
