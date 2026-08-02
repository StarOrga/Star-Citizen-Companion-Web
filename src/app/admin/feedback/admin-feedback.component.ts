import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { NgTemplateOutlet } from '@angular/common';
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
import { FeedbackWorkflowComponent } from './feedback-workflow.component';
import { RoutineStatusDirective } from './routine-status.directive';
import {
  FeedbackBucket,
  FeedbackMessage,
  FeedbackRow,
  FeedbackSearchHit,
  BucketLabelKey,
  FeedbackStatus,
  WorkflowScope,
  awaitsTriage,
  buildWorkflowQueue,
  bucketLabelStatus,
  feedbackBucket,
  filterWorkflowScope,
  isArchived,
  isContinuedAfterShip,
  isUserSubmitted,
  refKind,
  searchFeedback,
  searchTokens,
  timeOf,
  topicNumber,
  topicTitle,
  workflowScopeCounts,
} from './feedback.types';
import { buildFeedbackBody, uploadFeedbackImages } from '../../feedback/feedback-images.util';
import { draftScopes, memoScope } from '../../feedback/feedback-draft.types';
import { awaitsReview } from './feedback.types';
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
 * The board's four modes: scan the list, work the queue, sign the finished work
 * off, read the numbers.
 *
 * `review` is the admin's own step (feedback #79): the review gate (migration
 * 20260729130000) already keeps a shipped topic on the active board until
 * somebody accepts the result, but it only surfaced inside the topic's card in
 * the overview — so finding what is waiting meant scrolling the board. As its
 * own mode it is a visible "this was done, please check and tick it off" pile
 * with the archive one click away.
 */
export type FeedbackView = 'overview' | 'workflow' | 'review' | 'progress';

/**
 * Which half of the overview list is on screen: the working set or the done
 * pile (feedback eeba60e7). Orthogonal to {@link FeedbackView} — this only
 * splits the overview's own list.
 */
export type BoardTab = 'active' | 'archive';

/** One entry in the quick-access table of contents (horizontal jump bar). */
interface TocEntry {
  id: string;
  label: string;
  /** Presentation bucket (ToDo / Rückfrage / in progress …), not the raw status. */
  bucket: FeedbackBucket;
  /** needs_input topic whose newest reply is the routine's → the admin still owes an answer. */
  awaitingAdmin: boolean;
}

/** A run of active topics sharing one calendar day, under a single day heading. */
interface FeedbackGroup {
  /** Stable day key (local Y-M-D) used for tracking and grouping. */
  key: string;
  /** Human day heading: Today / Yesterday / localized date. */
  label: string;
  items: FeedbackRow[];
}

/** Draft identity of the new-topic composer (see `FeedbackDraftService`). */
const DRAFT_SCOPE = draftScopes.adminNew;
/** localStorage key remembering the last selected board view. */
const VIEW_KEY = 'sc.adminFeedback.view';
/**
 * View the board opens in when nothing is remembered (feedback fda4e3ea): the
 * processing mode, docked, maximized and on the full page alike. An explicit
 * pick via the view switch still wins on the next open.
 */
const DEFAULT_VIEW: FeedbackView = 'workflow';
/** localStorage key holding the processing mode's ticked-off topics. */
const HANDLED_KEY = 'sc.adminFeedback.handled';
/** localStorage key remembering the processing mode's scope. */
const WORKFLOW_SCOPE_KEY = 'sc.adminFeedback.workflowScope';
/**
 * Scope the processing mode opens in (feedback abfa97c6): your own topics.
 * Working the queue means answering Rückfragen, and those you can only answer
 * on topics you raised — another admin's topic is theirs to steer. The switch
 * (with its counts) makes the other two scopes one click away.
 */
const DEFAULT_WORKFLOW_SCOPE: WorkflowScope = 'mine';

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [
    ScDatePipe,
    NgTemplateOutlet,
    TranslateModule,
    FeedbackAttachmentsComponent,
    FeedbackComposerComponent,
    FeedbackWorkflowComponent,
    FeedbackDashboardComponent,
    RoutineStatusDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Smooth height/opacity collapse+expand for a topic's detail region, so the
  // guided answer flow in the panel reads as a fold rather than a hard cut
  // (feedback 816a0ec8). Disabled on the full board (see [@.disabled] below),
  // where every card is always open.
  animations: [
    trigger('expandCollapse', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('220ms cubic-bezier(0.2, 0.8, 0.2, 1)', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('180ms cubic-bezier(0.4, 0, 1, 1)', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
  template: `
    <section class="page" [class.embedded]="embedded()">
      @if (!embedded()) {
        <header class="head">
          <div>
            <!-- The heading doubles as the dev-PC liveness light: tinted green
                 / red / left grey by scRoutineStatus (feedback a7573f0e). On
                 the embedded board the FAB panel's own title carries it. The
                 attribute's value is this heading's own i18n key: the state
                 wording rides on aria-label, never on screen. -->
            <h1 scRoutineStatus="adminFeedback.title">{{ 'adminFeedback.title' | translate }}</h1>
            <p class="hint">{{ 'adminFeedback.subtitle' | translate }}</p>
          </div>
        </header>
      }

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'adminFeedback.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      <!-- Ship celebration banner: the routine shipped something since the last
           poll. Auto-hides; the confetti burst rides along (feedback 605d317d). -->
      @if (shipCheer() > 0) {
        <p class="ship-cheer" role="status">
          🚀 {{ 'adminFeedback.cheer.shipped' | translate: { count: shipCheer() } }}
        </p>
      }

      <!-- View switch — sits above everything, so it is reachable in the docked
           panel, the maximized panel and on the full board page alike
           (feedback 605d317d, phase 2). -->
      <div class="view-switch" role="group" [attr.aria-label]="'adminFeedback.view.label' | translate">
        <button
          type="button"
          class="view-tab"
          [class.active]="view() === 'overview'"
          [attr.aria-pressed]="view() === 'overview'"
          (click)="setView('overview')">
          {{ 'adminFeedback.view.overview' | translate }}
        </button>
        <button
          type="button"
          class="view-tab"
          [class.active]="view() === 'workflow'"
          [attr.aria-pressed]="view() === 'workflow'"
          (click)="setView('workflow')">
          {{ 'adminFeedback.view.workflow' | translate }}
          @if (workflowQueue().length > 0) {
            <span class="tab-badge">{{ workflowQueue().length }}</span>
          }
        </button>
        <!-- The sign-off step (feedback #79): everything the routine finished
             and nobody has confirmed yet, with its own count so it is obvious
             from the switch that something is waiting. -->
        <button
          type="button"
          class="view-tab"
          [class.active]="view() === 'review'"
          [attr.aria-pressed]="view() === 'review'"
          (click)="setView('review')">
          {{ 'adminFeedback.view.review' | translate }}
          @if (reviewQueue().length > 0) {
            <span class="tab-badge review">{{ reviewQueue().length }}</span>
          }
        </button>
        <button
          type="button"
          class="view-tab"
          [class.active]="view() === 'progress'"
          [attr.aria-pressed]="view() === 'progress'"
          (click)="setView('progress')">
          {{ 'adminFeedback.view.progress' | translate }}
        </button>
      </div>

      @if (view() === 'workflow') {
        <div class="board alt">
          <sc-feedback-workflow
            [queue]="workflowQueue()"
            [selfId]="selfId()"
            [busy]="busy()"
            [compact]="embedded()"
            [scope]="workflowScope()"
            [scopeCounts]="workflowScopeCounts()"
            [reply]="workflowReplyBound"
            (markHandled)="markHandled($event)"
            (scopeChange)="setWorkflowScope($event)"
            (showProgress)="setView('progress')" />
        </div>
      } @else if (view() === 'review') {
        <!-- SIGN-OFF QUEUE — "wurde bearbeitet, bitte prüfen und abhaken".
             Same two decisions as the in-card review gate (accept → archive,
             reopen → back into the routine's queue); this is only the place
             that collects them so none has to be hunted for. -->
        <div class="board alt">
          <section class="rv">
            <p class="rv-lead">{{ 'adminFeedback.review.queueTitle' | translate }}</p>
            @if (!embedded()) {
              <p class="rv-hint">{{ 'adminFeedback.review.hint' | translate }}</p>
            }

            @if (reviewQueue().length === 0) {
              <div class="rv-empty sc-card">
                <div class="rv-empty-icon" aria-hidden="true">✅</div>
                <h3>{{ 'adminFeedback.review.emptyTitle' | translate }}</h3>
                <p>{{ 'adminFeedback.review.emptyHint' | translate }}</p>
              </div>
            } @else {
              @for (m of reviewQueue(); track m.id) {
                <article class="rv-card sc-card">
                  <header class="rv-head">
                    <span class="rg-badge">
                      {{ (m.status === 'issue_created'
                          ? 'adminFeedback.status.issue_created'
                          : 'adminFeedback.status.shipped') | translate }}
                    </span>
                    @if (topicNo(m); as no) {
                      <span class="rv-no" [attr.title]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
                    }
                    <span class="rv-title">{{ topicTitle(m.body) }}</span>
                    <span class="rv-ts">{{ reviewSince(m) | scDate }}</span>
                  </header>

                  @if (m.ship_ref) {
                    <a
                      class="ship-ref"
                      [class.issue]="linkKind(m) === 'issue'"
                      [href]="m.ship_ref"
                      target="_blank"
                      rel="noopener noreferrer">
                      {{ (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }} ↗
                    </a>
                  }

                  <div class="rg-actions">
                    <button class="sc-btn micro accept" (click)="acceptReview(m)" [disabled]="busy()">
                      ✓ {{ 'adminFeedback.review.accept' | translate }}
                    </button>
                    <button class="sc-btn micro" (click)="reopenFromReview(m)" [disabled]="busy()">
                      ↻ {{ 'adminFeedback.review.reopen' | translate }}
                    </button>
                    <button class="sc-btn micro ghost" (click)="openInOverview(m)">
                      {{ 'adminFeedback.review.openTopic' | translate }} →
                    </button>
                  </div>
                </article>
              }
            }
          </section>
        </div>
      } @else if (view() === 'progress') {
        <div class="board alt">
          <sc-feedback-dashboard
            [rows]="messages()"
            [threads]="threads()"
            [compact]="embedded()" />
        </div>
      } @else {

      <div class="board">
        <!-- Board toolbar: status + author quick-filters on ONE compact row
             (feedback 605d317d — no more doubled filter bars, no horizontal
             TOC scroll strip). Per-chip counts are gone; the single motivating
             totals line below carries the numbers instead. -->
        <div class="board-toolbar">
          <!-- Fuzzy search across the whole conversation — topic body, processing
               note, author and every thread reply (feedback 12476cec). Typing
               narrows both tabs and re-orders the hits by relevance; the day
               headings step aside for a single "N Treffer" heading while a query
               is active, because relevance and date order contradict each other. -->
          @if (!embedded() || searchOpen()) {
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <input
              #searchInput
              type="search"
              autocomplete="off"
              [value]="searchQuery()"
              (input)="setSearch($any($event.target).value)"
              (keydown.escape)="clearSearch()"
              [attr.placeholder]="'adminFeedback.search.placeholder' | translate"
              [attr.aria-label]="'adminFeedback.search.label' | translate" />
            <!-- Shown for any non-empty input, not just a *usable* query: a
                 whitespace-only field has to be clearable too. -->
            @if (searchQuery().length > 0) {
              <button
                type="button"
                (click)="clearSearch(); searchInput.focus()"
                [attr.aria-label]="'adminFeedback.search.clear' | translate">
                ×
              </button>
            }
          </div>
          }
          <div class="filters">
            <!-- Active ↔ Archive tabs inside the overview (feedback eeba60e7).
                 Active holds the working set (open / in Arbeit / Rückfrage);
                 Archive holds the terminal ones — shipped and issue-created —
                 each with its link. -->
            <div class="archive-switch" role="group" [attr.aria-label]="'adminFeedback.tab.label' | translate">
              <button
                type="button"
                class="archive-tab"
                [class.active]="boardTab() === 'active'"
                [attr.aria-pressed]="boardTab() === 'active'"
                (click)="setBoardTab('active')">
                {{ 'adminFeedback.tab.active' | translate }}
                <span class="tab-count">{{ activeCount() }}</span>
              </button>
              <button
                type="button"
                class="archive-tab"
                [class.active]="boardTab() === 'archive'"
                [attr.aria-pressed]="boardTab() === 'archive'"
                (click)="setBoardTab('archive')">
                {{ 'adminFeedback.tab.archive' | translate }}
                <span class="tab-count">{{ archiveCount() }}</span>
              </button>
            </div>
            <!-- Docked panel only: reveal search / fold the chips / expand all,
                 so the prime filter row stays a single line (feedback 3133f9). -->
            @if (embedded()) {
              <div class="toolbar-icons">
                <button
                  type="button"
                  class="tb-icon"
                  [class.active]="searchOpen()"
                  [attr.aria-pressed]="searchOpen()"
                  (click)="toggleSearch()"
                  [attr.aria-label]="'adminFeedback.search.toggle' | translate">
                  <span aria-hidden="true">⌕</span>
                </button>
                <button
                  type="button"
                  class="tb-icon labelled"
                  [class.active]="filtersOpen()"
                  [attr.aria-pressed]="filtersOpen()"
                  (click)="toggleFilters()"
                  [attr.aria-label]="'adminFeedback.filter.toggle' | translate">
                  <span aria-hidden="true">⚲</span>
                  {{ 'adminFeedback.filter.toggle' | translate }}
                  @if (!filtersOpen() && (statusFilter() !== null || authorFilter() !== null)) {
                    <span class="dot" aria-hidden="true"></span>
                  }
                </button>
                @if (visibleMessages().length > 1) {
                  <button
                    type="button"
                    class="tb-icon"
                    (click)="toggleExpandAll()"
                    [attr.aria-pressed]="allExpanded()"
                    [attr.aria-label]="(allExpanded() ? 'adminFeedback.collapseAll' : 'adminFeedback.expandAll') | translate">
                    <span class="chev" [class.open]="allExpanded()" aria-hidden="true">▸</span>
                  </button>
                }
              </div>
            }
            @if (!embedded() || filtersOpen()) {
            <!-- Status chips narrow the CURRENT tab; their vocabulary differs
                 per tab, so switching tabs clears the chip selection. -->
            <div class="status-filter" role="group" [attr.aria-label]="'adminFeedback.statusFilter.label' | translate">
              <button
                type="button"
                class="status-chip"
                [class.active]="statusFilter() === null"
                (click)="setStatusFilter(null)">
                {{ 'adminFeedback.statusFilter.all' | translate }}
              </button>
              @if (boardTab() === 'active') {
                @if (bucketCounts().awaiting_admin > 0) {
                  <button
                    type="button"
                    class="status-chip needs_input"
                    [class.active]="statusFilter() === 'awaiting_admin'"
                    (click)="setStatusFilter('awaiting_admin')">
                    {{ 'adminFeedback.status.needs_input' | translate }}
                  </button>
                }
                @if (bucketCounts().todo > 0) {
                  <button
                    type="button"
                    class="status-chip open"
                    [class.active]="statusFilter() === 'todo'"
                    (click)="setStatusFilter('todo')">
                    {{ 'adminFeedback.status.open' | translate }}
                  </button>
                }
                <!-- The mirror image of the Rückfrage chip: topics where the
                     admin asked the person who filed them (feedback 5920cf8c). -->
                @if (bucketCounts().awaiting_author > 0) {
                  <button
                    type="button"
                    class="status-chip needs_input_author"
                    [class.active]="statusFilter() === 'awaiting_author'"
                    (click)="setStatusFilter('awaiting_author')">
                    {{ 'adminFeedback.status.needs_input_author' | translate }}
                  </button>
                }
                @if (bucketCounts().in_progress > 0) {
                  <button
                    type="button"
                    class="status-chip in_progress"
                    [class.active]="statusFilter() === 'in_progress'"
                    (click)="setStatusFilter('in_progress')">
                    {{ 'adminFeedback.status.in_progress' | translate }}
                  </button>
                }
                <!-- Shipped / handed to an issue and waiting for the sign-off
                     that ends the topic (migration 20260729130000). -->
                @if (bucketCounts().review > 0) {
                  <button
                    type="button"
                    class="status-chip review"
                    [class.active]="statusFilter() === 'review'"
                    (click)="setStatusFilter('review')">
                    {{ 'adminFeedback.status.review' | translate }}
                    <span class="chip-count">{{ bucketCounts().review }}</span>
                  </button>
                }
              } @else {
                @if (bucketCounts().shipped > 0) {
                  <button
                    type="button"
                    class="status-chip shipped"
                    [class.active]="statusFilter() === 'shipped'"
                    (click)="setStatusFilter('shipped')">
                    {{ 'adminFeedback.status.shipped' | translate }}
                  </button>
                }
                @if (bucketCounts().issue_created > 0) {
                  <button
                    type="button"
                    class="status-chip issue_created"
                    [class.active]="statusFilter() === 'issue_created'"
                    (click)="setStatusFilter('issue_created')">
                    {{ 'adminFeedback.status.issue_created' | translate }}
                  </button>
                }
                @if (bucketCounts().declined > 0) {
                  <button
                    type="button"
                    class="status-chip declined"
                    [class.active]="statusFilter() === 'declined'"
                    (click)="setStatusFilter('declined')">
                    {{ 'adminFeedback.status.declined' | translate }}
                  </button>
                }
                @if (bucketCounts().rejected > 0) {
                  <button
                    type="button"
                    class="status-chip rejected"
                    [class.active]="statusFilter() === 'rejected'"
                    (click)="setStatusFilter('rejected')">
                    {{ 'adminFeedback.status.rejected' | translate }}
                  </button>
                }
              }
            </div>
            @if (authorOptions().length > 1) {
              <div class="author-filter" role="group" [attr.aria-label]="'adminFeedback.filter.label' | translate">
                <button
                  type="button"
                  class="author-chip"
                  [class.active]="authorFilter() === null"
                  (click)="setAuthorFilter(null)">
                  {{ 'adminFeedback.filter.all' | translate }}
                </button>
                @for (a of authorOptions(); track a.id) {
                  <button
                    type="button"
                    class="author-chip"
                    [class.active]="authorFilter() === a.id"
                    (click)="setAuthorFilter(a.id)">
                    {{ a.label }}
                  </button>
                }
              </div>
            }
            }
          </div>
        </div>

        <!-- One totals line for the current filtering (feedback 605d317d): what
             is waiting on the admin, and what came out of the board so far.
             Shown in BOTH modes — the docked panel is the quick analytical look,
             so this is exactly the line it must not be missing (it only drops
             the wording down to bare numbers there). "In Arbeit" is deliberately
             left out: it is nothing to act on and nothing to celebrate. -->
        @if (hasBoardStats()) {
          <p class="board-stats" [class.compact]="embedded()">
            @if (motivatingStats().rueckfragen > 0) {
              <span class="stat rueckfragen">{{ 'adminFeedback.stats.rueckfragen' | translate: { count: motivatingStats().rueckfragen } }}</span>
            }
            @if (motivatingStats().review > 0) {
              <span class="stat review">{{ 'adminFeedback.stats.review' | translate: { count: motivatingStats().review } }}</span>
            }
            @if (motivatingStats().shipped > 0) {
              <span class="stat shipped">{{ 'adminFeedback.stats.shipped' | translate: { count: motivatingStats().shipped } }}</span>
            }
            @if (motivatingStats().issues > 0) {
              <span class="stat issues">{{ 'adminFeedback.stats.issues' | translate: { count: motivatingStats().issues } }}</span>
            }
          </p>
        }

        @if (busy() && messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.loading' | translate }}</div>
        } @else if (messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.empty' | translate }}</div>
        } @else if (boardTab() === 'active') {
          <!-- Active topics grouped under a non-interactive day heading (Today /
               Yesterday / date) so the list reads as a dated timeline. -->
          @if (activeMessages().length === 0) {
            <div class="sc-card empty">
              {{ (searchActive() ? 'adminFeedback.search.empty' : 'adminFeedback.emptyActive')
                  | translate: { query: searchQuery() } }}
            </div>
          }
          @for (g of activeGroups(); track g.key) {
            <div class="date-group">{{ g.label }}</div>
            @for (m of g.items; track m.id) {
              <ng-container [ngTemplateOutlet]="msgCard" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            }
          }
        } @else {
          <!-- Archive: everything terminal (shipped + issue-created + legacy
               rejected), newest first and paged. Each row carries its link. -->
          @if (archiveMessages().length === 0) {
            <div class="sc-card empty">
              {{ (searchActive() ? 'adminFeedback.search.empty' : 'adminFeedback.emptyArchive')
                  | translate: { query: searchQuery() } }}
            </div>
          } @else {
            @if (searchActive()) {
              <div class="date-group">
                {{ 'adminFeedback.search.results' | translate: { count: archiveMessages().length } }}
              </div>
            }
            <div class="archive-list">
              @for (m of archiveVisibleMessages(); track m.id) {
                <ng-container [ngTemplateOutlet]="msgCard" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
              }
              @if (archiveRemaining() > 0) {
                <button type="button" class="load-more" (click)="loadMoreArchive()">
                  {{ 'adminFeedback.loadMore' | translate: { count: archiveRemaining() } }}
                </button>
              }
            </div>
          }
        }
      </div>
      }

      <!-- Status pills of one topic. The presentation bucket decides the label,
           not the raw status: an answered Rückfrage reads as ToDo (the routine
           has to pick it up again) and only keeps the small "beantwortet" marker
           next to it, which says who acted last (feedback 34c44134). -->
      <ng-template #pills let-m>
        <span class="status-pill" [class]="bucketLabel(m)">{{ ('adminFeedback.status.' + bucketLabel(m)) | translate }}</span>
        <!-- Filed by a viewer/collaborator through their own FAB (feedback
             5920cf8c), and — until released — still held back from the routine. -->
        @if (fromUser(m)) {
          <span class="status-pill from-user">{{ 'adminFeedback.userTopic.badge' | translate }}</span>
          @if (untriaged(m)) {
            <span class="status-pill untriaged">{{ 'adminFeedback.userTopic.untriaged' | translate }}</span>
          }
        }
        @if (isAnsweredAwaitingRoutine(m)) {
          <span class="status-pill answered">✓ {{ 'adminFeedback.status.answered' | translate }}</span>
        }
        @if (continuedAfterShip(m)) {
          <span class="status-pill continued">↻ {{ 'adminFeedback.status.continued' | translate }}</span>
        }
        <!-- Why this row is in the result list even though its title looks
             unrelated: the query matched further down the thread. -->
        @if (threadOnlyHit(m)) {
          <span class="status-pill">{{ 'adminFeedback.search.inThread' | translate }}</span>
        }
      </ng-template>

      <ng-template #msgCard let-m>
        <article class="msg sc-card" [id]="cardDomId(m.id)" [class.is-self]="m.author_id === selfId()">
          @if (embedded()) {
            <!-- Compact panel: the whole topic collapses to a single clickable
                 one-liner — chevron · generated title · author · status. The day
                 heading above carries the date, so no per-row timestamp is shown
                 (feedback 92f08bb4). -->
            <button
              type="button"
              class="msg-head one-liner"
              (click)="toggleExpand(m.id)"
              [attr.aria-expanded]="isExpanded(m.id)"
              [attr.aria-label]="'adminFeedback.toggleDetails' | translate">
              <span class="chev" [class.open]="isExpanded(m.id)">▸</span>
              <!-- Stable reference number (feedback 21587480) — deliberately
                   quiet and ahead of the title, so it reads as a handle for the
                   topic rather than as part of it. -->
              @if (topicNo(m); as no) {
                <span
                  class="topic-no"
                  [attr.title]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
              }
              <span class="topic-title">{{ topicTitle(m.body) }}</span>
              <span class="row-author">{{ authorLabel(m) }}</span>
              <ng-container [ngTemplateOutlet]="pills" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            </button>
          } @else {
            <div class="msg-head">
              @if (topicNo(m); as no) {
                <span
                  class="topic-no"
                  [attr.title]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
              }
              <span class="author">{{ authorLabel(m) }}</span>
              <span class="ts">{{ m.created_at | scDate: 'datetime' }}</span>
              <ng-container [ngTemplateOutlet]="pills" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
            </div>
          }

          @if (!embedded() || isExpanded(m.id)) {
           <!-- Animate the fold only in the panel; the full board keeps every
                card open, so its detail region is never toggled. -->
           <div class="msg-detail" [@expandCollapse] [@.disabled]="!embedded()">
            <!-- Long bodies are clamped to their first two sentences on the full
                 board (feedback 73dfa165) so the list stays scannable; expand to
                 read the rest. In the compact FAB panel the whole card already
                 collapses, so the body is shown in full when opened there.
                 Screenshots ride along as thumbnails in both states — they are
                 attachments now, not part of the text (feedback a660536a). -->
            @let body = render(m.body);
            @if (!embedded()) {
              @let bp = bodyPreview(m.body);
              @if (bp.truncated && !isBodyExpanded(m.id)) {
                <div class="msg-body clamped">{{ bp.text }}<button type="button" class="body-toggle" (click)="toggleBody(m.id)">… {{ 'adminFeedback.showMore' | translate }}</button></div>
              } @else {
                <div class="msg-body" [innerHTML]="body.html"></div>
                @if (bp.truncated) {
                  <button type="button" class="body-toggle" (click)="toggleBody(m.id)">{{ 'adminFeedback.showLess' | translate }}</button>
                }
              }
            } @else {
              <div class="msg-body" [innerHTML]="body.html"></div>
            }
            <sc-feedback-attachments [images]="body.images" />

            <!-- ship_ref holds either the PR that shipped the topic or the
                 GitHub issue it was handed off to — label the link accordingly
                 so the archive tells the two apart at a glance. -->
            @if (m.ship_ref) {
              <a
                class="ship-ref"
                [class.issue]="linkKind(m) === 'issue'"
                [href]="m.ship_ref"
                target="_blank"
                rel="noopener noreferrer">
                {{ (linkKind(m) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }} ↗
              </a>
            }
            @if (m.processing_note) {
              <p class="proc-note">{{ m.processing_note }}</p>
            }

            <!-- Per-topic thread: follow-up replies (human admins + the routine). -->
            @if (messagesFor(m.id).length > 0) {
              <div class="thread">
                @for (msg of messagesFor(m.id); track msg.id) {
                  <div class="reply" [class.is-system]="msg.is_system" [class.is-self]="!msg.is_system && msg.author_id === selfId()">
                    <div class="reply-head">
                      <span class="reply-author">{{ authorLabelFor(msg) }}</span>
                      @if (msg.is_system) { <span class="reply-badge">{{ 'adminFeedback.thread.routineBadge' | translate }}</span> }
                      <span class="reply-ts">{{ msg.created_at | scDate: (embedded() ? 'date' : 'datetime') }}</span>
                    </div>
                    @let reply = render(msg.body);
                    @if (!embedded()) {
                      @let rp = bodyPreview(msg.body);
                      @if (rp.truncated && !isBodyExpanded(msg.id)) {
                        <div class="reply-body clamped">{{ rp.text }}<button type="button" class="body-toggle" (click)="toggleBody(msg.id)">… {{ 'adminFeedback.showMore' | translate }}</button></div>
                      } @else {
                        <div class="reply-body" [innerHTML]="reply.html"></div>
                        @if (rp.truncated) {
                          <button type="button" class="body-toggle" (click)="toggleBody(msg.id)">{{ 'adminFeedback.showLess' | translate }}</button>
                        }
                      }
                    } @else {
                      <div class="reply-body" [innerHTML]="reply.html"></div>
                    }
                    <sc-feedback-attachments [images]="reply.images" />
                  </div>
                }
              </div>
            }

            <!-- REVIEW GATE — the work is done, the topic is not. It stays here
                 until an admin looked at the result and decided, instead of
                 dropping into the archive unseen (migration 20260729130000). -->
            @if (inReview(m)) {
              <section class="review-gate">
                <div class="rg-head">
                  <span class="rg-badge">{{ 'adminFeedback.status.review' | translate }}</span>
                  <span class="rg-title">
                    {{ (m.status === 'issue_created'
                        ? 'adminFeedback.review.headlineIssue'
                        : 'adminFeedback.review.headlineShipped') | translate }}
                  </span>
                </div>
                @if (!embedded()) {
                  <p class="rg-hint">{{ 'adminFeedback.review.hint' | translate }}</p>
                }
                <div class="rg-actions">
                  <button class="sc-btn micro accept" (click)="acceptReview(m)" [disabled]="busy()">
                    ✓ {{ 'adminFeedback.review.accept' | translate }}
                  </button>
                  <button class="sc-btn micro" (click)="reopenFromReview(m)" [disabled]="busy()">
                    ↻ {{ 'adminFeedback.review.reopen' | translate }}
                  </button>
                </div>
              </section>
            }

            <!-- Reply composer — full parity with the new-topic box (toolbar,
                 Enter to send / Shift+Enter for a newline, image paste/drop,
                 list continuation). On an archived topic a reply reopens it
                 (shipped: post-ship continuation; issue_created / declined /
                 rejected: the reopen trigger, migration 20260726180000) — so a
                 hint says as much before the admin types. -->
            @if (archived(m)) {
              <p class="reopen-hint">↻ {{ 'adminFeedback.thread.reopenHint' | translate }}</p>
            }
            <div class="reply-compose">
              <sc-feedback-composer
                [compact]="true"
                [draftScope]="threadScope(m.id)"
                [busy]="busy()"
                placeholder="adminFeedback.thread.replyPlaceholder"
                sendLabel="adminFeedback.thread.reply"
                [onSubmit]="replySubmitFor(m.id)" />
            </div>

            <!-- AUTHOR CHANNEL — only for topics a non-admin filed. Everything
                 in this block is visible to that person; the thread above (the
                 admin <-> Claude conversation) never is. Keeping the two
                 visually apart is the whole point of the framed section. -->
            @if (fromUser(m)) {
              <section class="author-channel">
                <header class="ac-head">
                  <span class="ac-title">{{ 'adminFeedback.userTopic.channelTitle' | translate }}</span>
                  <span class="ac-status">
                    {{ 'adminFeedback.userTopic.seesStatus' | translate }}
                    <strong>{{ ('userFeedback.status.' + authorFacingStatus(m)) | translate }}</strong>
                  </span>
                </header>
                <p class="ac-hint">{{ 'adminFeedback.userTopic.channelHint' | translate }}</p>

                @if (authorMessagesFor(m.id).length > 0) {
                  <div class="ac-thread">
                    @for (am of authorMessagesFor(m.id); track am.id) {
                      <div class="reply" [class.is-self]="am.from_admin">
                        <div class="reply-head">
                          <span class="reply-author">
                            {{ (am.from_admin ? 'adminFeedback.userTopic.fromTeam' : 'adminFeedback.userTopic.fromAuthor') | translate }}
                          </span>
                          @if (am.is_question) {
                            <span class="reply-badge">{{ 'adminFeedback.userTopic.questionBadge' | translate }}</span>
                          }
                          <span class="reply-ts">{{ am.created_at | scDate: 'datetime' }}</span>
                        </div>
                        @let authorReply = render(am.body);
                        <div class="reply-body" [innerHTML]="authorReply.html"></div>
                        <sc-feedback-attachments [images]="authorReply.images" />
                      </div>
                    }
                  </div>
                }

                @if (!archived(m)) {
                  <label class="ac-ask">
                    <input type="checkbox" [checked]="askAuthor()" (change)="toggleAskAuthor()" />
                    {{ 'adminFeedback.userTopic.asQuestion' | translate }}
                  </label>
                  <sc-feedback-composer
                    [compact]="true"
                    [draftScope]="authorScope(m.id)"
                    [busy]="busy()"
                    placeholder="adminFeedback.userTopic.messagePlaceholder"
                    sendLabel="adminFeedback.userTopic.messageSend"
                    [onSubmit]="authorReplySubmitFor(m.id)" />
                }
              </section>
            }

            <!-- Any admin may delete any topic (board is admin-only) — clears a
                 topic once its handling/rejection is accepted. Active topics can
                 additionally be archived as "issue created" by pasting the
                 GitHub issue url (feedback eeba60e7). -->
            <div class="msg-actions">
              <!-- A topic in the sign-off gate has already produced its outcome:
                   the only decisions left are the two in the gate above, so the
                   "hand it to an issue" / triage controls stay out of the way. -->
              @if (!archived(m) && !inReview(m)) {
                @if (issueFormFor() === m.id) {
                  <form class="issue-form" (submit)="submitIssueRef(m, $event)">
                    <input
                      class="issue-input"
                      type="url"
                      required
                      [value]="issueUrl()"
                      (input)="issueUrl.set($any($event.target).value)"
                      [attr.placeholder]="'adminFeedback.issue.placeholder' | translate"
                      [attr.aria-label]="'adminFeedback.issue.placeholder' | translate" />
                    <button class="sc-btn micro" type="submit" [disabled]="busy()">
                      {{ 'adminFeedback.issue.save' | translate }}
                    </button>
                    <button class="sc-btn micro" type="button" (click)="cancelIssueForm()">
                      {{ 'adminFeedback.issue.cancel' | translate }}
                    </button>
                  </form>
                } @else {
                  <button class="sc-btn micro" (click)="openIssueForm(m)" [disabled]="busy()">
                    {{ 'adminFeedback.issue.mark' | translate }}
                  </button>
                }
                <!-- A user topic is held back from the autonomous routine until
                     an admin has read it and releases it (feedback 5920cf8c). -->
                @if (untriaged(m)) {
                  <button class="sc-btn micro" (click)="releaseToRoutine(m)" [disabled]="busy()">
                    {{ 'adminFeedback.userTopic.release' | translate }}
                  </button>
                }
              }

              <!-- A user-submitted topic is never hard-deleted: the author has
                   to keep seeing "nicht umgesetzt" plus the reason, so the
                   delete button becomes "nicht umsetzen & löschen" with a
                   mandatory comment (feedback 5920cf8c, point 4). -->
              @if (fromUser(m) && !archived(m) && !inReview(m)) {
                @if (declineFormFor() === m.id) {
                  <form class="decline-form" (submit)="declineTopic(m, $event)">
                    <textarea
                      class="decline-input"
                      rows="3"
                      required
                      [value]="declineNote()"
                      (input)="declineNote.set($any($event.target).value)"
                      [attr.placeholder]="'adminFeedback.decline.placeholder' | translate"
                      [attr.aria-label]="'adminFeedback.decline.placeholder' | translate"></textarea>
                    <div class="decline-actions">
                      <button class="sc-btn micro danger" type="submit" [disabled]="busy()">
                        {{ 'adminFeedback.decline.confirm' | translate }}
                      </button>
                      <button class="sc-btn micro" type="button" (click)="cancelDeclineForm()">
                        {{ 'adminFeedback.decline.cancel' | translate }}
                      </button>
                    </div>
                  </form>
                } @else {
                  <button class="sc-btn micro danger" (click)="openDeclineForm(m)" [disabled]="busy()">
                    {{ 'adminFeedback.decline.mark' | translate }}
                  </button>
                }
              } @else {
                <button class="sc-btn micro danger" (click)="remove(m)" [disabled]="busy()">
                  {{ 'adminFeedback.delete' | translate }}
                </button>
              }
            </div>
           </div>
          }
        </article>
      </ng-template>

      <!-- New-topic composer — only in the overview; the processing mode has its
           own inline answer box and the dashboard is read-only. On the full board
           it stays pinned below the list; in the docked panel it collapses to a
           slim "＋ Neues Thema" bar so the thread list owns the panel, and expands
           on demand (feedback 3133f9). -->
      @if (view() === 'overview') {
        @if (!embedded()) {
          <sc-feedback-composer
            class="main-composer"
            [draftScope]="draftScope"
            [busy]="busy()"
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
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
    /* Embedded inside the FAB chat panel: fill the panel, scroll the history,
       and keep the composer pinned below it (never behind it). */
    .page.embedded {
      max-width: none;
      gap: 12px;
      flex: 1 1 auto;
      min-height: 0;
      padding: 14px;
      box-sizing: border-box;
    }
    .page.embedded .board { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
    .page.embedded .main-composer { position: static; }

    /* New-topic composer stays pinned to the bottom of the board on the full
       page; the embedded panel scrolls the board and keeps it static. */
    .main-composer {
      position: sticky;
      bottom: 12px;
      z-index: 1;
    }

    /* Non-interactive day heading between dated groups of topics. */
    .date-group {
      margin: 6px 2px 0;
      font-size: max(0.66rem, var(--sc-fs-floor));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--sc-fg-2);
    }
    .date-group:first-child { margin-top: 0; }

    /* Compact panel one-liner: chevron · title · author · status, on one row. */
    .msg-head.one-liner {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 0;
      background: transparent;
      border: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .msg-head.one-liner .chev {
      flex: 0 0 auto;
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      transition: transform 0.16s ease;
    }
    .msg-head.one-liner .chev.open { transform: rotate(90deg); }
    .msg-head.one-liner .topic-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-weight: 600;
      font-size: 0.86rem;
      color: var(--sc-fg-0);
    }
    .msg-head.one-liner .row-author {
      flex: 0 0 auto;
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
    }
    .msg-head.one-liner:hover .topic-title { color: var(--sc-accent); }
    /* Reference number (feedback 21587480): monospaced digits so a column of
       them lines up, and dim enough that the topic text stays the thing you
       read. It is a handle, not a headline. */
    .topic-no {
      flex: 0 0 auto;
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
      user-select: all;
    }
    .msg-head.one-liner:focus-visible {
      outline: none;
      border-radius: 6px;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3);
    }
    /* The status pill keeps its own colours; it trails the row via the title's grow. */
    .msg-head.one-liner .status-pill { flex: 0 0 auto; margin-left: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; }

    .board { display: flex; flex-direction: column; gap: 12px; }
    /* Processing mode / dashboard reuse the board's scroll box but never its
       list rhythm, so they get their own modifier instead of the list styles. */
    .board.alt { gap: 10px; }

    /* ---- View switch: Übersicht · Abarbeiten · Fortschritt ---- */
    .view-switch {
      display: flex;
      align-items: stretch;
      gap: 2px;
      padding: 2px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .view-tab {
      flex: 1 1 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 5px 8px;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.03em;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .view-tab:hover { color: var(--sc-fg-0); }
    .view-tab.active {
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      color: var(--sc-accent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 45%, transparent);
    }
    .view-tab:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.35em;
      padding: 0 4px;
      border-radius: 999px;
      background: color-mix(in srgb, #a78bfa 28%, transparent);
      color: #a78bfa;
      font-size: max(0.64rem, var(--sc-fs-floor));
      font-weight: 700;
    }

    /* ---- "something shipped" banner ---- */
    .ship-cheer {
      margin: 0;
      padding: 7px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--sc-success) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-success) 45%, transparent);
      color: var(--sc-success);
      font-size: 0.82rem;
      font-weight: 600;
      animation: cheer-in 0.4s ease-out;
    }
    @keyframes cheer-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ship-cheer { animation: none; }
    }

    /* Quick-access author filter: chip row that scopes the board to one creator.
       The chips themselves share their look with the status chips below. */
    .author-filter { display: flex; flex-wrap: wrap; gap: 6px; }
    /* Board toolbar: filters (status + author) on the left, expand-all right. */
    .board-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

    /* Search field: its own full-width row above the filters, so it works in the
       narrow docked panel and on the wide board alike (feedback 12476cec). The
       UA's built-in clear cross is dropped for our own labelled button. */
    .search-box {
      flex: 1 0 100%; display: flex; align-items: center; gap: 6px;
      padding: 0 10px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border);
      &:focus-within { border-color: var(--sc-accent); }
      .search-icon, button { color: var(--sc-fg-2); }
      input {
        flex: 1 1 auto; min-width: 0; padding: 6px 0; font: inherit; font-size: 0.8rem;
        background: transparent; border: 0; color: var(--sc-fg-0);
        &:focus { outline: none; }
        &::placeholder { color: var(--sc-fg-2); }
        &::-webkit-search-cancel-button { display: none; }
      }
      button { padding: 0 4px; background: transparent; border: 0; font: inherit; cursor: pointer; }
      button:hover { color: var(--sc-fg-0); }
    }
    /* Status + author chip groups now share one wrapping row (feedback 605d317d);
       the wider column gap keeps the two groups visually distinct. */
    .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
    .status-filter { display: flex; flex-wrap: wrap; gap: 6px; }
    /* Status and author chips are the same control with a different scope, so
       they share one base look; only the per-status accents below differ. */
    .status-chip, .author-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.74rem, var(--sc-fs-floor));
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .status-chip:hover, .author-chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .status-chip.active, .author-chip.active { color: var(--sc-accent); border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.12); }
    .status-chip:focus-visible, .author-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }
    /* The needs_input filter carries the same violet accent as its status pill. */
    .status-chip.needs_input.active { color: #a78bfa; border-color: #a78bfa; background: rgba(167, 139, 250, 0.14); }
    /* "Rückfrage an Absender" — same rosé as its pill, so the two directions of
       Rückfrage stay distinguishable in the filter row too. */
    .status-chip.needs_input_author.active { color: #f472b6; border-color: #f472b6; background: rgba(244, 114, 182, 0.14); }
    /* Archive chips echo their status pills: shipped green, issue indigo. */
    .status-chip.shipped.active { color: var(--sc-success); border-color: var(--sc-success); background: rgba(74, 222, 128, 0.14); }
    .status-chip.issue_created.active { color: #818cf8; border-color: #818cf8; background: rgba(129, 140, 248, 0.14); }

    /* Active ↔ Archive tabs leading the overview's filter row. Deliberately a
       quieter segmented control than the top-level .view-switch — it splits one
       list, it does not switch the board's mode. */
    .archive-switch {
      display: inline-flex;
      padding: 2px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
    }
    .archive-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 12px;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .archive-tab:hover { color: var(--sc-fg-0); }
    /* ---- Review gate ----
       Deliberately loud: it is the one card state that asks for a decision
       rather than reporting one, and it sits between the thread and the reply
       box so it cannot be scrolled past. */
    .review-gate {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--sc-success);
      border-left-width: 3px;
      border-radius: 8px;
      background: rgba(74, 222, 128, 0.08);
    }
    .rg-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rg-badge {
      padding: 1px 8px;
      border: 1px solid var(--sc-success);
      border-radius: 999px;
      color: var(--sc-success);
      font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.05em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .rg-title { font-size: 0.82rem; font-weight: 600; color: var(--sc-fg-0); }
    .rg-hint { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); line-height: 1.45; color: var(--sc-fg-2); }
    .rg-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .rg-actions .accept { border-color: var(--sc-success); color: var(--sc-success); }
    .rg-actions .accept:hover { background: rgba(74, 222, 128, 0.16); }
    .rg-actions .ghost { border-color: var(--sc-border); color: var(--sc-fg-2); }
    .rg-actions .ghost:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    /* ---- Sign-off queue (the 4th view) ----
       One row per finished topic: what it was, where the result is, and the two
       decisions. Deliberately flat — this is a checklist, not a reading view;
       the full thread is one "Thema öffnen" away. */
    .rv { display: flex; flex-direction: column; gap: 10px; }
    .rv-lead { margin: 0; font-size: 0.86rem; font-weight: 600; color: var(--sc-fg-0); }
    .rv-hint { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); line-height: 1.45; color: var(--sc-fg-2); }
    .rv-card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 10px 12px;
      border-left: 3px solid var(--sc-success);
    }
    .rv-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rv-no {
      flex: 0 0 auto; color: var(--sc-fg-2);
      font-size: max(0.74rem, var(--sc-fs-floor)); font-weight: 600;
      font-variant-numeric: tabular-nums; user-select: all;
    }
    .rv-title {
      flex: 1 1 auto; min-width: 0;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      font-size: 0.88rem; font-weight: 600; color: var(--sc-fg-0);
    }
    .rv-ts { flex: 0 0 auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .rv-empty {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 30px 20px; text-align: center;
    }
    .rv-empty h3 { margin: 0; font-size: 1rem; }
    .rv-empty p { margin: 0; color: var(--sc-fg-2); font-size: 0.84rem; }
    .rv-empty-icon { font-size: 1.9rem; }
    /* The sign-off badge is green like the gate it belongs to, not violet like
       the Rückfrage badge on the processing tab. */
    .tab-badge.review {
      background: color-mix(in srgb, var(--sc-success) 28%, transparent);
      color: var(--sc-success);
    }

    .status-chip.review { border-color: var(--sc-success); color: var(--sc-success); }
    .status-chip .chip-count { margin-left: 5px; opacity: 0.75; }

    .archive-tab.active { background: rgba(0, 212, 255, 0.14); color: var(--sc-accent); }
    .archive-tab:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }
    .archive-tab .tab-count {
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-weight: 500;
      color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    .archive-tab.active .tab-count { color: inherit; }

    /* ---- Compact toolbar icon cluster (docked panel, feedback 3133f9) ----
       Reveal search · fold the status/author chips · expand-all, kept to the
       right of the always-visible Aktiv/Archiv tabs so the prime row is one
       line. On the full board this cluster never renders (chips are inline). */
    .toolbar-icons { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
    .tb-icon {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 28px;
      padding: 4px 9px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.74rem, var(--sc-fs-floor));
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .tb-icon:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .tb-icon.active { color: var(--sc-accent); border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.12); }
    .tb-icon:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }
    .tb-icon .chev { display: inline-block; font-size: max(0.72rem, var(--sc-fs-floor)); transition: transform 0.16s ease; }
    .tb-icon .chev.open { transform: rotate(90deg); }
    /* Active-filter marker on the collapsed "Filter" button, so a fold that is
       hiding an applied chip still reads as "narrowed". */
    .tb-icon .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sc-accent-hot); }

    /* ---- Collapsed new-topic bar (docked panel) ----
       Stands in for the pinned composer: one tap opens the full compose sheet,
       so writing a topic is one click away but reading the list is the default. */
    .new-topic-bar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      flex: 0 0 auto;
      padding: 9px 14px;
      background: var(--sc-bg-2);
      border: 1px dashed var(--sc-border);
      border-radius: 10px;
      color: var(--sc-fg-1);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .new-topic-bar:hover { color: var(--sc-accent); border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.08); }
    .new-topic-bar:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    .new-topic-bar .nt-plus { font-size: 1.05rem; line-height: 1; color: var(--sc-accent); }

    /* ---- Expanded compose sheet (docked panel) ---- */
    .compose-sheet {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 0 0 auto;
      padding: 10px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 10px;
    }
    .cs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cs-title {
      font-size: max(0.72rem, var(--sc-fs-floor));
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      color: var(--sc-fg-2);
    }
    .cs-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: 0;
      background: transparent;
      color: var(--sc-fg-2);
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .cs-close:hover { color: var(--sc-fg-0); background: rgba(255, 255, 255, 0.06); }
    .cs-close:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }

    /* One motivating totals line under the filters (feedback 605d317d): open
       Rückfragen (violet, like their status pill) + shipped so far (accent).
       "In Arbeit" is intentionally not shown. */
    .board-stats {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
      margin: 0; padding: 2px 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .board-stats .stat.rueckfragen { color: #a78bfa; font-weight: 600; }
    .board-stats .stat.review { color: var(--sc-success); font-weight: 600; }
    .board-stats .stat.shipped { color: var(--sc-accent); font-weight: 600; }
    .board-stats .stat.issues { color: #818cf8; font-weight: 600; }
    .board-stats .stat + .stat::before {
      content: '·'; margin-right: 8px; color: var(--sc-fg-2); font-weight: 400;
    }
    /* Docked panel: same numbers, less room — smaller and tighter, never dropped. */
    .board-stats.compact { gap: 6px; padding: 0; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .board-stats.compact .stat + .stat::before { margin-right: 6px; }

    /* Archive tab list — done topics, dimmed a touch so the tab reads as history. */
    .archive-list { display: flex; flex-direction: column; gap: 12px; }
    .archive-list .msg { opacity: 0.82; }
    .archive-list .msg:hover, .archive-list .msg:focus-within { opacity: 1; }
    .load-more {
      align-self: center;
      margin-top: 4px;
      padding: 7px 16px;
      background: transparent;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.76rem, var(--sc-fs-floor));
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .load-more:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .load-more:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }

    .msg { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .msg.is-self { box-shadow: inset 2px 0 0 var(--sc-accent); }
    /* In the compact FAB panel the card's gradient (bg-2 → bg-1) is identical to
       the panel's own background, so topics blended together and the separation
       between individual feedbacks was hard to read (feedback cfa46ac2). Lift
       each embedded card onto a distinct, more prominent surface with a clearer
       border + shadow, so every feedback reads as its own boxed area again. */
    .page.embedded .msg {
      background: var(--sc-bg-3);
      border-color: color-mix(in srgb, var(--sc-border) 55%, var(--sc-fg-2));
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
    }
    .page.embedded .msg.is-self {
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: inset 2px 0 0 var(--sc-accent), 0 1px 4px rgba(0, 0, 0, 0.28);
    }
    /* Detail region under a topic head — its own column so the 8px rhythm is kept
       once the children are wrapped for the collapse animation. */
    .msg-detail { display: flex; flex-direction: column; gap: 8px; }
    .msg-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .author { font-weight: 600; font-size: 0.9rem; }
    .ts { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }

    .status-pill {
      margin-left: auto;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.open { background: rgba(0, 212, 255, 0.16); color: var(--sc-accent); }
      &.in_progress { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
      &.shipped { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.rejected { background: rgba(122, 134, 156, 0.2); color: var(--sc-fg-2); }
      /* Handed off to a GitHub issue — terminal like shipped, but distinct. */
      &.issue_created { background: rgba(129, 140, 248, 0.2); color: #818cf8; }
      &.needs_input { background: rgba(167, 139, 250, 0.2); color: #a78bfa; }
      /* The mirror image: the admin asked the topic's AUTHOR and waits on them.
         Rosé rather than violet, so the two Rückfrage directions never read the
         same at a glance (feedback 5920cf8c). */
      &.needs_input_author { background: rgba(244, 114, 182, 0.2); color: #f472b6; }
      /* Admin answered a Rückfrage → awaiting the routine (distinct from a
         needs_input topic still waiting on the admin). */
      &.answered { background: rgba(45, 212, 191, 0.2); color: #2dd4bf; }
      /* Shipped topic reopened by the admin's post-ship reply (review loop). */
      &.continued { background: rgba(74, 222, 128, 0.2); color: var(--sc-success); }
    }
    /* A second pill (the "beantwortet" marker) trails the bucket pill instead of
       being pushed to the far edge by another margin-left: auto. */
    .status-pill + .status-pill { margin-left: 0; }

    .msg-body {
      font-size: 0.92rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .msg-body :first-child { margin-top: 0; }
    .msg-body :last-child { margin-bottom: 0; }
    .msg-body p { margin: 0 0 8px; }
    .msg-body ul, .msg-body ol { margin: 0 0 8px; padding-left: 1.4em; }
    .msg-body li { margin: 2px 0; }
    .msg-body h3, .msg-body h4, .msg-body h5 { margin: 10px 0 6px; line-height: 1.3; }
    .msg-body h3 { font-size: 1.02rem; }
    .msg-body h4 { font-size: 0.95rem; }
    .msg-body h5 { font-size: 0.88rem; color: var(--sc-fg-1); }
    .msg-body code {
      font-family: monospace;
      font-size: 0.85em;
      background: var(--sc-bg-2);
      padding: 1px 5px;
      border-radius: 3px;
    }
    .msg-body a { color: var(--sc-accent); }
    /* Screenshots are not part of the body flow — see sc-feedback-attachments. */
    .msg-body blockquote {
      margin: 0 0 8px;
      padding: 4px 12px;
      border-left: 3px solid var(--sc-border);
      color: var(--sc-fg-1);
    }
    /* Clamped two-sentence preview (plain text) with an inline expand control. */
    .msg-body.clamped, .reply-body.clamped { color: var(--sc-fg-1); }
    .body-toggle {
      display: inline;
      margin-left: 6px;
      padding: 0;
      background: transparent;
      border: 0;
      color: var(--sc-accent);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .body-toggle:hover { text-decoration: underline; }
    .body-toggle:focus-visible { outline: none; text-decoration: underline; }

    .ship-ref { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; align-self: flex-start; }
    .ship-ref:hover { text-decoration: underline; }
    /* Issue links carry the issue_created accent so the archive reads at a glance. */
    .ship-ref.issue { color: #818cf8; }
    .proc-note {
      margin: 0;
      font-size: 0.8rem;
      color: var(--sc-fg-2);
      font-style: italic;
    }

    /* ---- Per-topic thread ---- */
    .thread { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding-left: 10px; border-left: 2px solid var(--sc-border); }
    .reply { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--sc-bg-2); }
    .reply.is-self { box-shadow: inset 2px 0 0 var(--sc-accent); }
    .reply.is-system { background: color-mix(in srgb, #a78bfa 12%, var(--sc-bg-2)); box-shadow: inset 2px 0 0 #a78bfa; }
    .reply-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .reply-author { font-weight: 600; font-size: 0.82rem; }
    .reply-badge {
      font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em;
      padding: 1px 6px; border-radius: 999px;
      background: color-mix(in srgb, #a78bfa 25%, transparent); color: #a78bfa;
    }
    .reply-ts { margin-left: auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .reply-body { font-size: 0.88rem; line-height: 1.45; overflow-wrap: anywhere; }
    .reply-body :first-child { margin-top: 0; }
    .reply-body :last-child { margin-bottom: 0; }
    .reply-body p { margin: 0 0 6px; }
    .reply-body a { color: var(--sc-accent); }
    .reply-body code { font-family: monospace; font-size: 0.85em; background: var(--sc-bg-1); padding: 1px 5px; border-radius: 3px; }

    .reply-compose { margin-top: 4px; }
    /* Archived topics: a reply reopens them, so say so above the composer. */
    .reopen-hint {
      margin: 4px 0 0;
      font-size: max(0.78rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      font-style: italic;
    }

    .msg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    /* Inline "issue created" hand-off: paste the issue url, confirm, archived. */
    .issue-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .issue-input {
      flex: 1 1 220px;
      min-width: 0;
      padding: 4px 8px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      color: var(--sc-fg-0);
      font: inherit;
      font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .issue-input:focus-visible { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25); }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

    /* ---- User-submitted topics (feedback 5920cf8c) ----
       The author channel is framed and tinted so it is never confused with the
       admin <-> routine thread above it: everything inside is readable by the
       person who filed the topic. The decline form's comment is mandatory —
       it is the explanation that author gets to read. */
    .author-channel, .ac-thread, .decline-form { display: flex; flex-direction: column; gap: 8px; }
    .author-channel {
      margin-top: 6px; padding: 10px; border-radius: 8px;
      border: 1px dashed var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 6%, transparent);
    }
    .ac-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ac-title {
      font-size: max(0.72rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.08em; font-weight: 600; color: var(--sc-accent);
    }
    .ac-status { margin-left: auto; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ac-status strong { color: var(--sc-fg-1); }
    .ac-hint { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ac-ask { display: inline-flex; align-items: center; gap: 6px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .status-pill.from-user { border-color: var(--sc-accent); color: var(--sc-accent); }
    .status-pill.untriaged { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }

    .decline-form { gap: 6px; flex: 1 1 260px; }
    .decline-input {
      width: 100%; box-sizing: border-box; padding: 6px 8px; resize: vertical;
      background: var(--sc-bg-2); border: 1px solid var(--sc-danger);
      border-radius: 6px; color: var(--sc-fg-0); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
    }
    .decline-input:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.25); }
    .decline-actions { display: flex; gap: 6px; }

    @media (max-width: 640px) {
      .main-composer { position: static; }
      .status-pill { margin-left: 0; }
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

  /** When embedded in the feedback FAB panel, the page chrome (title, subtitle,
   *  manual refresh) is dropped — the panel supplies its own header. */
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

  // ---- View switch (feedback 605d317d, phase 2/3) -------------------------

  /**
   * Which of the three board modes is showing. Persisted (behind the
   * preferences consent) so reopening the FAB panel lands where the admin left
   * off — the panel is mounted once and merely hidden while minimized, so the
   * switch is equally available docked, maximized and on the full page.
   */
  readonly view = signal<FeedbackView>(this.readView());

  setView(v: FeedbackView): void {
    this.view.set(v);
    if (!this.consent.preferencesAllowed()) return;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode / quota — the in-memory signal still works */
    }
  }

  /**
   * The remembered view wins; without one the panel opens in the processing
   * mode (feedback fda4e3ea). Opening the board is nearly always "what do I
   * have to answer", not "let me browse the archive" — and the queue's own
   * empty state hands the admin on to the numbers when there is nothing to do.
   */
  private readView(): FeedbackView {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw === 'overview' || raw === 'workflow' || raw === 'review' || raw === 'progress') return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_VIEW;
  }

  /**
   * Topics the admin ticked off in the processing mode, mapped to the topic's
   * `updated_at` at that moment: if the routine touches the topic afterwards
   * the stamp no longer matches and the item comes back into the queue.
   */
  private readonly handled = signal<ReadonlyMap<string, string>>(this.readHandled());

  markHandled(id: string): void {
    const row = this.messages().find((m) => m.id === id);
    if (!row) return;
    const next = new Map(this.handled());
    next.set(id, row.updated_at);
    this.handled.set(next);
    this.persistHandled(next);
  }

  private persistHandled(map: ReadonlyMap<string, string>): void {
    if (!this.consent.preferencesAllowed()) return;
    try {
      localStorage.setItem(HANDLED_KEY, JSON.stringify(Array.from(map.entries())));
    } catch {
      /* ignore */
    }
  }

  private readHandled(): ReadonlyMap<string, string> {
    try {
      const raw = localStorage.getItem(HANDLED_KEY);
      if (!raw) return new Map();
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Map();
      return new Map(
        parsed.filter(
          (e): e is [string, string] =>
            Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string',
        ),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Whose topics the processing mode walks through (feedback abfa97c6).
   * Persisted behind the preferences consent like the view itself, so the pick
   * survives reopening the panel.
   */
  readonly workflowScope = signal<WorkflowScope>(this.readWorkflowScope());

  setWorkflowScope(scope: WorkflowScope): void {
    this.workflowScope.set(scope);
    if (!this.consent.preferencesAllowed()) return;
    try {
      localStorage.setItem(WORKFLOW_SCOPE_KEY, scope);
    } catch {
      /* private mode / quota — the in-memory signal still works */
    }
  }

  private readWorkflowScope(): WorkflowScope {
    try {
      const raw = localStorage.getItem(WORKFLOW_SCOPE_KEY);
      if (raw === 'mine' || raw === 'others' || raw === 'all') return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_WORKFLOW_SCOPE;
  }

  /** The full processing queue: the open Rückfragen, oldest first. */
  private readonly workflowQueueAll = computed(() =>
    buildWorkflowQueue(this.messages(), this.threads(), this.handled()),
  );

  /** Queue size per scope — the KPI counts on the mode's scope switch. */
  readonly workflowScopeCounts = computed(() =>
    workflowScopeCounts(this.workflowQueueAll(), this.selfId()),
  );

  /**
   * The queue as the processing mode shows it — narrowed to the chosen scope.
   * The view switch's badge reads from here too, so it promises exactly what
   * the mode will hand over.
   */
  readonly workflowQueue = computed(() =>
    filterWorkflowScope(this.workflowQueueAll(), this.workflowScope(), this.selfId()),
  );

  /** Stable reply handler handed to the processing mode's inline composer. */
  readonly workflowReplyBound = (id: string, payload: ComposerPayload): Promise<boolean> =>
    this.sendReply(id, payload);

  /** How many topics shipped since the last poll — drives the ship banner. */
  readonly shipCheer = signal(0);
  /** Shipped ids as of the previous refresh; `null` until the first load lands. */
  private shippedSeen: Set<string> | null = null;
  private shipCheerTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Celebrate topics that shipped between two polls. The very first load only
   * seeds the baseline — otherwise every page open would confetti the entire
   * shipped history.
   */
  private detectShipped(rows: readonly FeedbackRow[]): void {
    const now = new Set(rows.filter((r) => r.status === 'shipped').map((r) => r.id));
    const before = this.shippedSeen;
    this.shippedSeen = now;
    if (before === null) return;
    let fresh = 0;
    for (const id of now) if (!before.has(id)) fresh++;
    if (fresh === 0) return;
    this.shipCheer.set(fresh);
    this.celebration.burst();
    if (this.shipCheerTimer) clearTimeout(this.shipCheerTimer);
    this.shipCheerTimer = setTimeout(() => this.shipCheer.set(0), 6000);
  }

  /**
   * The presentation bucket of a topic — the board's one bucketing rule (see
   * {@link feedbackBucket}). Every view here (filter chips, counts, list,
   * pills, TOC) goes through this, so an answered Rückfrage is consistently
   * treated as ToDo instead of each view deciding for itself.
   */
  bucketOf(m: FeedbackRow): FeedbackBucket {
    return feedbackBucket(m, this.threads().get(m.id));
  }

  /** The status vocabulary a topic's bucket is labelled and coloured with. */
  bucketLabel(m: FeedbackRow): BucketLabelKey {
    return bucketLabelStatus(this.bucketOf(m));
  }

  /**
   * True when the admin has answered a Rückfrage and the topic is now waiting on
   * the routine: status is `needs_input` but the newest thread reply is human,
   * so the bucket already flipped to ToDo. Drives the small extra "beantwortet"
   * marker next to the ToDo pill — the topic is back on the routine's pile, the
   * marker only records that the admin's part is done.
   */
  isAnsweredAwaitingRoutine(m: FeedbackRow): boolean {
    return m.status === 'needs_input' && this.bucketOf(m) === 'todo';
  }

  /**
   * True when a shipped topic was reopened by the admin's post-ship reply (the
   * routine's review loop). Like the "beantwortet" marker, it trails the ToDo
   * pill — the topic is back on the routine's pile, the marker records that it is
   * a continuation of an already-shipped change rather than a brand-new item.
   */
  continuedAfterShip(m: FeedbackRow): boolean {
    return isContinuedAfterShip(m, this.threads().get(m.id));
  }

  /**
   * Which half of the overview list is shown (feedback eeba60e7): the working
   * set or the Archive of terminal topics (shipped + issue-created + legacy
   * rejected). Replaces the old collapsible "shipped" stack — done work now has
   * its own tab instead of a drawer at the bottom of the active list.
   */
  readonly boardTab = signal<BoardTab>('active');

  /** Template-side alias for the shared {@link isArchived} rule. */
  archived(m: FeedbackRow): boolean {
    return isArchived(m, this.threads().get(m.id));
  }

  /** Template-side alias for the shared {@link refKind} rule. */
  linkKind(m: FeedbackRow): 'issue' | 'ship' {
    return refKind(m);
  }

  /**
   * Switch the overview's Active/Archive tab. The status chips differ per tab
   * (active: ToDo / in_progress / awaiting_admin, archive: shipped /
   * issue_created / rejected), so a selection carried across would filter
   * everything away — clear it.
   */
  setBoardTab(tab: BoardTab): void {
    if (this.boardTab() === tab) return;
    this.boardTab.set(tab);
    this.statusFilter.set(null);
  }

  /** Sentinel author-filter key for topics with no author (routine/orphaned). */
  private static readonly NO_AUTHOR = '__none__';
  /** Quick-access filter: an author_id (or NO_AUTHOR) to show only, or null for all. */
  readonly authorFilter = signal<string | null>(null);

  /** Distinct authors across all topics, most-topics first — feeds the filter chips. */
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

  private matchesAuthor(m: FeedbackRow): boolean {
    const f = this.authorFilter();
    if (f === null) return true;
    return (m.author_id ?? AdminFeedbackComponent.NO_AUTHOR) === f;
  }

  /** Toggle the author quick-filter: clicking the active chip clears it. */
  setAuthorFilter(id: string | null): void {
    this.authorFilter.update((cur) => (cur === id ? null : id));
  }

  // ---- Search -------------------------------------------------------------

  /** Raw search input. Blank (or punctuation-only) means "no search active". */
  readonly searchQuery = signal('');

  /** True once the query holds at least one usable term. */
  readonly searchActive = computed(() => searchTokens(this.searchQuery()).length > 0);

  /**
   * The scored hits for the current query, keyed by topic id — computed once for
   * the whole board so both tabs, the counts and the chips read the same result
   * set instead of re-scoring per view. Empty while no search is active, which is
   * exactly what {@link matchesSearch} treats as "everything passes".
   */
  private readonly searchHits = computed<ReadonlyMap<string, FeedbackSearchHit>>(() => {
    const query = this.searchQuery();
    if (!this.searchActive()) return new Map();
    const hits = new Map<string, FeedbackSearchHit>();
    for (const hit of searchFeedback(this.messages(), this.threads(), query)) {
      hits.set(hit.row.id, hit);
    }
    return hits;
  });

  private matchesSearch(m: FeedbackRow): boolean {
    return !this.searchActive() || this.searchHits().has(m.id);
  }

  /** Relevance of a topic for the current query; 0 when it is not a hit. */
  private searchScore(m: FeedbackRow): number {
    return this.searchHits().get(m.id)?.score ?? 0;
  }

  /** A hit that only matched inside the thread — worth flagging in the row. */
  threadOnlyHit(m: FeedbackRow): boolean {
    const hit = this.searchHits().get(m.id);
    return !!hit && hit.inThread && !hit.inBody;
  }

  /**
   * Update the query. Also rewinds the archive paging, so a fresh search always
   * starts at its most relevant page instead of an offset from the last one.
   */
  setSearch(value: string): void {
    this.searchQuery.set(value);
    this.archiveVisible.set(AdminFeedbackComponent.ARCHIVE_PAGE);
  }

  clearSearch(): void {
    this.setSearch('');
  }

  /**
   * Status quick-filter: narrow the active board to a single presentation bucket
   * (or null for all active topics). Pairs with the author filter — both
   * AND-narrow the list and the quick-access TOC. The `awaiting_admin` filter is
   * the important one: it surfaces exactly the Rückfragen the admin still has to
   * answer (feedback 69f3f015) — an already-answered one sits in ToDo instead,
   * where the routine will pick it up (feedback 34c44134).
   */
  readonly statusFilter = signal<FeedbackBucket | null>(null);

  setStatusFilter(b: FeedbackBucket | null): void {
    this.statusFilter.update((cur) => (cur === b ? null : b));
  }

  private matchesStatus(m: FeedbackRow): boolean {
    const f = this.statusFilter();
    return f === null || this.bucketOf(m) === f;
  }

  /** Per-bucket topic counts (author-filtered) backing the status filter chips. */
  readonly bucketCounts = computed(() => {
    const counts: Record<FeedbackBucket, number> = {
      todo: 0,
      awaiting_admin: 0,
      awaiting_author: 0,
      in_progress: 0,
      review: 0,
      shipped: 0,
      issue_created: 0,
      rejected: 0,
      declined: 0,
    };
    for (const m of this.messages()) {
      if (this.matchesAuthor(m) && this.matchesSearch(m)) counts[this.bucketOf(m)]++;
    }
    return counts;
  });

  /**
   * Aggregate, motivating totals for the CURRENT filtering (author scope only —
   * the status filter just picks a view, so the headline numbers stay stable as
   * the admin flips between chips). Feedback 605d317d: show only the numbers that
   * feel good — open Rückfragen still to answer + how many topics shipped — and
   * deliberately omit "In Arbeit". Only Rückfragen still waiting on the admin
   * are counted; answered ones moved to ToDo (feedback 34c44134).
   */
  readonly motivatingStats = computed(() => {
    let rueckfragen = 0;
    let review = 0;
    let shipped = 0;
    let issues = 0;
    for (const m of this.messages()) {
      if (!this.matchesAuthor(m)) continue;
      const bucket = this.bucketOf(m);
      if (bucket === 'awaiting_admin') rueckfragen++;
      else if (bucket === 'review') review++;
      else if (bucket === 'shipped') shipped++;
      else if (bucket === 'issue_created') issues++;
    }
    return { rueckfragen, review, shipped, issues };
  });

  /** True while any of the totals is worth a line at all. */
  readonly hasBoardStats = computed(() => {
    const s = this.motivatingStats();
    return s.rueckfragen > 0 || s.review > 0 || s.shipped > 0 || s.issues > 0;
  });

  /**
   * Latest-activity timestamp for a topic: the newest of its own timestamps and
   * its last reply. Drives the newest-first ("nach Aktualität") board order so a
   * freshly-answered topic bubbles to the top.
   */
  private recencyTime(m: FeedbackRow): number {
    const replies = this.threads().get(m.id);
    const lastReply = replies && replies.length ? replies[replies.length - 1].created_at : null;
    let max = 0;
    for (const c of [m.created_at, m.updated_at, m.processed_at, lastReply]) {
      if (!c) continue;
      const t = Date.parse(c);
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max;
  }

  /**
   * Active (non-terminal) topics, author-, status- and search-filtered. Ordered
   * newest activity first — except while a search is active, where relevance
   * wins and recency only breaks ties (feedback 12476cec).
   */
  readonly activeMessages = computed(() =>
    this.messages()
      .filter(
        (m) =>
          !isArchived(m, this.threads().get(m.id)) &&
          this.matchesAuthor(m) &&
          this.matchesStatus(m) &&
          this.matchesSearch(m),
      )
      .sort(this.boardOrder()),
  );

  /**
   * The comparator both tabs sort by: relevance-first while searching, plain
   * recency otherwise. `recent` supplies the per-tab notion of "newest" (last
   * activity on the active board, completion time in the archive).
   */
  private boardOrder(
    recent: (m: FeedbackRow) => number = (m) => this.recencyTime(m),
  ): (a: FeedbackRow, b: FeedbackRow) => number {
    if (!this.searchActive()) return (a, b) => recent(b) - recent(a);
    return (a, b) => this.searchScore(b) - this.searchScore(a) || recent(b) - recent(a);
  }

  /** Topics rendered in the current tab — backs the expand-all control. */
  readonly visibleMessages = computed(() =>
    this.boardTab() === 'active' ? this.activeMessages() : this.archiveVisibleMessages(),
  );

  /**
   * Tab badge: how many topics live in each half (author- and search-filtered,
   * chip-independent). Counting the search in is what tells the admin that the
   * thing they are looking for sits in the *other* tab.
   */
  readonly activeCount = computed(
    () =>
      this.messages().filter(
        (m) => !isArchived(m, this.threads().get(m.id)) && this.matchesAuthor(m) && this.matchesSearch(m),
      ).length,
  );
  readonly archiveCount = computed(
    () =>
      this.messages().filter(
        (m) => isArchived(m, this.threads().get(m.id)) && this.matchesAuthor(m) && this.matchesSearch(m),
      ).length,
  );

  /**
   * Active topics bucketed under a day heading (feedback 92f08bb4). The board is
   * already recency-sorted, so consecutive topics on the same local day fall into
   * one group — the template renders a non-interactive "Today / Yesterday / date"
   * heading before each run.
   */
  readonly activeGroups = computed<FeedbackGroup[]>(() => {
    const items = this.activeMessages();
    // While searching, the list is ordered by relevance — day headings would cut
    // it into meaningless one-row slices, so it collapses into a single result
    // heading instead (feedback 12476cec).
    if (this.searchActive()) {
      if (!items.length) return [];
      return [
        {
          key: 'search',
          label: this.translate.instant('adminFeedback.search.results', { count: items.length }),
          items,
        },
      ];
    }

    const groups: FeedbackGroup[] = [];
    let current: FeedbackGroup | null = null;
    for (const m of items) {
      const t = this.recencyTime(m);
      const key = this.dayKey(t);
      if (!current || current.key !== key) {
        current = { key, label: this.dayLabel(t), items: [] };
        groups.push(current);
      }
      current.items.push(m);
    }
    return groups;
  });

  /** Local calendar-day key (Y-M-D) for a timestamp — the grouping bucket id. */
  private dayKey(t: number): string {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** Day heading: Today / Yesterday for the two most recent days, else a localized date. */
  private dayLabel(t: number): string {
    const d = new Date(t);
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const day = startOf(d);
    const today = startOf(new Date());
    const DAY_MS = 86_400_000;
    if (day === today) return this.translate.instant('adminFeedback.dateGroup.today');
    if (day === today - DAY_MS) return this.translate.instant('adminFeedback.dateGroup.yesterday');
    // App-wide formatter: month spelled out, fields in the resolved region's
    // order (feedback 38b3d25a).
    return formatScDate(d, { language: this.locale.language(), region: this.locale.region() });
  }

  /**
   * A concise, single-line title for a topic's one-liner row (feedback 92f08bb4).
   * Derived from the body's first meaningful text with markup and images stripped;
   * capped so it fits the compact row. Falls back to a dash for image-only posts.
   * (A future enhancement could persist an LLM-generated summary — this heuristic
   * gives an always-available title without a schema change.)
   */
  topicTitle(body: string): string {
    return topicTitle(body);
  }

  /**
   * The topic's stable reference number, or `null` when it has none (feedback
   * 21587480). Rendered as a quiet "#42" next to the title in both row layouts
   * so a topic can be named by number in a conversation. Comes straight from
   * `admin_feedback.seq` — never from the row's position in the list, which
   * would change with every filter, search and deletion.
   */
  topicNo(m: FeedbackRow): number | null {
    return topicNumber(m);
  }

  /**
   * Quick-access table of contents for the active board: one entry per visible
   * topic (short label + status) so the admin can jump straight to a thread
   * (feedback 69f3f015). Topics still awaiting the admin's answer are flagged so
   * the TOC can lead with them; the rest follow and are reachable via scroll or
   * the status filter.
   */
  readonly tocEntries = computed<TocEntry[]>(() =>
    this.activeMessages().map((m) => {
      const bucket = this.bucketOf(m);
      return {
        id: m.id,
        label: this.shortLabel(m.body),
        bucket,
        awaitingAdmin: bucket === 'awaiting_admin',
      };
    }),
  );

  /** How many topics still await the admin's answer — drives the TOC lead label. */
  readonly awaitingAdminCount = computed(
    () => this.tocEntries().filter((e) => e.awaitingAdmin).length,
  );

  /** Very short plain-text label (a few words) for a TOC jump chip. */
  private shortLabel(body: string): string {
    const text = (body ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 42 ? `${text.slice(0, 40)}…` : text || '—';
  }

  /** Stable DOM id for a topic card — the TOC scroll target. */
  cardDomId(id: string): string {
    return `fb-card-${id}`;
  }

  /**
   * Jump to a topic from the TOC: ensure it is expanded (the embedded panel
   * collapses topics by default) and scroll it into view within the board's own
   * scroll area. Deferred to the next frame so the just-expanded card has laid
   * out before we scroll to it.
   */
  jumpTo(id: string): void {
    this._expanded.update((set) => new Set(set).add(id));
    requestAnimationFrame(() => {
      document.getElementById(this.cardDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** True when every topic in the current tab is expanded (embedded panel). */
  readonly allExpanded = computed(() => {
    const visible = this.visibleMessages();
    return visible.length > 0 && visible.every((m) => this._expanded().has(m.id));
  });

  /**
   * Expand or collapse every topic of the current tab at once (feedback
   * c5b6b13c). Collapsing leaves just the topic headings so the board stays
   * scannable; only the tab's own rows are touched, so an expanded card in the
   * other tab is left as-is.
   */
  toggleExpandAll(): void {
    const ids = this.visibleMessages().map((m) => m.id);
    const collapse = this.allExpanded();
    this._expanded.update((set) => {
      const next = new Set(set);
      for (const id of ids) {
        if (collapse) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** Page size for the archive — "load more" reveals another batch. */
  private static readonly ARCHIVE_PAGE = 10;
  readonly archiveVisible = signal(AdminFeedbackComponent.ARCHIVE_PAGE);

  /**
   * The Archive: every terminal topic (author- and status-filtered), newest
   * completion first. Shipped and issue-created rows are interleaved by their
   * own completion time so the tab reads as one "done" history.
   */
  readonly archiveMessages = computed(() =>
    this.messages()
      .filter(
        (m) =>
          isArchived(m, this.threads().get(m.id)) &&
          this.matchesAuthor(m) &&
          this.matchesStatus(m) &&
          this.matchesSearch(m),
      )
      .sort(this.boardOrder((m) => this.archiveTime(m))),
  );
  /** The current archive page (first N of the sorted history). */
  readonly archiveVisibleMessages = computed(() =>
    this.archiveMessages().slice(0, this.archiveVisible()),
  );
  /** How many archived items are still hidden below the current page. */
  readonly archiveRemaining = computed(() =>
    Math.max(0, this.archiveMessages().length - this.archiveVisible()),
  );

  /** Reveal the next page of archive history (+10). */
  loadMoreArchive(): void {
    this.archiveVisible.update((n) => n + AdminFeedbackComponent.ARCHIVE_PAGE);
  }

  /**
   * When a topic reached its terminal state: `shipped_at` for shipped rows,
   * else the routine's last touch, else the row's own timestamps. Drives the
   * archive's newest-first order across both terminal kinds.
   */
  private archiveTime(m: FeedbackRow): number {
    for (const c of [m.shipped_at, m.processed_at, m.updated_at, m.created_at]) {
      if (!c) continue;
      const t = Date.parse(c);
      if (Number.isFinite(t)) return t;
    }
    return 0;
  }

  /** Per-entry expand state for the embedded chat overview (collapsed by default). */
  private readonly _expanded = signal<Set<string>>(new Set());
  /** Topics already auto-expanded once, so a manual collapse is not undone on refresh. */
  private readonly _autoExpanded = new Set<string>();

  isExpanded(id: string): boolean {
    return this._expanded().has(id);
  }

  toggleExpand(id: string): void {
    this._expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Per-body "show full text" state for the two-sentence clamp (feedback 73dfa165). */
  private readonly _bodyExpanded = signal<Set<string>>(new Set());

  isBodyExpanded(id: string): boolean {
    return this._bodyExpanded().has(id);
  }

  toggleBody(id: string): void {
    this._bodyExpanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Topics still awaiting the admin's answer (an open Rückfrage), in board order. */
  private awaitingQuestions(): FeedbackRow[] {
    return this.activeMessages().filter(
      (m) => m.status === 'needs_input' && !this.isAnsweredAwaitingRoutine(m),
    );
  }

  /**
   * Guided one-at-a-time flow in the embedded FAB panel (feedback 816a0ec8).
   * The panel keeps exactly the first still-unanswered Rückfrage open — the
   * routine's question and its reply box — while the rest stay collapsed so the
   * overview reads cleanly. Answering advances to the next via
   * {@link advanceAfterAnswer}; here we only ensure something is open when
   * nothing is, and never reopen a question the admin manually collapsed (each
   * id is auto-expanded at most once).
   */
  private autoExpandFirstQuestion(): void {
    if (!this.embedded()) return;
    const awaiting = this.awaitingQuestions();
    if (awaiting.length === 0) return;
    // Already guiding one open question → leave the admin's place untouched.
    if (awaiting.some((m) => this._expanded().has(m.id))) return;
    const first = awaiting[0];
    if (this._autoExpanded.has(first.id)) return; // manually collapsed — respect it
    this._autoExpanded.add(first.id);
    this._expanded.update((set) => new Set(set).add(first.id));
  }

  /**
   * After the admin answers a Rückfrage in the panel, fold the answered topic
   * away and open the next still-unanswered one, scrolling it into view — the
   * "collapse → move up → next unfolds" flow the overview asks for (feedback
   * 816a0ec8). The answered topic bubbles up on its own via the recency sort;
   * the CSS `expandCollapse` animation softens the fold. No-op on the full board.
   */
  private advanceAfterAnswer(answeredId: string): void {
    if (!this.embedded()) return;
    this._expanded.update((set) => {
      const next = new Set(set);
      next.delete(answeredId);
      return next;
    });
    const next = this.awaitingQuestions().find((m) => m.id !== answeredId);
    if (!next) return;
    this._autoExpanded.add(next.id);
    this._expanded.update((set) => new Set(set).add(next.id));
    requestAnimationFrame(() => {
      document
        .getElementById(this.cardDomId(next.id))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * First-two-sentences preview of a markdown body plus whether anything was cut
   * — backs the collapse-by-default clamp on the full board. Images and markup
   * are stripped for the plain preview; the images themselves ride along as
   * attachment thumbnails in every state (feedback a660536a), so they no longer
   * make a short body "expandable".
   */
  bodyPreview(body: string): { text: string; truncated: boolean } {
    const raw = body ?? '';
    const plain = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = plain ? plain.split(/(?<=[.!?])\s+/) : [];
    let text = parts.slice(0, 2).join(' ').trim();
    let truncated = parts.length > 2 || text.length < plain.length;
    const CAP = 300;
    if (text.length > CAP) {
      text = text.slice(0, CAP).trimEnd();
      truncated = true;
    }
    return { text: text || plain, truncated };
  }

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
    inject(DestroyRef).onDestroy(() => {
      if (this.shipCheerTimer) clearTimeout(this.shipCheerTimer);
    });
  }

  async ngOnInit() {
    await this.refresh();
  }

  render(body: string): RenderedFeedbackBody {
    return renderFeedbackBody(body);
  }

  authorLabel(m: FeedbackRow): string {
    if (m.author_id && m.author_id === this.selfId()) {
      return this.translate.instant('adminFeedback.you');
    }
    return m.author?.display_name
      ?? (m.author?.username ? `@${m.author.username}` : null)
      ?? this.translate.instant('adminFeedback.unknownUser');
  }

  // ---- Data --------------------------------------------------------------

  async refresh() {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client
      .from('admin_feedback')
      .select('id, seq, author_id, body, status, ship_ref, processing_note, created_at, updated_at, shipped_at, processed_at, reviewed_at, source, triaged, decision_note, author:profiles(display_name, username)')
      .order('created_at', { ascending: true });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      const rows = (data ?? []) as unknown as FeedbackRow[];
      this.messages.set(rows);
      // Threads first: the guided auto-expand needs each topic's replies to tell
      // an unanswered Rückfrage from one already answered (awaiting the routine).
      await this.loadThreads(rows.map((r) => r.id));
      await this.loadAuthorThreads(rows.filter(isUserSubmitted).map((r) => r.id));
      this.autoExpandFirstQuestion();
      this.detectShipped(rows);
    }
    this.busy.set(false);
  }

  /** Fetch every topic's replies in one query and group them by feedback id. */
  private async loadThreads(feedbackIds: string[]): Promise<void> {
    if (feedbackIds.length === 0) {
      this.threads.set(new Map());
      return;
    }
    const { data, error } = await this.sb.client
      .from('admin_feedback_messages')
      .select('id, feedback_id, author_id, is_system, body, created_at, author:profiles(display_name, username)')
      .in('feedback_id', feedbackIds)
      .order('created_at', { ascending: true });
    if (error) {
      // Threads are additive — a load failure must not blank the board.
      return;
    }
    const grouped = new Map<string, FeedbackMessage[]>();
    for (const row of (data ?? []) as unknown as FeedbackMessage[]) {
      const list = grouped.get(row.feedback_id) ?? [];
      list.push(row);
      grouped.set(row.feedback_id, list);
    }
    this.threads.set(grouped);
  }

  // ---- Author channel (user-submitted topics) ------------------------------

  /**
   * The AUTHOR-VISIBLE messages per topic (feedback 5920cf8c). Kept strictly
   * apart from {@link threads}: that one is the admin <-> routine conversation
   * and must never reach the person who filed the topic, this one is the only
   * thing they do see besides their own text and the coarse status.
   */
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
    // Additive — a load failure must not blank the board.
    if (error) return;
    this.authorThreads.set(
      groupAuthorMessages((data ?? []) as unknown as AuthorFeedbackMessage[]),
    );
  }

  authorMessagesFor(id: string): AuthorFeedbackMessage[] {
    return this.authorThreads().get(id) ?? [];
  }

  /** Template alias: was this topic filed by a non-admin through the user FAB? */
  fromUser(m: FeedbackRow): boolean {
    return isUserSubmitted(m);
  }

  /** Template alias: does this user topic still wait to be released to the routine? */
  untriaged(m: FeedbackRow): boolean {
    return awaitsTriage(m);
  }

  /**
   * What the FEEDBACK AUTHOR currently sees for this topic — the same coarse
   * mapping the `public.my_feedback` view applies, so the admin can tell at a
   * glance that a `needs_input` Rückfrage to the routine reads as plain
   * "in Bearbeitung" on the other side, while only `needs_input_author` shows up
   * there as a question.
   */
  authorFacingStatus(m: FeedbackRow): AuthorFeedbackStatus {
    return coarseAuthorStatus(m.status);
  }

  authorLabelFor(msg: FeedbackMessage): string {
    if (msg.is_system) return this.translate.instant('adminFeedback.thread.routine');
    if (msg.author_id && msg.author_id === this.selfId()) {
      return this.translate.instant('adminFeedback.you');
    }
    return msg.author?.display_name
      ?? (msg.author?.username ? `@${msg.author.username}` : null)
      ?? this.translate.instant('adminFeedback.unknownUser');
  }

  // ---- Composer submit handlers ------------------------------------------

  /**
   * Upload the composer's queued images and compose the stored body. The
   * implementation moved to `feedback/feedback-images.util.ts` so the non-admin
   * panel (feedback 5920cf8c) attaches screenshots through the exact same path.
   */
  private uploadImages(images: PendingImage[]): Promise<string[]> {
    return uploadFeedbackImages(this.sb.client, this.selfId(), images);
  }

  private buildBody(text: string, images: PendingImage[], urls: string[]): string {
    return buildFeedbackBody(text, images, urls);
  }

  /** Stable handler reference for the new-topic composer. */
  readonly createTopicBound = (payload: ComposerPayload): Promise<boolean> =>
    this.createTopic(payload);

  // ---- Compact panel disclosures (feedback 3133f9) ------------------------
  // In the docked FAB panel vertical space is the scarce resource: the control
  // chrome and the new-topic composer used to stack ahead of the list and leave
  // barely one thread visible. So in `embedded()` mode the search field, the
  // status/author chips and the composer each fold away and open on demand —
  // the thread list owns the panel. On the full board none of this applies.

  /** Docked panel: the new-topic composer is collapsed to a bar by default. */
  readonly composerOpen = signal(false);
  openComposer(): void { this.composerOpen.set(true); }
  closeComposer(): void { this.composerOpen.set(false); }

  /** Docked panel: status + author chips fold behind a "Filter" disclosure. */
  readonly filtersOpen = signal(false);
  toggleFilters(): void { this.filtersOpen.update((v) => !v); }

  /** Docked panel: the search field folds behind a search icon. Collapsing it
   *  also drops any active query, so a hidden search never silently filters. */
  readonly searchOpen = signal(false);
  toggleSearch(): void {
    const next = !this.searchOpen();
    this.searchOpen.set(next);
    if (!next) this.clearSearch();
  }

  /**
   * Compact new-topic submit: same as {@link createTopicBound}, but folds the
   * sheet back to the bar once the topic is persisted, so the list returns.
   */
  readonly createComposerBound = async (payload: ComposerPayload): Promise<boolean> => {
    const ok = await this.createTopic(payload);
    if (ok) this.composerOpen.set(false);
    return ok;
  };

  /** Create a new feedback topic. Returns true once persisted (composer clears). */
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
      .insert({ body, author_id: uid });
    if (error) {
      this.errorMsg.set(error.message);
      return false;
    }
    await this.refresh();
    return true;
  }

  /**
   * Memoized draft scopes. A topic shows two composers at once (the admin <->
   * routine thread and the author channel), and the workflow view a third — each
   * keeps its own draft, so the keys must stay distinct and stable.
   */
  private readonly threadScopes = new Map<string, string>();
  private readonly authorScopes = new Map<string, string>();

  threadScope(feedbackId: string): string {
    return memoScope(this.threadScopes, feedbackId, draftScopes.adminThread);
  }

  authorScope(feedbackId: string): string {
    return memoScope(this.authorScopes, feedbackId, draftScopes.adminAuthor);
  }

  /** Memoized per-topic reply handlers, so each composer gets a stable input. */
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
    // Was this reply answering an open Rückfrage? If so, advance the guided flow
    // once persisted (fold this one away, open the next) — captured before the
    // refresh flips the topic to "answered".
    const wasQuestion = this.messages().find((m) => m.id === feedbackId)?.status === 'needs_input';
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
    if (wasQuestion) this.advanceAfterAnswer(feedbackId);
    return true;
  }

  // ---- Issue hand-off ------------------------------------------------------

  /** Topic id whose inline "issue created" url form is open (null = none). */
  readonly issueFormFor = signal<string | null>(null);
  /** Draft issue url in that form. */
  readonly issueUrl = signal('');

  openIssueForm(m: FeedbackRow): void {
    this.issueUrl.set(m.ship_ref ?? '');
    this.issueFormFor.set(m.id);
  }

  cancelIssueForm(): void {
    this.issueFormFor.set(null);
    this.issueUrl.set('');
  }

  /**
   * Archive a topic as "issue created": store the GitHub issue url in
   * `ship_ref` and flip the status to the terminal `issue_created`. That moves
   * the row out of the active board into the Archive, where its link renders as
   * an issue link. Any admin may update the board (RLS `admin_feedback_update`).
   */
  async submitIssueRef(m: FeedbackRow, ev: Event): Promise<void> {
    ev.preventDefault();
    const url = this.issueUrl().trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.errorMsg.set(this.translate.instant('adminFeedback.issue.invalidUrl'));
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback')
      .update({
        status: 'issue_created',
        ship_ref: url,
        processed_at: new Date().toISOString(),
        processing_note: null,
      })
      .eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    this.cancelIssueForm();
    await this.refresh();
  }

  // ---- Review gate ----------------------------------------------------------

  /** Template-side alias: is this topic waiting for the admin's sign-off? */
  inReview(m: FeedbackRow): boolean {
    return awaitsReview(m, this.threads().get(m.id));
  }

  /**
   * Everything the routine finished that nobody has confirmed yet — the sign-off
   * view's whole content and the badge on its tab (feedback #79).
   *
   * Oldest first, like the processing queue: a result that has been waiting for
   * days is the one most likely to be forgotten. Deliberately unfiltered by the
   * overview's search / author / status chips — this is a step of its own, not a
   * slice of that list.
   */
  readonly reviewQueue = computed(() =>
    this.messages()
      .filter((m) => this.inReview(m))
      .sort((a, b) => timeOf(this.reviewSince(a)) - timeOf(this.reviewSince(b))),
  );

  /** When the outcome landed — what the sign-off card dates itself by. */
  reviewSince(m: FeedbackRow): string {
    return m.shipped_at ?? m.processed_at ?? m.updated_at;
  }

  /**
   * Open the topic's full card in the overview: the sign-off row is a summary,
   * and "does this look right?" sometimes needs the thread. Filters are cleared
   * so the target cannot be hidden by a chip the admin left active.
   */
  openInOverview(m: FeedbackRow): void {
    this.setView('overview');
    this.setBoardTab('active');
    this.statusFilter.set(null);
    this.authorFilter.set(null);
    this.clearSearch();
    this.jumpTo(m.id);
  }

  /**
   * Sign the outcome off. The topic leaves the active board for "Erledigt" —
   * the one place a shipped or issue-handed topic is finally done.
   */
  async acceptReview(m: FeedbackRow): Promise<void> {
    await this.writeReview(m, { reviewed_at: new Date().toISOString() });
  }

  /**
   * Reject the outcome and put the topic back into the work loop.
   *
   * `status = 'open'` rather than `'in_progress'`, deliberately: `open` IS the
   * routine's queue (docs/feedback-routine, "Contract"), so this is what makes
   * work happen again — usually within one cycle. Writing `in_progress` would
   * park the topic under a claim nobody holds, and the reaper would have to undo
   * it half an hour later. `ship_ref` is kept: the previous attempt's PR/issue
   * stays visible as the history of what was already tried.
   */
  async reopenFromReview(m: FeedbackRow): Promise<void> {
    await this.writeReview(m, {
      status: 'open',
      reviewed_at: null,
      // Fresh outside decision — let the routine re-read it from the top.
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

  /**
   * Release a user-submitted topic to the autonomous routine. Until an admin
   * does this the topic sits `triaged=false` and the routine skips it — a
   * stranger must not be able to drive an agent that implements and ships on
   * its own straight from a feedback box.
   */
  async releaseToRoutine(m: FeedbackRow): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback')
      .update({ triaged: true })
      .eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  /**
   * Whether the next author-channel message is sent as a QUESTION. Opt-in per
   * the admin's decision (feedback 5920cf8c, point 3): an ordinary note keeps
   * the topic reading "in Bearbeitung" on the author's side, only a question
   * surfaces there as its own "Rückfrage an dich" status.
   */
  readonly askAuthor = signal(false);

  toggleAskAuthor(): void {
    this.askAuthor.update((v) => !v);
  }

  private readonly authorReplySubmitters =
    new Map<string, (p: ComposerPayload) => Promise<boolean>>();

  authorReplySubmitFor(feedbackId: string): (p: ComposerPayload) => Promise<boolean> {
    let fn = this.authorReplySubmitters.get(feedbackId);
    if (!fn) {
      fn = (p: ComposerPayload) => this.sendAuthorMessage(feedbackId, p);
      this.authorReplySubmitters.set(feedbackId, fn);
    }
    return fn;
  }

  /** Post an admin message into a topic's author-visible channel. */
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
      is_question: this.askAuthor(),
      body,
    });
    if (error) {
      this.errorMsg.set(error.message);
      return false;
    }
    this.askAuthor.set(false);
    await this.refresh();
    return true;
  }

  /** Topic id whose inline "nicht umsetzen" comment form is open (null = none). */
  readonly declineFormFor = signal<string | null>(null);
  /** Draft explanation in that form — mandatory, the author gets to read it. */
  readonly declineNote = signal('');

  openDeclineForm(m: FeedbackRow): void {
    this.declineNote.set('');
    this.declineFormFor.set(m.id);
  }

  cancelDeclineForm(): void {
    this.declineFormFor.set(null);
    this.declineNote.set('');
  }

  /**
   * "Nicht umsetzen & löschen" for a user-submitted topic (feedback 5920cf8c,
   * point 4): the admin's comment is mandatory, it is posted into the
   * author-visible channel AND stored on the row as `decision_note`, and the
   * topic moves to the terminal `declined` status.
   *
   * Deliberately a soft close rather than a `DELETE`. A hard delete cascades
   * the author's own thread away and leaves them with a topic that silently
   * vanished — the exact opposite of "the author gets a proper explanation".
   * The topic leaves the admins' active board either way (Archive tab).
   */
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
      .update({
        status: 'declined',
        decision_note: note,
        processed_at: new Date().toISOString(),
      })
      .eq('id', m.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    // Also drop it into the channel so the author sees the reason as a message,
    // not only as a field on a card they may never expand.
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
    await this.refresh();
  }

  async remove(m: FeedbackRow) {
    if (!window.confirm(this.translate.instant('adminFeedback.deleteConfirm'))) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback')
      .delete()
      .eq('id', m.id);
    if (error) this.errorMsg.set(error.message);
    await this.refresh();
  }
}
