import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  Injector,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexSearchEngine } from './codex-search-engine';
import { CodexSearchResultsComponent } from './codex-search-results.component';
import { CodexSearchHub } from './codex-search-hub.service';

let nextId = 0;

/**
 * The Codex search bar — the ONE Codex search as a page element. Two homes:
 *   terminal — the landing's Archive Terminal row;
 *   compact  — a slim row above every other Codex page (mounted by the shell).
 * Clicking it, focusing it, typing on the page, Ctrl+K, "/" or the header's
 * search button (all routed through CodexSearchHub) bring it forward: it
 * grows, takes focus, opens its grouped results below itself and dims the
 * rest of the page. It is absolutely positioned inside a host of fixed
 * height, so expanding never moves the page underneath. Esc, a click on the
 * dimmed page, focus leaving an empty field or a navigation put it back.
 */
@Component({
  selector: 'sc-codex-search-bar',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, CodexSearchResultsComponent],
  providers: [CodexSearchEngine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.terminal]': "variant() === 'terminal'",
    '[class.compact]': "variant() === 'compact'",
    '[class.active]': 'active()',
  },
  template: `
    @if (active()) {
      <div class="dim" aria-hidden="true" (click)="collapse()"></div>
    }
    <div class="shell" [class.active]="active()" (focusout)="onFocusOut($event)" role="search">
      <div class="field" (click)="onFieldClick($event)">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
        </svg>
        <input
          #field
          class="input"
          type="search"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
          aria-keyshortcuts="Control+K /"
          [attr.aria-expanded]="active()"
          [attr.aria-controls]="listboxId"
          [attr.aria-activedescendant]="activeDescendant()"
          [attr.aria-label]="'codex.search.bar.label' | translate"
          [attr.placeholder]="'codex.search.bar.placeholder' | translate"
          [value]="engine.input()"
          (input)="onInput($event)"
          (focus)="activate()"
          (keydown)="onKeydown($event)"
        />
        @if (engine.input()) {
          <button type="button" class="clear" (click)="clearField($event)"
                  [attr.aria-label]="'codex.search.bar.clear' | translate"
                  [scTooltip]="'codex.search.bar.clear' | translate" scTooltipTier="label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        } @else if (!active()) {
          <kbd class="hint" aria-hidden="true">{{ 'codex.search.bar.shortcut' | translate }}</kbd>
        }
      </div>
      @if (active()) {
        <div class="panel">
          <sc-codex-search-results
            [engine]="engine"
            [listboxId]="listboxId"
            variant="page"
            [showPin]="true"
            (navigated)="onNavigated()"
            (searched)="focusInput()" />
        </div>
      }
    </div>
  `,
  styles: [`
    /* The host keeps the slim height in the page flow; the shell paints on top
       of it, so growing never shifts what follows. */
    :host { --bar-h: 40px; display: block; position: relative; height: var(--bar-h); }
    /* --sc-tap-min is 0px on a fine pointer, so it cannot be the height here:
       a 0px host let the field hang over the row below the terminal. */
    :host(.terminal) { --bar-h: 44px; }
    /* Active terminal: the shell spans the whole terminal row (the landing
       makes that row the positioning context) and leads the page. */
    :host(.terminal.active) { position: static; }

    .dim {
      position: fixed; inset: 0; z-index: 90;
      background: rgba(2, 6, 12, 0.62);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      animation: dim-in 0.18s ease-out;
    }
    .shell {
      position: absolute; top: 0; left: 0; right: 0; display: flex; flex-direction: column;
      /* Room above the bar when it scrolls itself to the top of a phone screen. */
      scroll-margin-top: 12px;
    }
    .shell.active { z-index: 91; }

    .field {
      display: flex; align-items: center; gap: 10px; min-height: var(--bar-h); padding: 0 6px 0 12px;
      border-radius: 4px; cursor: text;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 26%, var(--sc-border));
      background:
        radial-gradient(140% 160% at 0% 0%, color-mix(in srgb, var(--sc-accent) 9%, transparent), transparent 60%),
        var(--sc-bg-1);
      transition: min-height 0.18s ease, border-color 0.16s, box-shadow 0.18s, padding 0.18s;
    }
    .field:hover { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    .shell.active .field {
      min-height: 58px; padding: 0 8px 0 16px; border-color: var(--sc-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 22%, transparent), 0 18px 48px rgba(0, 0, 0, 0.5);
    }
    .glyph { width: 18px; height: 18px; flex: none; color: var(--sc-accent); transition: width 0.18s, height 0.18s; }
    .shell.active .glyph { width: 22px; height: 22px; }
    .input {
      flex: 1; min-width: 0; background: transparent; border: 0; outline: none; padding: 8px 0;
      color: var(--sc-fg-0); font: inherit; font-size: max(0.92rem, var(--sc-fs-floor, 0.9rem));
      transition: font-size 0.18s;
    }
    /* A phone shows the start of the placeholder and an ellipsis, not a hard cut. */
    .input { text-overflow: ellipsis; }
    .input::placeholder { color: var(--sc-fg-2); text-overflow: ellipsis; }
    .input::-webkit-search-cancel-button { display: none; }
    .shell.active .input { font-size: 1.15rem; }
    .clear {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: 0; border-radius: 6px; background: none; color: var(--sc-fg-2); cursor: pointer;
    }
    .clear svg { width: 16px; height: 16px; }
    .clear:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }
    .clear:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .hint {
      flex: none; margin-right: 6px; padding: 1px 6px; border-radius: 4px;
      font-family: var(--sc-font-mono, monospace); font-size: max(0.66rem, var(--sc-fs-floor));
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-2);
    }

    .panel {
      margin-top: 8px; padding: 10px; border-radius: 6px; overflow-y: auto; overscroll-behavior: contain;
      /* --panel-max is measured from the field's bottom to the visible
         viewport's bottom (keyboard included); the calc is the first frame. */
      max-height: var(--panel-max, calc(100dvh - var(--sc-topbar-h, 64px) - 120px));
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
      background: var(--sc-bg-1); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
      animation: panel-in 0.18s ease-out;
    }

    @keyframes dim-in { from { opacity: 0; } }
    @keyframes panel-in { from { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) {
      .dim, .panel { animation: none; }
      .field, .glyph, .input { transition: none; }
    }
    @media (pointer: coarse) {
      :host { --bar-h: 48px; }
      .clear { width: 48px; height: 48px; }
      .hint { display: none; }
    }
    @media (max-width: 720px) {
      .hint { display: none; }
      .shell.active .field { min-height: 52px; }
      .panel { padding: 8px 6px; }
    }
  `],
})
export class CodexSearchBarComponent {
  readonly engine = inject(CodexSearchEngine);
  private readonly hub = inject(CodexSearchHub);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Where the bar lives: the landing's terminal row, or the slim row above a Codex page. */
  readonly variant = input<'terminal' | 'compact'>('compact');
  /** A term handed in from the URL (`/codex?q=`) — searched and shown. */
  readonly query = input<string | null>(null);

  readonly active = signal(false);
  readonly listboxId = `sc-codex-search-${nextId++}`;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly activeDescendant = computed(() => {
    const o = this.engine.activeOption();
    return this.active() && o ? `${this.listboxId}-${o.id}` : null;
  });

  constructor() {
    const unregister = this.hub.register({ activate: (seed) => this.activate(seed, true) });
    inject(DestroyRef).onDestroy(unregister);

    effect(() => {
      this.engine.perGroup.set(this.variant() === 'terminal' ? 8 : 6);
    });

    effect(() => {
      const q = this.query();
      if (q == null) return;
      untracked(() => {
        if (q.trim() && q !== this.engine.input()) {
          this.engine.searchFor(q);
          this.activate();
        }
      });
    });

    // The panel fits between the field and the bottom of what is visible —
    // a phone keyboard or a resized window changes that while it is open.
    if (typeof window !== 'undefined') {
      const refit = () => {
        if (this.active()) this.fitPanel();
      };
      const vv = window.visualViewport;
      window.addEventListener('resize', refit, { passive: true });
      window.addEventListener('scroll', refit, { passive: true });
      vv?.addEventListener('resize', refit, { passive: true });
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('resize', refit);
        window.removeEventListener('scroll', refit);
        vv?.removeEventListener('resize', refit);
      });
    }

    // Any navigation (a hit, "all N", a link elsewhere) puts the bar back.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.active()) this.collapse(true);
      });
  }

  /**
   * Bring the bar forward. `seed` (type-to-search) replaces the field with the
   * typed character; `fromShortcut` also scrolls the page up to the bar.
   */
  activate(seed?: string, fromShortcut = false): void {
    const wasActive = this.active();
    // Keys typed before the field had focus append — fast typing must not
    // restart the term with every letter.
    if (seed != null) this.engine.setInput(wasActive ? this.engine.input() + seed : seed);
    this.active.set(true);
    this.engine.ensureSuggestions();
    if (!wasActive && typeof window !== 'undefined') {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
      if (fromShortcut) {
        window.scrollTo({ top: 0, behavior });
      } else if (window.matchMedia?.('(max-width: 720px)').matches) {
        // A phone: the bar further down the page becomes the page's lead —
        // it moves to the top so the results get the screen below it.
        this.host.nativeElement.querySelector('.shell')?.scrollIntoView({ block: 'start', behavior });
      }
    }
    afterNextRender(() => this.fitPanel(), { injector: this.injector });
    if (fromShortcut) this.focusInput(seed == null);
  }

  /** Cap the results panel at the space between the field and the visible viewport's bottom. */
  private fitPanel(): void {
    if (typeof window === 'undefined') return;
    const host = this.host.nativeElement;
    const field = host.querySelector('.field');
    if (!field) return;
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    // 8px gap above the panel, 12px air below it; never squeeze below a few rows.
    const room = Math.round(bottom - field.getBoundingClientRect().bottom - 8 - 12);
    host.style.setProperty('--panel-max', `${Math.max(180, room)}px`);
  }

  /** Back to the slim bar. `clear` also empties the field (after a navigation). */
  collapse(clear = false): void {
    this.active.set(false);
    this.engine.setActive(-1);
    if (clear) this.engine.clear();
    const el = this.field().nativeElement;
    if (document.activeElement === el) el.blur();
  }

  /** A click on the field's chrome focuses the input; a click IN the input keeps the caret/selection the user placed. */
  onFieldClick(ev: MouseEvent): void {
    if (ev.target === this.field().nativeElement) {
      if (!this.active()) this.activate();
      return;
    }
    this.focusInput();
  }

  focusInput(select = false): void {
    // Focus now (the field always exists), so the next keystroke already lands
    // in it; the after-render pass re-applies caret/selection to the new value.
    this.applyFocus(select);
    afterNextRender(() => this.applyFocus(select), { injector: this.injector });
  }

  private applyFocus(select: boolean): void {
    const el = this.field().nativeElement;
    if (el.value !== this.engine.input()) el.value = this.engine.input();
    el.focus({ preventScroll: true });
    if (select) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }

  onInput(ev: Event): void {
    if (!this.active()) this.activate();
    this.engine.setInput((ev.target as HTMLInputElement).value);
  }

  clearField(ev: Event): void {
    ev.stopPropagation();
    this.engine.clear();
    this.focusInput();
  }

  onKeydown(ev: KeyboardEvent): void {
    if (!this.active() && ev.key !== 'Escape' && ev.key !== 'Tab') this.activate();
    const action = this.engine.keyAction(ev);
    if (action === 'escape') {
      if (this.engine.input()) this.engine.clear();
      else this.collapse();
      return;
    }
    if (action !== 'open' && action !== 'open-new-tab') {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') this.scrollActiveIntoView();
      return;
    }
    const opt = this.engine.enterOption();
    if (!opt) return;
    const result = this.engine.open(opt, action === 'open-new-tab');
    if (result === 'navigated') this.collapse(true);
  }

  /** Focus left the bar: collapse when it went elsewhere on the page, or the field is empty. */
  onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) return;
    if (next || !this.engine.input().trim()) this.collapse();
  }

  private scrollActiveIntoView(): void {
    afterNextRender(
      () => {
        const id = this.activeDescendant();
        if (id) document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  onNavigated(): void {
    this.collapse(true);
  }
}
