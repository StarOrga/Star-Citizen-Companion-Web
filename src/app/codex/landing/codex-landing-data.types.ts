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
  unit: 'm/s' | 'km/s' | 'hp' | 'scu' | 'kg' | null;
  /** Display text in place of the formatted number (e.g. `3 × S3` for the weapon mounts). */
  text?: string;
  /** Mean of this value over the item's class (cohort); absent/null without a cohort of at least two. */
  classAvg?: number | null;
  /** Highest value in the class — the full length of the comparison bar. */
  classMax?: number | null;
  /** true = more is better, false = less is better, null = neutral (no judgement, e.g. mass, crew). */
  higherIsBetter?: boolean | null;
}

/** One size fact of the Kennung ("Länge 22,5 m", "Größe S2"). `value` is display text. */
export interface LandingFact {
  id: 'length' | 'width' | 'height' | 'size';
  value: string;
}

/** One entry of a category in the Codex list of the landing. */
export interface LandingCodexEntry {
  id: string;
  name: string;
  /** Real-anchor target: the detail page, `/codex/upcoming/:id` for announced ships. */
  route: string[];
  /** Announced (not yet flight-ready) — rendered with the "angekündigt" tag. */
  announced: boolean;
  /** In the previous build too, its values changed in this patch — rendered with the "aktualisiert" tag. */
  updated?: boolean;
  /** New in this patch (a real new entry, not a discovery pick) - rendered with the "neu" tag. */
  isNew?: boolean;
  /** An earlier patch's entry (see {@link LandingCodexCategory.earlier}): the patch it was new or updated in. */
  patch?: string;
}

/** One category row of the Codex list: its new and updated items of the current patch. */
export interface LandingCodexCategory {
  category: LandingCategory;
  /** New and updated flight-ready items of the current patch (announced ones not counted). */
  count: number;
  /** All of them, new before updated; announced ships last. The pane shows a window of them. */
  entries: LandingCodexEntry[];
  /** Announced ships of this category (ships only, else 0). */
  announced: number;
  /** Nothing new or updated: `entries` are picks of the category to discover (`count` is 0). */
  discover?: boolean;
  /**
   * New and updated items of the patches before the current one, newest patch first, each
   * with its `patch` (admin feedback #318). The pane fills the space the current patch leaves
   * with them; not counted in `count`.
   */
  earlier?: LandingCodexEntry[];
}

export interface LandingCodex {
  /** Patch version of the current LIVE build, null when unknown. */
  patch: string | null;
  categories: LandingCodexCategory[];
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
  /** Size facts for the Kennung; a fact without data is left out. */
  facts?: LandingFact[];
  /** Announced ship (d-announced `preview`): name and icon only, no values; the route is the upcoming page. */
  announced?: boolean;
  /** True when the item is new in the current patch (else it is only the newest known one). */
  fresh?: boolean;
  /**
   * Ships: candidate raw port names per callout value key (cx-anchors) — the
   * holotable ends the leader line at the first one the 3D model can locate.
   */
  anchorPorts?: Record<string, string[]>;
  /**
   * Ships: the loadout callout set (#884) — weapons, shield, quantum drive,
   * power and cooling of the stock loadout, with class stats. Absent or empty:
   * the holotable offers no set switch for this ship.
   */
  loadoutValues?: LandingValue[];
  /** Ships: codex-data position (glb space, metres) of those ports, for hulls whose glb has no locators. */
  anchorPositions?: Record<string, [number, number, number]>;
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

