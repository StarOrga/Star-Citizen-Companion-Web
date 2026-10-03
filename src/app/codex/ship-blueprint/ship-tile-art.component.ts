import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FallbackImageComponent } from '../fallback-image.component';
import { ShipBlueprintArtComponent } from './ship-blueprint-art.component';
import { ShipBlueprintService } from './ship-blueprint.service';
import type { ShipBlueprint } from './ship-blueprint.model';

/**
 * A ship tile's art: the blueprint drawing stands in until the store image has
 * loaded, then the image cross-fades over it. The image itself is framed —
 * rounded, its edges fading out, a faint accent halo — instead of a hard
 * rectangle.
 *
 * Without a drawing the tile behaves exactly as before: the image (no fade),
 * and the projected placeholder icon once every candidate has failed. With a
 * drawing and no working image, the drawing simply stays.
 */
@Component({
  selector: 'sc-ship-tile-art',
  standalone: true,
  imports: [FallbackImageComponent, ShipBlueprintArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" [class.has-bp]="!!drawing()" [class.shown]="loaded()">
      @if (drawing(); as bp) {
        <sc-ship-blueprint-art class="bp" [blueprint]="bp" detail="tile" />
      }
      <sc-fallback-image [candidates]="candidates()" [alt]="alt()" [eager]="eager()" (loaded)="loaded.set(true)">
        @if (!drawing()) {
          <ng-content />
        }
      </sc-fallback-image>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .stack {
      display: grid; place-items: center; width: 100%; height: 100%; min-width: 0;
      --sc-img-area: 1 / 1;
      --sc-img-radius: 10px;
      --sc-img-mask: radial-gradient(ellipse farthest-corner at 50% 50%, #000 50%, transparent 100%);
      --sc-img-shadow: drop-shadow(0 0 12px color-mix(in srgb, var(--sc-accent) 22%, transparent))
        drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
    }
    /* The drawing holds the slot; the image waits invisible until it has loaded. */
    .stack.has-bp { --sc-img-fade: 420ms; }
    .stack.has-bp:not(.shown) { --sc-img-opacity: 0; }
    .bp {
      grid-area: 1 / 1; width: 100%; height: 100%; max-height: var(--sc-img-max-h, 100%);
      color: color-mix(in srgb, var(--sc-accent) 78%, transparent);
      transition: opacity 420ms ease;
    }
    .stack.shown .bp { opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
      .stack.has-bp { --sc-img-fade: 0s; }
      .bp { transition: none; }
    }
  `],
})
export class ShipTileArtComponent {
  private readonly blueprints = inject(ShipBlueprintService);
  /** `ship_skins.ship_id` = the codex class name; null = no drawing lookup. */
  readonly shipId = input<string | null>(null);
  /** Ordered store-art candidates, best first (see sc-fallback-image). */
  readonly candidates = input<readonly string[]>([]);
  readonly alt = input('');
  readonly eager = input(false);

  readonly drawing = signal<ShipBlueprint | null>(null);
  /** The shown image has loaded — the drawing fades out. */
  readonly loaded = signal(false);
  private request = 0;

  constructor() {
    void this.blueprints.load();
    effect(() => {
      const id = this.shipId();
      const has = !!this.blueprints.urls(id)?.icon;
      const token = ++this.request;
      this.drawing.set(null);
      if (!has) return;
      void this.blueprints.drawing(id, 'icon').then((bp) => {
        if (token === this.request) this.drawing.set(bp);
      });
    });
    // A new candidate list is a new image: the drawing holds the slot again until
    // it loads. Keyed by value — hosts hand in a fresh array on every render.
    effect(() => {
      this.candidateKey();
      this.loaded.set(false);
    });
  }

  private readonly candidateKey = computed(() => this.candidates().join('\n'));
}
