import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The animated round app logo (`public/brand/app-logo.svg`, copied from the
 * Companion App's desktop resources). Shown through an `<img>` so the SVG's
 * own ids and gradients stay isolated; its animation runs inside the image.
 * Always round: masked to a circle, never an oval. `size` is the diameter as
 * a CSS length (default `1em`, so it follows the surrounding font size).
 */
@Component({
  selector: 'sc-app-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--logo-size]': 'size()' },
  template: `<img src="brand/app-logo.svg" alt="" aria-hidden="true" draggable="false" />`,
  styles: [`
    :host {
      display: block;
      flex: none;
      width: var(--logo-size, 1em);
      height: var(--logo-size, 1em);
      border-radius: 50%;
      overflow: hidden;
      filter: drop-shadow(0 0 14px rgba(82, 193, 230, .45));
    }
    img { display: block; width: 100%; height: 100%; }
  `],
})
export class AppLogoComponent {
  readonly size = input('1em');
}
