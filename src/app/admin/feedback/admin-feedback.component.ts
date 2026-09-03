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
  FeedbackSource,
  BucketLabelKey,
  FeedbackStatus,
  WORKFLOW_SCOPES,
  WorkflowKind,
  WorkflowScope,
  awaitsTriage,
  buildWorkflowQueue,
  bucketLabelStatus,
  feedbackBucket,
  filterWorkflowKind,
  filterWorkflowScope,
  FoldedThread,
  foldThread,
  isArchived,
  isContinuedAfterShip,
  isUserSubmitted,
  ISSUE_REQUEST_MARKER,
  pendingIssueRequest,
  refKind,
  reviewSince,
  searchFeedback,
  searchTokens,
  timeOf,
  topicNumber,
  topicTitle,
  workflowKindCounts,
  workflowScopeCounts,
} from './feedback.types';
import { buildFeedbackBody, uploadFeedbackImages } from '../../feedback/feedback-images.util';
import { draftScopes, memoScope } from '../../feedback/feedback-draft.types';
import {
  FeedbackArea,
  asFeedbackArea,
  feedbackAreaLabelKey,
} from '../../feedback/feedback-area.types';
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
 * The board's three modes: scan the list, work the queue, read the numbers.
 *
 * There used to be a fourth, `review` — the Abnahme pile as its own tab
 * (feedback #79). It held exactly the rows the Abarbeiten run walks, which made
 * it a second surface for one pile, and the admin asked for it to go (feedback
 * d4990269, round 2: "den Abnahme Tab können wir rausmachen und einfach in
 * Abarbeiten eine filter möglichkeit nur abnahmen einfügen"). The sign-off did
 * not lose a home: it is a chip in the run now, and the in-card gate in the
 * overview is untouched. A remembered `review` view is migrated in
 * {@link AdminFeedbackComponent.readView} to the run with that filter set, so
 * nobody's stored preference dead-ends.
 */
export type FeedbackView = 'overview' | 'workflow' | 'progress';

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
/** localStorage key remembering the processing mode's kind lens. */
const WORKFLOW_KIND_KEY = 'sc.adminFeedback.workflowKind';
/**
 * Kind the processing mode opens on (feedback d4990269, round 2): everything.
 * The lens replaced the Abnahme tab, and the run's own point is that the admin
 * works one inbox rather than picking piles — narrowing it is a deliberate act.
 */
const DEFAULT_WORKFLOW_KIND: WorkflowKind = 'all';

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
          <!-- Counts Rückfragen AND Abnahmen since feedback d4990269 — the run
               walks both, so the badge has to promise both. It ignores the run's
               kind filter on purpose: the badge is "how much is waiting", not
               "how much is on screen". -->
          @if (workflowInboxCount() > 0) {
            <span class="tab-badge">{{ workflowInboxCount() }}</span>
          }
        </button>
        <!-- The Abnahme tab used to sit here (feedback #79) and hold exactly the
             rows the Abarbeiten run already walks. Two surfaces for one pile is
             one too many, so it is gone (feedback d4990269, round 2) — the run
             carries a "nur Abnahmen" filter instead, and a stored review view
             lands there (see readView). -->
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
            [kind]="workflowKind()"
            [kindCounts]="workflowKindCounts()"
            [reply]="workflowReplyBound"
            [reopenWithReply]="workflowReopenBound"
            (markHandled)="markHandled($event)"
            (scopeChange)="setWorkflowScope($event)"
            (kindChange)="setWorkflowKind($event)"
            (acceptReview)="acceptReview($event)"
            (showProgress)="setView('progress')" />
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
        <!-- Board toolbar (admin feedback 18e96ad3). Two rows, deliberately:
             the FIRST carries what is always in play - the Aktiv/Erledigt
             split, the Admins/Nutzer split, a compact search and, right-aligned,
             the one control that acts on the whole list (alles auf/zu). The
             SECOND is a single quiet text link that unrolls the rest. The chips
             used to sit permanently unrolled on the full board and behind an
             icon in the panel; one place, folded away by default, is both.
             embedded() no longer changes the layout here - it only tightens the
             spacing (see the styles). -->
        <div class="board-toolbar">
          <div class="tb-row">
            <!-- Active / Archive tabs inside the overview (feedback eeba60e7).
                 Active holds the working set (open / in Arbeit / Rueckfrage);
                 Archive holds the terminal ones - shipped and issue-created -
                 each with its link. -->
            <div class="seg" role="group" [attr.aria-label]="'adminFeedback.tab.label' | translate">
              <button
                type="button"
                class="seg-tab"
                [class.active]="boardTab() === 'active'"
                [attr.aria-pressed]="boardTab() === 'active'"
                (click)="setBoardTab('active')">
                {{ 'adminFeedback.tab.active' | translate }}
                <span class="tab-count">{{ activeCount() }}</span>
              </button>
              <button
                type="button"
                class="seg-tab"
                [class.active]="boardTab() === 'archive'"
                [attr.aria-pressed]="boardTab() === 'archive'"
                (click)="setBoardTab('archive')">
                {{ 'adminFeedback.tab.archive' | translate }}
                <span class="tab-count">{{ archiveCount() }}</span>
              </button>
            </div>

            <!-- Admin board vs. user feedback (admin feedback 18e96ad3). Same
                 switch as above because it is the same kind of decision: which
                 pile am I looking at. Defaults to Admins; the Nutzer side keeps
                 its count and grows a marker while something there still waits
                 to be released, so the default can never hide a fresh report. -->
            <div class="seg" role="group" [attr.aria-label]="'adminFeedback.sourceFilter.label' | translate">
              <button
                type="button"
                class="seg-tab"
                [class.active]="sourceFilter() === 'admin'"
                [attr.aria-pressed]="sourceFilter() === 'admin'"
                (click)="setSourceFilter('admin')">
                {{ 'adminFeedback.sourceFilter.admin' | translate }}
                <span class="tab-count">{{ sourceCounts().admin }}</span>
              </button>
              <button
                type="button"
                class="seg-tab"
                [class.active]="sourceFilter() === 'user'"
                [attr.aria-pressed]="sourceFilter() === 'user'"
                (click)="setSourceFilter('user')">
                {{ 'adminFeedback.sourceFilter.user' | translate }}
                <span class="tab-count">{{ sourceCounts().user }}</span>
                @if (untriagedWaiting()) {
                  <span
                    class="dot"
                    [attr.title]="'adminFeedback.sourceFilter.untriagedHint' | translate"></span>
                }
              </button>
            </div>

            <span class="tb-spacer"></span>

            <!-- Fuzzy search across the whole conversation - topic body,
                 processing note, author and every thread reply (feedback
                 12476cec). It rests as a narrow pill and grows over its
                 neighbours while it is in use, like the site-wide Ctrl+K search
                 (admin feedback 18e96ad3); Escape, the x and a click elsewhere
                 put it back. A query keeps it open, so the list is never
                 narrowed by a box that has folded itself away. -->
            <div
              class="search-box"
              [class.expanded]="searchExpanded()"
              (focusin)="searchFocused.set(true)"
              (focusout)="searchFocused.set(false)">
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
              <!-- Shown for any non-empty input, not just a *usable* query: a
                   whitespace-only field has to be clearable too. -->
              @if (searchQuery().length > 0) {
                <button
                  type="button"
                  class="search-clear"
                  (click)="clearSearch(); searchInput.blur()"
                  [attr.title]="'adminFeedback.search.clear' | translate"
                  [attr.aria-label]="'adminFeedback.search.clear' | translate">
                  &times;
                </button>
              }
            </div>

            <!-- Fold every topic at once. Right-aligned and icon-only, with the
                 tooltip that names what the click will do (admin feedback
                 18e96ad3) - it acts on the whole list, so it belongs at the far
                 end rather than among the filters. -->
            @if (visibleMessages().length > 1) {
              <button
                type="button"
                class="tb-icon expand-all"
                (click)="toggleExpandAll()"
                [attr.aria-pressed]="allExpanded()"
                [attr.title]="(allExpanded() ? 'adminFeedback.collapseAll' : 'adminFeedback.expandAll') | translate"
                [attr.aria-label]="(allExpanded() ? 'adminFeedback.collapseAll' : 'adminFeedback.expandAll') | translate">
                <span class="chev" [class.open]="allExpanded()" aria-hidden="true">&#9656;</span>
              </button>
            }
          </div>

          <!-- Second row: one quiet text link for everything that is not
               everyday. The dot says a hidden chip is still narrowing the list. -->
          <div class="tb-row second">
            <button
              type="button"
              class="filter-link"
              [class.open]="filtersOpen()"
              (click)="toggleFilters()"
              [attr.aria-expanded]="filtersOpen()">
              <span class="chev" [class.open]="filtersOpen()" aria-hidden="true">&#9656;</span>
              {{ 'adminFeedback.filter.toggle' | translate }}
              @if (!filtersOpen() && (statusFilter() !== null || authorFilter() !== null)) {
                <span class="dot" aria-hidden="true"></span>
              }
            </button>
          </div>

          @if (filtersOpen()) {
            <div class="filters">
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
                  <!-- The mirror image of the Rueckfrage chip: topics where the
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
            </div>
          }
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
        <!-- What the sender says this is about (admin feedback 835fec58).
             Nothing at all on the topics filed before the tag existed — an
             invented default would read like an answer nobody gave. -->
        @if (areaOf(m); as a) {
          <span class="status-pill area">{{ areaLabelKey(a) | translate }}</span>
        }
        <!-- Filed by a viewer/collaborator through their own FAB (feedback
             5920cf8c), and — until released — still held back from the routine. -->
        @if (fromUser(m)) {
          <span class="status-pill from-user">{{ 'adminFeedback.userTopic.badge' | translate }}</span>
          @if (untriaged(m)) {
            <span class="status-pill untriaged">{{ 'adminFeedback.userTopic.untriaged' | translate }}</span>
          }
        }
        <!-- An issue was ORDERED and not yet delivered (admin feedback
             18e96ad3). It is not a status - the topic is a plain ToDo the
             routine still owns - so it reads as the extra marker it is, next
             to the bucket pill rather than instead of it. -->
        @if (issueRequested(m)) {
          <span class="status-pill issue_created">{{ 'adminFeedback.issue.pill' | translate }}</span>
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

      <!-- One thread message, wherever a thread is drawn. Both ends of a folded
           thread render through this, so the fold can never drift into two
           slightly different message layouts (feedback 03d7e546). -->
      <ng-template #threadReply let-msg>
        <div
          class="reply"
          [class.is-system]="msg.is_system"
          [class.is-self]="!msg.is_system && msg.author_id === selfId()">
          <div class="reply-head">
            <span class="reply-author">{{ authorLabelFor(msg) }}</span>
            @if (msg.is_system) { <span class="reply-badge">{{ 'adminFeedback.thread.routineBadge' | translate }}</span> }
            <span class="reply-ts">{{ msg.created_at | scDate: (embedded() ? 'date' : 'datetime') }}</span>
          </div>
          @let reply = render(msg.body);
          <div class="reply-body" [innerHTML]="reply.html"></div>
          <sc-feedback-attachments [images]="reply.images" />
        </div>
      </ng-template>

      <!-- One message of the author-visible channel — same shape, other labels. -->
      <ng-template #authorReply let-am>
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
          @let authorBody = render(am.body);
          <div class="reply-body" [innerHTML]="authorBody.html"></div>
          <sc-feedback-attachments [images]="authorBody.images" />
        </div>
      </ng-template>

      <!-- The one disclosure a folded thread gets: the "…" that stands in for
           everything between its first and its last message. -->
      <ng-template #foldToggle let-key let-count="count">
        <button
          type="button"
          class="thread-more"
          [attr.aria-expanded]="foldOpen(key)"
          (click)="toggleFold(key)">
          <span class="ellipsis" aria-hidden="true">{{ foldOpen(key) ? '⌃' : '…' }}</span>
          {{ (foldOpen(key) ? 'adminFeedback.thread.foldCollapse' : 'adminFeedback.thread.foldExpand')
              | translate: { count: count } }}
        </button>
      </ng-template>

      <ng-template #msgCard let-m>
        <article class="msg sc-card" [id]="cardDomId(m.id)" [class.is-self]="m.author_id === selfId()">
          <!-- ONE card head, in the docked panel and on the full board alike
               (feedback 03d7e546): chevron · #N · generated title · author ·
               date · status. The full board used to render a non-interactive
               head and keep every card permanently open — which is why
               "expandieren/collapsen funktioniert nicht" was literally true
               there: there was nothing to click. The date is dropped in the
               panel, where the day heading above already carries it (feedback
               92f08bb4). -->
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
            @if (!embedded()) {
              <span class="ts">{{ m.created_at | scDate: 'datetime' }}</span>
            }
            <ng-container [ngTemplateOutlet]="pills" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
          </button>

          @if (isExpanded(m.id)) {
           <!-- Animate the fold only in the panel; the full board keeps every
                card open, so its detail region is never toggled. -->
           <div class="msg-detail" [@expandCollapse] [@.disabled]="!embedded()">
            <!-- The topic's own text: the conversation's INITIAL message, always
                 whole. The two-sentence clamp that used to live here (feedback
                 73dfa165) is gone with feedback 03d7e546 — the card itself folds
                 now, in both shells, so a second expand control inside an
                 already expanded card was one fold too many. Screenshots ride
                 along as thumbnails, they are attachments rather than part of
                 the text (feedback a660536a). -->
            @let body = render(m.body);
            <div class="msg-body" [innerHTML]="body.html"></div>
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

            <!-- Per-topic thread (admin ↔ routine), folded to its two ends
                 (feedback 03d7e546): the topic body above is where the
                 conversation started, so what has to stay in view here is the
                 LAST message — the one that is waiting for a reaction. The
                 first reply keeps its place as the thread's opening, everything
                 between the two sits behind one "…" that says how much it
                 hides. Same rule, same control as the author channel below and
                 as the Abarbeiten run. -->
            @let tf = threadFold(m.id);
            @if (tf.tail.length > 0) {
              <div class="thread">
                @if (tf.lead; as lead) {
                  <ng-container [ngTemplateOutlet]="threadReply" [ngTemplateOutletContext]="{ $implicit: lead }"></ng-container>
                }
                @if (tf.hidden.length > 0) {
                  <ng-container
                    [ngTemplateOutlet]="foldToggle"
                    [ngTemplateOutletContext]="{ $implicit: tf.key, count: tf.hidden.length }"></ng-container>
                }
                @for (msg of tf.tail; track msg.id) {
                  <ng-container [ngTemplateOutlet]="threadReply" [ngTemplateOutletContext]="{ $implicit: msg }"></ng-container>
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

            <!-- Reply composer — full parity with the new-topic box (Enter to
                 send / Shift+Enter for a newline, image paste/drop,
                 list continuation). On an archived topic a reply reopens it
                 (shipped: post-ship continuation; issue_created / declined /
                 rejected: the reopen trigger, migration 20260726180000) — so a
                 hint says as much before the admin types. -->
            @if (archived(m)) {
              <p class="reopen-hint">↻ {{ 'adminFeedback.thread.reopenHint' | translate }}</p>
            }
            <div class="reply-compose">
              <sc-feedback-composer
                [allowFiles]="true"
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

                <!-- Same fold as the thread above (feedback 03d7e546): first
                     message, one "…" for the middle, newest message. -->
                @let af = authorFold(m.id);
                @if (af.tail.length > 0) {
                  <div class="ac-thread">
                    @if (af.lead; as lead) {
                      <ng-container [ngTemplateOutlet]="authorReply" [ngTemplateOutletContext]="{ $implicit: lead }"></ng-container>
                    }
                    @if (af.hidden.length > 0) {
                      <ng-container
                        [ngTemplateOutlet]="foldToggle"
                        [ngTemplateOutletContext]="{ $implicit: af.key, count: af.hidden.length }"></ng-container>
                    }
                    @for (am of af.tail; track am.id) {
                      <ng-container [ngTemplateOutlet]="authorReply" [ngTemplateOutletContext]="{ $implicit: am }"></ng-container>
                    }
                  </div>
                }

                <!-- The ONE way to ask this topic's author something (feedback
                     03d7e546): one box, and one switch that decides whether the
                     message is a plain note or the Rückfrage that parks the
                     topic until they answer. The switch is per topic — it used
                     to be a single board-wide flag, so ticking it on one card
                     armed every other open card as well. -->
                @if (!archived(m)) {
                  <label class="ac-ask">
                    <input type="checkbox" [checked]="asksAuthor(m.id)" (change)="toggleAskAuthor(m.id)" />
                    {{ 'adminFeedback.userTopic.asQuestion' | translate }}
                  </label>
                  <sc-feedback-composer
                    [allowFiles]="true"
                    [compact]="true"
                    [draftScope]="authorScope(m.id)"
                    [busy]="busy()"
                    placeholder="adminFeedback.userTopic.messagePlaceholder"
                    [sendLabel]="asksAuthor(m.id) ? 'adminFeedback.userTopic.questionSend' : 'adminFeedback.userTopic.messageSend'"
                    [onSubmit]="authorReplySubmitFor(m.id)" />
                }
              </section>
            }

            <!-- ADMIN ACTIONS, behind ONE control (feedback 03d7e546).
                 "Issue erstellt", "nicht umsetzen & löschen" and "löschen" used
                 to sit under every card as a permanent row of buttons, next to
                 two composers and the sign-off gate — the wall the admin asked
                 us to take apart. They are rare, deliberate acts, so the resting
                 card offers exactly one "Weitere Aktionen" disclosure and the
                 buttons (with their inline forms) live inside it. Nothing was
                 dropped: every status the routine reads — issue_created,
                 declined, the triage release — is still reachable, one click
                 deeper.

                 The one exception stays out in the open: a user topic the
                 routine is not allowed to touch yet is BLOCKED on that release,
                 so hiding it would hide the reason the topic is not moving. -->
            <div class="msg-actions">
              @if (untriaged(m) && !archived(m) && !inReview(m)) {
                <button class="sc-btn micro" (click)="releaseToRoutine(m)" [disabled]="busy()">
                  {{ 'adminFeedback.userTopic.release' | translate }}
                </button>
              }
              <button
                type="button"
                class="sc-btn micro ghost"
                (click)="toggleMore(m.id)"
                [attr.aria-expanded]="moreOpen(m.id)">
                <span class="chev" [class.open]="moreOpen(m.id)" aria-hidden="true">▸</span>
                {{ 'adminFeedback.moreActions' | translate }}
              </button>
            </div>

            @if (moreOpen(m.id)) {
              <div class="more-actions">
                <!-- A topic in the sign-off gate has already produced its
                     outcome: the only decisions left are the two in the gate
                     above, so the "hand it to an issue" control stays away. -->
                @if (!archived(m) && !inReview(m)) {
                  <!-- "Issue erstellen" is an ORDER, not a record of one
                       (admin feedback 18e96ad3): it asks the routine to open a
                       GitHub issue for this topic instead of implementing it,
                       and the topic stays exactly where it is - ToDo, in the
                       queue - until the routine delivers. Which is what makes
                       the misclick undoable: nothing has happened yet. -->
                  @if (issueRequested(m)) {
                    <div class="issue-pending">
                      <span class="ip-text">{{ 'adminFeedback.issue.pending' | translate }}</span>
                      <button class="sc-btn micro" (click)="undoIssueRequest(m)" [disabled]="busy()">
                        &#8630; {{ 'adminFeedback.issue.undo' | translate }}
                      </button>
                    </div>
                  } @else {
                    <button class="sc-btn micro" (click)="requestIssue(m)" [disabled]="busy()">
                      {{ 'adminFeedback.issue.mark' | translate }}
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
            }
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
            [allowFiles]="true"
            class="main-composer"
            [draftScope]="draftScope"
            [busy]="busy()"
            [areaPicker]="true"
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
              [allowFiles]="true"
              [draftScope]="draftScope"
              [busy]="busy()"
              [areaPicker]="true"
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
    /* One focus ring for every control on the board — it was spelled out
       eight times, in two shades that were never told apart on screen. */
    .view-tab:focus-visible,
    .status-chip:focus-visible,
    .author-chip:focus-visible,
    .seg-tab:focus-visible,
    .tb-icon:focus-visible,
    .filter-link:focus-visible,
    .new-topic-bar:focus-visible,
    .cs-close:focus-visible,
    .load-more:focus-visible,
    .thread-more:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.32);
    }

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
    /* The full board's head is the same control, only roomier: it has space for
       the topic's date, which the panel leaves to its day heading. */
    .msg-head.one-liner .ts { flex: 0 0 auto; }
    .page:not(.embedded) .msg-head.one-liner .topic-title { font-size: 0.92rem; }
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
    /* Board toolbar (admin feedback 18e96ad3): the everyday row, then the
       "Filter" disclosure alone on a second one. */
    .board-toolbar { display: flex; flex-direction: column; gap: 6px; }
    .tb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: relative; }
    .tb-row.second { gap: 6px; }
    .tb-spacer { flex: 1 1 auto; }

    /* Search: a narrow pill that grows over its neighbours while focused or
       holding a query - the Ctrl+K gesture, toolbar-sized. Absolute only while
       expanded, so opening it reflows nothing. */
    .search-box {
      display: flex; align-items: center; gap: 6px;
      flex: 0 1 132px; min-width: 62px;
      padding: 0 10px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border);
      transition: width 0.18s ease, border-color 0.16s ease;
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
    .search-box.expanded {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 3;
      width: min(340px, 100%);
      border-color: var(--sc-accent);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .search-box:not(.expanded) input { text-overflow: ellipsis; }

    /* The advanced filters behind one quiet text link. Deliberately NOT a chip:
       it is the least important control here and should look it. */
    .filter-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0;
      background: transparent;
      border: 0;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.74rem, var(--sc-fs-floor));
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .filter-link:hover, .filter-link.open { color: var(--sc-accent); }
    .filter-link:focus-visible { border-radius: 4px; }
    .filter-link .chev { display: inline-block; font-size: max(0.68rem, var(--sc-fs-floor)); transition: transform 0.16s ease; }
    .filter-link .chev.open { transform: rotate(90deg); }
    .filter-link .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sc-accent-hot); }

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
    .status-chip:hover, .author-chip:hover, .tb-icon:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .status-chip.active, .author-chip.active { color: var(--sc-accent); border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.12); }
    /* The needs_input filter carries the same violet accent as its status pill. */
    .status-chip.needs_input.active { color: #a78bfa; border-color: #a78bfa; background: rgba(167, 139, 250, 0.14); }
    /* "Rückfrage an Absender" — same rosé as its pill, so the two directions of
       Rückfrage stay distinguishable in the filter row too. */
    .status-chip.needs_input_author.active { color: #f472b6; border-color: #f472b6; background: rgba(244, 114, 182, 0.14); }
    /* Archive chips echo their status pills: shipped green, issue indigo. */
    .status-chip.shipped.active { color: var(--sc-success); border-color: var(--sc-success); background: rgba(74, 222, 128, 0.14); }
    .status-chip.issue_created.active { color: #818cf8; border-color: #818cf8; background: rgba(129, 140, 248, 0.14); }

    /* Aktiv/Erledigt and Admins/Nutzer: one look, same kind of decision.
       Quieter than .view-switch — they split a list, not the board's mode. */
    .seg {
      display: inline-flex;
      padding: 2px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
    }
    .seg-tab {
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
    .seg-tab:hover { color: var(--sc-fg-0); }
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

    /* The sign-off view's own list styles (.rv-*) lived here. The view is gone
       (feedback d4990269, round 2 — the Abnahmen are worked inside the run), so
       the last of its CSS goes with it (feedback 03d7e546). */

    .status-chip.review { border-color: var(--sc-success); color: var(--sc-success); }
    .status-chip .chip-count { margin-left: 5px; opacity: 0.75; }

    .seg-tab.active { background: rgba(0, 212, 255, 0.14); color: var(--sc-accent); }
    .seg-tab .tab-count {
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-weight: 500;
      color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    .seg-tab.active .tab-count { color: inherit; }
    /* "Something waits here" on the Nutzer half — the Filter link's hot dot. */
    .seg-tab .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sc-accent-hot); }

    /* Toolbar icon button — one user now, the expand/collapse-all. The old
       three-icon cluster (feedback 3133f9) went with the two-row toolbar. */
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
    .tb-icon .chev { display: inline-block; font-size: max(0.72rem, var(--sc-fs-floor)); transition: transform 0.16s ease; }
    .tb-icon .chev.open { transform: rotate(90deg); }

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

    /* ---- The folded middle of a thread (feedback 03d7e546) ----
       One dashed "…" between the conversation's first and its newest message.
       Same control on both thread surfaces and deliberately the same look as the
       Abarbeiten run's fold, so "da ist Verlauf drunter" reads identically
       wherever the admin meets it. */
    .thread-more {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border: 1px dashed var(--sc-border);
      border-radius: 8px;
      background: transparent;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor));
      text-align: left;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .thread-more:hover { color: var(--sc-fg-0); border-color: var(--sc-fg-2); }
    .thread-more .ellipsis {
      font-size: 1.1rem; font-weight: 700; line-height: 0.8;
      letter-spacing: 0.08em; color: var(--sc-fg-0);
    }

    .msg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    /* The rare administrative acts, behind the "Weitere Aktionen" disclosure —
       quiet, set apart by a rule so they never read like part of the answer flow
       above them (feedback 03d7e546). */
    .more-actions {
      display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap;
      padding-top: 8px;
      border-top: 1px dashed var(--sc-border);
    }
    .sc-btn.micro.ghost { border-color: var(--sc-border); color: var(--sc-fg-2); }
    .sc-btn.micro.ghost:hover:not(:disabled) {
      border-color: var(--sc-accent); color: var(--sc-accent); background: transparent;
    }
    .sc-btn.micro.ghost .chev {
      display: inline-block; margin-right: 5px;
      font-size: max(0.7rem, var(--sc-fs-floor)); transition: transform 0.16s ease;
    }
    .sc-btn.micro.ghost .chev.open { transform: rotate(90deg); }
    /* Expand/collapse-all: icon only, hard right, tooltip carries the wording. */
    .tb-icon.expand-all { flex: 0 0 auto; padding: 4px 8px; }
    /* The ordered-but-undelivered issue, with its undo. Quiet: it reports a
       state, the button next to it is the only thing to act on. */
    .issue-pending { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .issue-pending .ip-text { color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
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
    /* The area tag is context, not state: quiet on purpose, so it never
       competes with the status pill it stands next to. */
    .status-pill.area { border-style: dashed; color: var(--sc-fg-2); }

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
      if (raw === 'overview' || raw === 'workflow' || raw === 'progress') return raw;
      // The Abnahme tab is gone (feedback d4990269, round 2). An admin who left
      // the board on it is looking for the sign-off pile, so hand them the run
      // already narrowed to it rather than silently dropping them somewhere else.
      if (raw === 'review') return 'workflow';
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

  /**
   * Which kind of step the processing mode is narrowed to (feedback d4990269,
   * round 2) — the Abnahme tab's replacement. Persisted behind the preferences
   * consent like the view and the scope.
   */
  readonly workflowKind = signal<WorkflowKind>(this.readWorkflowKind());

  setWorkflowKind(kind: WorkflowKind): void {
    this.workflowKind.set(kind);
    if (!this.consent.preferencesAllowed()) return;
    try {
      localStorage.setItem(WORKFLOW_KIND_KEY, kind);
    } catch {
      /* private mode / quota — the in-memory signal still works */
    }
  }

  private readWorkflowKind(): WorkflowKind {
    try {
      const raw = localStorage.getItem(WORKFLOW_KIND_KEY);
      if (raw === 'all' || raw === 'question' || raw === 'review') return raw;
      // Coming from the removed Abnahme tab (see readView): that admin wants the
      // sign-off pile, so open the run on it instead of on everything.
      if (localStorage.getItem(VIEW_KEY) === 'review') return 'review';
    } catch {
      /* ignore */
    }
    return DEFAULT_WORKFLOW_KIND;
  }

  /** The queue narrowed to the chosen scope — both lenses' common ground. */
  private readonly workflowScopeQueue = computed(() =>
    filterWorkflowScope(this.workflowQueueAll(), this.workflowScope(), this.selfId()),
  );

  /**
   * Queue size per scope — the KPI counts on the mode's scope switch. Counted on
   * the KIND-filtered queue, so each chip answers "what would I get if I switched
   * *this* chip" and the mode's "hidden by scope" hint stays truthful.
   */
  readonly workflowScopeCounts = computed(() =>
    workflowScopeCounts(
      filterWorkflowKind(this.workflowQueueAll(), this.workflowKind()),
      this.selfId(),
    ),
  );

  /** Item count per kind — counted within the current scope, mirror-image of above. */
  readonly workflowKindCounts = computed(() => workflowKindCounts(this.workflowScopeQueue()));

  /** What the view switch's badge promises: the whole inbox, kind lens ignored. */
  readonly workflowInboxCount = computed(() => this.workflowScopeQueue().length);

  /**
   * The queue as the processing mode shows it — narrowed by both lenses. The
   * view switch's badge deliberately reads the scope queue instead: the badge
   * promises what waits in the admin's inbox, and a kind filter is a way of
   * looking at that inbox, not a smaller one.
   */
  readonly workflowQueue = computed(() =>
    filterWorkflowKind(this.workflowScopeQueue(), this.workflowKind()),
  );

  /** Stable reply handler handed to the processing mode's inline composer. */
  readonly workflowReplyBound = (id: string, payload: ComposerPayload): Promise<boolean> =>
    this.sendReply(id, payload);

  /**
   * "Gespräch wieder aufnehmen" from the run (feedback d4990269, round 2): post
   * the steer into the thread, then put the topic back into the routine's queue.
   *
   * One handler rather than two clicks, and in this order: if the reply fails
   * nothing is reopened, and if the reopen fails the admin's words are already
   * saved. The routine then finds a reopened topic *with* the reason in the
   * thread — which is exactly what its continuation path reads.
   */
  readonly workflowReopenBound = async (
    id: string,
    payload: ComposerPayload,
  ): Promise<boolean> => {
    if (!(await this.sendReply(id, payload))) return false;
    const row = this.messages().find((m) => m.id === id);
    if (row) await this.reopenFromReview(row);
    return true;
  };

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

  // ---- Source filter: admin topics vs. user feedback ----------------------

  /**
   * Which half of the inbox the overview shows (admin feedback 18e96ad3): the
   * board the admins write for themselves, or what viewers sent in through
   * their own feedback box. Same two-button switch as Aktiv/Erledigt, and it
   * defaults to **Admins** because that is the pile an admin opens the board to
   * work — user feedback is triaged, not authored, and it announces itself: the
   * Nutzer button carries the count and a marker while anything there still
   * waits to be released to the routine, so defaulting away from it can never
   * hide an untouched report.
   */
  readonly sourceFilter = signal<FeedbackSource>('admin');

  setSourceFilter(source: FeedbackSource): void {
    if (this.sourceFilter() === source) return;
    this.sourceFilter.set(source);
    // The two halves have different status vocabularies in practice (only user
    // topics are ever "nicht freigegeben" or "nicht umgesetzt"), so a chip
    // carried across would silently filter the other half down to nothing.
    this.statusFilter.set(null);
    this.authorFilter.set(null);
    this.archiveVisible.set(AdminFeedbackComponent.ARCHIVE_PAGE);
  }

  private matchesSource(m: FeedbackRow): boolean {
    return this.sourceFilter() === 'user' ? isUserSubmitted(m) : !isUserSubmitted(m);
  }

  /** How many topics sit in each half, search-filtered (chip-independent). */
  readonly sourceCounts = computed(() => {
    let admin = 0;
    let user = 0;
    for (const m of this.messages()) {
      if (!this.matchesSearch(m)) continue;
      if (isUserSubmitted(m)) user++;
      else admin++;
    }
    return { admin, user };
  });

  /** Something in the user half still waits for its release to the routine. */
  readonly untriagedWaiting = computed(() =>
    this.messages().some((m) => awaitsTriage(m) && !isArchived(m, this.threads().get(m.id))),
  );

  /** Sentinel author-filter key for topics with no author (routine/orphaned). */
  private static readonly NO_AUTHOR = '__none__';
  /** Quick-access filter: an author_id (or NO_AUTHOR) to show only, or null for all. */
  readonly authorFilter = signal<string | null>(null);

  /** Distinct authors across all topics, most-topics first — feeds the filter chips. */
  readonly authorOptions = computed(() => {
    const seen = new Map<string, { id: string; label: string; count: number }>();
    for (const m of this.messages()) {
      if (!this.matchesSource(m)) continue;
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
      if (this.matchesSource(m) && this.matchesAuthor(m) && this.matchesSearch(m)) counts[this.bucketOf(m)]++;
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
      if (!this.matchesSource(m) || !this.matchesAuthor(m)) continue;
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
          this.matchesSource(m) &&
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
        (m) =>
          !isArchived(m, this.threads().get(m.id)) &&
          this.matchesSource(m) &&
          this.matchesAuthor(m) &&
          this.matchesSearch(m),
      ).length,
  );
  readonly archiveCount = computed(
    () =>
      this.messages().filter(
        (m) =>
          isArchived(m, this.threads().get(m.id)) &&
          this.matchesSource(m) &&
          this.matchesAuthor(m) &&
          this.matchesSearch(m),
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
    this.setExpanded(id, true);
    requestAnimationFrame(() => {
      document.getElementById(this.cardDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** True when every topic in the current tab is expanded. */
  readonly allExpanded = computed(() => {
    const visible = this.visibleMessages();
    return visible.length > 0 && visible.every((m) => this.isExpanded(m.id));
  });

  /**
   * Expand or collapse every topic of the current tab at once (feedback
   * c5b6b13c). Collapsing leaves just the topic headings so the board stays
   * scannable; only the tab's own rows are touched, so an expanded card in the
   * other tab is left as-is. Available in both shells since feedback 03d7e546 —
   * the full board folds its cards now, so it needs the same "alles zu".
   */
  toggleExpandAll(): void {
    const open = !this.allExpanded();
    for (const m of this.visibleMessages()) this.setExpanded(m.id, open);
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
          this.matchesSource(m) &&
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

  /**
   * Topics whose open state was flipped AWAY from the shell's default — not
   * "the open ones" (feedback 03d7e546).
   *
   * The two shells want opposite defaults: the docked panel keeps topics
   * collapsed (it is a narrow column and shows one guided question at a time),
   * the full board opens them (it is the reading surface). Storing the flip
   * rather than the state lets both live off one set, and it is what finally
   * gives the full board a working fold — it used to render every card open with
   * no control to close it, which is exactly the "expandieren/collapsen
   * funktioniert nicht" the admin hit.
   */
  private readonly _flipped = signal<Set<string>>(new Set());
  /** Topics already auto-expanded once, so a manual collapse is not undone on refresh. */
  private readonly _autoExpanded = new Set<string>();

  /** Whether a topic is open when the admin has not touched it. */
  private defaultOpen(): boolean {
    return !this.embedded();
  }

  isExpanded(id: string): boolean {
    return this._flipped().has(id) !== this.defaultOpen();
  }

  toggleExpand(id: string): void {
    this.setExpanded(id, !this.isExpanded(id));
  }

  /** Open or close one topic, keeping {@link _flipped} a set of deviations. */
  private setExpanded(id: string, open: boolean): void {
    const flip = open !== this.defaultOpen();
    this._flipped.update((set) => {
      if (set.has(id) === flip) return set;
      const next = new Set(set);
      if (flip) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Threads whose folded middle is unfolded, keyed by {@link threadFold}'s key
   * (feedback 03d7e546). Session-local and per thread: opening the history is
   * "let me look", never a preference — the next refresh keeps it, a reload
   * starts folded again.
   */
  private readonly _unfolded = signal<Set<string>>(new Set());

  foldOpen(key: string): boolean {
    return this._unfolded().has(key);
  }

  toggleFold(key: string): void {
    this._unfolded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** A folded thread plus the key its disclosure toggles. */
  private fold<T>(key: string, messages: readonly T[]): FoldedThread<T> & { key: string } {
    const folded = foldThread(messages);
    // Unfolded: everything is on screen in one run, but `hidden` keeps its
    // messages so the disclosure can still say how much it would fold back.
    if (this.foldOpen(key)) return { key, lead: null, hidden: folded.hidden, tail: messages };
    return { key, ...folded };
  }

  /**
   * The admin ↔ routine thread of one topic, folded to "first … newest"
   * (feedback 03d7e546). The topic's own body is the conversation's initial
   * message and sits above this, so what must never be scrolled for is the
   * newest reply.
   */
  threadFold(id: string): FoldedThread<FeedbackMessage> & { key: string } {
    return this.fold(`thread:${id}`, this.messagesFor(id));
  }

  /** The same fold over the author-visible channel of one topic. */
  authorFold(id: string): FoldedThread<AuthorFeedbackMessage> & { key: string } {
    return this.fold(`author:${id}`, this.authorMessagesFor(id));
  }

  /**
   * Topics whose "Weitere Aktionen" disclosure is open (feedback 03d7e546) —
   * the rare administrative acts (issue hand-off, nicht umsetzen, löschen) that
   * used to sit under every card as a permanent row of buttons.
   */
  private readonly _moreOpen = signal<Set<string>>(new Set());

  moreOpen(id: string): boolean {
    return this._moreOpen().has(id);
  }

  toggleMore(id: string): void {
    this._moreOpen.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Folding the actions away closes whatever form was open inside them, so a
    // half-typed decline note can never survive out of sight.
    if (!this.moreOpen(id) && this.declineFormFor() === id) this.cancelDeclineForm();
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
    if (awaiting.some((m) => this.isExpanded(m.id))) return;
    const first = awaiting[0];
    if (this._autoExpanded.has(first.id)) return; // manually collapsed — respect it
    this._autoExpanded.add(first.id);
    this.setExpanded(first.id, true);
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
    this.setExpanded(answeredId, false);
    const next = this.awaitingQuestions().find((m) => m.id !== answeredId);
    if (!next) return;
    this._autoExpanded.add(next.id);
    this.setExpanded(next.id, true);
    requestAnimationFrame(() => {
      document
        .getElementById(this.cardDomId(next.id))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /*
   * `bodyPreview` (the full board's two-sentence clamp, feedback 73dfa165) lived
   * here. It is gone with feedback 03d7e546: the card itself folds in both
   * shells now, so a second expand control *inside* an already expanded card was
   * one fold too many — and it was the reason a long thread grew a "mehr"
   * button per message.
   */

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
      .select('id, seq, author_id, body, status, ship_ref, processing_note, created_at, updated_at, shipped_at, processed_at, reviewed_at, source, triaged, decision_note, area, author:profiles(display_name, username)')
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
   * The area tag to show for a topic, or null when there is none to show
   * (admin feedback 835fec58). Narrowing rather than passing the raw column
   * through means a value this build does not know — an area removed from the
   * vocabulary, a hand-written row — renders as nothing instead of as a bare
   * identifier next to properly translated pills.
   */
  areaOf(m: FeedbackRow): FeedbackArea | null {
    return asFeedbackArea(m.area);
  }

  areaLabelKey(area: FeedbackArea): string {
    return feedbackAreaLabelKey(area);
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
    // `true` = the admin board may carry any file type (admin feedback
    // 312a4acc). Every non-admin send path leaves the flag at its default and
    // is refused a non-image before a request is made; the storage policy in
    // migration 20260903193000 refuses it again server-side.
    return uploadFeedbackImages(this.sb.client, this.selfId(), images, true);
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

  /**
   * The advanced filters (status + author chips) fold behind a quiet "Filter"
   * text link on the toolbar's second row (admin feedback 18e96ad3). Both
   * shells now: the full board had the chips permanently unrolled, which is the
   * bulk the admin asked to be put away.
   */
  readonly filtersOpen = signal(false);
  toggleFilters(): void { this.filtersOpen.update((v) => !v); }

  /**
   * The header search is a compact pill that grows over its neighbours while it
   * has focus or holds a query — the same gesture as the site-wide Ctrl+K
   * search (admin feedback 18e96ad3). It closes on Escape, on the × inside it
   * and on a click elsewhere; a query keeps it open, so a filtered list can
   * never be the work of a search box nobody can see.
   */
  readonly searchFocused = signal(false);
  readonly searchExpanded = computed(() => this.searchFocused() || this.searchQuery().length > 0);

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
      // `area` is nullable by design — an untagged topic stays untagged rather
      // than being filed under a guessed section (admin feedback 835fec58).
      .insert({ body, author_id: uid, area: payload.area ?? null });
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

  /**
   * "Issue erstellen" — hand the topic to the routine as an INSTRUCTION to open
   * a GitHub issue for it instead of implementing it (admin feedback 18e96ad3).
   *
   * The button used to read "Issue erstellt" and demanded a url on the spot,
   * which is the opposite motion: it recorded an issue the admin had already
   * filed by hand and archived the topic in the same click. The order the admin
   * wants is the ordinary one — instruct → the routine works → fertig / zur
   * Abnahme → Archiv — so this writes the instruction into the thread and
   * otherwise leaves the topic exactly where it is: `open`, in the routine's
   * queue, at its place in the oldest-first order.
   *
   * It is also the ONLY way a topic reaches `issue_created` (round 2 of the same
   * feedback removed the hand-recorded "Issue-Link eintragen" form): the routine
   * files the issue and writes the status and `ship_ref` itself.
   */
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

  /**
   * Take the instruction back — the misclick the admin asked to be able to undo
   * ("solange das issue noch nicht erstellt wurde sondern nur in todo ist").
   * Deleting the message is the whole undo: the topic never left the queue, so
   * there is no status or `ship_ref` to restore, and the conversation continues
   * where it was.
   */
  async undoIssueRequest(m: FeedbackRow): Promise<void> {
    const msg = this.issueRequest(m);
    if (!msg) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback_messages')
      .delete()
      .eq('id', msg.id);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    await this.refresh();
  }

  /** The topic's still-open issue request, or null. */
  issueRequest(m: FeedbackRow): FeedbackMessage | null {
    return pendingIssueRequest(m, this.threads().get(m.id));
  }

  /** Template-side alias: is an issue request waiting to be delivered? */
  issueRequested(m: FeedbackRow): boolean {
    return this.issueRequest(m) !== null;
  }

  /*
   * The inline "Issue-Link eintragen" form lived here: a url field that wrote
   * `status='issue_created'` + `ship_ref` by hand, for an issue the admin had
   * already filed elsewhere. It is gone (admin feedback 18e96ad3, round 2 —
   * "issue link eintragen ist unnötig und kann weg"). `issue_created` and
   * `ship_ref` stay: the ROUTINE writes both when it files an issue from an
   * open **[ISSUE]** order, which is now the only way a topic gets that status.
   */

  // ---- Review gate ----------------------------------------------------------

  /** Template-side alias: is this topic waiting for the admin's sign-off? */
  inReview(m: FeedbackRow): boolean {
    return awaitsReview(m, this.threads().get(m.id));
  }

  /*
   * The sign-off view's own queue, scope switch and "hidden by scope" hint lived
   * here. The view is gone (feedback d4990269, round 2) — the Abnahmen are worked
   * inside the run, under the run's own scope and kind lenses — so all of it went
   * with it. What stays is `inReview` (the in-card gate in the Übersicht still
   * asks it) and the two writes below, which the run calls.
   */

  /*
   * `reviewSince` (the sign-off card's date) and `openInOverview` ("Thema
   * öffnen") were the removed view's, and the run no longer needs either: it
   * dates an Abnahme itself, and it shows the whole topic instead of sending the
   * admin somewhere else to read it (feedback d4990269, round 2).
   */

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
   * Topics whose next author-channel message goes out as a QUESTION. Opt-in per
   * the admin's decision (feedback 5920cf8c, point 3): an ordinary note keeps
   * the topic reading "in Bearbeitung" on the author's side, only a question
   * surfaces there as its own "Rückfrage an dich" status.
   *
   * Keyed by topic since feedback 03d7e546. It used to be one board-wide flag,
   * so ticking the box on one card silently armed every other open card's
   * composer — the switch has to belong to the thread it sits in.
   */
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

  /** Disarm the question switch once its message went out. */
  private toggleAskAuthorOff(id: string): void {
    if (!this.asksAuthor(id)) return;
    this._asksAuthor.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
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
