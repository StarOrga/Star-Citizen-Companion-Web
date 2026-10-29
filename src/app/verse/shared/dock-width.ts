/**
 * Width of a Verse list subpage (News, Patches, Gallery): exactly the docked
 * subheader capsule (`--sc-dock-w`, styles.scss), not the wider page frame.
 *
 * The routed page root may not set max-width / margins (One page frame), so the
 * width comes from the frame's own track class: the host carries
 * `sc-track-page sc-track-dock`, and this rule narrows that one track to the
 * subheader width. `:host(.sc-track-dock.sc-track-page)` out-ranks the global
 * `.sc-frame > .sc-track-page` (three classes against two), whatever the
 * stylesheet order. Centring stays with the frame (`justify-self: center`).
 */
export const DOCK_WIDTH_STYLE = `
  :host(.sc-track-dock.sc-track-page) {
    width: var(--sc-dock-w, min(100% - 2 * var(--sc-page-gutter), var(--sc-page-max)));
  }
  /* Phones: the subheader is the thumb bar, not a capsule under the beta chip - the chip lane
     (a 72px margin per side) would squeeze the page to ~230px. Normal page gutter instead. */
  @media (max-width: 720px) {
    :host(.sc-track-dock.sc-track-page) {
      width: min(100% - 2 * var(--sc-page-gutter), var(--sc-content-max));
    }
  }
`;

/** Host classes for a page that sits in the page frame at subheader width. */
export const DOCK_HOST_CLASS = 'sc-track-page sc-track-dock';
