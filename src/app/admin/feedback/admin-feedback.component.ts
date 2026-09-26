import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { useAutoRefresh } from '../../core/auto-refresh';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { RenderedFeedbackBody, renderFeedbackBody } from './markdown.util';
import { FeedbackAttachmentsComponent } from './feedback-attachments.component';
import { ComposerPayload, FeedbackComposerComponent, PendingImage } from './feedback-composer.component';
import { CelebrationService } from './celebration.service';
import { FeedbackMotionService, HIGHLIGHT_MS } from './feedback-motion.service';
import { FeedbackDashboardComponent } from './feedback-dashboard.component';
import { RoutineStatusDirective } from './routine-status.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import {
  AdminAsk,
  AnswerOptions,
  DeliveredDay,
  FeedbackAuthor,
  FeedbackBucket,
  FeedbackMessage,
  FeedbackRow,
  FeedbackSearchHit,
  FeedbackTurn,
  FlightPosition,
  DECLINE_REASONS,
  DeclineReasonId,
  DeclineReasonTexts,
  adminAsk,
  awaitsReview,
  awaitsTriage,
  declineReasonLabelKey,
  declineReasonTextKey,
  deliveredByDay,
  doneTime,
  feedbackBucket,
  flightPosition,
  isArchived,
  isContinuedAfterShip,
  isDelivered,
  isLongMessage,
  isNewSince,
  isUserSubmitted,
  ISSUE_REQUEST_MARKER,
  matchDeclineReason,
  parseAnswerOptions,
  pendingIssueRequest,
  refKind,
  searchFeedback,
  searchTokens,
  StationGlyph,
  stationGlyphLabelKey,
  stationGlyphs,
  stationIndex,
  stationLabelKey,
  timeOf,
  topicNumber,
  displayTitle,
  turnLabelKey,
  turnOf,
  waitingSince,
} from './feedback.types';
import { buildFeedbackBody, uploadFeedbackImages } from '../../feedback/feedback-images.util';
import { CharCounterComponent } from '../../feedback/char-counter.component';
import { FEEDBACK_MAX_CHARS, clampFeedbackText } from '../../feedback/feedback-limits';
import { draftScopes, memoScope } from '../../feedback/feedback-draft.types';
import {
  FEEDBACK_AREAS,
  FeedbackArea,
  areaRoute,
  asFeedbackArea,
  feedbackAreaLabelKey,
} from '../../feedback/feedback-area.types';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { PanelNavigationService } from '../../feedback/panel-navigation.service';
import { FeedbackComposerSeedService } from '../../feedback/feedback-composer-seed.service';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScDateRelativePipe } from '../../core/locale/sc-relative-date.pipe';
import { formatScDate } from '../../core/locale/date-format';
import { LocaleService } from '../../core/locale/locale.service';
import {
  AuthorFeedbackMessage,
  AuthorFeedbackStatus,
  AuthorThreadMap,
  coarseAuthorStatus,
  groupAuthorMessages,
} from '../../feedback/user-feedback.types';

/**
 * The board's two surfaces (concept 2026-09-04, direction E): the STREAM —
 * one scroll in three bands ordered by whose turn it is — and the read-only
 * Fortschritt numbers behind a glyph. The three tabs (Übersicht / Abarbeiten /
 * Fortschritt) are gone: Übersicht and Abarbeiten were two views of one pile,
 * and the stream IS that pile with the admin's own work on top.
 */
export type FeedbackView = 'stream' | 'progress';

/**
 * "Wer?" in the filter sheet — the one axis that used to be three controls
 * (Admins/Nutzer switch, author chips, the run's mine/others scope). An author
 * id narrows to that person; the four words are the shortcuts.
 */
export type WhoFilter = 'all' | 'mine' | 'others' | 'users' | { authorId: string };

/** localStorage key: when the admin last looked at the Geliefert band. */
const LAST_SEEN_KEY = 'sc.adminFeedback.lastSeenDelivered';
/**
 * Keys the 2026-09-04 rethink stopped writing: the view switch, the run's
 * tick-off map and its two lenses. Nothing reads them any more, and they were
 * never registered as preference keys, so they also survived a consent
 * withdrawal. Cleared best-effort on the next panel load; `ConsentService`
 * lists them too, for anyone who never opens the panel again.
 */
const RETIRED_KEYS = [
  'sc.adminFeedback.view',
  'sc.adminFeedback.handled',
  'sc.adminFeedback.workflowScope',
  'sc.adminFeedback.workflowKind',
] as const;

/** Best-effort removal of {@link RETIRED_KEYS}; never throws. */
function purgeRetiredKeys(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of RETIRED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode / quota */
    }
  }
}
/** Draft identity of the new-topic composer (see `FeedbackDraftService`). */
const DRAFT_SCOPE = draftScopes.adminNew;
/** Days of the Geliefert band shown before "n weitere Tage anzeigen". */
const DELIVERED_DAYS_PAGE = 3;

/**
 * The flight path's mini glyphs — one 24×24 stroke path each, the same idiom
 * the Codex category icons use (`codex-category-icon.component.ts`), so the
 * board needs no icon font and no new dependency. Four bare dots did not say
 * what the four steps were (feedback 1d013d69); each step now draws the thing
 * it means, with the words still riding alongside in the baton span.
 */
const STATION_GLYPH_PATHS: Readonly<Record<StationGlyph, string>> = {
  // A filed document with a signature line: eingereicht, wartet auf Freigabe.
  contract:
    'M6 3 H14 L18 7 V21 H6 Z M14 3 V7 H18 M9 12 H15 M9 16.5 C10.5 14.8 11.5 18.2 13 16.5 C13.8 15.6 14.6 15.9 15.4 16.4',
  // A wrench: handed to the routine — queued or under the tool, same step.
  doing:
    'M18.4 4.1 A4.6 4.6 0 0 0 12.3 10.2 L4.6 17.9 A1.9 1.9 0 0 0 7.3 20.6 L15 12.9 A4.6 4.6 0 0 0 21.1 6.8 L18 9.9 L15.3 9.9 L15.3 7.2 Z',
  // A loop arrow: the topic is going round again instead of forward.
  recycle: 'M12 4.5 A7.5 7.5 0 1 0 19.5 12 M15.8 7.1 L12 4.5 L15.8 1.9',
  // A cross: this one does not get built.
  rejected: 'M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5',
  // A check: geliefert, die Abnahme steht noch aus.
  delivered: 'M5 12.5 L10 17.5 L19 7',
  // The same check, closed into a circle: abgenommen.
  accepted: 'M3 12 A9 9 0 1 1 21 12 A9 9 0 1 1 3 12 M7.8 12.4 L10.7 15.3 L16.3 8.9',
};

/**
 * The Fortschritt door's own glyph: an axis with three rising bars. It used to
 * be the bar-chart emoji, which the platform draws in its own colour and its
 * own font weight next to a board where every other mark is a 24x24 stroke
 * path (admin feedback a33ba528). Same idiom as {@link STATION_GLYPH_PATHS}
 * and the Codex category icons - one `d`, no fill, `currentColor` - so it
 * inherits the button's rest, hover and focus colours instead of ignoring them.
 */
const PROGRESS_GLYPH_PATH =
  'M4 3.5 V19 A1.5 1.5 0 0 0 5.5 20.5 H20.5 M8.5 19 V14 M13 19 V10.5 M17.5 19 V7';

/** Role → avatar tint. Anyone without a known role is drawn as a plain user. */
type AvatarTone = 'adm' | 'col' | 'usr';

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [
    ScDatePipe,
    ScDateRelativePipe,
    NgTemplateOutlet,
    RouterLink,
    TranslatePipe,
    FeedbackAttachmentsComponent,
    FeedbackComposerComponent,
    FeedbackDashboardComponent,
    RoutineStatusDirective,
    ScTooltipDirective,
    CharCounterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- "sc-dense": the embedded shell already pays for the padding around
         its children, so the de-nesting rules (styles.scss) let the composer
         and the sheets inside it drop their own side frames on a phone. -->
    <section
      class="page"
      [class.embedded]="embedded()"
      [class.sc-dense]="embedded()"
      [class.large]="isLarge()"
      [class.overlay-open]="overlayOpen()">
      @if (!embedded()) {
        <header class="head">
          <div>
            <!-- The heading doubles as the dev-PC liveness light (feedback
                 a7573f0e); the FAB panel's own title carries it when embedded. -->
            <h1 scRoutineStatus="adminFeedback.title">{{ 'adminFeedback.title' | translate }}</h1>
            <p class="hint">{{ 'adminFeedback.subtitle' | translate }}</p>
          </div>
        </header>
      }

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'adminFeedback.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      @if (view() === 'progress') {
        <!-- Fortschritt, byte-identical, re-homed behind the chart glyph. -->
        <div class="topbar">
          <button type="button" class="tb-btn" (click)="setView('stream')">
            ← {{ 'adminFeedback.stream.backToStream' | translate }}
          </button>
          <span class="tb-icon head" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                [attr.d]="progressGlyphPath"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round" />
            </svg>
          </span>
          <span class="tb-title">{{ 'adminFeedback.stream.progress' | translate }}</span>
        </div>
        <div class="scroll alt view-in">
          <sc-feedback-dashboard [rows]="messages()" [threads]="threads()" [compact]="embedded()" />
        </div>
      } @else {
        <!-- CONTROLS AT REST: a search field and one Filter button — nothing
             else stands between the admin and the first topic. The chart
             glyph is the only other thing here, and it is a door, not a
             filter.

             In the docked window that is the whole row. Where the board is
             LARGE — the /admin/feedback page, the maximized panel — the search
             field used to grow across the entire width (admin feedback
             a4f30011). It is now capped at the docked window's width, and the
             room that frees up carries the "Wer?" answers the admin reaches
             for most (Alle / Ich / Nutzer) as quick chips, the same signals
             as the sheet's chips: press one here and the sheet shows it
             pressed, and it counts as an active filter exactly as before.
             Andere, the author chips, Wo and Bereich stay under Filter. The
             chips are a state decision (isLarge) first and a width decision
             second: a large board that is nonetheless narrow (the page on a
             phone) hides them again via the container query on the topbar. -->
        <div class="topbar">
          <div class="search-box" [class.active]="searchQuery().length > 0">
            <span class="search-icon" aria-hidden="true">&#9099;</span>
            <input
              #searchInput
              type="search"
              autocomplete="off"
              [value]="searchQuery()"
              (input)="setSearch($any($event.target).value)"
              (keydown.escape)="clearSearch(); searchInput.blur(); $event.stopPropagation()"
              [attr.placeholder]="'adminFeedback.search.placeholder' | translate"
              [attr.aria-label]="'adminFeedback.search.label' | translate" />
            @if (searchQuery().length > 0) {
              <button
                type="button"
                class="search-clear"
                (click)="clearSearch(); searchInput.blur()"
                [attr.aria-label]="'adminFeedback.search.clear' | translate">&times;</button>
            }
          </div>
          @if (isLarge()) {
            <div class="quick-chips" role="group" [attr.aria-label]="'adminFeedback.filters.who' | translate">
              <button type="button" class="f-chip" [class.on]="whoIs('all')" [attr.aria-pressed]="whoIs('all')" (click)="setWho('all')"><span class="f-label">{{ 'adminFeedback.filters.whoAll' | translate }}</span></button>
              <button type="button" class="f-chip" [class.on]="whoIs('mine')" [attr.aria-pressed]="whoIs('mine')" (click)="setWho('mine')"><span class="f-label">{{ 'adminFeedback.filters.whoMine' | translate }}</span></button>
              <button type="button" class="f-chip more" [class.on]="whoIs('users')" [attr.aria-pressed]="whoIs('users')" (click)="setWho('users')">
                <span class="f-label">{{ 'adminFeedback.filters.whoUsers' | translate }}</span>
                @if (untriagedWaiting()) { <span class="dot hot" [scTooltip]="'adminFeedback.sourceFilter.untriagedHint' | translate" scTooltipTier="label" [attr.aria-label]="'adminFeedback.sourceFilter.untriagedHint' | translate"></span> }
              </button>
            </div>
          }
          <button
            type="button"
            class="tb-btn filter"
            [class.active]="filterCount() > 0"
            (click)="openFilters()"
            [attr.aria-expanded]="filtersOpen()"
            [scTooltip]="filterCount() > 0 ? ('adminFeedback.filters.activeHint' | translate: { count: filterCount() }) : null"
            [attr.aria-label]="'adminFeedback.filters.open' | translate">
            <span aria-hidden="true">⚲</span>
            <span class="tb-label">{{ 'adminFeedback.filters.open' | translate }}</span>
            @if (filterCount() > 0) { <span class="tb-count">{{ filterCount() }}</span> }
          </button>
          <!-- The glyph alone said nothing about where it leads (admin feedback
               a33ba528). It now carries the word next to it, and the tooltip /
               accessible name states what the page actually is instead of
               repeating the button's own label. -->
          <button
            type="button"
            class="tb-btn progress"
            (click)="setView('progress')"
            [scTooltip]="'adminFeedback.stream.progressHint' | translate"
            [attr.aria-label]="'adminFeedback.stream.progressHint' | translate">
            <span class="tb-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path
                  [attr.d]="progressGlyphPath"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </span>
            <span class="tb-label">{{ 'adminFeedback.stream.progress' | translate }}</span>
          </button>
        </div>

        <div class="scroll stream">
          @if (busy() && messages().length === 0) {
            <div class="sc-card empty">{{ 'adminFeedback.loading' | translate }}</div>
          } @else if (messages().length === 0) {
            <div class="sc-card empty">{{ 'adminFeedback.empty' | translate }}</div>
          } @else if (searchActive()) {
            <!-- A search flattens the bands: relevance first, whatever band a
                 hit lives in (feedback 12476cec). -->
            <div class="band-head static">
              <span class="bh-title">{{ 'adminFeedback.search.results' | translate: { count: searchResults().length } }}</span>
            </div>
            @if (searchResults().length === 0) {
              <div class="sc-card empty">{{ 'adminFeedback.search.empty' | translate: { query: searchQuery() } }}</div>
            }
            @for (m of searchResults(); track m.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, i: $index }"></ng-container>
            }
          } @else {
            <!-- BAND 1 · Du bist dran: every Rückfrage, sign-off and release
                 that waits on the admin, longest wait first. Every card is a
                 closed row — the act happens in the opened topic (admin
                 feedback 0691a00b: the first card used to unfold its answer box
                 inline, which read as an expandable list; one tap into the
                 topic is enough). -->
            <section class="band yours">
              <button
                type="button"
                class="band-head"
                (click)="toggleBand('admin')"
                [attr.aria-expanded]="!bandCollapsed('admin')"
                [scTooltip]="(bandCollapsed('admin') ? 'adminFeedback.stream.expandBand' : 'adminFeedback.stream.collapseBand') | translate: { band: ('adminFeedback.stream.yourTurn' | translate) }">
                <span class="bh-title">{{ 'adminFeedback.stream.yourTurn' | translate }}</span>
                <span class="bh-count" [class.hot]="yourTurn().length > 0" [class.pulse]="bandPulse('admin')">{{ yourTurn().length }}</span>
                <span class="chev" [class.open]="!bandCollapsed('admin')" aria-hidden="true">▸</span>
              </button>
              @if (!bandCollapsed('admin')) {
                @if (yourTurn().length === 0) {
                  <p class="band-empty">{{ 'adminFeedback.stream.emptyYourTurn' | translate }}</p>
                }
                @for (m of yourTurn(); track m.id) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, i: $index }"></ng-container>
                }
              }
            </section>

            <!-- BAND 2 · Läuft: the routine's pile and the questions parked at
                 a user. Nothing to do here — it is there to be seen. -->
            <section class="band running">
              <button
                type="button"
                class="band-head"
                (click)="toggleBand('routine')"
                [attr.aria-expanded]="!bandCollapsed('routine')"
                [scTooltip]="(bandCollapsed('routine') ? 'adminFeedback.stream.expandBand' : 'adminFeedback.stream.collapseBand') | translate: { band: ('adminFeedback.stream.running' | translate) }">
                <span class="bh-title">{{ 'adminFeedback.stream.running' | translate }}</span>
                <span class="bh-count" [class.pulse]="bandPulse('routine')">{{ running().length }}</span>
                <span class="chev" [class.open]="!bandCollapsed('routine')" aria-hidden="true">▸</span>
              </button>
              @if (!bandCollapsed('routine')) {
                @if (running().length === 0) {
                  <p class="band-empty">{{ 'adminFeedback.stream.emptyRunning' | translate }}</p>
                }
                @for (m of running(); track m.id) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, i: $index }"></ng-container>
                }
              }
            </section>

            <!-- BAND 3 · Geliefert: what shipped, by day, the LAST day on top,
                 with a deep link into the app and a marker for everything that
                 finished since the admin last looked. Replaces the archive tab
                 and the ship-cheer banner. -->
            <section class="band delivered">
              <button
                type="button"
                class="band-head"
                (click)="toggleBand('nobody')"
                [attr.aria-expanded]="!bandCollapsed('nobody')"
                [scTooltip]="(bandCollapsed('nobody') ? 'adminFeedback.stream.expandBand' : 'adminFeedback.stream.collapseBand') | translate: { band: ('adminFeedback.stream.delivered' | translate) }">
                <span class="bh-title">{{ 'adminFeedback.stream.delivered' | translate }}</span>
                <span class="bh-count" [class.pulse]="bandPulse('nobody')">{{ deliveredCount() }}</span>
                @if (newDeliveredCount() > 0) {
                  <span class="bh-new" [scTooltip]="'adminFeedback.stream.newSince' | translate">
                    {{ 'adminFeedback.stream.newCount' | translate: { count: newDeliveredCount() } }}
                  </span>
                }
                <span class="chev" [class.open]="!bandCollapsed('nobody')" aria-hidden="true">▸</span>
              </button>
              @if (!bandCollapsed('nobody')) {
                @if (deliveredDays().length === 0) {
                  <p class="band-empty">{{ 'adminFeedback.stream.emptyDelivered' | translate }}</p>
                }
                @for (d of visibleDeliveredDays(); track d.key) {
                  <div class="day-head">
                    <span>{{ dayLabel(d.day) }}</span>
                    <span class="dh-count">{{ d.items.length }}</span>
                  </div>
                  @for (m of d.items; track m.id) {
                    <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, feed: true, i: $index }"></ng-container>
                  }
                }
                @if (hiddenDeliveredDays() > 0) {
                  <button type="button" class="load-more" (click)="showMoreDays()">
                    {{ 'adminFeedback.stream.moreDays' | translate: { count: hiddenDeliveredDays() } }}
                  </button>
                }
              }
            </section>
          }
        </div>

        <!-- The composer bar, pinned to the bottom (settled core 7). On the full
             board it is the whole composer; in the docked panel it folds to a
             slim "＋ Neues Thema" bar so the stream owns the panel. -->
        @if (!embedded()) {
          <sc-feedback-composer
            class="main-composer"
            [draftScope]="draftScope"
            [busy]="busy()"
            [areaPicker]="true"
            [allowFiles]="true"
            [complexToggle]="true"
            placeholder="adminFeedback.compose.placeholder"
            sendLabel="adminFeedback.compose.send"
            [onSubmit]="createTopicBound" />
        } @else if (composerOpen()) {
          <div class="compose-sheet">
            <div class="cs-head">
              <span class="cs-title">{{ 'adminFeedback.compose.newTopic' | translate }}</span>
              <button
                type="button"
                class="cs-close"
                (click)="closeComposer()"
                [attr.aria-label]="'adminFeedback.compose.collapse' | translate">✕</button>
            </div>
            <sc-feedback-composer
              [draftScope]="draftScope"
              [busy]="busy()"
              [areaPicker]="true"
              [allowFiles]="true"
              [complexToggle]="true"
              [frameless]="true"
              placeholder="adminFeedback.compose.placeholder"
              sendLabel="adminFeedback.compose.send"
              [onSubmit]="createComposerBound" />
          </div>
        } @else {
          <button type="button" class="new-topic-bar" (click)="openComposer()">
            <span class="nt-plus" aria-hidden="true">＋</span>
            {{ 'adminFeedback.compose.newTopic' | translate }}
          </button>
        }
      }

      <!-- ============================================================ -->
      <!-- ONE ROW OF THE STREAM. Head = avatar · #N title · flight path +
           baton words · area · time. A row never unfolds: every card opens the
           full-panel topic, and the act (answer, sign-off, release) happens in
           there (admin feedback 0691a00b — the old inline lead card made the
           list read as expandable). -->
      <ng-template #row let-m let-feed="feed" let-i="i">
        @let turn = turnOf(m);
        @let pos = positionOf(m);
        <!-- MOTION (admin feedback cf74472a): a row rises into place when it
             is drawn (staggered by its index, capped so a long band never
             makes the reader wait), wears a one-time glow when it just
             ARRIVED in this band from another, and a sign-off taken on the
             card itself settles with one ring instead of moving anywhere. -->
        <article
          class="card sc-card"
          [class.done]="turn === 'nobody'"
          [class.is-new]="isNew(m)"
          [class.arrived]="arrived(m.id)"
          [class.settled]="settled(m.id)"
          [style.--i]="i ?? 0"
          [id]="feed ? cardDomId(m.id) + '-feed' : cardDomId(m.id)">
          <button
            type="button"
            class="card-head"
            (click)="openTopic(m.id)"
            [scTooltip]="'adminFeedback.stream.openTopic' | translate">
            <ng-container [ngTemplateOutlet]="avatar" [ngTemplateOutletContext]="{ $implicit: m.author, self: m.author_id === selfId() }"></ng-container>
            <span class="ch-body">
              <span class="ch-title-line">
                @if (topicNo(m); as no) {
                  <span class="topic-no" [scTooltip]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
                }
                <span class="topic-title">{{ cardTitle(m, 96) }}</span>
              </span>
              <span class="ch-meta">
                @let ask = askOf(m);
                <!-- "Rückfrage an dich" wears the admin red — words AND the loop
                     glyph on the path (feedback 7a450101): in the muted meta
                     line a question the routine is waiting on read like any
                     other station name and was scrolled past. Only the ask
                     addressed to the admin turns red; a question to the author
                     keeps its normal colour, because it is not this reader's. -->
                <ng-container [ngTemplateOutlet]="path" [ngTemplateOutletContext]="{ $implicit: pos, hot: ask === 'question' }"></ng-container>
                <span class="baton" [class]="'baton t-' + turn + (ask === 'question' ? ' ask-question' : '')">
                  @if (ask) {
                    {{ ('adminFeedback.ask.' + ask) | translate }}
                  } @else {
                    {{ stationLabelKey(pos) | translate }}
                  }
                </span>
                @if (areaOf(m); as a) {
                  <span class="chip area">{{ areaLabelKey(a) | translate }}</span>
                }
                <!-- The writer's own "this one is bigger" mark (feedback
                     423e5130) — shown back on the card so the tick is visible
                     after the box that set it is gone. -->
                @if (m.complex) {
                  <span class="chip" [scTooltip]="'adminFeedback.compose.complexHint' | translate">{{ 'adminFeedback.compose.complex' | translate }}</span>
                }
                @if (issueRequested(m)) {
                  <span class="chip">{{ 'adminFeedback.issue.pill' | translate }}</span>
                }
                @if (threadOnlyHit(m)) {
                  <span class="chip">{{ 'adminFeedback.search.inThread' | translate }}</span>
                }
                @if (isNew(m)) {
                  <span class="chip new">{{ 'adminFeedback.stream.newBadge' | translate }}</span>
                }
                <!-- The age, not the calendar (feedback 9a65a040): a card is
                     scanned, and "gestern" answers the question "07 / September
                     / 2026" makes the reader compute. The exact stamp stays one
                     hover away, in the viewer's own region format. -->
                @if (turn === 'admin') {
                  <span class="ch-time" [scTooltip]="waitingSinceIso(m) | scDate: 'datetime'" scTooltipTier="label">
                    {{ waitingSinceIso(m) | scDateRelative: 'since' }}
                  </span>
                } @else {
                  <span class="ch-time" [scTooltip]="lastActivityIso(m) | scDate: 'datetime'" scTooltipTier="label">
                    {{ lastActivityIso(m) | scDateRelative }}
                  </span>
                }
              </span>
            </span>
          </button>

          <!-- Delivered rows carry their two links right on the card: go and
               look at it in the app, and the PR / issue behind it. A shipped
               topic still waiting for its sign-off gets the ✓ right here. -->
          @if (feed) {
            <div class="card-links">
              @if (inReview(m)) {
                <button class="sc-btn micro" (click)="acceptReview(m)" [disabled]="busy()">
                  ✓ {{ 'adminFeedback.review.accept' | translate }}
                </button>
              }
              @if (areaLink(m); as href) {
                <a class="link-btn" [routerLink]="href" (click)="onViewInApp($event)" [scTooltip]="'adminFeedback.stream.viewTitle' | translate: { area: (areaLabelKey(areaOf(m)!) | translate) }">
                  ▸ {{ 'adminFeedback.stream.view' | translate }}
                </a>
              }
              <ng-container [ngTemplateOutlet]="refLink" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            </div>
          }
        </article>
      </ng-template>

      <!-- Role-coloured avatar: admin red (elevated access), collaborator light
           blue, user grey-blue. Initials, never a photo. -->
      <ng-template #avatar let-a let-self="self">
        <span class="av" role="img" [class]="'av ' + toneOf(a)" [scTooltip]="roleTitle(a)" scTooltipTier="label" [attr.aria-label]="roleTitle(a)">{{ initials(a, self) }}</span>
      </ng-template>

      <!-- The flight path: four stations, filled up to the current one; a
           branch endcap for issue / declined / rejected, a loop mark for a
           post-ship continuation. Words ride along in the baton span.

           Each station draws a mini glyph instead of a bare dot (feedback
           1d013d69): Vertrag → Werkzeug → Haken → Haken im Kreis, with the
           work station swapping to the loop arrow while a Rückfrage is open
           and to a cross when the topic was abgelehnt. The whole path is ONE
           role="img" whose aria-label names where the topic stands, so a
           screen reader hears the state in words rather than four glyph names;
           each step additionally carries its own name as a hover title. -->
      <ng-template #path let-pos let-hot="hot">
        <span
          class="fp"
          role="img"
          [class.loop]="pos.loop"
          [class.hot]="hot"
          [class]="'fp s' + stationIndex(pos.station) + (pos.branch ? ' b-' + pos.branch : '') + (pos.loop ? ' loop' : '')"
          [attr.aria-label]="'adminFeedback.station.pathLabel' | translate: { station: (stationLabelKey(pos) | translate) }">
          @for (g of stationGlyphs(pos); track $index) {
            <i [class]="'g-' + g" [scTooltip]="stationGlyphLabelKey(g) | translate">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  [attr.d]="glyphPath(g)"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </i>
          }
        </span>
      </ng-template>

      <!-- ONE SENT MESSAGE, wherever it is drawn: the topic's own text, a
           routine reply, a human reply, an author-channel message. Routine
           replies carry the plain "AI" label and no avatar (round-2 feedback);
           humans carry their role avatar. Longer than three lines folds. -->
      <ng-template #message let-msg let-kind="kind">
        @let shown = kind === 'system' ? questionText(msg.body) : msg.body;
        @let rendered = render(shown);
        <div
          class="msg"
          [class.system]="kind === 'system'"
          [class.self]="kind === 'human' && msg.author_id === selfId()"
          [class.clamped]="isLong(msg.id, shown)">
          <div class="msg-head">
            @if (kind === 'system') {
              <span class="ai">{{ 'adminFeedback.kind.ai' | translate }}</span>
            } @else if (kind === 'author') {
              <span class="who">{{ (msg.from_admin ? 'adminFeedback.userTopic.fromTeam' : 'adminFeedback.userTopic.fromAuthor') | translate }}</span>
              @if (msg.is_question) { <span class="chip">{{ 'adminFeedback.userTopic.questionBadge' | translate }}</span> }
            } @else {
              <ng-container [ngTemplateOutlet]="avatar" [ngTemplateOutletContext]="{ $implicit: msg.author, self: msg.author_id === selfId() }"></ng-container>
              <span class="who">{{ authorLabelFor(msg) }}</span>
            }
            <span class="msg-ts">{{ msg.created_at | scDate: 'datetime' }}</span>
          </div>
          <div class="msg-body" [innerHTML]="rendered.html"></div>
          <ng-container [ngTemplateOutlet]="readMore" [ngTemplateOutletContext]="{ $implicit: msg.id, body: shown }"></ng-container>
          <sc-feedback-attachments class="sent" [images]="rendered.images" />
        </div>
      </ng-template>

      <!-- "Mehr anzeigen" under a message that folds (> 3 lines). -->
      <ng-template #readMore let-id let-body="body">
        @if (isLongBody(body)) {
          <button type="button" class="read-more" (click)="toggleLong(id)" [attr.aria-expanded]="isLongOpen(id)">
            {{ (isLongOpen(id) ? 'adminFeedback.sheet.readLess' : 'adminFeedback.sheet.readMore') | translate }}
          </button>
        }
      </ng-template>

      <!-- One-tap answers when the routine marked options ([[A|B]]). -->
      <ng-template #options let-m>
        @if (answerOptionsFor(m); as ao) {
          <div class="answer-options" role="group" [attr.aria-label]="'adminFeedback.sheet.options' | translate">
            @for (o of ao.options; track o) {
              <button type="button" class="sc-btn micro option" (click)="answerWithOption(m, o)" [disabled]="busy() || answering()">{{ o }}</button>
            }
          </div>
        }
      </ng-template>

      <!-- The PR / issue behind a delivered topic. Looking up the diff is a
           detail, not a decision, so it is an arrow parked on the right edge of
           the row instead of a second labelled button competing with the ones
           that do decide something (feedback d08f1983). Named on hover and for
           screen readers, so it stays findable. -->
      <ng-template #refLink let-m>
        @if (m.ship_ref) {
          @let refLabel = (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate;
          <a
            class="link-btn quiet ref"
            [href]="m.ship_ref"
            target="_blank"
            rel="noopener noreferrer"
            [scTooltip]="refLabel"
            scTooltipTier="label"
            [attr.aria-label]="refLabel">↗</a>
        }
      </ng-template>

      <!-- ============================================================ -->
      <!-- THE TOPIC, opened: takes the whole panel (round-1 feedback — one
           needs room to read). First message of the poster, the newest
           message, and between them one "…" that unfolds one more message
           per tap. The composer is glued to the bottom edge.

           READING ROOM (admin feedback 187574ed: "wenn ich in dem issue drin
           bin brauche ich die Headerzeile mit Profil und Statusleiste etc.
           nicht mehr, ich will ja dann lesen: erster Post + letzter Post +
           Inputfeld"). The two chrome rows that used to open this sheet — the
           poster/kind/timestamp line and the flight-path/baton/chips line — are
           gone. Both said what the stream card the admin just tapped already
           said, and together they pushed the first sentence of the topic below
           the fold. What was NOT elsewhere in this sheet was the ship/issue
           link, so that one moved into the ⋯ menu rather than disappearing. -->
      @if (openRow(); as m) {
        <div class="sheet topic" role="dialog" aria-modal="true" [attr.aria-label]="cardTitle(m, 96)" [attr.inert]="declineTopicRow() ? '' : null">
          <header class="sh-head">
            <button type="button" class="sh-btn" (click)="closeTopic()" [attr.aria-label]="'adminFeedback.sheet.close' | translate">←</button>
            @if (topicNo(m); as no) { <span class="topic-no">#{{ no }}</span> }
            <span class="sh-title">{{ cardTitle(m, 120) }}</span>
            <button
              type="button"
              class="sh-btn"
              (click)="toggleMore(m.id)"
              aria-haspopup="true"
              [attr.aria-expanded]="moreOpen(m.id)"
              [attr.aria-label]="'adminFeedback.actions.more' | translate">⋯</button>
          </header>

          @if (moreOpen(m.id)) {
            <!-- Rare, deliberate acts behind the one ⋯ (feedback 03d7e546). -->
            <div class="more-menu" role="group" [attr.aria-label]="'adminFeedback.actions.more' | translate">
              <!-- No "In App ansehen" here (admin feedback 187574ed): the card
                   the admin tapped to get into this topic carries that link, so
                   inside the topic it was a third copy of a route that is one
                   tap behind the reader anyway.

                   The PR / issue behind the topic. It used to sit on the status
                   row this sheet no longer has (admin feedback 187574ed) —
                   looking up the diff is a rare, deliberate act, which is
                   exactly what this menu is for. -->
              @if (m.ship_ref) {
                <a class="menu-item" [href]="m.ship_ref" target="_blank" rel="noopener noreferrer">
                  ↗ {{ (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }}
                </a>
              }
              @if (!archived(m) && !inReview(m)) {
                @if (issueRequested(m)) {
                  <button type="button" class="menu-item" (click)="undoIssueRequest(m)" [disabled]="busy()">
                    &#8630; {{ 'adminFeedback.issue.undo' | translate }}
                  </button>
                } @else {
                  <button type="button" class="menu-item" (click)="requestIssue(m)" [disabled]="busy()">
                    {{ 'adminFeedback.issue.mark' | translate }}
                  </button>
                }
              }
              @if (fromUser(m) && !archived(m) && !inReview(m)) {
                <button type="button" class="menu-item danger" (click)="openDeclineForm(m)" [disabled]="busy()">
                  {{ 'adminFeedback.decline.mark' | translate }}
                </button>
              } @else {
                <button type="button" class="menu-item danger" (click)="remove(m)" [disabled]="busy()">
                  {{ 'adminFeedback.delete' | translate }}
                </button>
              }
            </div>
          }

          <div class="sh-body">
            @if (m.processing_note) {
              <p class="proc-note">{{ m.processing_note }}</p>
            }

            <!-- The poster's first message — the topic itself. -->
            @let body = render(m.body);
            <div class="msg first" [class.clamped]="isLong(m.id, m.body)">
              <div class="msg-body" [innerHTML]="body.html"></div>
              <ng-container [ngTemplateOutlet]="readMore" [ngTemplateOutletContext]="{ $implicit: m.id, body: m.body }"></ng-container>
              <sc-feedback-attachments class="sent" [images]="body.images" />
            </div>

            <!-- Admin ↔ routine thread: newest message always visible, the
                 middle behind "…" that reveals one more message per tap. -->
            @let tf = threadView(m.id);
            @if (tf.total > 0) {
              <div class="thread">
                @if (tf.hiddenCount > 0) {
                  <button type="button" class="thread-more" (click)="revealOne(tf.key)">
                    <span class="ellipsis" aria-hidden="true">…</span>
                    {{ 'adminFeedback.sheet.showOneMore' | translate: { count: tf.hiddenCount } }}
                  </button>
                } @else if (tf.revealed > 0) {
                  <button type="button" class="thread-more" (click)="hideRevealed(tf.key)">
                    <span class="ellipsis" aria-hidden="true">⌃</span>
                    {{ 'adminFeedback.sheet.hideBetween' | translate }}
                  </button>
                }
                @for (msg of tf.shown; track msg.id) {
                  <ng-container [ngTemplateOutlet]="message" [ngTemplateOutletContext]="{ $implicit: msg, kind: msg.is_system ? 'system' : 'human' }"></ng-container>
                }
              </div>
            }

            <!-- No review box in the sheet any more (admin feedback 187574ed):
                 "Abgenommen" is a button in the composer row, and the second
                 way out — picking the conversation back up — IS writing the
                 reply, so it needs neither a button nor a box of its own. -->
            @if (untriaged(m) && !archived(m) && !inReview(m)) {
              <div class="inline-actions">
                <button class="sc-btn micro" (click)="releaseToRoutine(m)" [disabled]="busy()">
                  {{ 'adminFeedback.userTopic.release' | translate }}
                </button>
              </div>
            }
            @if (archived(m)) {
              <p class="reopen-hint">↻ {{ 'adminFeedback.thread.reopenHint' | translate }}</p>
            }

            <!-- AUTHOR CHANNEL — only for a user topic; everything here is what
                 that person sees. The thread above never is. -->
            @if (fromUser(m)) {
              <section class="author-channel sc-nest">
                <header class="ac-head">
                  <span class="ac-title">{{ 'adminFeedback.userTopic.channelTitle' | translate }}</span>
                  <span class="ac-status">
                    {{ 'adminFeedback.userTopic.seesStatus' | translate }}
                    <strong>{{ ('userFeedback.status.' + authorFacingStatus(m)) | translate }}</strong>
                  </span>
                </header>
                <!-- The privacy rule, in words, where it applies. -->
                <p class="ac-hint">{{ 'adminFeedback.userTopic.channelHint' | translate }}</p>
                @let af = authorView(m.id);
                @if (af.total > 0) {
                  <div class="thread">
                    @if (af.hiddenCount > 0) {
                      <button type="button" class="thread-more" (click)="revealOne(af.key)">
                        <span class="ellipsis" aria-hidden="true">…</span>
                        {{ 'adminFeedback.sheet.showOneMore' | translate: { count: af.hiddenCount } }}
                      </button>
                    } @else if (af.revealed > 0) {
                      <button type="button" class="thread-more" (click)="hideRevealed(af.key)">
                        <span class="ellipsis" aria-hidden="true">⌃</span>
                        {{ 'adminFeedback.sheet.hideBetween' | translate }}
                      </button>
                    }
                    @for (am of af.shown; track am.id) {
                      <ng-container [ngTemplateOutlet]="message" [ngTemplateOutletContext]="{ $implicit: am, kind: 'author' }"></ng-container>
                    }
                  </div>
                }
                @if (!archived(m)) {
                  <label class="ac-ask">
                    <input type="checkbox" [checked]="asksAuthor(m.id)" (change)="toggleAskAuthor(m.id)" />
                    {{ 'adminFeedback.userTopic.asQuestion' | translate }}
                  </label>
                  <!-- Frameless (admin feedback ae072e63): the author channel
                       already draws the dashed frame that groups this. -->
                  <sc-feedback-composer
                    [compact]="true"
                    [frameless]="true"
                    [draftScope]="authorScope(m.id)"
                    [busy]="busy()"
                    [allowFiles]="true"
                    placeholder="adminFeedback.userTopic.messagePlaceholder"
                    [sendLabel]="asksAuthor(m.id) ? 'adminFeedback.userTopic.questionSend' : 'adminFeedback.userTopic.messageSend'"
                    [onSubmit]="authorReplySubmitFor(m.id)" />
                }
              </section>
            }
          </div>

          <!-- The composer, glued to the bottom edge of the sheet: three rows
               that grow with what is typed, half-size chips with "+" (attach)
               and 📷 (screenshot) beside one red send button.

               It wears no frame of its own (admin feedback 187574ed) — the
               sticky top border of this bar is the separation, and a second
               rounded box a few pixels inside it was the "Doppelumrandung". The
               placeholder names the topic the reply will land in.

               This row is where the topic is DECIDED (admin feedback 187574ed):
               while a sign-off is pending, "Abgenommen" stands left of the send
               button, and the send button itself is the key that triggers it.
               Two moves, one line: accept the result, or answer it — and
               answering is what puts the topic back on the routine's pile
               (sheetReplySubmitFor). -->
          <div class="sh-composer">
            <ng-container [ngTemplateOutlet]="options" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            <sc-feedback-composer
              [draftScope]="threadScope(m.id)"
              [busy]="busy()"
              [allowFiles]="true"
              [large]="true"
              [frameless]="true"
              [primaryHot]="true"
              [iconSend]="true"
              [placeholder]="topicNo(m) ? 'adminFeedback.thread.replyPlaceholderNo' : 'adminFeedback.thread.replyPlaceholderTopic'"
              [placeholderParams]="{ no: topicNo(m), title: cardTitle(m, 42) }"
              sendLabel="adminFeedback.thread.reply"
              [onSubmit]="sheetReplySubmitFor(m.id)">
              @if (inReview(m)) {
                <button
                  composerAction
                  type="button"
                  class="sc-btn micro sign-off"
                  (click)="acceptReview(m)"
                  [disabled]="busy()"
                  [scTooltip]="'adminFeedback.review.hint' | translate">
                  ✓ {{ 'adminFeedback.review.accept' | translate }}
                </button>
              }
            </sc-feedback-composer>
          </div>
        </div>
      }

      <!-- ============================================================ -->
      <!-- FILTER SHEET: three questions, each answered by a wrapping row of
           chips (≥ 48 px). Stacked full-width rows spent the whole horizontal
           axis on one option and pushed the later ones out of the sheet's
           scroll port — feedback 04013a4c saw a half-cut "Nutzer-Feedback". -->
      @if (filtersOpen()) {
        <div class="sheet filters" role="dialog" aria-modal="true" [attr.aria-label]="'adminFeedback.filters.title' | translate">
          <header class="sh-head">
            <button type="button" class="sh-btn" (click)="closeFilters()" [attr.aria-label]="'adminFeedback.filters.done' | translate">←</button>
            <span class="sh-title">{{ 'adminFeedback.filters.title' | translate }}</span>
            @if (filterCount() > 0) {
              <button type="button" class="sh-btn text" (click)="resetFilters()">{{ 'adminFeedback.filters.reset' | translate }}</button>
            }
          </header>
          <div class="sh-body">
            <div class="fq">{{ 'adminFeedback.filters.who' | translate }}</div>
            <div class="f-chips" role="group" [attr.aria-label]="'adminFeedback.filters.who' | translate">
              <button type="button" class="f-chip" [class.on]="whoIs('all')" [attr.aria-pressed]="whoIs('all')" (click)="setWho('all')"><span class="f-label">{{ 'adminFeedback.filters.whoAll' | translate }}</span></button>
              <button type="button" class="f-chip" [class.on]="whoIs('mine')" [attr.aria-pressed]="whoIs('mine')" (click)="setWho('mine')"><span class="f-label">{{ 'adminFeedback.filters.whoMine' | translate }}</span></button>
              <button type="button" class="f-chip" [class.on]="whoIs('others')" [attr.aria-pressed]="whoIs('others')" (click)="setWho('others')"><span class="f-label">{{ 'adminFeedback.filters.whoOthers' | translate }}</span></button>
              <button type="button" class="f-chip" [class.on]="whoIs('users')" [attr.aria-pressed]="whoIs('users')" (click)="setWho('users')">
                <span class="f-label">{{ 'adminFeedback.filters.whoUsers' | translate }}</span>
                @if (untriagedWaiting()) { <span class="dot hot" [scTooltip]="'adminFeedback.sourceFilter.untriagedHint' | translate" scTooltipTier="label" [attr.aria-label]="'adminFeedback.sourceFilter.untriagedHint' | translate"></span> }
              </button>
              @for (a of authorOptions(); track a.id) {
                <button type="button" class="f-chip sub" [class.on]="whoIsAuthor(a.id)" [attr.aria-pressed]="whoIsAuthor(a.id)" (click)="setWhoAuthor(a.id)">
                  <span class="f-label">{{ authorLabel(a.row) }}</span> <span class="f-count">{{ a.count }}</span>
                </button>
              }
            </div>

            <div class="fq">{{ 'adminFeedback.filters.where' | translate }}</div>
            <div class="f-chips" role="group" [attr.aria-label]="'adminFeedback.filters.where' | translate">
              <button type="button" class="f-chip" [class.on]="whereFilter() === null" [attr.aria-pressed]="whereFilter() === null" (click)="setWhere(null)"><span class="f-label">{{ 'adminFeedback.filters.whereAll' | translate }}</span></button>
              @for (w of whereOptions(); track w.bucket) {
                <button type="button" class="f-chip" [class.on]="whereFilter() === w.bucket" [attr.aria-pressed]="whereFilter() === w.bucket" (click)="setWhere(w.bucket)">
                  <span class="f-label">{{ w.labelKey | translate }}</span> <span class="f-count">{{ w.count }}</span>
                </button>
              }
            </div>

            <div class="fq">{{ 'adminFeedback.filters.area' | translate }}</div>
            <div class="f-chips" role="group" [attr.aria-label]="'adminFeedback.filters.area' | translate">
              <button type="button" class="f-chip" [class.on]="areaFilter() === null" [attr.aria-pressed]="areaFilter() === null" (click)="setArea(null)"><span class="f-label">{{ 'adminFeedback.filters.areaAll' | translate }}</span></button>
              @for (a of areaOptions(); track a.area) {
                <button type="button" class="f-chip" [class.on]="areaFilter() === a.area" [attr.aria-pressed]="areaFilter() === a.area" (click)="setArea(a.area)">
                  <span class="f-label">{{ areaLabelKey(a.area) | translate }}</span> <span class="f-count">{{ a.count }}</span>
                </button>
              }
            </div>
          </div>
          <div class="sh-composer">
            <button type="button" class="sc-btn sc-btn-primary done-btn" (click)="closeFilters()">{{ 'adminFeedback.filters.done' | translate }}</button>
          </div>
        </div>
      }

      <!-- DECLINE SHEET: "nicht umsetzen" with the mandatory explanation the
           author gets to read (feedback 5920cf8c, d5a779da). -->
      @if (declineTopicRow(); as m) {
        <div class="sheet decline" role="dialog" aria-modal="true" [attr.aria-label]="'adminFeedback.decline.mark' | translate">
          <header class="sh-head">
            <button type="button" class="sh-btn" (click)="cancelDeclineForm()" [attr.aria-label]="'adminFeedback.decline.cancel' | translate">←</button>
            <span class="sh-title">{{ 'adminFeedback.decline.mark' | translate }}</span>
          </header>
          <form class="sh-body decline-form" (submit)="declineTopic(m, $event)">
            <div class="fq">{{ 'adminFeedback.decline.reasonsLabel' | translate }}</div>
            <div class="f-rows" role="group">
              @for (r of declineReasons; track r.id) {
                <button
                  type="button"
                  class="f-row"
                  [class.on]="declineReason() === r.id"
                  [attr.aria-pressed]="declineReason() === r.id"
                  (click)="pickDeclineReason(r.id)">
                  {{ r.labelKey | translate }}
                </button>
              }
            </div>
            <!-- Same cap and the same live readout as every other feedback
                 field (admin feedback 0a0fad31) — the author reads this text. -->
            <div class="field">
              <textarea
                class="decline-input"
                rows="4"
                required
                [value]="declineNote()"
                (input)="onDeclineInput($event)"
                [attr.maxlength]="maxChars"
                [attr.placeholder]="'adminFeedback.decline.placeholder' | translate"
                [attr.aria-label]="'adminFeedback.decline.placeholder' | translate"></textarea>
              <sc-char-counter [used]="declineNote().length" [max]="maxChars" />
            </div>
            <div class="inline-actions">
              <button class="sc-btn micro danger" type="submit" [disabled]="busy()">{{ 'adminFeedback.decline.confirm' | translate }}</button>
              <button class="sc-btn micro" type="button" (click)="cancelDeclineForm()">{{ 'adminFeedback.decline.cancel' | translate }}</button>
            </div>
          </form>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    /* As a page it runs the full frame (styles.scss, "PAGE FRAME") — the same
       width the maximized FAB panel already gives the large board. */
    .page { position: relative; display: flex; flex-direction: column; gap: var(--sc-gap-2); min-height: 0; }
    .page:not(.embedded) { min-height: 70vh; }
    .page.embedded { flex: 1 1 auto; padding: var(--sc-pad-2); box-sizing: border-box; }
    /* overflow-x: the stream scrolls DOWN, never sideways (admin feedback
       96259f21). overflow-y: auto alone leaves the x axis at "visible", which
       computes to "auto" — so a few stray pixels anywhere in the list (a
       rotated glyph, a wide chip) put a horizontal scrollbar under the whole
       overview. Nothing in a row is meant to be reached sideways. */
    .scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0; display: flex; flex-direction: column; gap: var(--sc-gap-2); scrollbar-width: thin; }
    .page:not(.embedded) .scroll { overflow: visible; }
    .view-in { animation: fb-rise 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .page.overlay-open .scroll, .page.overlay-open .topbar, .page.overlay-open .new-topic-bar, .page.overlay-open .compose-sheet, .page.overlay-open .main-composer { visibility: hidden; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err { padding: 10px 14px; background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); border-radius: 4px; }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 32px var(--sc-pad-1); }

    /* ---- Controls at rest ---- */
    .topbar { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; container-type: inline-size; container-name: topbar; }
    .tb-title { font-weight: 600; font-size: 0.9rem; }
    .search-box { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; }
    .search-box:focus-within, .search-box.active { border-color: var(--sc-accent); }
    .search-icon { color: var(--sc-fg-2); flex: 0 0 auto; }
    .search-box input { flex: 1 1 auto; min-width: 0; background: transparent; border: 0; color: var(--sc-fg-0); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor)); outline: none; }
    .search-clear { flex: 0 0 auto; min-width: 32px; min-height: 32px; background: transparent; border: 0; color: var(--sc-fg-2); font-size: 1.1rem; cursor: pointer; }
    .tb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 12px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.82rem, var(--sc-fs-floor)); cursor: pointer; }
    .tb-btn:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .tb-btn.active { border-color: var(--sc-accent); color: var(--sc-accent); }
    .tb-btn.progress { font-size: max(0.86rem, var(--sc-fs-floor)); }
    /* Stroke glyph, not an emoji: it takes the button's colour, so hover and
       the active accent reach it too (admin feedback a33ba528). */
    .tb-icon { display: block; flex: none; width: 18px; height: 18px; }
    .tb-icon.head { color: var(--sc-accent); }
    .tb-icon svg { display: block; width: 100%; height: 100%; }
    .tb-count { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--sc-accent); color: var(--sc-bg-0); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; text-align: center; }
    @media (max-width: 420px) { .tb-btn.filter .tb-label, .tb-btn.progress .tb-label { display: none; } }
    /* Large board (page / maximized panel): the search field stops at the
       docked window's content width instead of spanning the row, the quick
       "Wer?" chips take the freed room, and Filter + Fortschritt keep the
       right edge (admin feedback a4f30011). The chips borrow the sheet's
       .f-chip look but sit at the row's 44px so the four controls read as one
       line. The row gives the chips up in two steps as the topbar narrows —
       below ~800px "Nutzer-Feedback" (the widest, marked .more) goes first,
       below ~640px the pair "Alle / Meine Themen" follows — so the search
       always keeps ~200px of its own. Both fold back into the sheet, which
       carries every answer regardless. That second step is what covers the
       page on a phone, where "large" is a state but not a width. */
    .page.large .search-box { max-width: calc(var(--sc-feedback-dock-width) - 2 * var(--sc-pad-2)); }
    .page.large .tb-btn.filter { margin-left: auto; }
    .quick-chips { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .quick-chips .f-chip { min-height: 44px; }
    @container topbar (max-width: 799px) { .quick-chips .f-chip.more { display: none; } }
    @container topbar (max-width: 639px) { .quick-chips { display: none; } }

    /* ---- Bands ---- */
    .band { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
    .band-head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 4px 2px; background: transparent; border: 0; border-bottom: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer; }
    .band-head.static { cursor: default; }
    .bh-title { font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .band.yours .bh-title { color: var(--sc-fg-0); }
    .bh-count { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-3); color: var(--sc-fg-1); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; text-align: center; }
    .bh-count.hot { background: var(--sc-accent); color: var(--sc-bg-0); }
    .bh-new { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 600; }
    /* The chevron is a fixed square box. Rotated 90° an inline glyph box turns
       its LINE HEIGHT into its width, and that overhang counts as scrollable
       overflow — every expanded band pushed the list ~3 px sideways and gave
       the overview a horizontal scrollbar (admin feedback 96259f21). */
    .band-head .chev { margin-left: auto; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 1; color: var(--sc-fg-2); transition: transform 0.16s ease; }
    .chev.open { transform: rotate(90deg); }
    .band-empty { margin: 0; padding: 8px 4px; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .day-head { display: flex; align-items: center; gap: 8px; margin: 4px 2px 0; font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--sc-fg-2); }
    .dh-count { font-weight: 400; }
    .load-more { min-height: 44px; background: transparent; border: 1px dashed var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); cursor: pointer; }
    .load-more:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }

    /* ---- Card ----
       A row sits ON the panel surface: outline only, no fill and no glow.
       The sc-card glow has a 16 px blur and the rows are 8 px apart, so the
       halos of a band's rows overlapped into one continuous light haze —
       an odd shared background wrapped around every group of issues (admin
       feedback 96259f21). The 1 px border still tells one row from the next. */
    .card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: var(--sc-pad-3); background: transparent; box-shadow: none; }
    .card.done { opacity: 0.88; }

    /* ---- Motion (admin feedback cf74472a) ----
       Four moments, each with one small movement, none of them looping:
       1. A row RISES into place when it is drawn — a 6 px lift and a fade,
          staggered by its index so a band builds top-down instead of popping
          in as one block. The stagger is capped at eight rows: past that the
          reader would be waiting on the animation, not reading.
       2. A row that just ARRIVED in a band (moved here since the last poll,
          or brand new) glows once along its left edge and fades back within
          two seconds — "this one is new here", said once, then quiet.
       3. A row LEAVES by folding shut (Web Animations API, feedback-motion
          .service.ts) — height, padding and the gap under it go to zero while
          it slides out to the right; the data catches up after.
       4. A sign-off taken ON a Geliefert card SETTLES with one accent ring —
          the sc-snap idiom from styles.scss — because it does not move.
       The global reduced-motion rule clamps every duration here to 0.01 ms,
       and the service skips its own waits, so a reduced viewer gets the end
       state at once. */
    .card { animation: fb-rise 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: calc(min(var(--i, 0), 8) * 28ms); }
    @keyframes fb-rise {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: none; }
    }
    .card::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; opacity: 0; }
    .card.arrived::before { box-shadow: inset 3px 0 0 var(--sc-accent), 0 0 14px color-mix(in srgb, var(--sc-accent) 35%, transparent); animation: fb-arrive 1.8s ease-out both; }
    @keyframes fb-arrive {
      0%   { opacity: 0; }
      12%  { opacity: 1; }
      55%  { opacity: 1; }
      100% { opacity: 0; }
    }
    .card.settled::before { border: 1px solid var(--sc-accent); animation: fb-settle 620ms ease-out both; }
    @keyframes fb-settle {
      0%   { opacity: 0; transform: scale(0.985); }
      30%  { opacity: 1; transform: none; box-shadow: 0 0 12px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      100% { opacity: 0; transform: none; box-shadow: none; }
    }
    /* The last station (Haken im Kreis) pops once as the sign-off lands. */
    .card.settled .fp i:nth-child(4) { animation: fb-pop 460ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @keyframes fb-pop {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.35); }
      100% { transform: scale(1); }
    }
    /* A band's count beats once when a row just arrived in it — the CTA's
       nudge, not a siren: one beat, then the number stands still. */
    .bh-count.pulse { animation: fb-beat 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @keyframes fb-beat {
      0%   { transform: scale(1); }
      35%  { transform: scale(1.22); }
      100% { transform: scale(1); }
    }
    /* Hover: the title takes the accent and a tappable micro button lifts a
       pixel — enough to say "this reacts", never enough to move the layout. */
    .topic-title, .card-head { transition: color 0.16s ease; }
    .sc-btn.micro, .link-btn, .load-more, .new-topic-bar, .tb-btn, .f-chip { transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease; }
    .sc-btn.micro:hover:not(:disabled), .link-btn:hover { transform: translateY(-1px); }
    .sc-btn.micro:active:not(:disabled), .link-btn:active { transform: none; transition-duration: 0.06s; }
    .card-head { display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 44px; padding: 0; background: transparent; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
    .card-head:focus-visible, .band-head:focus-visible, .tb-btn:focus-visible, .sh-btn:focus-visible, .read-more:focus-visible, .link-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.32); }
    .f-row:focus-visible, .menu-item:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--sc-accent); }
    .ch-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ch-title-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .topic-no { flex: 0 0 auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; font-variant-numeric: tabular-nums; }
    .topic-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; font-size: 0.88rem; color: var(--sc-fg-0); }
    .card-head:hover .topic-title { color: var(--sc-accent); }
    .ch-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ch-time { margin-left: auto; white-space: nowrap; }
    .baton { font-weight: 600; color: var(--sc-fg-1); }
    .baton.t-admin { color: var(--sc-fg-0); }
    /* The routine's question to the admin, in the admin red (feedback
       7a450101) — the one baton word that must not blend into the meta line. */
    .baton.ask-question { color: var(--sc-accent-hot); }
    .baton.t-nobody { color: var(--sc-fg-2); font-weight: 500; }
    .chip { display: inline-block; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--sc-border); font-size: max(0.68rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-2); white-space: nowrap; }
    .chip.area { border-style: dashed; }
    .chip.new { border-color: var(--sc-accent); color: var(--sc-accent); }
    .chip.hot { border-color: var(--sc-accent); color: var(--sc-accent); }
    .card-links, .inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .link-btn { display: inline-flex; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; text-decoration: none; }
    .link-btn.quiet { border-color: var(--sc-border); color: var(--sc-fg-1); }
    /* The PR / issue arrow sits on the far right of its row and stays quiet
       until you look for it (feedback d08f1983). */
    .link-btn.ref { margin-left: auto; min-width: 36px; justify-content: center; padding: 0 8px; border-color: transparent; color: var(--sc-fg-2); font-size: 1rem; }
    .link-btn.ref:hover { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .link-btn:hover { background: rgba(0, 212, 255, 0.08); }

    /* ---- Avatar (role colours; red = elevated access) ---- */
    .av { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.02em; background: rgba(120, 150, 190, 0.28); color: #b9c9de; }
    .av.adm { background: var(--sc-accent-hot); color: var(--sc-bg-0); border: 1px solid var(--sc-accent-hot); }
    .av.col { background: rgba(158, 203, 255, 0.2); color: #9ecbff; border: 1px solid rgba(158, 203, 255, 0.55); }
    .msg-head .av { width: 22px; height: 22px; font-size: max(0.62rem, var(--sc-fs-floor)); }

    /* ---- Flight path (four glyph steps, feedback 1d013d69) ----
       The step is the icon; the fill state is colour + opacity. Passed steps
       are solid foreground, the step the topic sits on is accent, steps still
       ahead are dimmed. 13px is the smallest size at which the wrench and the
       loop arrow stay tellable apart, and the row it lives in is 16px tall. */
    .fp { display: inline-flex; align-items: center; gap: 0; flex: 0 0 auto; }
    .fp i { display: block; width: 13px; height: 13px; box-sizing: border-box; position: relative; color: var(--sc-fg-2); opacity: 0.45; }
    .fp i svg { display: block; width: 100%; height: 100%; }
    .fp i + i { margin-left: 7px; }
    .fp i + i::before { content: ''; position: absolute; right: 100%; top: 50%; width: 7px; height: 1px; background: var(--sc-fg-2); opacity: 0.6; }
    .fp.s0 i:nth-child(-n+1), .fp.s1 i:nth-child(-n+2), .fp.s2 i:nth-child(-n+3), .fp.s3 i:nth-child(-n+4) { opacity: 1; }
    .fp.s0 i:nth-child(1), .fp.s1 i:nth-child(2), .fp.s2 i:nth-child(3), .fp.s3 i:nth-child(4) { color: var(--sc-accent); }
    /* A dead end is not "you are here, working": the cross stays in the muted
       foreground rather than the accent (--sc-danger is reserved for errors and
       destructive actions), and the two steps it will never reach go faint. */
    .fp.b-declined i:nth-child(2), .fp.b-rejected i:nth-child(2) { color: var(--sc-fg-2); opacity: 1; }
    /* The loop arrow of a Rückfrage an dich matches the red baton beside it
       (feedback 7a450101); the same arrow for a question to the author stays
       accent, because that one is not waiting on this reader. */
    .fp.hot i:nth-child(2) { color: var(--sc-accent-hot); }
    .fp.b-declined i:nth-child(n+3), .fp.b-rejected i:nth-child(n+3) { opacity: 0.3; }

    /* ---- Messages ---- */
    .msg { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: 8px; }
    .msg.system { border-left: 3px solid var(--sc-accent); }
    .msg.self { border-left: 3px solid var(--sc-accent-hot); }
    .msg.first { background: transparent; border: 0; padding: 0; }
    .msg-head { display: flex; align-items: center; gap: 8px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .msg-head .who { font-weight: 600; color: var(--sc-fg-1); }
    .msg-ts { margin-left: auto; white-space: nowrap; }
    .ai { font-weight: 700; letter-spacing: 0.08em; color: var(--sc-accent); }
    /* overflow-x: the scrollport for a marked-up runaway token (.sc-longword,
       styles.scss) — it overflows this box instead of reflowing the card. */
    .msg-body { font-size: 0.9rem; line-height: 1.5; overflow-wrap: anywhere; overflow-x: auto; }
    .msg-body :is(p, ul, ol) { margin: 0 0 0.5em; }
    .msg-body :is(p, ul, ol):last-child { margin-bottom: 0; }
    .msg.clamped .msg-body { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .read-more { align-self: flex-start; min-height: 32px; padding: 0 6px; background: transparent; border: 0; color: var(--sc-accent); font: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .sent { --att-size: 40px; }
    .thread { display: flex; flex-direction: column; gap: 6px; }
    /* A message that enters the thread — one more revealed behind "…", or the
       reply just sent — rises in the same way a row does. */
    .thread .msg { animation: fb-rise 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .band-empty { animation: fb-rise 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .answer-options { display: flex; flex-wrap: wrap; gap: 8px; }
    .sc-btn.micro { padding: 6px 12px; min-height: 40px; font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.option { min-height: 44px; }
    .sc-btn.hot { background: var(--sc-accent-hot); border-color: var(--sc-accent-hot); color: var(--sc-bg-0); }
    .sc-btn.hot:hover:not(:disabled) { background: var(--sc-accent-hot); filter: brightness(1.12); box-shadow: none; }
    .sc-btn.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    .sc-btn.danger:hover:not(:disabled) { background: var(--sc-danger); color: #fff; box-shadow: none; }
    .proc-note { margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .reopen-hint { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .author-channel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px dashed var(--sc-accent); border-radius: 8px; }
    .ac-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .ac-title { font-weight: 700; font-size: max(0.72rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-accent); }
    .ac-status, .ac-hint { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ac-hint { margin: 0; }
    .ac-ask { display: flex; align-items: center; gap: 8px; min-height: 40px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .ac-ask input { width: 20px; height: 20px; }

    /* ---- Sheets (topic, filters, decline) — the whole panel ---- */
    .sheet { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; background: var(--sc-bg-1); border-radius: inherit; animation: fb-sheet-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    /* A sheet slides up out of the stream it covers; closing is instant, so
       the eye is already on the stream when a row folds away behind it. */
    @keyframes fb-sheet-in {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: none; }
    }
    .page.embedded .sheet { inset: 0; }
    .page:not(.embedded) .sheet { position: fixed; z-index: 30; max-width: 860px; margin: 0 auto; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5); }
    .sh-head { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-height: 52px; padding: 6px var(--sc-pad-2); border-bottom: 1px solid var(--sc-border); }
    .sh-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; background: transparent; border: 0; border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: 1.1rem; cursor: pointer; }
    .sh-btn:hover { background: var(--sc-bg-2); color: var(--sc-fg-0); }
    .sh-btn.text { font-size: max(0.78rem, var(--sc-fs-floor)); padding: 0 10px; color: var(--sc-accent); }
    .sh-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; font-size: 0.9rem; }
    .sh-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--sc-gap-2); padding: var(--sc-pad-2); scrollbar-width: thin; }
    /* The sticky reply bar. Its top border is the ONLY frame down here (admin
       feedback 187574ed) — the composer inside runs frameless — and the
       distance to the panel edge is one small padding instead of two nested
       ones. The bottom keeps the safe-area inset: on a phone the home bar
       would otherwise sit on the send button. */
    .sh-composer { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px var(--sc-pad-3); border-top: 1px solid var(--sc-border); background: var(--sc-bg-1); padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
    /* The sign-off, projected into the composer's send row (admin feedback
       187574ed). It is the SECOND decision on that line, so it stays a quiet
       outline next to the red send button — never a second CTA — and it never
       shrinks below the touch floor the rest of the row keeps. */
    .sh-composer .sign-off { flex: 0 0 auto; white-space: nowrap; }
    .more-menu { display: flex; flex-direction: column; flex: 0 0 auto; border-bottom: 1px solid var(--sc-border); background: var(--sc-bg-2); animation: fb-drop 160ms ease-out both; }
    @keyframes fb-drop {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: none; }
    }
    .menu-item { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 var(--sc-pad-1); background: transparent; border: 0; color: var(--sc-fg-0); font: inherit; font-size: max(0.84rem, var(--sc-fs-floor)); text-align: left; text-decoration: none; cursor: pointer; }
    .menu-item:hover { background: var(--sc-bg-3); }
    .menu-item.danger { color: var(--sc-danger); }
    .done-btn { justify-content: center; }
    .fq { margin-top: 4px; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .f-rows { display: flex; flex-direction: column; border: 1px solid var(--sc-border); border-radius: 8px; overflow: hidden; }
    .f-row { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 14px; background: var(--sc-bg-2); border: 0; border-bottom: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor)); text-align: left; cursor: pointer; }
    .f-row:last-child { border-bottom: 0; }
    .f-row.on { color: var(--sc-fg-0); background: rgba(0, 212, 255, 0.1); box-shadow: inset 3px 0 0 var(--sc-accent); }
    /* Filter answers: chips that wrap instead of stacking, so a three-question
       sheet stays one screen tall at 490 px and every option stays visible. */
    .f-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .f-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 48px; padding: 0 14px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: 999px; color: var(--sc-fg-1); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor)); text-align: left; cursor: pointer; }
    .f-chip:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .f-chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .f-chip.sub { border-style: dashed; }
    /* Selected is a filled pill with a tick — the state has to read without
       colour, the way the old left accent bar did. */
    .f-chip.on { background: var(--sc-accent); border-color: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
    .f-chip.on::before { content: '✓'; flex: 0 0 auto; font-size: 0.9em; line-height: 1; }
    .f-chip.on .dot.hot { background: var(--sc-bg-0); }
    .f-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .f-count { flex: 0 0 auto; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-1); color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; }
    .f-chip.on .f-count { background: rgba(0, 0, 0, 0.24); color: var(--sc-bg-0); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .dot.hot { background: var(--sc-accent); }
    .decline-form { gap: 10px; }
    .decline-form .field { position: relative; }
    .decline-input { width: 100%; box-sizing: border-box; padding: 8px 10px 22px; resize: vertical; background: var(--sc-bg-2); border: 1px solid var(--sc-danger); border-radius: 6px; color: var(--sc-fg-0); font: inherit; font-size: max(0.84rem, var(--sc-fs-floor)); }

    /* ---- Composer bar ---- */
    .main-composer { position: sticky; bottom: 12px; z-index: 1; }
    .page.embedded .main-composer { position: static; }
    .new-topic-bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; background: var(--sc-bg-2); border: 1px dashed var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.82rem, var(--sc-fs-floor)); cursor: pointer; }
    .new-topic-bar:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .nt-plus { font-size: 1.1rem; color: var(--sc-accent); }
    /* No box of its own (admin feedback ae072e63: "4 Randverschachtelungen im
       Feedback Panel mit der Außenwand, ich finde 3 maximal, wenn nicht sogar
       nur 2"). The panel wall already frames this sheet, and the field inside
       draws the one border down here that says something — "you can type". So
       the sheet keeps a single top rule to part it from the stream, the way the
       opened topic's reply bar (.sh-composer) already does, and hands its side
       padding back to the page. Panel wall → field: two. */
    .compose-sheet { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 0 0; border-top: 1px solid var(--sc-border); }
    .cs-head { display: flex; align-items: center; justify-content: space-between; }
    .cs-title { font-weight: 600; font-size: max(0.82rem, var(--sc-fs-floor)); }
    .cs-close { min-width: 40px; min-height: 40px; background: transparent; border: 0; color: var(--sc-fg-2); font-size: 1rem; cursor: pointer; }

    @media (max-width: 720px) {
      .page.embedded { padding: var(--sc-pad-3); }
      .ch-time { flex-basis: 100%; margin-left: 0; }
    }
  `],
})
export class AdminFeedbackComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly consent = inject(ConsentService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly seeds = inject(FeedbackComposerSeedService);
  private readonly celebration = inject(CelebrationService);
  private readonly motion = inject(FeedbackMotionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** When embedded in the feedback FAB panel, the page chrome (title, subtitle)
   *  is dropped — the panel supplies its own header. */
  readonly embedded = input(false);

  /** Embedded only: the panel host says whether it is maximized. The standalone
   *  page is always large; the docked window never is (admin feedback a4f30011). */
  readonly large = input(false);
  readonly isLarge = computed(() => !this.embedded() || this.large());

  readonly messages = signal<FeedbackRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);

  /** Draft scope handed to the new-topic composer for account-bound persistence. */
  readonly draftScope = DRAFT_SCOPE;

  /** Replies per topic, keyed by feedback id (oldest first). */
  readonly threads = signal<Map<string, FeedbackMessage[]>>(new Map());

  messagesFor(feedbackId: string): FeedbackMessage[] {
    return this.threads().get(feedbackId) ?? [];
  }

  // ---- View: the stream, or the numbers behind the glyph ------------------

  readonly view = signal<FeedbackView>('stream');

  setView(v: FeedbackView): void {
    this.view.set(v);
  }

  // ---- Derivations every surface shares --------------------------------------

  /** The presentation bucket — the board's one bucketing rule. */
  bucketOf(m: FeedbackRow): FeedbackBucket {
    return feedbackBucket(m, this.threads().get(m.id));
  }

  turnOf(m: FeedbackRow): FeedbackTurn {
    return turnOf(m, this.threads().get(m.id));
  }

  askOf(m: FeedbackRow): AdminAsk | null {
    return adminAsk(m, this.threads().get(m.id));
  }

  positionOf(m: FeedbackRow): FlightPosition {
    return flightPosition(m, this.threads().get(m.id));
  }

  /** Template aliases for the pure helpers. */
  readonly isPlainLeftClick = isPlainLeftClick;
  readonly stationLabelKey = stationLabelKey;
  readonly turnLabelKey = turnLabelKey;
  readonly stationIndex = stationIndex;
  readonly stationGlyphs = stationGlyphs;
  readonly stationGlyphLabelKey = stationGlyphLabelKey;

  /** The Fortschritt glyph (see {@link PROGRESS_GLYPH_PATH}). */
  readonly progressGlyphPath = PROGRESS_GLYPH_PATH;

  /** The one `d` path per glyph (24×24 stroke idiom, as in the Codex icons). */
  glyphPath(glyph: StationGlyph): string {
    return STATION_GLYPH_PATHS[glyph];
  }

  /** Template-side alias for the shared {@link isArchived} rule. */
  archived(m: FeedbackRow): boolean {
    return isArchived(m, this.threads().get(m.id));
  }

  /** Template-side alias for the shared {@link refKind} rule. */
  linkKind(m: FeedbackRow): 'issue' | 'ship' {
    return refKind(m);
  }

  /** Template alias: was this topic filed by a non-admin through the user FAB? */
  fromUser(m: FeedbackRow): boolean {
    return isUserSubmitted(m);
  }

  /** Template alias: does this user topic still wait to be released to the routine? */
  untriaged(m: FeedbackRow): boolean {
    return awaitsTriage(m);
  }

  /** Template alias: is this topic waiting for the admin's sign-off? */
  inReview(m: FeedbackRow): boolean {
    return awaitsReview(m, this.threads().get(m.id));
  }

  continuedAfterShip(m: FeedbackRow): boolean {
    return isContinuedAfterShip(m, this.threads().get(m.id));
  }

  /** The routine's newest reply — the open question the sheet answers. */
  lastSystemMessage(m: FeedbackRow): FeedbackMessage | null {
    const replies = this.messagesFor(m.id);
    for (let i = replies.length - 1; i >= 0; i--) {
      if (replies[i].is_system) return replies[i];
      // A human reply after the routine's means the question was answered.
      return null;
    }
    return null;
  }

  /** ISO time the "Du bist dran" card has been waiting since. */
  waitingSinceIso(m: FeedbackRow): string {
    return new Date(waitingSince(m, this.threads().get(m.id))).toISOString();
  }

  /** ISO time of the topic's latest activity (own timestamps or last reply). */
  lastActivityIso(m: FeedbackRow): string {
    return new Date(this.recencyTime(m)).toISOString();
  }

  private recencyTime(m: FeedbackRow): number {
    const replies = this.threads().get(m.id);
    const lastReply = replies && replies.length ? replies[replies.length - 1].created_at : null;
    let max = 0;
    for (const c of [m.created_at, m.updated_at, m.processed_at, lastReply]) {
      const t = timeOf(c);
      if (t > max) max = t;
    }
    return max;
  }

  // ---- Bands -------------------------------------------------------------------

  /** Everything that passes the sheet's filters — the bands split this. */
  private readonly filtered = computed(() =>
    this.messages().filter((m) => this.matchesWho(m) && this.matchesWhere(m) && this.matchesArea(m)),
  );

  /**
   * Band 1: what waits on the admin — releases first (feedback 89925995: a user
   * topic nobody released is blocked outright, nothing at all happens to it
   * until an admin acts), then longest wait first.
   */
  readonly yourTurn = computed(() =>
    this.filtered()
      .filter((m) => this.turnOf(m) === 'admin')
      .sort((a, b) => {
        const ra = this.askOf(a) === 'release' ? 0 : 1;
        const rb = this.askOf(b) === 'release' ? 0 : 1;
        return ra - rb || waitingSince(a, this.threads().get(a.id)) - waitingSince(b, this.threads().get(b.id));
      }),
  );

  /** Band 2: the routine's pile and the questions parked at a user, newest activity first. */
  readonly running = computed(() =>
    this.filtered()
      .filter((m) => {
        const t = this.turnOf(m);
        return t === 'routine' || t === 'user';
      })
      .sort((a, b) => this.recencyTime(b) - this.recencyTime(a)),
  );

  /** Band 3: done work by day, newest day first. */
  readonly deliveredDays = computed<DeliveredDay[]>(() => deliveredByDay(this.filtered(), this.threads()));
  readonly deliveredCount = computed(() => this.deliveredDays().reduce((n, d) => n + d.items.length, 0));

  /** How many days of the feed are unrolled; "n weitere Tage" adds a page. */
  private readonly deliveredDaysShown = signal(DELIVERED_DAYS_PAGE);
  readonly visibleDeliveredDays = computed(() => this.deliveredDays().slice(0, this.deliveredDaysShown()));
  readonly hiddenDeliveredDays = computed(() => Math.max(0, this.deliveredDays().length - this.deliveredDaysShown()));

  showMoreDays(): void {
    this.deliveredDaysShown.update((n) => n + DELIVERED_DAYS_PAGE);
  }

  /**
   * When the admin last looked at the Geliefert band — read once at open, so
   * everything that finished since then wears the "neu" marker for this whole
   * visit, and written now, so the next visit compares against this one.
   */
  private readonly lastSeenDelivered = signal(this.readLastSeen());
  readonly newDeliveredCount = computed(() => {
    const seen = this.lastSeenDelivered();
    let n = 0;
    for (const d of this.deliveredDays()) for (const m of d.items) if (isNewSince(m, seen)) n++;
    return n;
  });

  isNew(m: FeedbackRow): boolean {
    return this.delivered(m) && isNewSince(m, this.lastSeenDelivered());
  }

  /** Template alias: does this topic belong in the Geliefert feed? */
  delivered(m: FeedbackRow): boolean {
    return isDelivered(m, this.threads().get(m.id));
  }

  private readLastSeen(): number {
    try {
      const raw = localStorage.getItem(LAST_SEEN_KEY);
      const t = raw ? Number(raw) : 0;
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }

  private stampLastSeen(): void {
    if (!this.consent.preferencesAllowed()) return;
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {
      /* private mode / quota */
    }
  }

  /** Bands the admin folded away — session-local, a glance, not a preference. */
  private readonly _collapsedBands = signal<Set<FeedbackTurn>>(new Set());

  bandCollapsed(turn: FeedbackTurn): boolean {
    return this._collapsedBands().has(turn);
  }

  toggleBand(turn: FeedbackTurn): void {
    // Unrolling the Geliefert band counts as having looked at it.
    if (turn === 'nobody' && this.bandCollapsed(turn)) this.stampLastSeen();
    this._collapsedBands.update((set) => {
      const next = new Set(set);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  }

  /** Day heading: Today / Yesterday for the two most recent days, else a localized date. */
  dayLabel(dayStart: number): string {
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const today = startOf(new Date());
    const DAY_MS = 86_400_000;
    if (dayStart === today) return this.translate.instant('adminFeedback.dateGroup.today');
    if (dayStart === today - DAY_MS) return this.translate.instant('adminFeedback.dateGroup.yesterday');
    return formatScDate(new Date(dayStart), { language: this.locale.language(), region: this.locale.region() });
  }

  // ---- Search ------------------------------------------------------------------

  /** Raw search input. Blank (or punctuation-only) means "no search active". */
  readonly searchQuery = signal('');
  readonly searchActive = computed(() => searchTokens(this.searchQuery()).length > 0);

  private readonly searchHits = computed<ReadonlyMap<string, FeedbackSearchHit>>(() => {
    const query = this.searchQuery();
    if (!this.searchActive()) return new Map();
    const hits = new Map<string, FeedbackSearchHit>();
    for (const hit of searchFeedback(this.messages(), this.threads(), query)) hits.set(hit.row.id, hit);
    return hits;
  });

  /** Hits, filters applied, relevance first — whichever band they live in. */
  readonly searchResults = computed(() =>
    this.filtered()
      .filter((m) => this.searchHits().has(m.id))
      .sort((a, b) => (this.searchHits().get(b.id)?.score ?? 0) - (this.searchHits().get(a.id)?.score ?? 0)),
  );

  /** A hit that only matched inside the thread — worth flagging in the row. */
  threadOnlyHit(m: FeedbackRow): boolean {
    const hit = this.searchHits().get(m.id);
    return !!hit && hit.inThread && !hit.inBody;
  }

  setSearch(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.setSearch('');
  }

  // ---- Filters (the sheet) --------------------------------------------------

  readonly filtersOpen = signal(false);
  openFilters(): void { this.filtersOpen.set(true); this.focusSheet(); }
  closeFilters(): void {
    if (!this.filtersOpen()) return;
    this.filtersOpen.set(false);
    this.returnFocus();
  }

  readonly whoFilter = signal<WhoFilter>('all');
  readonly whereFilter = signal<FeedbackBucket | null>(null);
  readonly areaFilter = signal<FeedbackArea | null>(null);

  readonly filterCount = computed(
    () => (this.whoFilter() === 'all' ? 0 : 1) + (this.whereFilter() === null ? 0 : 1) + (this.areaFilter() === null ? 0 : 1),
  );

  whoIs(w: 'all' | 'mine' | 'others' | 'users'): boolean {
    return this.whoFilter() === w;
  }

  whoIsAuthor(id: string): boolean {
    const w = this.whoFilter();
    return typeof w === 'object' && w.authorId === id;
  }

  setWho(w: 'all' | 'mine' | 'others' | 'users'): void {
    this.whoFilter.set(w);
  }

  setWhoAuthor(id: string): void {
    this.whoFilter.update((cur) => (typeof cur === 'object' && cur.authorId === id ? 'all' : { authorId: id }));
  }

  setWhere(b: FeedbackBucket | null): void {
    this.whereFilter.set(b);
  }

  setArea(a: FeedbackArea | null): void {
    this.areaFilter.set(a);
  }

  resetFilters(): void {
    this.whoFilter.set('all');
    this.whereFilter.set(null);
    this.areaFilter.set(null);
  }

  /** Sentinel author key for topics with no author (orphaned rows). */
  private static readonly NO_AUTHOR = '__none__';

  private matchesWho(m: FeedbackRow): boolean {
    const w = this.whoFilter();
    if (w === 'all') return true;
    if (w === 'users') return isUserSubmitted(m);
    // A release step is nobody's topic and therefore everybody's job (feedback
    // 89925995): it shows under "Meine" and "Andere" alike.
    if (w === 'mine') return awaitsTriage(m) || (!isUserSubmitted(m) && !!m.author_id && m.author_id === this.selfId());
    if (w === 'others') return awaitsTriage(m) || (!isUserSubmitted(m) && m.author_id !== this.selfId());
    return (m.author_id ?? AdminFeedbackComponent.NO_AUTHOR) === w.authorId;
  }

  private matchesWhere(m: FeedbackRow): boolean {
    const f = this.whereFilter();
    return f === null || this.bucketOf(m) === f;
  }

  private matchesArea(m: FeedbackRow): boolean {
    const f = this.areaFilter();
    return f === null || asFeedbackArea(m.area) === f;
  }

  /**
   * Distinct authors, most-topics first — the "Wer?" rows. Carries a sample
   * row, not a label: the label is translated in the template so a language
   * switch re-renders it like every other string.
   */
  readonly authorOptions = computed(() => {
    const seen = new Map<string, { id: string; row: FeedbackRow; count: number }>();
    for (const m of this.messages()) {
      const id = m.author_id ?? AdminFeedbackComponent.NO_AUTHOR;
      const existing = seen.get(id);
      if (existing) existing.count++;
      else seen.set(id, { id, row: m, count: 1 });
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  });

  /** "Wo steht es?" — every bucket that holds something, in path order. */
  readonly whereOptions = computed(() => {
    const order: FeedbackBucket[] = [
      'awaiting_admin', 'review', 'todo', 'in_progress', 'awaiting_author', 'shipped', 'issue_created', 'declined', 'rejected',
    ];
    const counts = new Map<FeedbackBucket, number>();
    for (const m of this.messages()) {
      const b = this.bucketOf(m);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return order
      .filter((b) => (counts.get(b) ?? 0) > 0)
      .map((b) => ({ bucket: b, count: counts.get(b) ?? 0, labelKey: this.whereLabelKey(b) }));
  });

  private whereLabelKey(b: FeedbackBucket): string {
    switch (b) {
      case 'awaiting_admin': return 'adminFeedback.ask.question';
      case 'review': return 'adminFeedback.ask.review';
      case 'todo': return 'adminFeedback.station.queued';
      case 'in_progress': return 'adminFeedback.station.work';
      case 'awaiting_author': return 'adminFeedback.turn.user';
      case 'shipped': return 'adminFeedback.status.shipped';
      case 'issue_created': return 'adminFeedback.station.issue';
      case 'declined': return 'adminFeedback.station.declined';
      default: return 'adminFeedback.station.rejected';
    }
  }

  /** "Bereich" — every area that holds something, in the picker's order. */
  readonly areaOptions = computed(() => {
    const counts = new Map<FeedbackArea, number>();
    for (const m of this.messages()) {
      const a = asFeedbackArea(m.area);
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return FEEDBACK_AREAS.filter((a) => (counts.get(a) ?? 0) > 0).map((a) => ({ area: a, count: counts.get(a) ?? 0 }));
  });

  /** Something in the user half still waits for its release to the routine. */
  readonly untriagedWaiting = computed(() =>
    this.messages().some((m) => awaitsTriage(m) && !isArchived(m, this.threads().get(m.id))),
  );

  // ---- Motion state (admin feedback cf74472a) --------------------------------

  /**
   * Rows that changed band since the previous poll (or are brand new to the
   * board), keyed by id, with the band they landed in. A card in this set
   * wears the one-time `arrived` glow — the board's way of saying "this one
   * is new HERE" without a banner: a Rückfrage that just landed in Du bist
   * dran, a ship that just reached Geliefert, the topic the admin just
   * filed. Cleared after {@link HIGHLIGHT_MS}, so the next poll cannot
   * replay it. The first load seeds the snapshot and highlights nothing.
   */
  private readonly _arrived = signal<ReadonlyMap<string, FeedbackTurn>>(new Map());
  private arrivedTimer: ReturnType<typeof setTimeout> | null = null;

  arrived(id: string): boolean {
    return this._arrived().has(id);
  }

  /** The band's count badge beats once when something just arrived in it. */
  bandPulse(turn: FeedbackTurn): boolean {
    for (const t of this._arrived().values()) if (t === turn) return true;
    return false;
  }

  /** Rows whose sign-off was just taken ON the card (they stay where they are). */
  private readonly _settled = signal<ReadonlySet<string>>(new Set());

  settled(id: string): boolean {
    return this._settled().has(id);
  }

  /** Where every row stood at the previous poll; `null` until the first load. */
  private turnsSeen: Map<string, FeedbackTurn> | null = null;

  /**
   * Diff the bands against the previous poll and mark what moved. Called from
   * {@link refresh} once rows AND threads are in, because the band is a
   * function of both (a continuation is read off the thread).
   */
  private detectArrivals(rows: readonly FeedbackRow[]): void {
    const now = new Map<string, FeedbackTurn>();
    for (const r of rows) now.set(r.id, this.turnOf(r));
    const before = this.turnsSeen;
    this.turnsSeen = now;
    if (before === null) return;
    const moved = new Map<string, FeedbackTurn>();
    for (const [id, turn] of now) if (before.get(id) !== turn) moved.set(id, turn);
    if (moved.size === 0) return;
    this._arrived.update((prev) => new Map([...prev, ...moved]));
    if (this.arrivedTimer) clearTimeout(this.arrivedTimer);
    this.arrivedTimer = setTimeout(() => {
      this.arrivedTimer = null;
      this._arrived.set(new Map());
    }, HIGHLIGHT_MS);
  }

  /** The DOM node of a row in the stream (the Geliefert copy when `feed`). */
  private cardEl(id: string, feed = false): HTMLElement | null {
    const domId = feed ? `${this.cardDomId(id)}-feed` : this.cardDomId(id);
    return this.host.nativeElement.querySelector<HTMLElement>(`#${CSS.escape(domId)}`);
  }

  /**
   * Fold a row out of the stream while its write is on the wire: close the
   * sheet first (the stream is hidden behind it), bring the row into view,
   * then collapse it. Resolves with the element so a failed write can put it
   * back. The row is NOT removed from the data here — the refresh after the
   * write does that, and by then the fold has already closed the gap.
   */
  private async foldOut(id: string): Promise<HTMLElement | null> {
    if (this.openId() === id) this.closeTopic();
    // The sheet's @if has to unrender before the stream can be scrolled.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const el = this.cardEl(id) ?? this.cardEl(id, true);
    this.motion.reveal(el);
    await this.motion.collapse(el);
    return el;
  }

  // ---- The opened topic (full-panel sheet) ----------------------------------

  private readonly openId = signal<string | null>(null);
  readonly openRow = computed(() => {
    const id = this.openId();
    return id ? (this.messages().find((m) => m.id === id) ?? null) : null;
  });

  /** Any sheet over the stream — the stream hides behind it. */
  readonly overlayOpen = computed(() => this.openRow() !== null || this.filtersOpen() || this.declineTopicRow() !== null);

  openTopic(id: string): void {
    this.openId.set(id);
    this.focusSheet();
    // Reading a delivered topic counts as having looked at the feed.
    const row = this.messages().find((m) => m.id === id);
    if (row && this.delivered(row)) this.stampLastSeen();
  }

  /**
   * A deep link inside the panel routed the app underneath. On a phone the
   * sheet covers the page it just opened, so the shell has to get out of the
   * way (#517). Modified clicks open a new tab and are left alone — the
   * boolean result lets a template chain `&& closeTopic()` behind it.
   */
  onViewInApp(event: MouseEvent): boolean {
    if (!isPlainLeftClick(event)) return false;
    this.panelNav.notifyInAppNavigation();
    return true;
  }

  closeTopic(): void {
    if (this.openId() === null) return;
    this.openId.set(null);
    this._moreOpen.set(new Set());
    this.returnFocus();
  }

  /**
   * Escape closes the top-most sheet — and stops there. The FAB shell listens
   * for Escape on the document to step the panel down (maximized → docked →
   * minimized); with a sheet open that key belongs to the sheet, and since this
   * host sits inside the panel its listener runs first.
   */
  @HostListener('keydown.escape', ['$event'])
  onEscape(ev: Event): void {
    if (this._moreOpen().size > 0) this._moreOpen.set(new Set());
    else if (this.declineTopicRow()) this.cancelDeclineForm();
    else if (this.filtersOpen()) this.closeFilters();
    else if (this.openRow()) this.closeTopic();
    else return;
    ev.stopPropagation();
    ev.preventDefault();
  }

  /** Where the keyboard was before a sheet opened — it goes back there on close. */
  private readonly _returnFocus: HTMLElement[] = [];

  /** Put the keyboard into the sheet that just opened (the TOP sheet's back button). */
  private focusSheet(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement) this._returnFocus.push(active);
    requestAnimationFrame(() => {
      const sheets = this.host.nativeElement.querySelectorAll<HTMLElement>('.sheet');
      sheets[sheets.length - 1]?.querySelector<HTMLElement>('.sh-btn')?.focus();
    });
  }

  /** Hand the keyboard back to whatever opened the sheet that just closed. */
  private returnFocus(): void {
    const el = this._returnFocus.pop();
    if (el && el.isConnected) requestAnimationFrame(() => el.focus());
  }

  /**
   * The thread as the sheet shows it: the newest message always, everything
   * before it behind "…" that reveals one more message per tap, from the newest
   * backwards (round-1 feedback: "immer eine weitere Nachricht dazwischen").
   */
  private readonly _revealed = signal<ReadonlyMap<string, number>>(new Map());

  private foldView<T>(key: string, all: readonly T[]): { key: string; shown: T[]; hiddenCount: number; revealed: number; total: number } {
    if (all.length === 0) return { key, shown: [], hiddenCount: 0, revealed: 0, total: 0 };
    const revealed = Math.min(this._revealed().get(key) ?? 0, all.length - 1);
    const shownFrom = all.length - 1 - revealed;
    return { key, shown: all.slice(shownFrom), hiddenCount: shownFrom, revealed, total: all.length };
  }

  threadView(id: string) {
    return this.foldView(`thread:${id}`, this.messagesFor(id));
  }

  authorView(id: string) {
    return this.foldView(`author:${id}`, this.authorMessagesFor(id));
  }

  revealOne(key: string): void {
    this._revealed.update((map) => {
      const next = new Map(map);
      next.set(key, (map.get(key) ?? 0) + 1);
      return next;
    });
  }

  hideRevealed(key: string): void {
    this._revealed.update((map) => {
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }

  /** Sent messages longer than three lines fold; these are the ones unfolded. */
  private readonly _longOpen = signal<Set<string>>(new Set());

  isLongBody(body: string): boolean {
    return isLongMessage(body);
  }

  isLongOpen(id: string): boolean {
    return this._longOpen().has(id);
  }

  /** Clamp this message: it is long and the admin has not unfolded it. */
  isLong(id: string, body: string): boolean {
    return this.isLongBody(body) && !this.isLongOpen(id);
  }

  toggleLong(id: string): void {
    this._longOpen.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Topics whose ⋯ menu is open. */
  private readonly _moreOpen = signal<Set<string>>(new Set());

  moreOpen(id: string): boolean {
    return this._moreOpen().has(id);
  }

  toggleMore(id: string): void {
    this._moreOpen.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** A routine message without its `[[A|B]]` line — the buttons say it instead. */
  questionText(body: string): string {
    return parseAnswerOptions(body)?.text ?? body;
  }

  /** One-tap answers the routine offered in its newest question, if any. */
  answerOptionsFor(m: FeedbackRow): AnswerOptions | null {
    if (this.askOf(m) !== 'question') return null;
    const q = this.lastSystemMessage(m);
    return q ? parseAnswerOptions(q.body) : null;
  }

  /** True while a one-tap answer is being posted — a double tap must not post twice. */
  readonly answering = signal(false);

  async answerWithOption(m: FeedbackRow, option: string): Promise<void> {
    if (this.answering()) return;
    this.answering.set(true);
    try {
      await this.sendReply(m.id, { text: option, images: [] });
    } finally {
      this.answering.set(false);
    }
  }

  /** The deep link into the app for a topic's area, or null when it has none. */
  areaLink(m: FeedbackRow): string | null {
    return areaRoute(asFeedbackArea(m.area));
  }

  // ---- Avatars --------------------------------------------------------------

  toneOf(a: FeedbackAuthor | null | undefined): AvatarTone {
    if (a?.role === 'admin') return 'adm';
    if (a?.role === 'collaborator') return 'col';
    return 'usr';
  }

  roleTitle(a: FeedbackAuthor | null | undefined): string {
    const role = a?.role === 'admin' || a?.role === 'collaborator' ? a.role : 'viewer';
    const name = a?.display_name || (a?.username ? `@${a.username}` : '');
    const roleLabel = this.translate.instant(`adminFeedback.role.${role}`);
    return name ? `${name} · ${roleLabel}` : roleLabel;
  }

  initials(a: FeedbackAuthor | null | undefined, self: boolean): string {
    const name = a?.display_name || a?.username || '';
    if (!name) return '?';
    const parts = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const second = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? '');
    return (first + second).toUpperCase();
  }

  // ---- Misc template helpers --------------------------------------------------

  render(body: string): RenderedFeedbackBody {
    return renderFeedbackBody(body);
  }

  authorLabel(m: FeedbackRow): string {
    if (m.author_id && m.author_id === this.selfId()) return this.translate.instant('adminFeedback.you');
    return m.author?.display_name
      ?? (m.author?.username ? `@${m.author.username}` : null)
      ?? this.translate.instant('adminFeedback.unknownUser');
  }

  authorLabelFor(msg: FeedbackMessage): string {
    if (msg.is_system) return this.translate.instant('adminFeedback.kind.ai');
    if (msg.author_id && msg.author_id === this.selfId()) return this.translate.instant('adminFeedback.you');
    return msg.author?.display_name
      ?? (msg.author?.username ? `@${msg.author.username}` : null)
      ?? this.translate.instant('adminFeedback.unknownUser');
  }

  /**
   * What a row is CALLED in the UI: the routine's one-line summary when it has
   * written one, the body-derived title otherwise (feedback d08f1983). Every
   * head goes through here so a summarised topic and an unsummarised one are
   * never titled by two different rules.
   */
  cardTitle(m: FeedbackRow, max?: number): string {
    return displayTitle(m, max);
  }


  topicNo(m: FeedbackRow): number | null {
    return topicNumber(m);
  }

  cardDomId(id: string): string {
    return `fb-card-${id}`;
  }

  areaOf(m: FeedbackRow): FeedbackArea | null {
    return asFeedbackArea(m.area);
  }

  areaLabelKey(area: FeedbackArea): string {
    return feedbackAreaLabelKey(area);
  }

  authorFacingStatus(m: FeedbackRow): AuthorFeedbackStatus {
    return coarseAuthorStatus(m.status);
  }

  // ---- Lifecycle -------------------------------------------------------------

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
    inject(DestroyRef).onDestroy(() => this.stampLastSeen());
  }

  async ngOnInit() {
    purgeRetiredKeys();
    await this.refresh();
    // The marker compares against the previous visit; this one starts now.
    this.stampLastSeen();
  }

  // ---- Data --------------------------------------------------------------

  async refresh() {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client
      .from('admin_feedback')
      // `author.role` colours the avatar; admins may read every profile
      // (policy profiles_admin_read_all), so no projection is needed.
      .select('id, seq, author_id, body, status, ship_ref, processing_note, created_at, updated_at, shipped_at, processed_at, reviewed_at, source, triaged, decision_note, area, summary, complex, author:profiles(display_name, username, role)')
      .order('created_at', { ascending: true });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      const rows = (data ?? []) as unknown as FeedbackRow[];
      this.messages.set(rows);
      await this.loadThreads(rows.map((r) => r.id));
      await this.loadAuthorThreads(rows.filter(isUserSubmitted).map((r) => r.id));
      this.detectShipped(rows);
      this.detectArrivals(rows);
    }
    this.busy.set(false);
  }

  private async loadThreads(feedbackIds: string[]): Promise<void> {
    if (feedbackIds.length === 0) {
      this.threads.set(new Map());
      return;
    }
    const { data, error } = await this.sb.client
      .from('admin_feedback_messages')
      .select('id, feedback_id, author_id, is_system, body, created_at, author:profiles(display_name, username, role)')
      .in('feedback_id', feedbackIds)
      .order('created_at', { ascending: true });
    // Threads are additive — a load failure must not blank the board.
    if (error) return;
    const grouped = new Map<string, FeedbackMessage[]>();
    for (const row of (data ?? []) as unknown as FeedbackMessage[]) {
      const list = grouped.get(row.feedback_id) ?? [];
      list.push(row);
      grouped.set(row.feedback_id, list);
    }
    this.threads.set(grouped);
  }

  /** Shipped ids as of the previous refresh; `null` until the first load lands. */
  private shippedSeen: Set<string> | null = null;

  /**
   * A topic shipped between two polls: the confetti burst stays (it is the
   * celebration), the banner is gone — the Geliefert band's "neu" marker is
   * the durable version of that news.
   */
  private detectShipped(rows: readonly FeedbackRow[]): void {
    const now = new Set(rows.filter((r) => r.status === 'shipped').map((r) => r.id));
    const before = this.shippedSeen;
    this.shippedSeen = now;
    if (before === null) return;
    for (const id of now) {
      if (!before.has(id)) {
        this.celebration.burst();
        return;
      }
    }
  }

  // ---- Author channel (user-submitted topics) ------------------------------

  readonly authorThreads = signal<AuthorThreadMap>(new Map());

  private async loadAuthorThreads(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      this.authorThreads.set(new Map());
      return;
    }
    const { data, error } = await this.sb.client
      .from('feedback_author_messages')
      .select('id, feedback_id, author_id, from_admin, is_question, body, created_at')
      .in('feedback_id', ids)
      .order('created_at', { ascending: true });
    if (error) return;
    this.authorThreads.set(groupAuthorMessages((data ?? []) as unknown as AuthorFeedbackMessage[]));
  }

  authorMessagesFor(id: string): AuthorFeedbackMessage[] {
    return this.authorThreads().get(id) ?? [];
  }

  // ---- Composer submit handlers ------------------------------------------

  private uploadImages(images: PendingImage[]): Promise<string[]> {
    // `true` = the admin board may carry any file type (admin feedback
    // 312a4acc). Every non-admin send path leaves the flag at its default and
    // is refused a non-image before a request is made; the storage policy in
    // migration 20260904040000 refuses it again server-side.
    return uploadFeedbackImages(this.sb.client, this.selfId(), images, true);
  }

  private buildBody(text: string, images: PendingImage[], urls: string[]): string {
    return buildFeedbackBody(text, images, urls);
  }

  readonly createTopicBound = (payload: ComposerPayload): Promise<boolean> => this.createTopic(payload);

  /** Docked panel: the new-topic composer is collapsed to a bar by default. */
  readonly composerOpen = signal(false);
  openComposer(): void { this.composerOpen.set(true); }
  /**
   * A page seeded the new-topic box and asked for it (see
   * `FeedbackComposerSeedService`): unfold the docked composer so the seeded
   * draft is on screen. The full board's composer is always mounted, so the
   * request is a no-op there and the seed is taken on its own.
   */
  private seenOpenRequests = 0;
  private readonly seedOpen = effect(() => {
    const n = this.seeds.openRequests();
    if (n === this.seenOpenRequests) return;
    this.seenOpenRequests = n;
    if (untracked(() => this.embedded())) this.composerOpen.set(true);
  });
  closeComposer(): void { this.composerOpen.set(false); }

  readonly createComposerBound = async (payload: ComposerPayload): Promise<boolean> => {
    const ok = await this.createTopic(payload);
    if (ok) this.composerOpen.set(false);
    return ok;
  };

  async createTopic(payload: ComposerPayload): Promise<boolean> {
    const uid = this.selfId();
    if (!uid) return false;
    this.errorMsg.set(null);
    let body: string;
    try {
      body = this.buildBody(payload.text, payload.images, await this.uploadImages(payload.images));
    } catch {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.uploadError'));
      return false;
    }
    if (!body) return false;
    const { error } = await this.sb.client
      .from('admin_feedback')
      .insert({ body, author_id: uid, area: payload.area ?? null, complex: payload.complex ?? false });
    if (error) {
      this.errorMsg.set(error.message);
      return false;
    }
    await this.refresh();
    return true;
  }

  private readonly threadScopes = new Map<string, string>();
  private readonly authorScopes = new Map<string, string>();

  threadScope(feedbackId: string): string {
    return memoScope(this.threadScopes, feedbackId, draftScopes.adminThread);
  }

  authorScope(feedbackId: string): string {
    return memoScope(this.authorScopes, feedbackId, draftScopes.adminAuthor);
  }

  /** Post a human reply into a topic's thread. Returns true once persisted. */
  async sendReply(feedbackId: string, payload: ComposerPayload): Promise<boolean> {
    const uid = this.selfId();
    if (!uid) return false;
    this.errorMsg.set(null);
    let body: string;
    try {
      body = this.buildBody(payload.text, payload.images, await this.uploadImages(payload.images));
    } catch {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.uploadError'));
      return false;
    }
    if (!body) return false;
    const { error } = await this.sb.client
      .from('admin_feedback_messages')
      .insert({ feedback_id: feedbackId, author_id: uid, is_system: false, body });
    if (error) {
      this.errorMsg.set(error.message);
      return false;
    }
    await this.refresh();
    return true;
  }

  // ---- Issue hand-off ------------------------------------------------------

  /** "Issue erstellen" — an ORDER to the routine, written into the thread. */
  async requestIssue(m: FeedbackRow): Promise<void> {
    const uid = this.selfId();
    if (!uid) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const body = `${ISSUE_REQUEST_MARKER} ${this.translate.instant('adminFeedback.issue.requestBody')}`;
    const { error } = await this.sb.client
      .from('admin_feedback_messages')
      .insert({ feedback_id: m.id, author_id: uid, is_system: false, body });
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  /** Take the order back while the routine has not delivered — deleting the message is the whole undo. */
  async undoIssueRequest(m: FeedbackRow): Promise<void> {
    const msg = this.issueRequest(m);
    if (!msg) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.from('admin_feedback_messages').delete().eq('id', msg.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  issueRequest(m: FeedbackRow): FeedbackMessage | null {
    return pendingIssueRequest(m, this.threads().get(m.id));
  }

  issueRequested(m: FeedbackRow): boolean {
    return this.issueRequest(m) !== null;
  }

  // ---- Review gate ----------------------------------------------------------

  /**
   * The sign-off (admin feedback cf74472a: "wenn man in ein issue rein geht
   * und auf abgenommen klickt, sollte man direkt danach wieder in die
   * übersicht zurückkehren und das issue dort sich weg animieren"). Taken from
   * inside the topic, the sheet closes at once and the row folds out of Du
   * bist dran while the write travels; the refresh then lets it arrive in
   * Geliefert with the one-time glow. Taken on the Geliefert card itself,
   * the row has nowhere to go — it settles with one ring and loses its ✓.
   * A failed write puts the folded row back and shows the error.
   */
  async acceptReview(m: FeedbackRow): Promise<void> {
    const patch = { reviewed_at: new Date().toISOString() };
    const onCard = this.openId() !== m.id && this.delivered(m);
    if (onCard) {
      this._settled.update((s) => new Set(s).add(m.id));
      setTimeout(() => this._settled.update((s) => {
        const next = new Set(s);
        next.delete(m.id);
        return next;
      }), HIGHLIGHT_MS);
      await this.writeReview(m, patch);
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    const write = this.sb.client.from('admin_feedback').update(patch).eq('id', m.id);
    const [{ error }, el] = await Promise.all([write, this.foldOut(m.id)]);
    if (error) {
      this.motion.restore(el);
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
    // The poll did not move it after all (still waiting): unfold, do not hide.
    if (this.yourTurn().some((r) => r.id === m.id)) this.motion.restore(el);
  }

  /**
   * The reply IS the reopen (admin feedback 187574ed). There is no "Gespräch
   * wieder aufnehmen" button any more — it asked for a click to reach the box
   * the admin is already looking at — so writing into a finished topic carries
   * the reopen, exactly as `docs/feedback-routine.md` ("Contract" /
   * "Post-ship review & continue") describes it: reply first, reopen second.
   *
   * Only a topic that is actually OUT of the work loop is reopened. A `shipped`
   * row the admin already continued is back in the queue through query (d) and
   * must keep its status; an `open`/`in_progress` row was never gone. Note the
   * decision is taken BEFORE the reply lands — afterwards every topic looks
   * like a continuation, because the newest message is the admin's.
   */
  sheetReplySubmitFor(feedbackId: string): (p: ComposerPayload) => Promise<boolean> {
    let fn = this.sheetReplySubmitters.get(feedbackId);
    if (!fn) {
      fn = async (p: ComposerPayload) => {
        const row = this.messages().find((m) => m.id === feedbackId);
        if (!row) return this.sendReply(feedbackId, p);
        const finished = this.archived(row) || this.inReview(row);
        return finished ? this.reopenWithReply(row, p) : this.sendReply(feedbackId, p);
      };
      this.sheetReplySubmitters.set(feedbackId, fn);
    }
    return fn;
  }

  private readonly sheetReplySubmitters = new Map<
    string,
    (p: ComposerPayload) => Promise<boolean>
  >();

  /**
   * Post the steer into the thread, THEN put the topic back into the routine's
   * queue. In this order on purpose — if the reply fails nothing is reopened,
   * and if the reopen fails the admin's words are already saved; the routine
   * then finds a reopened topic *with* the reason in the thread, which is
   * exactly what its continuation path reads.
   */
  async reopenWithReply(m: FeedbackRow, payload: ComposerPayload): Promise<boolean> {
    if (!(await this.sendReply(m.id, payload))) return false;
    await this.reopenFromReview(m);
    return true;
  }

  /**
   * Put the topic back into the work loop — `open` IS the routine's queue;
   * `ship_ref` stays as the history of what was tried.
   */
  async reopenFromReview(m: FeedbackRow): Promise<void> {
    await this.writeReview(m, {
      status: 'open',
      reviewed_at: null,
      processing_note: null,
      processed_at: null,
    });
  }

  private async writeReview(m: FeedbackRow, patch: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.from('admin_feedback').update(patch).eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  // ---- User-submitted topics: triage, ask the author, decline ---------------

  async releaseToRoutine(m: FeedbackRow): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.from('admin_feedback').update({ triaged: true }).eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  private readonly _asksAuthor = signal<Set<string>>(new Set());

  asksAuthor(id: string): boolean {
    return this._asksAuthor().has(id);
  }

  toggleAskAuthor(id: string): void {
    this._asksAuthor.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  private toggleAskAuthorOff(id: string): void {
    if (!this.asksAuthor(id)) return;
    this._asksAuthor.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  private readonly authorReplySubmitters = new Map<string, (p: ComposerPayload) => Promise<boolean>>();

  authorReplySubmitFor(feedbackId: string): (p: ComposerPayload) => Promise<boolean> {
    let fn = this.authorReplySubmitters.get(feedbackId);
    if (!fn) {
      fn = (p: ComposerPayload) => this.sendAuthorMessage(feedbackId, p);
      this.authorReplySubmitters.set(feedbackId, fn);
    }
    return fn;
  }

  async sendAuthorMessage(
    feedbackId: string,
    payload: ComposerPayload,
    asQuestion = this.asksAuthor(feedbackId),
  ): Promise<boolean> {
    const uid = this.selfId();
    if (!uid) return false;
    this.errorMsg.set(null);
    let body: string;
    try {
      body = this.buildBody(payload.text, payload.images, await this.uploadImages(payload.images));
    } catch {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.uploadError'));
      return false;
    }
    if (!body) return false;
    const { error } = await this.sb.client.from('feedback_author_messages').insert({
      feedback_id: feedbackId,
      author_id: uid,
      from_admin: true,
      is_question: asQuestion,
      body,
    });
    if (error) {
      this.errorMsg.set(error.message);
      return false;
    }
    this.toggleAskAuthorOff(feedbackId);
    await this.refresh();
    return true;
  }

  /** Topic id whose "nicht umsetzen" sheet is open (null = none). */
  readonly declineFormFor = signal<string | null>(null);
  readonly declineTopicRow = computed(() => {
    const id = this.declineFormFor();
    return id ? (this.messages().find((m) => m.id === id) ?? null) : null;
  });
  readonly declineNote = signal('');
  readonly declineReasons: readonly { id: DeclineReasonId; labelKey: string }[] =
    DECLINE_REASONS.map((id) => ({ id, labelKey: declineReasonLabelKey(id) }));
  readonly declineReason = signal<DeclineReasonId | null>(null);

  openDeclineForm(m: FeedbackRow): void {
    this.declineNote.set('');
    this.declineReason.set(null);
    this.declineFormFor.set(m.id);
    this._moreOpen.set(new Set());
    this.focusSheet();
  }

  cancelDeclineForm(): void {
    const wasOpen = this.declineFormFor() !== null;
    this.declineFormFor.set(null);
    this.declineNote.set('');
    this.declineReason.set(null);
    if (wasOpen) this.returnFocus();
  }

  pickDeclineReason(id: DeclineReasonId): void {
    if (this.declineReason() === id) {
      this.declineNote.set('');
      this.declineReason.set(null);
      return;
    }
    this.declineNote.set(this.translate.instant(declineReasonTextKey(id)));
    this.declineReason.set(id);
  }

  /** The shared feedback length cap (admin feedback 0a0fad31). */
  readonly maxChars = FEEDBACK_MAX_CHARS;

  /**
   * Keep the DOM and the signal in step under the cap: writing the clamped text
   * back is what makes a DROP past `maxlength` actually disappear from the field.
   */
  onDeclineInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    const capped = clampFeedbackText(el.value);
    if (el.value !== capped) {
      const caret = Math.min(el.selectionStart ?? capped.length, capped.length);
      el.value = capped;
      el.setSelectionRange(caret, caret);
    }
    this.setDeclineNote(capped);
  }

  setDeclineNote(value: string): void {
    const capped = clampFeedbackText(value);
    this.declineNote.set(capped);
    this.declineReason.set(matchDeclineReason(capped, this.declineReasonTexts()));
  }

  private declineReasonTexts(): DeclineReasonTexts {
    const texts: Record<string, string> = {};
    for (const r of this.declineReasons) texts[r.id] = this.translate.instant(declineReasonTextKey(r.id));
    return texts as DeclineReasonTexts;
  }

  async declineTopic(m: FeedbackRow, ev: Event): Promise<void> {
    ev.preventDefault();
    const note = this.declineNote().trim();
    if (!note) {
      this.errorMsg.set(this.translate.instant('adminFeedback.decline.noteRequired'));
      return;
    }
    if (await this.declineWithNote(m, note)) {
      this.cancelDeclineForm();
      this.closeTopic();
    }
  }

  /** The decline itself, without the sheet around it. Resolves true once both parts landed. */
  async declineWithNote(m: FeedbackRow, note: string): Promise<boolean> {
    const uid = this.selfId();
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback')
      .update({ status: 'declined', decision_note: note, processed_at: new Date().toISOString() })
      .eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return false;
    }
    if (uid) {
      await this.sb.client.from('feedback_author_messages').insert({
        feedback_id: m.id,
        author_id: uid,
        from_admin: true,
        is_question: false,
        body: note,
      });
    }
    await this.refresh();
    return true;
  }

  async remove(m: FeedbackRow) {
    if (!window.confirm(this.translate.instant('adminFeedback.deleteConfirm'))) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    // Same exit as the sign-off: back to the stream, and the row folds away.
    const del = this.sb.client.from('admin_feedback').delete().eq('id', m.id);
    const [{ error }, el] = await Promise.all([del, this.foldOut(m.id)]);
    if (error) {
      this.motion.restore(el);
      this.errorMsg.set(error.message);
    }
    await this.refresh();
  }
}
