import { CodexKind } from '../codex.service';

/** The five rotation categories of the Codex landing, in rotation order. */
export const LANDING_CATEGORIES = ['ship', 'fpsWeapon', 'armor', 'component', 'tool'] as const;
export type LandingCategory = (typeof LANDING_CATEGORIES)[number];

/** One labelled overview field (brief A5). `value` is already display text (language applied) or null when unknown. */
export interface LandingOverviewField {
  /** Stable id, wave 2 maps it to an i18n label: role|size|manufacturer|type|part|class. */
  id: 'role' | 'size' | 'manufacturer' | 'type' | 'part' | 'class';
  value: string | null;
}

/** One of the up-to-7 top values. Numbers stay numbers; wave 2 formats and labels them. */
export interface LandingValue {
  /** Stable key (payload path, e.g. `flight.scmSpeed`) for the i18n label `codex.landing.value.<key>`. */
  key: string;
  value: number;
  /** Unit hint for formatting, null when unitless/unknown. */
  unit: 'm/s' | 'hp' | 'scu' | 'kg' | null;
}

/** A paint that has an RSI image (paints without one never reach this type). */
export interface LandingPaint {
  id: string;
  name: string;
  imageUrl: string;
  /** RSI store page of the paint (the discreet "RSI-Render · <Lackierung> ↗" link), or null. */
  rsiUrl: string | null;
  /** Recency source: RSI release date when known, else when the crawler first saw it (ISO). */
  recencyAt: string;
  /** Rendered as the plain "neu" tag. Order never depends on selection. */
  isNew: boolean;
}

/** The newest flight-ready item of a category plus everything the stage + Datenkarte show. */
export interface LandingItem {
  category: LandingCategory;
  kind: CodexKind;
  className: string;
  name: string;
  /** Eyebrow line under the plate: manufacturer + category-specific descriptor (display text, may be null). */
  eyebrow: { manufacturer: string | null; descriptor: string | null };
  /** Router commands for `[routerLink]`: ['/codex', kind, className]. */
  detailRoute: string[];
  /** RSI render (ships only for now; others null). Without it the card shows the title-block fallback. */
  imageUrl: string | null;
  /** Datamined preview render from the codex-previews bucket (not an RSI image) — optional extra fallback. */
  previewUrl: string | null;
  overview: LandingOverviewField[];
  /** Up to 7, most telling first. */
  topValues: LandingValue[];
}

/** One filmstrip tile. */
export interface FilmstripTile {
  id: string;
  name: string;
  manufacturer: string | null;
  imageUrl: string | null;
  /** Real-anchor target: codex detail for flight-ready game ships, `/codex/upcoming/:id` for announced. */
  route: string[];
  isNew: boolean;
}

export interface Filmstrip {
  tiles: FilmstripTile[];
  /** Entries beyond `tiles`, for the "+ N weitere" tile (0 = no such tile). */
  more: number;
  /** Total entries behind the list. */
  total: number;
}

export interface PatchSummaryView {
  patchVersion: string;
  /** 1–3 trend lines in the app language. */
  lines: string[];
  generatedAt: string | null;
  /** RSI patch-notes thread of this patch; falls back to the overview page. Always set. */
  patchNotesUrl: string;
  /** True when {@link patchNotesUrl} is the thread of exactly this patch (else the overview). */
  patchNotesIsThread: boolean;
}

export const RSI_PATCH_NOTES_OVERVIEW_URL = 'https://robertsspaceindustries.com/patch-notes';

/** Facts to build the "+ N weitere" search link; wave 2 owns the query-param names. */
export interface FilmstripMoreQuery {
  kind: 'ship';
  flightReady: true;
  sort: 'new';
}
