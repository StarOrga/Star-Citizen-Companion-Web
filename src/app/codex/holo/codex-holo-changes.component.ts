import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HoloDiffMarkerComponent } from './holo-diff-marker';
import { displayItemName } from '../codex-format';
import { JournalEntry } from './codex-holo-model';

/**
 * The Holotable panel's Änderungen tab: what differs from the factory loadout,
 * with undo. The stage projects the patch comparison above it. Saving stays in
 * the stage's floating save bar, which every tab can see.
 */
@Component({
  selector: 'sc-codex-holo-changes',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, HoloDiffMarkerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content />
    <div class="card">
      <div class="h2"><span>{{ 'codex.holo.card.changesHead' | translate }}</span><span class="rule"></span></div>
      @if (journal().length === 0) {
        <p class="mut">{{ 'codex.holo.stage.journalEmpty' | translate }}</p>
      } @else if (readOnly()) {
        <!-- A shared link's loadout (#646): what differs from stock, nothing to undo or save. -->
        <ul class="journal">
          @for (e of journal(); track e.port) {
            <li>
              <sc-holo-diff-marker />
              <span class="j-label">{{ itemName(e.label) }}</span>
              <span class="j-state">{{ ('codex.loadout.draftState.' + e.state) | translate }}</span>
            </li>
          }
        </ul>
        <p class="mut">{{ 'codex.holo.shared.readOnlyHint' | translate }}</p>
      } @else {
        <ul class="journal">
          @for (e of journal(); track e.port) {
            <li>
              <sc-holo-diff-marker />
              <span class="j-label">{{ itemName(e.label) }}</span>
              <span class="j-state">{{ ('codex.loadout.draftState.' + e.state) | translate }}</span>
              <button type="button" class="lnk" (click)="reverted.emit(e.paths)">{{ 'codex.holo.stage.undo' | translate }}</button>
            </li>
          }
        </ul>
        <!-- "↺ Zurück auf Werk" (r4 d1 s7): every change at once. -->
        <button type="button" scAction tier="secondary" class="werk" (click)="reverted.emit(allPaths())">
          ↺ {{ 'codex.holo.card.backToWerk' | translate }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: grid; gap: 12px; align-content: start; min-width: 0; --f: var(--sc-fs-floor); }
    .card { display: grid; gap: 8px; min-width: 0; }
    .h2 { display: flex; align-items: center; gap: 8px; font-family: var(--sc-font-display); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); }
    .rule { flex: 1; height: 1px; background: color-mix(in srgb, var(--sc-accent) 24%, transparent); }
    .mut { margin: 0; font-size: max(12px, var(--f)); color: var(--sc-fg-2); }
    .lnk { background: none; border: none; padding: 0; color: var(--sc-accent); cursor: pointer; font: inherit;
      font-size: max(11px, var(--f)); min-height: var(--sc-tap-min, 24px); justify-self: start; }
    .lnk:hover { text-decoration: underline; }
    .lnk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: var(--holo-r-xs); }
    .werk { justify-self: start; margin-top: 4px; }
    .journal { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .journal li { display: flex; align-items: center; gap: 8px; font-size: max(12px, var(--f)); animation: j-in 260ms var(--holo-e-out) backwards; }
    @keyframes j-in { from { opacity: 0; } }
    .j-label { color: var(--sc-fg-0); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .j-state { color: var(--sc-fg-2); font-size: max(10px, var(--f)); }
    @media (prefers-reduced-motion: reduce) { .journal li { animation: none; } }
  `],
})
export class CodexHoloChangesComponent {
  readonly journal = input<readonly JournalEntry[]>([]);
  /** A shared link's loadout is on the table (#646): nothing to undo. */
  readonly readOnly = input(false);
  readonly reverted = output<string[]>();

  itemName(name: string): string {
    return displayItemName(name);
  }

  allPaths(): string[] {
    return this.journal().flatMap((e) => e.paths);
  }
}
