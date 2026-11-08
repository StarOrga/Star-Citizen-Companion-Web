import { Injectable } from '@angular/core';

/** One component a loadout wants — what a future cart line is built from. */
export interface CartComponentRequest {
  /** Codex class name of the component. */
  readonly className: string;
  /** The slot it goes into, for the cart's "for which hardpoint" hint. */
  readonly portPath: string;
  readonly quantity: number;
}

/**
 * Seam for the "Komponenten in den Warenkorb" action (#322). There is no cart
 * yet: `available` is false, so the button renders disabled with a
 * "coming soon" hint, and `addComponents` refuses. When a cart lands, it
 * implements this service and flips `available` — the button needs no change.
 */
@Injectable({ providedIn: 'root' })
export class ComponentCartService {
  readonly available = false;

  /** Resolves to the number of lines added; 0 while no cart exists. */
  addComponents(items: readonly CartComponentRequest[]): Promise<number> {
    void items;
    return Promise.resolve(0);
  }
}
