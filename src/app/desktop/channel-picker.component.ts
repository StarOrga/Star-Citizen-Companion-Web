import { ChangeDetectionStrategy, Component, computed, effect, inject, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';

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
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 1) {
      <label class="chan">
        <span>{{ 'desktop.channel.label' | translate }}</span>
        <select [value]="channel()" (change)="pick($event)">
          @for (c of options(); track c) {
            <option [value]="c">{{ 'desktop.channel.' + c | translate }}</option>
          }
        </select>
      </label>
    }
  `,
  styles: [`
    .chan { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--sc-fg-2); }
    .chan select {
      background: var(--sc-bg-2); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; padding: 4px 8px;
      font-family: inherit; font-size: 0.8rem;
    }
  `],
})
export class ChannelPickerComponent {
  private readonly roles = inject(RoleService);
  readonly channel = model<ReleaseChannel>('stable');
  readonly options = computed<ReleaseChannel[]>(
    () => ALLOWED[this.roles.role() ?? 'viewer'] ?? ['stable'],
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

  pick(ev: Event): void {
    this.channel.set((ev.target as HTMLSelectElement).value as ReleaseChannel);
  }
}
