import { DestroyRef, Injectable, Signal, signal } from '@angular/core';

/** What a page hands the view FAB: which view is on and how to switch. */
export interface PageViewToggle {
  /** true = Holotisch, false = Klassisch. */
  readonly holo: Signal<boolean>;
  readonly toggle: () => void;
}

/** What a page hands the share FAB: the URL that captures its whole state, optionally its own popover. */
export interface PageShare {
  readonly url: () => string;
  /** The page shows its own share popover (ship page: link + save & share, #645) instead of a direct share. */
  readonly open?: (trigger: HTMLElement) => void;
  /** Whether that popover is open (aria-expanded on the FAB). */
  readonly expanded?: Signal<boolean>;
}

/**
 * The bottom-right corner belongs to the shell (launcher, β, view toggle, share), but two of its
 * buttons act for the page on screen: a ship page registers its Klassisch | Holotisch switch and
 * its share URL while it lives (concept codex-kopf-besitz, C4/C9). Nothing registered = the
 * view FAB is not drawn and the share FAB shares URL + section anchor.
 */
@Injectable({ providedIn: 'root' })
export class PageCornerService {
  private readonly viewReg = signal<PageViewToggle | null>(null);
  private readonly shareReg = signal<PageShare | null>(null);
  readonly view = this.viewReg.asReadonly();
  readonly share = this.shareReg.asReadonly();

  /** Registers (or with `null` withdraws) the page's view switch; withdrawn with `owner` too. */
  setView(reg: PageViewToggle | null, owner?: DestroyRef): void {
    this.viewReg.set(reg);
    if (reg && owner) owner.onDestroy(() => this.viewReg() === reg && this.viewReg.set(null));
  }

  setShare(reg: PageShare | null, owner?: DestroyRef): void {
    this.shareReg.set(reg);
    if (reg && owner) owner.onDestroy(() => this.shareReg() === reg && this.shareReg.set(null));
  }

  /** Withdraws only what this page registered (a newer page may already own the corner). */
  release(view: PageViewToggle | null, share: PageShare | null): void {
    if (view && this.viewReg() === view) this.viewReg.set(null);
    if (share && this.shareReg() === share) this.shareReg.set(null);
  }
}
