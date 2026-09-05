import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MISSIONS, MissionId, ShipCapabilities, missionDisabledReasonKey } from './codex-mission';

/**
 * EINSATZ — the mission-profile chip row (04-rules-v2 §7.1: one row, never
 * wraps). Labels hide under 1240px so the icon-only chips still fit a phone
 * width; a mission the hull cannot fly renders disabled with the reason in
 * its `title` (no mining hardpoints / no cargo grid / no quantum drive / no
 * salvage hardpoints).
 */
@Component({
  selector: 'sc-codex-mission-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mission-bar">
      <span class="mission-label">{{ 'codex.mission.label' | translate }}</span>
      <div class="mission-chips" role="tablist">
        @for (m of missions; track m.id) {
          <button
            type="button"
            role="tab"
            class="mission-chip"
            [class.active]="active() === m.id"
            [disabled]="disabledReason(m.id)"
            [attr.aria-selected]="active() === m.id"
            [attr.title]="disabledReason(m.id) ? (disabledReason(m.id)! | translate) : (m.labelKey | translate)"
            (click)="select(m.id)"
          >
            <span class="chip-icon" aria-hidden="true">{{ active() === m.id ? '◈' : '◇' }}</span>
            <span class="chip-label">{{ m.labelKey | translate }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
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
      font-size: 12px;
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
    @media (max-width: 1240px) {
      .chip-label { display: none; }
      .mission-chip { padding: 8px 12px; }
    }
  `],
})
export class CodexMissionBarComponent {
  readonly active = input.required<MissionId>();
  readonly capabilities = input.required<ShipCapabilities>();
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
