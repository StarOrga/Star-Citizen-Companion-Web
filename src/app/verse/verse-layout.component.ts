import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { VerseBetaService } from './data/verse-beta.service';
import { VERSE_BETA_AREAS, VerseBetaArea } from './data/verse.models';

/** Deepest `verseArea` route data in a snapshot tree (the active Verse area). */
export function verseAreaOf(root: ActivatedRouteSnapshot | null): VerseBetaArea | null {
  let area: VerseBetaArea | null = null;
  for (let r: ActivatedRouteSnapshot | null = root; r; r = r.firstChild) {
    const a = r.data?.['verseArea'] as VerseBetaArea | undefined;
    if (a && VERSE_BETA_AREAS.includes(a)) area = a;
  }
  return area;
}

/**
 * Frame of the Verse tab: the routed area plus the sticky β dock in the
 * free bottom-left corner. The dock switches the CURRENT area between the new
 * Verse view and the legacy page it replaced; the chevron unfolds the switch
 * for every menu item. One UI switch, one backend.
 */
@Component({
  selector: 'sc-verse-layout',
  standalone: true,
  imports: [RouterOutlet, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />

    <aside class="beta-dock" [attr.aria-label]="'verse.beta.aria' | translate" (keydown.escape)="open.set(false)">
      @if (open()) {
        <ul class="beta-list" id="verse-beta-list">
          @for (a of areas; track a) {
            <li [class.current]="a === area()">
              <span class="bl-name">{{ ('verse.area.' + a) | translate }}</span>
              <button type="button" role="switch" class="sw"
                      [attr.aria-checked]="beta.state()[a]"
                      [attr.aria-label]="'verse.beta.switchFor' | translate:{ area: (('verse.area.' + a) | translate) }"
                      [disabled]="beta.locked()[a]"
                      (click)="beta.toggle(a)">
                <span class="knob" aria-hidden="true"></span>
              </button>
            </li>
          }
        </ul>
      }
      <div class="beta-pill">
        <span class="beta-mark" aria-hidden="true">β</span>
        @if (area(); as a) {
          <button type="button" role="switch" class="sw pill-sw"
                  [attr.aria-checked]="beta.state()[a]"
                  [disabled]="beta.locked()[a]"
                  [attr.aria-label]="'verse.beta.switchFor' | translate:{ area: (('verse.area.' + a) | translate) }"
                  (click)="beta.toggle(a)">
            <span class="pill-label">{{ ('verse.area.' + a) | translate }}</span>
            <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
          </button>
        }
        <button type="button" class="more"
                aria-controls="verse-beta-list"
                [attr.aria-expanded]="open()"
                [attr.aria-label]="'verse.beta.all' | translate"
                [scTooltip]="'verse.beta.all' | translate"
                (click)="open.set(!open())">
          <span aria-hidden="true" class="chev" [class.up]="open()">⌃</span>
        </button>
      </div>
    </aside>
  `,
  styles: [`
    :host { display: block; }
    .beta-dock {
      position: fixed; z-index: 40;
      left: max(12px, env(safe-area-inset-left));
      bottom: var(--sc-float-bottom, 16px);
      display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
      max-width: calc(100vw - var(--sc-fab-clear-inline, 88px) - 24px);
    }
    .beta-pill, .beta-list {
      background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent);
      border: 1px solid var(--sc-border); border-radius: 999px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(8px);
    }
    .beta-pill { display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 12px; }
    .beta-mark { font-family: var(--sc-font-display); color: var(--sc-accent); font-weight: 700; }
    .beta-list {
      list-style: none; margin: 0; padding: 8px; border-radius: 14px;
      display: grid; gap: 2px; min-width: 220px;
    }
    .beta-list li {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 4px 6px 4px 10px; border-radius: 10px; min-height: var(--sc-tap-min);
    }
    .beta-list li.current { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .bl-name { font-size: max(0.84rem, var(--sc-fs-floor)); }
    .sw {
      display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: inherit;
      font: inherit; cursor: pointer; min-height: var(--sc-tap-min); padding: 0 6px; border-radius: 999px;
    }
    .sw:disabled { opacity: 0.45; cursor: not-allowed; }
    .sw:focus-visible, .more:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pill-label { font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .knob-track, .beta-list .sw {
      position: relative; width: 38px; height: 22px; border-radius: 999px; padding: 0;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border);
      transition: background 0.16s;
    }
    .pill-sw { padding: 0 6px; }
    .knob {
      position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-fg-2); transition: transform 0.16s, background 0.16s;
    }
    .sw[aria-checked='true'] .knob-track, .beta-list .sw[aria-checked='true'] {
      background: color-mix(in srgb, var(--sc-accent) 35%, transparent); border-color: var(--sc-accent);
    }
    .sw[aria-checked='true'] .knob { transform: translateX(16px); background: var(--sc-accent); }
    .more {
      display: inline-grid; place-items: center; width: var(--sc-tap-min); height: var(--sc-tap-min);
      border: 0; border-radius: 50%; background: none; color: var(--sc-fg-2); cursor: pointer; font: inherit;
    }
    .more:hover { color: var(--sc-accent); }
    .chev { display: inline-block; transform: rotate(180deg); transition: transform 0.16s; line-height: 1; }
    .chev.up { transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .knob, .chev, .knob-track { transition: none; }
    }
  `],
})
export class VerseLayoutComponent {
  protected readonly beta = inject(VerseBetaService);
  private readonly router = inject(Router);

  protected readonly areas = VERSE_BETA_AREAS;
  protected readonly open = signal(false);
  private readonly snapshotArea = signal<VerseBetaArea | null>(verseAreaOf(this.router.routerState.snapshot.root));
  /** The β area of the page on screen. */
  readonly area = computed(() => this.snapshotArea());

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.snapshotArea.set(verseAreaOf(this.router.routerState.snapshot.root)));
  }
}
