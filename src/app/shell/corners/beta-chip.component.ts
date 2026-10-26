import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BETA_AREAS, BetaService } from '../../core/beta.service';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ShellChromeService } from '../fusion-bar/shell-chrome.service';

/**
 * The beta chip, top-right (shell beta, spec §0): a compact chip that opens
 * the area toggles (verse, codex, shell). Admins and collaborators only, so
 * it carries the elevated-access red AND says the role in words. It replaces
 * the two bottom-left beta docks while the `shell` beta is on
 * (`BetaDockComponent` hides itself for the people who get this chip).
 */
@Component({
  selector: 'sc-beta-chip',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside class="chip-wrap" [class.bar-hidden]="chrome.barHidden() && !open()" [attr.aria-label]="'beta.aria' | translate">
        <button #chipBtn type="button" class="chip" [attr.aria-expanded]="open()" aria-haspopup="dialog"
                [attr.aria-label]="(roles.isAdmin() ? 'beta.chip.admin' : 'beta.chip.collaborator') | translate"
                (click)="open.set(!open())">
          <span class="mark" aria-hidden="true">β</span>
          <span class="role">{{ (roles.isAdmin() ? 'beta.chip.admin' : 'beta.chip.collaborator') | translate }}</span>
        </button>
        @if (open()) {
          <div class="panel" scDialog role="dialog" [attr.aria-label]="'beta.chip.title' | translate"
               (keydown.escape)="open.set(false)">
            <p class="head">{{ 'beta.chip.title' | translate }}</p>
            @for (area of areas; track area) {
              <button type="button" role="switch" class="sw"
                      [attr.aria-checked]="beta.state()[area]"
                      [disabled]="beta.locked()[area]"
                      (click)="beta.toggle(area)">
                <span class="label">{{ ('beta.area.' + area) | translate }}</span>
                <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
              </button>
            }
            <p class="note">{{ 'beta.chip.note' | translate }}</p>
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Top-right, vertically centred on the bar's capsule: the bar reserves the
       chip's lane (--sc-chip-lane, published below) at its inline end, so the two
       share the row instead of stacking. The chip slides away with the bar. */
    .chip-wrap {
      --_h: max(var(--sc-tap-min), 32px);
      position: fixed; z-index: 45;
      top: calc(var(--sc-imp-banner-h, 0px) + 6px + (var(--sc-bar-h) - var(--sc-space-2) - var(--_h)) / 2);
      right: max(var(--sc-space-3), env(safe-area-inset-right));
      display: flex; flex-direction: column; align-items: flex-end; gap: var(--sc-space-2);
      transition: transform var(--sc-bar-hide-ms) cubic-bezier(0.2, 0.8, 0.2, 1), opacity var(--sc-bar-hide-ms) ease;
    }
    .chip-wrap.bar-hidden { transform: translateY(calc(-100% - var(--sc-space-4))); opacity: 0; pointer-events: none; }
    .chip-wrap.bar-hidden:focus-within { transform: none; opacity: 1; pointer-events: auto; }
    .chip {
      display: inline-flex; align-items: center; gap: var(--sc-space-2);
      height: var(--_h); padding: 0 var(--sc-space-3);
      font: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer;
      color: var(--sc-accent-hot);
      background: color-mix(in srgb, var(--sc-bg-1) 88%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent-hot) 55%, var(--sc-border));
      border-radius: 999px; backdrop-filter: blur(8px);
    }
    .chip:hover { background: color-mix(in srgb, var(--sc-accent-hot) 14%, var(--sc-bg-1)); }
    .chip:focus-visible, .sw:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .mark { font-family: var(--sc-font-display); font-weight: 700; }
    .role { letter-spacing: 0.06em; text-transform: uppercase; }
    .panel {
      display: flex; flex-direction: column; gap: var(--sc-space-1);
      min-width: 220px; padding: var(--sc-space-3);
      background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      border: 1px solid var(--sc-border); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px);
    }
    .head { margin: 0 0 var(--sc-space-1); font-family: var(--sc-font-display); letter-spacing: 0.08em;
      text-transform: uppercase; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .note { margin: var(--sc-space-1) 0 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sw {
      display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3);
      min-height: var(--sc-tap-min); padding: 0 var(--sc-space-2); border: 0; border-radius: 8px;
      background: none; color: var(--sc-fg-1); font: inherit; cursor: pointer;
    }
    .sw:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .sw:disabled { opacity: 0.45; cursor: not-allowed; }
    .label { font-size: max(0.82rem, var(--sc-fs-floor)); }
    .knob-track { position: relative; width: 38px; height: 22px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); transition: background 0.16s; }
    .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-fg-2); transition: transform 0.16s, background 0.16s; }
    .sw[aria-checked='true'] .knob-track { background: color-mix(in srgb, var(--sc-accent) 35%, transparent); border-color: var(--sc-accent); }
    .sw[aria-checked='true'] .knob { transform: translateX(16px); background: var(--sc-accent); }
    /* Phone: the chip sits in the top strip as the bare β (role is the aria-label). */
    @media (max-width: 720px) {
      /* The bar is at the bottom: the top-right corner is free. The bare β; the role is its aria-label. */
      .chip-wrap { top: calc(var(--sc-safe-top, 0px) + var(--sc-space-2)); }
      .chip-wrap.bar-hidden { transform: none; opacity: 1; pointer-events: auto; }
      .role { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .knob, .knob-track { transition: none; } }
  `],
})
export class BetaChipComponent {
  protected readonly beta = inject(BetaService);
  protected readonly roles = inject(RoleService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly chrome = inject(ShellChromeService);
  private readonly doc = inject(DOCUMENT);
  private readonly chipBtn = viewChild<ElementRef<HTMLElement>>('chipBtn');
  protected readonly areas = BETA_AREAS;
  protected readonly open = signal(false);
  /** Only with the shell beta on, and only for admins / collaborators. */
  protected readonly visible = computed(() => this.beta.state().shell && this.roles.isCollaborator());

  constructor() {
    // Publish the chip's width as the lane the bar leaves free at its inline end.
    effect((onCleanup) => {
      const el = this.chipBtn()?.nativeElement;
      if (!el) return;
      const root = this.doc.documentElement;
      const publish = () => root.style.setProperty('--sc-chip-lane', `${Math.ceil(el.getBoundingClientRect().width) + 24}px`);
      publish();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
      ro?.observe(el);
      onCleanup(() => {
        ro?.disconnect();
        root.style.removeProperty('--sc-chip-lane');
      });
    });
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    const wrap = (this.host.nativeElement as HTMLElement).querySelector('.chip-wrap');
    if (wrap && !wrap.contains(ev.target as Node)) this.open.set(false);
  }
}
