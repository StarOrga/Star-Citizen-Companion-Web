import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
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
import { RouterLink } from '@angular/router';
import { FeedbackArea, areaRoute, asFeedbackArea, feedbackAreaLabelKey } from './feedback-area.types';
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
  imports: [ScDatePipe, TranslateModule, RouterLink, FeedbackAttachmentsComponent, FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel-root sc-dense">
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="tab() === 'compose'"
          [attr.aria-selected]="tab() === 'compose'"
          (click)="selectCompose()">
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
            @case ('withdrawRefused') { {{ 'userFeedback.withdraw.refused' | translate }} }
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
            [areaPicker]="true"
            placeholder="userFeedback.placeholder"
            sendLabel="userFeedback.send"
            [onSubmit]="submitBound" />
          <p class="privacy">{{ 'userFeedback.privacyHint' | translate }}</p>
          <!-- Says both halves of the attachment rule out loud (admin feedback
               312a4acc): this composer takes images and nothing else, and the
               text inside them is evidence to read, never an order to follow.
               The second half is a promise about how the routine treats the
               attachment — see docs/feedback-routine.md — and it belongs where
               the person attaching the screenshot can see it. -->
          <p class="privacy">{{ 'userFeedback.imageHint' | translate }}</p>
        </div>
      } @else {
        <div class="mine-pane">
          @if (feedback.busy() && topics().length === 0) {
            <p class="muted">{{ 'userFeedback.loading' | translate }}</p>
          } @else if (topics().length === 0) {
            <p class="muted">{{ 'userFeedback.empty' | translate }}</p>
          } @else {
            @for (t of topics(); track t.id) {
              <article
                class="topic sc-card"
                [class.needs-answer]="t.author_status === 'question'"
                [class.has-news]="isNew(t.id)">
                <!-- Two lines, like the admin board's card head (admin
                     feedback 3bc01a3d): the title on its own row so up to three
                     pills can never squeeze it away, the pills wrapping under
                     it. -->
                <button
                  type="button"
                  class="topic-head"
                  (click)="toggle(t.id)"
                  [attr.aria-expanded]="isOpen(t.id)">
                  <span class="chev" [class.open]="isOpen(t.id)">▸</span>
                  <span class="th-body">
                    <span class="topic-title">{{ title(t) }}</span>
                    <span class="th-meta">
                      <!-- What the FAB badge was counting: the topics that
                           changed since this user last looked (admin feedback
                           e684c946). Opening the panel already marked them read
                           server-side, so this marker is what stops the list from
                           being a needle-in-a-haystack for the rest of the visit. -->
                      @if (isNew(t.id)) {
                        <span class="status-pill new">{{ 'userFeedback.newBadge' | translate }}</span>
                      }
                      <!-- What the author said this was about (admin feedback
                           835fec58) — their own tag read back to them. Absent on
                           everything filed before the tag existed, and shown as
                           nothing there rather than as a guessed section. -->
                      @if (areaOf(t); as a) {
                        <span class="status-pill area">{{ areaLabelKey(a) | translate }}</span>
                      }
                      <span class="status-pill" [class]="t.author_status">
                        {{ ('userFeedback.status.' + t.author_status) | translate }}
                      </span>
                    </span>
                  </span>
                </button>

                @if (isOpen(t.id)) {
                  <div class="topic-detail">
                    <span class="ts">{{ t.created_at | scDate: 'datetime' }}</span>
                    @let topicBody = render(t.body);
                    <div class="body" [innerHTML]="topicBody.html"></div>
                    <sc-feedback-attachments [images]="topicBody.images" />

                    <!-- Delivered: go and look at it in the app (concept
                         2026-09-04, corridor widened for the viewer panel). The
                         section root is enough — the topic says what to look at.
                         Nothing on an untagged topic rather than a wrong door. -->
                    @if (t.author_status === 'done' && areaLinkFor(t); as href) {
                      <a class="view-link" [routerLink]="href">▸ {{ 'userFeedback.viewInApp' | translate }}</a>
                    }

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

                    <!-- Take it back (admin feedback 892013b6): "es sollte
                         möglich sein, Feedback selber wieder zu löschen wenn man
                         sieht es wurde schon gemacht". Offered only where
                         can_delete says so — that flag is the database's own
                         answer, computed by the same predicate the DELETE policy
                         enforces, so the button never appears on a topic the
                         server would refuse. Behind a second click, because the
                         topic is gone for good afterwards. -->
                    @if (t.can_delete) {
                      <div class="withdraw">
                        @if (confirmingWithdraw() === t.id) {
                          <span class="withdraw-ask">
                            {{ 'userFeedback.withdraw.question' | translate }}
                          </span>
                          <button
                            type="button"
                            class="sc-btn micro danger"
                            [disabled]="feedback.busy()"
                            (click)="confirmWithdraw(t.id)">
                            {{ 'userFeedback.withdraw.confirm' | translate }}
                          </button>
                          <button type="button" class="sc-btn micro" (click)="cancelWithdraw()">
                            {{ 'userFeedback.withdraw.cancel' | translate }}
                          </button>
                        } @else {
                          <button
                            type="button"
                            class="sc-btn micro danger"
                            [disabled]="feedback.busy()"
                            (click)="askWithdraw(t.id)">
                            {{ 'userFeedback.withdraw.action' | translate }}
                          </button>
                          <span class="withdraw-hint">
                            {{ 'userFeedback.withdraw.hint' | translate }}
                          </span>
                        }
                      </div>
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
    /* Level 2 of the density scale (styles.scss): the sheet/panel shell around
       this is level 1, so a flat 14px here was a frame inside a frame on a
       phone (admin feedback 3bc01a3d). “sc-dense” on the same element lets the
       composer inside it drop its own side frame down there. */
    .panel-root {
      display: flex;
      flex-direction: column;
      gap: var(--sc-gap-2);
      flex: 1 1 auto;
      min-height: 0;
      padding: var(--sc-pad-2);
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
    .compose-pane, .mine-pane { display: flex; flex-direction: column; gap: var(--sc-gap-2); }

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

    .topic { padding: var(--sc-pad-2); display: flex; flex-direction: column; gap: var(--sc-gap-3); }
    .topic.has-news { border-color: var(--sc-accent); }
    /* Ordered after .has-news on purpose: an open question to the author is the
       stronger of the two states and keeps its own border when both apply. */
    .topic.needs-answer { border-color: var(--sc-accent-hot); }
    .topic-head {
      display: flex;
      align-items: flex-start;
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
    .chev { flex: 0 0 auto; margin-top: 1px; color: var(--sc-fg-2); transition: transform 0.16s ease; }
    .chev.open { transform: rotate(90deg); }
    .th-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .th-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; }
    .topic-title {
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
    /* Context, not state — dashed and grey so the status pill next to it stays
       the thing the eye lands on. */
    .status-pill.area { border-style: dashed; }
    .status-pill.question { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }
    /* Same accent as the FAB badge the user just clicked — the pill is the
       other half of that signal, not a status of its own. */
    .status-pill.new {
      border-color: var(--sc-accent);
      background: var(--sc-accent);
      color: #041016;
      font-weight: 700;
    }
    .status-pill.done { border-color: var(--sc-accent); color: var(--sc-accent); }
    .status-pill.declined { opacity: 0.75; }

    .topic-detail { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
    .view-link { align-self: flex-start; display: inline-flex; align-items: center; min-height: 40px; padding: 0 12px; border: 1px solid var(--sc-accent); border-radius: 6px; color: var(--sc-accent); font-size: max(0.8rem, var(--sc-fs-floor)); font-weight: 600; text-decoration: none; }
    .view-link:hover { background: rgba(0, 212, 255, 0.08); }

    /* Withdraw row (admin feedback 892013b6). Sits last in the card and stays
       quiet: one destructive button plus the sentence that says why it is only
       here sometimes. --sc-danger, because it is a real deletion. */
    .withdraw {
      display: flex;
      align-items: center;
      gap: var(--sc-gap-3);
      flex-wrap: wrap;
      margin-top: 2px;
      padding-top: var(--sc-gap-3);
      border-top: 1px solid var(--sc-border);
    }
    .withdraw-hint, .withdraw-ask {
      font-size: max(0.74rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      line-height: 1.4;
    }
    .withdraw-ask { color: var(--sc-fg-1); }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }
    /* Scrollport for a marked-up runaway token (.sc-longword, styles.scss): a
       9.800-character run overflows THIS box and nothing else, so the card, the
       panel and the 375px page around it keep their width (admin feedback
       0a0fad31). */
    .body, .reply-body {
      font-size: 0.84rem;
      line-height: 1.5;
      color: var(--sc-fg-1);
      overflow-wrap: anywhere;
      overflow-x: auto;
    }
    /* Screenshots are not part of the body flow — see sc-feedback-attachments. */

    .decision {
      padding: var(--sc-pad-3);
      border-left: 3px solid var(--sc-border);
      background: var(--sc-bg-1);
      border-radius: 4px;
      font-size: 0.82rem;
    }
    /* Plain interpolation, not markdown, so there is no .sc-longword marker to
       lean on — the box takes the horizontal overflow itself. */
    .decision p {
      margin: 4px 0 0;
      color: var(--sc-fg-1);
      overflow-x: auto;
    }

    .thread { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
    .reply {
      padding: var(--sc-pad-3);
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

  /**
   * Topics that open expanded: a pending question (the actionable one) and
   * anything the FAB badge was counting — the user came here to read that, so
   * making them click it open again would be theatre.
   */
  private readonly autoExpanded = computed(() => {
    const ids = new Set(this.feedback.newsSinceOpen());
    for (const t of this.topics()) if (t.author_status === 'question') ids.add(t.id);
    return ids;
  });

  /** True once the user has chosen a tab by hand. */
  private readonly tabPinned = signal(false);

  constructor() {
    // The badge sent the user here to read something, so land them on the list
    // rather than on the compose box — but only until they say otherwise: one
    // click on a tab and this stops second-guessing them for the rest of the
    // session. The effect (rather than ngOnInit) is what makes it survive the
    // race with the FAB's own load, which is what fills newsSinceOpen.
    effect(() => {
      if (this.tabPinned()) return;
      if (this.feedback.newsSinceOpen().size > 0) this.tab.set('mine');
    });
  }

  async ngOnInit(): Promise<void> {
    // The FAB already loads the topics up front (it needs the badge count), so
    // only a cold open actually fetches here.
    if (!this.feedback.loaded()) await this.feedback.refresh();
  }

  selectCompose(): void {
    this.tabPinned.set(true);
    this.tab.set('compose');
  }

  selectMine(): void {
    this.tabPinned.set(true);
    this.tab.set('mine');
    void this.feedback.refresh();
  }

  /** Did this topic change since the user last had the panel open? */
  isNew(id: string): boolean {
    return this.feedback.hasNewsSinceOpen(id);
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

  /** The area tag to render for a topic — null (i.e. nothing) when untagged. */
  areaOf(t: AuthorFeedbackRow): FeedbackArea | null {
    return asFeedbackArea(t.area);
  }

  areaLabelKey(area: FeedbackArea): string {
    return feedbackAreaLabelKey(area);
  }

  /** Where "Im App ansehen" lands for a delivered topic, or null when untagged. */
  areaLinkFor(t: AuthorFeedbackRow): string | null {
    return areaRoute(asFeedbackArea(t.area));
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

  /**
   * The topic whose withdraw button is currently asking "sure?" (admin feedback
   * 892013b6) — at most one at a time, and never persisted: a confirm state that
   * survived a reload would be a trap.
   */
  private readonly _confirmingWithdraw = signal<string | null>(null);
  readonly confirmingWithdraw = this._confirmingWithdraw.asReadonly();

  askWithdraw(id: string): void {
    this._confirmingWithdraw.set(id);
  }

  cancelWithdraw(): void {
    this._confirmingWithdraw.set(null);
  }

  /**
   * Second click: actually withdraw. The confirm state is dropped either way —
   * on success the card is gone, and on a refusal (the routine claimed the topic
   * between the two clicks) the error banner is the answer, not a button still
   * offering to try again.
   */
  async confirmWithdraw(id: string): Promise<void> {
    this._confirmingWithdraw.set(null);
    await this.feedback.withdraw(id);
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
