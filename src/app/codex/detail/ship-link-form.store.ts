import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ShipLinkService } from '../ship-link.service';

/**
 * State of the "pin your own RSI pledge link" form (feedback f7d3bd9a) of the
 * codex detail page, lifted out of codex-detail (AUD-090).
 *
 * Provided by CodexDetailComponent itself (not providedIn root): the classic
 * view and the Holotable drawer are both declared in that component's
 * template, so the projected drawer content resolves the SAME instance, and
 * switching views keeps an open form open, as before.
 *
 * The catalog has no dependable per-ship RSI store slug, so the user may pin
 * the real pledge page. Their link is PRIVATE (owner-only RLS); a globally
 * promoted link is admin-curated. Own link wins so a user's correction always
 * beats the catalog-wide one. The typed value is validated client-side for a
 * fast, friendly error, but the ship-link edge function is the authority and
 * re-validates everything.
 */
@Injectable()
export class ShipLinkFormStore {
  private readonly shipLinks = inject(ShipLinkService);

  /** The open ship's class name, or null on any other kind. Set by connect(). */
  private slugSource: Signal<string | null> = signal<string | null>(null);

  readonly open = signal(false);
  readonly input = signal('');
  /** i18n key suffix under codex.shipLink.error.*, or null. */
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  /** A write is in flight (shared with the service). */
  readonly saving = this.shipLinks.saving;

  readonly myPledgeLink = computed(() => {
    const slug = this.slugSource();
    return slug ? (this.shipLinks.myLinks().get(slug) ?? null) : null;
  });
  readonly globalPledgeLink = computed(() => {
    const slug = this.slugSource();
    return slug ? (this.shipLinks.globalLinks().get(slug) ?? null) : null;
  });
  readonly pledgeLink = computed(() => this.myPledgeLink() ?? this.globalPledgeLink());

  /** The page hands in which ship is open, once, from its constructor. */
  connect(slug: Signal<string | null>): void {
    this.slugSource = slug;
  }

  /** A new entity loads: the form closes and forgets what was typed. */
  reset(): void {
    this.open.set(false);
    this.input.set('');
    this.error.set(null);
    this.saved.set(false);
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.input.set(this.myPledgeLink() ?? '');
      this.error.set(null);
      this.saved.set(false);
    }
  }

  onInput(value: string): void {
    this.input.set(value);
    if (this.error()) this.error.set(null);
    if (this.saved()) this.saved.set(false);
  }

  async save(): Promise<void> {
    const slug = this.slugSource();
    if (!slug) return;
    this.applyResult(await this.shipLinks.setMyLink(slug, this.input()));
  }

  async remove(): Promise<void> {
    const slug = this.slugSource();
    if (!slug) return;
    const err = await this.shipLinks.removeMyLink(slug);
    this.applyResult(err);
    if (!err) this.input.set('');
  }

  /** ADMIN ONLY — publish the typed link for everyone. Server re-checks role. */
  async promote(): Promise<void> {
    const slug = this.slugSource();
    if (!slug) return;
    this.applyResult(await this.shipLinks.promote(slug, this.input()));
  }

  /** ADMIN ONLY — withdraw the globally visible link. */
  async unpromote(): Promise<void> {
    const slug = this.slugSource();
    if (!slug) return;
    this.applyResult(await this.shipLinks.unpromote(slug));
  }

  private applyResult(err: string | null): void {
    this.error.set(err);
    this.saved.set(err === null);
  }
}
