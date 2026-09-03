import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { TranslateModule } from '@ngx-translate/core';
import { FeedbackImage } from './markdown.util';
import {
  ANNOTATION_COLORS,
  AnnotationPoint,
  AnnotationShape,
  AnnotationTool,
  drawAnnotations,
  drawShape,
  exportAnnotated,
  strokeWidthFor,
} from './image-annotation.util';

/**
 * One chip in the attachment row.
 *
 * `kind` is what makes an admin's PDF/log/zip renderable in the very same row
 * as a screenshot instead of needing a second strip: a file chip is the same
 * box, with its extension instead of a picture. Absent means image, so every
 * existing caller (which only ever passes lifted markdown images) is unchanged.
 */
export interface AttachmentChip extends FeedbackImage {
  readonly kind?: 'image' | 'file';
}

/** An image the user finished marking up: index in the row plus the new bytes. */
export interface AnnotationResult {
  readonly index: number;
  readonly dataUrl: string;
}

/**
 * Screenshots of a feedback message, shown the way a chat shows attachments
 * (feedback a660536a): a wrapping row of small thumbnails *after* the text,
 * not full-width pictures interrupting the flow. Clicking one enlarges it.
 *
 * The images are the ones `renderFeedbackBody()` lifts out of the markdown, so
 * this component is used wherever a feedback body is rendered — the admin
 * board, the workflow view and the non-admin panel alike.
 *
 * `removable` additionally turns the row into the composer's pending-attachment
 * strip (feedback 99723afc), so an image is the same small chip from the moment
 * it is pasted to every later re-read of the thread — one size, one lightbox,
 * one implementation instead of a second, drifting copy in the composer.
 *
 * COMPOSER TILES (admin feedback 312a4acc): in the composer the row also owns
 * the two ways to *add* something — a "+" tile and a "capture this page" tile,
 * both exactly the size and shape of an attached thumbnail and sitting in the
 * same wrapping row. The former mini icon button above the field is gone: the
 * place where attachments live is the place where you add one.
 *
 * ANNOTATION (`editable`): an enlarged composer image can be drawn on before it
 * is sent — rectangle, arrow, freehand, four colours. The marks are flattened
 * into the image on save (`exportAnnotated`), so what the author looked at is
 * literally what everyone else receives.
 *
 * The enlarged view is portaled to <body> through a CDK overlay rather than
 * rendered in place: feedback bodies live inside fixed, scrollable panels whose
 * stacking and overflow would otherwise clip it. Same mechanism as the news
 * detail view. A message with several screenshots can be paged through in
 * place (arrow keys / the ‹ › controls) instead of closing and reopening.
 */
@Component({
  selector: 'sc-feedback-attachments',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showRow()) {
      <div class="att-row" [attr.aria-label]="labelKey() | translate">
        @for (img of images(); track $index) {
          <!-- Chip wrapper, not a nested button: the remove control has to sit
               on top of the thumbnail without living inside its <button>. -->
          <div class="att-chip">
            @if (img.kind === 'file') {
              <!-- A file chip is a navigation (it opens the object), so it is a
                   real anchor when there is something to open, and an inert box
                   while the upload is still in flight. -->
              @if (img.src) {
                <a
                  class="att-thumb att-file"
                  [href]="img.src"
                  target="_blank"
                  rel="noopener noreferrer"
                  [attr.title]="img.alt"
                  [attr.aria-label]="'feedbackAttachments.openFile' | translate: { name: img.alt }">
                  <span class="af-ext">{{ extOf(img.alt) }}</span>
                  <span class="af-name">{{ img.alt }}</span>
                </a>
              } @else {
                <span class="att-thumb att-file" [attr.title]="img.alt">
                  <span class="af-ext">{{ extOf(img.alt) }}</span>
                  <span class="af-name">{{ img.alt }}</span>
                </span>
              }
            } @else {
              <button
                type="button"
                class="att-thumb"
                (click)="open($index)"
                [attr.aria-label]="
                  img.alt
                    ? ('feedbackAttachments.enlargeNamed' | translate: { name: img.alt })
                    : ('feedbackAttachments.enlarge' | translate)
                ">
                <img
                  [src]="img.src"
                  [alt]="img.alt || ('feedbackAttachments.image' | translate)"
                  loading="lazy"
                  decoding="async" />
              </button>
            }
            @if (removable()) {
              <button
                type="button"
                class="att-remove"
                (click)="remove.emit($index)"
                [attr.aria-label]="'feedbackAttachments.remove' | translate">
                ✕
              </button>
            }
          </div>
        }

        <!-- The two "add" tiles close the row: same box, same size, same line —
             so "what is attached" and "attach something" read as one control
             (admin feedback 312a4acc). -->
        @if (addTile()) {
          <button
            type="button"
            class="att-thumb att-add"
            (click)="add.emit()"
            [title]="addLabelKey() | translate"
            [attr.aria-label]="addLabelKey() | translate">
            <span class="tile-glyph" aria-hidden="true">＋</span>
          </button>
        }
        @if (captureTile()) {
          <button
            type="button"
            class="att-thumb att-capture"
            (click)="capture.emit()"
            [disabled]="capturing()"
            [title]="'feedbackAttachments.capture' | translate"
            [attr.aria-label]="'feedbackAttachments.capture' | translate">
            @if (capturing()) {
              <span class="tile-glyph spin" aria-hidden="true">◌</span>
            } @else {
              <span class="tile-glyph" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                  <path
                    d="M4 8h3l1.5-2h7L17 8h3v11H4z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round" />
                  <circle cx="12" cy="13.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7" />
                </svg>
              </span>
            }
          </button>
        }
      </div>
    }

    <!-- Enlarged view (CDK overlay, portaled to <body>). -->
    <ng-template #lightboxTpl>
      @if (current(); as img) {
        <div class="lb-backdrop" (click)="onBackdrop()">
          <div
            class="lb-frame"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="img.alt || ('feedbackAttachments.image' | translate)"
            (click)="$event.stopPropagation()">
            <button
              type="button"
              class="lb-close"
              (click)="close()"
              [attr.aria-label]="'feedbackAttachments.close' | translate">
              ✕
            </button>
            <div class="lb-stage">
              <img
                class="lb-img"
                [src]="img.src"
                [alt]="img.alt || ('feedbackAttachments.image' | translate)"
                (load)="onImageLoad($event)" />
              @if (annotating()) {
                <canvas
                  class="lb-draw"
                  (pointerdown)="onDrawStart($event)"
                  (pointermove)="onDrawMove($event)"
                  (pointerup)="onDrawEnd($event)"
                  (pointercancel)="onDrawEnd($event)"></canvas>
              }
            </div>
            @if (img.alt && !annotating()) {
              <p class="lb-caption">{{ img.alt }}</p>
            }

            @if (annotating()) {
              <!-- Mark-up bar. Kept to one line of 44px targets so it survives a
                   phone in portrait, which is where most screenshots are taken. -->
              <div class="lb-tools" role="toolbar" [attr.aria-label]="'feedbackAttachments.annotateTools' | translate">
                @for (t of tools; track t) {
                  <button
                    type="button"
                    class="lb-tool"
                    [class.on]="tool() === t"
                    (click)="tool.set(t)"
                    [attr.aria-pressed]="tool() === t"
                    [title]="'feedbackAttachments.tool.' + t | translate"
                    [attr.aria-label]="'feedbackAttachments.tool.' + t | translate">
                    @switch (t) {
                      @case ('rect') { ▭ }
                      @case ('arrow') { ➚ }
                      @default { ✎ }
                    }
                  </button>
                }
                <span class="lb-sep"></span>
                @for (c of colors; track c) {
                  <button
                    type="button"
                    class="lb-swatch"
                    [class.on]="color() === c"
                    [style.background]="c"
                    (click)="color.set(c)"
                    [attr.aria-pressed]="color() === c"
                    [attr.aria-label]="'feedbackAttachments.colorPick' | translate"></button>
                }
                <span class="lb-sep"></span>
                <button
                  type="button"
                  class="lb-tool"
                  (click)="undo()"
                  [disabled]="shapes().length === 0"
                  [title]="'feedbackAttachments.undo' | translate"
                  [attr.aria-label]="'feedbackAttachments.undo' | translate">↶</button>
              </div>
              @if (annotateError()) {
                <p class="lb-err" role="alert">{{ annotateError()! | translate }}</p>
              }
              <div class="lb-nav">
                <button type="button" class="sc-btn micro" (click)="cancelAnnotate()">
                  {{ 'feedbackAttachments.annotateCancel' | translate }}
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-primary micro"
                  (click)="saveAnnotation()"
                  [disabled]="shapes().length === 0 || savingAnnotation()">
                  {{ 'feedbackAttachments.annotateSave' | translate }}
                </button>
              </div>
            } @else {
              @if (editable()) {
                <div class="lb-nav">
                  <button type="button" class="sc-btn micro" (click)="startAnnotate()">
                    ✎ {{ 'feedbackAttachments.annotate' | translate }}
                  </button>
                </div>
              }
              <!-- Several screenshots on one message: page through them here
                   rather than closing the overlay for each one. -->
              @if (images().length > 1) {
                <div class="lb-nav">
                  <button
                    type="button"
                    class="lb-step"
                    (click)="step(-1)"
                    [attr.aria-label]="'feedbackAttachments.prev' | translate">
                    ‹
                  </button>
                  <span class="lb-count">
                    {{ 'feedbackAttachments.counter' | translate: { i: (index() ?? 0) + 1, n: images().length } }}
                  </span>
                  <button
                    type="button"
                    class="lb-step"
                    (click)="step(1)"
                    [attr.aria-label]="'feedbackAttachments.next' | translate">
                    ›
                  </button>
                </div>
              }
            }
          </div>
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }

    /* One thumbnail size for every surface an image can show up in — thread
       message, workflow view, author channel and the composer alike. */
    :host { --att-size: 72px; }

    .att-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 2px;
    }
    .att-chip { position: relative; line-height: 0; }
    .att-thumb {
      display: block;
      width: var(--att-size);
      height: var(--att-size);
      padding: 0;
      margin: 0;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--sc-bg-1);
      cursor: zoom-in;
    }
    .att-thumb:hover { border-color: var(--sc-accent); }
    .att-thumb:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .att-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

    /* Non-image attachment (admins only, see the composer): same box, but it
       says what it is instead of showing a picture. */
    .att-file {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 4px;
      box-sizing: border-box;
      text-decoration: none;
      color: var(--sc-fg-1);
      cursor: pointer;
      line-height: 1.15;
    }
    .af-ext {
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--sc-accent);
      text-transform: uppercase;
    }
    .af-name {
      width: 100%;
      font-size: max(0.6rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* "Add" tiles — a pseudo-thumbnail, so the row is one control. */
    .att-add, .att-capture {
      display: flex;
      align-items: center;
      justify-content: center;
      border-style: dashed;
      color: var(--sc-fg-2);
      cursor: pointer;
    }
    .att-add:hover, .att-capture:hover:not(:disabled) { color: var(--sc-accent); border-color: var(--sc-accent); }
    .att-capture:disabled { cursor: progress; opacity: 0.7; }
    .tile-glyph { display: inline-flex; align-items: center; justify-content: center; font-size: 1.6rem; line-height: 1; }
    .tile-glyph.spin { animation: att-spin 1s linear infinite; }
    @keyframes att-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .tile-glyph.spin { animation: none; } }

    /* Composer-only remove badge (removable), sitting on the thumbnail. */
    .att-remove {
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
      font-size: max(0.62rem, var(--sc-fs-floor));
      line-height: 1;
      cursor: pointer;
    }
    .att-remove:hover { background: rgba(0, 0, 0, 0.85); }
    .att-remove:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }

    .lb-backdrop {
      position: fixed; inset: 0; z-index: 1300;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.78);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      cursor: zoom-out;
    }
    .lb-frame {
      position: relative;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      max-width: 90vw; max-height: 90vh;
      cursor: default;
    }
    .lb-stage { position: relative; line-height: 0; }
    .lb-img {
      max-width: 90vw;
      max-height: 72vh;
      object-fit: contain;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      background: var(--sc-bg-1);
    }
    /* The drawing surface sits exactly on the picture; touch-action:none
       is what makes a finger draw instead of scrolling the page under it. */
    .lb-draw {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border-radius: 8px;
      touch-action: none;
      cursor: crosshair;
    }
    .lb-caption {
      margin: 0;
      color: var(--sc-fg-2);
      font-size: 0.8rem;
      text-align: center;
      max-width: 90vw;
    }
    .lb-err {
      margin: 0;
      color: var(--sc-danger);
      font-size: max(0.78rem, var(--sc-fs-floor));
      text-align: center;
    }
    .lb-close {
      position: absolute; top: -14px; right: -14px;
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; padding: 0;
      border: 1px solid var(--sc-border); border-radius: 50%;
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      font-size: 0.85rem; line-height: 1; cursor: pointer;
    }
    .lb-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    .lb-tools {
      display: flex; align-items: center; justify-content: center;
      flex-wrap: wrap; gap: 6px;
      padding: 6px 8px;
      border: 1px solid var(--sc-border); border-radius: 999px;
      background: var(--sc-bg-1);
    }
    .lb-tool {
      display: inline-flex; align-items: center; justify-content: center;
      /* 44px is the touch floor; the mobile gate measures a hair less than the
         declared size when animations overlap, so 48 is what actually passes. */
      min-width: 48px; height: 48px; padding: 0 10px;
      border: 1px solid var(--sc-border); border-radius: 999px;
      background: transparent; color: var(--sc-fg-1);
      font-size: 1.1rem; line-height: 1; cursor: pointer;
    }
    .lb-tool:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); }
    .lb-tool.on { border-color: var(--sc-accent); color: var(--sc-accent); background: rgba(0, 212, 255, 0.12); }
    .lb-tool:disabled { opacity: 0.45; cursor: default; }
    .lb-swatch {
      width: 48px; height: 48px; padding: 0;
      border: 2px solid transparent; border-radius: 50%;
      cursor: pointer;
    }
    .lb-swatch.on { border-color: var(--sc-fg-0); box-shadow: 0 0 0 2px var(--sc-bg-1); }
    .lb-sep { width: 1px; height: 26px; background: var(--sc-border); }

    .lb-nav { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .lb-step {
      display: inline-flex; align-items: center; justify-content: center;
      width: 48px; height: 48px; padding: 0;
      border: 1px solid var(--sc-border); border-radius: 50%;
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      font-size: 1rem; line-height: 1; cursor: pointer;
    }
    .lb-step:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .lb-count { color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
    .sc-btn.micro { padding: 8px 14px; font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.04em; min-height: 48px; }
||||||| 7ab7107

    /* A screenshot is the single most common thing in a feedback thread, so on a
       phone it gets the screen (admin feedback 3bc01a3d). Two things change:
       the 16px backdrop inset shrinks to 8, and the close button comes INSIDE
       the frame. Hung at -14px it sat in the backdrop's own padding — which is
       fine at 1280px and is 6px from the edge of a 375px screen, i.e. under the
       thumb's own edge-swipe zone and, on a tall image, under the status bar. */
    @media (max-width: 720px) {
      .lb-backdrop { padding: 8px; }
      .lb-img { max-width: calc(100vw - 16px); max-height: 76vh; }
      .lb-caption { max-width: calc(100vw - 16px); }
      .lb-close {
        top: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.62);
        border-color: color-mix(in srgb, var(--sc-fg-0) 35%, transparent);
        color: var(--sc-fg-0);
      }
    }
  `],
})
export class FeedbackAttachmentsComponent {
  /** Images lifted out of the message body, in source order. */
  readonly images = input<readonly AttachmentChip[]>([]);
  /** Show a remove badge per thumbnail — the composer's pending strip. */
  readonly removable = input(false);
  /** Translation key for the row's aria-label, so callers can name the strip. */
  readonly labelKey = input('feedbackAttachments.label');
  /** Render the "+" tile that opens the file picker (composer only). */
  readonly addTile = input(false);
  /** i18n key for the "+" tile — it names what may be attached, per role. */
  readonly addLabelKey = input('feedbackAttachments.addImage');
  /** Render the "capture this page" tile next to it (composer only). */
  readonly captureTile = input(false);
  /** A capture is running — the tile spins and refuses a second press. */
  readonly capturing = input(false);
  /** Offer mark-up in the enlarged view (composer only). */
  readonly editable = input(false);

  /** Index of the thumbnail whose remove badge was pressed. */
  readonly remove = output<number>();
  /** The "+" tile was pressed. */
  readonly add = output<void>();
  /** The capture tile was pressed. */
  readonly capture = output<void>();
  /** An image was marked up and saved — new bytes for the given row index. */
  readonly annotate = output<AnnotationResult>();

  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly lightboxTpl = viewChild.required<TemplateRef<unknown>>('lightboxTpl');

  readonly tools: readonly AnnotationTool[] = ['rect', 'arrow', 'pen'];
  readonly colors = ANNOTATION_COLORS;

  /** Index of the enlarged image, or null while the lightbox is closed. */
  readonly index = signal<number | null>(null);
  /** The enlarged image, or null while the lightbox is closed. */
  readonly current = computed<AttachmentChip | null>(() => {
    const i = this.index();
    return i === null ? null : (this.images()[i] ?? null);
  });

  /** Mark-up mode is on (the canvas is live and paging is suspended). */
  readonly annotating = signal(false);
  readonly tool = signal<AnnotationTool>('rect');
  readonly color = signal<string>(ANNOTATION_COLORS[0]);
  readonly shapes = signal<AnnotationShape[]>([]);
  readonly savingAnnotation = signal(false);
  readonly annotateError = signal<string | null>(null);

  private ref: OverlayRef | null = null;
  /** Thumbnail that opened the lightbox — focus goes back there on close. */
  private opener: HTMLElement | null = null;
  /** Natural size of the enlarged image, the coordinate space of the shapes. */
  private natural: { w: number; h: number } = { w: 0, h: 0 };
  private drafting: AnnotationShape | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** The row exists as soon as there is anything in it — chips or add tiles. */
  readonly showRow = computed(
    () => this.images().length > 0 || this.addTile() || this.captureTile(),
  );

  /** Uppercase extension shown on a file chip; "FILE" when there is none. */
  extOf(name: string): string {
    const dot = (name || '').lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1) : '';
    return (ext || 'file').slice(0, 5);
  }

  /** Move `delta` images along, wrapping at both ends. */
  step(delta: number): void {
    const count = this.images().length;
    const i = this.index();
    if (count === 0 || i === null) return;
    this.index.set((i + delta + count) % count);
    this.resetAnnotation();
  }

  open(index: number): void {
    if (!this.images()[index]) return;
    this.index.set(index);
    this.resetAnnotation();
    if (this.ref) return;

    const active = document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;

    const ref = this.overlay.create({
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
    });
    ref.attach(new TemplatePortal(this.lightboxTpl(), this.viewContainer));
    // ESC via the overlay's keyboard dispatcher rather than a document
    // listener: a board renders one of these per message, and only the
    // top-most open overlay should react.
    ref.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') {
        // While drawing, ESC backs out of mark-up first — losing the marks AND
        // the enlarged view on one keypress is a trap.
        if (this.annotating()) this.cancelAnnotate();
        else this.close();
      } else if (!this.annotating() && e.key === 'ArrowRight') this.step(1);
      else if (!this.annotating() && e.key === 'ArrowLeft') this.step(-1);
    });
    this.ref = ref;

    const close = ref.overlayElement.querySelector<HTMLElement>('.lb-close');
    close?.focus();
  }

  /** Backdrop click closes — except mid-mark-up, where it would discard work. */
  onBackdrop(): void {
    if (this.annotating()) return;
    this.close();
  }

  close(): void {
    this.index.set(null);
    this.resetAnnotation();
    this.ref?.dispose();
    this.ref = null;
    this.opener?.focus();
    this.opener = null;
  }

  // ---- Annotation --------------------------------------------------------

  private resetAnnotation(): void {
    this.annotating.set(false);
    this.shapes.set([]);
    this.drafting = null;
    this.savingAnnotation.set(false);
    this.annotateError.set(null);
  }

  startAnnotate(): void {
    if (!this.editable()) return;
    this.shapes.set([]);
    this.annotateError.set(null);
    this.annotating.set(true);
    // The canvas only exists after the template re-renders for the new mode.
    setTimeout(() => this.syncCanvas());
  }

  cancelAnnotate(): void {
    this.annotating.set(false);
    this.shapes.set([]);
    this.drafting = null;
    this.annotateError.set(null);
  }

  undo(): void {
    this.shapes.update((list) => list.slice(0, -1));
    this.redraw();
  }

  /** Remember the source resolution — the shapes live in those coordinates. */
  onImageLoad(e: Event): void {
    const img = e.target as HTMLImageElement;
    this.natural = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    if (this.annotating()) this.syncCanvas();
  }

  onDrawStart(e: PointerEvent): void {
    const canvas = this.canvasEl();
    if (!canvas) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    const p = this.toImagePoint(e, canvas);
    this.drafting = {
      tool: this.tool(),
      color: this.color(),
      width: strokeWidthFor(this.natural.w, this.natural.h),
      points: [p],
    };
    this.redraw();
  }

  onDrawMove(e: PointerEvent): void {
    const canvas = this.canvasEl();
    if (!canvas || !this.drafting) return;
    e.preventDefault();
    const p = this.toImagePoint(e, canvas);
    const pts = this.drafting.points;
    // rect/arrow only ever need their two corners; the pen keeps the whole path.
    this.drafting = {
      ...this.drafting,
      points: this.drafting.tool === 'pen' ? [...pts, p] : [pts[0], p],
    };
    this.redraw();
  }

  onDrawEnd(e: PointerEvent): void {
    if (!this.drafting) return;
    e.preventDefault();
    const shape = this.drafting;
    this.drafting = null;
    // A stray tap with a two-point tool leaves a zero-size box behind; drop it.
    const a = shape.points[0];
    const b = shape.points[shape.points.length - 1];
    const tiny = shape.tool !== 'pen' && Math.hypot(b.x - a.x, b.y - a.y) < 4;
    if (!tiny) this.shapes.update((list) => [...list, shape]);
    this.redraw();
  }

  async saveAnnotation(): Promise<void> {
    const img = this.current();
    const i = this.index();
    if (!img || i === null || this.shapes().length === 0) return;
    this.savingAnnotation.set(true);
    this.annotateError.set(null);
    try {
      const dataUrl = await exportAnnotated(img.src, this.shapes());
      this.annotate.emit({ index: i, dataUrl });
      this.annotating.set(false);
      this.shapes.set([]);
      this.close();
    } catch {
      // Almost always a cross-origin source that refused the CORS request, which
      // is a fact about the image, not something the user did wrong.
      this.annotateError.set('feedbackAttachments.annotateFailed');
    } finally {
      this.savingAnnotation.set(false);
    }
  }

  private canvasEl(): HTMLCanvasElement | null {
    return this.ref?.overlayElement.querySelector<HTMLCanvasElement>('canvas.lb-draw') ?? null;
  }

  /** Match the canvas backing store to the image and paint what exists. */
  private syncCanvas(): void {
    const canvas = this.canvasEl();
    if (!canvas) return;
    if (this.natural.w > 0 && this.natural.h > 0) {
      canvas.width = this.natural.w;
      canvas.height = this.natural.h;
    }
    this.redraw();
  }

  private redraw(): void {
    const canvas = this.canvasEl();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAnnotations(ctx, this.shapes());
    if (this.drafting) drawShape(ctx, this.drafting);
  }

  /** Screen coordinates -> image pixels, so the marks survive any zoom level. */
  private toImagePoint(e: PointerEvent, canvas: HTMLCanvasElement): AnnotationPoint {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
}
