import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { needsMiniSearch } from '../../codex/search/search-query-parse';
import type { SearchChip, SearchChipOption } from '../../codex/search/search-result-model';
import { normalizeSearch } from '../../codex/codex-search';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * One chip in the search field (concept 2026-11-02, C3/C4). All chips share
 * one colour; ▾ and × appear only on hover or focus. A switchable chip opens a
 * menu that grows straight out of the chip, in the chip's own colour (no
 * brightness step), with the hit count per value — values with 0 hits are
 * greyed out but stay clickable — and a mini-search past 7 values.
 */
@Component({
  selector: 'sc-fusion-search-chip',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.open]': 'menuOpen()',
    '(focusout)': 'onFocusOut($event)',
    '(keydown)': 'onHostKey($event)',
    '(document:keydown.escape)': 'onDocumentEscape($event)',
  },
  template: `
    <span class="chip" [class.open]="menuOpen()">
      @if (switchable()) {
        <button #toggle type="button" class="lbl" [attr.aria-expanded]="menuOpen()" aria-haspopup="listbox"
                [attr.aria-label]="'search.chip.switchAria' | translate: { name: label() }"
                (click)="toggleMenu()" (keydown)="onToggleKey($event)">
          <span class="txt">{{ label() }}</span><span class="dd" aria-hidden="true">▾</span>
        </button>
      } @else {
        <span class="lbl static"><span class="txt">{{ label() }}</span></span>
      }
      <button type="button" class="cx" (click)="remove.emit()"
              [attr.aria-label]="'search.chip.removeAria' | translate: { name: label() }"
              [scTooltip]="'search.chip.removeAria' | translate: { name: label() }" scTooltipTier="label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" />
        </svg>
      </button>
      @if (menuOpen()) {
        <span class="menu">
          @if (mini()) {
            <input #mini type="text" class="mini" autocomplete="off" spellcheck="false"
                   [attr.aria-label]="'search.chip.miniSearch' | translate: { name: label() }"
                   [attr.placeholder]="'search.chip.miniSearch' | translate: { name: label() }"
                   [value]="filter()" (input)="filter.set($any($event.target).value); cursor.set(0)" />
          }
          <span class="opts" role="listbox" [attr.aria-label]="label()">
            @for (o of shown(); track o.value; let i = $index) {
              <button type="button" class="opt" role="option" [class.on]="o.value === current()"
                      [class.zero]="o.count === 0" [class.cur]="i === cursor()"
                      [attr.aria-selected]="o.value === current()"
                      (click)="choose(o)" (pointerenter)="cursor.set(i)">
                <span>{{ optionLabel()(o) }}</span>
                @if (o.count !== null) { <small>{{ o.count }}</small> }
              </button>
            } @empty {
              <span class="none">{{ 'search.chip.noValue' | translate }}</span>
            }
          </span>
        </span>
      }
    </span>
  `,
  styles: [`
    :host { position: relative; flex: none; display: inline-flex; }
    /* One colour for every chip (r2 t-s3-a1): the r3 mock's #1d4258 from tokens. */
    .chip {
      --chip-bg: color-mix(in oklab, var(--sc-accent) 24%, var(--sc-bg-1));
      position: relative; display: inline-flex; align-items: center; height: 28px;
      border-radius: 999px; background: var(--chip-bg); color: var(--sc-fg-0);
      font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; white-space: nowrap;
      animation: fsc-in 0.22s ease both;
    }
    .lbl {
      display: inline-flex; align-items: center; gap: 4px; height: 100%; padding: 0 4px 0 10px; margin: 0;
      border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: inherit;
    }
    .lbl.static { cursor: default; }
    .txt { overflow: hidden; text-overflow: ellipsis; max-width: 18ch; }
    .dd, .cx { opacity: 0; transition: opacity 0.12s ease; }
    .dd { font-size: 10px; }
    .cx {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-right: 3px;
      padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--sc-fg-1); cursor: pointer;
    }
    .cx svg { width: 12px; height: 12px; }
    .cx:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-fg-0) 10%, transparent); }
    /* ▾ and × only on hover / focus (r2 t-s3-a1). */
    :host(:hover) .dd, :host(:hover) .cx, :host(:focus-within) .dd, :host(:focus-within) .cx, :host(.open) .dd, :host(.open) .cx { opacity: 0.85; }
    .lbl:focus-visible, .cx:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    /* The menu grows out of the chip, in the chip's colour (r3 ub-s3: no brightness step). */
    .chip.open { border-radius: 12px 12px 0 0; }
    .menu {
      position: absolute; top: 100%; left: 0; z-index: 60; min-width: max(100%, 184px); max-height: 320px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 2px; padding: var(--sc-space-2);
      border-radius: 0 12px 12px 12px; background: var(--chip-bg); font-weight: 400;
      box-shadow: 0 18px 40px color-mix(in srgb, var(--sc-depth) 60%, transparent);
      transform-origin: top left; animation: fsc-grow 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .mini {
      height: 28px; margin-bottom: 4px; padding: 0 9px; border: 0; border-radius: 7px; outline: none;
      background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
    }
    .mini:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
    .opts { display: flex; flex-direction: column; gap: 2px; }
    .opt {
      display: flex; justify-content: space-between; gap: var(--sc-space-3); padding: 4px 8px; margin: 0; border: 0;
      border-radius: 6px; background: transparent; color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer;
    }
    .opt small { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .opt.cur, .opt:hover { background: color-mix(in srgb, var(--sc-fg-0) 8%, transparent); color: var(--sc-fg-0); }
    .opt.on { background: color-mix(in srgb, var(--sc-fg-0) 12%, transparent); color: var(--sc-fg-0); }
    /* 0 hits: greyed out, still clickable (r3 pin). */
    .opt.zero { opacity: 0.5; }
    .opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .none { padding: 4px 8px; color: var(--sc-fg-2); }
    @media (pointer: coarse) {
      .dd, .cx { opacity: 0.85; }
      .cx { width: 36px; height: 36px; }
      .opt { min-height: 44px; align-items: center; }
    }
    @keyframes fsc-in { from { opacity: 0; transform: scale(0.92); } }
    @keyframes fsc-grow { from { opacity: 0; transform: scaleY(0.6); } }
    @media (prefers-reduced-motion: reduce) { .chip, .menu { animation: none; } }
  `],
})
export class FusionSearchChipComponent {
  readonly chip = input.required<SearchChip>();
  readonly label = input.required<string>();
  /** The label of one menu value. */
  readonly optionLabel = input<(o: SearchChipOption) => string>((o) => o.value);
  readonly remove = output<void>();
  readonly pick = output<string>();
  /** The menu opened or closed (the host keeps its panel open meanwhile). */
  readonly menuChange = output<boolean>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly toggleRef = viewChild<ElementRef<HTMLButtonElement>>('toggle');
  private readonly miniRef = viewChild<ElementRef<HTMLInputElement>>('mini');

  readonly menuOpen = signal(false);
  readonly filter = signal('');
  readonly cursor = signal(0);

  readonly switchable = computed(() => this.chip().switchable && (this.chip().options?.length ?? 0) > 1);
  readonly mini = computed(() => needsMiniSearch(this.chip()));
  readonly current = computed(() => currentValue(this.chip()));
  readonly shown = computed<SearchChipOption[]>(() => {
    const opts = this.chip().options ?? [];
    const q = normalizeSearch(this.filter());
    if (!q) return opts;
    return opts.filter((o) => normalizeSearch(this.optionLabel()(o)).includes(q) || o.value.toLowerCase().includes(q));
  });

  toggleMenu(): void {
    if (this.menuOpen()) this.closeMenu(true);
    else this.openMenu();
  }

  openMenu(): void {
    if (!this.switchable()) return;
    this.filter.set('');
    const i = (this.chip().options ?? []).findIndex((o) => o.value === this.current());
    this.cursor.set(Math.max(0, i));
    this.menuOpen.set(true);
    this.menuChange.emit(true);
    queueMicrotask(() => {
      const mini = this.miniRef()?.nativeElement;
      if (mini) mini.focus();
      else this.focusCursor();
    });
  }

  closeMenu(returnFocus = false): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.menuChange.emit(false);
    if (returnFocus) this.toggleRef()?.nativeElement.focus();
  }

  choose(o: SearchChipOption): void {
    this.pick.emit(o.value);
    this.closeMenu(true);
  }

  onToggleKey(ev: KeyboardEvent): void {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.openMenu();
    }
  }

  /** Esc with a mouse-opened menu: focus sits on the toggle (or nowhere), not inside `.menu`. */
  onDocumentEscape(ev: Event): void {
    if (!this.menuOpen() || ev.defaultPrevented) return;
    ev.preventDefault();
    this.closeMenu(true);
  }

  onHostKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.menuOpen()) {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeMenu(true);
      return;
    }
    if (this.menuOpen() && ev.target instanceof Element && ev.target.closest('.menu')) this.onMenuKey(ev);
  }

  onMenuKey(ev: KeyboardEvent): void {
    const n = this.shown().length;
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        ev.preventDefault();
        if (!n) return;
        this.cursor.set((this.cursor() + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n);
        if (ev.target instanceof HTMLButtonElement) this.focusCursor();
        return;
      case 'Enter': {
        const o = this.shown()[this.cursor()];
        if (o && ev.target instanceof HTMLInputElement) {
          ev.preventDefault();
          this.choose(o);
        }
        return;
      }
      case 'Escape':
        ev.preventDefault();
        ev.stopPropagation();
        this.closeMenu(true);
        return;
      default:
        return;
    }
  }

  onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (next && (this.host.nativeElement as HTMLElement).contains(next)) return;
    // A pointer press inside the menu blurs first; the click still lands.
    if (!next) return;
    this.closeMenu();
  }

  private focusCursor(): void {
    queueMicrotask(() => {
      const el = (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.opt')[this.cursor()];
      el?.focus();
    });
  }
}

/** The value a chip stands on right now (its size, grade or kind). */
export function currentValue(chip: SearchChip): string | null {
  const f = chip.filter;
  if (f.size !== undefined) return String(f.size);
  if (f.grade) return f.grade;
  if (f.groups?.length === 1) return String(f.groups[0]);
  return null;
}
