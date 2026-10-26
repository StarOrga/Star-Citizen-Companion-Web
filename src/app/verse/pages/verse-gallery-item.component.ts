import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { OverlayFrameComponent, OverlayNeighbour } from '../../shared/overlay-frame/overlay-frame.component';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ShareButtonComponent } from '../../shared/share-button/share-button.component';
import { StarscapeService, Wallpaper } from '../../starscape/starscape.service';

/**
 * `/verse/gallery/:imageId` - one Starscape image. Over the gallery as an
 * overlay when opened from it, a full page on direct load / refresh / share.
 * Back closes; prev/next walk the loaded grid. (implement.md §9)
 */
@Component({
  selector: 'sc-verse-gallery-item',
  standalone: true,
  imports: [TranslatePipe, OverlayFrameComponent, ShareButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (wallpaper(); as w) {
      <sc-overlay-frame [heading]="w.title || ('overlay.gallery.image' | translate)" [prev]="prev()" [next]="next()" (closed)="close()">
        <figure class="fig">
          <picture>
            <source media="(max-width: 900px)" [srcset]="w.previewUrl" />
            <img [src]="w.sourceUrl" [alt]="w.title ?? ''" />
          </picture>
          @if (w.series) { <figcaption id="series">{{ w.series }}</figcaption> }
        </figure>
        <div class="acts">
          <a class="sc-btn primary" [href]="w.sourceUrl" target="_blank" rel="noopener noreferrer" download>
            {{ 'overlay.gallery.download' | translate }}
          </a>
          <a class="sc-btn" [href]="w.articleUrl" target="_blank" rel="noopener noreferrer">
            {{ 'overlay.gallery.article' | translate }} ↗
          </a>
        </div>
      </sc-overlay-frame>
      <sc-share-button [shareTitle]="w.title ?? 'Starscape'" />
    } @else if (missing()) {
      <p class="miss" role="status">{{ 'overlay.gallery.missing' | translate }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .fig { margin: 0; display: grid; gap: 8px; justify-items: center; }
    .fig picture { display: contents; }
    .fig img { max-width: 100%; max-height: 70vh; max-height: 70dvh; object-fit: contain; border-radius: 8px; }
    figcaption { color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
    .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .miss { color: var(--sc-fg-2); }
  `],
})
export class VerseGalleryItemComponent {
  private readonly svc = inject(StarscapeService);
  private readonly router = inject(Router);
  private readonly origin = inject(OverlayOriginService);

  /** Route param `:imageId` (component input binding). */
  readonly imageId = input.required<string>();

  private readonly fetched = signal<Wallpaper | null>(null);
  protected readonly missing = signal(false);

  protected readonly wallpaper = computed(
    () => this.svc.wallpapers().find((w) => w.imageId === this.imageId()) ?? this.fetched(),
  );

  protected readonly prev = computed<OverlayNeighbour | null>(() => this.neighbour(-1));
  protected readonly next = computed<OverlayNeighbour | null>(() => this.neighbour(1));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.origin.reset());
    // The image is often not on the first grid page (shared link): fetch it by id.
    effect(() => {
      const id = this.imageId();
      if (untracked(() => this.svc.wallpapers().some((w) => w.imageId === id))) return;
      this.missing.set(false);
      void this.svc.loadOne(id).then((w) => {
        this.fetched.set(w);
        this.missing.set(!w);
      });
    });
  }

  private neighbour(step: number): OverlayNeighbour | null {
    const list = this.svc.wallpapers();
    const i = list.findIndex((w) => w.imageId === this.imageId());
    const n = i < 0 ? undefined : list[i + step];
    return n ? { commands: ['/verse/gallery', n.imageId] } : null;
  }

  protected close(): void {
    this.origin.reset();
    void this.router.navigate(['/verse/gallery']);
  }
}
