import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { StarscapeVotesService } from './starscape-votes.service';

/**
 * The Star-Citizen thumbs-up (admin feedback 058468f7).
 *
 * Spectrum marks an upvote with two stacked triangles rather than a hand, and
 * that is what this draws: two flat-based triangles, hollow while the image is
 * un-voted and filled once the vote is cast — the outline/solid pair is what
 * makes the state readable at tile size without a colour-only cue. The mark is
 * an inline SVG written here on purpose; no RSI asset is fetched or copied.
 *
 * A vote is a real ACTION, so this is a `<button>`, never an anchor — and it
 * lives OUTSIDE the tile's `<a>` (a button nested in an anchor is invalid HTML
 * and swallows the anchor's middle-click behaviour).
 */
@Component({
  selector: 'sc-vote-button',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host carries the state so the PARENT can style it — the gallery keeps a
  // cast vote visible on a tile that is not being hovered.
  host: { '[class.is-voted]': 'voted()' },
  template: `
    <button
      type="button"
      class="vote"
      [class.voted]="voted()"
      [class.busy]="busy()"
      [class.compact]="compact()"
      [disabled]="!votes.canVote() || busy()"
      [attr.aria-pressed]="voted()"
      [attr.aria-label]="label() | translate: { count: count() }"
      [attr.title]="label() | translate: { count: count() }"
      (click)="onClick($event)">
      <svg class="vote-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.4 L20.6 11 L3.4 11 Z" />
        <path d="M12 13 L20.6 21.6 L3.4 21.6 Z" />
      </svg>
      @if (count() > 0) {
        <span class="vote-count">{{ count() }}</span>
      }
    </button>
  `,
  styles: [`
    :host { display: inline-flex; }
    .vote {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-width: 44px; min-height: 32px; padding: 4px 10px;
      border-radius: 999px; cursor: pointer;
      font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); font-variant-numeric: tabular-nums;
      color: var(--sc-fg-1);
      background: rgba(0, 0, 0, 0.62);
      border: 1px solid var(--sc-border);
      backdrop-filter: blur(4px);
      transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease, transform 0.12s ease;
    }
    .vote:hover:not(:disabled) {
      color: var(--sc-accent); border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 18%, rgba(0, 0, 0, 0.62));
    }
    .vote:active:not(:disabled) { transform: scale(0.94); }
    .vote:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    /* Signed out: still shows the public tally, but says why it does nothing
       (the title/aria-label carries the "sign in to vote" line). */
    .vote:disabled { cursor: not-allowed; opacity: 0.65; }
    .vote.busy { opacity: 0.8; }
    .vote.voted { color: var(--sc-accent); border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 22%, rgba(0, 0, 0, 0.62)); }

    .vote-mark { width: 15px; height: 15px; flex: 0 0 auto; display: block; }
    .vote-mark path {
      fill: none; stroke: currentColor; stroke-width: 1.9;
      stroke-linejoin: round; vector-effect: non-scaling-stroke;
    }
    /* Cast → the triangles fill in. Shape AND fill change together, so the
       state does not rest on colour alone. */
    .vote.voted .vote-mark path { fill: currentColor; }

    /* Full-size control in the lightbox caption, where it sits in a button row
       next to Share/Download rather than floating over artwork. */
    .vote:not(.compact) { min-height: 34px; padding: 6px 14px; }

    /* Touch: 48px, matching the gallery's own coarse-pointer floor (the
       app-wide 0.994 press scale measures a 44px control as 43px). */
    @media (pointer: coarse) {
      .vote { min-height: 48px; min-width: 48px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .vote { transition: none; }
      .vote:active:not(:disabled) { transform: none; }
    }
  `],
})
export class StarscapeVoteButtonComponent {
  readonly votes = inject(StarscapeVotesService);

  readonly imageId = input.required<string>();
  /** Tile overlay (small) vs. lightbox caption (regular button height). */
  readonly compact = input(false);

  readonly count = computed(() => this.votes.counts().get(this.imageId()) ?? 0);
  readonly voted = computed(() => this.votes.mine().has(this.imageId()));
  readonly busy = computed(() => this.votes.busy().has(this.imageId()));

  readonly label = computed(() => {
    if (!this.votes.canVote()) return 'starscape.vote.signedOut';
    return this.voted() ? 'starscape.vote.remove' : 'starscape.vote.add';
  });

  onClick(ev: Event): void {
    // The tile behind this button is a link to the CDN original — a vote must
    // never bubble into it, and in the lightbox it must not close the overlay.
    ev.preventDefault();
    ev.stopPropagation();
    void this.votes.toggle(this.imageId());
  }
}
