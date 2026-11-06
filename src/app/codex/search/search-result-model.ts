// RESULT MODEL — the contract the fusion bar (and any other surface) renders.
// -----------------------------------------------------------------------------
// Built by `composeSearchResult` (search-compose.ts), exposed by the engine as
// `engine.result()`. Concept 2026-11-02 "Suche: Kontext & Aktionen".
// Types only (plus one constant) — no framework, no runtime imports.

import type { PolyHitKind, PolySearchHit } from '../codex-poly-search';
import type { SearchTarget } from './codex-search-model';
import type { SearchFit } from './search-compat';

/** A result group id: a catalog kind, or one of the extra sources. */
export type SearchGroupId = PolyHitKind | 'own' | 'patch' | 'gallery' | 'mission';

export type OwnRowType = 'ship' | 'config' | 'set' | 'item';

/** The filter a chip applies. Every key present must hold (AND). */
export interface SearchChipFilter {
  /** Only these groups (kinds / own / patch / gallery) are "inside". */
  groups?: SearchGroupId[];
  /** Only these kinds of the own-data group. */
  ownKinds?: OwnRowType[];
  /** Only hits on the reader's wishlist ("gemerkt"). */
  wished?: boolean;
  /** Only hits that are open in Nachschub ("fehlt mir"). */
  needed?: boolean;
  size?: number;
  grade?: string;
  /**
   * HQ ownership section (Bestand / Hangar / Sets): the reader's own group stands FIRST and the
   * catalog groups still follow with their HQ CTAs. Orders, never filters (concept t-s2).
   */
  ownFirst?: boolean;
  /** "Passt auf X": the page names a ship / weapon / item the rows are checked against (B5). */
  compatWith?: { kind: 'ship' | 'weapon' | 'component' | 'item'; className: string };
}

export interface SearchChipOption {
  value: string;
  labelKey: string;
  labelParams?: Record<string, string | number> | null;
  /** Hits for this value; null = unknown yet. 0 = grey out, still clickable. */
  count: number | null;
}

export interface SearchChip {
  /** Stable id (`route:kind`, `section:weapons`, `parsed:size` …). */
  id: string;
  source: 'route' | 'section' | 'parsed';
  /** i18n key + params of the label. */
  labelKey: string;
  labelParams: Record<string, string | number> | null;
  filter: SearchChipFilter;
  /** The values of the ▾ menu (more than 7 → mini-search, see needsMiniSearch). */
  options?: SearchChipOption[];
  /** True when switching the value makes sense (S1 → S3). */
  switchable: boolean;
}

/** Why a group stands where it stands: i18n key + params, or null. */
export interface SearchReason {
  key: string;
  params: Record<string, string | number> | null;
}

/** Rows shown per group before "▾ N weitere hier zeigen" (A3: 3 on every page). */
export const SEARCH_ROWS_SHOWN = 3;

/** What the reader owns of a catalog entry — drives Mein Loadout / Wo gelagert?. */
export interface RowOwnership {
  /** Hangar ship id (status owned) when the entry is a ship of the reader's. */
  shipId: string | null;
  /** First hangar ship the entry is fitted on (loadout), if any. */
  equippedOnShipId: string | null;
  inSetIds: string[];
  /** The entry is in the Lager/Spind. */
  inLager: boolean;
  /** Units in the Lager/Spind (sum over the inventory rows); 0 when none. */
  lagerQty: number;
  /** Where it is fitted: per hangar ship (own name first), pieces per ship — "2 auf „Nachtfalke“". */
  fittedOn: { shipId: string; name: string; count: number }[];
}

/** The three standard icons (B8/B9). `lager` on a ship means "In den Hangar". */
export interface SearchRowIcons {
  wishlist: boolean;
  lager: boolean;
  nachschub: boolean;
}

export type SearchCtaId =
  | 'myLoadout'
  | 'compareWith'
  | 'compare'
  | 'inSet'
  | 'materialToSupply'
  | 'atRsi'
  | 'allProducts'
  | 'add'
  | 'whereStored'
  | 'planOps'
  | 'sourceOf'
  | 'openSet'
  | 'whereInstalled'
  | 'fittingShips'
  | 'fittingWeapons'
  | 'mount'
  | 'toEinsatz';

/** The one main action of a row. `link` navigates (render an anchor), `action` is handled by the host. */
export interface SearchCta {
  id: SearchCtaId;
  /** `search.cta.<id>` */
  labelKey: string;
  type: 'link' | 'action';
  target: SearchTarget | null;
  /** The action asks for sign-in first (ScConfirmService), e.g. "Hinzufügen" when signed out. */
  needsSignIn: boolean;
}

interface RowBase {
  id: string;
  target: SearchTarget;
  cta: SearchCta | null;
  icons: SearchRowIcons;
}

export type SearchResultRow =
  | (RowBase & {
      type: 'hit';
      hit: PolySearchHit;
      /** Fast-exact hit outside the chip filter (rendered in the `outside` group). */
      outside: boolean;
      owned: RowOwnership | null;
      /** "Passt auf X" badge when a chip names a ship; null when no chip asks. */
      fit: SearchFit | null;
      /** Ranking signals behind the row's place among equals. */
      signal: { recent: boolean; owned: boolean; popular: boolean };
    })
  | (RowBase & {
      type: 'own';
      ownKind: OwnRowType;
      /** Catalog name first (ship type) — B2. */
      title: string;
      /** The reader's own name ("Nachtfalke", loadout, set), or null. */
      ownName: string | null;
      /** Second line: ship of a loadout, location of an item … */
      subtitle: string | null;
      classNameSlug: string | null;
      /** Inventory quantity, when meaningful. */
      qty: number | null;
    })
  | (RowBase & { type: 'patch'; line: string; title: string; version: string; publishedAt: string })
  | (RowBase & {
      /** A contract title of the current LIVE build (same-title contracts folded, `variants`). */
      type: 'mission';
      className: string;
      title: string;
      typeName: string | null;
      giver: string | null;
      location: string | null;
      /** Highest base payout over the folded contracts (aUEC); null = none / dynamic. */
      reward: number | null;
      variants: number;
    })
  | (RowBase & {
      type: 'gallery';
      imageId: string;
      title: string;
      series: string | null;
      publishedAt: string | null;
      previewUrl: string | null;
    });

export interface SearchResultGroup {
  id: SearchGroupId | 'outside';
  /** Catalog kind of the group, null for own / patch / gallery. */
  kind: PolyHitKind | null;
  reason: SearchReason | null;
  /** Rows loaded (≤ perGroup); show the first {@link SEARCH_ROWS_SHOWN}. */
  rows: SearchResultRow[];
  /** Every match the source holds (index total / own total) — "Alle N". */
  total: number;
  /** What the group header counts: the cards the reader sees (same-name variants folded). Equals `total` when nothing folded. */
  count?: number;
  /** Loaded rows beyond the first three: "▾ N weitere hier zeigen". */
  expandable: number;
  /** "Alle N im Index/HQ öffnen →" (real anchor), null when nothing more exists. */
  moreTarget: SearchTarget | null;
  /** True for the dashed "fast genau, aber außerhalb von …" group. */
  outside: boolean;
}

export interface SearchResult {
  /** The text that was actually searched (the field minus the words that became chips). */
  term: string;
  chips: SearchChip[];
  groups: SearchResultGroup[];
  /** Fast-exact hits outside the chip filter — a dashed group with a reason; null when none. */
  outside: SearchResultGroup | null;
  didYouMean: string[];
  /** True when there is not a single row anywhere (incl. outside). */
  empty: boolean;
  /** Hits the chips filtered away (not fast-exact). */
  filteredOut: number;
}
