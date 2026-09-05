import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { useAutoRefresh } from '../../core/auto-refresh';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { RenderedFeedbackBody, renderFeedbackBody } from './markdown.util';
import { FeedbackAttachmentsComponent } from './feedback-attachments.component';
import { ComposerPayload, FeedbackComposerComponent, PendingImage } from './feedback-composer.component';
import { CelebrationService } from './celebration.service';
import { FeedbackDashboardComponent } from './feedback-dashboard.component';
import { RoutineStatusDirective } from './routine-status.directive';
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
  stationIndex,
  stationLabelKey,
  timeOf,
  topicNumber,
  topicTitle,
  turnLabelKey,
  turnOf,
  waitingSince,
} from './feedback.types';
import { buildFeedbackBody, uploadFeedbackImages } from '../../feedback/feedback-images.util';
import { draftScopes, memoScope } from '../../feedback/feedback-draft.types';
import {
  FEEDBACK_AREAS,
  FeedbackArea,
  areaRoute,
  asFeedbackArea,
  feedbackAreaLabelKey,
} from '../../feedback/feedback-area.types';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
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
/** Draft identity of the new-topic composer (see `FeedbackDraftService`). */
const DRAFT_SCOPE = draftScopes.adminNew;
/** Days of the Geliefert band shown before "n weitere Tage anzeigen". */
const DELIVERED_DAYS_PAGE = 3;

/** Role → avatar tint. Anyone without a known role is drawn as a plain user. */
type AvatarTone = 'adm' | 'col' | 'usr';

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [
    ScDatePipe,
    NgTemplateOutlet,
    RouterLink,
    TranslateModule,
    FeedbackAttachmentsComponent,
    FeedbackComposerComponent,
    FeedbackDashboardComponent,
    RoutineStatusDirective,
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
        <!-- Fortschritt, byte-identical, re-homed behind the 📊 glyph. -->
        <div class="topbar">
          <button type="button" class="tb-btn" (click)="setView('stream')">
            ← {{ 'adminFeedback.stream.backToStream' | translate }}
          </button>
          <span class="tb-title">{{ 'adminFeedback.stream.progress' | translate }}</span>
        </div>
        <div class="scroll alt">
          <sc-feedback-dashboard [rows]="messages()" [threads]="threads()" [compact]="embedded()" />
        </div>
      } @else {
        <!-- CONTROLS AT REST: a search field and one Filter button — nothing
             else stands between the admin and the first topic. The 📊 glyph
             is the only other thing here, and it is a door, not a filter. -->
        <div class="topbar">
          <div class="search-box" [class.active]="searchQuery().length > 0">
            <span class="search-icon" aria-hidden="true">&#9099;</span>
            <input
              #searchInput
              type="search"
              autocomplete="off"
              [value]="searchQuery()"
              (input)="setSearch($any($event.target).value)"
              (keydown.escape)="clearSearch(); searchInput.blur()"
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
          <button
            type="button"
            class="tb-btn filter"
            [class.active]="filterCount() > 0"
            (click)="openFilters()"
            [attr.aria-expanded]="filtersOpen()"
            [attr.aria-label]="'adminFeedback.filters.open' | translate">
            <span aria-hidden="true">⚲</span>
            <span class="tb-label">{{ 'adminFeedback.filters.open' | translate }}</span>
            @if (filterCount() > 0) { <span class="tb-count">{{ filterCount() }}</span> }
          </button>
          <button
            type="button"
            class="tb-btn icon"
            (click)="setView('progress')"
            [attr.title]="'adminFeedback.stream.progress' | translate"
            [attr.aria-label]="'adminFeedback.stream.progress' | translate">📊</button>
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
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, lead: false }"></ng-container>
            }
          } @else {
            <!-- BAND 1 · Du bist dran: every Rückfrage, sign-off and release
                 that waits on the admin, longest wait first. The first card
                 opens with its action inline — one click to act. -->
            <section class="band yours">
              <button
                type="button"
                class="band-head"
                (click)="toggleBand('admin')"
                [attr.aria-expanded]="!bandCollapsed('admin')">
                <span class="bh-title">{{ 'adminFeedback.stream.yourTurn' | translate }}</span>
                <span class="bh-count" [class.hot]="yourTurn().length > 0">{{ yourTurn().length }}</span>
                <span class="chev" [class.open]="!bandCollapsed('admin')" aria-hidden="true">▸</span>
              </button>
              @if (!bandCollapsed('admin')) {
                @if (yourTurn().length === 0) {
                  <p class="band-empty">{{ 'adminFeedback.stream.emptyYourTurn' | translate }}</p>
                }
                @for (m of yourTurn(); track m.id; let first = $first) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, lead: first }"></ng-container>
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
                [attr.aria-expanded]="!bandCollapsed('routine')">
                <span class="bh-title">{{ 'adminFeedback.stream.running' | translate }}</span>
                <span class="bh-count">{{ running().length }}</span>
                <span class="chev" [class.open]="!bandCollapsed('routine')" aria-hidden="true">▸</span>
              </button>
              @if (!bandCollapsed('routine')) {
                @if (running().length === 0) {
                  <p class="band-empty">{{ 'adminFeedback.stream.emptyRunning' | translate }}</p>
                }
                @for (m of running(); track m.id) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, lead: false }"></ng-container>
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
                [attr.aria-expanded]="!bandCollapsed('nobody')">
                <span class="bh-title">{{ 'adminFeedback.stream.delivered' | translate }}</span>
                <span class="bh-count">{{ deliveredCount() }}</span>
                @if (newDeliveredCount() > 0) {
                  <span class="bh-new" [attr.title]="'adminFeedback.stream.newSince' | translate">
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
                    <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: m, lead: false }"></ng-container>
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
            [screenshot]="true"
            placeholder="adminFeedback.compose.placeholder"
            sendLabel="adminFeedback.compose.send"
            [onSubmit]="createTopicBound" />
        } @else if (composerOpen()) {
          <div class="compose-sheet sc-nest">
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
              [screenshot]="true"
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
           baton words · area · time. The lead card (first of "Du bist dran")
           carries its action inline; every card opens the full-panel topic. -->
      <ng-template #row let-m let-lead="lead">
        @let turn = turnOf(m);
        @let pos = positionOf(m);
        <article
          class="card sc-card"
          [class.lead]="lead"
          [class.done]="turn === 'nobody'"
          [class.is-new]="isNew(m)"
          [id]="cardDomId(m.id)">
          <button
            type="button"
            class="card-head"
            (click)="openTopic(m.id)"
            [attr.aria-label]="'adminFeedback.stream.openTopic' | translate">
            <ng-container [ngTemplateOutlet]="avatar" [ngTemplateOutletContext]="{ $implicit: m.author, self: m.author_id === selfId() }"></ng-container>
            <span class="ch-body">
              <span class="ch-title-line">
                @if (topicNo(m); as no) {
                  <span class="topic-no" [attr.title]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
                }
                <span class="topic-title">{{ topicTitle(m.body, 96) }}</span>
              </span>
              <span class="ch-meta">
                <ng-container [ngTemplateOutlet]="path" [ngTemplateOutletContext]="{ $implicit: pos }"></ng-container>
                <span class="baton" [class]="'baton t-' + turn">
                  @if (askOf(m); as ask) {
                    {{ ('adminFeedback.ask.' + ask) | translate }}
                  } @else {
                    {{ stationLabelKey(pos) | translate }}
                  }
                </span>
                @if (fromUser(m)) {
                  <span class="kind user">{{ 'adminFeedback.kind.userFeedback' | translate }}</span>
                }
                @if (areaOf(m); as a) {
                  <span class="chip area">{{ areaLabelKey(a) | translate }}</span>
                }
                @if (threadOnlyHit(m)) {
                  <span class="chip">{{ 'adminFeedback.search.inThread' | translate }}</span>
                }
                @if (isNew(m)) {
                  <span class="chip new">{{ 'adminFeedback.stream.newBadge' | translate }}</span>
                }
                <span class="ch-time">
                  @if (turn === 'admin') {
                    {{ 'adminFeedback.stream.waitingSince' | translate: { time: (waitingSinceIso(m) | scDate: 'date') } }}
                  } @else {
                    {{ lastActivityIso(m) | scDate: 'date' }}
                  }
                </span>
              </span>
            </span>
          </button>

          <!-- Delivered rows carry their two links right on the card: go and
               look at it in the app, and the PR / issue behind it. A shipped
               topic still waiting for its sign-off gets the ✓ right here. -->
          @if (delivered(m) && !lead) {
            <div class="card-links">
              @if (inReview(m)) {
                <button class="sc-btn micro hot" (click)="acceptReview(m)" [disabled]="busy()">
                  ✓ {{ 'adminFeedback.review.accept' | translate }}
                </button>
              }
              @if (areaLink(m); as href) {
                <a class="link-btn" [routerLink]="href" [attr.title]="'adminFeedback.stream.viewTitle' | translate: { area: (areaLabelKey(areaOf(m)!) | translate) }">
                  ▸ {{ 'adminFeedback.stream.view' | translate }}
                </a>
              }
              @if (m.ship_ref) {
                <a class="link-btn quiet" [href]="m.ship_ref" target="_blank" rel="noopener noreferrer">
                  {{ (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }} ↗
                </a>
              }
            </div>
          }

          <!-- THE LEAD CARD: the one thing waiting on the admin, with its
               answer right here (success criterion 2). -->
          @if (lead) {
            <div class="card-inline">
              @switch (askOf(m)) {
                @case ('question') {
                  @if (lastSystemMessage(m); as q) {
                    <ng-container [ngTemplateOutlet]="message" [ngTemplateOutletContext]="{ $implicit: q, kind: 'system' }"></ng-container>
                  } @else if (m.processing_note) {
                    <div class="msg system">
                      <div class="msg-head"><span class="ai">{{ 'adminFeedback.kind.ai' | translate }}</span></div>
                      <p class="msg-body">{{ m.processing_note }}</p>
                    </div>
                  }
                  <ng-container [ngTemplateOutlet]="options" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
                  <sc-feedback-composer
                    [compact]="true"
                    [draftScope]="threadScope(m.id)"
                    [busy]="busy()"
                    [primaryHot]="true"
                    placeholder="adminFeedback.thread.replyPlaceholder"
                    sendLabel="adminFeedback.thread.reply"
                    [onSubmit]="replySubmitFor(m.id)" />
                }
                @case ('review') {
                  <ng-container [ngTemplateOutlet]="reviewGate" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
                }
                @case ('release') {
                  @let body = render(m.body);
                  <div class="msg" [class.clamped]="isLong(m.id, m.body)">
                    <div class="msg-body" [innerHTML]="body.html"></div>
                    <ng-container [ngTemplateOutlet]="readMore" [ngTemplateOutletContext]="{ $implicit: m.id, body: m.body }"></ng-container>
                    <sc-feedback-attachments class="sent" [images]="body.images" />
                  </div>
                  <div class="inline-actions">
                    <button class="sc-btn micro hot" (click)="releaseToRoutine(m)" [disabled]="busy()">
                      {{ 'adminFeedback.userTopic.release' | translate }}
                    </button>
                    <button class="sc-btn micro ghost" (click)="openTopic(m.id)">
                      {{ 'adminFeedback.stream.openTopic' | translate }}
                    </button>
                  </div>
                }
              }
            </div>
          }
        </article>
      </ng-template>

      <!-- Role-coloured avatar: admin red (elevated access), collaborator light
           blue, user grey-blue. Initials, never a photo. -->
      <ng-template #avatar let-a let-self="self">
        <span class="av" [class]="'av ' + toneOf(a)" [attr.title]="roleTitle(a)" [attr.aria-label]="roleTitle(a)">{{ initials(a, self) }}</span>
      </ng-template>

      <!-- The flight path: four stations, filled up to the current one; a
           branch endcap for issue / declined / rejected, a loop mark for a
           post-ship continuation. Words ride along in the baton span. -->
      <ng-template #path let-pos>
        <span
          class="fp"
          [class.loop]="pos.loop"
          [class]="'fp s' + stationIndex(pos.station) + (pos.branch ? ' b-' + pos.branch : '') + (pos.loop ? ' loop' : '')"
          [attr.aria-label]="'adminFeedback.station.pathLabel' | translate: { station: (stationLabelKey(pos) | translate) }">
          <i></i><i></i><i></i><i></i>
        </span>
      </ng-template>

      <!-- ONE SENT MESSAGE, wherever it is drawn: the topic's own text, a
           routine reply, a human reply, an author-channel message. Routine
           replies carry the plain "AI" label and no avatar (round-2 feedback);
           humans carry their role avatar. Longer than three lines folds. -->
      <ng-template #message let-msg let-kind="kind">
        @let rendered = render(msg.body);
        <div
          class="msg"
          [class.system]="kind === 'system'"
          [class.self]="kind === 'human' && msg.author_id === selfId()"
          [class.clamped]="isLong(msg.id, msg.body)">
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
          <ng-container [ngTemplateOutlet]="readMore" [ngTemplateOutletContext]="{ $implicit: msg.id, body: msg.body }"></ng-container>
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
              <button type="button" class="sc-btn micro option" (click)="answerWithOption(m, o)" [disabled]="busy()">{{ o }}</button>
            }
          </div>
        }
      </ng-template>

      <!-- REVIEW GATE — the work is done, the topic is not, until an admin
           looked at the result (migration 20260729130000). -->
      <ng-template #reviewGate let-m>
        <section class="review-gate sc-nest sc-nest--rule">
          <div class="rg-head">
            <span class="rg-title">
              {{ (m.status === 'issue_created' ? 'adminFeedback.review.headlineIssue' : 'adminFeedback.review.headlineShipped') | translate }}
            </span>
          </div>
          <div class="rg-links">
            @if (areaLink(m); as href) {
              <a class="link-btn" [routerLink]="href">▸ {{ 'adminFeedback.actions.viewInApp' | translate }}</a>
            }
            @if (m.ship_ref) {
              <a class="link-btn quiet" [href]="m.ship_ref" target="_blank" rel="noopener noreferrer">
                {{ (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }} ↗
              </a>
            }
          </div>
          <div class="rg-actions">
            <button class="sc-btn micro hot" (click)="acceptReview(m)" [disabled]="busy()">
              ✓ {{ 'adminFeedback.review.accept' | translate }}
            </button>
            <button class="sc-btn micro" (click)="reopenFromReview(m)" [disabled]="busy()">
              ↻ {{ 'adminFeedback.review.reopen' | translate }}
            </button>
          </div>
        </section>
      </ng-template>

      <!-- ============================================================ -->
      <!-- THE TOPIC, opened: takes the whole panel (round-1 feedback — one
           needs room to read). First message of the poster, the newest
           message, and between them one "…" that unfolds one more message
           per tap. The composer is glued to the bottom edge. -->
      @if (openRow(); as m) {
        @let oturn = turnOf(m);
        @let opos = positionOf(m);
        <div class="sheet topic" role="dialog" aria-modal="true" [attr.aria-label]="topicTitle(m.body, 96)">
          <header class="sh-head">
            <button type="button" class="sh-btn" (click)="closeTopic()" [attr.aria-label]="'adminFeedback.sheet.close' | translate">←</button>
            @if (topicNo(m); as no) { <span class="topic-no">#{{ no }}</span> }
            <span class="sh-title">{{ topicTitle(m.body, 120) }}</span>
            <button
              type="button"
              class="sh-btn"
              (click)="toggleMore(m.id)"
              [attr.aria-expanded]="moreOpen(m.id)"
              [attr.aria-label]="'adminFeedback.actions.more' | translate">⋯</button>
          </header>

          @if (moreOpen(m.id)) {
            <!-- Rare, deliberate acts behind the one ⋯ (feedback 03d7e546). -->
            <div class="more-menu" role="menu">
              @if (areaLink(m); as href) {
                <a class="menu-item" role="menuitem" [routerLink]="href" (click)="closeTopic()">▸ {{ 'adminFeedback.actions.viewInApp' | translate }}</a>
              }
              @if (!archived(m) && !inReview(m)) {
                @if (issueRequested(m)) {
                  <button type="button" class="menu-item" role="menuitem" (click)="undoIssueRequest(m)" [disabled]="busy()">
                    &#8630; {{ 'adminFeedback.issue.undo' | translate }}
                  </button>
                } @else {
                  <button type="button" class="menu-item" role="menuitem" (click)="requestIssue(m)" [disabled]="busy()">
                    {{ 'adminFeedback.issue.mark' | translate }}
                  </button>
                }
              }
              @if (fromUser(m) && !archived(m) && !inReview(m)) {
                <button type="button" class="menu-item danger" role="menuitem" (click)="openDeclineForm(m)" [disabled]="busy()">
                  {{ 'adminFeedback.decline.mark' | translate }}
                </button>
              } @else {
                <button type="button" class="menu-item danger" role="menuitem" (click)="remove(m)" [disabled]="busy()">
                  {{ 'adminFeedback.delete' | translate }}
                </button>
              }
            </div>
          }

          <div class="sh-body">
            <!-- Where it stands, who filed it, what it is. -->
            <div class="sh-meta">
              <ng-container [ngTemplateOutlet]="avatar" [ngTemplateOutletContext]="{ $implicit: m.author, self: m.author_id === selfId() }"></ng-container>
              <span class="who">{{ authorLabel(m) }}</span>
              <span class="kind" [class.user]="fromUser(m)">
                {{ (fromUser(m) ? 'adminFeedback.kind.userFeedback' : 'adminFeedback.kind.order') | translate }}
              </span>
              <span class="msg-ts">{{ m.created_at | scDate: 'datetime' }}</span>
            </div>
            <div class="sh-status">
              <ng-container [ngTemplateOutlet]="path" [ngTemplateOutletContext]="{ $implicit: opos }"></ng-container>
              <span class="baton" [class]="'baton t-' + oturn">
                {{ (askOf(m) ? ('adminFeedback.ask.' + askOf(m)) : stationLabelKey(opos)) | translate }}
                · {{ turnLabelKey(oturn) | translate }}
              </span>
              @if (areaOf(m); as a) { <span class="chip area">{{ areaLabelKey(a) | translate }}</span> }
              @if (issueRequested(m)) { <span class="chip">{{ 'adminFeedback.issue.pill' | translate }}</span> }
              @if (untriaged(m)) { <span class="chip hot">{{ 'adminFeedback.userTopic.untriaged' | translate }}</span> }
            </div>
            @if (m.processing_note && !lastSystemMessage(m)) {
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

            @if (inReview(m)) {
              <ng-container [ngTemplateOutlet]="reviewGate" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            }
            @if (untriaged(m) && !archived(m) && !inReview(m)) {
              <div class="inline-actions">
                <button class="sc-btn micro hot" (click)="releaseToRoutine(m)" [disabled]="busy()">
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
                  <sc-feedback-composer
                    [compact]="true"
                    [draftScope]="authorScope(m.id)"
                    [busy]="busy()"
                    placeholder="adminFeedback.userTopic.messagePlaceholder"
                    [sendLabel]="asksAuthor(m.id) ? 'adminFeedback.userTopic.questionSend' : 'adminFeedback.userTopic.messageSend'"
                    [onSubmit]="authorReplySubmitFor(m.id)" />
                }
              </section>
            }
          </div>

          <!-- The composer, glued to the bottom edge of the sheet. Big field,
               72px thumbnails, "+" (attach) and 📷 (screenshot), one red send. -->
          <div class="sh-composer">
            <ng-container [ngTemplateOutlet]="options" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            <sc-feedback-composer
              [draftScope]="threadScope(m.id)"
              [busy]="busy()"
              [large]="true"
              [screenshot]="true"
              [primaryHot]="true"
              placeholder="adminFeedback.thread.replyPlaceholder"
              sendLabel="adminFeedback.thread.reply"
              [onSubmit]="replySubmitFor(m.id)" />
          </div>
        </div>
      }

      <!-- ============================================================ -->
      <!-- FILTER SHEET: three questions, big rows (≥ 48 px). -->
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
            <div class="f-rows" role="group">
              <button type="button" class="f-row" [class.on]="whoIs('all')" (click)="setWho('all')">{{ 'adminFeedback.filters.whoAll' | translate }}</button>
              <button type="button" class="f-row" [class.on]="whoIs('mine')" (click)="setWho('mine')">{{ 'adminFeedback.filters.whoMine' | translate }}</button>
              <button type="button" class="f-row" [class.on]="whoIs('others')" (click)="setWho('others')">{{ 'adminFeedback.filters.whoOthers' | translate }}</button>
              <button type="button" class="f-row" [class.on]="whoIs('users')" (click)="setWho('users')">
                {{ 'adminFeedback.filters.whoUsers' | translate }}
                @if (untriagedWaiting()) { <span class="dot hot" [attr.title]="'adminFeedback.sourceFilter.untriagedHint' | translate"></span> }
              </button>
              @for (a of authorOptions(); track a.id) {
                <button type="button" class="f-row sub" [class.on]="whoIsAuthor(a.id)" (click)="setWhoAuthor(a.id)">
                  {{ a.label }} <span class="f-count">{{ a.count }}</span>
                </button>
              }
            </div>

            <div class="fq">{{ 'adminFeedback.filters.where' | translate }}</div>
            <div class="f-rows" role="group">
              <button type="button" class="f-row" [class.on]="whereFilter() === null" (click)="setWhere(null)">{{ 'adminFeedback.filters.whereAll' | translate }}</button>
              @for (w of whereOptions(); track w.bucket) {
                <button type="button" class="f-row" [class.on]="whereFilter() === w.bucket" (click)="setWhere(w.bucket)">
                  {{ w.labelKey | translate }} <span class="f-count">{{ w.count }}</span>
                </button>
              }
            </div>

            <div class="fq">{{ 'adminFeedback.filters.area' | translate }}</div>
            <div class="f-rows" role="group">
              <button type="button" class="f-row" [class.on]="areaFilter() === null" (click)="setArea(null)">{{ 'adminFeedback.filters.areaAll' | translate }}</button>
              @for (a of areaOptions(); track a.area) {
                <button type="button" class="f-row" [class.on]="areaFilter() === a.area" (click)="setArea(a.area)">
                  {{ areaLabelKey(a.area) | translate }} <span class="f-count">{{ a.count }}</span>
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
            <textarea
              class="decline-input"
              rows="4"
              required
              [value]="declineNote()"
              (input)="setDeclineNote($any($event.target).value)"
              [attr.placeholder]="'adminFeedback.decline.placeholder' | translate"
              [attr.aria-label]="'adminFeedback.decline.placeholder' | translate"></textarea>
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
    .page { position: relative; display: flex; flex-direction: column; gap: var(--sc-gap-2); max-width: 860px; min-height: 0; }
    .page:not(.embedded) { min-height: 70vh; }
    .page.embedded { max-width: none; flex: 1 1 auto; padding: var(--sc-pad-2); box-sizing: border-box; }
    .scroll { flex: 1 1 auto; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: var(--sc-gap-2); scrollbar-width: thin; }
    .page:not(.embedded) .scroll { overflow: visible; }
    .page.overlay-open .scroll, .page.overlay-open .topbar, .page.overlay-open .new-topic-bar, .page.overlay-open .compose-sheet, .page.overlay-open .main-composer { visibility: hidden; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err { padding: 10px 14px; background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); border-radius: 4px; }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 32px var(--sc-pad-1); }

    /* ---- Controls at rest ---- */
    .topbar { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .tb-title { font-weight: 600; font-size: 0.9rem; }
    .search-box { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; }
    .search-box:focus-within, .search-box.active { border-color: var(--sc-accent); }
    .search-icon { color: var(--sc-fg-2); flex: 0 0 auto; }
    .search-box input { flex: 1 1 auto; min-width: 0; background: transparent; border: 0; color: var(--sc-fg-0); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor)); outline: none; }
    .search-clear { flex: 0 0 auto; min-width: 32px; min-height: 32px; background: transparent; border: 0; color: var(--sc-fg-2); font-size: 1.1rem; cursor: pointer; }
    .tb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 12px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.82rem, var(--sc-fs-floor)); cursor: pointer; }
    .tb-btn:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .tb-btn.active { border-color: var(--sc-accent); color: var(--sc-accent); }
    .tb-btn.icon { padding: 0; font-size: 1.05rem; }
    .tb-count { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--sc-accent); color: var(--sc-bg-0); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; text-align: center; }
    @media (max-width: 420px) { .tb-btn.filter .tb-label { display: none; } }

    /* ---- Bands ---- */
    .band { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
    .band-head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 4px 2px; background: transparent; border: 0; border-bottom: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer; }
    .band-head.static { cursor: default; }
    .bh-title { font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .band.yours .bh-title { color: var(--sc-fg-0); }
    .bh-count { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-3); color: var(--sc-fg-1); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; text-align: center; }
    .bh-count.hot { background: var(--sc-accent-hot); color: #fff; }
    .bh-new { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 600; }
    .band-head .chev { margin-left: auto; color: var(--sc-fg-2); transition: transform 0.16s ease; }
    .chev.open { transform: rotate(90deg); }
    .band-empty { margin: 0; padding: 8px 4px; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .day-head { display: flex; align-items: center; gap: 8px; margin: 4px 2px 0; font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--sc-fg-2); }
    .dh-count { font-weight: 400; }
    .load-more { min-height: 44px; background: transparent; border: 1px dashed var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); cursor: pointer; }
    .load-more:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }

    /* ---- Card ---- */
    .card { display: flex; flex-direction: column; gap: 8px; padding: var(--sc-pad-3); }
    .card.lead { border-color: var(--sc-accent-hot); }
    .card.done { opacity: 0.88; }
    .card-head { display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 44px; padding: 0; background: transparent; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
    .card-head:focus-visible, .band-head:focus-visible, .tb-btn:focus-visible, .f-row:focus-visible, .sh-btn:focus-visible, .read-more:focus-visible, .link-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.32); }
    .ch-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ch-title-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .topic-no { flex: 0 0 auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; font-variant-numeric: tabular-nums; }
    .topic-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; font-size: 0.88rem; color: var(--sc-fg-0); }
    .card-head:hover .topic-title { color: var(--sc-accent); }
    .ch-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ch-time { margin-left: auto; white-space: nowrap; }
    .baton { font-weight: 600; color: var(--sc-fg-1); }
    .baton.t-admin { color: var(--sc-fg-0); }
    .baton.t-nobody { color: var(--sc-fg-2); font-weight: 500; }
    .kind { font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase; color: var(--sc-fg-2); }
    .kind.user { color: var(--sc-accent); }
    .chip { display: inline-block; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--sc-border); font-size: max(0.68rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-2); white-space: nowrap; }
    .chip.area { border-style: dashed; }
    .chip.new { border-color: var(--sc-accent); color: var(--sc-accent); }
    .chip.hot { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }
    .card-links, .inline-actions, .rg-actions, .rg-links { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .link-btn { display: inline-flex; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; text-decoration: none; }
    .link-btn.quiet { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .link-btn:hover { background: rgba(0, 212, 255, 0.08); }
    .card-inline { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid var(--sc-border); }

    /* ---- Avatar (role colours; red = elevated access) ---- */
    .av { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.02em; background: rgba(120, 150, 190, 0.28); color: #b9c9de; }
    .av.adm { background: rgba(var(--accent-hot-rgb), 0.22); color: var(--sc-accent-hot); border: 1px solid var(--sc-accent-hot); }
    .av.col { background: rgba(0, 212, 255, 0.16); color: var(--sc-accent); border: 1px solid rgba(0, 212, 255, 0.5); }
    .msg-head .av { width: 22px; height: 22px; font-size: max(0.62rem, var(--sc-fs-floor)); }

    /* ---- Flight path ---- */
    .fp { display: inline-flex; align-items: center; gap: 0; flex: 0 0 auto; }
    .fp i { display: block; width: 7px; height: 7px; border-radius: 50%; border: 1px solid var(--sc-fg-2); background: transparent; box-sizing: border-box; position: relative; }
    .fp i + i { margin-left: 7px; }
    .fp i + i::before { content: ''; position: absolute; right: 100%; top: 50%; width: 7px; height: 1px; background: var(--sc-fg-2); opacity: 0.6; }
    .fp.s0 i:nth-child(-n+1), .fp.s1 i:nth-child(-n+2), .fp.s2 i:nth-child(-n+3), .fp.s3 i:nth-child(-n+4) { background: var(--sc-fg-2); border-color: var(--sc-fg-2); }
    .fp.s0 i:nth-child(1), .fp.s1 i:nth-child(2), .fp.s2 i:nth-child(3), .fp.s3 i:nth-child(4) { background: var(--sc-accent); border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.22); }
    .fp.b-issue i:nth-child(4), .fp.b-issue i:nth-child(3) { border-radius: 2px; }
    .fp.b-declined i:nth-child(2), .fp.b-rejected i:nth-child(2) { background: var(--sc-fg-2); border-color: var(--sc-fg-2); box-shadow: none; }
    .fp.b-declined i:nth-child(3), .fp.b-declined i:nth-child(4), .fp.b-rejected i:nth-child(3), .fp.b-rejected i:nth-child(4) { opacity: 0.3; }
    .fp.loop i:nth-child(2) { box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.22), 0 0 0 4px rgba(0, 212, 255, 0.1); }

    /* ---- Messages ---- */
    .msg { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: 8px; }
    .msg.system { border-left: 3px solid var(--sc-accent); }
    .msg.self { border-left: 3px solid var(--sc-accent-hot); }
    .msg.first { background: transparent; border: 0; padding: 0; }
    .msg-head { display: flex; align-items: center; gap: 8px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .msg-head .who { font-weight: 600; color: var(--sc-fg-1); }
    .msg-ts { margin-left: auto; white-space: nowrap; }
    .ai { font-weight: 700; letter-spacing: 0.08em; color: var(--sc-accent); }
    .msg-body { font-size: 0.9rem; line-height: 1.5; overflow-wrap: anywhere; }
    .msg-body :is(p, ul, ol) { margin: 0 0 0.5em; }
    .msg-body :is(p, ul, ol):last-child { margin-bottom: 0; }
    .msg.clamped .msg-body { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .read-more { align-self: flex-start; min-height: 32px; padding: 0 6px; background: transparent; border: 0; color: var(--sc-accent); font: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .sent { --att-size: 40px; }
    .thread { display: flex; flex-direction: column; gap: 6px; }
    .answer-options { display: flex; flex-wrap: wrap; gap: 8px; }
    .sc-btn.micro { padding: 6px 12px; min-height: 40px; font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.option { min-height: 44px; }
    .sc-btn.hot { background: var(--sc-accent-hot); border-color: var(--sc-accent-hot); color: #fff; }
    .sc-btn.hot:hover:not(:disabled) { background: var(--sc-accent-hot); filter: brightness(1.12); box-shadow: none; }
    .sc-btn.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    .sc-btn.danger:hover:not(:disabled) { background: var(--sc-danger); color: #fff; box-shadow: none; }
    .proc-note { margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .reopen-hint { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .review-gate { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--sc-border); border-left: 3px solid var(--sc-accent); border-radius: 8px; }
    .rg-title { font-weight: 600; font-size: max(0.84rem, var(--sc-fs-floor)); }
    .author-channel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px dashed var(--sc-accent); border-radius: 8px; }
    .ac-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .ac-title { font-weight: 700; font-size: max(0.72rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-accent); }
    .ac-status { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ac-ask { display: flex; align-items: center; gap: 8px; min-height: 40px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .ac-ask input { width: 20px; height: 20px; }

    /* ---- Sheets (topic, filters, decline) — the whole panel ---- */
    .sheet { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; background: var(--sc-bg-1); border-radius: inherit; }
    .page.embedded .sheet { inset: 0; }
    .page:not(.embedded) .sheet { position: fixed; z-index: 30; max-width: 860px; margin: 0 auto; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5); }
    .sh-head { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-height: 52px; padding: 6px var(--sc-pad-2); border-bottom: 1px solid var(--sc-border); }
    .sh-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; background: transparent; border: 0; border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: 1.1rem; cursor: pointer; }
    .sh-btn:hover { background: var(--sc-bg-2); color: var(--sc-fg-0); }
    .sh-btn.text { font-size: max(0.78rem, var(--sc-fs-floor)); padding: 0 10px; color: var(--sc-accent); }
    .sh-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; font-size: 0.9rem; }
    .sh-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--sc-gap-2); padding: var(--sc-pad-2); scrollbar-width: thin; }
    .sh-composer { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; padding: var(--sc-pad-3) var(--sc-pad-2); border-top: 1px solid var(--sc-border); background: var(--sc-bg-1); padding-bottom: calc(var(--sc-pad-3) + env(safe-area-inset-bottom, 0px)); }
    .sh-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sh-meta .who { font-weight: 600; color: var(--sc-fg-1); }
    .sh-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .more-menu { display: flex; flex-direction: column; flex: 0 0 auto; border-bottom: 1px solid var(--sc-border); background: var(--sc-bg-2); }
    .menu-item { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 var(--sc-pad-1); background: transparent; border: 0; color: var(--sc-fg-0); font: inherit; font-size: max(0.84rem, var(--sc-fs-floor)); text-align: left; text-decoration: none; cursor: pointer; }
    .menu-item:hover { background: var(--sc-bg-3); }
    .menu-item.danger { color: var(--sc-danger); }
    .done-btn { justify-content: center; }
    .fq { margin-top: 4px; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .f-rows { display: flex; flex-direction: column; border: 1px solid var(--sc-border); border-radius: 8px; overflow: hidden; }
    .f-row { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 14px; background: var(--sc-bg-2); border: 0; border-bottom: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor)); text-align: left; cursor: pointer; }
    .f-row:last-child { border-bottom: 0; }
    .f-row.sub { padding-left: 28px; }
    .f-row.on { color: var(--sc-fg-0); background: rgba(0, 212, 255, 0.1); box-shadow: inset 3px 0 0 var(--sc-accent); }
    .f-count { margin-left: auto; color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .dot.hot { background: var(--sc-accent-hot); }
    .decline-form { gap: 10px; }
    .decline-input { width: 100%; box-sizing: border-box; padding: 8px 10px; resize: vertical; background: var(--sc-bg-2); border: 1px solid var(--sc-danger); border-radius: 6px; color: var(--sc-fg-0); font: inherit; font-size: max(0.84rem, var(--sc-fs-floor)); }

    /* ---- Composer bar ---- */
    .main-composer { position: sticky; bottom: 12px; z-index: 1; }
    .page.embedded .main-composer { position: static; }
    .new-topic-bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; background: var(--sc-bg-2); border: 1px dashed var(--sc-border); border-radius: 8px; color: var(--sc-fg-1); font: inherit; font-size: max(0.82rem, var(--sc-fs-floor)); cursor: pointer; }
    .new-topic-bar:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .nt-plus { font-size: 1.1rem; color: var(--sc-accent); }
    .compose-sheet { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: var(--sc-pad-3); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); }
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
  private readonly celebration = inject(CelebrationService);

  /** When embedded in the feedback FAB panel, the page chrome (title, subtitle)
   *  is dropped — the panel supplies its own header. */
  readonly embedded = input(false);

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

  /** Template aliases for the pure label helpers. */
  readonly stationLabelKey = stationLabelKey;
  readonly turnLabelKey = turnLabelKey;
  readonly stationIndex = stationIndex;

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

  /** The routine's newest reply — the question the lead card shows. */
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

  /** Band 1: what waits on the admin, longest wait first. */
  readonly yourTurn = computed(() =>
    this.filtered()
      .filter((m) => this.turnOf(m) === 'admin')
      .sort((a, b) => waitingSince(a, this.threads().get(a.id)) - waitingSince(b, this.threads().get(b.id))),
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
  closeFilters(): void { this.filtersOpen.set(false); }

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
    if (w === 'mine') return !isUserSubmitted(m) && !!m.author_id && m.author_id === this.selfId();
    if (w === 'others') return !isUserSubmitted(m) && m.author_id !== this.selfId();
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

  /** Distinct authors, most-topics first — the "Wer?" rows. */
  readonly authorOptions = computed(() => {
    const seen = new Map<string, { id: string; label: string; count: number }>();
    for (const m of this.messages()) {
      const id = m.author_id ?? AdminFeedbackComponent.NO_AUTHOR;
      const existing = seen.get(id);
      if (existing) existing.count++;
      else seen.set(id, { id, label: this.authorLabel(m), count: 1 });
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
  }

  closeTopic(): void {
    this.openId.set(null);
    this._moreOpen.set(new Set());
  }

  /**
   * Escape closes the top-most sheet — and stops there. The FAB shell listens
   * for Escape on the document to step the panel down (maximized → docked →
   * minimized); with a sheet open that key belongs to the sheet, and since this
   * host sits inside the panel its listener runs first.
   */
  @HostListener('keydown.escape', ['$event'])
  onEscape(ev: KeyboardEvent): void {
    if (this.declineTopicRow()) this.cancelDeclineForm();
    else if (this.filtersOpen()) this.closeFilters();
    else if (this.openRow()) this.closeTopic();
    else return;
    ev.stopPropagation();
    ev.preventDefault();
  }

  /** Put the keyboard into the sheet that just opened (its back button). */
  private focusSheet(): void {
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLElement>('sc-admin-feedback .sheet .sh-btn');
      btn?.focus();
    });
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

  /** One-tap answers the routine offered in its newest question, if any. */
  answerOptionsFor(m: FeedbackRow): AnswerOptions | null {
    if (this.askOf(m) !== 'question') return null;
    const q = this.lastSystemMessage(m);
    return q ? parseAnswerOptions(q.body) : null;
  }

  async answerWithOption(m: FeedbackRow, option: string): Promise<void> {
    await this.sendReply(m.id, { text: option, images: [] });
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
    return this.translate.instant(`adminFeedback.role.${role}`);
  }

  initials(a: FeedbackAuthor | null | undefined, self: boolean): string {
    const name = a?.display_name || a?.username || '';
    if (!name) return self ? this.translate.instant('adminFeedback.you').slice(0, 2) : '?';
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

  topicTitle(body: string, max?: number): string {
    return topicTitle(body, max);
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
      .select('id, seq, author_id, body, status, ship_ref, processing_note, created_at, updated_at, shipped_at, processed_at, reviewed_at, source, triaged, decision_note, area, author:profiles(display_name, username, role)')
      .order('created_at', { ascending: true });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      const rows = (data ?? []) as unknown as FeedbackRow[];
      this.messages.set(rows);
      await this.loadThreads(rows.map((r) => r.id));
      await this.loadAuthorThreads(rows.filter(isUserSubmitted).map((r) => r.id));
      this.detectShipped(rows);
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
    return uploadFeedbackImages(this.sb.client, this.selfId(), images);
  }

  private buildBody(text: string, images: PendingImage[], urls: string[]): string {
    return buildFeedbackBody(text, images, urls);
  }

  readonly createTopicBound = (payload: ComposerPayload): Promise<boolean> => this.createTopic(payload);

  /** Docked panel: the new-topic composer is collapsed to a bar by default. */
  readonly composerOpen = signal(false);
  openComposer(): void { this.composerOpen.set(true); }
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
      .insert({ body, author_id: uid, area: payload.area ?? null });
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

  private readonly replySubmitters = new Map<string, (p: ComposerPayload) => Promise<boolean>>();

  replySubmitFor(feedbackId: string): (p: ComposerPayload) => Promise<boolean> {
    let fn = this.replySubmitters.get(feedbackId);
    if (!fn) {
      fn = (p: ComposerPayload) => this.sendReply(feedbackId, p);
      this.replySubmitters.set(feedbackId, fn);
    }
    return fn;
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

  async acceptReview(m: FeedbackRow): Promise<void> {
    await this.writeReview(m, { reviewed_at: new Date().toISOString() });
  }

  /**
   * Reject the outcome and put the topic back into the work loop — `open` IS
   * the routine's queue; `ship_ref` stays as the history of what was tried.
   */
  async reopenFromReview(m: FeedbackRow): Promise<void> {
    await this.writeReview(m, {
      status: 'open',
      reviewed_at: null,
      processing_note: null,
      processed_at: null,
    });
    // The steer belongs in the thread: open the topic so the admin can say
    // what still is not right, with the composer already in reach.
    this.openTopic(m.id);
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

  async sendAuthorMessage(feedbackId: string, payload: ComposerPayload): Promise<boolean> {
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
      is_question: this.asksAuthor(feedbackId),
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
    this.declineFormFor.set(null);
    this.declineNote.set('');
    this.declineReason.set(null);
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

  setDeclineNote(value: string): void {
    this.declineNote.set(value);
    this.declineReason.set(matchDeclineReason(value, this.declineReasonTexts()));
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
      return;
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
    this.cancelDeclineForm();
    this.closeTopic();
    await this.refresh();
  }

  async remove(m: FeedbackRow) {
    if (!window.confirm(this.translate.instant('adminFeedback.deleteConfirm'))) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.from('admin_feedback').delete().eq('id', m.id);
    if (error) this.errorMsg.set(error.message);
    this.closeTopic();
    await this.refresh();
  }
}
