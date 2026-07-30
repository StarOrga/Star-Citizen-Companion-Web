import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReleaseNotesService } from '../release-notes/release-notes.service';

/**
 * Site-wide footer. Shown on both the public login page and inside the
 * authenticated shell. Carries the "Made by the Community" fan badge and
 * the trademark disclaimer required for a Star Citizen fan site.
 */
@Component({
  selector: 'sc-footer',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="site-footer">
      <div class="inner">
        <div class="badge">
          <img src="icons/made-by-community.png"
               [alt]="'footer.badgeAlt' | translate"
               width="36" height="36" />
          <span class="badge-label">{{ 'footer.madeByCommunity' | translate }}</span>
        </div>

        <div class="meta">
          <p class="brand">Star Citizen Companion</p>
          @if (expanded()) {
            <p class="disclaimer">{{ 'footer.disclaimer' | translate }}</p>
            <p class="copyright">
              {{ 'footer.trademarks' | translate }}
              <button type="button" class="disclaimer-toggle"
                      (click)="expanded.set(false)"
                      [attr.aria-label]="'footer.disclaimerCollapse' | translate">▲</button>
            </p>
          } @else {
            <p class="disclaimer">{{ disclaimerShort() }}<button
                      type="button" class="disclaimer-toggle"
                      (click)="expanded.set(true)"
                      [attr.aria-label]="'footer.disclaimerExpand' | translate">…</button></p>
          }
        </div>

        <div class="whatsnew">
          <a routerLink="/release-notes">{{ 'releaseNotes.whatsNew' | translate }}</a>
          @if (version(); as v) {
            <span class="ver">v{{ v }}</span>
          }
          <nav class="legal-links" [attr.aria-label]="'footer.legalNav' | translate">
            <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
          </nav>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    .site-footer {
      border-top: 1px solid var(--sc-border);
      background: linear-gradient(0deg, var(--sc-bg-2), transparent);
      padding: 12px 28px;
      margin-top: auto;
    }
    /* The community badge and the disclaimer column need real air between them
       (feedback #79, item 6): at 18px the wrapped "… Community" and the
       "Dies ist eine inoffizielle …" line ran into each other and read as one
       sentence. 34px separates the two blocks without breaking the single row. */
    .inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 34px;
      flex-wrap: nowrap;
    }
    .badge {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .badge img {
      filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.35));
    }
    .badge-label {
      font-family: var(--sc-font-display);
      font-size: 0.58rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      max-width: 9ch;
      line-height: 1.2;
    }
    .meta { flex: 1; min-width: 0; }
    .meta .brand {
      font-family: var(--sc-font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-1);
      margin: 0 0 2px;
      font-size: 0.8rem;
    }
    .meta .disclaimer {
      color: var(--sc-fg-2);
      font-size: 0.74rem;
      line-height: 1.4;
      margin: 0;
    }
    .meta .copyright {
      color: var(--sc-fg-2);
      font-size: 0.7rem;
      line-height: 1.4;
      margin: 2px 0 0;
      opacity: 0.8;
    }
    .disclaimer-toggle {
      appearance: none;
      background: none;
      border: none;
      padding: 0 0 0 2px;
      margin: 0;
      font: inherit;
      color: var(--sc-accent);
      cursor: pointer;
      vertical-align: baseline;
    }
    .disclaimer-toggle:hover { color: var(--sc-fg-1); }
    .disclaimer-toggle:focus-visible {
      outline: 1px solid var(--sc-accent);
      outline-offset: 2px;
      border-radius: 2px;
    }
    .whatsnew {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
    }
    .whatsnew a {
      font-family: var(--sc-font-display);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-accent);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .whatsnew a:hover { color: var(--sc-fg-1); }
    .whatsnew .ver {
      color: var(--sc-fg-2);
      font-size: 0.68rem;
      font-family: ui-monospace, monospace;
    }
    .legal-links {
      display: flex;
      gap: 6px;
      font-size: 0.68rem;
      color: var(--sc-fg-2);
    }
    .legal-links a {
      color: var(--sc-fg-2);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .legal-links a:hover { color: var(--sc-accent); }
    @media (max-width: 640px) {
      .site-footer { padding: 12px 16px; }
      .inner { flex-direction: column; align-items: flex-start; gap: 10px; }
      .badge-label { max-width: none; }
      .whatsnew { align-items: flex-start; }
    }
  `],
})
export class FooterComponent implements OnInit {
  private readonly releaseNotes = inject(ReleaseNotesService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly version = signal<string | null>(this.releaseNotes.notes()?.current ?? null);

  /** Whether the full legal disclaimer + trademark line is shown. */
  readonly expanded = signal(false);

  /** Full, localized disclaimer text — kept in sync with the active language. */
  private readonly disclaimerFull = signal('');

  /** First clause of the disclaimer plus an ellipsis affordance. */
  readonly disclaimerShort = computed(() => {
    const clause = this.disclaimerFull().split(/[,，]/)[0]?.trim() ?? '';
    return clause ? `${clause} ` : '';
  });

  constructor() {
    this.syncDisclaimer();
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncDisclaimer());
  }

  private syncDisclaimer(): void {
    this.translate
      .get('footer.disclaimer')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((text: string) => this.disclaimerFull.set(text));
  }

  async ngOnInit(): Promise<void> {
    const notes = await this.releaseNotes.load();
    if (notes) this.version.set(notes.current);
  }
}
