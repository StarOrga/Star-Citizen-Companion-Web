import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ChildRouteService } from '../../shared/overlay-frame/child-route.service';
import { TranslatePipe } from '@ngx-translate/core';
import { NewsListComponent } from '../../news/news-list.component';
import { BetaService } from '../../core/beta.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';

/**
 * `/verse/news` — the Verse News stream under the uniform Verse subheader.
 * The stream's stage headline stays the page's `<h1>`, so the header carries
 * only crumbs, eyebrow and the status instrument. β off: the bare legacy list.
 */
@Component({
  selector: 'sc-verse-news',
  // Subpages sit in the page frame; only the hub runs edge to edge (concept 2026-10-28).
  host: { class: 'sc-track-page' },
  standalone: true,
  imports: [TranslatePipe, RouterOutlet, VerseHeaderComponent, NewsListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header planet="news" [title]="'verse.area.news' | translate" [subtitle]="'verse.frame.newsSub' | translate" />
    }
    <!-- Shell beta: a direct load of /verse/news/:id is a full page, so the stream
         only stays underneath while the item is an overlay. -->
    @if (!enabledShell() || !child.active() || origin.overlaid()) {
      <sc-news-list />
    }
    <router-outlet />
  `,
  styles: [`:host { display: block; }`],
})
export class VerseNewsComponent {
  readonly enabled = inject(BetaService).isEnabled('verse');
  readonly enabledShell = inject(BetaService).isEnabled('shell');
  readonly origin = inject(OverlayOriginService);
  readonly child = inject(ChildRouteService).track();
}
