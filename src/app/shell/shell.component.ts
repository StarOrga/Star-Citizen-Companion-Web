import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { FooterComponent } from './footer.component';

type LangId = 'de' | 'en' | 'fr' | 'es' | 'pt' | 'ru' | 'zh';

@Component({
  selector: 'sc-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/news" [attr.aria-label]="'nav.brandAria' | translate">
        <img class="logo" src="icons/scc-favicon.svg" alt="" width="32" height="32" />
        <span class="title">Star Citizen Companion</span>
        <span class="sc-pill tech">alpha</span>
      </a>

      <nav class="nav">
        <a routerLink="/news" routerLinkActive="active">{{ 'nav.news' | translate }}</a>
        <a routerLink="/codex" routerLinkActive="active">{{ 'nav.codex' | translate }}</a>
        <a routerLink="/hangar" routerLinkActive="active">{{ 'nav.hangar' | translate }}</a>
        @if (roles.isCollaborator()) {
          <a routerLink="/p4k" routerLinkActive="active">{{ 'nav.p4k' | translate }}</a>
          <a routerLink="/desktop" routerLinkActive="active">{{ 'nav.desktop' | translate }}</a>
        }
        @if (roles.isAdmin()) {
          <a
            routerLink="/admin"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            class="admin-link">
            {{ 'nav.admin' | translate }}
          </a>
          <a routerLink="/admin/api-tokens" routerLinkActive="active" class="admin-link">
            {{ 'admin.tokens.navLink' | translate }}
          </a>
        }
        <a routerLink="/profile" routerLinkActive="active">{{ 'nav.profile' | translate }}</a>
      </nav>

      <div class="actions">
        <select class="sc-select lang" [value]="currentLang()" (change)="setLang(asLangValue($event))" [attr.aria-label]="'nav.langAria' | translate">
          @for (l of locales; track l) {
            <option [value]="l">{{ l.toUpperCase() }}</option>
          }
        </select>
        <button class="sc-btn" [disabled]="signingOut()" (click)="doSignOut()">{{ 'nav.signOut' | translate }}</button>
      </div>
    </header>

    <main class="content">
      <router-outlet />
    </main>

    <sc-footer />
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 100vh; }
    .topbar {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 14px 28px;
      background: linear-gradient(180deg, var(--sc-bg-2), transparent);
      border-bottom: 1px solid var(--sc-border);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 10;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 200px;
      text-decoration: none;
      color: inherit;
    }
    .brand .logo {
      width: 32px;
      height: 32px;
      filter: drop-shadow(0 0 6px rgba(0, 212, 255, 0.4));
    }
    .brand .title {
      font-family: var(--sc-font-display);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 600;
    }
    .nav {
      display: flex;
      gap: 4px;
      flex: 1;
      flex-wrap: wrap;
    }
    .nav a {
      padding: 8px 16px;
      color: var(--sc-fg-1);
      font-family: var(--sc-font-display);
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 4px;
      transition: all 0.18s ease;
      text-decoration: none;
      &:hover { color: var(--sc-accent); background: rgba(0, 212, 255, 0.08); }
      &.active {
        color: var(--sc-accent);
        background: rgba(0, 212, 255, 0.14);
        box-shadow: inset 0 -2px 0 var(--sc-accent);
      }
    }
    .nav a.admin-link {
      color: var(--sc-accent-hot);
      &:hover { color: var(--sc-accent-hot); background: rgba(255, 87, 34, 0.1); }
      &.active { color: var(--sc-accent-hot); box-shadow: inset 0 -2px 0 var(--sc-accent-hot); }
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .sc-select.lang {
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      padding: 6px 10px;
      font-family: var(--sc-font-display);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      cursor: pointer;
      min-width: 60px;
    }
    .sc-select.lang:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .content {
      flex: 1;
      width: 100%;
      padding: 32px 28px;
      max-width: 1280px;
      margin: 0 auto;
    }
    @media (max-width: 720px) {
      .topbar { gap: 12px; padding: 10px 16px; }
      .brand { min-width: 0; }
      .brand .title { display: none; }
      .nav a { padding: 6px 10px; font-size: 0.7rem; }
      .content { padding: 20px 16px; }
    }
  `],
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
  private readonly translate = inject(TranslateService);

  readonly locales: readonly LangId[] = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'zh'];
  readonly currentLang = computed(() => (this.translate.getCurrentLang() ?? 'en') as LangId);
  readonly signingOut = signal(false);

  async doSignOut() {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
    } finally {
      this.signingOut.set(false);
    }
  }

  setLang(next: LangId) {
    this.translate.use(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem('sc.lang', next);
  }

  asLangValue(e: Event): LangId {
    return (e.target as HTMLSelectElement).value as LangId;
  }
}
