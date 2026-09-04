import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ComposerPrefsService } from '../../core/composer-prefs.service';
import { FeedbackDraftService } from '../../feedback/feedback-draft.service';
import { FeedbackAreaPickerComponent } from '../../feedback/feedback-area-picker.component';
import { CharCounterComponent } from '../../feedback/char-counter.component';
import { FEEDBACK_MAX_CHARS, clampFeedbackText } from '../../feedback/feedback-limits';
import type { FeedbackArea } from '../../feedback/feedback-area.types';
import { isImageAttachment } from '../../feedback/feedback-images.util';
import { PageScreenshotService } from '../../feedback/page-screenshot.service';
import {
  AnnotationResult,
  AttachmentChip,
  FeedbackAttachmentsComponent,
} from './feedback-attachments.component';

/** An image queued in the composer, held as a compressed data URI until send. */
export interface PendingImage {
  id: string;
  name: string;
  /**
   * Compressed data URI of the picked/pasted file. Empty for an image restored
   * from a stored draft — those already live in the bucket and are never
   * downloaded back into the browser just to be re-uploaded — and empty for a
   * non-image attachment, whose bytes stay in `file` instead of being base64'd.
   */
  dataUrl: string;
  /**
   * Public bucket URL, set once the image was uploaded for a persisted draft.
   * `uploadFeedbackImages` passes such an image straight through, so sending a
   * restored draft neither re-uploads nor duplicates it.
   */
  url?: string;
  /**
   * MIME type of the attachment. Absent means image — every attachment was one
   * until admins gained arbitrary files (admin feedback 312a4acc), and every
   * stored draft written before that is still read back correctly.
   */
  mime?: string;
  /**
   * Raw file for a NON-image attachment, uploaded byte-for-byte. Images never
   * carry it: they go through `processImage`'s re-encode, which is what keeps a
   * 12 MP phone screenshot under the bucket's per-object ceiling.
   */
  file?: File;
}

/** What a composer hands back on submit: the trimmed text plus queued images. */
export interface ComposerPayload {
  text: string;
  images: PendingImage[];
  /**
   * Which part of the app the message is about (admin feedback 835fec58).
   * Only new-topic composers carry one — a thread reply inherits the topic's
   * tag, so it stays undefined there. `null`/undefined must be persisted as a
   * null column, never as a made-up default: a topic that was never tagged is
   * not "Sonstiges", it is untagged.
   */
  area?: FeedbackArea | null;
}

/** Longest-edge cap (px) applied when re-encoding pasted/dropped images. */
const IMG_MAX_DIM = 1600;
/** JPEG quality for the re-encoded attachment. */
const IMG_QUALITY = 0.85;
/** Safety cap on how many images ride along on a single message. */
const MAX_ATTACHMENTS = 10;
/**
 * Per-object ceiling of the `feedback-images` bucket (migration 20260713000000).
 * Checked here so a too-large file is refused with a sentence instead of a
 * storage 413 the user cannot read.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Markdown composer shared by the new-topic box and every thread reply.
 *
 * Extracted so the reply line gains full parity with the main input (feedback
 * 73dfa165): automatic list continuation and image insert via picker / paste /
 * drag-and-drop.
 *
 * There is deliberately NO formatting toolbar. Bold/list/code buttons shipped
 * with the extraction and were dropped again (feedback fe69a821) as overkill —
 * the body is still markdown and still renders the same, it is just typed.
 *
 * ATTACHMENTS (admin feedback 312a4acc): attaching is the one thing typing
 * cannot do, and it lives in the attachment row rather than above the field. Two
 * tiles the size of a thumbnail close that row — "+" opens the picker, the
 * camera captures the page the user is on (`PageScreenshotService`, the feedback
 * panel itself left out of the shot). Whatever comes back — picked, pasted,
 * dropped or captured — takes the same path, and an image can be marked up in
 * the enlarged view before it is sent. `allowFiles` decides whether anything
 * other than an image is accepted at all; see the input's own comment.
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
 * AREA (`areaPicker`, admin feedback 835fec58): a new-topic box carries a chip
 * row naming which part of the app the message is about, pre-selected from the
 * page the sender is on. It is a correction affordance, not a required field —
 * see `FeedbackAreaPickerComponent`. Thread replies leave it off: they belong to
 * a topic that already carries the tag.
 *
 * LENGTH (admin feedback 0a0fad31): every message is capped at
 * `FEEDBACK_MAX_CHARS`, with the live count sitting half-transparent in the
 * field's bottom-right corner (`sc-char-counter`). The cap is enforced three
 * times over, because `maxlength` alone is not a cap: it covers typing and
 * pasting, `onInput` covers text dropped onto the field, and `canSend` covers a
 * draft that was stored before the cap existed.
 *
 * The parent supplies an `onSubmit` handler that returns `true` once the
 * message is persisted; the composer only clears itself on success, so a failed
 * insert keeps the draft and attachments intact.
 *
 * DRAFTS (`draftScope`): everything typed here — text *and* attached
 * screenshots — is stored on the user's account (`FeedbackDraftService`) and
 * restored the next time this composer opens, on any device. It is cleared by
 * exactly two events: a successful send, or the user pressing discard. Not by a
 * reload, not by closing the panel, not by a failed write. The previous
 * behaviour (one localStorage key, new-topic box only, text only, gated behind
 * the opt-in preferences consent) lost a long report to a closed tab, which is
 * what this replaces.
 */
@Component({
  selector: 'sc-feedback-composer',
  standalone: true,
  imports: [
    TranslateModule,
    FeedbackAttachmentsComponent,
    FeedbackAreaPickerComponent,
    CharCounterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- “sc-nest”: wherever this box sits inside a card or a panel shell that
         already pays for the padding around it, the global de-nesting rules
         (styles.scss) drop its own side frame on a narrow viewport. A composer
         that is a top-level surface — the pinned new-topic box on the full
         board — is not inside such a parent, so it keeps its frame there. -->
    <div
      class="composer sc-nest"
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

      <!-- "Worauf bezieht sich das?" — pre-filled from the page the sender is
           on, one click to correct (admin feedback 835fec58). Only on a
           new-topic box: a reply belongs to the topic's area by definition. -->
      @if (areaPicker()) {
        <sc-feedback-area-picker [(area)]="area" />
      }

      <!-- Action row. The former 🖼 icon button is gone (admin feedback
           312a4acc): adding an attachment now happens in the attachment row
           itself, on a tile the size of the thumbnail it will become. What is
           left here is draft state. -->
      <div class="actions" [class.bare]="!draftLabel() && !hasStoredDraft()">
        <input
          #fileInput
          type="file"
          [attr.accept]="allowFiles() ? null : 'image/*'"
          multiple
          hidden
          (change)="onFileInput($event)" />
        <span class="grow"></span>
        <!-- Draft state + the only thing that deletes a draft besides sending
             it. Two-step on purpose: one stray click must not throw away text
             the user spent minutes on. -->
        @if (draftLabel(); as label) {
          <span class="draft-flag" [class.warn]="draftFailed()">{{ label | translate }}</span>
        }
        @if (hasStoredDraft()) {
          @if (discardArmed()) {
            <button
              type="button"
              class="draft-clear armed"
              (click)="discardDraft()">
              {{ 'adminFeedback.compose.draftDiscardConfirm' | translate }}
            </button>
          } @else {
            <button
              type="button"
              class="draft-clear"
              (click)="armDiscard()"
              [title]="'adminFeedback.compose.draftDiscard' | translate"
              [attr.aria-label]="'adminFeedback.compose.draftDiscard' | translate">✕</button>
          }
        }
      </div>

      <!-- The field and its live character readout are one unit: the wrapper is
           the positioning context, and the textarea reserves the bottom strip
           the counter sits in so the two can never overlap (admin feedback
           0a0fad31). -->
      <div class="field">
        <textarea #ta
                  class="input"
                  [value]="draft()"
                  (input)="onInput($event)"
                  (keydown)="onKeydown($event)"
                  (paste)="onPaste($event)"
                  (blur)="flushDraft()"
                  [placeholder]="placeholder() | translate"
                  [attr.aria-label]="placeholder() | translate"
                  [attr.maxlength]="maxChars"
                  [rows]="compact() ? 2 : 4"></textarea>
        <sc-char-counter [used]="charCount()" [max]="maxChars" />
      </div>

      <!-- Pending attachments use the very same chip row the thread renders
           (feedback 99723afc): one 72px thumbnail size, click to enlarge,
           from paste through to every later re-read of the message. The row
           also carries the "+" and "capture page" tiles (admin feedback
           312a4acc), so adding one looks like what it produces. -->
      <sc-feedback-attachments
        [images]="pendingImages()"
        [removable]="true"
        [addTile]="true"
        [addLabelKey]="allowFiles() ? 'feedbackAttachments.addFile' : 'feedbackAttachments.addImage'"
        [captureTile]="true"
        [capturing]="screenshots.busy()"
        [editable]="true"
        labelKey="adminFeedback.compose.attachmentsLabel"
        (remove)="removeAt($event)"
        (add)="fileInput.click()"
        (capture)="captureScreenshot()"
        (annotate)="onAnnotated($event)" />

      <div class="foot">
        <span class="hint">
          {{ sendHintKey() | translate }}
          · {{ attachHintKey() | translate }}
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
      gap: var(--sc-gap-3);
      padding: var(--sc-pad-2);
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 10px;
    }
    .composer.compact { padding: var(--sc-pad-3); gap: 6px; }
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
      font-size: max(0.78rem, var(--sc-fs-floor));
    }

    .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    /* Nothing to say about the draft yet — do not spend a row's worth of gap
       on an empty line above the field. The hidden file input inside still
       answers a programmatic .click(). */
    .actions.bare { display: none; }
    .grow { flex: 1; }
    .draft-flag { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .draft-flag.warn { color: var(--sc-accent-hot); }
    .draft-clear {
      padding: 2px 7px;
      background: transparent;
      color: var(--sc-fg-2);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor));
      line-height: 1.3;
      cursor: pointer;
    }
    .draft-clear:hover { color: var(--sc-danger); border-color: var(--sc-danger); }
    .draft-clear.armed { color: var(--sc-danger); border-color: var(--sc-danger); }

    /* Positioning context for the live character counter, which is absolutely
       placed in the field's bottom-right corner. */
    .field { position: relative; display: block; }

    .input {
      width: 100%;
      box-sizing: border-box;
      min-height: 92px;
      resize: vertical;
      /* The extra bottom padding is the counter's lane — typed text scrolls
         above it instead of underneath it. */
      padding: 10px 12px 22px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    /* 44px of typing room plus the counter's lane — the reply box keeps the
       same two visible rows it had before the counter moved in. */
    .composer.compact .input { min-height: 66px; font-size: 0.86rem; }
    .input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }

    /* Pending-image thumbnails sit between the textarea and the send row and
       are rendered by sc-feedback-attachments — the same chip the thread uses,
       so the composer carries no size of its own. */

    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .foot .hint { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .composer.compact .foot .hint { display: none; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }

    @media (max-width: 720px) {
      /* The send button is the box's whole point on a phone: full width,
         under the hint, instead of a 90px pill squeezed against the edge. */
      .foot { flex-direction: column; align-items: stretch; }
      .foot .sc-btn { width: 100%; justify-content: center; }
    }
  `],
})
export class FeedbackComposerComponent implements OnDestroy {
  private readonly translate = inject(TranslateService);
  private readonly composerPrefs = inject(ComposerPrefsService);
  private readonly drafts = inject(FeedbackDraftService);
  /** Public so the template can bind the capture tile's busy state. */
  readonly screenshots = inject(PageScreenshotService);
  private readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  /** i18n key for the textarea placeholder / aria-label. */
  readonly placeholder = input('');
  /** i18n key for the send button label. */
  readonly sendLabel = input('');
  /** Parent-driven busy flag (a refresh / other write in flight). */
  readonly busy = input(false);
  /** Reply variant: smaller textarea and a micro send button. */
  readonly compact = input(false);
  /**
   * Show the area chip row above the field (admin feedback 835fec58). Set on
   * the new-topic boxes only — thread replies and the author channel belong to
   * a topic that already carries the tag, and asking again per message would
   * turn a one-time hint into noise.
   */
  readonly areaPicker = input(false);
  /**
   * May this composer attach things that are not images? (admin feedback
   * 312a4acc)
   *
   * Viewers and collaborators attach IMAGES ONLY — a screenshot is evidence,
   * and an arbitrary file from an account that cannot otherwise write anything
   * to the app is not something the feedback surface wants to carry. Admins may
   * attach anything (a log, a crash dump, a PDF).
   *
   * The default is the restrictive one on purpose: a new embedding of this
   * composer that forgets the input gets the safe behaviour, not the wide one.
   * The gate is repeated where it actually matters — `uploadFeedbackImages`
   * refuses a non-image without the flag, and the storage policy in migration
   * 20260904040000 refuses one from a non-admin outright — because a client-side
   * `accept` attribute is a hint to a file picker, not a rule.
   */
  readonly allowFiles = input(false);
  /**
   * Identity of this composer in the account-bound draft store (see
   * `draftScopes`). Null turns persistence off entirely — every composer in the
   * feedback surface sets one; the input stays nullable so an embedding outside
   * that surface is not forced to invent a key.
   */
  readonly draftScope = input<string | null>(null);
  /**
   * Handler the parent supplies. Returns `true` once the message is persisted,
   * so the composer clears itself; `false`/throw keeps the draft on failure.
   */
  readonly onSubmit = input<(payload: ComposerPayload) => Promise<boolean>>();

  readonly draft = signal('');
  /**
   * The area tag of the topic being composed, owned here and two-way bound to
   * the picker. Deliberately NOT part of the persisted draft: a restored draft
   * would carry the area of wherever it was typed days ago, while the picker's
   * live detection re-fills it from the page the user is on right now — which is
   * the fresher guess of the two, and correctable either way.
   */
  readonly area = signal<FeedbackArea | null>(null);
  readonly draftRestored = signal(false);
  readonly attachments = signal<PendingImage[]>([]);
  /**
   * Queued images in the shape the shared attachment row renders. A restored
   * draft has no local bytes left, so the bucket URL is the source there.
   */
  readonly pendingImages = computed<AttachmentChip[]>(() =>
    this.attachments().map((a) => ({
      src: a.url ?? a.dataUrl,
      alt: a.name,
      kind: isImageAttachment(a) ? 'image' : 'file',
    })),
  );
  readonly dragActive = signal(false);
  readonly sending = signal(false);
  readonly errorMsg = signal<string | null>(null);
  /** Discard is two-step — this is the armed state of the confirm button. */
  readonly discardArmed = signal(false);
  private discardTimer: ReturnType<typeof setTimeout> | null = null;

  /** A draft for this composer exists in the store (so it can be discarded). */
  readonly hasStoredDraft = computed(() => {
    const scope = this.draftScope();
    return !!scope && !!this.drafts.entries().get(scope);
  });

  /** The last write for this composer failed — say so instead of pretending. */
  readonly draftFailed = computed(() => {
    const scope = this.draftScope();
    return !!scope && !!this.drafts.entries().get(scope)?.failed;
  });

  /** One-line draft state in the action row; null while there is nothing to say. */
  readonly draftLabel = computed<string | null>(() => {
    const scope = this.draftScope();
    if (!scope) return null;
    if (this.draftRestored()) return 'adminFeedback.compose.draftRestored';
    const entry = this.drafts.entries().get(scope);
    if (!entry) return null;
    if (entry.failed) return 'adminFeedback.compose.draftFailed';
    return entry.dirty ? 'adminFeedback.compose.draftSaving' : 'adminFeedback.compose.draftSaved';
  });

  /** Attachment hint — names what this role may actually attach. */
  readonly attachHintKey = computed(() =>
    this.allowFiles()
      ? 'adminFeedback.compose.attachHintFiles'
      : 'adminFeedback.compose.attachHint',
  );

  /** Hint under the field — must name the mapping the user actually has. */
  readonly sendHintKey = computed(() =>
    this.composerPrefs.sendOnEnter()
      ? 'adminFeedback.compose.sendHint'
      : 'adminFeedback.compose.sendHintCtrl',
  );

  /** The shared cap, exposed for the template's `maxlength` and the counter. */
  readonly maxChars = FEEDBACK_MAX_CHARS;

  /** Live length of what is in the field — what the counter renders. */
  readonly charCount = computed(() => this.draft().length);

  /**
   * A restored draft written before the cap existed can still be over it. It is
   * not thrown away — the author keeps their text and can cut it down — but it
   * cannot be sent until it fits.
   */
  readonly overLimit = computed(() => this.charCount() > this.maxChars);

  readonly canSend = computed(
    () =>
      !this.busy() &&
      !this.sending() &&
      !this.overLimit() &&
      (this.draft().trim().length > 0 || this.attachments().length > 0),
  );

  constructor() {
    // The workflow view keeps ONE composer mounted and moves it from topic to
    // topic, so the scope is not a constant. Every change has to hand the old
    // draft back to the store and pull the new one in — otherwise a half-typed
    // answer would follow the cursor onto the next topic and be saved there.
    effect(() => {
      const scope = this.draftScope();
      if (scope === this.activeScope) return;
      const previous = this.activeScope;
      this.activeScope = scope;
      untracked(() => this.switchScope(previous, scope));
    });
  }

  ngOnDestroy(): void {
    if (this.discardTimer) clearTimeout(this.discardTimer);
    // Closing the panel, collapsing the topic or navigating away must not cost
    // the last few characters sitting in the debounce window.
    this.flushDraft();
  }

  // ---- Submit ------------------------------------------------------------

  async submit(): Promise<void> {
    if (!this.canSend()) return;
    const payload: ComposerPayload = {
      text: this.draft().trim(),
      images: this.attachments(),
      // Undefined (not null) where no picker is shown, so a reply handler can
      // tell "this composer has no opinion" from "explicitly untagged".
      area: this.areaPicker() ? this.area() : undefined,
    };
    const handler = this.onSubmit();
    if (!handler) return;
    this.sending.set(true);
    this.errorMsg.set(null);
    try {
      const ok = await handler(payload);
      if (ok) {
        this.draft.set('');
        this.draftRestored.set(false);
        this.attachments.set([]);
        // The field is `resize: vertical`, so a drag leaves an inline height
        // behind. After a send that height belongs to a message that is gone —
        // hand the empty box back at its natural size instead of an arbitrary
        // one (admin feedback 18e96ad3).
        const el = this.ta()?.nativeElement;
        if (el) {
          el.style.height = '';
          el.scrollTop = 0;
        }
        // Clearing the tag re-arms the picker's auto-detection, so the NEXT
        // topic starts from the page the user is on rather than from the last
        // thing they happened to correct.
        this.area.set(null);
        this.disarmDiscard();
        // Sent: the draft has become a message and its uploads are referenced
        // by that message's body, so the row goes and the objects stay.
        const scope = this.draftScope();
        if (scope) void this.drafts.clearSent(scope);
      }
    } finally {
      this.sending.set(false);
    }
  }

  // ---- Draft persistence (account-bound, see FeedbackDraftService) --------

  /** Scope the on-screen content currently belongs to. */
  private activeScope: string | null = null;

  private switchScope(previous: string | null, next: string | null): void {
    if (previous) void this.drafts.flush(previous);
    this.draft.set('');
    this.attachments.set([]);
    this.area.set(null);
    this.draftRestored.set(false);
    this.errorMsg.set(null);
    this.disarmDiscard();
    if (next) void this.restoreDraft(next);
  }

  private async restoreDraft(scope: string): Promise<void> {
    await this.drafts.ready();
    // Moved on again while the store was loading — that scope owns the box now.
    if (this.activeScope !== scope) return;
    const entry = this.drafts.entry(scope);
    if (!entry) return;
    // If the user was faster than the network, what they typed wins: a restore
    // must never overwrite live input.
    if (this.draft().length > 0 || this.attachments().length > 0) return;
    this.draft.set(entry.body);
    this.attachments.set(
      entry.images.map((img) => ({
        id: img.id,
        name: img.name,
        dataUrl: '',
        url: img.url,
        mime: img.mime,
      })),
    );
    this.draftRestored.set(true);
  }

  /** Hand the current content to the store (debounced there, not here). */
  private saveDraft(): void {
    const scope = this.draftScope();
    if (!scope) return;
    this.drafts.stage(
      scope,
      this.draft(),
      // Only uploaded attachments can be referenced; one that failed to upload
      // still rides along on send, it just is not part of the stored draft.
      this.attachments()
        .filter((a): a is PendingImage & { url: string } => !!a.url)
        .map((a) => ({ id: a.id, name: a.name, url: a.url, mime: a.mime })),
    );
  }

  /** Write immediately — on blur and when the composer goes away. */
  flushDraft(): void {
    const scope = this.draftScope();
    if (scope) void this.drafts.flush(scope);
  }

  /** First click arms the confirm, and disarms itself again after a few seconds. */
  armDiscard(): void {
    this.discardArmed.set(true);
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = setTimeout(() => this.discardArmed.set(false), 5000);
  }

  private disarmDiscard(): void {
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = null;
    this.discardArmed.set(false);
  }

  /** The user's explicit "throw this away" — the only non-send path that clears. */
  discardDraft(): void {
    this.disarmDiscard();
    const scope = this.draftScope();
    this.draft.set('');
    this.attachments.set([]);
    this.area.set(null);
    this.draftRestored.set(false);
    this.errorMsg.set(null);
    if (scope) void this.drafts.discard(scope);
  }

  /**
   * `maxlength` covers typing and pasting, but NOT text dropped onto the field
   * — Chrome happily drops a megabyte past the attribute. So the cap is applied
   * here as well, and written back to the element, which is what actually makes
   * it impossible to file another 9.800-character wall (admin feedback
   * 0a0fad31).
   */
  onInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    const value = clampFeedbackText(el.value);
    if (el.value !== value) {
      const caret = Math.min(el.selectionStart ?? value.length, value.length);
      el.value = value;
      el.setSelectionRange(caret, caret);
    }
    this.draft.set(value);
    this.draftRestored.set(false);
    this.saveDraft();
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

  /**
   * Programmatic writes (the list-marker insert) bypass `maxlength` the same way
   * a drop does, so they go through the same clamp.
   */
  private applyValue(el: HTMLTextAreaElement, next: string, caret: number): void {
    const capped = clampFeedbackText(next);
    el.value = capped;
    caret = Math.min(caret, capped.length);
    el.setSelectionRange(caret, caret);
    this.draft.set(capped);
    this.draftRestored.set(false);
    this.saveDraft();
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
    this.saveDraft();
  }

  /** Drop the queued image behind a chip — the row reports position, not id. */
  removeAt(index: number): void {
    const att = this.attachments()[index];
    if (att) this.removeAttachment(att.id);
  }

  /**
   * Capture the page the user is looking at and queue it like any other image
   * (admin feedback 312a4acc).
   *
   * "Take a screenshot, find it, attach it" is three context switches for the
   * single most useful thing a bug report can carry, and on a phone it is worse
   * than that. The service leaves the feedback launcher and panel out of the
   * shot, so the result is the page — not the page plus the box the user is
   * typing in.
   */
  async captureScreenshot(): Promise<void> {
    if (this.screenshots.busy()) return;
    this.errorMsg.set(null);
    try {
      const file = await this.screenshots.capture();
      await this.addFiles([file]);
    } catch {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.captureError'));
    }
  }

  /**
   * Replace a queued image with its marked-up version.
   *
   * The annotated bytes are a NEW attachment body, so the cached upload of the
   * unmarked version no longer describes it — the URL is dropped and the image
   * is re-uploaded under a fresh object. The old object is left in the bucket;
   * deleting it would race the stored draft that may still reference it, and an
   * orphaned thumbnail costs kilobytes.
   */
  onAnnotated(result: AnnotationResult): void {
    const att = this.attachments()[result.index];
    if (!att) return;
    const next: PendingImage = {
      id: att.id,
      name: att.name,
      dataUrl: result.dataUrl,
      mime: 'image/jpeg',
    };
    this.attachments.update((list) => list.map((a) => (a.id === att.id ? next : a)));
    void this.cacheAttachment(next);
  }

  /**
   * Accept files from any source (picker, paste, drop, page capture).
   *
   * Images are re-encoded; anything else is only reachable for a composer with
   * `allowFiles` and rides along byte-for-byte. A file a viewer is not allowed
   * to send is refused with a sentence, not dropped silently — silence reads as
   * a broken button.
   */
  private async addFiles(files: FileList | File[] | null | undefined): Promise<void> {
    if (!files) return;
    const all = Array.from(files);
    if (all.length === 0) return;
    const accepted = this.allowFiles() ? all : all.filter((f) => f.type.startsWith('image/'));
    if (accepted.length === 0) {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.imagesOnly'));
      return;
    }
    for (const file of accepted) {
      if (this.attachments().length >= MAX_ATTACHMENTS) {
        this.errorMsg.set(
          this.translate.instant('adminFeedback.compose.tooManyImages', { max: MAX_ATTACHMENTS }),
        );
        break;
      }
      const isImage = file.type.startsWith('image/');
      if (!isImage && file.size > MAX_FILE_BYTES) {
        this.errorMsg.set(
          this.translate.instant('adminFeedback.compose.fileTooLarge', {
            max: Math.round(MAX_FILE_BYTES / (1024 * 1024)),
          }),
        );
        continue;
      }
      try {
        const att = isImage ? await this.processImage(file) : this.processFile(file);
        this.attachments.update((list) => [...list, att]);
        await this.cacheAttachment(att);
      } catch {
        this.errorMsg.set(this.translate.instant('adminFeedback.compose.imageError'));
      }
    }
  }

  /** Queue a non-image attachment: no re-encode, the original bytes go up. */
  private processFile(file: File): PendingImage {
    return {
      id: crypto.randomUUID(),
      name: this.safeName(file.name),
      dataUrl: '',
      mime: file.type || 'application/octet-stream',
      file,
    };
  }

  /**
   * Put a freshly attached screenshot into the bucket so the stored draft can
   * point at it. Deliberately at attach time: the draft row then holds a URL
   * instead of megabytes of base64, and the later send reuses the same object.
   *
   * A failed upload is not an error the user has to act on — the image is still
   * in the composer and still sent normally. It only would not come back after
   * a reload, and saying so is more honest than a silent gap.
   */
  private async cacheAttachment(att: PendingImage): Promise<void> {
    if (!this.draftScope()) return;
    const url = await this.drafts.uploadAttachment(att, this.allowFiles());
    if (url) {
      this.attachments.update((list) =>
        list.map((a) => (a.id === att.id ? { ...a, url } : a)),
      );
    } else {
      this.errorMsg.set(this.translate.instant('adminFeedback.compose.attachNotCached'));
    }
    this.saveDraft();
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
      return { id: crypto.randomUUID(), name, dataUrl, mime: 'image/gif' };
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
      return {
        id: crypto.randomUUID(),
        name,
        dataUrl: canvas.toDataURL('image/jpeg', IMG_QUALITY),
        mime: 'image/jpeg',
      };
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
