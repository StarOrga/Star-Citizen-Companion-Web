import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'sc-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="logo">SC</span>
        <span class="title">Companion</span>
        <span class="sc-pill tech">alpha</span>
      </div>

      <nav class="nav">
        <a routerLink="/news" routerLinkActive="active">{{ 'nav.news' | translate }}</a>
        <a routerLink="/p4k" routerLinkActive="active">{{ 'nav.p4k' | translate }}</a>
        <a routerLink="/profile" routerLinkActive="active">{{ 'nav.profile' | translate }}</a>
      </nav>

      <div class="actions">
        <button class="sc-btn lang" (click)="toggleLang()">{{ langLabel() }}</button>
        <button class="sc-btn" (click)="auth.signOut()">{{ 'nav.signOut' | translate }}</button>
      </div>
    </header>

    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
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
      gap: 12px;
      min-width: 220px;
    }
    .brand .logo {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      font-family: var(--sc-font-display);
      font-weight: 900;
      background: linear-gradient(135deg, var(--sc-accent), var(--sc-accent-hot));
      color: var(--sc-bg-0);
      border-radius: 6px;
      font-size: 0.85rem;
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
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .lang { min-width: 60px; padding: 6px 10px; font-size: 0.75rem; }
    .content {
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
  private readonly translate = inject(TranslateService);
  readonly langLabel = computed(() => (this.translate.getCurrentLang() ?? 'en').toUpperCase());

  toggleLang() {
    const next = this.translate.getCurrentLang() === 'en' ? 'de' : 'en';
    this.translate.use(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem('sc.lang', next);
  }
}
