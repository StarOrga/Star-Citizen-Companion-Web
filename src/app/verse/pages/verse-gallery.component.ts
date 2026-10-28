import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { OverlayOriginService } from '../../shared/overlay-frame/overlay-origin.service';
import { ChildRouteService } from '../../shared/overlay-frame/child-route.service';
import { TranslatePipe } from '@ngx-translate/core';
import { AppNoticeComponent } from '../../desktop/app-notice.component';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { StarscapeComponent } from '../../starscape/starscape.component';
import { BetaService } from '../../core/beta.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';

/**
 * `/verse/gallery` — the Starscape gallery under the shared subpage head. The
 * app download lives in the header apps menu; a Starscape notice (3 s on the
 * page, snoozable) offers it here. Every image carries a share button. β off:
 * the bare legacy gallery.
 */
@Component({
  selector: 'sc-verse-gallery',
  standalone: true,
  imports: [RouterLink, RouterOutlet, TranslatePipe, VerseHeaderComponent, StarscapeComponent, AppNoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [hidden]="hideList()">
    @if (enabled()) {
      <sc-verse-header planet="gallery" [title]="'verse.area.gallery' | translate" [subtitle]="'starscape.subtitle' | translate">
        @if (connected()) {
          <ng-container vhActions>
            <span class="pill"><span class="dot" aria-hidden="true"></span>{{ 'verse.gallery.connected' | translate }}</span>
            <button type="button" class="sub-link" (click)="shareGallery()">{{ 'verse.gallery.share' | translate }}</button>
          </ng-container>
        }
        <a vhActions class="sub-link" routerLink="/verse/gallery/constellations">{{ 'verse.gallery.mine' | translate }}</a>
      </sc-verse-header>

      @if (hint(); as h) { <p class="hint sc-enter" role="status">{{ h | translate }}</p> }

      <sc-starscape class="sc-enter" style="--sc-enter-i: 2" [embedded]="true" />
      <sc-app-notice app="starscape" />
    } @else {
      <sc-starscape />
    }
    </div>
    <router-outlet />
  `,
  styles: [`
    :host { display: block; }
    .sub-link {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min); padding: 0 12px;
      border-radius: 999px; border: 1px solid var(--sc-border); color: var(--sc-fg-1); text-decoration: none;
    }
    .sub-link:hover, .sub-link:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); text-decoration: none; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-1);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-success); }
    button.sub-link { background: none; font: inherit; cursor: pointer; }
    .hint { margin: 0 0 12px; color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor)); }
  `],
})
export class VerseGalleryComponent {
  private readonly connections = inject(DesktopConnectionService);
  readonly enabled = inject(BetaService).isEnabled('verse');
  private readonly shell = inject(BetaService).isEnabled('shell');
  private readonly origin = inject(OverlayOriginService);
  private readonly child = inject(ChildRouteService).track();
  /** Shell beta: a direct load of /verse/gallery/:imageId is a full page - the grid stays only under an overlay. */
  readonly hideList = computed(() => this.shell() && this.child.active() && !this.origin.overlaid());
  
  readonly connected = computed(() => {
    this.connections.connections();
    return this.connections.stateFor('starscape') === 'connected';
  });
  readonly hint = signal<string | null>(null);

  constructor() {
    void this.connections.refresh();
  }

  async shareGallery(): Promise<void> {
    const url = `${location.origin}/verse/gallery`;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: 'Starscape', url });
      } catch {
        /* dismissed */
      }
      return;
    }
    try {
      await nav!.clipboard.writeText(url);
      this.hint.set('starscape.share.copied');
    } catch {
      this.hint.set('starscape.share.failed');
    }
  }
}
