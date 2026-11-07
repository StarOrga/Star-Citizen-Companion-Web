import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { HqEinsatzService } from '../hq/data/hq-einsatz.service';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { edgeLabel } from './friends.types';
import { SocialService } from './social.service';
import { TeamsService } from './teams.service';
import { EinsatzCrew, RSVP_ANSWERS, RsvpAnswer, SLOTS_MAX, SLOT_LABEL_MAX } from './social.types';

/**
 * A shared Einsatz as the shared goal (#938). No goal entity of its own: the
 * owner picks one of their Einsatz and a friend, the friend gets the existing
 * share, and the crew view (`get_einsatz_crew`) shows slots and answers.
 * Every invitee sees every answer and slot by name (round 2 decision: names
 * for all); the server hides only people blocked with the viewer.
 */
@Component({
  selector: 'sc-social-einsatz',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, ScSelectComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card section" id="social-einsatz">
      <h2>{{ 'social.einsatz.title' | translate }}</h2>
      <p class="hint">{{ 'social.einsatz.hint' | translate }}</p>

      @if (social.loadError(); as key) {
        <div class="load-error" role="alert">
          <span>{{ key | translate }}</span>
          <button type="button" scAction tier="secondary" (click)="reload()">{{ 'errors.retry' | translate }}</button>
        </div>
      }

      <ng-template #rsvpList let-crew>
        @if (crew.rsvps && crew.rsvps.length > 0) {
          <ul class="rsvps">
            @for (r of crew.rsvps; track r.user_id) {
              <li>
                <span class="who">{{ r.display_name ?? r.username }}</span>
                <span [class]="'ans-' + r.answer">{{ 'social.rsvp.' + r.answer | translate }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="empty-inline">{{ 'social.einsatz.noAnswers' | translate }}</p>
        }
      </ng-template>

      <h3>{{ 'social.einsatz.mine' | translate }}</h3>
      @if (einsatzOptions().length === 0) {
        <p class="empty-inline">{{ 'social.einsatz.noneOwn' | translate }}</p>
      } @else if (friendOptions().length === 0 && teamOptions().length === 0) {
        <p class="empty-inline">{{ 'social.einsatz.noFriends' | translate }}</p>
      } @else {
        <div class="pick">
          <sc-select [options]="einsatzOptions()" [value]="einsatzId()" [allowEmpty]="false"
                     [ariaLabel]="'social.einsatz.pickEinsatz' | translate" (valueChange)="pickEinsatz($event)" />
          @if (friendOptions().length > 0 && teamOptions().length > 0) {
            <sc-select [options]="audienceOptions" [value]="audienceKind()" [allowEmpty]="false"
                       [ariaLabel]="'social.einsatz.pickAudience' | translate" (valueChange)="audience.set($event === 'team' ? 'team' : 'friend')" />
          }
          @if (audienceKind() === 'team') {
            <sc-select [options]="teamOptions()" [value]="teamId()" [allowEmpty]="false"
                       [ariaLabel]="'social.einsatz.pickGroup' | translate" (valueChange)="team.set($event)" />
          } @else {
            <sc-select [options]="friendOptions()" [value]="friendId()" [allowEmpty]="false"
                       [ariaLabel]="'social.einsatz.pickFriend' | translate" (valueChange)="friend.set($event)" />
          }
          <button type="button" scAction tier="secondary" [busy]="social.busy()" (click)="invite()">
            {{ 'social.einsatz.invite' | translate }}
          </button>
        </div>
        @if (invited(); as v) {
          <p class="ok" role="status">{{ (v === 'created' ? 'social.einsatz.invited' : 'social.einsatz.already') | translate }}</p>
        }
        @if (social.error(); as key) { <p class="err" role="alert">{{ key | translate }}</p> }
        @if (ownCrew(); as crew) {
          <div class="slots-edit">
            <label for="slot-labels">{{ 'social.einsatz.slotsLabel' | translate: { max: slotsMax } }}</label>
            <input id="slot-labels" class="sc-input" type="text" [value]="slotText()" [attr.maxlength]="slotsMax * (labelMax + 2)"
                   (input)="slotText.set($any($event.target).value)" />
            <button type="button" scAction tier="secondary" (click)="saveSlots()">{{ 'social.einsatz.slotsSave' | translate }}</button>
          </div>
          <div class="crew" role="group" [attr.aria-label]="'social.einsatz.crew' | translate">
            <p class="counts">{{ 'social.einsatz.counts' | translate: crew.counts }}</p>
            <ng-container *ngTemplateOutlet="rsvpList; context: { $implicit: crew }" />
            <ul class="slots">
              @for (s of crew.slots; track s.id) {
                <li [class.open]="!s.taken">
                  <span>{{ s.label }}</span>
                  <span class="state">{{ s.taken ? (s.taker?.display_name ?? s.taker?.username ?? ('social.einsatz.taken' | translate)) : ('social.einsatz.open' | translate) }}</span>
                </li>
              }
            </ul>
          </div>
        }
      }

      <h3>{{ 'social.einsatz.withMe' | translate }}</h3>
      @if (social.sharedEinsaetze().length === 0) {
        <p class="empty-inline">{{ 'social.einsatz.noneShared' | translate }}</p>
      } @else {
        <ul class="shared">
          @for (e of social.sharedEinsaetze(); track e.einsatz_id) {
            <li class="shared-row">
              <strong>{{ e.title }}</strong>
              <span class="by">{{ 'social.einsatz.from' | translate: { name: e.owner_name ?? e.owner_handle ?? '' } }}</span>
              <p class="counts">{{ 'social.einsatz.counts' | translate: e.crew.counts }}</p>
              <ng-container *ngTemplateOutlet="rsvpList; context: { $implicit: e.crew }" />
              <ul class="slots">
                @for (s of e.crew.slots; track s.id) {
                  <li [class.open]="!s.taken">
                    <span>{{ s.label }}</span>
                    <span class="state">{{ s.mine ? ('social.einsatz.you' | translate) : s.taken ? (s.taker?.display_name ?? s.taker?.username ?? ('social.einsatz.taken' | translate)) : ('social.einsatz.open' | translate) }}</span>
                    @if (!s.taken && e.status !== 'done') {
                      <button type="button" scAction tier="secondary" (click)="take(e.einsatz_id, e.crew, s.id)">{{ 'social.einsatz.take' | translate }}</button>
                    }
                  </li>
                }
              </ul>
              @if (e.status !== 'done') {
                <div class="answers" role="group" [attr.aria-label]="'social.einsatz.answer' | translate">
                  @for (a of answers; track a) {
                    <button type="button" scAction tier="secondary" [attr.aria-pressed]="e.crew.my_answer === a"
                            [class.on]="e.crew.my_answer === a" (click)="answer(e.einsatz_id, a, e.crew.my_slot)">
                      {{ 'social.rsvp.' + a | translate }}
                    </button>
                  }
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    h2 { margin: 0 0 6px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    h3 { margin: 16px 0 6px; font-size: 0.9rem; color: var(--sc-fg-1); }
    .hint, .empty-inline { color: var(--sc-fg-2); margin: 8px 0 0; }
    .empty-inline { font-style: italic; }
    .load-error, .err {
      padding: 10px 14px; border-radius: 4px; margin-top: 10px;
      background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .load-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .ok { color: var(--sc-success); }
    .pick, .slots-edit, .answers { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .slots-edit .sc-input { flex: 1 1 220px; min-width: 0; }
    .counts { color: var(--sc-fg-1); font-variant-numeric: tabular-nums; margin: 10px 0 4px; }
    ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .rsvps li, .slots li { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; border-bottom: 1px solid var(--sc-border); padding: 6px 0; }
    .slots li.open .state { color: var(--sc-warning); }
    .ans-yes { color: var(--sc-success); }
    .ans-no { color: var(--sc-fg-2); }
    .shared-row { padding: 10px 0; border-bottom: 1px solid var(--sc-border); }
    .by { color: var(--sc-fg-2); margin-left: 8px; }
    .answers .on { border-color: var(--sc-accent); color: var(--sc-accent); }
    @media (pointer: coarse) { .answers button, .slots button { min-height: 48px; } }
  `],
})
export class SocialEinsatzComponent implements OnInit {
  readonly social = inject(SocialService);
  private readonly hq = inject(HqEinsatzService);
  private readonly teams = inject(TeamsService);

  readonly answers = RSVP_ANSWERS;
  readonly slotsMax = SLOTS_MAX;
  readonly labelMax = SLOT_LABEL_MAX;

  readonly einsatz = signal<string | null>(null);
  readonly friend = signal<string | null>(null);
  readonly invited = signal<'created' | 'duplicate' | null>(null);
  readonly ownCrew = signal<EinsatzCrew | null>(null);
  readonly slotText = signal('');

  readonly einsatzOptions = computed<ScSelectOption[]>(() =>
    this.hq.items().filter((e) => e.status !== 'done').map((e) => ({ value: e.id, labelKey: '', label: e.title }) as ScSelectOption),
  );
  readonly friendOptions = computed<ScSelectOption[]>(() =>
    (this.social.compare()?.friends ?? []).map((f) => ({ value: f.user_id, labelKey: '', label: edgeLabel(f) }) as ScSelectOption),
  );
  readonly einsatzId = computed(() => this.einsatz() ?? this.einsatzOptions()[0]?.value ?? null);
  readonly friendId = computed(() => this.friend() ?? this.friendOptions()[0]?.value ?? null);

  // Audience: one friend, or one real group (#903). Same invite path, same button.
  readonly audience = signal<'friend' | 'team'>('friend');
  readonly team = signal<string | null>(null);
  readonly audienceOptions: ScSelectOption[] = [
    { value: 'friend', labelKey: 'social.einsatz.audienceFriend' },
    { value: 'team', labelKey: 'social.einsatz.audienceGroup' },
  ];
  readonly teamOptions = computed<ScSelectOption[]>(() =>
    this.teams.teams().map((t) => ({ value: t.id, labelKey: '', label: t.name }) as ScSelectOption),
  );
  readonly teamId = computed(() => this.team() ?? this.teamOptions()[0]?.value ?? null);
  /** Falls back to the only audience kind that has anything to pick. */
  readonly audienceKind = computed<'friend' | 'team'>(() => {
    if (this.friendOptions().length === 0) return 'team';
    if (this.teamOptions().length === 0) return 'friend';
    return this.audience();
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    void this.social.loadCompare();
    void this.social.loadSharedEinsaetze();
    void this.teams.load();
  }

  async pickEinsatz(id: string | null): Promise<void> {
    this.einsatz.set(id);
    this.invited.set(null);
    await this.loadOwnCrew();
  }

  private async loadOwnCrew(): Promise<void> {
    const id = this.einsatzId();
    const crew = id ? await this.social.crew(id) : null;
    this.ownCrew.set(crew);
    this.slotText.set(crew ? crew.slots.map((s) => s.label).join(', ') : '');
  }

  async invite(): Promise<void> {
    const id = this.einsatzId();
    const to = this.audienceKind() === 'team' ? { teamId: this.teamId() } : { friendId: this.friendId() };
    const target = 'teamId' in to ? to.teamId : to.friendId;
    if (!id || !target) return;
    this.invited.set(await this.social.inviteToEinsatz(id, 'teamId' in to ? { teamId: target } : { friendId: target }));
    await this.loadOwnCrew();
  }

  async saveSlots(): Promise<void> {
    const id = this.einsatzId();
    if (!id) return;
    const labels = this.slotText().split(',').map((l) => l.trim()).filter((l) => l.length > 0);
    const crew = await this.social.setSlots(id, labels);
    if (crew) {
      this.ownCrew.set(crew);
      this.slotText.set(crew.slots.map((s) => s.label).join(', '));
    }
  }

  async answer(id: string, a: RsvpAnswer, slot: string | null): Promise<void> {
    await this.social.respond(id, a, slot);
  }

  async take(id: string, crew: EinsatzCrew, slotId: string): Promise<void> {
    await this.social.respond(id, crew.my_answer ?? 'yes', slotId);
  }
}
