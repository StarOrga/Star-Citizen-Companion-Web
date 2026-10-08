import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexSearchHub } from './codex-search-hub.service';

/**
 * "Search the whole Codex" as a compact button in a page header.
 *
 * Pages with a list filter of their own (/codex/index, /codex/fps) place it in
 * their header's aside. While it is mounted the shell's slim Codex bar tucks
 * away (CodexSearchHub.tucked): the page shows ONE field — its own filter —
 * instead of two stacked ones with different jobs. A click, Ctrl+K, "/" or a
 * letter typed on the page still bring the global bar forward, big and
 * focused; when it collapses again, focus comes back here.
 */
@Component({
  selector: 'sc-codex-search-trigger',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #btn
      type="button"
      class="trigger"
      aria-keyshortcuts="Control+K /"
      [attr.aria-expanded]="hub.expanded()"
      [attr.aria-label]="'codex.search.trigger.label' | translate"
      [scTooltip]="'codex.search.trigger.tooltip' | translate"
      (click)="open()">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
      </svg>
      <span class="label" aria-hidden="true">{{ 'codex.search.trigger.label' | translate }}</span>
      <kbd class="key" aria-hidden="true">{{ 'codex.search.bar.shortcut' | translate }}</kbd>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; }
    .trigger {
      display: inline-flex; align-items: center; gap: 8px;
      min-height: 32px; padding: 4px 8px 4px 10px; border-radius: 6px; cursor: pointer;
      font-family: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1);
      background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
      transition: border-color 0.16s, color 0.16s, background 0.16s;
    }
    .trigger:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .trigger[aria-expanded='true'] { border-color: var(--sc-accent); color: var(--sc-accent); }
    .icon { width: 16px; height: 16px; flex: none; color: var(--sc-accent); }
    .key {
      padding: 1px 6px; border-radius: 4px;
      font-family: var(--sc-font-mono, monospace); font-size: max(0.7rem, var(--sc-fs-floor));
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-2);
    }
    @media (pointer: coarse) {
      .trigger { min-height: 48px; }
      .key { display: none; }
    }
    /* A phone: the app header's magnifier already opens this same search
       (it calls the hub too), and here the button would cost a row of its
       own above the title. It stays mounted, so the slim bar stays tucked. */
    @media (max-width: 720px) {
      :host { display: none; }
    }
  `],
})
export class CodexSearchTriggerComponent {
  readonly hub = inject(CodexSearchHub);
  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');

  constructor() {
    const unregister = this.hub.registerTrigger({ focus: () => this.btn().nativeElement.focus() });
    inject(DestroyRef).onDestroy(unregister);
  }

  open(): void {
    this.hub.activate();
  }
}
