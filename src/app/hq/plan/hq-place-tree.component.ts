import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { PlaceNode, buildPlaceTree, filterTree, nodeFraction, toggleNode, visibleRows } from './hq-place-tree';
import type { MapPlace } from './map/hq-map.types';

/**
 * Ort axis (D26): a multi-check dropdown System › Planet › Ort with a sticky mini search. Rows are
 * a keyboard tree (↑↓ move, → open, ← close, Space/Enter check, Esc closes); every node is a
 * tri-state check over its places, with a count badge and a hairline indent guide. Empty selection =
 * "Alle Orte". The host owns the selection (`selectedChange`).
 */
@Component({
  selector: 'sc-hq-place-tree',
  standalone: true,
  imports: [TranslatePipe, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)' },
  template: `
    <button type="button" class="trigger" aria-haspopup="tree" [attr.aria-expanded]="open()" (click)="toggleOpen()">
      <span class="trig-label">
        @if (selected().size === 0) { {{ 'hq.place.any' | translate }} }
        @else { {{ 'hq.place.count' | translate: { n: selected().size } }} }
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true" class="chev"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    @if (open()) {
      <div class="panel" (keydown)="onKey($event)">
        <div class="search">
          <input #q class="sc-input" type="search" autocomplete="off" [placeholder]="'hq.place.search' | translate"
                 [attr.aria-label]="'hq.place.search' | translate" [value]="query()" (input)="query.set(q.value)" />
        </div>
        @if (rows().length === 0) {
          <p class="empty">{{ 'hq.place.empty' | translate }}</p>
        } @else {
          <ul class="tree" role="tree" [attr.aria-label]="'hq.place.label' | translate">
            @for (n of rows(); track n.id; let i = $index) {
              <li class="row" role="treeitem" [attr.data-depth]="n.depth" [attr.aria-level]="n.depth + 1"
                  [attr.aria-expanded]="n.children.length ? isOpen(n) : null"
                  [attr.aria-checked]="frac(n) >= 1 ? 'true' : frac(n) > 0 ? 'mixed' : 'false'"
                  [class.sel]="frac(n) > 0" [class.cur]="i === cursor()"
                  [attr.tabindex]="i === cursor() ? 0 : -1" [attr.data-row]="i"
                  (click)="check(n)" (focus)="cursor.set(i)">
                <span class="guide" aria-hidden="true"></span>
                @if (n.children.length) {
                  <button type="button" class="fold" tabindex="-1" [attr.aria-label]="n.label" (click)="fold(n); $event.stopPropagation()">
                    <svg viewBox="0 0 24 24" aria-hidden="true" [class.open]="isOpen(n)"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                } @else { <span class="fold-gap"></span> }
                <span inert class="box"><sc-tristate variant="checkbox" [value]="frac(n)" [label]="n.label" /></span>
                <span class="lbl">{{ n.label }}</span>
                <span class="badge mono">{{ count(n) }}</span>
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-block; }
      .trigger {
        display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 40px;
        padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px;
        background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; cursor: pointer;
      }
      .trigger:hover, .trigger[aria-expanded='true'] { border-color: var(--sc-accent); }
      .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .chev { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .panel {
        position: absolute; z-index: 20; top: calc(100% + 6px); left: 0;
        width: min(360px, calc(100vw - 2 * var(--sc-space-4, 16px)));
        max-height: min(420px, 60dvh); overflow: auto;
        border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1, var(--sc-bg-0));
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
      }
      .search { position: sticky; top: 0; z-index: 1; padding: var(--sc-space-2, 8px); background: var(--sc-bg-1, var(--sc-bg-0)); border-bottom: 1px solid var(--sc-border); }
      .search input { width: 100%; }
      .empty { margin: 0; padding: var(--sc-space-3, 12px); color: var(--sc-fg-2); }
      .tree { list-style: none; margin: 0; padding: var(--sc-space-1, 4px); }
      .row {
        position: relative; display: flex; align-items: center; gap: var(--sc-space-2, 8px);
        min-height: 40px; padding-right: var(--sc-space-2, 8px); border-radius: 8px; cursor: pointer;
        padding-left: calc(var(--sc-space-1, 4px) + var(--d, 0) * 20px);
      }
      .row[data-depth='1'] { --d: 1; }
      .row[data-depth='2'] { --d: 2; }
      .row .guide { position: absolute; left: calc(var(--sc-space-1, 4px) + var(--d, 0) * 20px - 10px); top: 0; bottom: 0; border-left: 1px solid var(--sc-border); }
      .row[data-depth='0'] .guide { display: none; }
      .row:hover, .row.cur { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
      .row.sel .lbl { color: var(--sc-accent); }
      .row:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .fold { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: none; color: var(--sc-fg-2); cursor: pointer; }
      .fold svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.15s ease; }
      .fold svg.open { transform: rotate(90deg); }
      .fold-gap { width: 24px; flex: none; }
      .box { --sc-tristate-size: 22px; display: inline-flex; flex: none; }
      .lbl { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg); }
      .badge { flex: none; min-width: 1.8em; padding: 0 6px; border-radius: 999px; text-align: center; font-size: max(0.75rem, var(--sc-fs-floor)); background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-2); }
      @media (pointer: coarse) { .row { min-height: 48px; } .fold { width: 40px; height: 40px; } .trigger { min-height: 48px; } }
      @media (prefers-reduced-motion: reduce) { .fold svg { transition: none; } }
    `,
  ],
})
export class HqPlaceTreeComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The place of every need (duplicates raise the count badge). */
  readonly places = input.required<readonly MapPlace[]>();
  readonly selected = input.required<ReadonlySet<string>>();
  readonly selectedChange = output<ReadonlySet<string>>();

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly cursor = signal(0);
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  private readonly tree = computed(() => buildPlaceTree(this.places()));
  private readonly counts = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.places()) m.set(p.id, (m.get(p.id) ?? 0) + 1);
    return m;
  });
  protected readonly rows = computed(() => {
    const q = this.query().trim();
    return visibleRows(filterTree(this.tree(), q), this.opened(), q.length > 0);
  });

  protected frac(n: PlaceNode): number {
    return nodeFraction(n, this.selected());
  }

  protected count(n: PlaceNode): number {
    return n.leaves.reduce((sum, l) => sum + (this.counts().get(l) ?? 0), 0);
  }

  protected isOpen(n: PlaceNode): boolean {
    return this.query().trim().length > 0 || this.opened().has(n.id);
  }

  protected toggleOpen(): void {
    this.open.update((v) => !v);
    if (this.open()) queueMicrotask(() => this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus());
  }

  protected fold(n: PlaceNode): void {
    const next = new Set(this.opened());
    if (!next.delete(n.id)) next.add(n.id);
    this.opened.set(next);
  }

  protected check(n: PlaceNode): void {
    this.selectedChange.emit(toggleNode(n, this.selected()));
  }

  protected onDocClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  protected onKey(e: KeyboardEvent): void {
    const rows = this.rows();
    const i = this.cursor();
    const move = (to: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, to));
      this.cursor.set(next);
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus());
    };
    const inSearch = (e.target as HTMLElement).tagName === 'INPUT';
    switch (e.key) {
      case 'Escape':
        e.stopPropagation();
        this.open.set(false);
        this.host.nativeElement.querySelector<HTMLElement>('.trigger')?.focus();
        return;
      case 'ArrowDown':
        e.preventDefault();
        move(inSearch ? 0 : i + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (!inSearch) move(i - 1);
        return;
      case 'ArrowRight':
        if (!inSearch && rows[i]?.children.length && !this.isOpen(rows[i])) {
          e.preventDefault();
          this.fold(rows[i]);
        }
        return;
      case 'ArrowLeft':
        if (!inSearch && rows[i]?.children.length && this.isOpen(rows[i]) && !this.query().trim()) {
          e.preventDefault();
          this.fold(rows[i]);
        }
        return;
      case ' ':
      case 'Enter':
        if (!inSearch && rows[i]) {
          e.preventDefault();
          this.check(rows[i]);
        }
        return;
    }
  }
}
