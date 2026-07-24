import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { FeedbackFabComponent } from './feedback-fab.component';

@Component({
  selector: 'sc-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, FooterComponent, QuickSearchComponent, FeedbackFabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Routed views "develop" into focus as they mount — fade + slight rise, keyed
  // to a per-navigation counter so it replays on every switch. Header/footer are
  // outside .content, so they stay put.
  animations: [
    trigger('routeReveal', [
      transition(':increment', [
        style({ opacity: 0, transform: 'translateY(10px) scale(0.994)' }),
        animate('320ms cubic-bezier(0.2, 0.8, 0.2, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
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
        <a routerLink="/starscape" routerLinkActive="active">{{ 'nav.starscape' | translate }}</a>
        <!-- Hangar is intentionally NOT a top-level nav entry: it lives under the
             Codex Bridge as a sub-link (see codex-bridge.component). Admin call
             (feedback f0363cef) — declutter the nav bar, route Hangar via Codex. -->
        @if (roles.isCollaborator()) {
          <!-- Restricted (collaborator+admin) area — flagged red like the
               admin-only links so privileged sections stand out from public. -->
          <a routerLink="/uploader" routerLinkActive="active" class="admin-link mobile-hidden">{{ 'nav.desktop' | translate }}</a>
        }
        @if (roles.isAdmin()) {
          <a
            routerLink="/admin"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            class="admin-link">
            {{ 'nav.admin' | translate }}
          </a>
          <a routerLink="/admin/api-tokens" routerLinkActive="active" class="admin-link mobile-hidden">
            {{ 'admin.tokens.navLink' | translate }}
          </a>
          <a routerLink="/admin/telemetry" routerLinkActive="active" class="admin-link">
            {{ 'nav.telemetry' | translate }}
          </a>
        }
      </nav>

      <div class="actions">
        <sc-quick-search />

        @if (!auth.user()) {
          <!-- Signed-out (#131): the account menu is meaningless — offer the
               sign-in CTA instead (redirects back after login via authGuard). -->
          <a class="sc-btn signin-btn" routerLink="/login">{{ 'nav.signIn' | translate }}</a>
        } @else {
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
              <div class="dropdown-header">
                <span class="dh-name">{{ displayName() }}</span>
                @if (auth.user()?.email; as email) {
                  <span class="dh-email">{{ email }}</span>
                }
              </div>
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
        }
      </div>
    </header>

    <!-- Navigation "sensor sweep" — only appears once a switch runs past 250ms,
         so it covers the lazy-chunk/guard gap on real waits but never flashes on
         instant/cached routes. -->
    @if (navActive()) {
      <div class="nav-scan" role="status" aria-live="polite">
        <span class="nav-scan__bar"></span>
      </div>
      @if (navPhase() === 'weak') {
        <div class="nav-scan__label">{{ 'nav.loading.weak' | translate }}</div>
      }
    }

    <main class="content" [@routeReveal]="reveal()">
      <router-outlet (activate)="onRouteActivate()" />
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
      /* Instant tap acknowledgment — the switch feels pressed before any load. */
      &:active { transform: scale(0.96); }
      &.active {
        color: var(--sc-accent);
        background: rgba(0, 212, 255, 0.14);
        box-shadow: inset 0 -2px 0 var(--sc-accent);
      }
    }

    /* Navigation progress — the "sensor sweep" scan bar, pinned to the very top
       of the viewport above the sticky header (classic top-loading-bar spot). */
    .nav-scan {
      position: fixed; top: 0; left: 0; right: 0; z-index: 50;
      height: 2px; overflow: hidden; pointer-events: none;
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
    }
    .nav-scan__bar {
      position: absolute; top: 0; left: 0; height: 100%; width: 38%;
      background: linear-gradient(90deg, transparent, var(--sc-accent) 45%, var(--sc-accent-hot) 55%, var(--sc-accent) 65%, transparent);
      box-shadow: 0 0 12px var(--sc-accent);
      animation: nav-scan-sweep 1.05s cubic-bezier(0.45, 0, 0.25, 1) infinite;
      will-change: transform;
    }
    @keyframes nav-scan-sweep {
      0% { transform: translateX(-130%); }
      100% { transform: translateX(360%); }
    }
    /* Reassurance for genuinely slow loads (>3s) — a bottom-centre HUD toast,
       matching the app's existing toast placement so it never clashes with the header. */
    .nav-scan__label {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 50; pointer-events: none;
      padding: 4px 14px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-bg-2) 88%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      font-family: var(--sc-font-display); font-size: 0.62rem; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--sc-accent);
      animation: sc-reveal-in 0.3s ease both;
    }
    @media (prefers-reduced-motion: reduce) {
      .nav-scan__bar { animation: none; width: 100%;
        background: color-mix(in srgb, var(--sc-accent) 40%, transparent); box-shadow: none; }
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
    .signin-btn {
      text-decoration: none;
      color: var(--sc-accent);
      border-color: var(--sc-accent);
      white-space: nowrap;
    }
    .signin-btn:hover { background: var(--sc-accent); color: var(--sc-bg-0); }

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
    .dropdown-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 12px 10px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--sc-border);
    }
    .dropdown-header .dh-name {
      font-family: var(--sc-font-display);
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--sc-fg-0);
      overflow-wrap: anywhere;
    }
    .dropdown-header .dh-email {
      font-size: 0.72rem;
      color: var(--sc-fg-2);
      overflow-wrap: anywhere;
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
      /* Desktop-only workflows (Data Upload, External API) can't be used on a
         phone — hide them so the mobile nav strip stays short (admin feedback
         32cbf3ad). Routes still work via deep-link. */
      .nav a.mobile-hidden { display: none; }
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
  readonly profile = inject(ProfileService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly signingOut = signal(false);
  readonly menuOpen = signal(false);

  // Bumped each time a routed view mounts so the [@routeReveal] animation replays.
  readonly reveal = signal(0);

  // Navigation "sensor sweep" state. Gated at 250ms so instant/cached routes
  // never flash a loader; escalates to a "weak signal" label past 3s.
  readonly navActive = signal(false);
  readonly navPhase = signal<'acquiring' | 'weak'>('acquiring');
  private navShowTimer: ReturnType<typeof setTimeout> | null = null;
  private navWeakTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.startNavIndicator();
      } else if (
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError
      ) {
        this.stopNavIndicator();
      }
    });
    this.destroyRef.onDestroy(() => this.clearNavTimers());
  }

  /** A routed view mounted — replay the content reveal. */
  onRouteActivate(): void {
    this.reveal.update((n) => n + 1);
  }

  // Show the sweep only after 250ms so a snappy navigation shows nothing at all
  // (a flash-of-loader makes fast apps feel slower); escalate the label past 3s.
  private startNavIndicator(): void {
    this.clearNavTimers();
    this.navShowTimer = setTimeout(() => {
      this.navPhase.set('acquiring');
      this.navActive.set(true);
    }, 250);
    this.navWeakTimer = setTimeout(() => this.navPhase.set('weak'), 3000);
  }

  private stopNavIndicator(): void {
    this.clearNavTimers();
    this.navActive.set(false);
    this.navPhase.set('acquiring');
  }

  private clearNavTimers(): void {
    if (this.navShowTimer) {
      clearTimeout(this.navShowTimer);
      this.navShowTimer = null;
    }
    if (this.navWeakTimer) {
      clearTimeout(this.navWeakTimer);
      this.navWeakTimer = null;
    }
  }

  /**
   * The user's chosen handle is the primary identity (see feedback: "username
   * is how you are first identified"). Fall back to auth metadata, then email.
   */
  readonly displayName = computed(() => {
    const username = this.profile.username();
    if (username) return username;
    const user = this.auth.user();
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (
      (meta['full_name'] as string | undefined) ??
      (meta['name'] as string | undefined) ??
      user?.email ??
      ''
    );
  });

  readonly avatarInitial = computed(() => {
    const first = this.displayName().trim().charAt(0);
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
