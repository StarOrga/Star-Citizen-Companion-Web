import { DestroyRef, Directive, TemplateRef, ViewContainerRef, effect, inject, untracked } from '@angular/core';
import { BetaService } from '../../core/beta.service';
import { ShellChromeService } from './shell-chrome.service';

/**
 * A tool page's filter toolbar. With the shell β off it renders in place,
 * exactly as before. With it on the template is handed to the Fusion bar,
 * which shows it as the drawer that folds out of the search and stays pinned
 * with the bar (spec §4 "the drawer IS the tool toolbar").
 *
 * The embedded view keeps its declaring component's context and styles — the
 * bar only decides WHERE it is inserted.
 *
 * Usage: `<div class="controls" *scBarToolbar>…</div>`.
 */
@Directive({ selector: '[scBarToolbar]', standalone: true })
export class BarToolbarDirective {
  constructor() {
    const tpl = inject(TemplateRef<unknown>);
    const vcr = inject(ViewContainerRef);
    const chrome = inject(ShellChromeService);
    const shellOn = inject(BetaService).isEnabled('shell');
    let unregister: (() => void) | null = null;

    effect(() => {
      const on = shellOn();
      untracked(() => {
        unregister?.();
        unregister = null;
        vcr.clear();
        if (on) unregister = chrome.registerToolbar(tpl);
        else vcr.createEmbeddedView(tpl);
      });
    });

    inject(DestroyRef).onDestroy(() => unregister?.());
  }
}
