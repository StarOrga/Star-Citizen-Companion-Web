import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { renderMarkdown } from './markdown.util';
import { CelebrationService } from './celebration.service';
import { ComposerPayload, FeedbackComposerComponent } from './feedback-composer.component';
import { FeedbackMessage, WorkflowItem, topicTitle, workflowFocusIndex } from './feedback.types';

/**
 * Guided processing mode ("Abarbeitungsmodus") for the admin feedback board.
 *
 * Instead of scanning the whole board, the admin is walked through the queue
 * one topic at a time: first every Rückfrage the routine is waiting on, then
 * untouched new topics (see `buildWorkflowQueue`). Each step shows the topic,
 * its full thread and an inline composer; answering fires a short celebration
 * and the queue moves on by itself once the topic leaves it.
 *
 * The queue itself is owned by the parent board (it holds the data and the
 * "ticked off" state) — this component is a pure presentation of it plus a
 * cursor.
 */
@Component({
  selector: 'sc-feedback-workflow',
  standalone: true,
  imports: [DatePipe, TranslateModule, FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wf" [class.compact]="compact()">
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

        <article #card class="wf-card sc-card" [class.celebrate]="celebrating()">
          <header class="wf-head">
            <span class="kind" [class]="item.kind">
              {{ ('adminFeedback.workflow.kind.' + item.kind) | translate }}
            </span>
            <span class="wf-title">{{ title(item) }}</span>
            <span class="wf-ts">{{ item.row.created_at | date: 'shortDate' }}</span>
          </header>

          <div class="wf-body" [innerHTML]="render(item.row.body)"></div>

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
                    <span class="reply-ts">{{ msg.created_at | date: 'short' }}</span>
                  </div>
                  <div class="reply-body" [innerHTML]="render(msg.body)"></div>
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
        <!-- Queue drained: the reward screen, with the dashboard one click away. -->
        <div class="wf-empty sc-card">
          <div class="wf-empty-icon" aria-hidden="true">🎉</div>
          <h3>{{ 'adminFeedback.workflow.allDoneTitle' | translate }}</h3>
          <p>{{ 'adminFeedback.workflow.allDoneHint' | translate }}</p>
          <button type="button" class="sc-btn" (click)="showProgress.emit()">
            {{ 'adminFeedback.view.progress' | translate }}
          </button>
        </div>
      }
    </section>
  `,
  styles: [`
    .wf { display: flex; flex-direction: column; gap: 12px; }

    /* ---- Progress rail ---- */
    .wf-progress { display: flex; align-items: center; gap: 10px; }
    .wf-count {
      flex: 0 0 auto;
      font-size: 0.72rem;
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

    /* ---- The one card in focus ---- */
    .wf-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
    .wf-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .kind {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.64rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .kind.question { background: rgba(167, 139, 250, 0.2); color: #a78bfa; }
    .kind.new { background: rgba(0, 212, 255, 0.16); color: var(--sc-accent); }
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
    .wf-ts { flex: 0 0 auto; color: var(--sc-fg-2); font-size: 0.72rem; }

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
    .wf-body img {
      display: block; max-width: 100%; height: auto; margin: 6px 0;
      border: 1px solid var(--sc-border); border-radius: 6px;
    }
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
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;
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
    .reply-ts { margin-left: auto; color: var(--sc-fg-2); font-size: 0.72rem; }
    .reply-body { font-size: 0.88rem; line-height: 1.45; overflow-wrap: anywhere; }
    .reply-body :first-child { margin-top: 0; }
    .reply-body :last-child { margin-bottom: 0; }
    .reply-body p { margin: 0 0 6px; }
    .reply-body a { color: var(--sc-accent); }
    .reply-body img { display: block; max-width: 100%; height: auto; margin: 6px 0; border-radius: 6px; }

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
    .sc-btn.micro { padding: 4px 12px; font-size: 0.72rem; letter-spacing: 0.04em; }
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

    /* Respect the OS motion preference — no pop, no bounce, no rise.
       (The confetti burst is suppressed in CelebrationService.) */
    @media (prefers-reduced-motion: reduce) {
      .rail-fill { transition: none; }
      .wf-card.celebrate, .wf-cheer, .wf-empty-icon { animation: none; }
    }

    /* Docked panel: tighter thread window so the composer stays reachable. */
    .wf.compact .thread { max-height: 220px; }
    .wf.compact .wf-card { padding: 12px 12px; }
    .wf.compact .wf-foot { margin: 0 -12px -12px; padding: 8px 12px 12px; }
  `],
})
export class FeedbackWorkflowComponent {
  private readonly translate = inject(TranslateService);
  private readonly celebration = inject(CelebrationService);

  /** The processing queue, in working order — owned by the parent board. */
  readonly queue = input.required<WorkflowItem[]>();
  /** Current user id, so own replies are labelled "Du". */
  readonly selfId = input<string | null>(null);
  /** Board-level busy flag, forwarded to the composer. */
  readonly busy = input(false);
  /** Rendering inside the docked FAB panel rather than the full page. */
  readonly compact = input(false);
  /** Posts a reply into a topic's thread; resolves true once persisted. */
  readonly reply = input.required<(feedbackId: string, payload: ComposerPayload) => Promise<boolean>>();

  /** The admin ticked an item off — the parent removes it from the queue. */
  readonly markHandled = output<string>();
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

  /** `topicId:messageId` the thread was last scrolled to — guards re-scrolls. */
  private focusedKey: string | null = null;

  constructor() {
    // Queue drained after actually working through it → one closing burst.
    // Mounting on an already-empty queue must stay silent, hence the latch.
    let sawWork = false;
    effect(() => {
      const total = this.total();
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
    });
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

  render(body: string): string {
    return renderMarkdown(body);
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
    this.cursor.set((this.position() + 1) % total);
  }

  /**
   * Tick the current item off. The status stays untouched — the nightly routine
   * owns the state machine — so this only takes the topic out of the admin's
   * working queue until the routine touches it again.
   */
  finish(item: WorkflowItem): void {
    this.markHandled.emit(item.row.id);
  }

  /**
   * Composer handler: posts the answer via the parent, then celebrates. The
   * cursor is deliberately left where it is — an answered Rückfrage drops out
   * of the queue on the next refresh (so the same index shows the next item),
   * while an answered `open` topic stays put and can be ticked off explicitly.
   */
  readonly submit = async (payload: ComposerPayload): Promise<boolean> => {
    const item = this.current();
    if (!item) return false;
    const ok = await this.reply()(item.row.id, payload);
    if (ok) this.celebrate(item);
    return ok;
  };

  private celebrate(item: WorkflowItem): void {
    const key = item.kind === 'question'
      ? 'adminFeedback.workflow.cheerAnswered'
      : 'adminFeedback.workflow.cheerReplied';
    this.cheer.set(this.translate.instant(key));
    this.celebrating.set(true);
    this.celebration.burstFrom(this.cardEl()?.nativeElement);
    if (this.cheerTimer) clearTimeout(this.cheerTimer);
    this.cheerTimer = setTimeout(() => this.celebrating.set(false), 2600);
  }
}
