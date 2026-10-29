// Pure URL vocabulary of the Codex browse page (/codex/index) — kept out of the
// component so app.routes can translate legacy /codex/fps links without
// pulling the page into the main bundle.
import type { CodexKind } from './codex.service';
import { FPS_ARMOR_ATTACH_TYPES, fpsArmorSlot } from './codex.service';
import { WEAPON_SUPER_GROUPS } from './codex-weapon-taxonomy';
import { FPS_ARMOR_SLOT_ID } from './fps-labels';

/**
 * Personal armour is a CATEGORY of the item table (attach types
 * Char_Armor_*), promoted into the area tree like the old /codex/fps page had
 * it. `kind` stays `item` (detail links, compare tray); the category adds
 * the attach-type scope.
 */
export const ARMOR_CATEGORY = 'armor' as const;
export const UPCOMING_CATEGORY = 'upcoming' as const;
export type CodexCategory = CodexKind | typeof UPCOMING_CATEGORY | typeof ARMOR_CATEGORY;

/** What one entry of the "Bereich" tree selects. */
export interface AreaTarget {
  category: CodexCategory;
  wg?: string;
  wsg?: string;
  slot?: string;
}

/** One entry of the "Bereich" facet tree in the sidebar. */
export interface AreaNode {
  id: string;
  labelKey: string;
  count: number | null;
  target: AreaTarget;
  /** On the path to the current area (ancestors included). */
  active: boolean;
  /** Exactly the current area. */
  current: boolean;
  /** Children shown. */
  open: boolean;
  children: AreaNode[];
  href: string | null;
}

/** Armour slot ids in tree order, from the slot token map ('Helmet' → 'helmet'). */
export const ARMOR_SLOT_IDS: readonly string[] = Object.values(FPS_ARMOR_SLOT_ID);

/** The attach type of an armour slot id ('helmet' → 'Char_Armor_Helmet'), or null. */
export function armorAttachTypeOf(slotId: string): string | null {
  return FPS_ARMOR_ATTACH_TYPES.find((a) => FPS_ARMOR_SLOT_ID[fpsArmorSlot(a) ?? ''] === slotId) ?? null;
}

/**
 * The weapon super group a lone sub group id belongs to (legacy links sent
 * `wsg=utility` without `wg`). Null when no group or more than one has it.
 */
export function inferWeaponSuperGroup(subId: string): string | null {
  const owners = WEAPON_SUPER_GROUPS.filter((g) => g.subGroups.some((s) => s.id === subId));
  return owners.length === 1 ? owners[0].id : null;
}

/**
 * Old /codex/fps links → the one browse page (concept 2026-10-29, b3):
 * `cat=weapon` → `kind=weapon&wg=fps`, `cat=armor` → `kind=armor`, the armour
 * facet `slot=Helmet` → `slot=helmet`; `q`, `mfr`, `size`, `grade`, `v`
 * and `wsg` keep their meaning. Pure, so the redirect has a test.
 */
export function fpsToBrowseParams(query: Record<string, unknown>): Record<string, string> {
  const str = (k: string): string => (typeof query[k] === 'string' ? (query[k] as string).trim() : '');
  const out: Record<string, string> = {};
  const cat = str('cat');
  if (cat === 'armor') {
    out['kind'] = ARMOR_CATEGORY;
    const slot = str('slot');
    const id = FPS_ARMOR_SLOT_ID[slot] ?? (ARMOR_SLOT_IDS.includes(slot.toLowerCase()) ? slot.toLowerCase() : '');
    if (id) out['slot'] = id;
  } else {
    out['kind'] = 'weapon';
    out['wg'] = 'fps';
    const slot = str('slot');
    // The weapon facet of the old page was the raw sub_type ('Medium').
    const sub = WEAPON_SUPER_GROUPS[0].subGroups.find((s) => s.values.includes(slot))?.id;
    if (sub) out['wsg'] = sub;
  }
  for (const k of ['q', 'mfr', 'size', 'grade', 'wsg']) {
    const v = str(k);
    if (v && !out[k]) out[k] = v;
  }
  if (str('v') === '1') out['v'] = '1';
  return out;
}
