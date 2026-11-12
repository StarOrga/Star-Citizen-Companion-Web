// The Einsatz (mission) picker of the Holotisch head (concept holotisch-
// feinschliff r4 d1, C4): it moved out of the strip's first segment to the top
// centre of the head, so the strip's four topics get the whole width.
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { MissionId, missionById } from '../codex-mission';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { MISSION_ICON, missionColor } from './codex-holo-mission';

/** One choice of the Einsatz picker. */
export interface StripMission {
  id: MissionId;
  labelKey: string;
  sub: string;
  disabledKey: string | null;
}

@Component({
  selector: 'sc-codex-holo-einsatz',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="einsatz" #btn aria-haspopup="true" [attr.aria-expanded]="open()"
            [attr.aria-label]="('codex.holo.strip.einsatzPick' | translate) + ': ' + (activeLabel() | translate)"
            [scTooltip]="'codex.holo.strip.einsatzPick' | translate" scTooltipTier="label"
            (click)="toggle($event)" (keydown.escape)="open() && close($event)">
      <small class="lab">{{ 'codex.holo.strip.einsatz' | translate }}</small>
      <span class="val"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="activeIcon()" /></svg>{{ activeLabel() | translate }}</span>
      <span class="sub" [class.gapv]="!cohortLabel()">{{ cohortLabel() ?? ('codex.kpi.gap' | translate) }}<span class="caret" aria-hidden="true">▾</span></span>
    </button>
    @if (open()) {
      <div class="mission-pop" role="radiogroup" tabindex="-1"[attr.aria-label]="'codex.mission.label' | translate" (keydown.escape)="close($event)">
        @for (m of missions(); track m.id) {
          <button type="button" class="mp" role="radio" [class.on]="m.id === active()" [attr.aria-checked]="m.id === active()"
                  [attr.aria-disabled]="!!m.disabledKey" [class.dis]="!!m.disabledKey"
                  [scTooltip]="m.disabledKey ? (m.disabledKey | translate) : null" scTooltipTier="label"
                  (click)="pick(m)">
            <span class="mp-l" [style.--h]="hueOf(m.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconOf(m.id)" /></svg>{{ m.labelKey | translate }}</span>
            @if (!m.disabledKey) { <small>{{ m.sub }}</small> }
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-block; min-width: 0; }
      .einsatz { display: grid; grid-template-columns: auto auto; column-gap: 10px; align-items: baseline; padding: 5px 14px 6px; min-block-size: var(--sc-tap-min, 0px);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); border-radius: 12px;
        background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); color: var(--sc-fg-0); font: inherit; text-align: start; cursor: pointer;
        transition: border-color 160ms ease, background 160ms ease; max-inline-size: 100%; }
      .einsatz:hover, .einsatz[aria-expanded='true'] { border-color: var(--sc-accent); background: color-mix(in srgb, var(--holo-e, var(--sc-accent)) 12%, var(--sc-bg-0)); }
      .einsatz:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .lab { grid-column: 1 / -1; font-family: var(--sc-font-display); font-size: max(9.5px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
      .val { display: inline-flex; align-items: center; gap: 6px; font-family: var(--sc-font-display); font-size: max(14px, var(--sc-fs-floor)); font-weight: 600; letter-spacing: 0.04em;
        color: var(--holo-e, var(--sc-fg-0)); white-space: nowrap; transition: color var(--holo-t-base, 200ms) ease; }
      .sub { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .caret { margin-inline-start: 4px; color: var(--sc-accent); font-size: 0.85em; }
      .gapv { color: var(--sc-fg-2); }
      .mp-l svg, .val svg { inline-size: 1.15em; block-size: 1.15em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .mission-pop { position: absolute; inset-block-start: calc(100% + 6px); inset-inline-start: 50%; translate: -50% 0; z-index: 30; display: grid; gap: 2px; padding: 6px; min-inline-size: 260px;
        background: var(--sc-bg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-bg-0)); border-radius: 10px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.5); }
      .mp { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 6px 10px; min-block-size: var(--sc-tap-min, 32px); background: none; border: 0; border-radius: 6px;
        color: var(--sc-fg-1); font: inherit; cursor: pointer; text-align: start; }
      .mp-l { display: inline-flex; align-items: center; gap: 8px; font-family: var(--sc-font-display); font-size: max(10.5px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; }
      .mp-l svg { color: var(--h, currentColor); }
      .mp small { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .mp:hover:not(.dis) { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .mp.on { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .mp.dis { opacity: 0.4; cursor: not-allowed; }
      .mp:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      @media (max-width: 640px) {
        .mission-pop { inset-inline-start: 0; translate: none; }
      }
    `,
  ],
})
export class CodexHoloEinsatzComponent {
  readonly active = input.required<MissionId>();
  /** The choices, with their lead value. */
  readonly missions = input<readonly StripMission[]>([]);
  /** What the default Einsatz is called: the ship's class ("Kampfschiff"). */
  readonly defaultLabelKey = input<string | null>(null);
  /** Who the Einsatz compares with ("26 × Leichter Jäger"); null while the group loads. */
  readonly cohortLabel = input<string | null>(null);
  readonly missionChange = output<MissionId>();

  readonly open = signal(false);
  private readonly btn = viewChild<ElementRef<HTMLElement>>('btn');

  protected readonly activeLabel = computed(() => (this.active() === 'all' && this.defaultLabelKey()) || missionById(this.active()).labelKey);
  protected readonly activeIcon = computed(() => MISSION_ICON[this.active()]);

  protected iconOf(id: MissionId): string {
    return MISSION_ICON[id];
  }
  protected hueOf(id: MissionId): string {
    return missionColor(id);
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    this.open.update((v) => !v);
  }

  close(ev: Event): void {
    ev.stopPropagation();
    this.open.set(false);
    this.btn()?.nativeElement.focus({ preventScroll: true });
  }

  pick(m: StripMission): void {
    if (m.disabledKey) return;
    this.open.set(false);
    this.missionChange.emit(m.id);
    this.btn()?.nativeElement.focus({ preventScroll: true });
  }

  /** A click anywhere else closes the picker. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: Event): void {
    if (!this.open()) return;
    const pop = (ev.target as HTMLElement | null)?.closest?.('.mission-pop');
    if (!pop) this.open.set(false);
  }
}
