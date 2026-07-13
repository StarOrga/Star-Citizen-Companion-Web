import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { useAutoRefresh } from '../../core/auto-refresh';
import { AuthService } from '../../auth/auth.service';
import { renderMarkdown } from './markdown.util';
import { ComposerPayload, FeedbackComposerComponent, PendingImage } from './feedback-composer.component';

type FeedbackStatus = 'open' | 'in_progress' | 'shipped' | 'rejected' | 'needs_input';

interface FeedbackAuthor {
  display_name: string | null;
  username: string | null;
}

/** One reply in a topic's thread (human admin or the automated routine). */
interface FeedbackMessage {
  id: string;
  feedback_id: string;
  author_id: string | null;
  is_system: boolean;
  body: string;
  created_at: string;
  author: FeedbackAuthor | null;
}

interface FeedbackRow {
  id: string;
  author_id: string | null;
  body: string;
  status: FeedbackStatus;
  ship_ref: string | null;
  processing_note: string | null;
  created_at: string;
  updated_at: string;
  shipped_at: string | null;
  processed_at: string | null;
  author: FeedbackAuthor | null;
}

/** localStorage key backing the new-topic composer draft. */
const DRAFT_KEY = 'sc.adminFeedback.draft';

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, TranslateModule, FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page" [class.embedded]="embedded()">
      @if (!embedded()) {
        <header class="head">
          <div>
            <h1>{{ 'adminFeedback.title' | translate }}</h1>
            <p class="hint">{{ 'adminFeedback.subtitle' | translate }}</p>
          </div>
        </header>
      }

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'adminFeedback.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      <div class="board">
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
                {{ a.label }} <span class="chip-count">{{ a.count }}</span>
              </button>
            }
          </div>
        }

        @if (busy() && messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.loading' | translate }}</div>
        } @else if (messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.empty' | translate }}</div>
        } @else {
          @for (m of activeMessages(); track m.id) {
            <ng-container [ngTemplateOutlet]="msgCard" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
          }

          <!-- Shipped items are stacked away so open ones stay directly visible. -->
          @if (shippedMessages().length > 0) {
            <div class="shipped-stack">
              <button
                type="button"
                class="shipped-toggle"
                (click)="toggleShipped()"
                [attr.aria-expanded]="showShipped()">
                <span class="chev" [class.open]="showShipped()">▸</span>
                {{ 'adminFeedback.shippedGroup' | translate: { count: shippedMessages().length } }}
              </button>
              @if (showShipped()) {
                <div class="shipped-list">
                  @for (m of shippedVisibleMessages(); track m.id) {
                    <ng-container [ngTemplateOutlet]="msgCard" [ngTemplateOutletContext]="{ $implicit: m }"></ng-container>
                  }
                  @if (shippedRemaining() > 0) {
                    <button type="button" class="load-more" (click)="loadMoreShipped()">
                      {{ 'adminFeedback.loadMore' | translate: { count: shippedRemaining() } }}
                    </button>
                  }
                </div>
              }
            </div>
          }
        }
      </div>

      <ng-template #msgCard let-m>
        <article class="msg sc-card" [class.is-self]="m.author_id === selfId()">
          <div class="msg-head">
            <span class="author">{{ authorLabel(m) }}</span>
            <span class="ts">{{ m.created_at | date:'short' }}</span>
            <span class="status-pill" [class]="m.status">{{ ('adminFeedback.status.' + m.status) | translate }}</span>
            @if (embedded()) {
              <button
                type="button"
                class="expand-toggle"
                (click)="toggleExpand(m.id)"
                [attr.aria-expanded]="isExpanded(m.id)"
                [attr.aria-label]="'adminFeedback.toggleDetails' | translate">
                {{ isExpanded(m.id) ? '▾' : '▸' }}
              </button>
            }
          </div>

          @if (!embedded() || isExpanded(m.id)) {
            <!-- Long bodies are clamped to their first two sentences on the full
                 board (feedback 73dfa165) so the list stays scannable; expand to
                 read the rest. In the compact FAB panel the whole card already
                 collapses, so the body is shown in full when opened there. -->
            @if (!embedded()) {
              @let bp = bodyPreview(m.body);
              @if (bp.truncated && !isBodyExpanded(m.id)) {
                <div class="msg-body clamped">{{ bp.text }}<button type="button" class="body-toggle" (click)="toggleBody(m.id)">… {{ 'adminFeedback.showMore' | translate }}</button></div>
              } @else {
                <div class="msg-body" [innerHTML]="render(m.body)"></div>
                @if (bp.truncated) {
                  <button type="button" class="body-toggle" (click)="toggleBody(m.id)">{{ 'adminFeedback.showLess' | translate }}</button>
                }
              }
            } @else {
              <div class="msg-body" [innerHTML]="render(m.body)"></div>
            }

            @if (m.ship_ref) {
              <a class="ship-ref" [href]="m.ship_ref" target="_blank" rel="noopener noreferrer">
                {{ 'adminFeedback.shipRef' | translate }} ↗
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
                      <span class="reply-ts">{{ msg.created_at | date:'short' }}</span>
                    </div>
                    @if (!embedded()) {
                      @let rp = bodyPreview(msg.body);
                      @if (rp.truncated && !isBodyExpanded(msg.id)) {
                        <div class="reply-body clamped">{{ rp.text }}<button type="button" class="body-toggle" (click)="toggleBody(msg.id)">… {{ 'adminFeedback.showMore' | translate }}</button></div>
                      } @else {
                        <div class="reply-body" [innerHTML]="render(msg.body)"></div>
                        @if (rp.truncated) {
                          <button type="button" class="body-toggle" (click)="toggleBody(msg.id)">{{ 'adminFeedback.showLess' | translate }}</button>
                        }
                      }
                    } @else {
                      <div class="reply-body" [innerHTML]="render(msg.body)"></div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Reply composer — full parity with the new-topic box (toolbar,
                 Ctrl/Cmd+Enter, image paste/drop, list continuation). -->
            <div class="reply-compose">
              <sc-feedback-composer
                [compact]="true"
                [busy]="busy()"
                placeholder="adminFeedback.thread.replyPlaceholder"
                sendLabel="adminFeedback.thread.reply"
                [onSubmit]="replySubmitFor(m.id)" />
            </div>

            <!-- Any admin may delete any topic (board is admin-only) — clears a
                 topic once its handling/rejection is accepted. -->
            <div class="msg-actions">
              <button class="sc-btn micro danger" (click)="remove(m)" [disabled]="busy()">
                {{ 'adminFeedback.delete' | translate }}
              </button>
            </div>
          } @else {
            <button type="button" class="msg-preview" (click)="toggleExpand(m.id)">{{ preview(m.body) }}</button>
          }
        </article>
      </ng-template>

      <!-- New-topic composer -->
      <sc-feedback-composer
        class="main-composer"
        [persistKey]="draftKey"
        [busy]="busy()"
        placeholder="adminFeedback.compose.placeholder"
        sendLabel="adminFeedback.compose.send"
        [onSubmit]="createTopicBound" />
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

    .expand-toggle {
      margin-left: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      background: transparent;
      color: var(--sc-fg-2);
      cursor: pointer;
      font-size: 0.72rem;
      transition: all 0.16s ease;
    }
    .expand-toggle:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .expand-toggle:focus-visible {
      outline: none;
      color: var(--sc-fg-0);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3);
    }
    .msg-preview {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0;
      margin: 0;
      background: transparent;
      border: 0;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: 0.88rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .msg-preview:hover { color: var(--sc-fg-0); }
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

    /* Quick-access author filter: chip row that scopes the board to one creator. */
    .author-filter { display: flex; flex-wrap: wrap; gap: 6px; }
    .author-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: 0.74rem;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .author-chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .author-chip.active {
      color: var(--sc-accent);
      border-color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.12);
    }
    .author-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }
    .chip-count { font-size: 0.68rem; opacity: 0.75; }

    /* Collapsed stack of shipped items — keeps the open ones front-and-centre. */
    .shipped-stack { display: flex; flex-direction: column; }
    .shipped-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: 0.74rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .shipped-toggle:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .shipped-toggle:focus-visible {
      outline: none;
      color: var(--sc-fg-0);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3);
    }
    .shipped-toggle .chev { display: inline-block; transition: transform 0.16s ease; }
    .shipped-toggle .chev.open { transform: rotate(90deg); }
    .shipped-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
    .shipped-list .msg { opacity: 0.72; }
    .load-more {
      align-self: center;
      margin-top: 4px;
      padding: 7px 16px;
      background: transparent;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font: inherit;
      font-size: 0.76rem;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .load-more:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .load-more:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.3); }

    .msg { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .msg.is-self { box-shadow: inset 2px 0 0 var(--sc-accent); }
    .msg-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .author { font-weight: 600; font-size: 0.9rem; }
    .ts { color: var(--sc-fg-2); font-size: 0.76rem; }

    .status-pill {
      margin-left: auto;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.open { background: rgba(0, 212, 255, 0.16); color: var(--sc-accent); }
      &.in_progress { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
      &.shipped { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.rejected { background: rgba(122, 134, 156, 0.2); color: var(--sc-fg-2); }
      &.needs_input { background: rgba(167, 139, 250, 0.2); color: #a78bfa; }
    }

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
    .msg-body img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 6px 0;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
    }
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

    .ship-ref { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; }
    .ship-ref:hover { text-decoration: underline; }
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
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 1px 6px; border-radius: 999px;
      background: color-mix(in srgb, #a78bfa 25%, transparent); color: #a78bfa;
    }
    .reply-ts { margin-left: auto; color: var(--sc-fg-2); font-size: 0.72rem; }
    .reply-body { font-size: 0.88rem; line-height: 1.45; overflow-wrap: anywhere; }
    .reply-body :first-child { margin-top: 0; }
    .reply-body :last-child { margin-bottom: 0; }
    .reply-body p { margin: 0 0 6px; }
    .reply-body a { color: var(--sc-accent); }
    .reply-body code { font-family: monospace; font-size: 0.85em; background: var(--sc-bg-1); padding: 1px 5px; border-radius: 3px; }
    .reply-body img { display: block; max-width: 100%; height: auto; margin: 6px 0; border: 1px solid var(--sc-border); border-radius: 6px; }

    .reply-compose { margin-top: 4px; }

    .msg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sc-btn.micro { padding: 4px 10px; font-size: 0.7rem; letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

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

  /** When embedded in the feedback FAB panel, the page chrome (title, subtitle,
   *  manual refresh) is dropped — the panel supplies its own header. */
  readonly embedded = input(false);

  readonly messages = signal<FeedbackRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);

  /** localStorage key handed to the new-topic composer for draft persistence. */
  readonly draftKey = DRAFT_KEY;

  /** Replies per topic, keyed by feedback id (oldest first). */
  readonly threads = signal<Map<string, FeedbackMessage[]>>(new Map());

  messagesFor(feedbackId: string): FeedbackMessage[] {
    return this.threads().get(feedbackId) ?? [];
  }

  /** Shipped items are collapsed into a stack so the open ones stay directly
   *  visible; expanding reveals the resolved history (newest first, paged). */
  readonly showShipped = signal(false);

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

  /** Active (non-shipped) topics, author-filtered, newest activity first. */
  readonly activeMessages = computed(() =>
    this.messages()
      .filter((m) => m.status !== 'shipped' && this.matchesAuthor(m))
      .sort((a, b) => this.recencyTime(b) - this.recencyTime(a)),
  );

  /** Page size for the shipped history — "load more" reveals another batch. */
  private static readonly SHIPPED_PAGE = 10;
  readonly shippedVisible = signal(AdminFeedbackComponent.SHIPPED_PAGE);

  /** All shipped items (author-filtered), newest ship first (by shipped_at, falling back to created_at). */
  readonly shippedMessages = computed(() =>
    this.messages()
      .filter((m) => m.status === 'shipped' && this.matchesAuthor(m))
      .sort((a, b) => this.shippedTime(b) - this.shippedTime(a)),
  );
  /** The current shipped page (first N of the sorted history). */
  readonly shippedVisibleMessages = computed(() =>
    this.shippedMessages().slice(0, this.shippedVisible()),
  );
  /** How many shipped items are still hidden below the current page. */
  readonly shippedRemaining = computed(() =>
    Math.max(0, this.shippedMessages().length - this.shippedVisible()),
  );

  toggleShipped(): void {
    this.showShipped.update((v) => !v);
  }

  /** Reveal the next page of shipped history (+10). */
  loadMoreShipped(): void {
    this.shippedVisible.update((n) => n + AdminFeedbackComponent.SHIPPED_PAGE);
  }

  private shippedTime(m: FeedbackRow): number {
    const t = Date.parse(m.shipped_at ?? m.created_at);
    return Number.isFinite(t) ? t : 0;
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

  /**
   * In the embedded FAB panel, topics are collapsed by default — which hides the
   * reply composer. Auto-expand `needs_input` topics (the ones awaiting the
   * admin's answer) so the routine's question and the reply box are immediately
   * visible. Each topic is auto-expanded only once, so a manual collapse sticks.
   */
  private autoExpandNeedsInput(rows: FeedbackRow[]): void {
    if (!this.embedded()) return;
    const toExpand = rows.filter(
      (r) => r.status === 'needs_input' && !this._autoExpanded.has(r.id),
    );
    if (toExpand.length === 0) return;
    for (const r of toExpand) this._autoExpanded.add(r.id);
    this._expanded.update((set) => {
      const next = new Set(set);
      for (const r of toExpand) next.add(r.id);
      return next;
    });
  }

  /** Plain-text, truncated preview of a markdown body for the collapsed row. */
  preview(body: string): string {
    const text = body
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }

  /**
   * First-two-sentences preview of a markdown body plus whether anything was cut
   * — backs the collapse-by-default clamp on the full board. Images and markup
   * are stripped for the plain preview; their presence still marks the body as
   * truncatable so the reader can expand to the rich render.
   */
  bodyPreview(body: string): { text: string; truncated: boolean } {
    const raw = body ?? '';
    const hasImage = /!\[[^\]]*\]\([^)]*\)/.test(raw);
    const plain = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = plain ? plain.split(/(?<=[.!?])\s+/) : [];
    let text = parts.slice(0, 2).join(' ').trim();
    let truncated = hasImage || parts.length > 2 || text.length < plain.length;
    const CAP = 300;
    if (text.length > CAP) {
      text = text.slice(0, CAP).trimEnd();
      truncated = true;
    }
    return { text: text || plain, truncated };
  }

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
  }

  async ngOnInit() {
    await this.refresh();
  }

  render(body: string): string {
    return renderMarkdown(body);
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
      .select('id, author_id, body, status, ship_ref, processing_note, created_at, updated_at, shipped_at, processed_at, author:profiles(display_name, username)')
      .order('created_at', { ascending: true });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      const rows = (data ?? []) as unknown as FeedbackRow[];
      this.messages.set(rows);
      this.autoExpandNeedsInput(rows);
      await this.loadThreads(rows.map((r) => r.id));
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

  /** Storage bucket backing feedback screenshot attachments. */
  private static readonly IMAGES_BUCKET = 'feedback-images';

  /**
   * Upload the composer's queued images to Storage and return their public URLs
   * (in order). Images are uploaded rather than inlined as base64 because a
   * single compressed screenshot exceeds the message body's 20 000-char check
   * constraint. Throws on the first upload failure so the caller keeps the draft.
   */
  private async uploadImages(images: PendingImage[]): Promise<string[]> {
    const uid = this.selfId();
    if (!uid || images.length === 0) return [];
    const bucket = this.sb.client.storage.from(AdminFeedbackComponent.IMAGES_BUCKET);
    const urls: string[] = [];
    for (const img of images) {
      const blob = this.dataUrlToBlob(img.dataUrl);
      const path = `${uid}/${crypto.randomUUID()}.${this.extForType(blob.type)}`;
      const { error } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
      if (error) throw new Error(error.message);
      urls.push(bucket.getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  /** File extension for a known image MIME type (JPEG is the compressed default). */
  private extForType(mime: string): string {
    switch (mime) {
      case 'image/png': return 'png';
      case 'image/gif': return 'gif';
      case 'image/webp': return 'webp';
      default: return 'jpg';
    }
  }

  /** Decode a `data:<mime>;base64,<data>` URI into a Blob for upload. */
  private dataUrlToBlob(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(',');
    const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /** Compose the stored body: text with any uploaded images appended as markdown. */
  private buildBody(text: string, images: PendingImage[], urls: string[]): string {
    const imgMd = urls.map((url, i) => `![${images[i].name}](${url})`).join('\n\n');
    return [text, imgMd].filter((s) => s.length > 0).join('\n\n');
  }

  /** Stable handler reference for the new-topic composer. */
  readonly createTopicBound = (payload: ComposerPayload): Promise<boolean> =>
    this.createTopic(payload);

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
