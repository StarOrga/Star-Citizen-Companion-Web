// The icon family of the item path (concept gegenstand-weg E7).
// -----------------------------------------------------------------------------
// One stroke style: 24-unit viewBox, no fill, round caps and joins. The stroke
// itself comes from `svg.sc-action-icon` (styles.scss, block ACTION). A filled
// stop adds `is-filled`. The search's action icons re-export these.

export const PATH_ICONS = {
  /** Wunschliste: a bookmark. */
  wish: ['M7 4h10v16l-5-4-5 4z'],
  /** Nachschub: a tray with an inbound arrow. */
  nachschub: ['M12 3v8', 'M8.5 7.5L12 11l3.5-3.5', 'M4 13h5l1.5 2.5h3L15 13h5v7H4z'],
  /** Inventar: a box. */
  inventar: ['M4 8l8-4 8 4v9l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v9'],
  /** Hangar: a hangar with its door. */
  hangar: ['M3 20V10l9-6 9 6v10', 'M7 20v-7h10v7', 'M7 16h10'],
} as const;
