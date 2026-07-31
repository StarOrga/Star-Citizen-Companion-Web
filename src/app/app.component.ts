import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth/auth.service';
import { AnalyticsService } from './core/analytics.service';
import { ConsentBannerComponent } from './core/consent-banner.component';
import { LocaleService } from './core/locale/locale.service';
import { SupabaseClientProvider } from './core/supabase.client';
import { SwUpdateService } from './core/sw-update.service';

@Component({
  selector: 'sc-root',
  standalone: true,
  imports: [RouterOutlet, TranslateModule, ConsentBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />

    <!-- First-visit browser-storage notice (#130) — self-hides once decided. -->
    <sc-consent-banner />

    @if (swUpdate.updateReady()) {
      <div class="sw-update" role="status" aria-live="polite">
        <span class="sw-update__msg">{{ 'update.available' | translate }}</span>
        <button type="button" class="sc-btn sc-btn-primary" (click)="swUpdate.applyUpdate()">
          {{ 'update.reload' | translate }}
        </button>
        <button type="button" class="sw-update__dismiss" (click)="swUpdate.dismiss()">
          {{ 'update.dismiss' | translate }}
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      .sw-update {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 14px;
        max-width: calc(100vw - 32px);
        padding: 12px 16px;
        background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
        border: 1px solid var(--sc-accent);
        border-radius: 8px;
        box-shadow: var(--sc-glow);
      }

      .sw-update__msg {
        font-family: var(--sc-font-display);
        font-size: 0.85rem;
        letter-spacing: 0.04em;
        color: var(--sc-fg-0);
      }

      .sw-update__dismiss {
        background: transparent;
        border: 0;
        color: var(--sc-fg-2);
        font-size: 0.8rem;
      }

      .sw-update__dismiss:hover {
        color: var(--sc-fg-0);
        text-decoration: underline;
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly analytics = inject(AnalyticsService);
  private readonly locale = inject(LocaleService);
  readonly swUpdate = inject(SwUpdateService);

  /**
   * Guards the preference race: the profile's locale columns are applied only
   * ONCE, on the first post-login load. Without this flag a language the user
   * changes in the same session would be clobbered the next time the auth
   * signal re-emits (e.g. token refresh).
   */
  private appliedProfileLocale = false;

  constructor() {
    // After auth is ready and a user appears, load their stored locale
    // preferences and apply them — but only on the initial post-login load, so
    // a switch made in the current session is never overridden (see flag).
    effect(() => {
      const user = this.auth.user();
      if (!user || this.appliedProfileLocale) return;
      this.appliedProfileLocale = true;
      this.sb.client
        .from('profiles')
        .select('preferred_lang, preferred_region')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          // LocaleService ignores anything unusable — legacy languages
          // (fr/es/…) that have no real translation (issue #23), NULL columns,
          // and a `preferred_region` that is absent because the migration has
          // not been applied yet.
          this.locale.hydrateFromProfile(
            data?.['preferred_lang'] as string | null | undefined,
            data?.['preferred_region'] as string | null | undefined,
          );
        });
    });

    // The resolved language is the single source of truth for ngx-translate:
    // whatever LocaleService decides (profile → explicit choice → browser →
    // English) is what gets activated, including later switches.
    effect(() => {
      const lang = this.locale.language();
      if (lang !== this.translate.getCurrentLang()) this.translate.use(lang);
    });
  }

  ngOnInit(): void {
    // Activate synchronously on boot so the first paint is already translated;
    // the effect above only handles subsequent changes.
    const initial = this.locale.language();
    this.translate.use(initial);

    // Sync <html lang> with the active translation so SEO + screenreaders
    // see the right language. ngx-translate does not touch this attribute.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = initial;
      this.translate.onLangChange.subscribe((e) => {
        document.documentElement.lang = e.lang;
      });
    }

    this.auth.init();
    this.swUpdate.init();
    // No-op without a configured key or statistics consent (#139).
    this.analytics.init();
  }
}
