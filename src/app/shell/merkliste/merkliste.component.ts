import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ConsentService } from '../../core/consent.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { SilThumbComponent } from '../../shared/sil-thumb/sil-thumb.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { WishCartService } from '../cart/wish-cart.service';
import { MERK_RECENT_SHOWN, MERK_TYPE_LABEL, type MerkRow, type MerkType } from './merkliste.model';
import { MerklisteService } from './merkliste.service';

/** The "frame" crate of the Schnellzugriff (concept r4 `r4-icon-pick` = frame): a box with the notch, two strokes. */
const FRAME_ICON = ['M4 6.5h16V20H4z', 'M9.5 6.5v6.5l2.5-2 2.5 2V6.5'] as const;

/**
 * `<sc-merkliste>` - the Schnellzugriff in the header (concept nachschub-hq r4-d1-s1): the crate icon only, no count,
 * the word "Schnellzugriff" only in the opened panel. Sections: Zuletzt geoeffnet (3 image tiles, 7 after "Mehr
 * anzeigen"), Wunschliste (the last 3 added, "Ganze Wunschliste" opens the cart) and - on a typed page - the context
 * section Inventar / Hangar / Sammlung with the last 3 added of that type and a "Gesamtes ..." deep link carrying the
 * type filter. No Nachschub; a page without a type has no Bestand section. Every row is a real anchor. A non-modal
 * `[scDialog]` gives focus in, Escape and focus return; on phones the panel is a sheet in dvh above the feedback
 * launcher's lane.
 */
@Component({
  selector: 'sc-merkliste',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective, SilThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mk">
      <button #trigger type="button" class="trigger" [class.on]="open()" (click)="toggle()"
              aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? panelId : null"
              [attr.aria-label]="'quick.title' | translate" [scTooltip]="open() ? null : ('quick.title' | translate)" scTooltipTier="label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          @for (d of frame; track $index) { <path [attr.d]="d" /> }
        </svg>
      </button>
      @if (open()) {
        <div class="panel" [id]="panelId" role="dialog" scDialog [scDialogModal]="false" [scDialogReturnFocus]="trigger"
             (scDialogEscape)="close()" [attr.aria-label]="'quick.title' | translate">
          <h3 class="title">{{ 'quick.title' | translate }}@if (typeLabel(); as tl) { <small>{{ tl | translate }}</small> }</h3>

          <section class="sec" [attr.aria-label]="'quick.recent' | translate">
            <h4>{{ 'quick.recent' | translate }}</h4>
            @if (shownRecent().length) {
              <div class="tiles">
                @for (r of shownRecent(); track r.id) {
                  <a class="tile" [routerLink]="r.target!.link" [queryParams]="r.target!.queryParams" [fragment]="r.target!.fragment ?? undefined" (click)="close()">
                    <span class="img"><sc-sil-thumb [kind]="thumbKind(r)" [className]="r.className ?? r.id" /></span>
                    <b>{{ r.title }}</b>
                  </a>
                }
              </div>
              @if (svc.recent().length > shown) {
                <button type="button" class="more" [attr.aria-expanded]="more()" (click)="more.set(!more())">
                  {{ (more() ? 'quick.less' : 'quick.more') | translate }}
                </button>
              }
            } @else {
              <p class="empty">{{ 'quick.emptyRecent' | translate }}</p>
              @if (!consent.preferencesAllowed()) {
                <!-- Nothing is written without the Präferenzen consent: say why the list stays empty and where to change it. -->
                <p class="empty need-consent">{{ 'quick.recentNeedsConsent' | translate }} <a routerLink="/settings" (click)="close()">{{ 'quick.recentConsentLink' | translate }}</a></p>
              }
            }
          </section>

          <section class="sec" [attr.aria-label]="'quick.wish' | translate">
            <h4>{{ 'quick.wish' | translate }} <small>{{ 'quick.lastAdded' | translate }}</small></h4>
            <ng-container *ngTemplateOutlet="rowsTpl; context: { rows: svc.wished(), empty: 'quick.emptyWish' }" />
            <a class="all" [attr.href]="svc.cartHref()" (click)="onCart($event)">{{ 'quick.allWish' | translate: { n: svc.wishCount() } }}</a>
          </section>

          @if (svc.context(); as c) {
            <section class="sec" [attr.aria-label]="('quick.section.' + c.ctx.id) | translate">
              <h4>{{ ('quick.section.' + c.ctx.id) | translate }} <small>{{ 'quick.lastAdded' | translate }}</small></h4>
              <ng-container *ngTemplateOutlet="rowsTpl; context: { rows: c.rows, empty: 'quick.emptyContext' }" />
              <a class="all" [routerLink]="c.all.commands" [queryParams]="c.all.queryParams" [fragment]="c.all.fragment" (click)="close()">{{ ('quick.all.' + c.ctx.id) | translate }}</a>
            </section>
          }
        </div>
      }
    </div>

    <ng-template #rowsTpl let-rows="rows" let-empty="empty">
      @for (r of rows; track r.id) {
        <a class="qrow" [routerLink]="r.target!.link" [queryParams]="r.target!.queryParams" [fragment]="r.target!.fragment ?? undefined" (click)="close()">
          <span class="rimg"><sc-sil-thumb [kind]="thumbKind(r)" [className]="r.className ?? r.id" /></span>
          <span class="rt"><b>{{ r.title }}</b>@if (sub(r); as s) { <small>{{ s | translate }}</small> }</span>
          @if (r.qty) { <span class="chip">{{ r.qty }}×</span> }
        </a>
      } @empty {
        <p class="empty">{{ empty | translate }}</p>
      }
    </ng-template>
  `,
  styles: [
    `
      :host { display: contents; }
      .mk { position: relative; display: inline-flex; }
      .trigger {
        position: relative; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 8px;
        border: 1px solid var(--sc-border); background: transparent; color: var(--sc-accent); cursor: pointer;
      }
      .trigger svg { width: 24px; height: 24px; }
      .trigger:hover, .trigger.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .trigger.on { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 18%, transparent); }
      .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .panel {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; width: min(24rem, calc(100vw - 32px));
        max-height: min(40rem, calc(100dvh - 120px)); overflow: auto; padding: 12px 14px 8px; border-radius: 12px;
        border: 1px solid var(--sc-border); background: var(--sc-bg-1); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
      }
      .title { margin: 0 0 6px; font: 600 0.8rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-0); }
      .title small { margin-left: 8px; font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
      .sec { padding: 10px 0 8px; border-top: 1px solid var(--sc-border); }
      h4 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font: 600 0.7rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
      h4 small { font: 500 0.75rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
      .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .tile { display: flex; flex-direction: column; gap: 5px; padding: 6px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); color: var(--sc-fg-0); text-decoration: none; min-width: 0; font-size: 0.78rem; }
      .tile b { font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 1.25; }
      .img { display: block; height: 50px; padding: 6px; border-radius: 7px; color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .tile:hover, .tile:focus-visible, .qrow:hover, .qrow:focus-visible { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); outline: none; }
      .tile:focus-visible, .qrow:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent); }
      .qrow { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 46px; padding: 0 4px; border: 1px solid transparent; border-radius: 8px; color: var(--sc-fg-0); text-decoration: none; }
      .rimg { display: block; height: 36px; padding: 3px; border-radius: 7px; color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .rt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
      .rt b { font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rt small { font-size: max(0.72rem, var(--sc-fs-floor, 0.75rem)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chip { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-accent); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
      .all, .more { display: inline-flex; align-items: center; min-height: 36px; padding: 0 4px; border: 0; background: none; font: inherit; font-size: 0.85rem; color: var(--sc-accent); text-decoration: none; cursor: pointer; }
      .all:hover, .more:hover { text-decoration: underline; }
      .all:focus-visible, .more:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .need-consent a { color: var(--sc-accent); }
      .need-consent a:hover { text-decoration: underline; }
      .need-consent a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .empty { margin: 4px 4px 8px; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor, 0.75rem)); }
      /* Phone: a sheet above the feedback launcher's lane, never cut by the mobile URL bar. */
      @media (max-width: 749px) {
        .mk { position: static; }
        .panel {
          position: fixed; left: 8px; right: 8px; top: auto; width: auto;
          bottom: calc(var(--sc-float-bottom) + var(--sc-fab-clear-block, 0px));
          max-height: calc(100vh - 120px); max-height: calc(100dvh - 120px);
        }
      }
      /* Touch floor of the gate: 48 px (a 44 px value measures 43), by pointer, not by width, so tablets pass too. */
      @media (pointer: coarse), (max-width: 749px) {
        .trigger { width: 48px; height: 48px; }
        .all, .more { min-height: 48px; }
        .qrow { min-height: 52px; }
      }
    `,
  ],
})
export class MerklisteComponent {
  protected readonly svc = inject(MerklisteService);
  protected readonly consent = inject(ConsentService);
  private readonly cart = inject(WishCartService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panelId = 'sc-merkliste-panel';
  protected readonly frame = FRAME_ICON;
  protected readonly shown = MERK_RECENT_SHOWN;
  protected readonly open = signal(false);
  protected readonly more = signal(false);
  protected readonly type = this.svc.type;
  protected readonly typeLabel = computed(() => {
    const t: MerkType | null = this.type();
    return t ? MERK_TYPE_LABEL[t] : null;
  });
  protected readonly shownRecent = computed(() => (this.more() ? this.svc.recent() : this.svc.recent().slice(0, MERK_RECENT_SHOWN)));

  /** The silhouette kind of a row; news and untyped rows draw their kind icon. */
  protected thumbKind(r: MerkRow): string {
    return r.kind ?? r.type;
  }

  protected sub(r: MerkRow): string | null {
    return r.subtitleKey ?? (r.kind ? `cart.kind.${r.kind}` : null);
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.svc.refresh();
    this.more.set(false);
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** "Ganze Wunschliste": a real anchor to this page with `?cart=1`; the plain click opens the cart in place. */
  protected onCart(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.close();
    void this.cart.open();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(ev: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.close();
  }
}
