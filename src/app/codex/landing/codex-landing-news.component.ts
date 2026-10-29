import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { PatchSummaryView } from './codex-landing-data.types';

/**
 * News button of the Codex landing (round 6, d1-s5): the KI patch summary of
 * the current build. The dot marks a summary this user has not opened yet
 * (per patch, stored in the profile — the data service owns that state).
 */
@Component({
  selector: 'sc-codex-landing-news',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary(); as s) {
      <button type="button" class="news" [class.on]="open()" [attr.aria-expanded]="open()" aria-haspopup="dialog"
              [attr.aria-label]="'codex.landing.news.open' | translate: { patch: s.patchVersion }" (click)="toggle()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>
        @if (unread()) { <i class="dot"></i><span class="sc-sr-only">{{ 'codex.landing.news.unread' | translate }}</span> }
        <span aria-hidden="true">{{ 'codex.landing.news.button' | translate }}</span> <b aria-hidden="true">{{ s.patchVersion }}</b>
      </button>
      @if (open()) {
        <div class="pop" role="dialog" scDialog [scDialogModal]="false"
             [attr.aria-label]="'codex.landing.news.title' | translate: { patch: s.patchVersion }" (scDialogEscape)="open.set(false)">
          <div class="pop-head">
            <span class="label">{{ 'codex.landing.news.title' | translate: { patch: s.patchVersion } }}</span>
            <span class="mono">{{ 'codex.landing.news.source' | translate }}</span>
          </div>
          <ul>
            @for (line of s.lines; track $index) { <li><b aria-hidden="true">›</b><span>{{ line }}</span></li> }
          </ul>
          <p class="pop-foot">
            <a [href]="s.patchNotesUrl" target="_blank" rel="noopener noreferrer">
              {{ (s.patchNotesIsThread ? 'codex.landing.news.notes' : 'codex.landing.news.notesOverview') | translate }} <i aria-hidden="true">↗</i>
            </a>
          </p>
        </div>
      }
    }
  `,
  styles: [
    `
      :host { position: relative; display: block; }
      .news {
        position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 14px 0 12px;
        border-radius: 999px; border: 1px solid rgba(82, 193, 230, 0.35); background: rgba(10, 30, 44, 0.72); cursor: pointer;
        font: 600 max(10px, 0.62rem) var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-1);
      }
      .news svg { width: 15px; height: 15px; color: var(--sc-accent); }
      .news b { font: 400 12px var(--font-monospace, 'Share Tech Mono', monospace); letter-spacing: 0; color: var(--sc-fg-0); }
      .news:hover, .news.on { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .news.on { background: rgba(82, 193, 230, 0.14); }
      .news:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .dot {
        position: absolute; top: 6px; left: 22px; width: 8px; height: 8px; border-radius: 50%;
        background: var(--sc-accent); box-shadow: 0 0 0 2px #0b1f2c, 0 0 10px rgba(82, 193, 230, 0.9);
      }
      .pop {
        position: absolute; right: 0; top: calc(100% + 10px); z-index: 8;
        width: min(390px, 100vw - 2 * var(--sc-page-gutter)); padding: 14px 14px 12px;
        border: 1px solid transparent; border-radius: var(--sc-sub-radius, 5px); text-align: left;
        background: var(--sc-sub-fill) padding-box, var(--sc-sub-edge) border-box;
        box-shadow: 0 0 22px rgba(82, 193, 230, 0.18), 0 24px 48px rgba(0, 0, 0, 0.6);
      }
      .pop:focus { outline: none; }
      .pop-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 4px; }
      .label { font: 600 max(9px, 0.56rem) var(--sc-font-display); letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-fg-1); }
      .mono { font: 400 11px var(--font-monospace, 'Share Tech Mono', monospace); color: var(--sc-fg-2); }
      ul { list-style: none; margin: 8px 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
      li { display: flex; gap: 10px; padding: 8px 6px; font-size: 13px; line-height: 1.35; color: var(--sc-fg-0); }
      li b { flex: 0 0 14px; font-weight: 400; text-align: center; color: var(--sc-accent); }
      .pop-foot { margin: 0; padding: 10px 4px 0; border-top: 1px solid var(--sc-border); font-size: 11px; }
      .pop-foot a { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; color: var(--sc-accent); text-decoration: none; }
      .pop-foot a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .pop-foot i { font-style: normal; }
      @media (max-width: 720px) {
        .news { min-height: 32px; padding: 0 10px; font-size: 9px; }
        .dot { top: 4px; left: 18px; }
        .pop { position: fixed; left: 14px; right: 14px; top: 72px; width: auto; }
      }
    `,
  ],
})
export class CodexLandingNewsComponent {
  readonly summary = input<PatchSummaryView | null>(null);
  readonly unread = input(false);
  /** Fired the first time the popover opens (the landing marks the patch seen). */
  readonly opened = output<void>();
  readonly open = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const onDown = (ev: PointerEvent) => {
      if (this.open() && ev.target instanceof Node && !host.contains(ev.target)) this.open.set(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('pointerdown', onDown, true));
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.opened.emit();
  }
}
