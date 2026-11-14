import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseRankIdea } from '../data/verse.models';
import { RANK_TIER_AT, RANK_TIER_KEYS } from './starmap.model';

/** The tier that opens submitting and voting (18 lit stars). */
export const IDEAS_TIER = 5;
/** Server limits of an idea's text (verse_submit_rank_idea). */
export const IDEA_MAX = 280;
export const IDEA_MIN = 3;

/**
 * "Belohnungsideen" on the rank page's Extras: players from tier 5 propose and
 * vote for new rank rewards; below tier 5 the list is readable and the controls
 * are locked with the tier's name. An admin archives ideas (in the admin colour).
 * The server checks the tier again; the client only decides what to show. When
 * the RPC does not exist yet (migration not applied) the whole section is absent.
 */
@Component({
  selector: 'sc-rank-ideas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScActionDirective],
  template: `
    @if (load() !== 'absent') {
      <section class="ideas" aria-labelledby="ri-title">
        <h4 id="ri-title">{{ 'starmap.ideas.title' | translate }}</h4>
        <p class="muted small">{{ 'starmap.ideas.lead' | translate }}</p>

        @if (open()) {
          <form class="compose" (submit)="$event.preventDefault(); submit()">
            <label for="ri-body">{{ 'starmap.ideas.label' | translate }}</label>
            <textarea id="ri-body" rows="2" [attr.maxlength]="max" [value]="draft()" (input)="draft.set($any($event.target).value)"
                      [attr.aria-invalid]="draft() !== '' && !valid()"></textarea>
            <div class="row">
              <button type="submit" scAction tier="secondary" [busy]="busy()" [disabled]="!valid()">{{ 'starmap.ideas.submit' | translate }}</button>
              <span class="muted small count">{{ draft().trim().length }} / {{ max }}</span>
            </div>
            @if (status(); as s) { <p class="small" [class.err]="statusError()" role="status">{{ s | translate }}</p> }
          </form>
        } @else {
          <p class="muted lock">{{ 'starmap.ideas.locked' | translate: { name: (tierName | translate), stars: needStars } }}</p>
        }

        @if (load() === 'error') {
          <p class="err" role="alert">{{ error() | translate }}
            <button type="button" scAction tier="secondary" (click)="reload()">{{ 'starmap.ideas.retry' | translate }}</button>
          </p>
        } @else if (load() === 'ready') {
          <ul class="list">
            @for (i of ideas(); track i.id) {
              <li [class.archived]="i.archived" [class.admin]="i.archived && isAdmin()">
                <span class="body">{{ i.body }}</span>
                @if (i.archived) { <em class="tag">{{ 'starmap.ideas.archived' | translate }}</em> }
                @if (open() && !i.archived) {
                  <button type="button" scAction tier="secondary" class="vote" [attr.aria-pressed]="i.voted" [class.on]="i.voted"
                          [disabled]="voting() === i.id" [attr.aria-label]="'starmap.ideas.voteAria' | translate: { votes: i.votes }"
                          (click)="vote(i)">
                    <span aria-hidden="true">{{ i.voted ? '▲' : '△' }}</span> {{ i.votes }}
                  </button>
                } @else {
                  <span class="votes muted small">{{ 'starmap.ideas.votes' | translate: { count: i.votes } }}</span>
                }
                @if (isAdmin() && !i.archived) {
                  <button type="button" scAction tier="secondary" tone="hot" [busy]="archiving() === i.id" (click)="archive(i)">{{ 'starmap.ideas.archive' | translate }}</button>
                }
              </li>
            } @empty {
              <li class="muted small none">{{ 'starmap.ideas.empty' | translate }}</li>
            }
          </ul>
          @if (status() && !open()) { <p class="small err" role="status">{{ status()! | translate }}</p> }
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; align-self: stretch; }
      .ideas { display: flex; flex-direction: column; gap: var(--sc-gap-2); }
      h4 { font: 600 0.85rem var(--sc-font-display); margin: var(--sc-gap-2) 0 0; color: var(--sc-fg-0); }
      p { margin: 0; }
      .muted { color: var(--sc-fg-2); }
      .small { font-size: 0.75rem; }
      .err { color: var(--sc-danger); }
      .compose { display: flex; flex-direction: column; gap: 4px; }
      .compose label { font-size: 0.8rem; color: var(--sc-fg-2); }
      .compose textarea { font: inherit; color: var(--sc-fg-0); background: var(--sc-bg-0); border: 1px solid var(--sc-border);
        border-radius: 8px; padding: var(--sc-pad-1); min-height: var(--sc-tap-min, 44px); resize: vertical; }
      .compose textarea:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .compose textarea[aria-invalid='true'] { border-color: var(--sc-warning); }
      .row { display: flex; align-items: center; gap: var(--sc-gap-2); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .list li { display: flex; align-items: center; gap: var(--sc-gap-2); flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--sc-border); }
      .body { flex: 1 1 14rem; overflow-wrap: anywhere; color: var(--sc-fg-1); }
      .vote.on { border-color: var(--sc-accent); color: var(--sc-accent); }
      .archived .body { color: var(--sc-fg-2); text-decoration: line-through; }
      .tag { font-size: 0.7rem; color: var(--sc-fg-2); font-style: normal; border: 1px solid var(--sc-border); border-radius: 999px; padding: 0 8px; }
      .archived.admin .tag { color: var(--sc-accent-hot); border-color: var(--sc-accent-hot); }
    `,
  ],
})
export class RankIdeasComponent {
  /** The reader's rank tier (lit stars folded, 0..7). */
  readonly tier = input.required<number>();

  private readonly api = inject(VerseApiService);
  private readonly roles = inject(RoleService);
  private readonly dialog = inject(ScConfirmService);

  readonly isAdmin = this.roles.isAdmin;
  readonly max = IDEA_MAX;
  readonly needStars = RANK_TIER_AT[IDEAS_TIER - 1];
  readonly tierName = `starmap.rankPage.tier.${RANK_TIER_KEYS[IDEAS_TIER - 1]}.name`;
  readonly open = computed(() => this.tier() >= IDEAS_TIER);

  readonly load = signal<'loading' | 'ready' | 'error' | 'absent'>('loading');
  readonly error = signal('errors.generic');
  readonly ideas = signal<VerseRankIdea[]>([]);
  readonly draft = signal('');
  readonly busy = signal(false);
  readonly voting = signal<string | null>(null);
  readonly archiving = signal<string | null>(null);
  readonly status = signal<string | null>(null);
  readonly statusError = signal(false);
  readonly valid = computed(() => {
    const len = this.draft().trim().length;
    return len >= IDEA_MIN && len <= IDEA_MAX;
  });

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    const r = await this.api.rankIdeas();
    if (!r.ok) {
      this.error.set(r.errorKey);
      this.load.set('error');
    } else if (r.data === null) {
      this.load.set('absent');
    } else {
      this.ideas.set(r.data);
      this.load.set('ready');
    }
  }

  private fail(key: string): void {
    this.statusError.set(true);
    this.status.set(key);
  }

  async submit(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    const r = await this.api.submitRankIdea(this.draft().trim());
    this.busy.set(false);
    if (!r.ok) return this.fail(r.errorKey);
    this.draft.set('');
    this.statusError.set(false);
    this.status.set('starmap.ideas.sent');
    await this.reload();
  }

  async vote(i: VerseRankIdea): Promise<void> {
    if (this.voting()) return;
    this.voting.set(i.id);
    this.status.set(null);
    const r = await this.api.voteRankIdea(i.id);
    this.voting.set(null);
    if (!r.ok) return this.fail(r.errorKey);
    this.ideas.update((list) =>
      list.map((x) => (x.id === i.id ? { ...x, voted: r.data.voted, votes: r.data.votes } : x)).sort((a, b) => b.votes - a.votes),
    );
  }

  async archive(i: VerseRankIdea): Promise<void> {
    const ok = await this.dialog.confirm({
      titleKey: 'starmap.ideas.archiveTitle',
      messageKey: 'starmap.ideas.archiveMessage',
      params: { body: i.body },
      confirmKey: 'starmap.ideas.archive',
      tone: 'danger',
    });
    if (!ok) return;
    this.archiving.set(i.id);
    const r = await this.api.archiveRankIdea(i.id);
    this.archiving.set(null);
    if (!r.ok) return this.fail(r.errorKey);
    await this.reload();
  }
}
