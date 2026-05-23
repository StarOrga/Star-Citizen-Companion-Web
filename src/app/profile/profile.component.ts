import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';

@Component({
  selector: 'sc-profile',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'profile.title' | translate }}</h1>
      @if (auth.user(); as user) {
        <div class="sc-card">
          <div class="row">
            <span class="label">{{ 'profile.email' | translate }}</span>
            <span class="value">{{ user.email }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.role' | translate }}</span>
            <span class="value">
              <span class="role-pill" [class]="roles.role() ?? 'viewer'">
                {{ ('profile.roles.' + (roles.role() ?? 'viewer')) | translate }}
              </span>
            </span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.id' | translate }}</span>
            <span class="value mono">{{ user.id }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.provider' | translate }}</span>
            <span class="value">{{ user.app_metadata['provider'] ?? 'email' }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.created' | translate }}</span>
            <span class="value">{{ user.created_at }}</span>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 720px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--sc-border);
      &:last-child { border-bottom: 0; }
    }
    .label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .value { color: var(--sc-fg-0); }
    .mono { font-family: monospace; font-size: 0.85rem; }
    .role-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.admin { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.collaborator { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.viewer { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
}
