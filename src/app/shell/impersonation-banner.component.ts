import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';

/**
 * Global "you are previewing another role" strip.
 *
 * Mounted in `AppComponent`, not `ShellComponent`: the signed-out preview
 * bounces private routes to `/login`, which renders OUTSIDE the shell — this
 * banner is the only way back from there, so it must be reachable from every
 * route, including that one.
 *
 * Placement: a full-width TOP strip. `ShellComponent`'s sticky header and its
 * nav-loading sweep both read the `--sc-imp-banner-h` custom property this
 * component sets on the document root, so they slide down under the banner
 * instead of fighting it for the top of the viewport. Every OTHER fixed
 * overlay in the app (consent banner, SW-update toast, nav-scan "weak
 * signal" label) is bottom-anchored, so a top strip collides with none of
 * them by construction.
 */
@Component({
  selector: 'sc-impersonation-banner',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (imp.active()) {
      <div #banner class="imp-banner" role="status" [attr.aria-label]="'impersonation.banner.aria' | translate">
        <span class="imp-banner__msg">
          <strong>{{ 'impersonation.banner.viewingAs' | translate: { role: (viewingLabelKey() | translate) } }}</strong>
          <span class="imp-banner__real">{{ 'impersonation.banner.realRole' | translate: { role: (realRoleLabelKey() | translate) } }}</span>
          <span class="imp-banner__fidelity">{{ fidelityKey() | translate }}</span>
        </span>
        <button type="button" class="imp-banner__exit" (click)="imp.exit()">
          {{ 'impersonation.banner.exit' | translate }}
        </button>
      </div>
    }
  `,
  styles: [`
    .imp-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 36px;
      padding: 4px 16px;
      background: var(--sc-accent-hot);
      color: #10060a;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    }
    .imp-banner__msg {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      column-gap: 10px;
      row-gap: 2px;
      font-size: max(0.76rem, var(--sc-fs-floor));
      line-height: 1.3;
    }
    .imp-banner__msg strong {
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .imp-banner__real { opacity: 0.85; white-space: nowrap; }
    .imp-banner__fidelity {
      flex-basis: 100%;
      opacity: 0.9;
      font-size: max(0.7rem, var(--sc-fs-floor));
    }
    .imp-banner__exit {
      flex: 0 0 auto;
      padding: 5px 12px;
      border-radius: 4px;
      border: 1px solid #10060a;
      background: #10060a;
      color: var(--sc-accent-hot);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: opacity 0.16s ease;
      white-space: nowrap;
    }
    .imp-banner__exit:hover { opacity: 0.85; }
    .imp-banner__exit:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--sc-accent-hot), 0 0 0 4px #10060a;
    }
    @media (max-width: 720px) {
      .imp-banner { flex-wrap: wrap; padding: 6px 12px; }
      .imp-banner__fidelity { display: none; }
    }
  `],
})
export class ImpersonationBannerComponent {
  readonly imp = inject(ImpersonationService);
  private readonly roles = inject(RoleService);
  private readonly document = inject(DOCUMENT);

  /** i18n key for the previewed view — `nav.viewAs.anon` for the signed-out preview, `profile.roles.*` otherwise. */
  readonly viewingLabelKey = computed(() => this.roleLabelKey(this.imp.viewAs()));
  /** i18n key for the real (DB) role — always `profile.roles.*`, never `anon`. */
  readonly realRoleLabelKey = computed(() => this.roleLabelKey(this.roles.realRole()));

  /** Which fidelity note applies — 'anon' is the exact case, everything else shares the caveat. */
  readonly fidelityKey = computed(() => {
    const v = this.imp.viewAs();
    if (v === 'anon') return 'impersonation.banner.fidelity.anon';
    if (v === 'collaborator') return 'impersonation.banner.fidelity.collaborator';
    return 'impersonation.banner.fidelity.viewer';
  });

  private readonly bannerEl = viewChild<ElementRef<HTMLElement>>('banner');
  private observer: ResizeObserver | null = null;

  constructor() {
    // Publish the banner's height as a CSS var so ShellComponent's sticky
    // header / nav-scan sweep can offset themselves instead of being covered.
    // MEASURED, not assumed: the fidelity note wraps to a second line at
    // narrow widths and in the longer locale, which made a hard-coded 36px
    // leave the header 16px underneath the strip.
    effect(() => {
      const host = this.bannerEl()?.nativeElement ?? null;
      this.observer?.disconnect();
      this.observer = null;
      if (!host) {
        this.setHeight(0);
        return;
      }
      this.setHeight(host.offsetHeight);
      const RO = this.document.defaultView?.ResizeObserver;
      if (!RO) return; // measured once above; no live tracking without the API
      this.observer = new RO(() => this.setHeight(host.offsetHeight));
      this.observer.observe(host);
    });

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.setHeight(0);
    });
  }

  private setHeight(px: number): void {
    this.document.documentElement.style.setProperty('--sc-imp-banner-h', `${px}px`);
  }

  /** `nav.viewAs.anon` for the signed-out preview, `profile.roles.*` for real roles. */
  private roleLabelKey(role: string | null): string {
    return role === 'anon' ? 'nav.viewAs.anon' : `profile.roles.${role ?? 'viewer'}`;
  }
}
