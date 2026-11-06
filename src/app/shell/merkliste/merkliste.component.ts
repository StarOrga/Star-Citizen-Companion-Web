import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { SEARCH_KIND_ICONS } from '../fusion-bar/search-icons';
import { ShellChromeService } from '../fusion-bar/shell-chrome.service';
import { MERK_TYPE_LABEL, type MerkRow, type MerkType } from './merkliste.model';
import { MerklisteService } from './merkliste.service';

const NEWS_ICON = ['M4 5h13v14H4z', 'M17 9h3v8a2 2 0 0 1-2 2', 'M7 9h7M7 12h7M7 15h4'] as const;

type Tab = 'type' | 'nachschub';

/**
 * `<sc-merkliste>` - the one bookmark icon in the header (concept r2-merk = panel, mock r2-mer-v1-*).
 * The number counts open Nachschub lines + wishes + bookmarked posts; at 0 nothing renders. The
 * panel is cut by the page type: Codex and HQ ships show "Zuletzt geoeffnet" and "Auf der
 * Wunschliste", News shows "Zuletzt gelesen" and "Gemerkte Beitraege"; the Nachschub tab sits
 * inside, so the header carries one icon only. Every row is a real anchor. A non-modal
 * `[scDialog]` gives focus in, Escape and focus return; on phones the panel is a sheet in dvh
 * above the feedback launcher's lane.
 */
@Component({
  selector: 'sc-merkliste',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.count() > 0) {
      <div class="mk">
        <button #trigger type="button" class="trigger" [class.on]="open()" (click)="toggle()"
                aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? panelId : null"
                [attr.aria-label]="'merkliste.aria' | translate: { count: svc.count(), wishes: svc.wishCount(), supply: svc.supplyOpen(), posts: svc.bookmarkCount() }"
                [scTooltip]="'merkliste.aria' | translate: { count: svc.count(), wishes: svc.wishCount(), supply: svc.supplyOpen(), posts: svc.bookmarkCount() }" scTooltipTier="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path [attr.d]="wishPath" />
          </svg>
          <b>{{ svc.count() }}</b>
        </button>
        @if (open()) {
          <div class="panel" [id]="panelId" role="dialog" scDialog [scDialogModal]="false" [scDialogReturnFocus]="trigger"
               (scDialogEscape)="close()" [attr.aria-label]="'merkliste.title' | translate">
            <div class="tabs" role="tablist" [attr.aria-label]="'merkliste.title' | translate">
              <button type="button" role="tab" class="tab" [class.on]="tab() === 'type'" [attr.aria-selected]="tab() === 'type'" (click)="tab.set('type')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  @for (d of iconPaths(type()); track $index) { <path [attr.d]="d" /> }
                </svg>
                <span>{{ typeLabel() | translate }}</span>
              </button>
              <button type="button" role="tab" class="tab" [class.on]="tab() === 'nachschub'" [attr.aria-selected]="tab() === 'nachschub'" (click)="tab.set('nachschub')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  @for (d of nachschubPaths; track $index) { <path [attr.d]="d" /> }
                </svg>
                <span>{{ 'merkliste.nachschub' | translate }}</span>
                @if (svc.supplyOpen() > 0) { <b>{{ svc.supplyOpen() }}</b> }
              </button>
            </div>

            @if (tab() === 'type') {
              @if (type() === 'news') {
                <ng-container *ngTemplateOutlet="section; context: { heading: 'merkliste.newsRead', rows: svc.newsRead(), empty: 'merkliste.emptyRead' }" />
                <ng-container *ngTemplateOutlet="section; context: { heading: 'merkliste.newsSaved', rows: svc.newsSaved(), empty: 'merkliste.emptySaved' }" />
              } @else {
                <ng-container *ngTemplateOutlet="section; context: { heading: 'merkliste.recent', rows: svc.recent(), empty: 'merkliste.emptyRecent' }" />
                <ng-container *ngTemplateOutlet="section; context: { heading: 'merkliste.wished', rows: svc.wishedShown(), empty: 'merkliste.emptyWished', all: true }" />
              }
            } @else {
              <section class="sec">
                @if (svc.supplyLines().length) {
                  <ul class="lines">
                    @for (l of svc.supplyLines(); track l.id) {
                      <li><span class="ln">{{ l.name }}</span><b class="qty">×{{ l.qty }}</b></li>
                    }
                  </ul>
                } @else {
                  <p class="empty">{{ 'merkliste.emptyNachschub' | translate }}</p>
                }
                <button scAction tier="secondary" type="button" class="open-sup" (click)="openSupplies('nachschub')">
                  <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                    @for (d of nachschubPaths; track $index) { <path [attr.d]="d" /> }
                  </svg>
                  <span>{{ 'merkliste.openNachschub' | translate }}</span>
                </button>
              </section>
            }
          </div>
        }
      </div>
    }

    <ng-template #section let-heading="heading" let-rows="rows" let-empty="empty" let-all="all">
      <section class="sec">
        <h4>{{ heading | translate }}</h4>
        @for (r of rows; track r.id) {
          <a class="row" [routerLink]="r.target!.link" [queryParams]="r.target!.queryParams" (click)="close()">
            <span class="kind">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                @for (d of iconPaths(r.type); track $index) { <path [attr.d]="d" /> }
              </svg>
            </span>
            <span class="rt"><b>{{ r.title }}</b>@if (sub(r); as s) { <small>{{ s | translate }}</small> }</span>
          </a>
        } @empty {
          <p class="empty">{{ empty | translate }}</p>
        }
        @if (all) {
          <a class="all" routerLink="/hq" (click)="onAll($event)">{{ 'merkliste.allWishes' | translate }} ›</a>
        }
      </section>
    </ng-template>
  `,
  styles: [
    `
      :host { display: contents; }
      .mk { position: relative; display: inline-flex; }
      .trigger {
        display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; border-radius: 8px;
        border: 1px solid var(--sc-border); background: transparent; color: var(--sc-accent); font: inherit; cursor: pointer;
      }
      .trigger svg { width: 18px; height: 18px; }
      .trigger b { font-weight: 600; font-size: max(0.75rem, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
      .trigger:hover, .trigger.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .panel {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; width: min(23rem, calc(100vw - 32px));
        max-height: min(32rem, calc(100dvh - 120px)); overflow: auto; padding: 12px; border-radius: 12px;
        border: 1px solid var(--sc-border); background: var(--sc-bg-1); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
      }
      .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--sc-border); padding-bottom: 8px; }
      .tab {
        display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 8px;
        border: 1px solid transparent; background: transparent; color: var(--sc-fg-1); font: inherit; cursor: pointer;
      }
      .tab svg { width: 16px; height: 16px; }
      .tab b { font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-accent); }
      .tab:hover { color: var(--sc-fg-0); }
      .tab.on { color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .sec { margin-top: 10px; }
      h4 { margin: 0 0 4px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); font-weight: 500; }
      .row {
        display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 3px 4px; border-radius: 8px;
        color: var(--sc-fg-0); text-decoration: none;
      }
      .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); outline: none; }
      .row:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent); }
      .kind { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; background: color-mix(in srgb, var(--sc-accent) 8%, transparent); color: var(--sc-fg-1); }
      .kind svg { width: 15px; height: 15px; }
      .rt { display: flex; flex-direction: column; min-width: 0; }
      .rt b { font-weight: 500; overflow-wrap: anywhere; }
      .rt small { color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); }
      .all { display: inline-flex; align-items: center; min-height: 36px; padding: 0 4px; color: var(--sc-accent); text-decoration: none; }
      .all:hover { text-decoration: underline; }
      .all:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .empty { margin: 4px 4px 8px; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .lines { list-style: none; margin: 0 0 8px; padding: 0; }
      .lines li { display: flex; justify-content: space-between; gap: 10px; min-height: 36px; align-items: center; padding: 0 4px; border-bottom: 1px solid var(--sc-border); }
      .ln { overflow-wrap: anywhere; }
      .qty { font-variant-numeric: tabular-nums; color: var(--sc-fg-1); }
      .open-sup { margin-top: 6px; }
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
        .tab { min-height: 48px; }
        .trigger { min-height: 48px; min-width: 48px; justify-content: center; }
      }
    `,
  ],
})
export class MerklisteComponent {
  protected readonly svc = inject(MerklisteService);
  private readonly chrome = inject(ShellChromeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panelId = 'sc-merkliste-panel';
  protected readonly wishPath = PATH_ICONS.wish[0];
  protected readonly nachschubPaths = PATH_ICONS.nachschub;
  protected readonly open = signal(false);
  protected readonly tab = signal<Tab>('type');
  protected readonly type = this.svc.type;
  protected readonly typeLabel = computed(() => { const t = this.type(); return t ? MERK_TYPE_LABEL[t] : 'merkliste.type.all'; });

  protected iconPaths(type: MerkType | null): readonly string[] {
    if (type === 'news') return NEWS_ICON;
    return SEARCH_KIND_ICONS[type ?? 'page'];
  }

  protected sub(r: MerkRow): string | null {
    return r.subtitleKey ?? null;
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.svc.refresh();
    this.tab.set('type');
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected openSupplies(tab: 'wishlist' | 'nachschub'): void {
    this.close();
    this.chrome.openSupplies(tab);
  }

  /** "Ganze Wunschliste": the plain click opens the popup's wishlist tab; modified clicks follow the anchor to the HQ. */
  protected onAll(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.openSupplies('wishlist');
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(ev: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.close();
  }
}
