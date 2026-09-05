import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { NewsService } from './news.service';
import { outlineMatchCount } from './patch-outline';
import { matchesTokens, tokenizeQuery } from './patch-search';
import { PatchMonitorComponent } from './patch-monitor.component';
import { PatchStabilityService } from './patch-stability.service';
import { buildPatchStack, stackCards, type StackCard } from './patch-stack';
import { computePatchForecast } from './patch-stats';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { relativeTime } from './relative-time';
import { StabilityHistoryComponent } from './stability-history.component';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the board search found in one card — shown as an annotation on it. */
interface CardHits {
  notes: number;
  lines: number;
  roadmap: number;
}

/**
 * `/news/patches` — the patch board (2026-09-04 rethink, design Ⓚ).
 *
 * Four rounds of concept iterations replaced the band stack (search, roadmap
 * wall, cadence carousel, newest-per-channel, two chip rows, history) with
 * exactly two things: a search field and a TIME STACK — future on top, now in
 * the middle, past below, on one spine — with three cards open on arrival (the
 * next patch, the live one, the one it replaced) and everything older folded.
 * Status is a WORD in a colour on every card; the live card dominates.
 *
 * Nothing that used to be on the board is gone from the app: every detail
 * moved into the patch DOSSIER, a routed overlay one click away
 * (`/news/patches/:line`, rendered through the outlet below so the board stays
 * behind it). The two chip filters are the one deliberate removal — "die
 * Patch-Auswahl neben der Suche macht keinen Sinn, wir haben die Patches ja
 * schon übersichtlich unten" — the stack IS the selection.
 *
 * Search on this level finds PATCHES: cards get a hit count from their note
 * titles, the bullet points of loaded notes and their roadmap items, and the
 * query travels into the dossier (`?q=`) so a click lands on the highlighted
 * hits without retyping.
 */
@Component({
  selector: 'sc-patch-board',
  standalone: true,
  imports: [TranslateModule, RouterLink, RouterOutlet, PatchMonitorComponent, StabilityHistoryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="board">
      <header class="head">
        <a class="back" routerLink="/news">← {{ 'news.patch.board.back' | translate }}</a>
        <h1>{{ 'news.patch.board.title' | translate }}</h1>
        <p class="sub">{{ 'news.patch.board.sub' | translate }}</p>
      </header>

      @if (svc.error(); as err) {
        <div class="sc-card err"><strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}</div>
      } @else if (svc.loading() && !svc.feed()) {
        <p class="sc-card loading">{{ 'news.loading' | translate }}</p>
      } @else {
        <!-- The question people arrive with, answered before the list starts
             (feedback 01df732d): a monitoring panel over search and stack. -->
        <sc-patch-monitor [stack]="stack()" [groups]="svc.patchLines()" [now]="now()" />

        @if (!stability.unavailable()) {
          <sc-stability-history [verdicts]="stability.allTime()" (showLine)="openLine($event)" />
        }

        <!-- The ONE control on this level. A label, not a placeholder, so the
             field keeps its description while you type. -->
        <div class="search">
          <label class="s-label" for="patch-board-search">{{ 'news.patch.search.label' | translate }}</label>
          <div class="s-field">
            <input id="patch-board-search" type="search" class="s-input"
                   autocomplete="off" spellcheck="false"
                   [attr.placeholder]="'news.patch.search.placeholder' | translate"
                   [value]="query()"
                   (input)="onQuery($event)"
                   (keydown.escape)="clearQuery()" />
            @if (query()) {
              <button type="button" class="s-clear"
                      [attr.aria-label]="'news.patch.search.clear' | translate"
                      (click)="clearQuery()">×</button>
            }
          </div>
          @if (tokens().length > 0) {
            <p class="s-summary" role="status">
              {{ 'news.patch.search.boardSummary' | translate:{ cards: hitCards().length, loaded: roadmap.loadedOutlineCount() } }}
            </p>
          }
        </div>

        @if (visible().length === 0) {
          <p class="empty">{{ 'news.patch.search.noHits' | translate }}</p>
        } @else {
          <ol class="stack" [attr.aria-label]="'news.patch.stack.aria' | translate">
            @for (card of visible(); track card.line) {
              <li class="row" [attr.data-status]="card.status" [class.hero]="card.status === 'live'">
                <!-- The whole card is the way into the dossier → a real anchor,
                     so middle click and "open in new tab" keep working. -->
                <a class="card" [routerLink]="['/news/patches', card.line]" [queryParams]="query() ? { q: query() } : null">
                  <span class="status" [attr.data-status]="card.status">
                    {{ ('news.patch.status.' + card.status) | translate }}
                    @if (statusNote(card); as note) { <small>{{ note }}</small> }
                  </span>
                  <span class="ver">{{ card.line ? ('news.patch.line' | translate:{ version: card.line }) : ('news.patch.otherLine' | translate) }}</span>
                  <span class="sent">
                    <b>{{ sentence(card) }}</b>
                    @if (facts(card); as f) { <span class="facts">{{ f }}</span> }
                    @if (card.status === 'next' || card.status === 'ptu' || card.status === 'evocati') {
                      @if (teaser(card); as items) {
                        <span class="teaser">
                          @for (item of items; track item.id) {
                            @if (item.thumbnail) {
                              <img [src]="item.thumbnail" alt="" loading="lazy" decoding="async" />
                            } @else {
                              <i aria-hidden="true"></i>
                            }
                          }
                          <span>{{ teaserNames(card) }}</span>
                        </span>
                      }
                    }
                    @if (hitsFor(card); as h) {
                      <span class="hits">{{ 'news.patch.search.cardHits' | translate:{ notes: h.notes, lines: h.lines, roadmap: h.roadmap } }}</span>
                    }
                  </span>
                  <span class="counts">
                    @if (card.noteCount > 0) { <span class="ct">{{ 'news.patch.stack.notes' | translate:{ n: card.noteCount } }}</span> }
                    @if (card.plannedCount > 0) { <span class="ct">{{ 'news.patch.stack.planned' | translate:{ n: card.plannedCount } }}</span> }
                  </span>
                </a>
              </li>
            }
            @if (tokens().length === 0 && stack().older.length > 0) {
              <li class="row fold">
                <!-- Folding older lines is an action on this page → button. -->
                <button type="button" class="fold-btn" [attr.aria-expanded]="olderOpen()" (click)="toggleOlder()">
                  <span class="caret" aria-hidden="true">›</span>
                  {{ (olderOpen() ? 'news.patch.stack.olderHide' : 'news.patch.stack.older') | translate:{ n: stack().older.length, lines: olderLines() } }}
                </button>
              </li>
            }
          </ol>
        }
      }
    </section>

    <!-- The dossier: /news/patches/:line renders here, over the board. -->
    <router-outlet />
  `,
  styles: [`
    :host { display: block; }
    .board { display: flex; flex-direction: column; gap: 14px; }
    .head { padding-left: 6px; }
    .back {
      display: inline-block; margin-bottom: 10px; min-height: var(--sc-tap-min);
      color: var(--sc-fg-2); text-decoration: none; font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .back:hover { color: var(--sc-accent); }
    .back:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 4px; }
    h1 { margin: 0; }
    .sub { margin: 4px 0 0; color: var(--sc-fg-2); }
    .loading, .err, .empty { padding: 16px; margin: 0; }
    .err { color: var(--sc-danger); }
    .empty { color: var(--sc-fg-2); }

    .search { display: flex; flex-direction: column; gap: 5px; }
    .s-label { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .s-field { position: relative; display: flex; }
    .s-input {
      flex: 1 1 auto; min-height: var(--sc-tap-min); padding: 10px 40px 10px 12px;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0);
      color: var(--sc-fg-0); font: inherit; font-size: max(0.9rem, var(--sc-fs-floor));
    }
    .s-input::placeholder { color: var(--sc-fg-2); }
    .s-input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .s-input::-webkit-search-cancel-button { display: none; }
    .s-clear {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      border: 0; background: transparent; color: var(--sc-fg-2); font-size: 1.2rem; cursor: pointer;
    }
    .s-clear:hover { color: var(--sc-fg-0); }
    .s-summary { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    /* The stack: one spine on the left, future → past top to bottom. */
    .stack { list-style: none; margin: 0; padding: 0 0 0 24px; position: relative; display: flex; flex-direction: column; gap: 10px; }
    .stack::before {
      content: ''; position: absolute; left: 9px; top: 14px; bottom: 14px; width: 2px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--sc-success) 45%, color-mix(in srgb, var(--sc-fg-2) 35%, transparent));
    }
    .row { position: relative; }
    .row::before {
      content: ''; position: absolute; left: -20px; top: 50%; width: 10px; height: 10px; border-radius: 50%;
      transform: translateY(-50%); background: var(--sc-fg-2); border: 2px solid var(--sc-bg-0);
    }
    .row[data-status='live']::before { width: 14px; height: 14px; left: -22px; background: var(--sc-success); box-shadow: var(--sc-glow); }
    .row[data-status='next']::before, .row[data-status='ptu']::before, .row[data-status='evocati']::before { background: var(--sc-accent); }
    .card {
      display: grid; grid-template-columns: 150px 150px minmax(0, 1fr) auto; align-items: center; gap: 18px;
      padding: 12px 16px; border: 1px solid var(--sc-border); border-radius: 10px;
      background: var(--sc-bg-1); color: var(--sc-fg-0); text-decoration: none;
    }
    .card:hover { border-color: var(--sc-accent); }
    .card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .row.hero .card {
      grid-template-columns: 190px 190px minmax(0, 1fr) auto; padding: 22px;
      border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 10%, var(--sc-bg-1)), var(--sc-bg-1) 60%);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 18%, transparent);
    }
    .row[data-status='next'] .card, .row[data-status='ptu'] .card, .row[data-status='evocati'] .card {
      grid-template-columns: 170px 170px minmax(0, 1fr) auto; padding: 16px 20px;
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-1)), var(--sc-bg-1) 60%);
    }
    .row[data-status='superseded'] .card, .row[data-status='other'] .card { opacity: 0.78; }

    /* Status = a WORD in a colour; LIVE filled and glowing. */
    .status {
      display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 6px;
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; white-space: nowrap;
      justify-self: start;
    }
    .status small { font-family: var(--sc-font-body); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: max(0.66rem, var(--sc-fs-floor)); opacity: 0.85; }
    .status[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); box-shadow: 0 0 18px color-mix(in srgb, var(--sc-success) 35%, transparent); }
    .status[data-status='next'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
    .status[data-status='ptu'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); }
    .status[data-status='evocati'] { color: var(--sc-fg-1); border: 1.5px solid color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
    .status[data-status='superseded'], .status[data-status='other'] { color: var(--sc-fg-2); border: 1.5px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .ver { font-family: var(--sc-font-display); font-size: 1.15rem; font-weight: 600; letter-spacing: 0.02em; }
    .row.hero .ver { font-size: 2rem; }
    .row[data-status='next'] .ver, .row[data-status='ptu'] .ver, .row[data-status='evocati'] .ver { font-size: 1.5rem; }
    .sent { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sent b { color: var(--sc-fg-0); font-weight: 500; }
    .row.hero .sent { font-size: max(0.84rem, var(--sc-fs-floor)); }
    .teaser { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
    .teaser img, .teaser i {
      width: 56px; height: 34px; border-radius: 4px; object-fit: cover; flex: none;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); background: var(--sc-bg-2);
    }
    .teaser span { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); margin-left: 4px; }
    .hits { color: var(--sc-accent); font-weight: 600; }
    .counts { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
    .ct {
      font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); padding: 1px 8px; border-radius: 999px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); white-space: nowrap;
    }

    .fold::before { width: 8px; height: 8px; left: -19px; opacity: 0.6; }
    .fold-btn {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--sc-tap-min);
      padding: 10px 16px; border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 40%, transparent); border-radius: 10px;
      background: transparent; color: var(--sc-fg-2); font: inherit; font-size: max(0.76rem, var(--sc-fs-floor));
      text-align: left; cursor: pointer;
    }
    .fold-btn:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .fold-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .fold-btn .caret { color: var(--sc-accent); transition: transform .16s ease; }
    .fold-btn[aria-expanded='true'] .caret { transform: rotate(90deg); }

    @media (max-width: 760px) {
      .stack { padding-left: 18px; }
      .stack::before { left: 5px; }
      .row::before { left: -17px; }
      .row[data-status='live']::before { left: -19px; }
      .fold::before { left: -16px; }
      .card, .row.hero .card, .row[data-status='next'] .card, .row[data-status='ptu'] .card, .row[data-status='evocati'] .card {
        grid-template-columns: 1fr auto; gap: 8px 10px; padding: 12px;
      }
      .sent, .counts { grid-column: 1 / -1; }
      .counts { flex-direction: row; justify-content: flex-start; }
      .row.hero .ver { font-size: 1.6rem; }
      .card { min-height: 48px; }
    }
  `],
})
export class PatchBoardComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  readonly roadmap = inject(RoadmapService);
  readonly stability = inject(PatchStabilityService);
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly tokens = computed(() => tokenizeQuery(this.query()));
  readonly olderOpen = signal(false);

  readonly stack = computed(() => buildPatchStack(this.svc.patchLines(), this.roadmap.roadmap()));
  readonly forecast = computed(() => computePatchForecast(this.svc.patchLines()));

  /** Cards on screen: three by default, older ones when unfolded — or, while searching, every card with a hit. */
  readonly visible = computed<StackCard[]>(() => {
    const s = this.stack();
    if (this.tokens().length > 0) return this.hitCards();
    const top = [s.next, s.live, s.last].filter((c): c is StackCard => c !== null);
    return this.olderOpen() ? [...top, ...s.older] : top;
  });

  readonly hitCards = computed<StackCard[]>(() =>
    stackCards(this.stack()).filter((c) => this.hitsFor(c) !== null),
  );

  readonly olderLines = computed(() => this.stack().older.map((c) => c.line || '…').join(' · '));

  readonly now = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);

  /** The roadmap is what names the "next" card, so it belongs to the board now. */
  private readonly loadRoadmapOnce = effect(() => {
    void this.roadmap.loadRoadmap();
  });

  /** The all-time chart needs its own tables; quiet-fail like everything else here. */
  private readonly loadStabilityOnce = effect(() => {
    void this.stability.load();
  });

  /**
   * Seed the newest note of the live and the test line, so the board search
   * can see their bullet points from the first keystroke — same trade-off as
   * before: a handful of outlines, one request, stated in the summary line.
   */
  private readonly seedOutlines = effect(() => {
    const s = this.stack();
    const slugs = [s.next, s.live]
      .filter((c): c is StackCard => c !== null && c.group !== null)
      .map((c) => threadSlugOf(c.group!.entries[0]?.item.url ?? ''))
      .filter(Boolean);
    if (slugs.length > 0) untracked(() => this.roadmap.requestOutlines(slugs));
  });

  ngOnInit(): void {
    void this.svc.refresh();
    this.svc.startPolling();
  }

  ngOnDestroy(): void {
    this.svc.stopPolling();
    clearInterval(this.clockTimer);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
  clearQuery(): void {
    this.query.set('');
  }
  toggleOlder(): void {
    this.olderOpen.update((v) => !v);
  }

  /** A chart column picks a line the same way a card does: into its dossier, query preserved. */
  openLine(line: string): void {
    void this.router.navigate(['/news/patches', line], this.query() ? { queryParams: { q: this.query() } } : {});
  }

  /** What the query hits inside a card — null when nothing does. */
  hitsFor(card: StackCard): CardHits | null {
    const tokens = this.tokens();
    if (tokens.length === 0) return null;
    let notes = 0;
    let lines = 0;
    if (card.line && matchesTokens(card.line, tokens)) notes = card.noteCount;
    else if (card.group) {
      for (const entry of card.group.entries) {
        const outline = this.roadmap.outlineFor(threadSlugOf(entry.item.url));
        const inBody = outline ? outlineMatchCount(outline, tokens) : 0;
        if (inBody > 0 || matchesTokens(entry.item.title, tokens)) notes++;
        lines += inBody;
      }
    }
    const roadmap = card.release
      ? card.release.cards.filter((c) => matchesTokens(`${c.name} ${c.description}`, tokens)).length
      : 0;
    return notes + lines + roadmap > 0 ? { notes, lines, roadmap } : null;
  }

  /** The small word after the status: "seit 8 Tagen", "Q3 2026", "durch 4.10". */
  statusNote(card: StackCard): string {
    switch (card.status) {
      case 'live':
        return card.liveAt ? this.t.instant('news.patch.stack.sinceDays', { n: this.daysSince(card.liveAt) }) : '';
      case 'next':
        return card.release?.quarter ?? '';
      case 'ptu':
      case 'evocati':
        return card.firstTestAt ? this.t.instant('news.patch.stack.sinceDays', { n: this.daysSince(card.firstTestAt) }) : '';
      case 'superseded':
        return card.supersededAt ? this.t.instant('news.patch.stack.replaced', { date: this.date(card.supersededAt) }) : '';
      default:
        return '';
    }
  }

  /** The one bold statement per card. */
  sentence(card: StackCard): string {
    switch (card.status) {
      case 'live':
        return card.liveAt ? this.t.instant('news.patch.stack.liveSince', { date: this.date(card.liveAt) }) : '';
      case 'next': {
        const ptu = this.forecast().find((r) => r.key === 'ptu');
        return ptu
          ? this.t.instant('news.patch.stack.ptuExpected', { when: this.until(Date.parse(ptu.at)) })
          : this.t.instant('news.patch.stack.noBuild');
      }
      case 'ptu':
      case 'evocati':
        return this.t.instant('news.patch.stack.inRing', {
          ring: this.t.instant('news.patch.stage.' + card.status),
          n: card.waveCount,
          ago: card.group ? relativeTime(card.group.latestAt, this.now(), (k, p) => this.t.instant(k, p)) : '',
        });
      case 'superseded':
        return card.liveAt
          ? this.t.instant('news.patch.stack.liveSpan', { from: this.date(card.liveAt), to: card.supersededAt ? this.date(card.supersededAt) : '' })
          : this.t.instant('news.patch.stack.neverLive');
      default:
        return this.t.instant('news.patch.otherLine');
    }
  }

  /** The quiet second line: hotfixes, the next-Live estimate, planned items. */
  facts(card: StackCard): string {
    const parts: string[] = [];
    if (card.hotfixCount > 0) {
      parts.push(
        card.hotfixCount === 1
          ? this.t.instant('news.patch.stack.hotfixOne', { date: card.lastHotfixAt ? this.date(card.lastHotfixAt) : '' })
          : this.t.instant('news.patch.stack.hotfixes', { n: card.hotfixCount, date: card.lastHotfixAt ? this.date(card.lastHotfixAt) : '' }),
      );
    }
    if (card.status === 'live') {
      const live = this.forecast().find((r) => r.key === 'live');
      if (live) parts.push(this.t.instant('news.patch.stack.nextLive', { when: this.until(Date.parse(live.at)) }));
    }
    if (card.status === 'next' && card.plannedCount > 0) {
      parts.push(this.t.instant('news.patch.stack.planned', { n: card.plannedCount }));
    }
    return parts.join(' · ');
  }

  /** The three biggest roadmap items of an upcoming patch — its "exciting" strip. */
  teaser(card: StackCard) {
    const cards = card.release?.cards ?? [];
    if (cards.length === 0) return null;
    const withImage = cards.filter((c) => c.thumbnail);
    return (withImage.length >= 3 ? withImage : cards).slice(0, 3);
  }
  teaserNames(card: StackCard): string {
    const items = this.teaser(card) ?? [];
    const rest = (card.release?.cards.length ?? 0) - items.length;
    const names = items.map((c) => c.name).join(' · ');
    return rest > 0 ? `${names} …` : names;
  }

  private daysSince(ms: number): number {
    return Math.max(0, Math.floor((this.now() - ms) / DAY_MS));
  }

  private date(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** "in ~6 Wochen" / "2 Wo. überfällig" — the forecast grammar the app already speaks. */
  private until(atMs: number): string {
    const days = Math.round((atMs - this.now()) / DAY_MS);
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}
