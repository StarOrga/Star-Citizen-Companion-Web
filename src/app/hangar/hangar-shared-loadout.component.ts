// The shared-link landing page (`/hangar/shared/:token`, concept hg6-*).
// Public BY DESIGN, same reasoning as `social/shared-loadout.component.ts`:
// anyone holding the link can PEEK the loadout without an account
// (wave 1.5 user decision 3); adopting it into their own hangar still needs a
// session. Rendered through `PublicLayoutComponent` (ungated route) so the
// anonymous half actually works — see app.routes.ts.
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { humanizeClassName } from '../codex/codex-format';
import { AuthService } from '../auth/auth.service';
import { toErrorKey } from '../core/describe-error';
import { HangarService } from './hangar.service';
import { PeekedSharedLoadout } from './hangar.types';
import { SharedLoadoutAdopter, holoSharedLink } from './shared-loadout-adopter.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

type LandingState = 'loading' | 'available' | 'unavailable' | 'error';

@Component({
  selector: 'sc-hangar-shared-loadout',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScTooltipDirective],
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

            <div class="actions">
              <!-- The loadout on the ship itself (#646), read-only on the
                   Holotable. A real anchor: a signed-out reader passes the
                   login wall and comes back to exactly this view. -->
              @if (holoLink(p); as hl) {
                <a class="sc-btn holo" [routerLink]="hl.commands" [queryParams]="hl.queryParams">
                  {{ 'hangar.shared.viewOnHolotable' | translate }}
                </a>
              }
              @if (auth.isAuthenticated()) {
                <button type="button" class="sc-btn adopt" [disabled]="adopting()" (click)="adopt(p)"
                        [scTooltip]="'hangar.shared.adoptHint' | translate">
                  {{ (adopting() ? 'hangar.shared.adopting' : 'hangar.shared.adopt') | translate }}
                </button>
                @if (adoptError()) {
                  <p class="err" role="alert">{{ 'hangar.shared.adoptError' | translate }}</p>
                }
              } @else {
                <a class="sc-btn adopt" [routerLink]="['/login']" [queryParams]="{ redirect: selfUrl() }">{{ 'hangar.shared.loginToAdopt' | translate }}</a>
              }
            </div>
          }
        }
        @case ('error') {
          <div class="sc-card state" role="alert">
            <p class="state__title">{{ 'hangar.shared.loadError' | translate }}</p>
            <p>{{ loadErrorKey() | translate }}</p>
            <button type="button" class="sc-btn retry" (click)="load()">{{ 'codex.error.retry' | translate }}</button>
          </div>
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
    /* The full page frame (styles.scss, "PAGE FRAME") — no width of its own.
       The slots tile across it (below) instead of running frame-wide. */
    .page { display: flex; flex-direction: column; gap: 16px; }
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
    .slot-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr)); }
    .slot { padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .slot-item { font-size: 0.9rem; overflow-wrap: anywhere; }
    .state { color: var(--sc-fg-2); text-align: center; padding: 28px; }
    .state.inline { padding: 12px 0; text-align: left; }
    .state__title { color: var(--sc-fg-0); font-weight: 600; margin: 0 0 6px; }
    .err { margin: 0; flex-basis: 100%; color: var(--sc-danger, #ff5252); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .sc-btn.adopt, .sc-btn.holo { display: inline-flex; align-items: center; text-decoration: none; min-height: 48px; }
    .state .sc-btn { align-self: center; margin-top: 14px; }
  `],
})
export class HangarSharedLoadoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly hangar = inject(HangarService);
  private readonly adopter = inject(SharedLoadoutAdopter);
  readonly auth = inject(AuthService);

  readonly state = signal<LandingState>('loading');
  readonly peek = signal<PeekedSharedLoadout | null>(null);
  readonly adopting = signal(false);
  readonly adoptError = signal(false);
  /** `errors.*` key of a failed peek READ — the error state, never "unavailable". */
  readonly loadErrorKey = signal('errors.generic');

  readonly token = computed(() => this.route.snapshot.paramMap.get('token') ?? '');
  /** This page's own path — where the login sends a signed-out reader back to. */
  readonly selfUrl = computed(() => `/hangar/shared/${encodeURIComponent(this.token().trim())}`);

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    const token = this.token().trim();
    if (!token) {
      this.state.set('unavailable');
      return;
    }
    this.state.set('loading');
    let result: PeekedSharedLoadout | null;
    try {
      result = await this.hangar.peekSharedLoadout(token);
    } catch (error) {
      // A failed read is not a dead link: say so and offer the retry.
      this.loadErrorKey.set(toErrorKey('hangar', 'peekSharedLoadout', error));
      this.state.set('error');
      return;
    }
    // Revoked, expired and unknown all answer identically (null) — same
    // "no distinguishable probe" reasoning as `get_shared_loadout()`.
    if (!result) {
      this.state.set('unavailable');
      return;
    }
    this.peek.set(result);
    this.state.set('available');
  }

  /** Adopt → reload the hangar → the adopted config opens as the Holotable's draft (#646). */
  async adopt(p: PeekedSharedLoadout): Promise<void> {
    this.adoptError.set(false);
    this.adopting.set(true);
    try {
      const ok = await this.adopter.adoptAndOpen(this.token().trim(), p.shipClassName);
      if (!ok) this.adoptError.set(true);
    } finally {
      this.adopting.set(false);
    }
  }

  holoLink(p: PeekedSharedLoadout): ReturnType<typeof holoSharedLink> | null {
    return p.shipClassName ? holoSharedLink(p.shipClassName, this.token().trim()) : null;
  }

  shipName(p: PeekedSharedLoadout): string {
    return humanizeClassName(p.shipClassName);
  }

  entryLabel(entry: unknown): string {
    const e = entry as { className?: string | null; slot?: string } | null;
    return e?.className ? humanizeClassName(e.className) : '—';
  }
}
