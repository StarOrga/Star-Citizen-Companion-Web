import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScPopoverDismissDirective } from '../../shared/popover/sc-popover-dismiss.directive';
import { HoloDiffMarkerComponent } from './holo-diff-marker';

/** A navigation target of the menu (router commands + query params). */
export interface HangarMenuLink {
  readonly commands: readonly unknown[];
  readonly queryParams: Record<string, string | null>;
}

/** One own exemplar of this hull (a saved loadout, `hangar_ship_configs`). */
export interface HangarExemplar {
  readonly id: string;
  readonly name: string;
  /** Parts that differ from Werk (◆ count). */
  readonly diffCount: number;
  /** The stored one-line summary; null = none (nothing is shown, never a placeholder text). */
  readonly summary: string | null;
  readonly link: HangarMenuLink;
}

/**
 * The one hangar button of the Holotisch head (concept holotisch-feinschliff r4 d1 s5, C5/C22/C23):
 * "▣ 2× im Hangar · <shown loadout> ▾". Its menu: Ausstattung — "Werk" and every own exemplar (name,
 * summary line, ◆ count of differing parts) as real links; the selected exemplar's rename / note / pin /
 * remove; then Hangar (copy this exemplar, new exemplar from Werk — only when an exemplar is shown —,
 * keep the Werk build as an exemplar, another copy into the hangar) and, apart from it, Wunschliste.
 * No patch label: the menu is always about the current patch. The menu only asks — the page does the writes.
 */
@Component({
  selector: 'sc-codex-holo-hangar-menu',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScPopoverDismissDirective, HoloDiffMarkerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hm" [scPopoverDismiss]="open()" (dismissed)="open.set(false)">
      <button type="button" class="hb" [class.open]="open()" aria-haspopup="menu" [attr.aria-expanded]="open()"
              [attr.aria-controls]="open() ? 'holo-hangar-menu' : null" (click)="toggle()" (keydown)="onTriggerKey($event)">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" /></svg>
        <b>{{ count() > 0 ? ('codex.head.own.hangarN' | translate: { n: count() }) : ('codex.head.notOwn.hangar' | translate) }}</b>
        <span class="sep" aria-hidden="true">·</span>
        <span class="ex">{{ shownName() ?? ('codex.holo.hangar.werk' | translate) }}</span>
        @if ((shownDiff() ?? 0) > 0) { <sc-holo-diff-marker /> }
        <span class="car" aria-hidden="true">▾</span>
      </button>
      @if (open()) {
        <div class="menu" id="holo-hangar-menu" role="menu" tabindex="-1" [attr.aria-label]="'codex.holo.hangar.menuAria' | translate" (keydown)="onMenuKey($event)">
          <div class="gh" role="presentation">{{ 'codex.holo.hangar.loadouts' | translate }}</div>
          <a role="menuitemradio" class="row" [class.on]="activeId() === null" [attr.aria-checked]="activeId() === null"
             [routerLink]="werkLink().commands" [queryParams]="werkLink().queryParams" (click)="open.set(false)">
            <i class="radio" aria-hidden="true"></i>
            <span class="txt"><b>{{ 'codex.holo.hangar.werk' | translate }}</b>
              @if (activeId() === null && werkChanged() > 0) {
                <small>{{ 'codex.holo.hangar.werkChanged' | translate: { n: werkChanged() } }}</small>
              }
            </span>
          </a>
          @for (e of exemplars(); track e.id) {
            <a role="menuitemradio" class="row" [class.on]="activeId() === e.id" [attr.aria-checked]="activeId() === e.id"
               [routerLink]="e.link.commands" [queryParams]="e.link.queryParams" (click)="open.set(false)">
              <i class="radio" aria-hidden="true"></i>
              <span class="txt">
                <b>{{ e.name }}</b>
                @if (e.summary) { <small class="sum">{{ e.summary }}</small> }
                <small class="diff">
                  @if (e.diffCount > 0) {
                    <sc-holo-diff-marker />
                    {{ (e.diffCount === 1 ? 'codex.holo.hangar.diffOne' : 'codex.holo.hangar.diffMany') | translate: { n: e.diffCount } }}
                  } @else {
                    {{ 'codex.holo.hangar.diffNone' | translate }}
                  }
                </small>
              </span>
            </a>
          }
          @if (active(); as a) {
            <div class="acts" role="group" [attr.aria-label]="'codex.holo.hangar.selectedAria' | translate: { name: a.name }">
              <button type="button" role="menuitem" class="act" (click)="fire(rename, a.id)">{{ 'codex.own.rename' | translate }}</button>
              <button type="button" role="menuitem" class="act" (click)="fire(note, a.id)">{{ 'codex.own.note' | translate }}</button>
              <button type="button" role="menuitem" class="act" [attr.aria-pressed]="pinned()" (click)="fire(pin, a.id)">
                {{ (pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate }}</button>
              <button type="button" role="menuitem" class="act danger" (click)="fire(remove, a.id)">{{ 'codex.holo.hangar.removeExemplar' | translate }}</button>
            </div>
          }
          @if (signedIn()) {
            <hr />
            <div class="gh" role="presentation">{{ 'codex.holo.hangar.hangar' | translate }}</div>
            @if (active(); as a) {
              <button type="button" role="menuitem" class="add" [disabled]="busy()" (click)="fire(copyExemplar, a.id)">＋ {{ 'codex.holo.hangar.copy' | translate }}</button>
              <button type="button" role="menuitem" class="add" [disabled]="busy()" (click)="fire(newFromWerk, a.id)">＋ {{ 'codex.holo.hangar.newFromWerk' | translate }}</button>
            } @else {
              <button type="button" role="menuitem" class="add" [disabled]="busy()" (click)="fire(saveAsExemplar, null)">
                ＋ {{ (werkChanged() > 0 ? 'codex.holo.hangar.saveBuild' : 'codex.holo.hangar.saveWerk') | translate }}</button>
            }
            @if (count() > 0) {
              <button type="button" role="menuitem" class="add" [disabled]="busy()" (click)="fire(addCopy, null)">
                ＋ {{ 'codex.holo.hangar.anotherCopy' | translate: { name: shipName() } }}</button>
            }
            @if (hangarLink(); as h) {
              <a role="menuitem" class="go" [routerLink]="h.commands" [queryParams]="h.queryParams" (click)="open.set(false)">
                {{ 'codex.holo.hangar.openHangar' | translate }} <span aria-hidden="true">›</span></a>
            }
            <hr />
            <div class="gh" role="presentation">{{ 'codex.holo.hangar.wishlist' | translate }}</div>
            @if (wishQty() > 0) {
              <p class="note" role="presentation">{{ 'codex.ownCard.wished' | translate: { n: wishQty() } }}</p>
            }
            <!-- A wish that carries a loadout (D1): opened like an exemplar, its parts become the draft. -->
            @for (w of wishes(); track w.id) {
              <a role="menuitemradio" class="row wish" [class.on]="activeId() === w.id" [attr.aria-checked]="activeId() === w.id"
                 [routerLink]="w.link.commands" [queryParams]="w.link.queryParams" (click)="open.set(false)">
                <i class="radio" aria-hidden="true"></i>
                <span class="txt">
                  <b>{{ w.name }}</b>
                  <small class="diff">
                    @if (w.diffCount > 0) {
                      <sc-holo-diff-marker />
                      {{ (w.diffCount === 1 ? 'codex.holo.hangar.diffOne' : 'codex.holo.hangar.diffMany') | translate: { n: w.diffCount } }}
                    } @else {
                      {{ 'codex.holo.hangar.diffNone' | translate }}
                    }
                  </small>
                </span>
              </a>
            }
            <button type="button" role="menuitem" class="add" [disabled]="busy()" (click)="fire(addWish, null)">
              <span class="wl"><span class="wt">♡ {{ (wishQty() > 0 ? 'codex.holo.hangar.wishAgain' : 'codex.holo.hangar.toWishlist') | translate }}</span>
              @if (activeId() === null && werkChanged() > 0) {
                <small class="with">{{ (werkChanged() === 1 ? 'codex.holo.hangar.wishWithOne' : 'codex.holo.hangar.wishWithMany') | translate: { n: werkChanged() } }}</small>
              }</span></button>
          } @else {
            <hr />
            <a role="menuitem" class="go" routerLink="/login" (click)="open.set(false)">{{ 'codex.ownCard.signIn' | translate }} <span aria-hidden="true">›</span></a>
          }
          @if (errorKey(); as err) { <p class="err" role="alert">{{ err | translate }}</p> }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    .hm { position: relative; display: inline-flex; min-width: 0; }
    .hb { display: inline-flex; align-items: center; gap: 7px; height: 32px; min-width: 0; max-width: 100%; padding: 0 10px 0 6px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); border-radius: 16px; background: transparent;
      color: var(--sc-fg-1); font: inherit; font-size: max(12.5px, var(--sc-fs-floor)); white-space: nowrap; cursor: pointer; }
    .hb .ic { flex: none; width: 22px; height: 22px; padding: 4px; box-sizing: border-box; border-radius: 11px; color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
    .hb b { color: var(--sc-fg-0); font-weight: 600; }
    .hb .sep { color: var(--sc-fg-2); }
    .hb .ex { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--sc-fg-0); }
    .hb .car { color: var(--sc-accent); font-size: 10px; }
    .hb:hover, .hb.open { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border-color: var(--sc-accent); }
    .hb:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 290px; max-width: calc(100vw - 24px);
      max-height: min(70vh, 560px); max-height: min(70dvh, 560px); overflow: auto; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 2px; padding: 8px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border)); border-radius: 12px;
      background: var(--sc-bg-1); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5); }
    .gh { padding: 4px 10px 2px; font-size: max(9px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
    hr { width: 100%; margin: 6px 0; border: 0; border-top: 1px solid var(--sc-border); }
    .row, .add, .go, .act { display: flex; align-items: flex-start; gap: 9px; width: 100%; box-sizing: border-box; min-height: 32px; padding: 7px 10px;
      border: 0; border-radius: 8px; background: none; color: var(--sc-fg-1); font: inherit; font-size: max(12.5px, var(--sc-fs-floor));
      text-align: start; text-decoration: none; cursor: pointer; }
    .row:hover, .add:hover:not(:disabled), .go:hover, .act:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-fg-0); }
    .row:focus-visible, .add:focus-visible, .go:focus-visible, .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .row.on { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
    .radio { flex: none; width: 12px; height: 12px; margin-top: 3px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--sc-fg-2); }
    .row.on .radio { border-color: var(--sc-accent); background: radial-gradient(circle, var(--sc-accent) 0 45%, transparent 50%); }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt b { font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .txt small { display: inline-flex; align-items: center; gap: 6px; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .txt .sum { display: block; color: var(--sc-fg-1); }
    .acts { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px 0 2px 21px; }
    .act { width: auto; min-height: 28px; padding: 4px 9px; font-size: max(11.5px, var(--sc-fs-floor)); color: var(--sc-accent); }
    .act.danger { color: var(--sc-danger); }
    .add { color: var(--sc-fg-0); }
    .add:disabled { opacity: 0.45; cursor: not-allowed; }
    .go { color: var(--sc-accent); }
    /* The wish row: the label on one line, how many swaps it carries as a quiet second line under it. */
    .add .wl { display: flex; flex-direction: column; gap: 2px; min-width: 0; text-align: start; }
    .add .wt { white-space: nowrap; }
    .add .with { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .note { margin: 0; padding: 0 10px; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .err { margin: 4px 10px 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-danger); }
    @media (pointer: coarse) { .hb { height: 48px; border-radius: 24px; } .row, .add, .go, .act { min-height: 48px; align-items: center; } }
  `],
})
export class CodexHoloHangarMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The hull's short name ("Gladius") for "Noch eine Gladius in den Hangar". */
  readonly shipName = input('');
  /** Copies in the hangar; 0 = not in the hangar. */
  readonly count = input(0);
  readonly wishQty = input(0);
  readonly signedIn = input(false);
  readonly exemplars = input<readonly HangarExemplar[]>([]);
  /** Wishes of this hull that carry a loadout (`is_wish` configs, D1), listed under Wunschliste. */
  readonly wishes = input<readonly HangarExemplar[]>([]);
  /** The exemplar on the table; null = Werk. */
  readonly activeId = input<string | null>(null);
  readonly werkLink = input<HangarMenuLink>({ commands: [], queryParams: {} });
  /** HQ › Hangar (null hides "Im Hangar öffnen"). */
  readonly hangarLink = input<HangarMenuLink | null>(null);
  /** Unsaved swaps on Werk (the sandbox, C23): offered to keep, never forced. */
  readonly werkChanged = input(0);
  readonly pinned = input(false);
  readonly busy = input(false);
  readonly errorKey = input<string | null>(null);

  readonly rename = output<string>();
  readonly note = output<string>();
  readonly pin = output<string>();
  readonly remove = output<string>();
  readonly copyExemplar = output<string>();
  readonly newFromWerk = output<string>();
  /** Keep what is on the Werk table (with or without swaps) as a new exemplar. */
  readonly saveAsExemplar = output<null>();
  readonly addCopy = output<null>();
  readonly addWish = output<null>();

  readonly open = signal(false);
  protected readonly active = computed(() => {
    const id = this.activeId();
    return id ? (this.exemplars().find((e) => e.id === id) ?? this.wishes().find((w) => w.id === id) ?? null) : null;
  });
  protected readonly shownName = computed(() => this.active()?.name ?? null);
  protected readonly shownDiff = computed(() => this.active()?.diffCount ?? null);

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) queueMicrotask(() => this.focusItem('checked'));
  }

  protected fire<T>(out: { emit(v: T): void }, value: T): void {
    this.open.set(false);
    out.emit(value);
  }

  onTriggerKey(ev: KeyboardEvent): void {
    if (ev.key !== 'ArrowDown' || this.open()) return;
    ev.preventDefault();
    this.toggle();
  }

  /** Arrow keys walk the menu items, Home / End jump; Escape is the dismiss directive's. */
  onMenuKey(ev: KeyboardEvent): void {
    const items = this.items();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (ev.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (ev.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    else if (ev.key === 'Tab') { this.open.set(false); return; }
    if (next < 0) return;
    ev.preventDefault();
    items[next].focus();
  }

  private items(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
  }

  private focusItem(which: 'checked'): void {
    const el = which === 'checked' ? this.host.querySelector<HTMLElement>('[aria-checked="true"]') : null;
    (el ?? this.items()[0])?.focus({ preventScroll: true });
  }
}
