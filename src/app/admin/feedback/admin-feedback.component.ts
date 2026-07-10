import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { useAutoRefresh } from '../../core/auto-refresh';
import { AuthService } from '../../auth/auth.service';
import { renderMarkdown } from './markdown.util';

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

/** An image queued in the composer, held as a compressed data URI until send. */
interface PendingImage {
  id: string;
  name: string;
  dataUrl: string;
}

const DRAFT_KEY = 'sc.adminFeedback.draft';

/** Longest-edge cap (px) applied when re-encoding pasted/dropped images. */
const IMG_MAX_DIM = 1600;
/** JPEG quality for the re-encoded attachment. */
const IMG_QUALITY = 0.85;
/** Safety cap on how many images ride along on a single message. */
const MAX_ATTACHMENTS = 10;

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, TranslateModule],
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
            <div class="msg-body" [innerHTML]="render(m.body)"></div>

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
                    <div class="reply-body" [innerHTML]="render(msg.body)"></div>
                  </div>
                }
              </div>
            }

            <!-- Reply composer — answer the routine / continue the topic. -->
            <div class="reply-compose">
              <textarea
                class="reply-input"
                rows="2"
                [value]="replyDraft(m.id)"
                (input)="onReplyInput(m.id, $any($event.target).value)"
                [placeholder]="'adminFeedback.thread.replyPlaceholder' | translate"
                [attr.aria-label]="'adminFeedback.thread.replyPlaceholder' | translate"></textarea>
              <button
                class="sc-btn micro"
                (click)="sendReply(m.id)"
                [disabled]="busy() || replyDraft(m.id).trim().length === 0">
                {{ 'adminFeedback.thread.reply' | translate }}
              </button>
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

      <!-- Composer -->
      <div
        class="composer sc-card"
        [class.drag-active]="dragActive()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)">
        @if (dragActive()) {
          <div class="drop-hint">{{ 'adminFeedback.compose.dropHere' | translate }}</div>
        }
        <div class="toolbar">
          <button type="button" class="tool" (click)="wrapSelection('**', '**')" [title]="'adminFeedback.compose.bold' | translate">
            <strong>B</strong>
          </button>
          <button type="button" class="tool" (click)="prefixLines('- ')" [title]="'adminFeedback.compose.bullet' | translate">
            • {{ 'adminFeedback.compose.list' | translate }}
          </button>
          <button type="button" class="tool" (click)="prefixLines('1. ')" [title]="'adminFeedback.compose.numbered' | translate">
            1. {{ 'adminFeedback.compose.list' | translate }}
          </button>
          <button type="button" class="tool" (click)="wrapSelection('\`', '\`')" [title]="'adminFeedback.compose.code' | translate">
            &lt;/&gt;
          </button>
          <button type="button" class="tool" (click)="fileInput.click()" [title]="'adminFeedback.compose.attach' | translate">
            🖼
          </button>
          <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFileInput($event)" />
          <span class="grow"></span>
          @if (draftRestored()) {
            <span class="draft-flag">{{ 'adminFeedback.compose.draftRestored' | translate }}</span>
          }
        </div>

        <textarea #ta
                  class="compose-input"
                  [value]="draft()"
                  (input)="onInput($event)"
                  (keydown)="onKeydown($event)"
                  (paste)="onPaste($event)"
                  [placeholder]="'adminFeedback.compose.placeholder' | translate"
                  [attr.aria-label]="'adminFeedback.title' | translate"
                  rows="4"></textarea>

        @if (attachments().length > 0) {
          <div class="attachments" [attr.aria-label]="'adminFeedback.compose.attachmentsLabel' | translate">
            @for (a of attachments(); track a.id) {
              <figure class="thumb">
                <img [src]="a.dataUrl" [alt]="a.name" />
                <button
                  type="button"
                  class="thumb-remove"
                  (click)="removeAttachment(a.id)"
                  [attr.aria-label]="'adminFeedback.compose.removeImage' | translate">
                  ✕
                </button>
              </figure>
            }
          </div>
        }

        <div class="composer-foot">
          <span class="hint">{{ 'adminFeedback.compose.attachHint' | translate }}</span>
          <button class="sc-btn sc-btn-primary"
                  (click)="send()"
                  [disabled]="busy() || (draft().trim().length === 0 && attachments().length === 0)">
            {{ 'adminFeedback.compose.send' | translate }}
          </button>
        </div>
      </div>
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
    .page.embedded .composer { position: static; flex: 0 0 auto; }

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

    .reply-compose { display: flex; gap: 8px; align-items: flex-end; margin-top: 2px; }
    .reply-input {
      flex: 1; box-sizing: border-box; resize: vertical; min-height: 38px;
      padding: 8px 10px; background: var(--sc-bg-1); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 6px; font: inherit; font-size: 0.86rem; line-height: 1.4;
    }
    .reply-input:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.22); }

    .msg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sc-btn.micro { padding: 4px 10px; font-size: 0.7rem; letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

    .composer {
      position: sticky;
      bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
    }
    /* Drag-to-upload affordance: highlight the composer and overlay a hint. */
    .composer.drag-active {
      position: relative;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.28);
    }
    .drop-hint {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      background: rgba(0, 212, 255, 0.1);
      border-radius: 4px;
      color: var(--sc-accent);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
    }

    /* Pending-image thumbnails shown between the textarea and the send row. */
    .attachments { display: flex; flex-wrap: wrap; gap: 8px; }
    .thumb {
      position: relative;
      margin: 0;
      width: 68px;
      height: 68px;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--sc-bg-1);
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 0.62rem;
      line-height: 1;
      cursor: pointer;
    }
    .thumb-remove:hover { background: var(--sc-danger); }
    .thumb-remove:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.5);
    }
    .toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tool {
      padding: 4px 9px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-1);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .tool:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .grow { flex: 1; }
    .draft-flag { font-size: 0.72rem; color: var(--sc-fg-2); }

    .compose-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 92px;
      resize: vertical;
      padding: 10px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .compose-input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .composer-foot .hint { margin: 0; font-size: 0.76rem; }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    @media (max-width: 640px) {
      .composer { position: static; }
      .composer-foot { flex-direction: column; align-items: stretch; }
      .composer-foot .sc-btn { width: 100%; }
      .status-pill { margin-left: 0; }
    }
  `],
})
export class AdminFeedbackComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  private readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  /** When embedded in the feedback FAB panel, the page chrome (title, subtitle,
   *  manual refresh) is dropped — the panel supplies its own header. */
  readonly embedded = input(false);

  readonly messages = signal<FeedbackRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly draft = signal('');
  readonly draftRestored = signal(false);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);

  /** Replies per topic, keyed by feedback id (oldest first). */
  readonly threads = signal<Map<string, FeedbackMessage[]>>(new Map());
  /** Per-topic reply composer drafts, keyed by feedback id. */
  private readonly replyDrafts = signal<Map<string, string>>(new Map());

  messagesFor(feedbackId: string): FeedbackMessage[] {
    return this.threads().get(feedbackId) ?? [];
  }
  replyDraft(feedbackId: string): string {
    return this.replyDrafts().get(feedbackId) ?? '';
  }

  /** Images queued for the next message (compressed data URIs). */
  readonly attachments = signal<PendingImage[]>([]);
  /** True while a file is dragged over the composer (drop affordance). */
  readonly dragActive = signal(false);

  /** Shipped items are collapsed into a stack so the open ones stay directly
   *  visible; expanding reveals the resolved history (newest first, paged). */
  readonly showShipped = signal(false);
  readonly activeMessages = computed(() => this.messages().filter((m) => m.status !== 'shipped'));

  /** Page size for the shipped history — "load more" reveals another batch. */
  private static readonly SHIPPED_PAGE = 10;
  readonly shippedVisible = signal(AdminFeedbackComponent.SHIPPED_PAGE);

  /** All shipped items, newest ship first (by shipped_at, falling back to created_at). */
  readonly shippedMessages = computed(() =>
    this.messages()
      .filter((m) => m.status === 'shipped')
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

  /** Plain-text, truncated preview of a markdown body for the collapsed row. */
  preview(body: string): string {
    const text = body
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
  }

  async ngOnInit() {
    this.restoreDraft();
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

  // ---- Draft persistence (localStorage) ----------------------------------

  private restoreDraft(): void {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved && saved.trim()) {
        this.draft.set(saved);
        this.draftRestored.set(true);
      }
    } catch {
      /* localStorage unavailable (private mode) — ignore */
    }
  }

  private saveDraft(value: string): void {
    try {
      if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  onInput(e: Event): void {
    const value = (e.target as HTMLTextAreaElement).value;
    this.draft.set(value);
    this.draftRestored.set(false);
    this.saveDraft(value);
  }

  // ---- Composer keyboard behaviour ---------------------------------------

  onKeydown(e: KeyboardEvent): void {
    // Ctrl/Cmd+Enter → send.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void this.send();
      return;
    }
    // Plain Enter → continue an active list; otherwise default newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      this.handleListContinuation(e);
    }
  }

  /**
   * When Enter is pressed inside a bullet/numbered line, insert the next
   * marker automatically. An empty marker line exits the list instead.
   */
  private handleListContinuation(e: KeyboardEvent): void {
    const el = this.ta()?.nativeElement;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) return; // selection active — let default happen

    const value = el.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.slice(lineStart, start);

    const ul = /^(\s*)([-*+])\s+(.*)$/.exec(currentLine);
    const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(currentLine);
    if (!ul && !ol) return;

    e.preventDefault();
    const indent = (ul ?? ol)![1];
    const content = (ul ? ul[3] : ol![3]).trim();

    let insert: string;
    let replaceFrom = start;
    if (content === '') {
      // Empty marker → drop the marker and exit the list.
      replaceFrom = lineStart;
      insert = '\n';
    } else if (ul) {
      insert = `\n${indent}${ul[2]} `;
    } else {
      insert = `\n${indent}${Number(ol![2]) + 1}. `;
    }

    const next = value.slice(0, replaceFrom) + insert + value.slice(end);
    const caret = replaceFrom + insert.length;
    this.applyValue(el, next, caret);
  }

  // ---- Toolbar -----------------------------------------------------------

  wrapSelection(before: string, after: string): void {
    const el = this.ta()?.nativeElement;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e);
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    const caret = sel ? s + before.length + sel.length + after.length : s + before.length;
    this.applyValue(el, next, caret);
  }

  prefixLines(marker: string): void {
    const el = this.ta()?.nativeElement;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e);
    let n = 0;
    const prefixed = block
      .split('\n')
      .map((line) => (marker === '1. ' ? `${++n}. ${line}` : `${marker}${line}`))
      .join('\n');
    const next = value.slice(0, lineStart) + prefixed + value.slice(e);
    this.applyValue(el, next, lineStart + prefixed.length);
  }

  private applyValue(el: HTMLTextAreaElement, next: string, caret: number): void {
    el.value = next;
    el.setSelectionRange(caret, caret);
    this.draft.set(next);
    this.draftRestored.set(false);
    this.saveDraft(next);
    el.focus();
  }

  // ---- Image attachments -------------------------------------------------

  onFileInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    void this.addFiles(input.files);
    input.value = ''; // allow re-picking the same file
  }

  onPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      // Swallow the paste so the raw image blob text never lands in the textarea.
      e.preventDefault();
      void this.addFiles(files);
    }
  }

  onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    this.dragActive.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(e: DragEvent): void {
    const files = e.dataTransfer?.files;
    this.dragActive.set(false);
    if (files && files.length) {
      e.preventDefault();
      void this.addFiles(files);
    }
  }

  removeAttachment(id: string): void {
    this.attachments.update((list) => list.filter((a) => a.id !== id));
  }

  /** Accept image files from any source (picker, paste, drop), compressing each. */
  private async addFiles(files: FileList | File[] | null | undefined): Promise<void> {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    for (const file of images) {
      if (this.attachments().length >= MAX_ATTACHMENTS) {
        this.errorMsg.set(
          this.translate.instant('adminFeedback.compose.tooManyImages', { max: MAX_ATTACHMENTS }),
        );
        break;
      }
      try {
        const att = await this.processImage(file);
        this.attachments.update((list) => [...list, att]);
      } catch {
        this.errorMsg.set(this.translate.instant('adminFeedback.compose.imageError'));
      }
    }
  }

  /**
   * Re-encode an image to a size-bounded JPEG data URI. GIFs are passed through
   * untouched so animation survives. A white matte replaces transparency so the
   * JPEG never shows black where the source was transparent.
   */
  private processImage(file: File): Promise<PendingImage> {
    const name = this.safeName(file.name);
    if (file.type === 'image/gif') {
      return this.readAsDataUrl(file).then((dataUrl) => ({ id: crypto.randomUUID(), name, dataUrl }));
    }
    return new Promise<PendingImage>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 2d context unavailable'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ id: crypto.randomUUID(), name, dataUrl: canvas.toDataURL('image/jpeg', IMG_QUALITY) });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('image failed to load'));
      };
      img.src = objectUrl;
    });
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  /** Strip markdown-significant chars from a filename used as image alt text. */
  private safeName(name: string): string {
    return (name || '').replace(/[\[\]()*_`~\n\r]/g, ' ').trim() || 'image';
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

  onReplyInput(feedbackId: string, value: string): void {
    this.replyDrafts.update((m) => new Map(m).set(feedbackId, value));
  }

  /** Post a human reply into a topic's thread, then reload it. */
  async sendReply(feedbackId: string): Promise<void> {
    const text = this.replyDraft(feedbackId).trim();
    const uid = this.selfId();
    if (!text || !uid) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client
      .from('admin_feedback_messages')
      .insert({ feedback_id: feedbackId, author_id: uid, is_system: false, body: text });
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    this.replyDrafts.update((m) => {
      const next = new Map(m);
      next.delete(feedbackId);
      return next;
    });
    await this.refresh();
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

  async send() {
    const text = this.draft().trim();
    const atts = this.attachments();
    const uid = this.selfId();
    if ((!text && atts.length === 0) || !uid) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    // Images ride along as markdown image syntax appended below the text.
    const imgMd = atts.map((a) => `![${a.name}](${a.dataUrl})`).join('\n\n');
    const body = [text, imgMd].filter((s) => s.length > 0).join('\n\n');
    const { error } = await this.sb.client
      .from('admin_feedback')
      .insert({ body, author_id: uid });
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
      return;
    }
    this.draft.set('');
    this.draftRestored.set(false);
    this.saveDraft('');
    this.attachments.set([]);
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
