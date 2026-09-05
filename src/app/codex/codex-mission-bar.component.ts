import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MISSIONS, MissionId, ShipCapabilities, missionDisabledReasonKey } from './codex-mission';

/**
 * EINSATZ — the mission-profile chip row (04-rules-v2 §7.1: one row, never
 * wraps). Labels hide under 1240px so the icon-only chips still fit a phone
 * width; a mission the hull cannot fly renders disabled with the reason in
 * its `title` (no mining hardpoints / no cargo grid / no quantum drive / no
 * salvage hardpoints).
 *
 * The right side (MASTER §5) belongs to the loadout draft, in one of two
 * mutually exclusive states the page picks by `changed()`:
 *  - idle (`changed === 0`): only `codex.mission.lensReset` — jumps the
 *    mission LENS back to `all` (there is no draft yet, so there is nothing
 *    else to reset or apply; no persistence choice exists until a save flow
 *    that reads it is wired — see codex-detail.component.ts's discussion).
 *  - draft (`changed > 0`): the page swaps this bar out entirely for
 *    `<sc-codex-loadout-save-bar>` (Entwurf label, changed-slots chip,
 *    unsaved notice, Verwerfen/Übernehmen & in Hangar speichern) — see
 *    `codex-detail.component.ts`'s `mission-draft-bar` wrapper.
 */
@Component({
  selector: 'sc-codex-mission-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mission-bar">
      <span class="mission-label">{{ 'codex.mission.label' | translate }}</span>
      <div class="mission-chips" role="radiogroup" [attr.aria-label]="'codex.mission.label' | translate">
        @for (m of missions; track m.id) {
          <button
            type="button"
            role="radio"
            class="mission-chip"
            [class.active]="active() === m.id"
            [disabled]="disabledReason(m.id)"
            [attr.aria-checked]="active() === m.id"
            [attr.aria-describedby]="disabledReason(m.id) ? ('mission-reason-' + m.id) : null"
            [attr.title]="disabledReason(m.id) ? (disabledReason(m.id)! | translate) : (m.labelKey | translate)"
            (click)="select(m.id)"
          >
            <span class="chip-icon" aria-hidden="true">{{ active() === m.id ? '◈' : '◇' }}</span>
            <span class="chip-label">{{ m.labelKey | translate }}</span>
          </button>
          @if (disabledReason(m.id)) {
            <span [id]="'mission-reason-' + m.id" class="sr-only">{{ disabledReason(m.id)! | translate }}</span>
          }
        }
      </div>
      @if (changed() === 0) {
        <span class="idle-draft">
          <button type="button" class="btn" [disabled]="active() === 'all'" (click)="missionChange.emit('all')">
            {{ 'codex.mission.lensReset' | translate }}
          </button>
        </span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .mission-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow-x: auto;
      white-space: nowrap;
      padding: 8px 4px;
    }
    .mission-label {
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      flex: none;
    }
    .mission-chips { display: flex; gap: 8px; flex: none; }
    .mission-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 48px;
      padding: 8px 14px;
      background: var(--sc-bg-2);
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-1);
      cursor: pointer;
      flex: none;
      font-family: var(--sc-font-body);
      font-size: 13px;
    }
    .mission-chip.active { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-2)); }
    .mission-chip:disabled { opacity: 0.45; cursor: not-allowed; }
    .chip-icon { font-size: 15px; }
    .idle-draft { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; }
    .idle-draft .btn {
      padding: 7px 14px; border-radius: 6px; font: inherit; font-size: max(0.76rem, var(--sc-fs-floor));
      cursor: pointer; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
    }
    .idle-draft .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (max-width: 1240px) {
      .chip-label { display: none; }
      .mission-chip { padding: 8px 12px; }
    }
  `],
})
export class CodexMissionBarComponent {
  readonly active = input.required<MissionId>();
  readonly capabilities = input.required<ShipCapabilities>();
  /** Slots the current loadout draft has touched — `0` selects the idle
   * right-side controls, `> 0` tells the page to swap in the draft bar. */
  readonly changed = input(0);
  readonly missionChange = output<MissionId>();

  readonly missions = MISSIONS;

  disabledReason(id: MissionId): string | null {
    return missionDisabledReasonKey(id, this.capabilities());
  }

  select(id: MissionId): void {
    if (this.disabledReason(id)) return;
    this.missionChange.emit(id);
  }
}
