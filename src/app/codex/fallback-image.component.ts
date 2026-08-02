import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * An `<img>` that walks a candidate list instead of dying on the first miss.
 *
 * Why this exists: every remote art source we consume publishes urls it cannot
 * guarantee. RSI's ship-matrix advertises the same ~48 derivative variants for
 * every ship whether or not the file was ever rendered, and our own datamined
 * preview renders only cover part of the catalog. The previous pattern —
 * one url, `(error)` flips the card to a placeholder glyph forever — turned a
 * single missing derivative into "this ship has no picture", which is what the
 * URSA looked like even though four other renders of it were one url away.
 *
 * Candidates are tried in order; a url that fails is remembered by VALUE, so
 * re-rendering the same list (OnPush change detection, a language switch, a
 * re-sort) does not restart the walk, while a genuinely new list does.
 * When every candidate fails the projected content renders instead — callers
 * pass their placeholder icon there.
 */
@Component({
  selector: 'sc-fallback-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="alt()" [attr.loading]="eager() ? null : 'lazy'"
           [attr.decoding]="eager() ? null : 'async'" (error)="onError(url)" />
    } @else {
      <ng-content />
    }
  `,
  // The <img> lives in THIS component's template, so a host's own `.thumb img`
  // rule can no longer reach it under emulated encapsulation. Sizing therefore
  // travels as custom properties, which DO inherit across the boundary: a host
  // sets --sc-img-max-h (and optionally --sc-img-shadow) on its thumb container.
  styles: [`
    :host { display: contents; }
    img {
      max-width: 100%;
      max-height: var(--sc-img-max-h, 100%);
      object-fit: contain;
      filter: var(--sc-img-shadow, drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5)));
    }
  `],
})
export class FallbackImageComponent {
  /** Ordered art candidates, best first. Empty = render the projected fallback. */
  readonly candidates = input<readonly string[]>([]);
  readonly alt = input('');
  /** Skip lazy-loading for above-the-fold art (hero renders). */
  readonly eager = input(false);

  private readonly failed = signal<ReadonlySet<string>>(new Set<string>());

  /** First candidate that has not failed yet, or null when the list is spent. */
  readonly src = computed(() => {
    const dead = this.failed();
    return this.candidates().find((c) => !!c && !dead.has(c)) ?? null;
  });

  onError(url: string): void {
    if (this.failed().has(url)) return;
    const next = new Set(this.failed());
    next.add(url);
    this.failed.set(next);
  }
}
