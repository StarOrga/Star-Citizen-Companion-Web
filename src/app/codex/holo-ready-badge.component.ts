import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ShowroomService } from './showroom.service';

/**
 * "Holo-Ready" signpost: a small glyph shown on a ship card/detail when that ship
 * has >=1 interactive 3D livery in the Showroom. Reads the shared ShowroomService
 * discovery cache (loads it once); renders nothing for ships without a model, so
 * it can never look broken on the 312 ships without coverage.
 */
@Component({
  selector: 'sc-holo-ready-badge',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isReady()) {
      <span class="holo-badge" [attr.title]="'codex.skins.holoReady' | translate"
            [attr.aria-label]="'codex.skins.holoReady' | translate">
        <span class="holo-glyph" aria-hidden="true">◈</span>
        {{ 'codex.skins.holoReadyShort' | translate }}
      </span>
    }
  `,
  styles: [`
    .holo-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 999px;
      font-family: var(--sc-font-display); font-size: 0.62rem; letter-spacing: 0.08em;
      text-transform: uppercase; white-space: nowrap;
      color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
    }
    .holo-glyph { font-size: 0.78rem; line-height: 1; text-shadow: 0 0 6px var(--sc-accent); }
  `],
})
export class HoloReadyBadgeComponent {
  private readonly showroom = inject(ShowroomService);
  readonly shipId = input.required<string>();

  constructor() {
    // Fire-and-forget: fill the shared discovery cache if a consumer renders the
    // badge before the Showroom route has loaded it. Cheap (tiny view).
    if (this.showroom.entries().length === 0) void this.showroom.load();
  }

  readonly isReady = computed(() => this.showroom.modelShipIds().has(this.shipId()));
}
