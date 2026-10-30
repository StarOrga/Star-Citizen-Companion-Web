import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';

interface AppCard {
  id: 'uploader' | 'starscape' | 'extension';
  link: string;
  /** Elevated access only (red group colour, see CLAUDE.md "Red means elevated access"). */
  elevated: boolean;
}

/**
 * /apps — one overview of everything that runs next to the website (concept
 * 2026-10-30): the Data Uploader, Starscape and the browser extension. Each
 * card is a real anchor to /apps/<name>; the uploader is only listed for the
 * roles its route admits (admin, collaborator).
 */
@Component({
  selector: 'sc-apps-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, PageHeaderComponent],
  template: `
    <sc-page-header
      [eyebrow]="'apps.hub.eyebrow' | translate"
      [title]="'apps.hub.title' | translate"
      [subtitle]="'apps.hub.subtitle' | translate" />
    <ul class="cards">
      @for (app of cards(); track app.id) {
        <li>
          <a class="sc-card card" [class.elevated]="app.elevated" [routerLink]="app.link">
            <strong class="name">{{ 'apps.hub.' + app.id + '.name' | translate }}</strong>
            <span class="desc">{{ 'apps.hub.' + app.id + '.desc' | translate }}</span>
            <span class="open">{{ 'apps.hub.open' | translate }} →</span>
          </a>
        </li>
      }
    </ul>
  `,
  styles: `
    .cards {
      list-style: none; margin: var(--sc-space-5) 0 0; padding: 0;
      display: grid; gap: var(--sc-space-4);
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    }
    .card {
      display: flex; flex-direction: column; gap: var(--sc-space-2); height: 100%;
      min-height: 48px; padding: var(--sc-space-4); text-decoration: none; color: var(--sc-fg-1);
    }
    .card:hover, .card:focus-visible { outline: none; border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .card.elevated:hover, .card.elevated:focus-visible { border-color: var(--sc-accent-hot); }
    .name { font-family: var(--sc-font-display); letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-accent); }
    .card.elevated .name { color: var(--sc-accent-hot); }
    .desc { flex: 1; }
    .open { color: var(--sc-fg-2); }
  `,
})
export class AppsHubComponent {
  private readonly roles = inject(RoleService);

  readonly cards = computed<AppCard[]>(() => {
    const role = this.roles.role();
    const list: AppCard[] = [];
    if (role === 'admin' || role === 'collaborator') {
      list.push({ id: 'uploader', link: '/apps/uploader', elevated: false });
    }
    list.push({ id: 'starscape', link: '/apps/starscape', elevated: false });
    list.push({ id: 'extension', link: '/apps/extension', elevated: false });
    return list;
  });
}
