// "Teilen" popover content (concept it.2/it.3/it.6, hv-s4 wording, hg6-* share
// model). Standalone content component — the holo stage hosts it inside its
// own popover shell and wires `copyCurrentLink` to the page's EXISTING
// `copyShareLink()` (inventory #14, unchanged).
//
// #645 "Save & share": one button saves the draft (through the host, which
// owns the save and its fork guard), then reuses this config's newest active
// link — when its snapshot still matches the saved config — or mints one, and
// copies it. Below it, every active link of the config: created at, copy,
// revoke (app dialog, danger tone).
import { logWarn } from '../../core/log';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { HangarService } from '../../hangar/hangar.service';
import { ConfigLoadoutEntry, HangarShareLink, HangarShipConfig, loadoutVariantHint } from '../../hangar/hangar.types';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { CodexHoloForkGuard } from './codex-holo-fork-guard';

/** Same loadout, order-insensitive: one `port=class` set per side. */
function sameLoadout(a: readonly ConfigLoadoutEntry[], b: readonly ConfigLoadoutEntry[]): boolean {
  const key = (l: readonly ConfigLoadoutEntry[]) => new Set(l.map((e) => `${e.portName}=${e.className}`));
  const ka = key(a);
  const kb = key(b);
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

/**
 * The link "Save & share" may hand out again instead of minting a new one:
 * the NEWEST active link whose snapshot (loadout, channel, patch) is exactly
 * what the config holds now. A link minted before a later save carries the
 * old snapshot — the public preview shows that snapshot — so it is never
 * reused for a changed loadout.
 */
export function reusableShareLink(
  links: readonly HangarShareLink[],
  config: Pick<HangarShipConfig, 'loadout'>,
  channel: string,
  patchVersion: string,
): HangarShareLink | null {
  const newest = [...links]
    .filter((l) => !l.revokedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
  if (!newest) return null;
  const fits = newest.channel === channel && newest.patchVersion === patchVersion && sameLoadout(newest.loadout, config.loadout);
  return fits ? newest : null;
}

@Component({
  selector: 'sc-codex-holo-share',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-share">
      <!-- (1) this view's address — the host owns the actual copy; its toast
           state comes back in as linkCopied so the button confirms in place. -->
      <button type="button" class="share-row link-copy" [class.done]="linkCopied()" (click)="copyCurrentLink.emit()"
              [attr.aria-keyshortcuts]="copyHotkey()" [attr.aria-live]="'polite'">
        <span>{{ (linkCopied() ? 'codex.holo.share.copied' : 'codex.holo.share.copyLink') | translate }}</span>
        @if (copyHotkey(); as hk) { <kbd class="hk" aria-hidden="true">{{ hk }}</kbd> }
      </button>
      <p class="hint-text link-hint">{{ 'codex.holo.share.copyLinkHint' | translate }}</p>

      @if (readOnly()) {
        <!-- A shared link is on the table: the reader has nothing of their own to share yet. -->
        <p class="hint-text state read-only">{{ 'codex.holo.share.readOnlyHint' | translate }}</p>
      } @else {
        @if (unsavedChanges() > 0) {
          <p class="hint-text unsaved">{{ 'codex.holo.share.unsavedHint' | translate: { n: unsavedChanges() } }}</p>
        }

        @if (!config()) {
          @if (!signedIn()) {
            <p class="hint-text state">{{ 'codex.holo.share.signInHint' | translate }}</p>
          } @else if (unsavedChanges() > 0 && saveDraft()) {
            <!-- Saving creates the hangar entry and its config on the way. -->
            <div class="hangar-share">
              <button type="button" class="primary save-share" [disabled]="sharing()" [attr.aria-busy]="sharing()" (click)="saveAndShare()">
                {{ (sharing() ? 'codex.holo.share.sharing' : 'codex.holo.share.saveAndShare') | translate }}
              </button>
              @if (error(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
            </div>
          } @else if (!inHangar()) {
            <div class="hangar-share">
              <p class="hint-text state">{{ 'codex.holo.share.notInHangarHint' | translate }}</p>
              <button type="button" class="primary" (click)="addToHangar.emit()"
                      [disabled]="addBusy()" [attr.aria-busy]="addBusy()">{{ 'codex.holo.share.addToHangar' | translate }}</button>
              @if (addFailed()) {
                <p class="hint-text add-err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
              }
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

          <div class="hangar-share">
            <!-- Save & share: saves the draft first, then hands out a link of
                 this config (a followed config asks to become the reader's own). -->
            <button type="button" class="primary save-share" [disabled]="sharing()" [attr.aria-busy]="sharing()" (click)="saveAndShare()">
              {{ (sharing() ? 'codex.holo.share.sharing' : shareLabelKey()) | translate }}
            </button>
            @if (c.followsOwner) {
              <p class="hint-text state">{{ 'codex.holo.share.followedShareHint' | translate }}</p>
            }
            @if (copyFailed()) {
              <p class="err copy-failed" role="alert">{{ 'codex.holo.share.copyFailed' | translate }}</p>
            }
            @if (error(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }

            @if (!c.followsOwner) {
              @if (linksLoading()) {
                <p class="hint-text state">{{ 'codex.holo.share.linksLoading' | translate }}</p>
              } @else if (linksError(); as le) {
                <div class="links-err" role="alert">
                  <p class="err">{{ 'codex.holo.share.linksError' | translate }} {{ le | translate }}</p>
                  <button type="button" class="quiet" (click)="loadLinks()">{{ 'codex.error.retry' | translate }}</button>
                </div>
              } @else if (links().length > 0) {
                <p class="sub">{{ 'codex.holo.share.activeLinks' | translate: { n: links().length } }}</p>
                <ul class="links">
                  @for (l of links(); track l.id) {
                    <li class="link-row" [class.fresh]="l.id === copiedId()">
                      <div class="lr-meta">
                        <span class="lr-date">{{ l.createdAt | scDate: 'datetime' }}</span>
                        <span class="lr-url mono">{{ shortUrl(l) }}</span>
                      </div>
                      <div class="actions">
                        <button type="button" class="copy" (click)="copyHangarLink(l)">
                          {{ (copiedId() === l.id ? 'codex.holo.share.copied' : 'codex.holo.share.copy') | translate }}
                        </button>
                        <button type="button" class="danger revoke" (click)="revoke(l)">
                          {{ 'codex.holo.share.revoke' | translate }}
                        </button>
                      </div>
                    </li>
                  }
                </ul>
                <p class="revoke-note">{{ 'codex.holo.share.revokeNote' | translate }}</p>
              }
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    /* Opened from the holo stage as its popover: a real surface — background,
       frame, shadow, a notch pointing at "Teilen" — never floating text over
       the table. The stage adds the class and the enter/leave classes. */
    :host(.share-popover) { --pop-line: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      position: absolute; top: calc(100% + 12px); inset-inline-end: -8px; z-index: 30; width: min(360px, calc(100vw - 32px));
      max-height: min(70dvh, 560px); overflow-y: auto; overscroll-behavior: contain;
      padding: 12px 14px; border-radius: var(--holo-r); background: var(--sc-bg-1); border: 1px solid var(--pop-line);
      box-shadow: 0 18px 48px rgb(0 0 0 / 0.55), 0 0 0 1px color-mix(in srgb, var(--sc-accent) 10%, transparent); transform-origin: calc(100% - 22px) -6px; }
    :host(.share-popover)::before { content: ''; position: absolute; top: -6px; inset-inline-end: 18px; width: 10px; height: 10px; rotate: 45deg;
      background: var(--sc-bg-1); border-top: 1px solid var(--pop-line); border-left: 1px solid var(--pop-line); }
    :host(.pop-enter) { animation: pop-in var(--holo-t-base) var(--holo-e-out); }
    :host(.pop-leave) { animation: pop-out var(--holo-t-fast) var(--holo-e-io) forwards; }
    @keyframes pop-in { from { opacity: 0; transform: translateY(calc(-1 * var(--holo-rise))) scale(0.97); } }
    @keyframes pop-out { to { opacity: 0; transform: translateY(-4px) scale(0.98); } }
    @media (prefers-reduced-motion: reduce) { :host(.pop-enter), :host(.pop-leave) { animation: none; } }
    .holo-share { display: flex; flex-direction: column; gap: 10px; min-width: 220px; }
    .share-row {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      min-height: 44px; padding: 8px 12px; border-radius: var(--holo-r);
      border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; text-align: left;
    }
    .share-row:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .hk { padding: 0 4px; border: 1px solid var(--sc-border); border-radius: 2px; font-family: var(--font-monospace, monospace); font-size: 9px; color: var(--sc-fg-2); }
    @media (hover: none), (pointer: coarse) { .hk { display: none; } }

    .follow-hint { padding: 8px 10px; border-radius: var(--holo-r); background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .hint-text { margin: 0 0 6px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .link-hint, .state, .unsaved { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1.35; }
    .unsaved { color: var(--sc-warning); }
    .add-err { color: var(--sc-danger); font-size: 0.8rem; margin: 4px 0 0; }
    .share-row.done { border-color: var(--sc-success); color: var(--sc-success); }
    .dot { margin: 0 4px; }
    .refresh { min-height: 40px; padding: 5px 10px; border-radius: var(--holo-r); border: 1px solid var(--sc-accent);
      background: transparent; color: var(--sc-accent); font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer; }
    .refresh:disabled { opacity: 0.6; cursor: not-allowed; }

    .hangar-share { display: flex; flex-direction: column; gap: 6px; }
    .hangar-share > button.primary { min-height: 44px; padding: 7px 12px; border-radius: var(--holo-r);
      border: 1px solid var(--sc-accent); background: var(--sc-accent); color: var(--sc-bg-0);
      font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; cursor: pointer; }
    .hangar-share > button.primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .sub { margin: 4px 0 0; font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
    .links { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .link-row { display: grid; gap: 6px; padding: 6px 8px; border-radius: 4px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      transition: border-color 160ms ease; }
    .link-row.fresh { border-color: var(--sc-success); }
    .lr-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; min-width: 0; }
    .lr-date { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .lr-url { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .actions button, .links-err button { min-height: 36px; padding: 4px 10px; border-radius: var(--holo-r); border: 1px solid var(--sc-border);
      background: var(--sc-bg-1); color: var(--sc-fg-1); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; }
    .actions button:hover, .links-err button:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .actions button.danger:hover { border-color: var(--sc-danger); color: var(--sc-danger); }
    @media (pointer: coarse) { .actions button, .links-err button { min-height: var(--sc-tap-min, 44px); } }
    .links-err { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .revoke-note { margin: 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .err { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-danger); }
  `],
})
export class CodexHoloShareComponent {
  /** Null when the ship isn't in the viewer's hangar (or they're signed out). */
  readonly config = input<HangarShipConfig | null>(null);
  readonly shipClassName = input.required<string>();
  readonly channel = input.required<string>();
  readonly patchVersion = input.required<string>();
  /** Host toast state for "Link kopieren" — the button confirms in place. */
  readonly linkCopied = input(false);
  readonly signedIn = input(false);
  readonly inHangar = input(false);
  /** Add-to-hangar in flight on the host — locks the button. */
  readonly addBusy = input(false);
  /** The host's last add-to-hangar failed — shows the alert under the button. */
  readonly addFailed = input(false);
  /** Draft hardpoint changes not yet saved — "Save & share" saves them first. */
  readonly unsavedChanges = input(0);
  /** A shared link is on the table (#646) — nothing of the reader's own to share. */
  readonly readOnly = input(false);
  /** The host's save (#645): saves the draft, resolves the config to share —
   * null when the save failed or the fork question was declined. */
  readonly saveDraft = input<(() => Promise<HangarShipConfig | null>) | null>(null);
  /** The holodeck key that copies this view's link (#644), shown as <kbd>. */
  readonly copyHotkey = input<string | null>(null);

  /** Today's `?loadout=` share (inventory #14) — the host performs the actual clipboard write. */
  readonly copyCurrentLink = output<void>();
  /** A refreshed or forked config, so the host can replace its own copy. */
  readonly configRefreshed = output<HangarShipConfig>();
  /** "Zum Hangar hinzufügen" from inside the popover — the host owns the write. */
  readonly addToHangar = output<void>();

  private readonly hangar = inject(HangarService);
  private readonly dialog = inject(ScConfirmService);
  private readonly forkGuard = inject(CodexHoloForkGuard);

  /** This config's active links, newest first. */
  readonly links = signal<readonly HangarShareLink[]>([]);
  readonly linksLoading = signal(false);
  /** `errors.*` key of a failed link list — error state with retry, never "no links". */
  readonly linksError = signal<string | null>(null);
  readonly sharing = signal(false);
  readonly refreshing = signal(false);
  /** The link that was copied last (confirms on its own row for 2 s). */
  readonly copiedId = signal<string | null>(null);
  /** The clipboard refused the copy — shown for 3 s. */
  readonly copyFailed = signal(false);
  readonly error = signal<string | null>(null);
  private linksSeq = 0;

  constructor() {
    // Links belong to ONE ship's config: the stage reuses this popover across
    // hull switches, so a token of ship A must never be listed under ship B
    // (wave 5 B0.1). Keyed on the config's id (a computed — a save or a
    // refresh hands in a new object for the SAME config and must not drop
    // the list the reader is looking at).
    const configKey = computed(() => {
      const c = this.config();
      return c && !c.followsOwner ? c.id : null;
    });
    effect(() => {
      this.shipClassName();
      const id = configKey();
      untracked(() => {
        this.links.set([]);
        this.error.set(null);
        this.linksError.set(null);
        this.copiedId.set(null);
        if (id && !this.readOnly()) void this.loadLinks();
      });
    });
  }

  readonly hint = computed(() => {
    const c = this.config();
    return c ? loadoutVariantHint(c) : { kind: 'savedAt' as const, updatedAt: '', ownerUserId: null };
  });

  /** "Save & share" while there is something to save, else "Share link". */
  readonly shareLabelKey = computed(() =>
    this.unsavedChanges() > 0 ? 'codex.holo.share.saveAndShare' : 'codex.holo.share.shareLink',
  );

  shareUrl(l: HangarShareLink): string {
    return `${location.origin}/hangar/shared/${l.token}`;
  }

  /** The row's short form — the full address goes to the clipboard. */
  shortUrl(l: HangarShareLink): string {
    return `/hangar/shared/${l.token.slice(0, 8)}…`;
  }

  async loadLinks(): Promise<void> {
    const c = this.config();
    if (!c || c.followsOwner) return;
    const seq = ++this.linksSeq;
    this.linksLoading.set(true);
    this.linksError.set(null);
    try {
      const links = await this.hangar.listShareLinks(c.id);
      if (seq === this.linksSeq) this.links.set(links);
    } catch (error) {
      if (seq === this.linksSeq) this.linksError.set(toErrorKey('hangar', 'listShareLinks', error, { configId: c.id }));
    } finally {
      if (seq === this.linksSeq) this.linksLoading.set(false);
    }
  }

  /**
   * #645: save the draft (host, with its fork guard) → a followed config
   * becomes the reader's own (fork guard) → reuse the newest active link
   * whose snapshot still matches, or mint one → copy it.
   */
  async saveAndShare(): Promise<void> {
    if (this.sharing() || this.readOnly()) return;
    this.error.set(null);
    this.sharing.set(true);
    try {
      let c = this.config();
      const save = this.saveDraft();
      if (this.unsavedChanges() > 0 && save) {
        const saved = await save();
        // Save failed (the save bar says why) or the fork was declined.
        if (!saved) return;
        c = saved;
      }
      if (!c) {
        this.error.set('codex.holo.share.errorGeneric');
        return;
      }
      if (c.followsOwner) {
        const guard = await this.forkGuard.ensureEditable(c);
        if (guard === 'cancelled') return;
        c = { ...c, followsOwner: false, forkedAt: new Date().toISOString() };
        this.configRefreshed.emit(c);
      }
      const links = await this.hangar.listShareLinks(c.id);
      ++this.linksSeq; // this answer wins over a list load still in flight
      this.linksLoading.set(false);
      this.linksError.set(null);
      let link = reusableShareLink(links, c, this.channel(), this.patchVersion());
      if (link) {
        this.links.set(links);
      } else {
        link = await this.hangar.createShareLink(c, this.shipClassName(), this.channel(), this.patchVersion());
        if (!link) {
          this.links.set(links);
          this.error.set('codex.holo.share.errorGeneric');
          return;
        }
        this.links.set([link, ...links]);
      }
      await this.copyHangarLink(link);
    } catch (error) {
      this.error.set(toErrorKey('hangar', 'saveAndShare', error));
    } finally {
      this.sharing.set(false);
    }
  }

  async copyHangarLink(l: HangarShareLink): Promise<void> {
    this.copyFailed.set(false);
    try {
      await navigator.clipboard.writeText(this.shareUrl(l));
    } catch (error) {
      // Clipboard permission denied (or no clipboard API): say so, so the
      // reader knows to copy the link by hand instead of trusting a no-op.
      logWarn('codex', 'share link copy failed', error);
      this.copyFailed.set(true);
      setTimeout(() => this.copyFailed.set(false), 3000);
      return;
    }
    this.copiedId.set(l.id);
    setTimeout(() => {
      if (this.copiedId() === l.id) this.copiedId.set(null);
    }, 2000);
  }

  /** Stop sharing one link — asked first in the app dialog (destructive tone). */
  async revoke(l: HangarShareLink): Promise<void> {
    this.error.set(null);
    const ok = await this.dialog.confirm({
      titleKey: 'codex.holo.share.revokeConfirm.title',
      messageKey: 'codex.holo.share.revokeConfirm.body',
      confirmKey: 'codex.holo.share.revoke',
      tone: 'danger',
    });
    if (!ok) return;
    const done = await this.hangar.revokeShareLink(l.id);
    if (!done) {
      this.error.set('codex.holo.share.errorGeneric');
      return;
    }
    this.links.update((list) => list.filter((x) => x.id !== l.id));
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
}
