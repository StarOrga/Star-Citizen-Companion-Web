import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import {
  AdminPerson,
  CardAnswer,
  CardStats,
  LeaderboardRow,
  TranslationCard,
  TranslationLanguage,
  TranslationsService,
} from './translations.service';
import { DAILY_CARD_GOAL, contextLines, goalPercent } from './translations.logic';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

/**
 * Karteikarten tab: the last-resort questions the pipeline could not settle itself.
 * One card at a time from the prioritised queue, answer = A / B / own text, optional
 * note and "save as rule"; after an answer the impact and the points are shown.
 */
@Component({
  selector: 'sc-translation-cards',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.cards.title' | translate }}</h2>
        <div class="field">
          <span>{{ 'admin.translations.cards.lang' | translate }}</span>
          <sc-select [options]="langOptions()" [value]="lang()" [ariaLabel]="'admin.translations.cards.lang' | translate"
                     placeholderKey="admin.translations.glossary.all" (valueChange)="setLang($event)" />
        </div>
      </div>
      <p class="hint">{{ 'admin.translations.cards.intro' | translate }}</p>
      <div class="goal" data-test="goal">
        <div class="row">
          <strong>{{ 'admin.translations.cards.goal' | translate: { done: stats().answered_today, goal: goal } }}</strong>
          <span class="grow"></span>
          <span class="pill" [class.ok]="stats().streak_days > 0">
            {{ 'admin.translations.cards.streak' | translate: { days: stats().streak_days } }}
          </span>
          <span class="pill">{{ 'admin.translations.cards.open' | translate: { count: stats().open_count } }}</span>
        </div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="goalPct()"
             [attr.aria-label]="'admin.translations.cards.goalLabel' | translate">
          <i [style.width.%]="goalPct()"></i>
        </div>
      </div>
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate }}</p>
    }

    @if (error()) {
      <div class="sc-card state error" role="alert">
        <p>{{ error()! | translate }}</p>
        <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
      </div>
    } @else if (loading()) {
      <div class="sc-card state" role="status">{{ 'admin.translations.loading' | translate }}</div>
    } @else {
      @if (result(); as r) {
        <section class="sc-card block result" data-test="result" role="status">
          <h2>{{ 'admin.translations.cards.thanks' | translate }}</h2>
          <p class="impact">{{ 'admin.translations.cards.impact' | translate: { count: r.impact ?? 0 } }}</p>
          <p class="points">{{ 'admin.translations.cards.points' | translate: { points: r.points ?? 0 } }}</p>
          <div class="row">
            <button scAction tier="primary" type="button" (click)="result.set(null)">
              {{ (current() ? 'admin.translations.cards.next' : 'admin.translations.cards.done') | translate }}
            </button>
          </div>
        </section>
      } @else if (current(); as c) {
        <section class="sc-card block card" data-test="card" [attr.aria-label]="'admin.translations.cards.title' | translate">
          <div class="row">
            <span class="pill">{{ c.lang }}</span>
            <span class="pill">{{ 'admin.translations.cards.kinds.' + c.kind | translate }}</span>
            @if (c.status === 'skipped') {
              <span class="pill warn">{{ 'admin.translations.cards.skippedBefore' | translate }}</span>
            }
            @if (c.fresh) {
              <span class="pill ok">{{ 'admin.translations.cards.fresh' | translate }}</span>
            }
            <span class="grow"></span>
            <span class="hint">{{ 'admin.translations.cards.spread' | translate: { count: c.spread } }}</span>
          </div>
          <h2 class="q">{{ c.question }}</h2>

          <div class="choices" role="radiogroup" [attr.aria-label]="'admin.translations.cards.choose' | translate">
            @for (o of options(c); track o.id) {
              <button type="button" role="radio" class="choice" [class.sel]="answer() === o.id"
                      [attr.aria-checked]="answer() === o.id" [disabled]="busy()" (click)="choose(o.id)">
                <span class="tag">{{ 'admin.translations.cards.option.' + o.id | translate }}</span>
                <span class="txt">{{ o.text }}</span>
                <span class="src">{{ o.source }}</span>
              </button>
            }
            <button type="button" role="radio" class="choice own" [class.sel]="answer() === 'own'"
                    [attr.aria-checked]="answer() === 'own'" [disabled]="busy()" (click)="choose('own')">
              <span class="tag">{{ 'admin.translations.cards.bothWrong' | translate }}</span>
            </button>
          </div>

          @if (answer() === 'own') {
            <label class="field">
              <span>{{ 'admin.translations.cards.ownText' | translate }}</span>
              <textarea class="sc-input" [value]="ownText()" (input)="ownText.set($any($event.target).value)"></textarea>
            </label>
          }
          <label class="field">
            <span>{{ 'admin.translations.cards.note' | translate }}</span>
            <textarea class="sc-input" rows="2" [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
          </label>
          <label class="check">
            <input type="checkbox" [checked]="saveRule()" (change)="saveRule.set($any($event.target).checked)" />
            <span>{{ 'admin.translations.cards.saveRule' | translate }}</span>
          </label>

          <div class="row">
            <button scAction tier="primary" type="button" [busy]="busy()" [disabled]="!canSubmit() || busy()" (click)="submit()">
              {{ 'admin.translations.cards.submit' | translate }}
            </button>
            <button scAction type="button" [disabled]="busy()" (click)="skip()">
              {{ 'admin.translations.cards.skip' | translate }}
            </button>
          </div>

          <div class="ctx" data-test="context">
            <h3>{{ 'admin.translations.cards.context.title' | translate }}</h3>
            <dl class="summary">
              @if (ctx(c).key) {
                <dt>{{ 'admin.translations.cards.context.key' | translate }}</dt><dd class="mono">{{ ctx(c).key }}</dd>
              }
              @if (ctx(c).en) {
                <dt>{{ 'admin.translations.cards.context.en' | translate }}</dt><dd>{{ ctx(c).en }}</dd>
              }
              @if (ctx(c).where) {
                <dt>{{ 'admin.translations.cards.context.where' | translate }}</dt><dd>{{ ctx(c).where }}</dd>
              }
              @if (ctx(c).neighbours.length) {
                <dt>{{ 'admin.translations.cards.context.neighbours' | translate }}</dt>
                <dd>@for (n of ctx(c).neighbours; track $index) {<div>{{ n }}</div>}</dd>
              }
              @if (ctx(c).research.length) {
                <dt>{{ 'admin.translations.cards.context.research' | translate }}</dt>
                <dd>@for (n of ctx(c).research; track $index) {<div>{{ n }}</div>}</dd>
              }
            </dl>
          </div>
        </section>
      } @else {
        <div class="sc-card state empty" data-test="empty">
          <h2>{{ 'admin.translations.cards.emptyTitle' | translate }}</h2>
          <p class="hint">{{ 'admin.translations.cards.empty' | translate }}</p>
        </div>
      }
    }

    <section class="sc-card block" data-test="leaderboard">
      <h2>{{ 'admin.translations.cards.leaderboard' | translate }}</h2>
      @if (boardError()) {
        <p class="hint">{{ boardError()! | translate }}</p>
      } @else if (board().length === 0) {
        <p class="hint">{{ 'admin.translations.cards.leaderboardEmpty' | translate }}</p>
      } @else {
        <ol class="board">
          @for (b of board(); track b.answered_by; let i = $index) {
            <li>
              <span class="rank">{{ i + 1 }}</span>
              <span class="name">{{ nameOf(b.answered_by) }}</span>
              <span class="hint">{{ 'admin.translations.cards.boardAnswers' | translate: { count: b.answers } }}</span>
              <span class="grow"></span>
              <strong>{{ 'admin.translations.cards.boardPoints' | translate: { points: b.points } }}</strong>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      .goal { display: grid; gap: var(--sc-space-2); }
      .q { font-size: 1.15rem; overflow-wrap: anywhere; }
      .choices { display: grid; gap: var(--sc-space-3); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .choice {
        display: grid; gap: var(--sc-space-2); text-align: start; min-height: 48px; cursor: pointer; font: inherit;
        padding: var(--sc-space-3) var(--sc-space-4); border-radius: var(--sc-radius-md, 10px);
        border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1);
      }
      .choice:disabled { opacity: 0.5; cursor: not-allowed; }
      .choice.sel { border-color: var(--sc-accent); color: var(--sc-fg-0);
        background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .choice .tag { font-size: 0.78rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
      .choice .txt { overflow-wrap: anywhere; }
      .choice .src { font-size: 0.8rem; color: var(--sc-fg-2); }
      .check { display: flex; gap: var(--sc-space-2); align-items: center; min-height: 44px; cursor: pointer; }
      .ctx { display: grid; gap: var(--sc-space-2); padding-top: var(--sc-space-3); border-top: 1px solid var(--sc-border); }
      .result .impact { margin: 0; font-size: 1.1rem; }
      .result .points { margin: 0; color: var(--sc-accent); font-weight: 600; }
      .board { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2); }
      .board li { display: flex; gap: var(--sc-space-3); align-items: baseline; padding-block: var(--sc-space-2);
        border-bottom: 1px solid var(--sc-border); flex-wrap: wrap; }
      .board .rank { min-width: 1.6em; font-weight: 700; color: var(--sc-accent); }
    `,
  ],
})
export class TranslationCardsComponent implements OnInit {
  private readonly svc = inject(TranslationsService);

  readonly languages = input<readonly TranslationLanguage[]>([]);
  readonly goal = DAILY_CARD_GOAL;

  readonly langOptions = computed<ScSelectOption[]>(() =>
    this.languages().map((l) => ({ value: l.lang, labelKey: 'admin.translations.glossary.langLabel', labelParams: { lang: l.lang }, label: l.lang })),
  );

  readonly lang = signal<string | null>(null);
  readonly queue = signal<TranslationCard[]>([]);
  readonly stats = signal<CardStats>({ open_count: 0, answered_today: 0, streak_days: 0 });
  readonly board = signal<LeaderboardRow[]>([]);
  readonly people = signal<Map<string, AdminPerson>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly boardError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ key: string; err: boolean } | null>(null);
  readonly result = signal<TranslationCard | null>(null);

  readonly answer = signal<CardAnswer | null>(null);
  readonly ownText = signal('');
  readonly note = signal('');
  readonly saveRule = signal(false);

  readonly current = computed(() => this.queue()[0] ?? null);
  readonly goalPct = computed(() => goalPercent(this.stats().answered_today));
  readonly canSubmit = computed(() => {
    const a = this.answer();
    return a === 'a' || a === 'b' || (a === 'own' && this.ownText().trim().length > 0);
  });

  private seq = 0;

  ngOnInit(): void {
    void this.load();
    void this.loadBoard();
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [queue, stats] = await Promise.all([this.svc.cardQueue(this.lang()), this.svc.cardStats(this.lang())]);
      if (mine !== this.seq) return;
      this.queue.set(queue);
      this.stats.set(stats);
      this.resetForm();
    } catch (e) {
      if (mine !== this.seq) return;
      this.error.set(toErrorKey('admin-translations', 'cards-load', e));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  async loadBoard(): Promise<void> {
    this.boardError.set(null);
    try {
      const [board, people] = await Promise.all([this.svc.leaderboard(), this.svc.people().catch(() => new Map<string, AdminPerson>())]);
      this.board.set(board);
      this.people.set(people);
    } catch (e) {
      this.boardError.set(toErrorKey('admin-translations', 'cards-board', e));
    }
  }

  nameOf(id: string): string {
    return this.people().get(id)?.name ?? id.slice(0, 8);
  }

  options(c: TranslationCard): { id: 'a' | 'b'; text: string; source: string }[] {
    return [
      { id: 'a', text: c.option_a?.text ?? '', source: c.option_a?.source ?? '' },
      { id: 'b', text: c.option_b?.text ?? '', source: c.option_b?.source ?? '' },
    ];
  }

  ctx(c: TranslationCard) {
    const x = c.context ?? {};
    const one = (k: string) => contextLines(x[k]).join(' ');
    return {
      key: one('key'),
      en: one('en'),
      where: one('where'),
      neighbours: contextLines(x['neighbours']),
      research: contextLines(x['research']),
    };
  }

  setLang(v: string | null): void {
    this.lang.set(v);
    this.result.set(null);
    void this.load();
  }

  choose(a: CardAnswer): void {
    this.answer.set(a);
  }

  private resetForm(): void {
    this.answer.set(null);
    this.ownText.set('');
    this.note.set('');
    this.saveRule.set(false);
  }

  private async refreshStats(): Promise<void> {
    try {
      this.stats.set(await this.svc.cardStats(this.lang()));
    } catch {
      /* the header keeps its last numbers; the next load refreshes them */
    }
  }

  async submit(): Promise<void> {
    const c = this.current();
    const a = this.answer();
    if (!c || !a || !this.canSubmit()) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const done = await this.svc.answerCard(c.id, { answer: a, own_text: this.ownText(), note: this.note(), save_as_rule: this.saveRule() });
      this.queue.update((q) => q.filter((x) => x.id !== c.id));
      this.result.set(done);
      this.resetForm();
      await Promise.all([this.refreshStats(), this.loadBoard()]);
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'card-answer', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** Skip moves the card to the end of the list (the server sorts skipped cards last). */
  async skip(): Promise<void> {
    const c = this.current();
    if (!c) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const done = await this.svc.skipCard(c.id);
      this.queue.update((q) => [...q.filter((x) => x.id !== c.id), { ...c, ...done, status: 'skipped' as const }]);
      this.resetForm();
      await this.refreshStats();
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'card-skip', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }
}
