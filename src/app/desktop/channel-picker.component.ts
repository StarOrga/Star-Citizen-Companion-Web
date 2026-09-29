import { ChangeDetectionStrategy, Component, computed, effect, inject, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';

export type ReleaseChannel = 'alpha' | 'beta' | 'stable';

/** Channels each role may select, highest tier first (also the default). */
const ALLOWED: Record<string, ReleaseChannel[]> = {
  admin: ['alpha', 'beta', 'stable'],
  collaborator: ['beta', 'stable'],
  viewer: ['stable'],
};

/**
 * Role-gated release-channel selector. Renders nothing for viewers (stable is
 * the only option). The bound `channel` model always defaults to the role's
 * top tier and is re-clamped whenever the allowed set changes.
 */
@Component({
  selector: 'sc-channel-picker',
  standalone: true,
  imports: [TranslatePipe, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 1) {
      <!-- A div, not a label: a label would forward the click on a list
           option to the trigger and snap the list shut again. -->
      <div class="chan">
        <span aria-hidden="true">{{ 'desktop.channel.label' | translate }}</span>
        <sc-select
          [options]="channelOptions()"
          [allowEmpty]="false"
          [value]="channel()"
          [ariaLabel]="'desktop.channel.label' | translate"
          (valueChange)="pick($event)"
        />
      </div>
    }
  `,
  styles: [`
    .chan { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--sc-fg-2); }
    .chan sc-select { min-inline-size: 9rem; }
  `],
})
export class ChannelPickerComponent {
  private readonly roles = inject(RoleService);
  readonly channel = model<ReleaseChannel>('stable');
  readonly options = computed<ReleaseChannel[]>(
    () => ALLOWED[this.roles.role() ?? 'viewer'] ?? ['stable'],
  );

  readonly channelOptions = computed<readonly ScSelectOption[]>(() =>
    this.options().map((c) => ({ value: c, labelKey: 'desktop.channel.' + c })),
  );

  constructor() {
    // Default to the role's top-tier channel (alpha for admin, beta for
    // collaborator, stable for viewer). The effect depends ONLY on options(),
    // so it re-defaults when the role changes but never clobbers a manual pick
    // (picking a channel leaves options() unchanged, so this does not re-run).
    effect(() => {
      this.channel.set(this.options()[0]);
    });
  }

  pick(value: string | null): void {
    this.channel.set((value ?? this.options()[0]) as ReleaseChannel);
  }
}
