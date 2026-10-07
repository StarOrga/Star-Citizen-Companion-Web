import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../shared/dialog/sc-dialog.directive';
import { CodexSearchEngine } from '../codex/search/codex-search-engine';
import { CodexSearchResultsComponent } from '../codex/search/codex-search-results.component';
import { CodexSearchHub, isEditableTarget, isTypeToSearchKey } from '../codex/search/codex-search-hub.service';

/**
 * Ctrl+K / "/" and the header's search button.
 *
 * On a Codex page they do not open anything: the page's own Codex search bar
 * comes forward (CodexSearchHub), and typing a letter on the page does the
 * same. Everywhere else they open this overlay — the same Codex search (one
 * engine, one renderer), as a CDK overlay on desktop and a full-screen sheet
 * on a phone.
 */
@Component({
  selector: 'sc-quick-search',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective, CodexSearchResultsComponent],
  providers: [CodexSearchEngine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The glyph is an inline SVG, not the ⌕ character it used to be: that
         codepoint renders at wildly different weights and sizes per font (and is
         missing entirely from some Android system fonts). -->
    <button type="button" class="trigger" (click)="trigger()" aria-keyshortcuts="Control+K /"
            [attr.aria-label]="'quickSearch.open' | translate">
      <svg class="trigger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <line x1="15.4" y1="15.4" x2="21" y2="21" />
      </svg>
      <span class="trigger-label">{{ 'quickSearch.open' | translate }}</span>
      <kbd>{{ 'codex.search.bar.shortcut' | translate }}</kbd>
    </button>

    <!-- Rendered through a CDK overlay (portaled to <body>) rather than inline:
         the app header (.topbar) uses backdrop-filter, which establishes a
         containing block for position:fixed descendants. Inline, the full-screen
         backdrop would be clipped to the header instead of covering the viewport. -->
    <ng-template #overlayTpl>
      <div class="overlay" (click)="close()">
        <div class="panel sc-card" role="dialog" aria-modal="true" scDialog (scDialogEscape)="onEscape()"
             [attr.aria-label]="'codex.search.bar.label' | translate" (click)="$event.stopPropagation()">
          <div class="field">
            <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
            </svg>
            <input
              class="qs-input"
              type="search"
              role="combobox"
              autocomplete="off"
              spellcheck="false"
              aria-autocomplete="list"
              aria-expanded="true"
              [attr.aria-controls]="listboxId"
              [attr.aria-activedescendant]="activeDescendant()"
              [value]="engine.input()"
              (input)="engine.setInput($any($event.target).value)"
              (keydown)="onKeydown($event)"
              [attr.aria-label]="'codex.search.bar.label' | translate"
              [attr.placeholder]="'codex.search.bar.placeholder' | translate" />
          </div>
          <sc-codex-search-results
            class="qs-results"
            [engine]="engine"
            [listboxId]="listboxId"
            variant="overlay"
            (navigated)="close()"
            (searched)="focusField()" />
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }
    .trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-radius: 6px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); cursor: pointer; font-family: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
    }
    .trigger:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .trigger-icon { width: 18px; height: 18px; flex: 0 0 auto; }
    .trigger kbd {
      font-size: max(0.62rem, var(--sc-fs-floor)); padding: 1px 5px; border-radius: 4px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: var(--sc-font-mono, monospace);
    }

    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0, 0, 0, 0.68);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; justify-content: center; align-items: flex-start;
      padding: 12vh 16px 16px;
    }
    .panel {
      width: 100%; max-width: 680px; max-height: 76dvh; overflow: hidden;
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
    }
    .field {
      display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-accent);
    }
    .field:focus-within { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
    .glyph { width: 20px; height: 20px; flex: none; color: var(--sc-accent); }
    .qs-input {
      flex: 1; min-width: 0; padding: 12px 0; background: transparent; border: 0; outline: none;
      color: var(--sc-fg-0); font-family: inherit; font-size: 1rem;
    }
    .qs-input::-webkit-search-cancel-button { display: none; }
    /* The results are the scroll port; the field stays put above them. */
    .qs-results { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; }

    @media (max-width: 720px) {
      .trigger-label { display: none; }
      .trigger kbd { display: none; }
      /* Icon-only: a bare magnifier, no box (admin feedback 4e54ad2c round 3).
         The button keeps a full 48px touch target, it just does not paint one. */
      .trigger {
        background: transparent; border-color: transparent; padding: 0;
        min-width: 48px; min-height: 48px; justify-content: center;
        color: var(--sc-fg-0);
      }
      .trigger:hover, .trigger:active { background: transparent; border-color: transparent; }
      .trigger:focus-visible { border-radius: 8px; }
      .trigger-icon { width: 26px; height: 26px; stroke-width: 1.9; }

      /* A full-screen sheet on a phone (admin feedback 3bc01a3d): no docked
         strip above the field, no inset frame inside the backdrop. */
      .overlay { padding: 0; }
      .panel {
        max-width: none; max-height: none; height: 100%;
        padding: var(--sc-pad-2); padding-top: max(var(--sc-pad-2), env(safe-area-inset-top));
        border-radius: 0; border-inline-width: 0; border-block-width: 0;
      }
    }
  `],
})
export class QuickSearchComponent {
  readonly engine = inject(CodexSearchEngine);
  private readonly hub = inject(CodexSearchHub);
  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);

  private readonly overlayTpl = viewChild.required<TemplateRef<unknown>>('overlayTpl');
  private overlayRef: OverlayRef | null = null;

  readonly visible = signal(false);
  readonly listboxId = 'qs-results-list';

  readonly activeDescendant = computed(() => {
    const o = this.engine.activeOption();
    return o ? `${this.listboxId}-${o.id}` : null;
  });

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent): void {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (this.visible()) this.close();
      else this.trigger();
      return;
    }
    if (this.visible()) return;
    // Escape is handled by ScDialogDirective on the panel: focus is trapped
    // there while open.
    if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      this.trigger();
      return;
    }
    // Type-to-search: a letter typed on a Codex page starts the page's search.
    if (this.hub.hasBar() && isTypeToSearchKey(ev)) {
      ev.preventDefault();
      this.hub.activate(ev.key);
    }
  }

  /** Ctrl+K, "/" and the header button: the Codex bar on a Codex page, else the overlay. */
  trigger(): void {
    if (!this.hub.activate()) this.open();
  }

  open(): void {
    if (this.visible()) return;
    this.visible.set(true);
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
    });
    overlayRef.attach(new TemplatePortal(this.overlayTpl(), this.viewContainer));
    this.overlayRef = overlayRef;
    this.engine.ensureSuggestions();
    // Focus: ScDialogDirective moves it to the first tabbable element (.qs-input).
  }

  close(): void {
    this.visible.set(false);
    this.engine.clear();
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  /** Esc clears a typed term first, closes on an empty field. */
  onEscape(): void {
    if (this.engine.input()) {
      this.engine.clear();
      this.focusField();
    } else {
      this.close();
    }
  }

  focusField(): void {
    setTimeout(() => this.overlayRef?.overlayElement.querySelector<HTMLInputElement>('.qs-input')?.focus());
  }

  onKeydown(ev: KeyboardEvent): void {
    const action = this.engine.keyAction(ev);
    if (action === 'escape') {
      // ScDialogDirective also sees this Escape (scDialogEscape → onEscape).
      ev.stopPropagation();
      this.onEscape();
      return;
    }
    if (action !== 'open' && action !== 'open-new-tab') {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') this.scrollActiveIntoView();
      return;
    }
    const opt = this.engine.enterOption();
    if (!opt) return;
    const result = this.engine.open(opt, action === 'open-new-tab');
    if (result === 'navigated') this.close();
    else if (result === 'searched') this.focusField();
  }

  private scrollActiveIntoView(): void {
    const id = this.activeDescendant();
    if (!id) return;
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
  }
}
