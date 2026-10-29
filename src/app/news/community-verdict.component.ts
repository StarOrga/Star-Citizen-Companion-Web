import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { LocaleService } from '../core/locale/locale.service';
import { MIN_EFFECTIVE_VOTES, StabilityWord, VOTE_CHANGE_HOURS, VOTE_MIN_ACCOUNT_DAYS } from './patch-stability';
import { PatchStabilityVotesService } from './patch-stability-votes.service';

const WORDS: readonly StabilityWord[] = ['stabil', 'wackelig', 'instabil'];

type VoteNotice = 'too-soon' | 'error' | null;

/**
 * The Community-Urteil card of the stability long form: signed-in users judge
 * the LIVE line as stabil / wackelig / instabil (or abstain), the distribution
 * and the resulting correction follow.
 *
 * BLIND: until the user voted, abstained ("Kann ich nicht beurteilen") or asked
 * for the number ("Zahl ohne Urteil anzeigen"), only the vote entry shows —
 * the parent hides the number the same way (`votes.blind()`). Signed-out users
 * see the result and a sign-in hint instead of the buttons. A load failure is
 * an error state with retry, never "no votes".
 */
@Component({
  selector: 'sc-community-verdict',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cv" [attr.aria-label]="'stability.vote.title' | translate">
      @if (votes.error() && !votes.aggregate()) {
        <div class="state" role="alert">
          <p>{{ votes.error() ?? 'errors.generic' | translate }}</p>
          <button type="button" class="sc-btn" (click)="retry()">{{ 'errors.retry' | translate }}</button>
        </div>
      } @else if (!votes.aggregate()) {
        <p class="state muted">{{ 'stability.vote.loading' | translate }}</p>
      } @else {
        <h4>{{ 'stability.vote.title' | translate }}</h4>

        @if (!votes.blind()) {
          @let c = correction();
          @if (c) {
            @if (c.state === 'too-few') {
              <p class="line">{{ 'stability.vote.tooFew' | translate: { n: nEffText(), min: min } }}</p>
              <p class="sub">{{ 'stability.vote.tooFewSub' | translate }}</p>
            } @else {
              <div class="bar" role="img" [attr.aria-label]="distAria()">
                @for (w of words; track w) {
                  <span class="seg" [attr.data-word]="w" [style.flex-grow]="c.shares[w]"></span>
                }
              </div>
              <ul class="legend">
                @for (w of words; track w) {
                  <li [attr.data-word]="w" [class.own]="own() === w">
                    <i aria-hidden="true"></i>
                    <span>{{ ('stability.word.' + w) | translate }}</span>
                    <b>{{ pct(c.shares[w]) }} %</b>
                    @if (own() === w) { <em>{{ 'stability.vote.yours' | translate }}</em> }
                  </li>
                }
              </ul>
              <p class="line">
                @if (c.state === 'applied') {
                  {{ 'stability.vote.applied' | translate: { c: signed(c.correction), n: c.votes, hw: round(c.halfWidth) } }}
                } @else if (c.state === 'split') {
                  {{ 'stability.vote.split' | translate: { a: pct(c.shares.stabil), b: pct(c.shares.instabil) } }}
                } @else {
                  {{ 'stability.vote.confirmed' | translate }}
                }
              </p>
              @if (c.state === 'split') { <p class="sub">{{ 'stability.vote.splitSub' | translate }}</p> }
              @if (c.state === 'confirmed') { <p class="sub">{{ 'stability.vote.confirmedSub' | translate }}</p> }
              <p class="sum">{{ 'stability.vote.sum' | translate: { n: c.votes, c: signed(c.correction) } }}</p>
            }
          }
        }

        @if (user()) {
          @if (votes.blind()) {
            <p class="line">{{ 'stability.vote.blindTitle' | translate }}</p>
          }
          @if (own(); as mine) {
            <p class="mine">
              {{ 'stability.vote.mine' | translate }} <b [attr.data-word]="mine">{{ ('stability.word.' + mine) | translate }}</b>
              @if (locked()) { · {{ 'stability.vote.changeFrom' | translate: { time: lockedUntil() } }} }
            </p>
          } @else {
            <p class="ask">{{ 'stability.vote.ask' | translate: { line: line() } }}</p>
          }
          <div class="choices" role="group" [attr.aria-label]="'stability.vote.ask' | translate: { line: line() }">
            @for (w of words; track w) {
              <button type="button" class="vb" [attr.data-word]="w" [attr.aria-pressed]="own() === w"
                      [disabled]="votes.saving() || (locked() && own() !== w) || own() === w" (click)="vote(w)">
                <b>{{ ('stability.word.' + w) | translate }}</b>
                <small>{{ ('stability.vote.hint.' + w) | translate }}</small>
              </button>
            }
          </div>
          @if (votes.blind()) {
            <div class="alt">
              <button type="button" class="lnk" (click)="votes.reveal()">{{ 'stability.vote.cannotJudge' | translate }}</button>
              <button type="button" class="lnk" (click)="votes.reveal()">{{ 'stability.vote.showNumber' | translate }}</button>
            </div>
          }
          @if (notice() === 'too-soon') {
            <p class="notice" role="status">{{ 'stability.vote.tooSoon' | translate: { h: changeHours } }}</p>
          } @else if (notice() === 'error') {
            <p class="notice" role="alert">{{ votes.error() ?? 'errors.generic' | translate }}</p>
          }
          <p class="sub">{{ 'stability.vote.rules' | translate: { days: minDays, h: changeHours } }}</p>
        } @else {
          <p class="signin">
            {{ 'stability.vote.signedOut' | translate }}
            <a [routerLink]="['/login']" [queryParams]="{ redirect: router.url }">{{ 'stability.vote.signIn' | translate }}</a>
          </p>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .cv {
      display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
      border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1);
    }
    h4 { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    p { margin: 0; }
    .state { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; color: var(--sc-fg-1); font-size: max(0.82rem, var(--sc-fs-floor)); }
    .muted, .sub { color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .line { color: var(--sc-fg-0); font-size: max(0.88rem, var(--sc-fs-floor)); font-weight: 600; }
    .sum { color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
    .bar { display: flex; height: 12px; gap: 2px; border-radius: 6px; overflow: hidden; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); }
    .seg { flex: 0 0 0; min-width: 0; }
    .seg[data-word='stabil'], .legend i { background: var(--sc-success); }
    .seg[data-word='wackelig'], .legend [data-word='wackelig'] i { background: color-mix(in srgb, var(--sc-warning) 45%, transparent); }
    .seg[data-word='instabil'], .legend [data-word='instabil'] i { background: var(--sc-warning); }
    .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 10px; height: 10px; border-radius: 3px; border: 1px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }
    .legend b { color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
    .legend em { font-style: normal; color: var(--sc-accent); }
    .ask, .mine { color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .mine b[data-word='stabil'] { color: var(--sc-success); }
    .mine b[data-word='wackelig'], .mine b[data-word='instabil'] { color: var(--sc-warning); }
    .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .vb {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
      min-height: max(48px, var(--sc-tap-min)); padding: 8px 12px; border-radius: 8px; cursor: pointer;
      font: inherit; color: var(--sc-fg-0); background: var(--sc-bg-0); border: 1px solid var(--sc-border);
    }
    .vb b { font-size: max(0.88rem, var(--sc-fs-floor)); }
    .vb small { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1.3; }
    .vb[data-word='stabil'] b { color: var(--sc-success); }
    .vb[data-word='wackelig'] b, .vb[data-word='instabil'] b { color: var(--sc-warning); }
    .vb:hover:not(:disabled) { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }
    .vb:focus-visible, .lnk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .vb[aria-pressed='true'] { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-0)); }
    .vb:disabled { cursor: not-allowed; opacity: 0.6; }
    .alt { display: flex; flex-wrap: wrap; gap: 4px 16px; }
    .lnk {
      min-height: max(32px, var(--sc-tap-min)); padding: 0; background: none; border: 0; cursor: pointer;
      font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-decoration: underline; text-underline-offset: 3px;
    }
    .lnk:hover { color: var(--sc-fg-0); }
    .notice { color: var(--sc-warning); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .signin { color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .signin a { color: var(--sc-accent); margin-left: 6px; }
    @media (max-width: 560px) { .choices { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class CommunityVerdictComponent {
  readonly votes = inject(PatchStabilityVotesService);
  readonly router = inject(Router);
  private readonly locale = inject(LocaleService);
  private readonly auth = inject(AuthService);

  /** The LIVE line being judged. */
  readonly line = input.required<string>();
  /** The computed stability S (before the correction); null when the patch has no number yet. */
  readonly stability = input<number | null>(null);

  readonly words = WORDS;
  readonly min = MIN_EFFECTIVE_VOTES;
  readonly minDays = VOTE_MIN_ACCOUNT_DAYS;
  readonly changeHours = VOTE_CHANGE_HOURS;

  readonly user = this.auth.user;
  readonly own = computed(() => this.votes.own().verdict);
  readonly notice = signal<VoteNotice>(null);
  private readonly now = signal(Date.now());

  readonly correction = computed(() => this.votes.correctionFor(this.stability() ?? 0));
  readonly locked = computed(() => {
    const at = this.votes.own().nextChangeAt;
    return !!at && Date.parse(at) > this.now();
  });
  readonly lockedUntil = computed(() => this.fmt(this.votes.own().nextChangeAt));

  private readonly ensure = effect(() => {
    const line = this.line();
    untracked(() => this.votes.ensure(line));
  });

  retry(): void {
    void this.votes.load(this.line());
  }

  async vote(word: StabilityWord): Promise<void> {
    this.notice.set(null);
    const res = await this.votes.castVote(this.line(), word);
    this.now.set(Date.now());
    if (res === 'ok') this.votes.reveal();
    else if (res === 'too-soon') this.notice.set('too-soon');
    else if (res === 'error') this.notice.set('error');
  }

  pct(share: number): number {
    return Math.round(share * 100);
  }

  round(n: number): number {
    return Math.round(n);
  }

  signed(n: number): string {
    return n === 0 ? '±0' : (n > 0 ? '+' : '−') + Math.abs(n);
  }

  nEffText(): number {
    return Math.floor(this.correction()?.nEff ?? 0);
  }

  distAria(): string {
    const c = this.correction();
    return c ? WORDS.map((w) => `${w} ${this.pct(c.shares[w])} %`).join(', ') : '';
  }

  /** "07:12" today, "Do. 07:12" on another day. */
  private fmt(iso: string | null): string {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '';
    const sameDay = new Date(t).toDateString() === new Date(this.now()).toDateString();
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
    } catch {
      return new Date(t).toISOString().slice(11, 16);
    }
  }
}
