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
 * LENGTH (admin feedback 0a0fad31, moved by d08f1983): every message is capped
 * at `FEEDBACK_MAX_CHARS`, with the live count always on screen on its own line
 * UNDER the field (`sc-char-counter`, `placement="below"`) rather than as an
 * overlay inside it — a field that grows with its content cannot keep a corner
 * free for it. The cap is enforced three times over, because `maxlength` alone
 * is not a cap: it covers typing and pasting, `onInput` covers text dropped onto
 * the field, and `canSend` covers a draft that was stored before the cap
 * existed.
 *
 * HEIGHT (admin feedback d08f1983): three rows in every variant, one row taller
 * per added line, and a per-variant cap after which the box scrolls instead of
 * pushing the send button off the screen.
 *
 * The parent supplies an `onSubmit` handler that returns `true` once the
 * message is persisted; the composer only clears itself on success, so a failed
 * insert keeps the draft and attachments intact.
 *
 * DRAFTS (`draftScope`): everything typed here — text *and* attached
 * screenshots — is stored on the user's account (`FeedbackDraftService`) and
 * restored the next time this composer opens, on any device. It is cleared by
 * exactly two events: a successful send, or the box being emptied by hand (the
 * ✕ that used to do the second one is gone — admin feedback 187574ed — because
 * selecting the text and deleting it says the same thing with the keys the
 * writing already uses). Not by a reload, not by closing the panel, not by a
 * failed write. The previous
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
      [class.large]="large()"
      [class.frameless]="frameless()"
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

      <!-- The picker's file input. It has no row of its own any more (admin
           feedback 187574ed): the row it used to share with the draft state sat
           ABOVE the field and cost a line there whether or not it had anything
           to say. Hidden either way, and a hidden input still answers a
           programmatic .click() from the "+" tile. -->
      <input
        #fileInput
        type="file"
        [attr.accept]="allowFiles() ? null : 'image/*'"
        multiple
        hidden
        (change)="onFileInput($event)" />

      <!-- The field and its live character readout are one column: three rows
           of writing room that grow with every added line, and the readout on a
           line of its OWN underneath (admin feedback d08f1983 — "sollte drei
           zeilen haben und sich einfach vertikal ausbauen … die
           buchstabenanzahl immer sichtbar, aber darunter und nicht
           abgeschnitten"). It used to be an overlay on a padding lane inside
           the box; a box that changes height has no stable corner to pin to,
           and an overlay inside a scrolling surface is exactly the thing that
           gets clipped.

           The growing is pure CSS: the .grow wrapper's ::after carries a copy
           of the text with the same box metrics and sizes the single grid cell
           the textarea is stretched into. No measured pixel, no resize observer, and nothing
           that can desync from the value the field actually holds. -->
      <div class="field">
        <div class="grow" [attr.data-replica]="draft()">
          <textarea #ta
                    class="input"
                    rows="3"
                    [value]="draft()"
                    (input)="onInput($event)"
                    (keydown)="onKeydown($event)"
                    (paste)="onPaste($event)"
                    (blur)="flushDraft()"
                    [placeholder]="placeholder() | translate: placeholderParams()"
                    [attr.aria-label]="placeholder() | translate: placeholderParams()"
                    [attr.maxlength]="maxChars"></textarea>
        </div>
        <!-- The readout line: draft state directly LEFT of the character count
             (admin feedback 187574ed — "Entwurf gesichert kann gern direkt
             links neben der zeichenzähleranzeige"). Both are the same kind of
             thing — a quiet status about the text above them — so they share
             one line instead of one sitting in the action row. -->
        <div class="meta">
          @if (draftLabel(); as label) {
            <span class="draft-flag" [class.warn]="draftFailed()">{{ label | translate }}</span>
          }
          <sc-char-counter [used]="charCount()" [max]="maxChars" placement="below" />
        </div>
      </div>

      <!-- SEND ROW — one line for everything that is not the writing itself
           (admin feedback 187574ed: "die attachments müssen links neben dem
           antworten button sein … generell weniger Fläche").

           Left: the pending attachments, the same chip row the thread renders
           (feedback 99723afc) at half size, carrying the "+" and "capture page"
           tiles (admin feedback 312a4acc) so adding one looks like what it
           produces. Right: whatever the surface projects in (the opened topic's
           sign-off) and the send button. Draft state moved out of this row
           entirely — it now shares the readout line with the character count.

           No "discard draft" ✕ any more (admin feedback 187574ed): emptying the
           box already deletes the stored draft (see saveDraft), so the control
           was a second way to do what clearing the field does — at the price of
           two clicks of chrome in the tightest row of the panel.

           No explainer line (feedback d08f1983): pasting an image and
           Enter-vs-Shift-Enter are conventions anybody who writes in a text box
           already knows. The one part that is NOT universal — WHICH key sends,
           because that is a setting — rides along as the button's tooltip, and
           on an iconSend button it IS the button. -->
      <div class="foot">
        <sc-feedback-attachments
          [images]="pendingImages()"
          [removable]="true"
          [addTile]="true"
          [addLabelKey]="allowFiles() ? 'feedbackAttachments.addFile' : 'feedbackAttachments.addImage'"
          [captureTile]="true"
          [capturing]="screenshots.busy()"
          [editable]="true"
          [dense]="true"
          labelKey="adminFeedback.compose.attachmentsLabel"
          (remove)="removeAt($event)"
          (add)="fileInput.click()"
          (capture)="captureScreenshot()"
          (annotate)="onAnnotated($event)" />

        <!-- Whatever the surrounding surface wants decided right here, LEFT of
             the send button (admin feedback 187574ed: the opened topic's
             "Abgenommen" sits next to "Antworten" instead of in a review box of
             its own above the composer). Projected, so this component keeps
             knowing nothing about the workflow it is embedded in. -->
        <ng-content select="[composerAction]" />

        <button
          class="sc-btn send"
          [class.sc-btn-primary]="!compact()"
          [class.micro]="compact()"
          [class.hot]="primaryHot()"
          [class.key]="iconSend()"
          [attr.title]="sendHintKey() | translate"
          [attr.aria-label]="sendLabel() | translate"
          (click)="submit()"
          [disabled]="!canSend()">
          @if (iconSend()) {
            <span aria-hidden="true">{{ sendKeyLabel() | translate }}</span>
          } @else {
            {{ sendLabel() | translate }}
          }
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .composer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--sc-pad-3);
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 10px;
      /* The two knobs every variant of the field turns: its type size and how
         far it may grow before it starts scrolling instead. Every variant
         starts at the same three rows. */
      --sc-field-fs: 0.9rem;
      --sc-field-cap: 320px;
    }
    .composer.compact { padding: 8px; gap: 5px; --sc-field-fs: 0.86rem; --sc-field-cap: 220px; }
    /* The opened topic's sheet has the room, so its box may run further before
       it hands over to its own scrollbar (concept 2026-09-04). */
    .composer.large { --sc-field-cap: 420px; }
    /* No frame of its own where the surface around it already draws one (admin
       feedback 187574ed: "Keine Doppelumrandung für den ganzen Bereich, der ist
       schon sticky abgetrennt"). The field keeps its own border — that one says
       "you can type here" — and the padding is handed back to the parent, which
       is what pays for the distance to the panel edge. */
    .composer.frameless {
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: 0;
    }
    /* …except while something is being dropped on it: the highlight IS a
       border, so it comes back for as long as the drag lasts. */
    .composer.frameless.drag-active { border: 1px solid var(--sc-accent); border-radius: 8px; }
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

    /* Draft state rides on the readout line, immediately left of the count
       (admin feedback 187574ed) — it may never push the field down, and it may
       never widen the row: it is the one thing here that is allowed to be cut
       short. */
    .draft-flag {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: max(0.72rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .draft-flag.warn { color: var(--sc-accent-hot); }

    /* The box and its readout, stacked. Normal flow on purpose: the counter
       is a sibling under the field, so no ancestor's overflow can cut it off
       and no growth of the field can push it out of view. */
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    /* One line for both quiet readouts, pinned to the field's right edge. */
    .meta { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }

    /* The auto-grow cell. Its ::after is an invisible replica of the text with
       byte-identical metrics — same font, same padding, same border width, same
       wrapping — so the row is always exactly as tall as what is typed. Both
       the replica and the textarea stop at the cap; past it the textarea keeps
       the caret in view by scrolling inside itself. */
    .grow { display: grid; min-width: 0; }
    .grow::after {
      content: attr(data-replica) " ";
      visibility: hidden;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      max-height: var(--sc-field-cap);
      overflow: hidden;
    }
    .grow > .input,
    .grow::after {
      grid-area: 1 / 1 / 2 / 2;
      width: 100%;
      box-sizing: border-box;
      /* Three rows before a single character is typed: 3 × line-height plus the
         vertical padding and the border. */
      min-height: calc(3 * 1.5em + 20px + 2px);
      padding: 10px 12px;
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: var(--sc-field-fs);
      line-height: 1.5;
      letter-spacing: inherit;
    }
    .grow > .input {
      /* The field sizes itself — a manual grip would fight the replica. */
      resize: none;
      max-height: var(--sc-field-cap);
      overflow-y: auto;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
    }
    /* The ONE red call to action a sheet gets (red = the admin's own move; the
       viewer's composer never sets it). Dark text on the red, like the primary
       accent button, keeps the label readable. */
    .sc-btn.hot { background: var(--sc-accent-hot); border-color: var(--sc-accent-hot); color: var(--sc-bg-0); }
    .sc-btn.hot:hover:not(:disabled) { background: var(--sc-accent-hot); filter: brightness(1.12); box-shadow: none; }
    .grow > .input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }

    /* The send row: attachment chips on the left (they grow into the gap),
       draft state and the send button pinned right. One line instead of the
       three bands this used to be — a thumbnail band, a draft band above the
       field and a button band (admin feedback 187574ed). */
    .foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .foot .send { flex: 0 0 auto; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    /* The key-symbol send button (admin feedback 187574ed): the label is the
       shortcut that triggers it, so it is square-ish and the glyph carries the
       size instead of the word. The words are still there for anyone who needs
       them — as the accessible name and as the tooltip. */
    .sc-btn.send.key {
      min-width: 46px;
      padding: 6px 12px;
      font-size: 1rem;
      line-height: 1.1;
      letter-spacing: 0.02em;
    }

    @media (max-width: 720px) {
      /* Still ONE row on a phone (admin feedback 187574ed) — at 36px the chips
         no longer need a band of their own, so the send button stays beside
         them and simply takes whatever width is left rather than dropping onto
         a line below them. */
      .foot .send { flex: 1 1 auto; justify-content: center; min-width: 96px; }
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
  /**
   * Interpolation values for that key (admin feedback 187574ed). A reply box
   * that belongs to ONE topic says which one — "Antwort zu #211 „…“" rather
   * than a generic "Antwort schreiben…", so the hint names the context the
   * message will land in. Empty for the composers that have no such context.
   */
  readonly placeholderParams = input<Record<string, unknown> | undefined>(undefined);
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
  /** The opened topic's composer (concept 2026-09-04): a taller field. */
  readonly large = input(false);
  /**
   * Drop the box's own frame and padding (admin feedback 187574ed).
   *
   * Set where the composer is glued into a surface that already separates it —
   * the opened topic's sticky bottom bar, the docked panel's "Neues Thema"
   * sheet. Both drew a second border a few pixels inside the first one and paid
   * twice for the distance to the panel edge. The pinned board composer is a
   * top-level surface and keeps its frame.
   */
  readonly frameless = input(false);
  /** Paint the send button in the elevated-access red — the sheet's one CTA. Admin surfaces only. */
  readonly primaryHot = input(false);
  /**
   * Label the send button with the key that sends instead of a word (admin
   * feedback 187574ed: "antworten button vllt. einfach mit enter symbol oder
   * strg+enter symbol je nachdem statt textlich").
   *
   * Set on the opened topic's composer, where the button sits beside a second
   * action and every millimetre of that row is contested. The word does not
   * disappear — it becomes the button's accessible name — and the glyph follows
   * the user's own mapping, so it never promises a key that does not send.
   */
  readonly iconSend = input(false);
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

  /** A draft for this composer exists in the store. */
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

  /** Send-key tooltip — must name the mapping the user actually has. */
  readonly sendHintKey = computed(() =>
    this.composerPrefs.sendOnEnter()
      ? 'adminFeedback.compose.sendHint'
      : 'adminFeedback.compose.sendHintCtrl',
  );

  /**
   * The key cap an `iconSend` button carries: the RETURN arrow on its own where
   * Enter sends, and the arrow behind the modifier where it does not. Localized
   * because the modifier is a WORD on the platforms that spell it out ("Strg"),
   * and a button that names the wrong key is worse than one that names none.
   */
  readonly sendKeyLabel = computed(() =>
    this.composerPrefs.sendOnEnter()
      ? 'adminFeedback.compose.sendKey'
      : 'adminFeedback.compose.sendKeyCtrl',
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
        // The box sizes itself from its content now (admin feedback
        // d08f1983), so an emptied field is back at three rows on its own. The
        // reset stays because a session that still carries an inline height
        // from the old resize grip would otherwise keep a height that belongs
        // to a message which is gone (admin feedback 18e96ad3).
        const el = this.ta()?.nativeElement;
        if (el) {
          el.style.height = '';
          el.scrollTop = 0;
        }
        // Clearing the tag re-arms the picker's auto-detection, so the NEXT
        // topic starts from the page the user is on rather than from the last
        // thing they happened to correct.
        this.area.set(null);
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
    // Emptying the box IS the discard (admin feedback 187574ed — the ✕ that
    // used to sit in the send row is gone). The store already deletes a row
    // that went empty; what only the explicit path did was clean up the
    // screenshots the draft had uploaded, so an emptied box takes that route
    // and nothing is left behind in the bucket.
    if (!this.draft().trim() && this.attachments().length === 0) {
      this.draftRestored.set(false);
      if (this.drafts.entries().get(scope)) void this.drafts.discard(scope);
      return;
    }
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
