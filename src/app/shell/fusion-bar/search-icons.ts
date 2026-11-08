import { PATH_ICONS } from '../../shared/item-path/path-icons';

// Line icons of the fusion search (concept 2026-11-02, B1 + B8).
// -----------------------------------------------------------------------------
// One stroke style for every kind: 24-unit viewBox, no fill, round joins; the
// component sets stroke width and colour. A ship row shows its uploader
// silhouette instead when one exists; every other row falls back to these.

/** The leading icon of a row: one per kind of thing found. */
export type SearchIconKind =
  | 'ship'
  | 'upcoming'
  | 'weapon'
  | 'component'
  | 'item'
  | 'ammunition'
  | 'blueprint'
  | 'manufacturer'
  | 'config'
  | 'set'
  | 'stock'
  | 'patch'
  | 'gallery'
  | 'mission'
  | 'page';

/** Path data per kind (several sub-paths per icon, drawn in one stroke style). */
export const SEARCH_KIND_ICONS: Readonly<Record<SearchIconKind, readonly string[]>> = {
  ship: ['M3 12l5-2.5h8L21 12l-5 2.5H8z', 'M9 9.5L7 5h4l2 4.5', 'M9 14.5L7 19h4l2-4.5'],
  upcoming: ['M3 12l5-2.5h8L21 12l-5 2.5H8z', 'M12 4v2M12 18v2'],
  weapon: ['M3 14h12l3-3h3v3l-3 2H3z', 'M7 14v3'],
  item: ['M4 8h14v4h-8l-2 6H5l1-6H4z'],
  component: ['M6 6h12v12H6z', 'M9 9h6v6H9z', 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3'],
  ammunition: ['M8 20V9l2-4 2 4v11z', 'M14 20V11l2-3 2 3v9z', 'M7 20h12'],
  blueprint: ['M4 4h16v16H4z', 'M4 9h16M9 4v16', 'M12 13h5M12 16h3'],
  manufacturer: ['M3 20V10l5 3V10l5 3V6h4v14z', 'M3 20h18'],
  config: ['M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z'],
  set: ['M6 3h12v18H6z', 'M12 3v18', 'M10 11v2M14 11v2'],
  stock: PATH_ICONS.inventar,
  patch: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  gallery: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 9.5a1.5 1.5 0 1 0 0-.01'],
  mission: ['M12 3a9 9 0 1 0 .01 0', 'M12 8a4 4 0 1 0 .01 0', 'M12 1v4M12 19v4M1 12h4M19 12h4'],
  page: ['M12 2.5L21 12l-9 9.5L3 12z', 'M12 8v8M8 12h8'],
};

/** The path icons (one family, shared/item-path/path-icons.ts) plus the search's own glyph. */
export const SEARCH_ACTION_ICONS = {
  wishlist: PATH_ICONS.wish,
  lager: PATH_ICONS.inventar,
  hangar: PATH_ICONS.hangar,
  /** The "Neu in Patch" marker after a name: a dot (the star is retired, only Explorer achievements keep one). */
  fresh: ['M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z'],
} as const;
