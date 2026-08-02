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
  WORKFLOW_SCOPES,
  WorkflowItem,
  WorkflowScope,
  WorkflowScopeCounts,
  awaitsTriage,
  isUserSubmitted,
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
 * one topic at a time — every Rückfrage the routine is waiting on, oldest
 * first (see `buildWorkflowQueue`). Topics that wait on the *routine* are not
 * in it: the mode is the admin's inbox, not the board (feedback b0cc6efc).
 * Each step shows the topic, its full thread and an inline composer; answering
 * fires a short celebration and the queue moves on by itself once the topic
 * leaves it.
 *
 * The queue itself is owned by the parent board (it holds the data and the
 * "ticked off" state) — this component is a pure presentation of it plus a
 * cursor.
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
        </div>

        <!-- Ticking a topic off swaps the card's content in place — this line
             (plus the card's slide-in) says out loud that the queue moved on. -->
        @if (advanced(); as adv) {
          <p class="wf-advance" role="status">
            ✓ {{ 'adminFeedback.workflow.advanced' | translate: adv }}
          </p>
        }

        <article
          #card
          class="wf-card sc-card"
          [class.celebrate]="celebrating()"
          [class.arrived]="advanced() !== null">
          <header class="wf-head">
            <!-- Every queue item is an open Rückfrage now (feedback b0cc6efc),
                 so the badge names the one kind instead of switching. -->
            <span class="kind question">{{ 'adminFeedback.workflow.kind.question' | translate }}</span>
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
            <span class="wf-ts">{{ item.row.created_at | scDate }}</span>
          </header>

          @let body = render(item.row.body);
          <div class="wf-body" [innerHTML]="body.html"></div>
          <sc-feedback-attachments [images]="body.images" />

          @if (item.row.processing_note) {
            <p class="proc-note">{{ item.row.processing_note }}</p>
          }

          @if (item.replies.length > 0) {
            <!-- The thread is scrolled to the open Rückfrage on its own (see
                 workflowFocusIndex), so the admin never has to hunt for it. -->
            <div #thread class="thread">
              @for (msg of item.replies; track msg.id; let i = $index) {
                <div
                  #replyEl
                  class="reply"
                  [class.is-system]="msg.is_system"
                  [class.is-focus]="isFocused(i, msg)">
                  <div class="reply-head">
                    <span class="reply-author">{{ authorLabelFor(msg) }}</span>
                    @if (msg.is_system) {
                      @if (isFocused(i, msg)) {
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
            <div class="wf-compose">
              <sc-feedback-composer
                [compact]="true"
                [draftScope]="answerScope(item.row.id)"
                [busy]="busy()"
                placeholder="adminFeedback.workflow.answerPlaceholder"
                sendLabel="adminFeedback.workflow.answerSend"
                [onSubmit]="submit" />
            </div>

            <div class="wf-actions">
              <button type="button" class="sc-btn micro" (click)="next()" [disabled]="total() < 2">
                {{ 'adminFeedback.workflow.next' | translate }} →
              </button>
              <button type="button" class="sc-btn micro done" (click)="finish(item)">
                ✓ {{ 'adminFeedback.workflow.done' | translate }}
              </button>
            </div>
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
  /** Posts a reply into a topic's thread; resolves true once persisted. */
  readonly reply = input.required<(feedbackId: string, payload: ComposerPayload) => Promise<boolean>>();

  /** The admin ticked an item off — the parent removes it from the queue. */
  readonly markHandled = output<string>();
  /** The admin picked another scope — the parent re-filters and remembers it. */
  readonly scopeChange = output<WorkflowScope>();
  /** "Show me the numbers" from the drained-queue screen. */
  readonly showProgress = output<void>();

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

  /**
   * How many queue items the current scope is hiding. Non-zero on a drained
   * queue means "nothing left *here*" rather than "nothing left" — the empty
   * screen then points at the other scope instead of celebrating.
   */
  readonly hiddenByScope = computed(() => this.scopeCounts().all - this.total());
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

  /** `topicId:messageId` the thread was last scrolled to — guards re-scrolls. */
  private focusedKey: string | null = null;

  constructor() {
    // Queue drained after actually working through it → one closing burst.
    // Mounting on an already-empty queue must stay silent, hence the latch —
    // and so must switching to a scope that happens to be empty, which is a
    // change of view, not an achievement (hence the scope check).
    let sawWork = false;
    let lastScope = this.scope();
    effect(() => {
      const scope = this.scope();
      const total = this.total();
      if (scope !== lastScope) {
        lastScope = scope;
        // Re-arm against the new scope's queue instead of celebrating it.
        sawWork = total > 0;
        // A different queue starts at its head.
        this.cursor.set(0);
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
      const el = els[idx]?.nativeElement;
      // Query not settled yet — leave the key untouched so the next pass retries.
      if (!el) return;
      this.focusedKey = key;
      this.scrollThreadTo(thread, el);
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.cheerTimer) clearTimeout(this.cheerTimer);
      if (this.advanceTimer) clearTimeout(this.advanceTimer);
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
   * Step to the next item, wrapping at the end so a queue worked by skipping
   * never strands an item out of reach.
   */
  next(): void {
    const total = this.total();
    if (total < 2) return;
    this.clearAdvance();
    this.cursor.set((this.position() + 1) % total);
    // Stepping on purpose needs no explanation, but the card still swaps in
    // place — the same slide keeps the two ways of moving on consistent.
    this.playSlideIn();
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
    this.advanced.set({ current: this.position() + 1, total });
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = setTimeout(() => this.advanced.set(null), ADVANCE_NOTICE_MS);
  }

  private clearAdvance(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
    this.advanced.set(null);
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
