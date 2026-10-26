import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';

interface ToolTile {
  readonly key: string;
  readonly link: string;
  readonly path: string;
}

/**
 * Tool pages that used to be reachable only through a small icon (shell beta,
 * implement.md §12 "lost pages surfaced"): a tile per tool on the Codex
 * landing. Every tile is a real anchor.
 */
@Component({
  selector: 'sc-codex-tool-tiles',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shell()) {
      <nav class="tiles" [attr.aria-label]="'codex.landing.tiles.label' | translate">
        @for (t of tiles; track t.key) {
          <a class="tile" [routerLink]="t.link">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.path" /></svg>
            <span class="txt">
              <strong>{{ 'codex.landing.tiles.' + t.key + '.title' | translate }}</strong>
              <span>{{ 'codex.landing.tiles.' + t.key + '.text' | translate }}</span>
            </span>
            <span class="go" aria-hidden="true">→</span>
          </a>
        }
      </nav>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--sc-space-3, 12px); }
      .tile { display: flex; align-items: center; gap: var(--sc-space-3, 12px); min-height: var(--sc-tap-min, 44px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px);
        border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg-1); text-decoration: none; }
      .tile:hover, .tile:focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); outline: none; text-decoration: none; }
      .tile:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .icon { width: 28px; height: 28px; flex: 0 0 auto; color: var(--sc-accent); }
      .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
      .txt strong { color: var(--sc-fg-0); }
      .txt span { font-size: 0.85rem; color: var(--sc-fg-2); }
      .go { color: var(--sc-fg-2); }
      .tile:hover .go { color: var(--sc-accent); }
    `,
  ],
})
export class CodexToolTilesComponent {
  protected readonly shell = inject(BetaService).isEnabled('shell');

  protected readonly tiles: readonly ToolTile[] = [
    { key: 'keybinds', link: '/codex/keybinds', path: 'M14 3a5 5 0 0 0-4.9 6.1L3 15.2V19h3.8l1-1h2v-2h2l1.1-1.1A5 5 0 1 0 14 3z' },
  ];
}
