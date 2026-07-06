import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { renderMarkdown } from './markdown.util';

type FeedbackStatus = 'open' | 'in_progress' | 'shipped' | 'rejected';

interface FeedbackAuthor {
  display_name: string | null;
  username: string | null;
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

const DRAFT_KEY = 'sc.adminFeedback.draft';
const STATUSES: FeedbackStatus[] = ['open', 'in_progress', 'shipped', 'rejected'];

@Component({
  selector: 'sc-admin-feedback',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'adminFeedback.title' | translate }}</h1>
          <p class="hint">{{ 'adminFeedback.subtitle' | translate }}</p>
        </div>
        <button class="sc-btn" (click)="refresh()" [disabled]="busy()">
          {{ 'adminFeedback.refresh' | translate }}
        </button>
      </header>

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'adminFeedback.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      <div class="board">
        @if (busy() && messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.loading' | translate }}</div>
        } @else if (messages().length === 0) {
          <div class="sc-card empty">{{ 'adminFeedback.empty' | translate }}</div>
        } @else {
          @for (m of messages(); track m.id) {
            <article class="msg sc-card" [class.is-self]="m.author_id === selfId()">
              <div class="msg-head">
                <span class="author">{{ authorLabel(m) }}</span>
                <span class="ts">{{ m.created_at | date:'short' }}</span>
                <span class="status-pill" [class]="m.status">{{ ('adminFeedback.status.' + m.status) | translate }}</span>
              </div>

              <div class="msg-body" [innerHTML]="render(m.body)"></div>

              @if (m.ship_ref) {
                <a class="ship-ref" [href]="m.ship_ref" target="_blank" rel="noopener noreferrer">
                  {{ 'adminFeedback.shipRef' | translate }} ↗
                </a>
              }
              @if (m.processing_note) {
                <p class="proc-note">{{ m.processing_note }}</p>
              }

              <div class="msg-actions">
                <label class="status-set">
                  <span class="sr-only">{{ 'adminFeedback.setStatus' | translate }}</span>
                  <select [value]="m.status"
                          (change)="setStatus(m, asStatus($event))"
                          [disabled]="busy()"
                          [attr.aria-label]="'adminFeedback.setStatus' | translate">
                    @for (s of statuses; track s) {
                      <option [value]="s">{{ ('adminFeedback.status.' + s) | translate }}</option>
                    }
                  </select>
                </label>
                @if (m.author_id === selfId()) {
                  <button class="sc-btn micro danger" (click)="remove(m)" [disabled]="busy()">
                    {{ 'adminFeedback.delete' | translate }}
                  </button>
                }
              </div>
            </article>
          }
        }
      </div>

      <!-- Composer -->
      <div class="composer sc-card">
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
                  [placeholder]="'adminFeedback.compose.placeholder' | translate"
                  [attr.aria-label]="'adminFeedback.title' | translate"
                  rows="4"></textarea>

        <div class="composer-foot">
          <span class="hint">{{ 'adminFeedback.compose.sendHint' | translate }}</span>
          <button class="sc-btn sc-btn-primary"
                  (click)="send()"
                  [disabled]="busy() || draft().trim().length === 0">
            {{ 'adminFeedback.compose.send' | translate }}
          </button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
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

    .msg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .status-set select {
      padding: 4px 8px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.76rem;
    }
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

  readonly statuses = STATUSES;
  readonly messages = signal<FeedbackRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly draft = signal('');
  readonly draftRestored = signal(false);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);

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

  asStatus(e: Event): FeedbackStatus {
    return (e.target as HTMLSelectElement).value as FeedbackStatus;
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
      this.messages.set((data ?? []) as unknown as FeedbackRow[]);
    }
    this.busy.set(false);
  }

  async send() {
    const body = this.draft().trim();
    const uid = this.selfId();
    if (!body || !uid) return;
    this.busy.set(true);
    this.errorMsg.set(null);
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
    await this.refresh();
  }

  async setStatus(m: FeedbackRow, status: FeedbackStatus) {
    if (status === m.status) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const patch: Record<string, unknown> = { status };
    if (status === 'shipped') patch['shipped_at'] = new Date().toISOString();
    const { error } = await this.sb.client
      .from('admin_feedback')
      .update(patch)
      .eq('id', m.id);
    if (error) this.errorMsg.set(error.message);
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
