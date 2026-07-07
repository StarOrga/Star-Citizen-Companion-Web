import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { FeedbackFabComponent } from './feedback-fab.component';

@Component({
  selector: 'sc-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, FooterComponent, QuickSearchComponent, FeedbackFabComponent],
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
          <a routerLink="/uploader" routerLinkActive="active">{{ 'nav.desktop' | translate }}</a>
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
          <a routerLink="/admin/telemetry" routerLinkActive="active" class="admin-link">
            {{ 'nav.telemetry' | translate }}
          </a>
        }
      </nav>

      <div class="actions">
        <sc-quick-search />

        <div class="profile-menu">
          <button
            type="button"
            class="avatar-btn"
            (click)="toggleMenu($event)"
            [attr.aria-label]="'nav.accountMenu' | translate"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen()">
            {{ avatarInitial() }}
          </button>

          @if (menuOpen()) {
            <div class="dropdown" role="menu" (keydown)="onMenuKeydown($event)">
              <a
                class="dropdown-item"
                role="menuitem"
                routerLink="/settings"
                (click)="closeMenu()">
                {{ 'nav.settings' | translate }}
              </a>
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                [disabled]="signingOut()"
                (click)="doSignOut()">
                {{ 'nav.signOut' | translate }}
              </button>
            </div>
          }
        </div>
      </div>
    </header>

    <main class="content">
      <router-outlet />
    </main>

    <sc-footer />

    <sc-feedback-fab />
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

    .profile-menu { position: relative; }
    .avatar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid var(--sc-border);
      background: var(--sc-bg-1);
      color: var(--sc-accent);
      font-family: var(--sc-font-display);
      font-weight: 700;
      font-size: 1rem;
      letter-spacing: 0;
      cursor: pointer;
      transition: all 0.18s ease;
    }
    .avatar-btn:hover {
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.2);
    }
    .avatar-btn:focus-visible {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
    }

    .dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 180px;
      display: flex;
      flex-direction: column;
      padding: 6px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), var(--sc-glow);
      z-index: 30;
    }
    .dropdown-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 9px 12px;
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: var(--sc-fg-1);
      font-family: var(--sc-font-display);
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .dropdown-item:hover:not(:disabled),
    .dropdown-item:focus-visible {
      outline: none;
      color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.1);
    }
    .dropdown-item:disabled { opacity: 0.5; cursor: default; }

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
      /* Nav becomes a horizontally-scrollable strip so links never overflow
         the row or wrap awkwardly onto multiple lines. */
      .nav {
        flex: 1 1 100%;
        order: 3;
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        margin: 0 -16px;
        padding: 2px 16px;
      }
      .nav::-webkit-scrollbar { display: none; }
      .nav a { padding: 8px 12px; font-size: 0.72rem; white-space: nowrap; flex: 0 0 auto; }
      .actions { flex: 1; justify-content: flex-end; }
      .content { padding: 20px 16px; }
    }
    @media (max-width: 400px) {
      .topbar { padding: 8px 12px; }
      .nav { margin: 0 -12px; padding: 2px 12px; }
      /* Anchor the dropdown to the viewport edges so a 180px menu can't push
         the page wider than the screen. */
      .dropdown { right: 0; left: auto; min-width: 200px; max-width: calc(100vw - 24px); }
    }
  `],
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly signingOut = signal(false);
  readonly menuOpen = signal(false);

  readonly avatarInitial = computed(() => {
    const user = this.auth.user();
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (meta['username'] as string | undefined) ??
      (meta['full_name'] as string | undefined) ??
      (meta['name'] as string | undefined) ??
      user?.email ??
      '';
    const first = name.trim().charAt(0);
    return first ? first.toUpperCase() : '?';
  });

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  // Close on any click outside the profile-menu subtree.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.menuOpen()) return;
    const menuEl = (this.host.nativeElement as HTMLElement).querySelector('.profile-menu');
    if (menuEl && !menuEl.contains(event.target as Node)) {
      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.menuOpen()) this.closeMenu();
  }

  onMenuKeydown(event: KeyboardEvent) {
    const items = Array.from(
      (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.dropdown-item'),
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(idx + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    }
  }

  async doSignOut() {
    if (this.signingOut()) return;
    this.closeMenu();
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
    } finally {
      this.signingOut.set(false);
    }
  }
}
