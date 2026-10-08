import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import { ConstellationFigureComponent } from './constellation-figure.component';
import { STARS_PER_PATCH } from './starmap.model';

/** Header entry to the star map: the current patch's mini constellation + lit count. */
@Component({
  selector: 'sc-explorer-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, ConstellationFigureComponent],
  template: `
    <a
      class="glyph"
      routerLink="/verse/explorer"
      [attr.aria-label]="'starmap.glyph.aria' | translate: { lit: lit(), total: total }"
      [scTooltip]="'starmap.glyph.aria' | translate: { lit: lit(), total: total }"
      scTooltipTier="label">
      <sc-constellation-figure class="fig" size="small" [points]="points()" [starCount]="lit()" [sun]="sun()" />
      <span class="count">{{ lit() }}</span>
    </a>
  `,
  styles: [
    `
      :host { display: inline-flex; }
      .glyph { display: inline-flex; align-items: center; gap: 4px; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-pad-1);
        border-radius: 8px; color: var(--sc-fg-1); text-decoration: none; }
      .glyph:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .glyph:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .fig { width: 26px; }
      .count { font: 600 0.8rem var(--sc-font-display); font-variant-numeric: tabular-nums; }
    `,
  ],
})
export class ExplorerGlyphComponent {
  private readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);
  readonly total = STARS_PER_PATCH;

  private readonly current = computed(() => this.api.explorer()?.patches[0] ?? null);
  readonly points = computed(() => this.current()?.constellation?.points ?? null);
  readonly lit = computed(() => Math.min(STARS_PER_PATCH, this.current()?.starCount ?? 0));
  readonly sun = computed(() => this.current()?.sun ?? false);

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
  }
}
