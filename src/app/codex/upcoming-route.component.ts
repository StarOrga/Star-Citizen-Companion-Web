import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChildRouteService } from '../shared/overlay-frame/child-route.service';
import { OverlayOriginService } from '../shared/overlay-frame/overlay-origin.service';
import { CodexListComponent } from './codex-list.component';

/**
 * `/codex/upcoming` with the `shell` beta on: the list stays a tool page and
 * `/codex/upcoming/:id` is a routed child - an overlay over the list when it
 * was opened from a card, a full page on a direct load (implement.md §9/§12,
 * same pattern as `/verse/news/:id`).
 */
@Component({
  selector: 'sc-upcoming-route',
  standalone: true,
  imports: [CodexListComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!child.active() || origin.overlaid()) {
      <sc-codex-list />
    }
    <router-outlet />
  `,
  styles: [`:host { display: block; }`],
})
export class UpcomingRouteComponent {
  readonly origin = inject(OverlayOriginService);
  readonly child = inject(ChildRouteService).track();
}
