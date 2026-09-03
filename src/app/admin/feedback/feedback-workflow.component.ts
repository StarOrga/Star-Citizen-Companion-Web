import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RenderedFeedbackBody, renderFeedbackBody } from './markdown.util';
import { CelebrationService } from './celebration.service';
import { FeedbackAttachmentsComponent } from './feedback-attachments.component';
import { ComposerPayload, FeedbackComposerComponent } from './feedback-composer.component';
import { draftScopes, memoScope } from '../../feedback/feedback-draft.types';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import {
  FeedbackMessage,
  FeedbackRow,
  WORKFLOW_KINDS,
  WORKFLOW_SCOPES,
  WorkflowItem,
  WorkflowKind,
  WorkflowKindCounts,
  WorkflowScope,
  WorkflowScopeCounts,
  awaitsTriage,
  isUserSubmitted,
  refKind,
  reviewSince,
  topicNumber,
  topicTitle,
  workflowFocusIndex,
} from './feedback.types';

/** How long the "moved on to the next topic" line and the arrival ring stay. */
const ADVANCE_NOTICE_MS = 2200;
/** Slide-in of the topic that took the finished one's place. */
const ADVANCE_SLIDE_MS = 380;

/**
 * Guided processing mode ("Abarbeitungsmodus") for the admin feedback board.
 *
 * Instead of scanning the whole board, the admin is walked through the queue
 * one topic at a time — everything that waits on *them* (see
 * `buildWorkflowQueue`). Topics that wait on the *routine* are not in it: the
 * mode is the admin's inbox, not the board (feedback b0cc6efc).
 *
 * Two kinds of step live in that inbox (feedback d4990269):
 *
 * - **Rückfrage** — topic, full thread and an inline composer; answering fires a
 *   short celebration and the queue moves on by itself once the topic leaves it.
 * - **Abnahme** — a finished topic waiting to be signed off. It carries exactly
 *   the two decisions the Abnahme tab has ("Ins Archiv — erledigt" and "Gespräch
 *   wieder aufnehmen") and the link to the result; nothing new was invented, the
 *   tiles were only folded into the one-at-a-time run so the admin sees a single
 *   item instead of a grid.
 *
 * Both kinds are worked here and nowhere else (feedback d4990269, round 2): the
 * Abnahme tab that used to hold the same rows as a tile grid is gone, replaced
 * by the **kind filter** above the card — Alle / Rückfragen / Abnahmen, each
 * with its count. Same rows, same order, same decisions; one surface instead of
 * two.
 *
 * The run is a **carousel with skip**: "Überspringen" parks the current item for
 * this lap and steps on; once every item of the lap has been seen the lap resets
 * and the run comes back around to the skipped ones (plus whatever arrived
 * meanwhile). Skipping is session-local — nothing is written to the row, the
 * database or localStorage.
 *
 * The queue itself is owned by the parent board (it holds the data, the "ticked
 * off" state and the writes behind the Abnahme decisions) — this component is a
 * pure presentation of it plus a cursor.
 */
@Component({
  selector: 'sc-feedback-workflow',
  standalone: true,
  imports: [ScDatePipe, TranslateModule, FeedbackAttachmentsComponent, FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wf" [class.compact]="compact()">
      <!-- Whose queue is being worked (feedback abfa97c6). Sits outside the
           card so it is reachable on the drained screen too — otherwise an
           empty "Meine" scope would trap the admin with no way to look at the
           others. Each chip carries its own count as the KPI. -->
      <div class="wf-scope" role="group" [attr.aria-label]="'adminFeedback.workflow.scope.label' | translate">
        @for (opt of scopeOptions(); track opt.key) {
          <button
            type="button"
            class="scope-chip"
            [class.active]="scope() === opt.key"
            [attr.aria-pressed]="scope() === opt.key"
            (click)="pickScope(opt.key)">
            {{ ('adminFeedback.workflow.scope.' + opt.key) | translate }}
            <span class="scope-count">{{ opt.count }}</span>
          </button>
        }
      </div>

      <!-- WHICH KIND of step to work (feedback d4990269, round 2). The Abnahme
           tab was a second surface for rows this run already walks; it is gone,
           and this lens replaces it — "nur Abnahmen" is now a chip in the run
           rather than a view of its own. Counts are within the current scope, so
           the number always describes what the switch will actually hand over. -->
      <div class="wf-scope kinds" role="group" [attr.aria-label]="'adminFeedback.workflow.kindFilter.label' | translate">
        @for (opt of kindOptions(); track opt.key) {
          <button
            type="button"
            class="scope-chip"
            [class.active]="kind() === opt.key"
            [attr.aria-pressed]="kind() === opt.key"
            (click)="pickKind(opt.key)">
            {{ ('adminFeedback.workflow.kindFilter.' + opt.key) | translate }}
            <span class="scope-count">{{ opt.count }}</span>
          </button>
        }
      </div>

      @if (current(); as item) {
        <!-- Progress: "3 von 7" plus a filling rail, so the run has a visible end. -->
        <div class="wf-progress">
          <span class="wf-count">
            {{ 'adminFeedback.workflow.progress' | translate: { current: position() + 1, total: total() } }}
          </span>
          <div
            class="rail"
            role="progressbar"
            [attr.aria-valuenow]="position() + 1"
            aria-valuemin="1"
            [attr.aria-valuemax]="total()">
            <span class="rail-fill" [style.width.%]="railPct()"></span>
          </div>
          <!-- How much of this lap was parked, so "übersprungen" is a visible
               pile the run will come back to rather than a silent detour. -->
          @if (skippedCount() > 0) {
            <span class="wf-skipped">
              {{ 'adminFeedback.workflow.skippedCount' | translate: { count: skippedCount() } }}
            </span>
          }
        </div>

        <!-- Ticking a topic off swaps the card's content in place — this line
             (plus the card's slide-in) says out loud that the queue moved on. -->
        @if (advanced(); as adv) {
          <p class="wf-advance" role="status">
            ✓ {{ 'adminFeedback.workflow.advanced' | translate: adv }}
          </p>
        }
        <!-- The lap came around: everything left was skipped once, so the run
             starts over on the parked items instead of pretending to be done. -->
        @if (lapWrapped()) {
          <p class="wf-advance lap" role="status">
            ↻ {{ 'adminFeedback.workflow.lapWrapped' | translate }}
          </p>
        }

        <article
          #card
          class="wf-card sc-card"
          [class.celebrate]="celebrating()"
          [class.arrived]="advanced() !== null"
          [class.is-review]="isReview(item)">
          <header class="wf-head">
            <!-- Which of the two steps is on screen (feedback d4990269) — the
                 Rückfrage the routine asked, or an Abnahme waiting for the
                 sign-off. The badge is the first thing in the card because the
                 actions at its foot differ. -->
            @if (isReview(item)) {
              <span class="kind review">{{ 'adminFeedback.workflow.kind.review' | translate }}</span>
              <!-- ...and how the topic got there: shipped, or handed to an issue.
                   Same wording the Abnahme tab's tiles carry. -->
              <span class="kind outcome">{{ ('adminFeedback.status.' + outcomeStatus(item)) | translate }}</span>
            } @else {
              <span class="kind question">{{ 'adminFeedback.workflow.kind.question' | translate }}</span>
            }
            <!-- Parked earlier in this lap and now back around — says why an
                 already-seen item is in front of the admin again. -->
            @if (isSkipped()) {
              <span class="kind skipped">{{ 'adminFeedback.workflow.skippedBadge' | translate }}</span>
            }
            <!-- A topic a viewer/collaborator filed (feedback 5920cf8c). The
                 author-facing controls — release, "nicht umsetzen", the channel to
                 the author — live in the Übersicht, so flag it here rather than
                 letting it read like an admin's own note. -->
            @if (fromUser(item)) {
              <span class="kind from-user">{{ 'adminFeedback.userTopic.badge' | translate }}</span>
              @if (untriaged(item)) {
                <span class="kind untriaged">{{ 'adminFeedback.userTopic.untriaged' | translate }}</span>
              }
            }
            <!-- Stable reference number (feedback 21587480), quiet and ahead of
                 the title — the handle the admin can quote back. -->
            @if (topicNo(item); as no) {
              <span
                class="wf-no"
                [attr.title]="'adminFeedback.topicNumber' | translate: { n: no }">#{{ no }}</span>
            }
            <span class="wf-title">{{ title(item) }}</span>
            <!-- An Abnahme is dated by the moment its outcome landed, not by the
                 day the topic was raised — that is how long it has been waiting. -->
            <span class="wf-ts">{{ stamp(item) | scDate }}</span>
          </header>

          @let body = render(item.row.body);
          <div class="wf-body" [innerHTML]="body.html"></div>
          <sc-feedback-attachments [images]="body.images" />

          @if (item.row.processing_note) {
            <p class="proc-note">{{ item.row.processing_note }}</p>
          }

          @if (isReview(item)) {
            <!-- What the sign-off is about: look at the result, then decide.
                 The link to the PR / issue is a real anchor, so it can be opened
                 in a new tab like any other link. -->
            <p class="rv-hint">{{ 'adminFeedback.review.hint' | translate }}</p>
            @if (item.row.ship_ref) {
              <a
                class="ship-ref"
                [class.issue]="linkKind(item) === 'issue'"
                [href]="item.row.ship_ref"
                target="_blank"
                rel="noopener noreferrer">
                {{ (linkKind(item) === 'issue' ? 'adminFeedback.issueRef' : 'adminFeedback.shipRef') | translate }} ↗
              </a>
            }
          }

          @if (item.replies.length > 0) {
            <!-- The thread is scrolled to the open Rückfrage on its own (see
                 workflowFocusIndex), so the admin never has to hunt for it.

                 Everything BEFORE that message is folded away behind one big
                 "…" (feedback d4990269, round 2): "will ich eigentlich nur den
                 original first post sehen, dann ein großes '...' und dann
                 zuletzt den letzten post". The first post is the card's body
                 right above, the tail is what the admin has to react to — the
                 middle is history, one click away when it is wanted. Nothing is
                 ever hidden that the run itself points at. -->
            <div #thread class="thread">
              @if (hiddenCount() > 0) {
                <button
                  type="button"
                  class="thread-more"
                  [attr.aria-expanded]="threadExpanded()"
                  (click)="toggleThread()">
                  <span class="ellipsis" aria-hidden="true">{{ threadExpanded() ? '⌃' : '…' }}</span>
                  {{ (threadExpanded()
                      ? 'adminFeedback.workflow.threadCollapse'
                      : 'adminFeedback.workflow.threadExpand') | translate: { count: hiddenCount() } }}
                </button>
              }
              @for (msg of visibleReplies(); track msg.id; let i = $index) {
                <div
                  #replyEl
                  class="reply"
                  [class.is-system]="msg.is_system"
                  [class.is-focus]="isFocused(i + visibleOffset(), msg)">
                  <div class="reply-head">
                    <span class="reply-author">{{ authorLabelFor(msg) }}</span>
                    @if (msg.is_system) {
                      @if (isFocused(i + visibleOffset(), msg)) {
                        <span class="reply-badge open">
                          {{ 'adminFeedback.workflow.openQuestion' | translate }}
                        </span>
                      } @else {
                        <span class="reply-badge">{{ 'adminFeedback.thread.routineBadge' | translate }}</span>
                      }
                    }
                    <span class="reply-ts">{{ msg.created_at | scDate: 'datetime' }}</span>
                  </div>
                  @let reply = render(msg.body);
                  <div class="reply-body" [innerHTML]="reply.html"></div>
                  <sc-feedback-attachments [images]="reply.images" />
                </div>
              }
            </div>
          }

          @if (celebrating()) {
            <p class="wf-cheer" role="status">{{ cheer() }}</p>
          }

          <!-- Answer box + step controls stay pinned to the bottom of the view:
               however long the topic and its thread are, the reply panel is
               always on screen (feedback fda4e3ea). -->
          <div class="wf-foot">
            @if (isReview(item)) {
              @if (reopening()) {
                <!-- "Gespräch wieder aufnehmen" is an ANSWER, not a bare status
                     flip (feedback d4990269, round 2): clicking it opens the
                     same box every other thread has, and the two decisions step
                     aside while it is open. Sending posts the reply AND puts the
                     topic back into the routine's queue in one go — so the
                     routine picks it up with the steer already in the thread,
                     instead of finding a reopened topic and no idea why. -->
                <p class="rv-hint">{{ 'adminFeedback.review.reopenHint' | translate }}</p>
                <div class="wf-compose">
                  <sc-feedback-composer
                    [allowFiles]="true"
                    [compact]="true"
                    [draftScope]="reopenScope(item.row.id)"
                    [busy]="busy()"
                    placeholder="adminFeedback.review.reopenPlaceholder"
                    sendLabel="adminFeedback.review.reopenSend"
                    [onSubmit]="submitReopen" />
                </div>
                <div class="wf-actions">
                  <button type="button" class="sc-btn micro" (click)="cancelReopen()" [disabled]="busy()">
                    {{ 'adminFeedback.review.reopenCancel' | translate }}
                  </button>
                </div>
              } @else {
                <!-- The Abnahme's own two decisions: accept ends the topic in the
                     Archiv, reopen opens the answer box above. The parent owns
                     both writes — this card only offers them one at a time
                     instead of as a tile in a grid. -->
                <div class="wf-actions">
                  <button
                    type="button"
                    class="sc-btn micro done"
                    (click)="accept(item)"
                    [disabled]="busy()">
                    ✓ {{ 'adminFeedback.review.accept' | translate }}
                  </button>
                  <button
                    type="button"
                    class="sc-btn micro"
                    (click)="startReopen()"
                    [disabled]="busy()">
                    ↻ {{ 'adminFeedback.review.reopen' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro" (click)="skip()">
                    {{ 'adminFeedback.workflow.skip' | translate }} ⤼
                  </button>
                </div>
              }
            } @else {
              <div class="wf-compose">
                <sc-feedback-composer
                  [allowFiles]="true"
                  [compact]="true"
                  [draftScope]="answerScope(item.row.id)"
                  [busy]="busy()"
                  placeholder="adminFeedback.workflow.answerPlaceholder"
                  sendLabel="adminFeedback.workflow.answerSend"
                  [onSubmit]="submit" />
              </div>

              <div class="wf-actions">
                <button type="button" class="sc-btn micro" (click)="skip()">
                  {{ 'adminFeedback.workflow.skip' | translate }} ⤼
                </button>
                <button type="button" class="sc-btn micro done" (click)="finish(item)">
                  ✓ {{ 'adminFeedback.workflow.done' | translate }}
                </button>
              </div>
            }
          </div>
        </article>
      } @else {
        <!-- Queue drained: the reward screen, with the dashboard one click away.
             Unless the scope is hiding work — then this is not "done", it is
             "done here", and the way on is the other scope, not the numbers. -->
        <div class="wf-empty sc-card">
          @if (hiddenByScope() > 0) {
            <div class="wf-empty-icon" aria-hidden="true">🗂️</div>
            <h3>{{ 'adminFeedback.workflow.scopeEmptyTitle' | translate }}</h3>
            <p>{{ 'adminFeedback.workflow.scopeEmptyHint' | translate: { count: hiddenByScope() } }}</p>
            <button type="button" class="sc-btn" (click)="pickScope('all')">
              {{ 'adminFeedback.workflow.scope.showAll' | translate }}
            </button>
          } @else if (hiddenByKind() > 0) {
            <!-- The kind lens is what is hiding the work — say that, instead of
                 celebrating an inbox that is not actually empty. -->
            <div class="wf-empty-icon" aria-hidden="true">🗂️</div>
            <h3>{{ 'adminFeedback.workflow.kindEmptyTitle' | translate }}</h3>
            <p>{{ 'adminFeedback.workflow.kindEmptyHint' | translate: { count: hiddenByKind() } }}</p>
            <button type="button" class="sc-btn" (click)="pickKind('all')">
              {{ 'adminFeedback.workflow.kindShowAll' | translate }}
            </button>
          } @else {
            <div class="wf-empty-icon" aria-hidden="true">🎉</div>
            <h3>{{ 'adminFeedback.workflow.allDoneTitle' | translate }}</h3>
            <p>{{ 'adminFeedback.workflow.allDoneHint' | translate }}</p>
            <button type="button" class="sc-btn" (click)="showProgress.emit()">
              {{ 'adminFeedback.view.progress' | translate }}
            </button>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .wf { display: flex; flex-direction: column; gap: 12px; }

    /* ---- Scope switch (whose topics are being worked) ---- */
    .wf-scope { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .scope-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      background: transparent;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .scope-chip:hover { color: var(--sc-fg-0); border-color: var(--sc-fg-2); }
    .scope-chip.active {
      color: var(--sc-accent);
      border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
    }
    .scope-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    /* The KPI: how many topics the scope holds right now. */
    .scope-count {
      min-width: 1.2em;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--sc-bg-2);
      font-size: max(0.66rem, var(--sc-fs-floor));
      font-weight: 700;
      text-align: center;
    }
    .scope-chip.active .scope-count {
      background: color-mix(in srgb, var(--sc-accent) 25%, transparent);
      color: var(--sc-accent);
    }

    /* The kind lens sits under the scope chips and reads as the quieter of the
       two — scope picks whose queue, kind only narrows what is already there. */
    .wf-scope.kinds { margin-top: -4px; }
    .wf-scope.kinds .scope-chip { font-size: max(0.68rem, var(--sc-fs-floor)); }

    /* ---- Progress rail ---- */
    .wf-progress { display: flex; align-items: center; gap: 10px; }
    .wf-count {
      flex: 0 0 auto;
      font-size: max(0.72rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .rail {
      flex: 1 1 auto;
      height: 4px;
      border-radius: 999px;
      background: var(--sc-bg-2);
      overflow: hidden;
    }
    .rail-fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--sc-accent), var(--sc-accent-hot));
      transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    /* How many items this lap parked — quiet, next to the rail. */
    .wf-skipped {
      flex: 0 0 auto;
      font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.04em;
      color: var(--sc-fg-2);
    }

    /* ---- Advance cue (a topic was ticked off) ----
       "Erledigt" pulls the topic out of the queue, so the card silently fills
       with the next one and only the "3 von 7" counter moves. This line names
       the step and, as a status role, is announced rather than just drawn
       (feedback 96872872). It stays put under reduced motion — only its rise
       and the card's slide-in are dropped there. */
    .wf-advance {
      margin: 0;
      font-size: max(0.76rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--sc-success);
      animation: wf-rise 0.35s ease-out;
    }
    /* Same line, other news: the carousel came back around to the skipped pile. */
    .wf-advance.lap { color: var(--sc-accent); }

    /* ---- The one card in focus ---- */
    .wf-card {
      display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }
    /* The just-arrived topic, held for the length of the advance notice. */
    .wf-card.arrived {
      border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--sc-accent) 30%, transparent);
    }
    .wf-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .kind {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: max(0.64rem, var(--sc-fs-floor));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .kind.question { background: rgba(167, 139, 250, 0.2); color: #a78bfa; }
    .kind.from-user { background: rgba(0, 212, 255, 0.1); color: var(--sc-accent); }
    .kind.untriaged { background: rgba(244, 114, 182, 0.18); color: #f472b6; }
    /* Abnahme steps wear the success accent the sign-off view uses, so the two
       kinds of step are told apart before a single word is read. */
    .kind.review { background: color-mix(in srgb, var(--sc-success) 20%, transparent); color: var(--sc-success); }
    .kind.outcome { border: 1px solid var(--sc-border); color: var(--sc-fg-2); }
    .kind.skipped { border: 1px dashed var(--sc-border); color: var(--sc-fg-2); }
    /* Same left edge the Abnahme tiles carry in the sign-off view. */
    .wf-card.is-review { border-left: 3px solid var(--sc-success); }
    .rv-hint { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); line-height: 1.45; color: var(--sc-fg-2); }
    .ship-ref { align-self: flex-start; font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; }
    .ship-ref:hover { text-decoration: underline; }
    .ship-ref.issue { color: #818cf8; }
    .wf-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--sc-fg-0);
    }
    .wf-ts { flex: 0 0 auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    /* Reference number: same quiet treatment as in the Übersicht rows — a handle
       next to the title, never competing with it. */
    .wf-no {
      flex: 0 0 auto;
      color: var(--sc-fg-2);
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      user-select: all;
    }

    .wf-body { font-size: 0.92rem; line-height: 1.5; overflow-wrap: anywhere; }
    .wf-body :first-child { margin-top: 0; }
    .wf-body :last-child { margin-bottom: 0; }
    .wf-body p { margin: 0 0 8px; }
    .wf-body ul, .wf-body ol { margin: 0 0 8px; padding-left: 1.4em; }
    .wf-body a { color: var(--sc-accent); }
    .wf-body code {
      font-family: monospace; font-size: 0.85em;
      background: var(--sc-bg-2); padding: 1px 5px; border-radius: 3px;
    }
    /* Screenshots are not part of the body flow — see sc-feedback-attachments. */
    .proc-note { margin: 0; font-size: 0.8rem; color: var(--sc-fg-2); font-style: italic; }

    .thread {
      display: flex; flex-direction: column; gap: 8px;
      padding-left: 10px; border-left: 2px solid var(--sc-border);
      max-height: 320px; overflow-y: auto;
    }
    /* The folded middle of the thread: one big "…" the admin can open if they
       want the history, and that stays out of the way if they don't. */
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
    .thread-more:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    .thread-more .ellipsis {
      font-size: 1.1rem;
      font-weight: 700;
      line-height: 0.8;
      letter-spacing: 0.08em;
      color: var(--sc-fg-0);
    }

    .reply { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--sc-bg-2); }
    .reply.is-system { background: color-mix(in srgb, #a78bfa 12%, var(--sc-bg-2)); box-shadow: inset 2px 0 0 #a78bfa; }
    .reply-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .reply-author { font-weight: 600; font-size: 0.82rem; }
    .reply-badge {
      font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em;
      padding: 1px 6px; border-radius: 999px;
      background: color-mix(in srgb, #a78bfa 25%, transparent); color: #a78bfa;
    }
    /* The Rückfrage the view scrolled to — marked so the eye lands on it. */
    .reply.is-focus {
      background: color-mix(in srgb, #a78bfa 20%, var(--sc-bg-2));
      box-shadow: inset 3px 0 0 #a78bfa, 0 0 0 1px color-mix(in srgb, #a78bfa 45%, transparent);
      scroll-margin-top: 8px;
    }
    .reply-badge.open {
      background: #a78bfa;
      color: var(--sc-bg-0);
      font-weight: 700;
    }
    .reply-ts { margin-left: auto; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .reply-body { font-size: 0.88rem; line-height: 1.45; overflow-wrap: anywhere; }
    .reply-body :first-child { margin-top: 0; }
    .reply-body :last-child { margin-bottom: 0; }
    .reply-body p { margin: 0 0 6px; }
    .reply-body a { color: var(--sc-accent); }

    /* ---- Always-visible answer panel ----
       Sticks to the bottom edge of whichever scrollport the board runs in — the
       docked panel scrolls .board, the full page scrolls the document — so the
       composer and the step controls never scroll out from under the admin.
       The negative margins let it span the card's padding, so the thread slides
       under a full-width bar instead of a floating island. */
    .wf-foot {
      position: sticky;
      bottom: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0 -16px -14px;
      padding: 10px 16px 14px;
      background: var(--sc-bg-1);
      border-top: 1px solid var(--sc-border);
      border-radius: 0 0 8px 8px;
    }

    .wf-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sc-btn.micro { padding: 4px 12px; font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.done { color: var(--sc-success); border-color: var(--sc-success); }
    .sc-btn.micro.done:hover:not(:disabled) { background: var(--sc-success); color: var(--sc-bg-0); }
    /* "Thema öffnen" leaves the run — quiet, so it never competes with a decision. */
    .sc-btn.micro.ghost { border-color: var(--sc-border); color: var(--sc-fg-2); }
    .sc-btn.micro.ghost:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); background: transparent; box-shadow: none; }

    /* ---- Celebration ---- */
    .wf-cheer {
      margin: 0;
      font-weight: 600;
      font-size: 0.86rem;
      color: var(--sc-success);
    }
    .wf-card.celebrate {
      border-color: color-mix(in srgb, var(--sc-success) 60%, var(--sc-border));
      animation: wf-pop 0.5s cubic-bezier(0.2, 0.9, 0.25, 1);
    }
    @keyframes wf-pop {
      0% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-success) 55%, transparent); }
      45% { transform: scale(1.015); box-shadow: 0 0 0 8px color-mix(in srgb, var(--sc-success) 0%, transparent); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
    }
    .wf-cheer { animation: wf-rise 0.4s ease-out; }
    @keyframes wf-rise {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }

    /* ---- Drained queue ---- */
    .wf-empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 32px 20px; text-align: center;
    }
    .wf-empty h3 { margin: 0; font-size: 1rem; }
    .wf-empty p { margin: 0; color: var(--sc-fg-2); font-size: 0.86rem; }
    .wf-empty-icon { font-size: 2rem; animation: wf-bounce 1.1s ease-in-out 2; }
    @keyframes wf-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    /* Respect the OS motion preference — no pop, no bounce, no rise, and no
       slide-in for the next topic (suppressed in playSlideIn). The advance
       notice and the card's arrival ring stay: the step must remain visible
       without motion. (The confetti burst is suppressed in CelebrationService.) */
    @media (prefers-reduced-motion: reduce) {
      .rail-fill { transition: none; }
      .wf-card.celebrate, .wf-cheer, .wf-advance, .wf-empty-icon { animation: none; }
    }

    /* Docked panel: tighter vertical rhythm so the one card and its always-on
       answer foot own the panel, matching the Übersicht density pass (3133f9). */
    .wf.compact { gap: 8px; }
    .wf.compact .thread { max-height: 220px; }
    .wf.compact .wf-card { padding: 12px 12px; }
    .wf.compact .wf-foot { margin: 0 -12px -12px; padding: 8px 12px 12px; }
  `],
})
export class FeedbackWorkflowComponent {
  private readonly translate = inject(TranslateService);
  private readonly celebration = inject(CelebrationService);
  private readonly injector = inject(Injector);

  /** The processing queue, in working order — owned by the parent board. */
  readonly queue = input.required<WorkflowItem[]>();
  /** Current user id, so own replies are labelled "Du". */
  readonly selfId = input<string | null>(null);
  /** Board-level busy flag, forwarded to the composer. */
  readonly busy = input(false);
  /** Rendering inside the docked FAB panel rather than the full page. */
  readonly compact = input(false);
  /** Which scope the (already filtered) queue was built for — owned by the parent. */
  readonly scope = input<WorkflowScope>('all');
  /** Queue size per scope, rendered as the switch's KPI counts. */
  readonly scopeCounts = input<WorkflowScopeCounts>({ mine: 0, others: 0, all: 0 });
  /** Which kind the (already filtered) queue was narrowed to — owned by the parent. */
  readonly kind = input<WorkflowKind>('all');
  /** Item count per kind within the current scope — the kind switch's KPIs. */
  readonly kindCounts = input<WorkflowKindCounts>({ all: 0, question: 0, review: 0 });
  /** Posts a reply into a topic's thread; resolves true once persisted. */
  readonly reply = input.required<(feedbackId: string, payload: ComposerPayload) => Promise<boolean>>();
  /**
   * Posts a reply into a finished topic's thread AND puts it back into the
   * routine's queue — the Abnahme's "Gespräch wieder aufnehmen", which is one
   * decision and therefore one call (feedback d4990269, round 2). Resolves true
   * once both landed; the parent owns the writes.
   */
  readonly reopenWithReply =
    input.required<(feedbackId: string, payload: ComposerPayload) => Promise<boolean>>();

  /** The admin ticked an item off — the parent removes it from the queue. */
  readonly markHandled = output<string>();
  /** The admin picked another scope — the parent re-filters and remembers it. */
  readonly scopeChange = output<WorkflowScope>();
  /** The admin picked another kind lens — the parent re-filters and remembers it. */
  readonly kindChange = output<WorkflowKind>();
  /** "Show me the numbers" from the drained-queue screen. */
  readonly showProgress = output<void>();
  /**
   * Signing an Abnahme off (feedback d4990269) — the board's existing write,
   * forwarded unchanged: it stamps `reviewed_at` and the topic lands in the
   * Archiv. This component never touches a row itself.
   *
   * Its counterpart, "Gespräch wieder aufnehmen", is no longer an output: it
   * carries a message now and goes through {@link reopenWithReply}. "Thema
   * öffnen" is gone with it — the card shows the whole topic (feedback
   * d4990269, round 2), so there is nothing left to jump to.
   */
  readonly acceptReview = output<FeedbackRow>();

  private readonly cardEl = viewChild<ElementRef<HTMLElement>>('card');
  private readonly threadEl = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly replyEls = viewChildren<ElementRef<HTMLElement>>('replyEl');

  /** Raw cursor; clamped against the (shrinking) queue by {@link position}. */
  private readonly cursor = signal(0);

  readonly total = computed(() => this.queue().length);
  readonly position = computed(() => {
    const total = this.total();
    if (total === 0) return 0;
    return Math.min(this.cursor(), total - 1);
  });
  readonly current = computed<WorkflowItem | null>(() => this.queue()[this.position()] ?? null);

  /** The scope switch, in fixed order, each with its KPI count. */
  readonly scopeOptions = computed(() => {
    const counts = this.scopeCounts();
    return WORKFLOW_SCOPES.map((key) => ({ key, count: counts[key] }));
  });

  /** The kind switch, in fixed order (Alle first), each with its KPI count. */
  readonly kindOptions = computed(() => {
    const counts = this.kindCounts();
    return WORKFLOW_KINDS.map((key) => ({ key, count: counts[key] }));
  });

  /**
   * How many queue items the current scope is hiding. Non-zero on a drained
   * queue means "nothing left *here*" rather than "nothing left" — the empty
   * screen then points at the other scope instead of celebrating.
   */
  readonly hiddenByScope = computed(() => this.scopeCounts().all - this.total());

  /**
   * How many items the KIND lens is hiding — the same idea one dimension over
   * (feedback d4990269, round 2). Without it a run filtered to "Abnahmen" with
   * no Abnahme waiting would show the "Alles abgearbeitet" screen while
   * Rückfragen sit right behind the filter.
   */
  readonly hiddenByKind = computed(() => this.kindCounts().all - this.total());
  readonly railPct = computed(() => {
    const total = this.total();
    return total === 0 ? 100 : ((this.position() + 1) / total) * 100;
  });

  /**
   * Index of the thread message the view puts in front of the admin: the open
   * Rückfrage, else the thread end (see `workflowFocusIndex`). `null` when the
   * topic has no replies yet.
   */
  readonly focusIndex = computed(() => workflowFocusIndex(this.current()?.replies ?? []));

  /**
   * Whether the folded-away middle of the thread is showing (feedback d4990269,
   * round 2). Per card and session-local: unfolding is "let me look", not a
   * preference, and the next topic starts folded again (see the reset effect).
   */
  readonly threadExpanded = signal(false);

  /**
   * How many messages the fold hides — everything before the one the run points
   * at ({@link focusIndex}). Zero when the run points at the thread's first
   * message, so a short thread never grows a control it does not need.
   */
  readonly hiddenCount = computed(() => {
    if (this.threadExpanded()) return 0;
    return this.focusIndex() ?? 0;
  });

  /**
   * Index of the first message on screen, so the focus marker and the scroll
   * effect keep addressing messages by their position in the FULL thread while
   * the template renders only the tail.
   */
  readonly visibleOffset = computed(() => this.hiddenCount());

  /** The thread as rendered: the tail the admin has to react to, or all of it. */
  readonly visibleReplies = computed(() => {
    const replies = this.current()?.replies ?? [];
    return this.hiddenCount() > 0 ? replies.slice(this.hiddenCount()) : replies;
  });

  /**
   * Unfold the thread's history, or fold it back to the tail. The scroll key is
   * dropped with it, so the message the run points at is put back in front of
   * the admin after the thread changed length under them.
   */
  toggleThread(): void {
    this.focusedKey = null;
    this.threadExpanded.update((open) => !open);
  }

  /**
   * How many of the items still in the queue were parked in this lap. Ids of
   * items that meanwhile left the queue are not counted — the number promises
   * "you will come back to this many", so it has to describe the live queue.
   */
  readonly skippedCount = computed(() => {
    const skipped = this.skipped();
    if (skipped.size === 0) return 0;
    let count = 0;
    for (const item of this.queue()) if (skipped.has(item.row.id)) count++;
    return count;
  });

  /** True while the card in front of the admin is one an earlier lap parked. */
  readonly isSkipped = computed(() => {
    const item = this.current();
    return !!item && this.parked().has(item.row.id);
  });

  /** Short celebratory line shown on the card right after an answer landed. */
  readonly celebrating = signal(false);
  readonly cheer = signal('');
  private cheerTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Where the run stands right after a topic was ticked off — `null` while no
   * step is being reported. Drives the advance notice and the card's arrival
   * ring; the shape doubles as the translation params for the notice.
   */
  readonly advanced = signal<{ current: number; total: number } | null>(null);
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Ids parked with "Überspringen" in the CURRENT lap (feedback d4990269).
   *
   * Session-local on purpose: skipping is a "not now", not a decision about the
   * topic — it must not touch the row, the routine's state machine or a
   * persisted preference. The set therefore lives and dies with the view, and it
   * empties itself whenever a lap closes (see {@link skip}) or the scope changes.
   */
  private readonly skipped = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * What the PREVIOUS lap parked — snapshotted when a lap wraps, so an item the
   * carousel brings back around can say "du hast mich übersprungen". Kept apart
   * from {@link skipped}, which only ever holds the running lap.
   */
  private readonly parked = signal<ReadonlySet<string>>(new Set<string>());

  /** The carousel just wrapped onto the parked items — drives the lap notice. */
  readonly lapWrapped = signal(false);
  private lapTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Topic id whose Abnahme decision is in flight (feedback d4990269).
   *
   * Unlike "Erledigt", the two sign-off decisions are a round trip to the
   * database — the topic only leaves the queue once the parent's write came back
   * and the board refreshed. Remembering which one was decided lets the card
   * report the step when that happens, instead of silently swapping its content
   * the way the tick-off used to (feedback 96872872).
   */
  private readonly deciding = signal<string | null>(null);

  /**
   * Topic id whose "Gespräch wieder aufnehmen" box is open (feedback d4990269,
   * round 2) — `null` while the two decisions are showing instead. Keyed by id
   * rather than a bare flag so the box can never survive onto the next card if
   * the queue moves under it.
   */
  private readonly reopeningFor = signal<string | null>(null);

  /** True while the current card shows the reopen answer box. */
  readonly reopening = computed(() => {
    const id = this.reopeningFor();
    return id !== null && id === this.current()?.row.id;
  });

  /** `topicId:messageId` the thread was last scrolled to — guards re-scrolls. */
  private focusedKey: string | null = null;

  constructor() {
    // Queue drained after actually working through it → one closing burst.
    // Mounting on an already-empty queue must stay silent, hence the latch —
    // and so must switching to a scope that happens to be empty, which is a
    // change of view, not an achievement (hence the scope check).
    let sawWork = false;
    // Either lens re-filters the queue, so both re-arm it: a run narrowed to
    // "Abnahmen" is a different queue, not a drained one.
    let lastLens = `${this.scope()}:${this.kind()}`;
    effect(() => {
      const scope = `${this.scope()}:${this.kind()}`;
      const total = this.total();
      if (scope !== lastLens) {
        lastLens = scope;
        // Re-arm against the new scope's queue instead of celebrating it.
        sawWork = total > 0;
        // A different queue starts at its head — and at a fresh lap, so nothing
        // in it counts as "already skipped".
        this.cursor.set(0);
        this.clearLap();
        return;
      }
      if (total > 0) {
        sawWork = true;
        return;
      }
      if (!sawWork) return;
      sawWork = false;
      this.celebration.burst();
    });

    // A sign-off decision landed: the topic is gone from the queue, so the card
    // in front of the admin is a different one — say so and slide it in, exactly
    // as the tick-off does. If the write failed the topic is still here; the
    // parent has stopped working by then, so the marker is simply dropped.
    effect(() => {
      const pending = this.deciding();
      if (!pending) return;
      const queue = this.queue();
      if (queue.some((item) => item.row.id === pending)) {
        if (!this.busy()) this.deciding.set(null);
        return;
      }
      this.deciding.set(null);
      if (queue.length === 0) return;
      this.announceAdvance(queue.length);
      this.playSlideIn();
    });

    // A different topic is in front of the admin → its thread starts folded
    // again, and a reopen box left open on the previous one is dropped. Both
    // are "let me look at this one", never a setting that should travel.
    let lastCardId: string | null = null;
    effect(() => {
      const id = this.current()?.row.id ?? null;
      if (id === lastCardId) return;
      lastCardId = id;
      this.threadExpanded.set(false);
      this.reopeningFor.set(null);
    });

    // Put the open Rückfrage in front of the admin instead of the thread's
    // scroll origin. Keyed on the focused message, so the board's polling
    // refresh does not yank the thread back while the admin reads.
    effect(() => {
      const item = this.current();
      const idx = this.focusIndex();
      const els = this.replyEls();
      const thread = this.threadEl()?.nativeElement;
      if (!item || idx === null || !thread) {
        this.focusedKey = null;
        return;
      }
      const key = `${item.row.id}:${item.replies[idx]?.id ?? idx}`;
      if (key === this.focusedKey) return;
      // The template renders only the visible tail, so the absolute focus index
      // has to be shifted by whatever the fold is hiding.
      const el = els[idx - this.visibleOffset()]?.nativeElement;
      // Query not settled yet — leave the key untouched so the next pass retries.
      if (!el) return;
      this.focusedKey = key;
      this.scrollThreadTo(thread, el);
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.cheerTimer) clearTimeout(this.cheerTimer);
      if (this.advanceTimer) clearTimeout(this.advanceTimer);
      if (this.lapTimer) clearTimeout(this.lapTimer);
    });
  }

  /**
   * Switch the queue's scope. The parent owns (and remembers) the choice and
   * hands back a re-filtered queue; the cursor is reset by the effect above so
   * the new scope starts at its own head.
   */
  pickScope(scope: WorkflowScope): void {
    if (scope === this.scope()) return;
    this.clearAdvance();
    this.scopeChange.emit(scope);
  }

  /**
   * Narrow the run to one kind of step — the Abnahme tab's replacement
   * (feedback d4990269, round 2). Like the scope, the parent owns and remembers
   * the choice and hands back a re-filtered queue.
   */
  pickKind(kind: WorkflowKind): void {
    if (kind === this.kind()) return;
    this.clearAdvance();
    this.kindChange.emit(kind);
  }

  /** True for the one thread message the view scrolled to, if it is a Rückfrage. */
  isFocused(index: number, msg: FeedbackMessage): boolean {
    return msg.is_system && index === this.focusIndex();
  }

  /**
   * Scroll the thread box so the focused message starts at its top edge. Only
   * the thread's own scrollport moves — the page around it stays put. Honours
   * `prefers-reduced-motion` by jumping instead of animating.
   */
  private scrollThreadTo(thread: HTMLElement, el: HTMLElement): void {
    const delta = el.getBoundingClientRect().top - thread.getBoundingClientRect().top;
    const top = Math.max(0, thread.scrollTop + delta - 4);
    if (typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top, behavior: this.celebration.reducedMotion ? 'auto' : 'smooth' });
    } else {
      thread.scrollTop = top;
    }
  }

  title(item: WorkflowItem): string {
    return topicTitle(item.row.body, this.compact() ? 48 : 72);
  }

  /**
   * The topic's stable reference number, or `null` when it has none (feedback
   * 21587480) — the same "#42" the Übersicht row shows, so an admin working the
   * queue can name the topic they are on.
   */
  topicNo(item: WorkflowItem): number | null {
    return topicNumber(item.row);
  }

  /**
   * True for an Abnahme step — a finished topic waiting for the sign-off rather
   * than a Rückfrage waiting for an answer (feedback d4990269).
   */
  isReview(item: WorkflowItem): boolean {
    return item.kind === 'review';
  }

  /**
   * How an Abnahme step's topic reached the gate, in the board's own status
   * vocabulary: shipped, or handed to a GitHub issue.
   */
  outcomeStatus(item: WorkflowItem): 'shipped' | 'issue_created' {
    return item.row.status === 'issue_created' ? 'issue_created' : 'shipped';
  }

  /** Whether the result link points at a PR or at an issue (shared rule). */
  linkKind(item: WorkflowItem): 'issue' | 'ship' {
    return refKind(item.row);
  }

  /**
   * The date the card shows: when the topic was raised for a Rückfrage, when its
   * outcome landed for an Abnahme — in both cases "waiting since".
   */
  stamp(item: WorkflowItem): string {
    return this.isReview(item) ? reviewSince(item.row) : item.row.created_at;
  }

  /** Filed by a viewer/collaborator through the public feedback FAB. */
  fromUser(item: WorkflowItem): boolean {
    return isUserSubmitted(item.row);
  }

  /** …and still held back from the autonomous routine. */
  untriaged(item: WorkflowItem): boolean {
    return awaitsTriage(item.row);
  }

  render(body: string): RenderedFeedbackBody {
    return renderFeedbackBody(body);
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

  /**
   * Park the current item for this lap and step on — the carousel's one way of
   * moving forward (feedback d4990269).
   *
   * It walks to the next item the lap has not shown yet. When there is none, the
   * lap is over: the parked set is emptied and the run comes back around to the
   * skipped items (and anything that arrived meanwhile), announced by the lap
   * notice. Nothing is written anywhere — the item keeps its status, its place in
   * the queue and its actions; it was only postponed.
   */
  skip(): void {
    const item = this.current();
    if (!item) return;
    this.clearAdvance();

    const total = this.total();
    const from = this.position();
    const skipped = new Set(this.skipped());
    skipped.add(item.row.id);

    for (let step = 1; step < total; step++) {
      const index = (from + step) % total;
      if (skipped.has(this.queue()[index].row.id)) continue;
      this.skipped.set(skipped);
      this.cursor.set(index);
      // Stepping on purpose needs no explanation, but the card still swaps in
      // place — the same slide keeps every way of moving on consistent.
      this.playSlideIn();
      return;
    }

    // Everything left has been seen once → new lap on the parked pile.
    this.parked.set(skipped);
    this.skipped.set(new Set<string>());
    if (total > 1) this.cursor.set((from + 1) % total);
    this.announceLap();
    this.playSlideIn();
  }

  /**
   * Take one of the Abnahme's two decisions on the current card (feedback
   * d4990269) — accept the outcome, or pick the conversation back up.
   *
   * Both are the board's existing writes, forwarded untouched; this only notes
   * which topic is being decided so the run can report the step once the write
   * came back (see the `deciding` effect). A parked item that gets decided is no
   * longer waiting, so it is dropped from the lap too — otherwise the carousel
   * would promise to come back to a topic that is already gone.
   */
  accept(item: WorkflowItem): void {
    this.clearAdvance();
    this.deciding.set(item.row.id);
    this.forget(item.row.id);
    this.acceptReview.emit(item.row);
  }

  /**
   * Open the answer box on an Abnahme instead of flipping the topic's status on
   * the spot (feedback d4990269, round 2). The two decisions step aside while it
   * is open — the admin is answering the thread now, and "erledigt" would be a
   * contradiction of the sentence they are writing.
   */
  startReopen(): void {
    const item = this.current();
    if (!item) return;
    this.clearAdvance();
    this.reopeningFor.set(item.row.id);
  }

  /** Back out of the answer box — the two decisions come back, nothing was written. */
  cancelReopen(): void {
    this.reopeningFor.set(null);
  }

  private readonly reopenScopes = new Map<string, string>();

  /**
   * Draft identity of the reopen box. Its own scope per topic, and a different
   * one from the Rückfrage answer box: a half-written steer must come back to
   * the topic it was written for, and must not surface in the other box.
   */
  reopenScope(feedbackId: string): string {
    return memoScope(this.reopenScopes, feedbackId, draftScopes.adminWorkflowReopen);
  }

  /**
   * Send the steer: the parent posts it into the thread and reopens the topic in
   * one call. The topic then leaves the queue on the next refresh, which the
   * `deciding` effect reports exactly like a sign-off.
   */
  readonly submitReopen = async (payload: ComposerPayload): Promise<boolean> => {
    const item = this.current();
    if (!item) return false;
    const id = item.row.id;
    const ok = await this.reopenWithReply()(id, payload);
    if (!ok) return false;
    this.reopeningFor.set(null);
    this.deciding.set(id);
    this.forget(id);
    return true;
  };

  /** Drop a topic from the lap's bookkeeping — it is no longer "come back later". */
  private forget(id: string): void {
    if (this.skipped().has(id)) {
      const next = new Set(this.skipped());
      next.delete(id);
      this.skipped.set(next);
    }
    if (this.parked().has(id)) {
      const next = new Set(this.parked());
      next.delete(id);
      this.parked.set(next);
    }
  }

  /**
   * Tick the current item off. The status stays untouched — the nightly routine
   * owns the state machine — so this only takes the topic out of the admin's
   * working queue until the routine touches it again.
   *
   * The topic leaves the queue synchronously, which means the card is refilled
   * with the next topic without anything moving — the admin could not tell the
   * view had changed (feedback 96872872). So the step is reported: the next
   * card slides in, wears an arrival ring and a status line names where the run
   * now stands.
   */
  finish(item: WorkflowItem): void {
    // A ticked-off topic is done, not postponed — the lap must not still count
    // it among the items it will come back to.
    this.forget(item.row.id);
    this.markHandled.emit(item.row.id);
    // The parent drops the topic while emitting, so the queue signals already
    // describe the topic that took its place.
    const total = this.total();
    // Queue drained: the "Alles abgearbeitet" screen is change enough.
    if (total === 0) return;
    this.announceAdvance(total);
    this.playSlideIn();
  }

  /** Show "weiter mit x von y" for a moment, then fall back to the plain card. */
  private announceAdvance(total: number): void {
    // A finished topic is the newer news — drop a standing lap notice.
    if (this.lapTimer) clearTimeout(this.lapTimer);
    this.lapWrapped.set(false);
    this.advanced.set({ current: this.position() + 1, total });
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = setTimeout(() => this.advanced.set(null), ADVANCE_NOTICE_MS);
  }

  private clearAdvance(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
    this.advanced.set(null);
  }

  /** Say that the run wrapped onto the items it had parked, then fall quiet. */
  private announceLap(): void {
    this.lapWrapped.set(true);
    if (this.lapTimer) clearTimeout(this.lapTimer);
    this.lapTimer = setTimeout(() => this.lapWrapped.set(false), ADVANCE_NOTICE_MS);
  }

  /** Start a fresh lap: nothing parked, no lap notice standing. */
  private clearLap(): void {
    if (this.lapTimer) clearTimeout(this.lapTimer);
    this.lapTimer = null;
    this.lapWrapped.set(false);
    this.skipped.set(new Set<string>());
    this.parked.set(new Set<string>());
  }

  /**
   * Slide the card that now holds the next topic in from the right. Runs on the
   * refilled DOM (hence `afterNextRender`) and is skipped under
   * `prefers-reduced-motion` — the notice and the arrival ring carry the step
   * there.
   */
  private playSlideIn(): void {
    if (this.celebration.reducedMotion) return;
    afterNextRender(
      () => {
        this.cardEl()?.nativeElement.animate?.(
          [
            { opacity: 0.2, transform: 'translate3d(22px, 0, 0)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: ADVANCE_SLIDE_MS, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' },
        );
      },
      { injector: this.injector },
    );
  }

  private readonly answerScopes = new Map<string, string>();

  /**
   * Draft identity of the answer box for one topic. Its own scope rather than
   * the thread's: the queue moves on to the next item while a half-written
   * answer may still be sitting here, and each must come back to its own topic.
   */
  answerScope(feedbackId: string): string {
    return memoScope(this.answerScopes, feedbackId, draftScopes.adminWorkflow);
  }

  /**
   * Composer handler: posts the answer via the parent, then celebrates. The
   * cursor is deliberately left where it is — the answered Rückfrage drops out
   * of the queue on the next refresh, so the same index already shows the next
   * item.
   */
  readonly submit = async (payload: ComposerPayload): Promise<boolean> => {
    const item = this.current();
    if (!item) return false;
    const ok = await this.reply()(item.row.id, payload);
    if (ok) this.celebrate();
    return ok;
  };

  private celebrate(): void {
    this.cheer.set(this.translate.instant('adminFeedback.workflow.cheerAnswered'));
    // The answer is the news now — drop a still-running advance notice.
    this.clearAdvance();
    this.celebrating.set(true);
    this.celebration.burstFrom(this.cardEl()?.nativeElement);
    if (this.cheerTimer) clearTimeout(this.cheerTimer);
    this.cheerTimer = setTimeout(() => this.celebrating.set(false), 2600);
  }
}
