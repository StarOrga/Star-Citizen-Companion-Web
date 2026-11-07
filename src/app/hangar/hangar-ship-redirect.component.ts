import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { HqOwnershipService } from '../hq/hq-ownership.service';
import { hqHangar, ownShipLink } from '../hq/hq-routes';
import { HangarService } from './hangar.service';

/**
 * `/hq/hangar/:id` - the old hangar detail page is gone ("die hangar detailseite sind alt").
 * Its functions live on the HQ hangar row (rename, notes, pin, variants, remove) and in the personal
 * Codex view (loadout, variants). Old links and bookmarks land here and are sent on: to the ship's
 * active variant in the Codex, or to the hangar list when the entry no longer exists.
 */
@Component({
  selector: 'sc-hangar-ship-redirect',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="wait" role="status">{{ 'hangar.detail.loading' | translate }}</p>`,
  styles: [`.wait { color: var(--sc-fg-2); margin: 0; }`],
})
export class HangarShipRedirectComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly auth = inject(AuthService);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (this.auth.user()) {
      await this.hangar.loadAll();
      await this.ownership.ensureLoaded();
    }
    const ship = this.hangar.ships().find((s) => s.id === id);
    if (!ship) {
      void this.router.navigate([hqHangar], { replaceUrl: true });
      return;
    }
    const link = ownShipLink(ship, this.ownership.configsForShip(ship.id));
    void this.router.navigate(link.commands, { queryParams: link.queryParams, replaceUrl: true });
  }
}
