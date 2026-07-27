import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  ViewContainerRef,
  inject,
  input,
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
 * The enlarged view is portaled to <body> through a CDK overlay rather than
 * rendered in place: feedback bodies live inside fixed, scrollable panels whose
 * stacking and overflow would otherwise clip it. Same mechanism as the news
 * detail view.
 */
@Component({
  selector: 'sc-feedback-attachments',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (images().length > 0) {
      <div class="att-row" [attr.aria-label]="'feedbackAttachments.label' | translate">
        @for (img of images(); track $index) {
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
          </div>
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }

    .att-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 2px;
    }
    .att-thumb {
      display: block;
      width: 72px;
      height: 72px;
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
  `],
})
export class FeedbackAttachmentsComponent {
  /** Images lifted out of the message body, in source order. */
  readonly images = input<readonly FeedbackImage[]>([]);

  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly lightboxTpl = viewChild.required<TemplateRef<unknown>>('lightboxTpl');

  /** The enlarged image, or null while the lightbox is closed. */
  readonly current = signal<FeedbackImage | null>(null);
  private ref: OverlayRef | null = null;
  /** Thumbnail that opened the lightbox — focus goes back there on close. */
  private opener: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  open(index: number): void {
    const img = this.images()[index];
    if (!img) return;
    this.current.set(img);
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
    });
    this.ref = ref;

    const close = ref.overlayElement.querySelector<HTMLElement>('.lb-close');
    close?.focus();
  }

  close(): void {
    this.current.set(null);
    this.ref?.dispose();
    this.ref = null;
    this.opener?.focus();
    this.opener = null;
  }
}
