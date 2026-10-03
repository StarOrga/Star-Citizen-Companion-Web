import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ShipBlueprintArtComponent } from './ship-blueprint-art.component';
import { ShipBlueprintService } from './ship-blueprint.service';
import type { ShipBlueprint } from './ship-blueprint.model';

/**
 * The ship's blueprint as a small icon (search rows). Shows the projected
 * content — the generic kind icon the row had before — until a drawing is
 * there, and for good when the ship has none, so a missing drawing never
 * leaves an empty or broken slot.
 */
@Component({
  selector: 'sc-ship-blueprint-icon',
  standalone: true,
  imports: [ShipBlueprintArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (drawing(); as bp) {
      <sc-ship-blueprint-art class="bp" [blueprint]="bp" detail="icon" />
    } @else {
      <ng-content />
    }
  `,
  styles: [`
    :host { display: contents; }
    .bp { width: 100%; height: 100%; }
  `],
})
export class ShipBlueprintIconComponent {
  private readonly blueprints = inject(ShipBlueprintService);
  /** `ship_skins.ship_id` = the codex class name. */
  readonly shipId = input<string | null>(null);

  readonly drawing = signal<ShipBlueprint | null>(null);
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
  }
}
