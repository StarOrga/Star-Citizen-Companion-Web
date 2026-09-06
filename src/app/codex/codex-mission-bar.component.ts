import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MISSIONS, MissionId, ShipCapabilities, missionDisabledReasonKey } from './codex-mission';

/**
 * EINSATZ — the mission-profile chip row (04-rules-v2 §7.1: one row, never
 * wraps; MASTER §13: the bar wraps or scrolls, never clips — labels stay at
 * every width and the row scrolls horizontally instead). A mission the hull
 * cannot fly renders disabled with the reason in its `title` (no mining
 * hardpoints / no cargo grid / no salvage hardpoints).
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

    /* The concept draws this bar as a BOX, not a bare row: .ship-mock
       .m-mission (concept part-02:190) is a hairline frame with a 4px radius
       around .4rem .6rem of padding. Concept rem values are translated to the
       px they render at in the mock (rem x 13), because the app root is 15px
       and a raw rem would come out 1.15x too large.
       The mock's overflow:hidden stays overflow-x:auto here — MASTER 13 wants
       the row to scroll, never clip. */
    .mission-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      overflow-x: auto;
      white-space: nowrap;
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      padding: 5px 8px;
    }
    /* .ship-mock .m-mission .lab (part-02:191) — a 9.5px micro-label on .14em,
       not the 0.72rem/.08em it was. --sc-fs-floor keeps it readable on touch. */
    .mission-label {
      font-family: var(--sc-font-display);
      font-size: max(9.5px, var(--sc-fs-floor));
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      flex: none;
      margin-right: 4px;
    }
    .mission-chips { display: flex; gap: 5px; flex: none; }
    /* The chips ARE the concept's .btn primitive (part-02:159), the same one
       the hero acts use: a 3px rectangle carrying a 10px uppercase label on
       .12em — never a pill, never mixed case. Ground and text sit at the same
       roles the mock gives them (translucent canvas, muted text).
       The 48px touch floor stays in this base rule; the concept's real, compact
       box lives in the pointer:fine block at the bottom, the same way
       .hero.stage .acts .btn does it in codex-detail.component.ts. */
    .mission-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 8px 14px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border: 1px solid var(--sc-border);
      border-radius: 3px;
      color: var(--sc-fg-2);
      cursor: pointer;
      flex: none;
      font-family: var(--sc-font-body);
      font-size: max(10px, var(--sc-fs-floor));
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    /* .ship-mock .btn.on (part-02:160): accent text on a faintly tinted ground
       behind a DIMMED accent border — a lit outline, not a filled accent block. */
    .mission-chip.active {
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-0));
    }
    /* .ship-mock .btn:disabled, .ship-mock .btn.off (part-02:162) */
    .mission-chip:disabled { opacity: 0.38; cursor: not-allowed; }
    /* The concept sets the glyph as plain text inside the button's own type run
       (part-03:100), so it rides at the chip size instead of the old 15px. */
    .chip-icon { font-size: inherit; }
    /* .ship-mock .m-mission .sp (part-02:192) — pushed right, .4rem apart, and
       its buttons are the same .btn primitive as the chips. */
    .idle-draft { display: flex; align-items: center; gap: 5px; flex: none; margin-left: auto; }
    .idle-draft .btn {
      padding: 8px 14px; border-radius: 3px; cursor: pointer;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: var(--sc-font-body);
      font-size: max(10px, var(--sc-fs-floor));
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .idle-draft .btn:disabled { opacity: 0.38; cursor: not-allowed; }

    /* A mouse does not need the 48px touch floor, and seven of them turn this
       row into the wall of pills the concept never had. On a fine pointer the
       chip collapses onto the concept's own box — .28rem .6rem of padding,
       roughly 24px tall (part-02:159). Coarse pointers, and therefore the
       mobile gate that emulates one, keep the full target. */
    @media (pointer: fine) {
      .mission-chip, .idle-draft .btn { min-height: 24px; padding: 4px 8px; }
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
