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
    @if (images().length > 0) {
      <div class="att-row" [attr.aria-label]="labelKey() | translate">
        @for (img of images(); track $index) {
          <!-- Chip wrapper, not a nested button: the remove control has to sit
               on top of the thumbnail without living inside its <button>. -->
          <div class="att-chip">
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
      </div>
    }

    <!-- Enlarged view (CDK overlay, portaled to <body>). -->
    <ng-template #lightboxTpl>
      @if (current(); as img) {
        <div class="lb-backdrop" (click)="close()">
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
            <img
              class="lb-img"
              [src]="img.src"
              [alt]="img.alt || ('feedbackAttachments.image' | translate)" />
            @if (img.alt) {
              <p class="lb-caption">{{ img.alt }}</p>
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
      font-size: 0.62rem;
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
    .lb-img {
      max-width: 90vw;
      max-height: 84vh;
      object-fit: contain;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      background: var(--sc-bg-1);
    }
    .lb-caption {
      margin: 0;
      color: var(--sc-fg-2);
      font-size: 0.8rem;
      text-align: center;
      max-width: 90vw;
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

    .lb-nav { display: flex; align-items: center; gap: 10px; }
    .lb-step {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0;
      border: 1px solid var(--sc-border); border-radius: 50%;
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      font-size: 1rem; line-height: 1; cursor: pointer;
    }
    .lb-step:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .lb-count { color: var(--sc-fg-2); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  `],
})
export class FeedbackAttachmentsComponent {
  /** Images lifted out of the message body, in source order. */
  readonly images = input<readonly FeedbackImage[]>([]);
  /** Show a remove badge per thumbnail — the composer's pending strip. */
  readonly removable = input(false);
  /** Translation key for the row's aria-label, so callers can name the strip. */
  readonly labelKey = input('feedbackAttachments.label');
  /** Index of the thumbnail whose remove badge was pressed. */
  readonly remove = output<number>();

  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly lightboxTpl = viewChild.required<TemplateRef<unknown>>('lightboxTpl');

  /** Index of the enlarged image, or null while the lightbox is closed. */
  readonly index = signal<number | null>(null);
  /** The enlarged image, or null while the lightbox is closed. */
  readonly current = computed<FeedbackImage | null>(() => {
    const i = this.index();
    return i === null ? null : (this.images()[i] ?? null);
  });
  private ref: OverlayRef | null = null;
  /** Thumbnail that opened the lightbox — focus goes back there on close. */
  private opener: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Move `delta` images along, wrapping at both ends. */
  step(delta: number): void {
    const count = this.images().length;
    const i = this.index();
    if (count === 0 || i === null) return;
    this.index.set((i + delta + count) % count);
  }

  open(index: number): void {
    if (!this.images()[index]) return;
    this.index.set(index);
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
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'ArrowLeft') this.step(-1);
    });
    this.ref = ref;

    const close = ref.overlayElement.querySelector<HTMLElement>('.lb-close');
    close?.focus();
  }

  close(): void {
    this.index.set(null);
    this.ref?.dispose();
    this.ref = null;
    this.opener?.focus();
    this.opener = null;
  }
}
