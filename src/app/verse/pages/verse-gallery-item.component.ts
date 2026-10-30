import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LightboxComponent } from '../../shared/lightbox/lightbox.component';
import { OverlayNeighbour } from '../../shared/overlay-frame/overlay-frame.component';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ShareButtonComponent } from '../../shared/share-button/share-button.component';
import { StarscapeService, Wallpaper } from '../../starscape/starscape.service';

/**
 * `/verse/gallery/:imageId` - one Starscape image. Over the gallery as an
 * overlay when opened from it, a full page on direct load / refresh / share.
 * Back closes (close = history back when it came from the list); prev/next replace the entry and walk the loaded grid. (implement.md §9)
 */
@Component({
  selector: 'sc-verse-gallery-item',
  standalone: true,
  imports: [TranslatePipe, LightboxComponent, ShareButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (wallpaper(); as w) {
      <sc-lightbox [image]="w" [prev]="prev()" [next]="next()" [overlay]="overlaid()" (closed)="close()" />
      <!-- The takeover covers the floating share button; it belongs to the page mode. -->
      @if (!overlaid()) { <sc-share-button [shareTitle]="w.title ?? 'Starscape'" /> }
    } @else if (missing()) {
      <p class="miss" role="status">{{ 'overlay.gallery.missing' | translate }}</p>
    }
  `,
  // overlay-size: exception — the image drives the size (sc-lightbox, centred both ways)
  styles: [`
    :host { display: block; }
    .miss { color: var(--sc-fg-2); }
  `],
})
export class VerseGalleryItemComponent {
  private readonly svc = inject(StarscapeService);
  private readonly origin = inject(OverlayOriginService);

  /** Route param `:imageId` (component input binding). */
  readonly imageId = input.required<string>();

  private readonly fetched = signal<Wallpaper | null>(null);
  protected readonly missing = signal(false);
  protected readonly overlaid = this.origin.overlaid;

  protected readonly wallpaper = computed(
    () => this.svc.wallpapers().find((w) => w.imageId === this.imageId()) ?? this.fetched(),
  );

  protected readonly prev = computed<OverlayNeighbour | null>(() => this.neighbour(-1));
  protected readonly next = computed<OverlayNeighbour | null>(() => this.neighbour(1));

  constructor() {
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
    this.origin.close(['/verse/gallery']);
  }
}
