import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { NotFoundComponent } from '../../shared/not-found/not-found.component';
import type { PageCrumb } from '../../shared/page-header/nav-origin.service';
import { LightboxComponent } from '../../shared/lightbox/lightbox.component';
import { OverlayNeighbour } from '../../shared/overlay-frame/overlay-frame.component';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ShareButtonComponent } from '../../shared/share-button/share-button.component';
import { StarscapeService, Wallpaper } from '../../starscape/starscape.service';
import { StarscapeVoteButtonComponent } from '../../starscape/starscape-vote-button.component';
import { StarscapeVotesService } from '../../starscape/starscape-votes.service';

/**
 * `/verse/gallery/:imageId` - one Starscape image. Over the gallery as an
 * overlay when opened from it, a full page on direct load / refresh / share.
 * Back closes (close = history back when it came from the list); prev/next replace the entry and walk the loaded grid. (implement.md §9)
 */
@Component({
  selector: 'sc-verse-gallery-item',
  standalone: true,
  imports: [TranslatePipe, NotFoundComponent, ScActionDirective, LightboxComponent, ShareButtonComponent, StarscapeVoteButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (wallpaper(); as w) {
      <sc-lightbox [image]="w" [prev]="prev()" [next]="next()" [overlay]="overlaid()" (closed)="close()">
        <!-- The same upvote as on the list tile (one component, one service); rides the lightbox's bottom-right slot, in page, overlay and fullscreen. -->
        <sc-vote-button [imageId]="w.imageId" />
      </sc-lightbox>
      <!-- The takeover covers the floating share button; it belongs to the page mode. -->
      @if (!overlaid()) { <sc-share-button [shareTitle]="w.title ?? 'Starscape'" /> }
    } @else if (failed()) {
      <div class="sc-card err" role="alert">
        <span>{{ 'overlay.gallery.loadFailed' | translate }}</span>
        <button scAction tier="secondary" type="button" (click)="retry()">{{ 'errors.retry' | translate }}</button>
      </div>
    } @else if (missing()) {
      <sc-not-found titleKey="overlay.gallery.notFoundTitle" bodyKey="overlay.gallery.missing" [back]="galleryCrumb" [level]="overlaid() ? 2 : 1" />
    }
  `,
  // overlay-size: exception — the image drives the size (sc-lightbox, centred both ways)
  styles: [`
    :host { display: block; }
    .err { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  `],
})
export class VerseGalleryItemComponent {
  private readonly svc = inject(StarscapeService);
  private readonly origin = inject(OverlayOriginService);
  private readonly votes = inject(StarscapeVotesService);

  /** Route param `:imageId` (component input binding). */
  readonly imageId = input.required<string>();

  private readonly fetched = signal<Wallpaper | null>(null);
  protected readonly missing = signal(false);
  protected readonly failed = signal(false);
  private readonly retryTick = signal(0);
  protected readonly galleryCrumb: PageCrumb = { labelKey: 'verse.area.gallery', link: '/verse/gallery' };
  protected readonly overlaid = this.origin.overlaid;

  protected readonly wallpaper = computed(
    () => this.svc.wallpapers().find((w) => w.imageId === this.imageId()) ?? this.fetched(),
  );

  protected readonly prev = computed<OverlayNeighbour | null>(() => this.neighbour(-1));
  protected readonly next = computed<OverlayNeighbour | null>(() => this.neighbour(1));

  constructor() {
    // A direct load / shared link never went through the grid, so the tally and own-vote flag are fetched here.
    effect(() => {
      const w = this.wallpaper();
      if (w) void this.votes.syncCounts([w.imageId]);
    });
    // The image is often not on the first grid page (shared link): fetch it by id.
    effect(() => {
      const id = this.imageId();
      this.retryTick();
      if (untracked(() => this.svc.wallpapers().some((w) => w.imageId === id))) return;
      this.missing.set(false);
      this.failed.set(false);
      void this.svc.fetchOne(id).then((w) => {
        if (id !== untracked(() => this.imageId())) return;
        this.failed.set(w === 'error');
        this.fetched.set(w === 'error' ? null : w);
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

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  protected close(): void {
    this.origin.close(['/verse/gallery']);
  }
}
