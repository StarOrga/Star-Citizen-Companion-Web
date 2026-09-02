import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
// The composer and the markdown renderer live under admin/feedback for
// historical reasons but are plain, admin-agnostic building blocks — reused
// here so the non-admin box has the same draft handling, image paste/drop and
// Ctrl/Cmd+Enter behaviour instead of a second, poorer implementation.
import {
  ComposerPayload,
  FeedbackComposerComponent,
} from '../admin/feedback/feedback-composer.component';
import { FeedbackAttachmentsComponent } from '../admin/feedback/feedback-attachments.component';
import { RenderedFeedbackBody, renderFeedbackBody } from '../admin/feedback/markdown.util';
import { UserFeedbackService } from './user-feedback.service';
import { draftScopes, memoScope } from './feedback-draft.types';
import { AuthorFeedbackRow } from './user-feedback.types';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/** Which half of the panel is on screen. */
type UserFeedbackTab = 'compose' | 'mine';

/**
 * The non-admin feedback panel (feedback 5920cf8c): compose a new topic and
 * follow the ones already sent.
 *
 * What it deliberately does NOT show is as important as what it does. The
 * author sees a coarse status only — "in Bearbeitung" / "Rückfrage an dich" /
 * "umgesetzt" / "nicht umgesetzt" — never the raw board status, never the
 * routine's processing notes, never the admin <-> Claude thread. That is
 * enforced in the database (the `public.my_feedback` projection is the only
 * thing this component can read); the UI just has nothing else to render.
 *
 * The one interactive channel is a question an admin explicitly addressed to
 * the author: it surfaces as its own status and opens a reply box. A routine
 * `needs_input` question — which is aimed at the ADMIN — never appears here and
 * keeps reading as "in Bearbeitung".
 */
@Component({
  selector: 'sc-user-feedback-panel',
  standalone: true,
  imports: [ScDatePipe, TranslateModule, FeedbackAttachmentsComponent, FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel-root">
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="tab() === 'compose'"
          [attr.aria-selected]="tab() === 'compose'"
          (click)="tab.set('compose')">
          {{ 'userFeedback.tab.compose' | translate }}
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="tab() === 'mine'"
          [attr.aria-selected]="tab() === 'mine'"
          (click)="selectMine()">
          {{ 'userFeedback.tab.mine' | translate }}
          @if (topics().length > 0) {
            <span class="tab-count">{{ topics().length }}</span>
          }
          @if (openQuestions() > 0) {
            <span class="tab-dot" [attr.aria-label]="'userFeedback.questionsPending' | translate"></span>
          }
        </button>
      </div>

      @if (feedback.error(); as err) {
        <div class="err">
          <strong>{{ 'userFeedback.errorTitle' | translate }}:</strong>
          @switch (err) {
            @case ('upload') { {{ 'userFeedback.uploadError' | translate }} }
            @case ('rate') { {{ 'userFeedback.rateLimit' | translate }} }
            @case ('preview') { {{ 'userFeedback.impersonationBlocked' | translate }} }
            @default { {{ err }} }
          }
        </div>
      }

      @if (tab() === 'compose') {
        <div class="compose-pane">
          <p class="intro">{{ 'userFeedback.intro' | translate }}</p>
          @if (sentJustNow()) {
            <div class="ok" role="status">{{ 'userFeedback.sent' | translate }}</div>
          }
          <sc-feedback-composer
            [draftScope]="composeScope"
            [busy]="feedback.busy()"
            placeholder="userFeedback.placeholder"
            sendLabel="userFeedback.send"
            [onSubmit]="submitBound" />
          <p class="privacy">{{ 'userFeedback.privacyHint' | translate }}</p>
        </div>
      } @else {
        <div class="mine-pane">
          @if (feedback.busy() && topics().length === 0) {
            <p class="muted">{{ 'userFeedback.loading' | translate }}</p>
          } @else if (topics().length === 0) {
            <p class="muted">{{ 'userFeedback.empty' | translate }}</p>
          } @else {
            @for (t of topics(); track t.id) {
              <article class="topic sc-card" [class.needs-answer]="t.author_status === 'question'">
                <button
                  type="button"
                  class="topic-head"
                  (click)="toggle(t.id)"
                  [attr.aria-expanded]="isOpen(t.id)">
                  <span class="chev" [class.open]="isOpen(t.id)">▸</span>
                  <span class="topic-title">{{ title(t) }}</span>
                  <span class="status-pill" [class]="t.author_status">
                    {{ ('userFeedback.status.' + t.author_status) | translate }}
                  </span>
                </button>

                @if (isOpen(t.id)) {
                  <div class="topic-detail">
                    <span class="ts">{{ t.created_at | scDate: 'datetime' }}</span>
                    @let topicBody = render(t.body);
                    <div class="body" [innerHTML]="topicBody.html"></div>
                    <sc-feedback-attachments [images]="topicBody.images" />

                    @if (t.author_status === 'declined' && t.decision_note) {
                      <div class="decision">
                        <strong>{{ 'userFeedback.declinedTitle' | translate }}</strong>
                        <p>{{ t.decision_note }}</p>
                      </div>
                    }

                    @if (messagesFor(t.id).length > 0) {
                      <div class="thread">
                        @for (msg of messagesFor(t.id); track msg.id) {
                          <div class="reply" [class.is-admin]="msg.from_admin">
                            <div class="reply-head">
                              <span class="reply-author">
                                {{ (msg.from_admin ? 'userFeedback.team' : 'userFeedback.you') | translate }}
                              </span>
                              @if (msg.is_question) {
                                <span class="reply-badge">{{ 'userFeedback.questionBadge' | translate }}</span>
                              }
                              <span class="reply-ts">{{ msg.created_at | scDate: 'datetime' }}</span>
                            </div>
                            @let replyBody = render(msg.body);
                            <div class="reply-body" [innerHTML]="replyBody.html"></div>
                            <sc-feedback-attachments [images]="replyBody.images" />
                          </div>
                        }
                      </div>
                    }

                    <!-- The reply box opens only on an actual question to the
                         author: the channel is for answering, not a general
                         chat with the admins. -->
                    @if (t.author_status === 'question') {
                      <sc-feedback-composer
                        [compact]="true"
                        [draftScope]="replyScope(t.id)"
                        [busy]="feedback.busy()"
                        placeholder="userFeedback.answerPlaceholder"
                        sendLabel="userFeedback.answer"
                        [onSubmit]="replySubmitFor(t.id)" />
                    }
                  </div>
                }
              </article>
            }
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .panel-root {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1 1 auto;
      min-height: 0;
      padding: 14px;
      box-sizing: border-box;
      overflow-y: auto;
    }

    .tabs { display: flex; gap: 6px; }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-2);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .tab:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .tab.active { color: var(--sc-fg-0); border-color: var(--sc-accent); background: var(--sc-bg-2); }
    .tab-count { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .tab-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--sc-accent-hot);
    }

    .intro { margin: 0; font-size: 0.84rem; color: var(--sc-fg-2); line-height: 1.5; }
    .privacy { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); opacity: 0.85; line-height: 1.45; }
    .compose-pane, .mine-pane { display: flex; flex-direction: column; gap: 10px; }

    .err {
      padding: 8px 10px;
      border: 1px solid var(--sc-danger);
      background: rgba(248, 113, 113, 0.1);
      color: var(--sc-danger);
      border-radius: 6px;
      font-size: 0.8rem;
    }
    .ok {
      padding: 8px 10px;
      border: 1px solid var(--sc-accent);
      background: rgba(0, 212, 255, 0.1);
      color: var(--sc-fg-0);
      border-radius: 6px;
      font-size: 0.8rem;
    }
    .muted { margin: 0; font-size: 0.84rem; color: var(--sc-fg-2); }

    .topic { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .topic.needs-answer { border-color: var(--sc-accent-hot); }
    .topic-head {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .chev { color: var(--sc-fg-2); transition: transform 0.16s ease; }
    .chev.open { transform: rotate(90deg); }
    .topic-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.86rem;
      color: var(--sc-fg-0);
    }
    .ts { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .status-pill {
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--sc-border);
      font-size: max(0.7rem, var(--sc-fs-floor));
      white-space: nowrap;
      color: var(--sc-fg-2);
    }
    .status-pill.question { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }
    .status-pill.done { border-color: var(--sc-accent); color: var(--sc-accent); }
    .status-pill.declined { opacity: 0.75; }

    .topic-detail { display: flex; flex-direction: column; gap: 8px; }
    .body, .reply-body { font-size: 0.84rem; line-height: 1.5; color: var(--sc-fg-1); }
    /* Screenshots are not part of the body flow — see sc-feedback-attachments. */

    .decision {
      padding: 8px 10px;
      border-left: 3px solid var(--sc-border);
      background: var(--sc-bg-1);
      border-radius: 4px;
      font-size: 0.82rem;
    }
    .decision p { margin: 4px 0 0; color: var(--sc-fg-1); }

    .thread { display: flex; flex-direction: column; gap: 8px; }
    .reply {
      padding: 8px 10px;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      background: var(--sc-bg-1);
    }
    .reply.is-admin { border-color: var(--sc-accent); }
    .reply-head { display: flex; align-items: center; gap: 8px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .reply-author { font-weight: 600; color: var(--sc-fg-1); }
    .reply-badge {
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid var(--sc-accent-hot);
      color: var(--sc-accent-hot);
    }
  `],
})
export class UserFeedbackPanelComponent implements OnInit {
  readonly feedback = inject(UserFeedbackService);

  /** Draft identity of the new-topic box (see `FeedbackDraftService`). */
  readonly composeScope = draftScopes.userNew;
  readonly tab = signal<UserFeedbackTab>('compose');
  readonly topics = this.feedback.topics;
  readonly openQuestions = this.feedback.openQuestions;

  /** Short-lived confirmation after a successful send. */
  readonly sentJustNow = signal(false);

  /** Topics the author opened by hand. */
  private readonly _expanded = signal<ReadonlySet<string>>(new Set());
  /** Topics the author folded away again — overrides the auto-expand below. */
  private readonly _collapsed = signal<ReadonlySet<string>>(new Set());

  /** Topics with a pending question start expanded — that is the actionable one. */
  private readonly autoExpanded = computed(
    () => new Set(this.topics().filter((t) => t.author_status === 'question').map((t) => t.id)),
  );

  async ngOnInit(): Promise<void> {
    // The FAB already loads the topics up front (it needs the badge count), so
    // only a cold open actually fetches here.
    if (!this.feedback.loaded()) await this.feedback.refresh();
  }

  selectMine(): void {
    this.tab.set('mine');
    void this.feedback.refresh();
  }

  render(body: string): RenderedFeedbackBody {
    return renderFeedbackBody(body);
  }

  /** One-line title derived from the body — the author never typed a subject. */
  title(t: AuthorFeedbackRow): string {
    const text = (t.body ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '—';
    return text.length > 56 ? `${text.slice(0, 54).trimEnd()}…` : text;
  }

  messagesFor(id: string) {
    return this.feedback.messagesFor(id);
  }

  isOpen(id: string): boolean {
    if (this._collapsed().has(id)) return false;
    return this._expanded().has(id) || this.autoExpanded().has(id);
  }

  toggle(id: string): void {
    const open = this.isOpen(id);
    // An auto-expanded topic needs the explicit collapse marker, otherwise
    // dropping it from `_expanded` would leave the auto-expand rule in charge
    // and the card could never be folded away.
    this._collapsed.update((cur) => {
      const next = new Set(cur);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    this._expanded.update((cur) => {
      const next = new Set(cur);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Stable handler reference for the new-topic composer. */
  readonly submitBound = async (payload: ComposerPayload): Promise<boolean> => {
    const ok = await this.feedback.submit(payload);
    if (ok) {
      this.sentJustNow.set(true);
      setTimeout(() => this.sentJustNow.set(false), 6000);
    }
    return ok;
  };

  private readonly replyScopes = new Map<string, string>();

  /** Draft identity of one topic's answer box, memoized for a stable binding. */
  replyScope(id: string): string {
    return memoScope(this.replyScopes, id, draftScopes.userReply);
  }

  private readonly replySubmitters = new Map<string, (p: ComposerPayload) => Promise<boolean>>();

  replySubmitFor(id: string): (p: ComposerPayload) => Promise<boolean> {
    let fn = this.replySubmitters.get(id);
    if (!fn) {
      fn = (p: ComposerPayload) => this.feedback.reply(id, p);
      this.replySubmitters.set(id, fn);
    }
    return fn;
  }
}
