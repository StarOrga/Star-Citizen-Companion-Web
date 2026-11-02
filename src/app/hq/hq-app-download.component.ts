import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';

/**
 * The SCC-App download for the HQ pages that only fill once the app reads the game (Jetzt,
 * Statistik): the never-stale installer alias, a public download in the normal accent. Hidden on
 * a device that cannot install a Windows application (same rule as the status chip's download).
 */
@Component({
  selector: 'sc-hq-app-download',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canInstall()) {
      <a class="sc-btn dl" [href]="url" target="_blank" rel="noopener noreferrer" download>
        <span aria-hidden="true">↓</span> {{ 'hq.app.download' | translate }}
      </a>
    }
  `,
  styles: [
    `
      :host { display: flex; }
      /* Only Angular's comment anchors left (cannot install): take no room. */
      :host:empty { display: none; }
      .dl { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: var(--sc-tap-min, 44px); text-decoration: none; }
    `,
  ],
})
export class HqAppDownloadComponent {
  readonly canInstall = inject(DesktopCapabilityService).canInstall;
  readonly url = SCC_INSTALLER_URL;
}
