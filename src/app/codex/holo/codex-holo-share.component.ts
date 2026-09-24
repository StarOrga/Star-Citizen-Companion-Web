// "Teilen" popover content (concept it.2/it.3/it.6, hv-s4 wording, hg6-* share
// model). Standalone content component — the host (codex-detail, Wave 2.5)
// hosts it inside its own popover shell and wires `copyCurrentLink` to its
// EXISTING `copyShareLink()` (inventory #14, unchanged).
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShareLink, HangarShipConfig, loadoutVariantHint } from '../../hangar/hangar.types';

@Component({
  selector: 'sc-codex-holo-share',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-share">
      <!-- (1) today's link — unchanged, host owns the actual copy; the host's
           toast state comes back in as linkCopied so the button itself
           confirms (wave 5 A1.1). -->
      <button type="button" class="share-row link-copy" [class.done]="linkCopied()" (click)="copyCurrentLink.emit()"
              [attr.aria-live]="'polite'">
        {{ (linkCopied() ? 'codex.holo.share.copied' : 'codex.holo.share.copyLink') | translate }}
      </button>
      <p class="hint-text link-hint">{{ 'codex.holo.share.copyLinkHint' | translate }}</p>
      @if (unsavedChanges() > 0) {
        <p class="hint-text unsaved">{{ 'codex.holo.share.unsavedHint' | translate: { n: unsavedChanges() } }}</p>
      }

      <!-- (3) followed-config hint, shown ABOVE the hangar-share block so the
           "who manages this" fact reads before "manage your own share". -->
      <!-- Hangar share — every state says what it needs instead of hiding
           (wave 5 A1.3): signed out → sign in; not in the hangar → add it;
           in the hangar with a config → the link controls. -->
      @if (!config()) {
        @if (!signedIn()) {
          <p class="hint-text state">{{ 'codex.holo.share.signInHint' | translate }}</p>
        } @else if (!inHangar()) {
          <div class="hangar-share">
            <p class="hint-text state">{{ 'codex.holo.share.notInHangarHint' | translate }}</p>
            <button type="button" (click)="addToHangar.emit()">{{ 'codex.holo.share.addToHangar' | translate }}</button>
          </div>
        } @else {
          <p class="hint-text state">{{ 'codex.holo.share.noConfigHint' | translate }}</p>
        }
      }
      @if (config(); as c) {
        @if (c.followsOwner) {
          <div class="follow-hint">
            <p class="hint-text">
              {{ 'codex.holo.share.followedBy' | translate: { owner: c.ownerName ?? '—' } }}
              <span class="dot">·</span>
              {{ 'codex.holo.share.followedSince' | translate: { date: (hint().updatedAt | scDate) } }}
            </p>
            <button type="button" class="refresh" [disabled]="refreshing()" (click)="refresh()">
              {{ (refreshing() ? 'codex.holo.share.refreshing' : 'codex.holo.share.refresh') | translate }}
            </button>
          </div>
        }

        <!-- (2) the hangar share link — own/forked configs only; a still-
             following config shares nothing of its own (it has nothing that
             is not already the owner's). -->
        @if (!c.followsOwner) {
          <div class="hangar-share">
            @if (link(); as l) {
              @if (!l.revokedAt) {
                <p class="link-url mono">{{ shareUrl(l) }}</p>
                <div class="actions">
                  <button type="button" (click)="copyHangarLink(l)">
                    {{ (copied() ? 'codex.holo.share.copied' : 'codex.holo.share.copy') | translate }}
                  </button>
                  <button type="button" class="danger" (click)="revoke(l)">
                    {{ 'codex.holo.share.revoke' | translate }}
                  </button>
                </div>
                <p class="revoke-note">{{ 'codex.holo.share.revokeNote' | translate }}</p>
              } @else {
                <p class="revoked">{{ 'codex.holo.share.revoked' | translate }}</p>
              }
            } @else {
              <button type="button" [disabled]="creating()" (click)="create(c)">
                {{ (creating() ? 'codex.holo.share.creating' : 'codex.holo.share.createLink') | translate }}
              </button>
            }
            @if (error()) {
              <p class="err">{{ error() | translate }}</p>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .holo-share { display: flex; flex-direction: column; gap: 10px; min-width: 220px; }
    .share-row {
      min-height: 44px; padding: 8px 12px; border-radius: 6px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; text-align: left;
    }
    .share-row:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    .follow-hint { padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .hint-text { margin: 0 0 6px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .link-hint, .state, .unsaved { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1.35; }
    .unsaved { color: var(--sc-warning, #e0b040); }
    .share-row.done { border-color: var(--sc-success, #5fbf7a); color: var(--sc-success, #5fbf7a); }
    .dot { margin: 0 4px; }
    .refresh { min-height: 40px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--sc-accent);
      background: transparent; color: var(--sc-accent); font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer; }
    .refresh:disabled { opacity: 0.6; cursor: not-allowed; }

    .hangar-share { display: flex; flex-direction: column; gap: 6px; }
    .hangar-share > button { min-height: 44px; padding: 7px 12px; border-radius: 6px;
      border: 1px solid var(--sc-accent); background: var(--sc-accent); color: var(--sc-bg-0);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; cursor: pointer; }
    .hangar-share > button:disabled { opacity: 0.6; cursor: not-allowed; }
    .link-url { margin: 0; padding: 6px 8px; border-radius: 4px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); font-size: max(0.74rem, var(--sc-fs-floor)); overflow-wrap: anywhere; }
    .actions { display: flex; gap: 6px; }
    .actions button { min-height: 40px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--sc-border);
      background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer; }
    .actions button.danger:hover { border-color: var(--sc-danger, #ff5252); color: var(--sc-danger, #ff5252); }
    .revoke-note { margin: 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .revoked { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .err { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-danger, #ff5252); }
  `],
})
export class CodexHoloShareComponent {
  /** Null when the ship isn't in the viewer's hangar (or they're signed out) — only (1) shows. */
  readonly config = input<HangarShipConfig | null>(null);
  readonly shipClassName = input.required<string>();
  readonly channel = input.required<string>();
  readonly patchVersion = input.required<string>();
  /** Host toast state for "Link kopieren" — the button confirms in place. */
  readonly linkCopied = input(false);
  readonly signedIn = input(false);
  readonly inHangar = input(false);
  /** Draft hardpoint changes not yet saved — a hangar link never carries them. */
  readonly unsavedChanges = input(0);

  /** Today's `?loadout=` share (inventory #14) — the host performs the actual clipboard write. */
  readonly copyCurrentLink = output<void>();
  /** Fires after a successful {@link HangarService.refreshFollowedLoadout} pull, so the host can refresh its own copy of the config. */
  readonly configRefreshed = output<HangarShipConfig>();
  /** "Zum Hangar hinzufügen" from inside the popover — the host owns the write. */
  readonly addToHangar = output<void>();

  private readonly hangar = inject(HangarService);

  readonly link = signal<HangarShareLink | null>(null);
  readonly creating = signal(false);
  readonly refreshing = signal(false);
  readonly copied = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // A link belongs to ONE ship's config: the stage reuses this popover
    // across hull switches, so a token minted for ship A must never be shown
    // (or copied) under ship B (wave 5 B0.1).
    // Keyed on the config's ID (a computed, so an equal id never re-fires),
    // not the object: a save or "Aktualisieren" hands the host a new object
    // for the SAME config and must not throw away a link the user is looking at.
    const configId = computed(() => this.config()?.id ?? null);
    effect(() => {
      this.shipClassName();
      configId();
      untracked(() => {
        this.link.set(null);
        this.error.set(null);
        this.copied.set(false);
      });
    });
  }

  readonly hint = computed(() => {
    const c = this.config();
    return c ? loadoutVariantHint(c) : { kind: 'savedAt' as const, updatedAt: '', ownerUserId: null };
  });

  shareUrl(l: HangarShareLink): string {
    return `${location.origin}/hangar/shared/${l.token}`;
  }

  async create(config: HangarShipConfig): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.hangar.createShareLink(config, this.shipClassName(), this.channel(), this.patchVersion());
      if (!created) {
        this.error.set(this.errorKey());
        return;
      }
      this.link.set(created);
    } finally {
      this.creating.set(false);
    }
  }

  async copyHangarLink(l: HangarShareLink): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl(l));
    } catch {
      return;
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  async revoke(l: HangarShareLink): Promise<void> {
    this.error.set(null);
    const ok = await this.hangar.revokeShareLink(l.id);
    if (!ok) {
      this.error.set(this.errorKey());
      return;
    }
    this.link.set({ ...l, revokedAt: new Date().toISOString() });
  }

  async refresh(): Promise<void> {
    const c = this.config();
    if (!c) return;
    this.refreshing.set(true);
    try {
      const updated = await this.hangar.refreshFollowedLoadout(c.id);
      if (updated) this.configRefreshed.emit(updated);
    } finally {
      this.refreshing.set(false);
    }
  }

  private errorKey(): string {
    return 'codex.holo.share.errorGeneric';
  }
}
