import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { NACHSCHUB_MAX_SLOTS, type Nachschub } from '../nachschub/nachschub.model';
import { NachschubService } from '../nachschub/nachschub.service';
import { NachschubCrateComponent } from '../nachschub/nachschub-crate.component';

/** One of the seven slots: a Nachschub, or free (a "+" that starts a new one). */
export interface BoardSlot {
  readonly index: number;
  readonly nachschub: Nachschub | null;
  readonly done: number;
  readonly total: number;
  readonly einsaetze: number;
}

/**
 * The seven Nachschub slots of Planen as separate freight crates (round 4: "einzelne Kisten statt Leiste", never one
 * connected strip), the Archiv at the end. A free slot is a "+" and IS the entry to a new Nachschub - there is no
 * separate button. A trash button (hover, focus, always on touch) deletes with the "zurück auf die Wunschliste" choice.
 */
@Component({
  selector: 'sc-hq-nachschub-board',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective, NachschubCrateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="board" [attr.aria-label]="'hq.slots.aria' | translate">
      @for (s of slots(); track s.index) {
        @if (s.nachschub; as n) {
          <li class="slot" [class.on]="n.id === selectedId()" [class.done]="s.total > 0 && s.done >= s.total">
            <button type="button" class="hit" [attr.aria-pressed]="n.id === selectedId()" (click)="selectNachschub.emit(n.id)">
              <sc-nachschub-crate [done]="s.done" [total]="s.total" [open]="n.id === selectedId()" />
              <span class="name">{{ n.name }}</span>
              <small>
                @if (s.total > 0 && s.done >= s.total) { {{ 'hq.slots.finished' | translate }} · }
                {{ s.done }}/{{ s.total }} · {{ (s.einsaetze === 1 ? 'hq.slots.einsatzOne' : 'hq.slots.einsaetze') | translate: { n: s.einsaetze } }}
              </small>
            </button>
            <button type="button" scAction tier="tertiary" tone="danger" class="del" [attr.aria-label]="'hq.slots.delete' | translate: { name: n.name }"
                    [scTooltip]="'hq.slots.delete' | translate: { name: n.name }" scTooltipTier="label" (click)="remove.emit(n.id)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
            </button>
          </li>
        } @else {
          <li class="slot free">
            <button type="button" class="hit" [attr.aria-label]="'hq.slots.newAria' | translate: { n: s.index }" (click)="create.emit()">
              <span class="plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
              <small>{{ 'hq.slots.free' | translate: { n: s.index } }}</small>
            </button>
          </li>
        }
      }
      <li class="archive-li">
        <button type="button" class="archive" aria-haspopup="dialog" [attr.aria-label]="'hq.slots.archiveAria' | translate: { n: archivedCount() }" (click)="openArchive.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5h17v4h-17z" /><path d="M5.5 9v10h13V9" /><path d="M10 13h4" /></svg>
          <span>{{ 'hq.slots.archive' | translate }}</span>
          <b>{{ archivedCount() }}</b>
        </button>
      </li>
    </ul>
  `,
  styles: [
    `
      :host { display: block; }
      .board { list-style: none; margin: 0; padding: 4px 0 6px; display: flex; align-items: stretch; gap: var(--sc-space-3, 12px); }
      .slot { position: relative; flex: 1 1 0; min-width: 0; display: flex; border: 1px solid var(--sc-border); border-radius: 12px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 5%, var(--sc-bg-1)), var(--sc-bg-1));
        box-shadow: 0 6px 14px rgb(0 0 0 / 0.28); transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; }
      .slot:hover { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); transform: translateY(-1px); }
      .slot.on { border-color: var(--sc-accent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 24px color-mix(in srgb, var(--sc-accent) 30%, transparent), 0 8px 18px rgb(0 0 0 / 0.35); }
      .slot.done { border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border)); }
      .slot.done small { color: var(--sc-success); }
      .hit { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px 9px; border: 0; border-radius: inherit; background: transparent; color: var(--sc-fg); font: inherit; text-align: center; cursor: pointer; }
      .hit:focus-visible, .archive:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; min-height: 2.5em; font-size: 0.82rem; font-weight: 600; line-height: 1.25; }
      small { font-size: 0.74rem; color: var(--sc-fg-2); }
      .del { position: absolute; top: 4px; right: 4px; opacity: 0; transition: opacity 0.15s; }
      .slot:hover .del, .slot:focus-within .del { opacity: 1; }
      .del svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .free { border-style: dashed; border-color: color-mix(in srgb, var(--sc-accent) 38%, var(--sc-border)); background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); box-shadow: none; }
      .free .hit { justify-content: center; min-height: 128px; }
      .plus { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--sc-accent) 60%, transparent); color: var(--sc-accent); transition: background 0.2s, transform 0.2s; }
      .plus svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .free:hover .plus, .free .hit:focus-visible .plus { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); transform: scale(1.06); }
      .archive-li { flex: 0 0 84px; display: flex; }
      .archive { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--sc-border); border-radius: 12px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); color: var(--sc-fg-1); font: inherit; font-size: 0.78rem; cursor: pointer; }
      .archive:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .archive svg { width: 26px; height: 26px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .archive b { font-family: var(--sc-font-display, inherit); font-size: 0.8rem; }
      @media (hover: none) { .del { opacity: 1; } }
      @media (max-width: 1023px) { .board { overflow-x: auto; scroll-snap-type: x proximity; } .slot { flex: 0 0 132px; scroll-snap-align: start; } .archive-li { flex: 0 0 84px; } }
      @media (prefers-reduced-motion: reduce) { .slot, .plus, .del { transition: none; } }
    `,
  ],
})
export class HqNachschubBoardComponent {
  readonly selectedId = input<string | null>(null);
  readonly selectNachschub = output<string>();
  readonly create = output<void>();
  readonly remove = output<string>();
  readonly openArchive = output<void>();

  private readonly svc = inject(NachschubService);
  private readonly einsatz = inject(HqEinsatzService);

  protected readonly archivedCount = computed(() => this.svc.archived().length);
  protected readonly slots = computed<BoardSlot[]>(() => {
    const active = this.svc.active();
    return Array.from({ length: NACHSCHUB_MAX_SLOTS }, (_, i) => {
      const n = active.find((a) => a.slot === i + 1) ?? null;
      if (!n) return { index: i + 1, nachschub: null, done: 0, total: 0, einsaetze: 0 };
      const progress = this.svc.evaluation(n.id)?.progress ?? { done: 0, total: 0 };
      return { index: i + 1, nachschub: n, done: progress.done, total: progress.total, einsaetze: this.einsatz.ofPackage(n.id).length };
    });
  });
}
