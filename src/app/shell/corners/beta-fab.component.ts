import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BETA_AREAS, BetaArea, BetaService } from '../../core/beta.service';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * The ONE beta switch: a small round β FAB directly above the feedback
 * launcher (same size as the share button), on the beta shell and the normal
 * one alike. Its popup opens upward from there.
 *
 * Who sees what: a viewer gets only the switch of the area they are in
 * (`area`, from `betaAreaOf`) in the normal accent, and no FAB where there is
 * no switch. Admins and collaborators get every area; their FAB is the
 * elevated-access red and names the role in its label.
 */
@Component({
  selector: 'sc-beta-fab',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (areas().length) {
      <aside class="wrap" [class.staff]="staff()" [attr.aria-label]="'beta.aria' | translate">
        <button type="button" class="fab" [attr.aria-expanded]="open()" aria-haspopup="dialog"
                [attr.aria-label]="label() | translate"
                [scTooltip]="label() | translate" scTooltipTier="label"
                (click)="open.set(!open())">
          <span class="mark" aria-hidden="true">β</span>
        </button>
        @if (open()) {
          <div class="panel" scDialog role="dialog" [attr.aria-label]="'beta.chip.title' | translate"
               (keydown.escape)="open.set(false)">
            <p class="head">{{ 'beta.chip.title' | translate }}</p>
            @for (a of areas(); track a) {
              <button type="button" role="switch" class="sw"
                      [attr.aria-checked]="beta.state()[a]"
                      [disabled]="beta.locked()[a]"
                      (click)="beta.toggle(a)">
                <span class="label">{{ ('beta.area.' + a) | translate }}
                  @if (staff() && a === 'shell') { <span class="only">{{ 'beta.staffOnly' | translate }}</span> }
                </span>
                <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
              </button>
            }
            @if (staff()) { <p class="note">{{ 'beta.chip.note' | translate }}</p> }
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* One lane above the feedback launcher, on its centre line; the popup opens
       upward. Phone: above the share button's lane (--sc-beta-fab-bottom). */
    .wrap {
      --_d: max(44px, var(--sc-tap-min, 44px));
      position: fixed; z-index: 160;
      inset-inline-end: calc(max(var(--sc-fab-inset, 24px), env(safe-area-inset-right, 0px)) + (var(--sc-fab-size, 56px) - var(--_d)) / 2);
      bottom: var(--sc-fab-clear-block, 96px);
      display: flex; flex-direction: column-reverse; align-items: flex-end; gap: var(--sc-space-2);
    }
    @media (max-width: 720px) {
      .wrap { inset-inline-end: var(--sc-fab-inset, 16px); bottom: var(--sc-beta-fab-bottom, var(--sc-fab-clear-block, 96px)); }
    }
    .fab {
      display: inline-grid; place-items: center; width: var(--_d); height: var(--_d);
      border-radius: 50%; padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-accent);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .staff .fab { color: var(--sc-accent-hot); border-color: color-mix(in srgb, var(--sc-accent-hot) 55%, var(--sc-border)); }
    .fab:hover, .fab[aria-expanded='true'] { background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-1)); border-color: var(--sc-accent); }
    .staff .fab:hover, .staff .fab[aria-expanded='true'] { background: color-mix(in srgb, var(--sc-accent-hot) 14%, var(--sc-bg-1)); border-color: var(--sc-accent-hot); }
    .fab:focus-visible, .sw:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .mark { font-family: var(--sc-font-display); font-weight: 700; font-size: 1.1rem; }
    .panel {
      display: flex; flex-direction: column; gap: var(--sc-space-1);
      min-width: 220px; max-width: min(var(--sc-ov-menu, 20rem), 100vw - 32px); padding: var(--sc-space-3);
      max-height: calc(100vh - var(--sc-fab-clear-block, 96px) - var(--sc-space-4));
      max-height: calc(100dvh - var(--sc-fab-clear-block, 96px) - var(--sc-space-4));
      overflow-y: auto;
      background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      border: 1px solid var(--sc-border); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px);
    }
    .head { margin: 0 0 var(--sc-space-1); font-family: var(--sc-font-display); letter-spacing: 0.08em;
      text-transform: uppercase; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .note { margin: var(--sc-space-1) 0 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sw {
      display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3);
      min-height: var(--sc-tap-min); padding: 0 var(--sc-space-2); border: 0; border-radius: 8px;
      background: none; color: var(--sc-fg-1); font: inherit; cursor: pointer; text-align: start;
    }
    .sw:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .sw:disabled { opacity: 0.45; cursor: not-allowed; }
    .label { font-size: max(0.82rem, var(--sc-fs-floor)); }
    .only { margin-inline-start: var(--sc-space-1); font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-accent-hot); text-transform: uppercase; letter-spacing: 0.06em; }
    .knob-track { position: relative; flex: none; width: 38px; height: 22px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); transition: background 0.16s; }
    .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-fg-2); transition: transform 0.16s, background 0.16s; }
    .sw[aria-checked='true'] .knob-track { background: color-mix(in srgb, var(--sc-accent) 35%, transparent); border-color: var(--sc-accent); }
    .sw[aria-checked='true'] .knob { transform: translateX(16px); background: var(--sc-accent); }
    @media (prefers-reduced-motion: reduce) { .knob, .knob-track { transition: none; } }
  `],
})
export class BetaFabComponent {
  protected readonly beta = inject(BetaService);
  protected readonly roles = inject(RoleService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** The area the reader is in (`betaAreaOf`); viewers get only this switch. */
  readonly area = input<BetaArea | null>(null);
  protected readonly open = signal(false);
  protected readonly staff = computed(() => this.roles.isCollaborator());
  protected readonly areas = computed<readonly BetaArea[]>(() => {
    if (this.staff()) return BETA_AREAS;
    const a = this.area();
    return a ? [a] : [];
  });
  protected readonly label = computed(() =>
    !this.staff() ? 'beta.aria' : this.roles.isAdmin() ? 'beta.fab.admin' : 'beta.fab.collaborator');

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    const wrap = (this.host.nativeElement as HTMLElement).querySelector('.wrap');
    if (wrap && !wrap.contains(ev.target as Node)) this.open.set(false);
  }
}
