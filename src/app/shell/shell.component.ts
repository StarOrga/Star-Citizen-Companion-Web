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
import { ImpersonationService } from '../auth/impersonation.service';
import { ViewAs } from '../auth/impersonation-policy';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { FeedbackFabComponent } from './feedback-fab.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';
import { VerseStatusChipComponent } from '../news/verse-status-chip.component';

@Component({
  selector: 'sc-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, FooterComponent, QuickSearchComponent, VerseStatusChipComponent, FeedbackFabComponent, UserFeedbackFabComponent],
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
      <!-- Wordmark: the "alpha" badge is CENTERED UNDER the title, not beside it
           (feedback #79). It is absolutely positioned on purpose — the title's
           own vertical position had to stay exactly where it was, so the badge
           must not take part in the brand row's layout. -->
      <!-- The brand is the "home" control: it points at /news, the app's home
           route. Re-clicking it while already on /news refreshes the feed
           instead of doing nothing (feedback 7532e639). -->
      <a
        class="brand"
        routerLink="/news"
        [attr.aria-label]="'nav.brandAria' | translate"
        (click)="onNavActivate($event, '/news')">
        <img class="logo" src="icons/scc-favicon.svg" alt="" width="32" height="32" />
        <span class="wordmark">
          <span class="title">Star Citizen Companion</span>
          <span class="alpha-badge">alpha</span>
        </span>
      </a>

      <nav class="nav">
        <!-- Tapping the ALREADY ACTIVE entry reloads the page's data (feedback
             7532e639) — the router drops a same-URL navigation, so without this
             the second click is a dead control. -->
        <a routerLink="/news" routerLinkActive="active" (click)="onNavActivate($event, '/news')">
          {{ 'nav.news' | translate }}
        </a>
        <a routerLink="/codex" routerLinkActive="active">{{ 'nav.codex' | translate }}</a>
        <!-- Hangar is deliberately NOT a top-level entry (feedback f0363cef).
             It is a subview of Codex: the "Im Hangar" zone on the Codex landing
             (codex-landing.component.ts) is itself a full-zone entrance link
             into /hangar, so a dedicated nav slot would be a redundant second
             door to the same place (correction, 2026-08-16, superseding the
             short-lived top-level entry added and reverted the same day). -->
        <a routerLink="/starscape" routerLinkActive="active">{{ 'nav.starscape' | translate }}</a>
        <!-- Data Upload is intentionally NOT a top-level nav entry (admin
             feedback eb9c6ec3): a whole menu slot for a tool only collaborators
             and admins ever open. It now lives as the collapsible
             sc-uploader-access line on the Codex Bridge — the Codex is what it
             feeds — with /uploader still reachable behind it. -->
        <!-- Integrations (formerly "External API") is intentionally NOT a
             top-level nav entry either (admin feedback 85477aaa): a rarely-used
             account-scoped page doesn't earn a permanent nav slot. It moved into
             the profile dropdown below; /admin/api-tokens still resolves. -->
        @if (roles.isAdmin()) {
          <a
            routerLink="/admin"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            class="admin-link">
            {{ 'nav.admin' | translate }}
          </a>
          <a routerLink="/admin/telemetry" routerLinkActive="active" class="admin-link">
            {{ 'nav.telemetry' | translate }}
          </a>
        }
      </nav>

      <div class="actions">
        <!-- "Is Star Citizen playable" — moved out of the Verse-News page into
             the header, immediately left of the search (feedback #79). -->
        <sc-verse-status-chip />
        <sc-quick-search />

        <!--
          Defect A (dead-code sweep): an "@if (!auth.user())" branch used to
          live here with a sign-in CTA and a redundant "exit-preview" button,
          commented as "the only way back" while signed out. It never
          rendered: every shell child route carries canActivateChild:
          [authGuard, approvedGuard] (app.routes.ts), and authGuard bounces
          to /login before the shell mounts a route at all — including during
          an 'anon' preview, since auth.user()/isAuthenticated() are
          shadowed to null/false in that case too (auth.service.ts), so the
          bounce happens then as well. The shell therefore never renders with
          auth.user() null; the actual (and only) way back during an 'anon'
          preview is ImpersonationBannerComponent, mounted app-level in
          app.component.ts and reachable from every route including /login.
        -->
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
              @if (roles.isAdmin()) {
                <!-- Admin-gated (roleGuard('admin') on the route) — showing it to
                     everyone would only ever hand out a redirect. -->
                <a
                  class="dropdown-item"
                  role="menuitem"
                  routerLink="/admin/api-tokens"
                  (click)="closeMenu()">
                  {{ 'admin.tokens.navLink' | translate }}
                </a>
              }

              @if (imp.targets().length > 0 && !imp.active()) {
                <!-- "View as" (client-side, downgrade-only preview — see
                     ImpersonationService). Shown ONLY while NOT already
                     previewing: once a preview is active the dropdown must look
                     exactly like the target role's own menu — a real viewer
                     never sees a "view as" switcher — so the whole section is
                     hidden. The way back to the real role is the exit button in
                     the always-visible ImpersonationBannerComponent (mounted in
                     AppComponent), reachable from every route including /login.
                     The separator is a plain div, deliberately not a
                     .dropdown-item, so the roving ArrowUp/ArrowDown focus in
                     onMenuKeydown() skips over it. -->
                <div class="dropdown-sep" role="separator">
                  <span>{{ 'nav.viewAs.title' | translate }}</span>
                </div>
                @for (target of imp.targets(); track target) {
                  <button
                    type="button"
                    class="dropdown-item"
                    role="menuitem"
                    (click)="enterViewAs(target)">
                    {{ ('nav.viewAs.' + target) | translate }}
                  </button>
                }
              }

              @if (imp.active()) {
                <!-- Redundant way back, in addition to the always-visible
                     ImpersonationBannerComponent. #364 moved the exit out of this
                     menu onto the banner alone; a user who opens the account menu
                     looking for it — where it used to live — otherwise finds
                     nothing and feels trapped (reported: "kann nicht mehr
                     zurückschalten"). The role SWITCHER stays hidden during a
                     preview (a real target role never sees it), but a single
                     "back to my role" item is not a fidelity leak: a real
                     viewer/collaborator is never in a preview, so never sees it. -->
                <div class="dropdown-sep" role="separator">
                  <span>{{ 'nav.viewAs.title' | translate }}</span>
                </div>
                <button
                  type="button"
                  class="dropdown-item"
                  role="menuitem"
                  (click)="exitViewAs()">
                  {{ 'nav.viewAs.exit' | translate }}
                </button>
              }

              <!-- C1: visually separates "Ansehen als" from "Abmelden" — a plain
                   <hr>, not a .dropdown-item, so onMenuKeydown()'s roving focus
                   skips over it (same reasoning as .dropdown-sep above). -->
              <hr class="menu-sep" role="separator" />

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

    @if (imp.enterFailed()) {
      <!-- Defect A: enter() used to reload unconditionally even when the
           sessionStorage write was silently dropped (private mode / full
           quota), so picking a target looked like it did nothing. Now the
           service refuses to reload on an unverified write and surfaces
           this instead — dismissible so it doesn't linger past a retry. -->
      <div class="imp-enter-error" role="alert">
        <span>{{ 'impersonation.enterFailed' | translate }}</span>
        <button type="button" class="imp-enter-error__dismiss" (click)="dismissEnterError()">
          {{ 'impersonation.enterFailedDismiss' | translate }}
        </button>
      </div>
    }

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

    <!-- Two mutually exclusive launchers: the admin board for admins, the slim
         "send feedback" panel for every other signed-in user (feedback
         5920cf8c). Each gates itself on the role, so only ever one renders. -->
    <sc-feedback-fab />
    <sc-user-feedback-fab />
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
      /* Slides down under sc-impersonation-banner while a preview is active —
         see that component's constructor, which owns this var (0px = no-op). */
      top: var(--sc-imp-banner-h, 0px);
      z-index: 10;
      flex-wrap: wrap;
    }
    /* Header rhythm: brand left, nav dead centre, actions right (feedback #79).
       Both flanks run on flex: 1 1 0, so they share the leftover width evenly
       and the nav lands on the header's centre line rather than wherever the
       brand happens to end. */
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1 1 0;
      min-width: 200px;
      text-decoration: none;
      color: inherit;
    }
    .brand .logo {
      width: 32px;
      height: 32px;
      filter: drop-shadow(0 0 6px rgba(0, 212, 255, 0.4));
    }
    /* Positioning context for the alpha badge only — the title is the sole item
       in flow here, so the wordmark's box (and the title's baseline) is exactly
       what it was before the badge moved underneath it. */
    .brand .wordmark { position: relative; display: inline-flex; align-items: center; }
    .brand .title {
      font-family: var(--sc-font-display);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 600;
    }
    /* Out of flow (see .wordmark): centred under the title, in a light italic
       script hand so it reads as a hand-written margin note rather than a
       second badge competing with the wordmark. */
    .brand .alpha-badge {
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translate(-50%, 1px);
      pointer-events: none;
      font-family: 'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive;
      font-style: italic;
      font-size: max(0.72rem, var(--sc-fs-floor));
      font-weight: 400;
      line-height: 1;
      letter-spacing: 0.06em;
      color: color-mix(in srgb, var(--sc-accent) 85%, transparent);
      text-shadow: 0 0 8px color-mix(in srgb, var(--sc-accent) 30%, transparent);
      white-space: nowrap;
    }
    .nav {
      display: flex;
      gap: 4px;
      flex: 0 1 auto;
      justify-content: center;
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
      position: fixed; top: var(--sc-imp-banner-h, 0px); left: 0; right: 0; z-index: 50;
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
      font-family: var(--sc-font-display); font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.16em;
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
      flex: 1 1 0;
      justify-content: flex-end;
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
      font-size: max(0.72rem, var(--sc-fs-floor));
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
      font-size: max(0.78rem, var(--sc-fs-floor));
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
    /* A .dropdown-item.is-current rule used to paint an account-menu entry in
       the hot accent. Nothing ever set is-current, so it was dead — and
       reviving it would have painted an ungated menu item red, which now means
       "admin only" (admin feedback b8b31f24). Removed rather than recoloured. */
    /* Deliberately not .dropdown-item — kept out of onMenuKeydown()'s
       ArrowUp/ArrowDown roving-focus query. */
    .dropdown-sep {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 4px 2px 2px;
      padding-top: 6px;
      border-top: 1px solid var(--sc-border);
      font-family: var(--sc-font-display);
      font-size: max(0.66rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    /* C1: groups "Abmelden" apart from everything above it (settings /
       integrations / view-as). Plain <hr>, matching .dropdown-sep's border
       tone rather than a browser-default rule. */
    .menu-sep {
      width: 100%;
      margin: 6px 2px 4px;
      border: 0;
      border-top: 1px solid var(--sc-border);
    }

    /* Defect A notice: a preview whose sessionStorage write did not
       verifiably stick. Sits as its own strip (not a floating toast) so it
       reads deliberately, not like a transient status message. */
    .imp-enter-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 8px 16px;
      background: rgba(248, 113, 113, 0.1);
      border-bottom: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      font-size: max(0.82rem, var(--sc-fs-floor));
      text-align: center;
    }
    .imp-enter-error__dismiss {
      flex: none;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--sc-danger);
      background: transparent;
      color: var(--sc-danger);
      font-size: max(0.76rem, var(--sc-fs-floor));
      cursor: pointer;
    }
    .imp-enter-error__dismiss:hover { background: rgba(248, 113, 113, 0.15); }

    /* Head room above a page title, trimmed by ~1/5 (32 → 26px) so the first
       heading is not marooned in empty space (feedback #79, item 5). The
       reclaimed space is reused below the heading by the pages themselves. */
    .content {
      flex: 1;
      width: 100%;
      padding: 26px 28px 32px;
      max-width: 1280px;
      margin: 0 auto;
    }
    @media (max-width: 720px) {
      .topbar { gap: 12px; padding: 10px 16px; }
      .brand { min-width: 0; flex: 0 0 auto; }
      .brand .title { display: none; }
      /* Without the title there is nothing to sit under — the badge goes back
         beside the logo so it does not float over the header edge. */
      .brand .alpha-badge { position: static; transform: none; }
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
      .nav a { padding: 8px 12px; font-size: max(0.72rem, var(--sc-fs-floor)); white-space: nowrap; flex: 0 0 auto; }
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
  readonly imp = inject(ImpersonationService);
  readonly profile = inject(ProfileService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sameRoute = inject(SameRouteRefreshService);

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

  /**
   * A nav anchor was activated. These stay real `<a [routerLink]>` links, so
   * middle click / Ctrl+⌘+Shift+click keep opening a new tab — those never mean
   * "refresh this view" and are handed straight back to the browser. Only the
   * plain left click can be a same-route re-activation, and only then does the
   * routed page get asked to reload its data.
   */
  onNavActivate(event: MouseEvent, path: string): void {
    if (!isPlainLeftClick(event)) return;
    this.sameRoute.request(path);
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

  /**
   * Enters a role preview. `ImpersonationService.enter()` is itself a no-op
   * outside `imp.targets()`, but the menu never renders a button for a value
   * outside that list in the first place — this is a second, redundant gate.
   */
  enterViewAs(target: ViewAs) {
    this.closeMenu();
    this.imp.enter(target);
  }

  /**
   * Leaves the active preview — redundant with the always-visible
   * ImpersonationBannerComponent's exit, so the way back is reachable from the
   * account menu too (where users instinctively look for it).
   */
  exitViewAs() {
    this.closeMenu();
    this.imp.exit();
  }

  /** Dismisses the "preview did not persist" notice (defect A) without retrying. */
  dismissEnterError() {
    this.imp.clearEnterFailed();
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
