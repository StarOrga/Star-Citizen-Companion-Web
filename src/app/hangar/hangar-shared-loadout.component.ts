// The shared-link landing page (`/hangar/shared/:token`, concept hg6-*).
// Public BY DESIGN, same reasoning as `social/shared-loadout.component.ts`:
// anyone holding the link can PEEK the loadout without an account
// (wave 1.5 user decision 3); adopting it into their own hangar still needs a
// session. Rendered through `PublicLayoutComponent` (ungated route) so the
// anonymous half actually works — see app.routes.ts.
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { humanizeClassName } from '../codex/codex-format';
import { AuthService } from '../auth/auth.service';
import { HangarService } from './hangar.service';
import { PeekedSharedLoadout } from './hangar.types';

type LandingState = 'loading' | 'available' | 'unavailable';

@Component({
  selector: 'sc-hangar-shared-loadout',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      @switch (state()) {
        @case ('loading') {
          <div class="sc-card state">{{ 'hangar.shared.loading' | translate }}</div>
        }
        @case ('available') {
          @if (peek(); as p) {
            <header class="head">
              <p class="eyebrow">{{ 'hangar.shared.eyebrow' | translate }}</p>
              <h1>{{ shipName(p) }}</h1>
              <div class="badges">
                <span class="badge">{{ ('hangar.roles.' + (p.role ?? 'multipurpose')) | translate }}</span>
                <span class="badge subtle">{{ p.channel }} · {{ p.patchVersion }}</span>
              </div>
              <p class="byline">{{ 'hangar.shared.by' | translate: { name: p.ownerName ?? '—' } }}</p>
            </header>

            <div class="sc-card">
              <p class="loadout-name">{{ p.name }}</p>
              @if (p.loadout.length === 0) {
                <p class="state inline">{{ 'hangar.shared.emptyLoadout' | translate }}</p>
              } @else {
                <ul class="slot-list">
                  @for (entry of p.loadout; track $index) {
                    <li class="slot">
                      <span class="slot-item">{{ entryLabel(entry) }}</span>
                    </li>
                  }
                </ul>
              }
            </div>

            @if (auth.isAuthenticated()) {
              <button type="button" class="sc-btn adopt" [disabled]="adopting()" (click)="adopt(p)"
                      [attr.title]="'hangar.shared.adoptHint' | translate">
                {{ (adopting() ? 'hangar.shared.adopting' : 'hangar.shared.adopt') | translate }}
              </button>
              @if (adoptError()) {
                <p class="err">{{ 'hangar.shared.adoptError' | translate }}</p>
              }
            } @else {
              <a class="sc-btn adopt" [routerLink]="['/login']">{{ 'hangar.shared.loginToAdopt' | translate }}</a>
            }
          }
        }
        @case ('unavailable') {
          <div class="sc-card state">
            <p class="state__title">{{ 'hangar.shared.unavailable.title' | translate }}</p>
            <p>{{ 'hangar.shared.unavailable.body' | translate }}</p>
            <a class="sc-btn" routerLink="/about">{{ 'hangar.shared.aboutCta' | translate }}</a>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; max-width: 680px; margin: 0 auto; }
    .eyebrow { margin: 0 0 4px; color: var(--sc-fg-2); font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; }
    h1 { margin: 0; overflow-wrap: anywhere; }
    .badges { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .badge { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 2px 8px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); text-transform: uppercase; letter-spacing: 0.05em; }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); text-transform: none; letter-spacing: 0; }
    .byline { margin: 10px 0 0; color: var(--sc-fg-2); font-size: 0.86rem; }
    .loadout-name { margin: 0 0 8px; font-weight: 600; }
    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .slot { padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .slot-item { font-size: 0.9rem; overflow-wrap: anywhere; }
    .state { color: var(--sc-fg-2); text-align: center; padding: 28px; }
    .state.inline { padding: 12px 0; text-align: left; }
    .state__title { color: var(--sc-fg-0); font-weight: 600; margin: 0 0 6px; }
    .err { margin: 0; color: var(--sc-danger, #ff5252); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .sc-btn.adopt { align-self: flex-start; text-decoration: none; min-height: 48px; }
    .state .sc-btn { align-self: center; margin-top: 14px; }
  `],
})
export class HangarSharedLoadoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);
  readonly auth = inject(AuthService);

  readonly state = signal<LandingState>('loading');
  readonly peek = signal<PeekedSharedLoadout | null>(null);
  readonly adopting = signal(false);
  readonly adoptError = signal(false);

  readonly token = computed(() => this.route.snapshot.paramMap.get('token') ?? '');

  async ngOnInit(): Promise<void> {
    const token = this.token().trim();
    if (!token) {
      this.state.set('unavailable');
      return;
    }
    const result = await this.hangar.peekSharedLoadout(token);
    // Revoked, expired and unknown all answer identically (null) — same
    // "no distinguishable probe" reasoning as `get_shared_loadout()`.
    if (!result) {
      this.state.set('unavailable');
      return;
    }
    this.peek.set(result);
    this.state.set('available');
  }

  async adopt(p: PeekedSharedLoadout): Promise<void> {
    this.adoptError.set(false);
    this.adopting.set(true);
    try {
      const adopted = await this.hangar.adoptSharedLoadout(this.token().trim());
      if (!adopted) {
        this.adoptError.set(true);
        return;
      }
      void this.router.navigate(['/codex', 'ship', p.shipClassName], { queryParams: { view: 'holo' } });
    } finally {
      this.adopting.set(false);
    }
  }

  shipName(p: PeekedSharedLoadout): string {
    return humanizeClassName(p.shipClassName);
  }

  entryLabel(entry: unknown): string {
    const e = entry as { className?: string | null; slot?: string } | null;
    return e?.className ? humanizeClassName(e.className) : '—';
  }
}
