import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HangarService } from './hangar.service';

/** Where a shared link opens on the Holotable, read-only (#646). */
export function holoSharedLink(shipClassName: string, token: string): { commands: string[]; queryParams: Record<string, string> } {
  return { commands: ['/codex', 'ship', shipClassName], queryParams: { view: 'holo', shared: token } };
}

/** Where an adopted (or any own) config opens as the Holotable's draft (#646). */
export function holoConfigLink(shipClassName: string, configId: string): { commands: string[]; queryParams: Record<string, string> } {
  return { commands: ['/codex', 'ship', shipClassName], queryParams: { view: 'holo', config: configId } };
}

/**
 * "Adopt" a shared loadout and land on it (#646): the adopt RPC may add the
 * ship to the hangar, so the hangar list is reloaded BEFORE the Codex page
 * opens — otherwise the page would still think the ship is not the reader's
 * — and the page opens with `?config=<id>`, so the adopted config is the
 * draft on the table instead of the stock loadout.
 *
 * Shared by the `/hangar/shared/:token` landing page and the Holotable's
 * read-only banner.
 */
@Injectable({ providedIn: 'root' })
export class SharedLoadoutAdopter {
  private readonly hangar = inject(HangarService);
  private readonly router = inject(Router);

  /** False when the adopt failed (`HangarService.error` carries the reason). */
  async adoptAndOpen(token: string, shipClassName: string): Promise<boolean> {
    const adopted = await this.hangar.adoptSharedLoadout(token);
    if (!adopted) return false;
    await this.hangar.loadAll();
    const link = holoConfigLink(shipClassName, adopted.id);
    await this.router.navigate(link.commands, { queryParams: link.queryParams });
    return true;
  }
}
