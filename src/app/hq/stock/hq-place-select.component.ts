import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScPopoverDismissDirective } from '../../shared/popover/sc-popover-dismiss.directive';
import { type PlaceGroup, groupPlaces, placeInfo, placeSub } from './hq-stock-places';

/**
 * The Bestand place filter (I10, `q-places=grouped`, brief f7 §3): one app-styled select at the end of the filter bar.
 * The panel has a search field on top, every catalogue place grouped by system and planet, the amount under the
 * current filter beside each entry, empty ones dimmed but selectable; first entry "Alle Orte". Keyboard: Enter/Space
 * opens, typing filters, Arrow Up/Down move, Enter picks, Escape closes and returns focus to the trigger.
 */
@Component({
  selector: 'sc-hq-place-select',
  standalone: true,
  imports: [TranslatePipe, ScPopoverDismissDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="wrap" [scPopoverDismiss]="open()" (dismissed)="close(false)">
      <button #trigger type="button" class="trig" [class.on]="!!value()" aria-haspopup="listbox" [attr.aria-expanded]="open()"
              [attr.aria-label]="'hq.bestand.deck.placeAria' | translate" (click)="toggle()" (keydown.arrowDown)="openAt($event)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
        <span class="tv">{{ triggerText() || ('hq.bestand.deck.allPlaces' | translate) }}</span>
        <i aria-hidden="true">▾</i>
      </button>
      @if (open()) {
        <div class="panel" role="group" [attr.aria-label]="'hq.bestand.deck.placeAria' | translate" (keydown)="onKey($event)">
          <input #search type="search" class="srch" [value]="term()" (input)="term.set($any($event.target).value); active.set(0)"
                 [placeholder]="'hq.bestand.deck.placeSearch' | translate" [attr.aria-label]="'hq.bestand.deck.placeSearch' | translate"
                 role="combobox" aria-expanded="true" [attr.aria-controls]="listId" [attr.aria-activedescendant]="listId + '-' + active()" />
          <ul class="list" role="listbox" [id]="listId">
            <li role="option" class="opt" [id]="listId + '-0'" [class.act]="active() === 0" [attr.aria-selected]="!value()" (click)="pick(null)">
              {{ 'hq.bestand.deck.allPlaces' | translate }}
            </li>
            @for (g of groups(); track g.system) {
              <li role="presentation" class="sys">{{ g.system ?? ('hq.bestand.deck.otherPlaces' | translate) }}</li>
              @for (b of g.bodies; track b.body) {
                @if (b.body && b.body !== g.system) { <li role="presentation" class="body">{{ b.body }}</li> }
                @for (p of b.places; track p.id) {
                  <li role="option" class="opt" [id]="listId + '-' + indexOf(p.id)" [class.act]="active() === indexOf(p.id)" [class.zero]="!p.amount"
                      [attr.aria-selected]="value() === p.id" (click)="pick(p.id)">
                    <span>{{ p.name }}</span><b>{{ p.amount }}</b>
                  </li>
                }
              }
            }
          </ul>
        </div>
      }
    </span>
  `,
  styles: [
    `
      :host { display: inline-block; min-width: 11rem; max-width: 18rem; }
      .wrap { position: relative; display: block; }
      .trig { display: inline-flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 0 12px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; font-size: 0.8rem; cursor: pointer; }
      .trig.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .trig:focus-visible, .srch:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .trig svg { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; }
      .tv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; }
      .trig i { color: var(--sc-fg-2); font-style: normal; }
      .panel { position: absolute; z-index: 30; top: calc(100% + 6px); right: 0; width: max(100%, 16rem); display: flex; flex-direction: column; gap: 6px; max-height: min(60dvh, 28rem); padding: 8px; border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / .5); }
      .srch { min-height: 32px; padding: 0 10px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; font-size: 0.8rem; }
      .list { margin: 0; padding: 0; list-style: none; overflow-y: auto; }
      .sys { padding: 8px 8px 2px; color: var(--sc-fg-2); font: 600 0.62rem / 1 var(--sc-font-display, inherit); letter-spacing: .14em; text-transform: uppercase; }
      .body { padding: 4px 8px 2px 14px; color: var(--sc-fg-2); font-size: 0.7rem; }
      .opt { display: flex; justify-content: space-between; gap: 10px; min-height: 32px; align-items: center; padding: 0 8px 0 20px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
      .opt:first-child { padding-left: 8px; }
      .opt b { color: var(--sc-fg-2); font-weight: 500; font-variant-numeric: tabular-nums; }
      .opt.zero { opacity: .45; }
      .opt.act, .opt:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); opacity: 1; }
      .opt[aria-selected='true'] { color: var(--sc-accent); }
      @media (pointer: coarse) { .trig, .opt, .srch { min-height: 48px; } }
      @media (max-width: 599px) {
        :host { flex: 1 1 100%; max-width: none; }
        .panel { position: fixed; inset: auto 0 0 0; width: auto; max-height: min(70dvh, 28rem); padding-bottom: calc(8px + var(--sc-float-bottom, 0px)); border-radius: 14px 14px 0 0; }
      }
    `,
  ],
})
export class HqPlaceSelectComponent {
  private static uid = 0;
  readonly listId = `hq-place-${++HqPlaceSelectComponent.uid}`;
  /** Every stored place the data names (catalogue places join by themselves). */
  readonly known = input<readonly string[]>([]);
  /** Containers per place under the other filters. */
  readonly amounts = input<ReadonlyMap<string, number>>(new Map());
  readonly value = input<string | null>(null);
  readonly valueChange = output<string | null>();

  protected readonly open = signal(false);
  protected readonly term = signal('');
  protected readonly active = signal(0);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly searchRef = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly host = inject(ElementRef);

  protected readonly groups = computed<PlaceGroup[]>(() => groupPlaces(this.known(), this.amounts(), this.term()));
  /** Flat option ids in panel order; index 0 = "Alle Orte". */
  private readonly flat = computed(() => [null, ...this.groups().flatMap((g) => g.bodies.flatMap((b) => b.places.map((p) => p.id)))]);
  protected readonly triggerText = computed(() => {
    const v = this.value();
    if (!v) return '';
    const p = placeInfo(v);
    const sub = placeSub(p);
    return sub ? `${p.name} · ${sub}` : p.name;
  });

  protected indexOf(id: string): number {
    return this.flat().indexOf(id);
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show();
  }

  protected openAt(ev: Event): void {
    ev.preventDefault();
    this.show();
  }

  private show(): void {
    this.term.set('');
    this.active.set(Math.max(0, this.flat().indexOf(this.value())));
    this.open.set(true);
    queueMicrotask(() => this.searchRef()?.nativeElement.focus());
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.trigger()?.nativeElement.focus();
  }

  protected pick(id: string | null): void {
    this.valueChange.emit(id);
    this.close(true);
  }

  protected onKey(ev: KeyboardEvent): void {
    const n = this.flat().length;
    if (ev.key === 'ArrowDown') this.active.set((this.active() + 1) % n);
    else if (ev.key === 'ArrowUp') this.active.set((this.active() - 1 + n) % n);
    else if (ev.key === 'Home') this.active.set(0);
    else if (ev.key === 'End') this.active.set(n - 1);
    else if (ev.key === 'Enter') this.pick(this.flat()[this.active()] ?? null);
    else if (ev.key === 'Escape') this.close(true);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector('.opt.act')?.scrollIntoView({ block: 'nearest' }));
  }
}
