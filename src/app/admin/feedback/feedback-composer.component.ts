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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ComposerPrefsService } from '../../core/composer-prefs.service';
import { ConsentService } from '../../core/consent.service';
import { FeedbackAttachmentsComponent } from './feedback-attachments.component';
import type { FeedbackImage } from './markdown.util';

/** An image queued in the composer, held as a compressed data URI until send. */
export interface PendingImage {
  id: string;
  name: string;
  dataUrl: string;
}

/** What a composer hands back on submit: the trimmed text plus queued images. */
export interface ComposerPayload {
  text: string;
  images: PendingImage[];
}

/** Longest-edge cap (px) applied when re-encoding pasted/dropped images. */
const IMG_MAX_DIM = 1600;
/** JPEG quality for the re-encoded attachment. */
const IMG_QUALITY = 0.85;
/** Safety cap on how many images ride along on a single message. */
const MAX_ATTACHMENTS = 10;

/**
 * Rich markdown composer shared by the new-topic box and every thread reply.
 *
 * Extracted so the reply line gains full parity with the main input (feedback
 * 73dfa165): formatting toolbar, automatic list continuation, and image insert
 * via picker / paste / drag-and-drop.
 *
 * Keyboard mapping (feedback aa8d5b18) is the conventional chat one, identical
 * in every usage — new topic, thread reply, processing answer — and each user
 * flips it for themselves under `Einstellungen → Eingabe`
 * (`ComposerPrefsService`):
 * - `Enter` sends, `Shift+Enter` inserts a newline (default), **or** the mirror
 *   image, where `Enter` inserts the newline and only `Ctrl/Cmd+Enter` sends
 * - `Ctrl/Cmd+Enter` always sends, in both mappings
 * - whichever key inserts the newline also continues a bullet/numbered list
 *
 * The parent supplies an `onSubmit` handler that returns `true` once the
 * message is persisted; the composer only clears itself on success, so a failed
 * insert keeps the draft and attachments intact. When a `persistKey` is set the
 * text draft additionally survives reloads via localStorage (opt-in to the
 * preferences consent category).
 */
@Component({
  selector: 'sc-feedback-composer',
  standalone: true,
  imports: [TranslateModule, FeedbackAttachmentsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="composer"
      [class.compact]="compact()"
      [class.drag-active]="dragActive()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)">
      @if (dragActive()) {
        <div class="drop-hint">{{ 'adminFeedback.compose.dropHere' | translate }}</div>
      }

      @if (errorMsg()) {
        <div class="c-err">{{ errorMsg() }}</div>
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
                class="input"
                [value]="draft()"
                (input)="onInput($event)"
                (keydown)="onKeydown($event)"
                (paste)="onPaste($event)"
                [placeholder]="placeholder() | translate"
                [attr.aria-label]="placeholder() | translate"
                [rows]="compact() ? 2 : 4"></textarea>

      <!-- Pending images use the very same chip row the thread renders
           (feedback 99723afc): one 72px thumbnail size, click to enlarge,
           from paste through to every later re-read of the message. -->
      <sc-feedback-attachments
        [images]="pendingImages()"
        [removable]="true"
        labelKey="adminFeedback.compose.attachmentsLabel"
        (remove)="removeAt($event)" />

      <div class="foot">
        <span class="hint">
          {{ sendHintKey() | translate }}
          · {{ 'adminFeedback.compose.attachHint' | translate }}
        </span>
        <button
          class="sc-btn"
          [class.sc-btn-primary]="!compact()"
          [class.micro]="compact()"
          (click)="submit()"
          [disabled]="!canSend()">
          {{ sendLabel() | translate }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 10px;
    }
    .composer.compact { padding: 10px 12px; gap: 6px; }
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
      border-radius: 8px;
      color: var(--sc-accent);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .c-err {
      padding: 6px 10px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 6px;
      font-size: 0.78rem;
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

    .input {
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
    .composer.compact .input { min-height: 44px; font-size: 0.86rem; }
    .input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }

    /* Pending-image thumbnails sit between the textarea and the send row and
       are rendered by sc-feedback-attachments — the same chip the thread uses,
       so the composer carries no size of its own. */

    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .foot .hint { margin: 0; font-size: 0.76rem; color: var(--sc-fg-2); }
    .composer.compact .foot .hint { display: none; }
    .sc-btn.micro { padding: 4px 10px; font-size: 0.7rem; letter-spacing: 0.04em; }

    @media (max-width: 640px) {
      .foot { flex-direction: column; align-items: stretch; }
      .foot .sc-btn { width: 100%; }
    }
  `],
})
export class FeedbackComposerComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly consentSvc = inject(ConsentService);
  private readonly composerPrefs = inject(ComposerPrefsService);
  private readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  /** i18n key for the textarea placeholder / aria-label. */
  readonly placeholder = input('');
  /** i18n key for the send button label. */
  readonly sendLabel = input('');
  /** Parent-driven busy flag (a refresh / other write in flight). */
  readonly busy = input(false);
  /** Reply variant: smaller textarea and a micro send button. */
  readonly compact = input(false);
  /** localStorage key for draft persistence — null disables it (reply composers). */
  readonly persistKey = input<string | null>(null);
  /**
   * Handler the parent supplies. Returns `true` once the message is persisted,
   * so the composer clears itself; `false`/throw keeps the draft on failure.
   */
  readonly onSubmit = input<(payload: ComposerPayload) => Promise<boolean>>();

  readonly draft = signal('');
  readonly draftRestored = signal(false);
  readonly attachments = signal<PendingImage[]>([]);
  /**
   * Queued images in the shape the shared attachment row renders: the pending
   * data URI as source, the file name as alt (so the enlarge label names it).
   */
  readonly pendingImages = computed<FeedbackImage[]>(() =>
    this.attachments().map((a) => ({ src: a.dataUrl, alt: a.name })),
  );
  readonly dragActive = signal(false);
  readonly sending = signal(false);
  readonly errorMsg = signal<string | null>(null);

  /** Hint under the field — must name the mapping the user actually has. */
  readonly sendHintKey = computed(() =>
    this.composerPrefs.sendOnEnter()
      ? 'adminFeedback.compose.sendHint'
      : 'adminFeedback.compose.sendHintCtrl',
  );

  readonly canSend = computed(
    () =>
      !this.busy() &&
      !this.sending() &&
      (this.draft().trim().length > 0 || this.attachments().length > 0),
  );

  ngOnInit(): void {
    this.restoreDraft();
  }

  // ---- Submit ------------------------------------------------------------

  async submit(): Promise<void> {
    if (!this.canSend()) return;
    const payload: ComposerPayload = { text: this.draft().trim(), images: this.attachments() };
    const handler = this.onSubmit();
    if (!handler) return;
    this.sending.set(true);
    this.errorMsg.set(null);
    try {
      const ok = await handler(payload);
      if (ok) {
        this.draft.set('');
        this.draftRestored.set(false);
        this.saveDraft('');
        this.attachments.set([]);
      }
    } finally {
      this.sending.set(false);
    }
  }

  // ---- Draft persistence (localStorage) ----------------------------------

  private restoreDraft(): void {
    const key = this.persistKey();
    if (!key) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved && saved.trim()) {
        this.draft.set(saved);
        this.draftRestored.set(true);
      }
    } catch {
      /* localStorage unavailable (private mode) — ignore */
    }
  }

  private saveDraft(value: string): void {
    const key = this.persistKey();
    if (!key) return;
    // Preference-category storage is opt-in (#130) — clearing stays allowed.
    if (value.trim() && !this.consentSvc.preferencesAllowed()) return;
    try {
      if (value.trim()) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
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

  // ---- Keyboard behaviour ------------------------------------------------

  /**
   * Chat mapping, per the user's own `sendOnEnter` setting.
   *
   * Feedback 73dfa165 had briefly moved sending to Ctrl/Cmd+Enter, which read as
   * "Enter is broken" to everyone typing in the board (feedback aa8d5b18) — so
   * Enter-sends is the default. It is now a per-user choice rather than a fixed
   * rule: with the setting off, Enter breaks the line and Ctrl/Cmd+Enter sends.
   * Ctrl/Cmd+Enter sends either way, and the newline key of the active mapping
   * is the one that continues a list.
   */
  onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return;
    // Mid-IME-composition Enter commits the candidate — never a send.
    if (e.isComposing) return;
    // Alt+Enter is not ours — leave it to the browser/OS.
    if (e.altKey) return;

    // Ctrl/Cmd+Enter sends in both mappings.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void this.submit();
      return;
    }

    // Every non-sending Enter breaks the line — Shift+Enter always, plain Enter
    // when the user mapped sending to Ctrl/Cmd+Enter — and continues a list.
    if (e.shiftKey || !this.composerPrefs.sendOnEnter()) {
      this.handleListContinuation(e);
      return;
    }

    e.preventDefault();
    void this.submit();
  }

  /**
   * When the newline key is pressed inside a bullet/numbered line, insert the
   * next marker automatically. An empty marker line exits the list instead.
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

  /** Drop the queued image behind a chip — the row reports position, not id. */
  removeAt(index: number): void {
    const att = this.attachments()[index];
    if (att) this.removeAttachment(att.id);
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
   *
   * Decoding goes through `createImageBitmap(file)` — which reads the File blob
   * directly — rather than an `<img>` fed a `URL.createObjectURL` object URL. The
   * object-URL path emits a `blob:` URL, and the hardened Content-Security-Policy
   * (`img-src` without `blob:`) blocks it, so every attach path failed with
   * "Bild konnte nicht verarbeitet werden" (feedback d6e6fd5f). createImageBitmap
   * needs no URL at all and is therefore CSP-independent.
   */
  private async processImage(file: File): Promise<PendingImage> {
    const name = this.safeName(file.name);
    if (file.type === 'image/gif') {
      const dataUrl = await this.readAsDataUrl(file);
      return { id: crypto.randomUUID(), name, dataUrl };
    }
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, IMG_MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d context unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      return { id: crypto.randomUUID(), name, dataUrl: canvas.toDataURL('image/jpeg', IMG_QUALITY) };
    } finally {
      bitmap.close();
    }
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
}
