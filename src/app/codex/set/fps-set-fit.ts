import { CodexListRow, pickLocalizedDistinct } from '../codex.service';
import { cleanLocaleValue, humanizeClassName } from '../codex-format';
import { FoldedRow, foldVariantRows } from '../codex-variant-fold';
import { SkinGroupedRow, SkinVariantRef, groupSkinRows } from '../codex-skin-group';
import { ARMOR_SLOT_SPECS, roleSlotForAttachType } from '../codex-landing-kpi';
import { HangarRoleLoadout, ROLE_SLOT_SUGGESTIONS, slotAccepts } from '../../hangar/hangar.types';

/** An archive piece as far as "which slot of which set" cares. */
export interface FpsSetPiece {
  className: string;
  subType: string | null;
  attachType: string | null;
}

const ANATOMICAL: ReadonlySet<string> = new Set(ARMOR_SLOT_SPECS.map((s) => s.roleSlot));

/** True for the six anatomical (armour) positions of a set. */
export function isArmorRoleSlot(slot: string | null | undefined): boolean {
  return !!slot && ANATOMICAL.has(slot);
}

/**
 * The slots of `set` that `piece` honestly goes into — ONE rule for the equip
 * mode of /codex/fps and the "add to set" control of the plain archive.
 *
 * Armour has exactly one home, derived from its attach type (the AN BORD
 * paperdoll's mapping), and is deliberately not filtered by role: the set
 * page links all six anatomical positions for every set. Weapons and tools go
 * into the set role's own non-anatomical positions they fill (`slotAccepts`);
 * `only` narrows that to the one slot a set page link named.
 */
export function fittingSlots(set: HangarRoleLoadout, piece: FpsSetPiece, only?: string | null): string[] {
  const armor = roleSlotForAttachType(piece.attachType);
  if (armor) return [armor];
  return (ROLE_SLOT_SUGGESTIONS[set.role] ?? []).filter(
    (s) => !ANATOMICAL.has(s) && (!only || s === only) && slotAccepts(s, piece),
  );
}

/** The card title the FPS archive shows for a row (payload name → locale value → class name). */
export function fpsCardName(r: CodexListRow, lang: 'de' | 'en'): string {
  const p = r.payload as { name?: { de: string; en: string; key: string } } | undefined;
  const localized = p?.name ? pickLocalizedDistinct(p.name, lang) : '';
  return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
}

/**
 * The archive's two display passes — variant fold, then livery grouping — or
 * neither when the raw records are asked for. Shared by the list and by the
 * set page's "N im Arsenal" so both count the same cards (audit L22).
 */
export function foldFpsCards<T extends CodexListRow>(
  rows: readonly T[],
  raw: boolean,
  lang: 'de' | 'en',
): SkinGroupedRow<FoldedRow<T>>[] {
  return raw
    ? rows.map((r) => ({ ...r, foldedClassNames: [] as readonly string[], skinVariants: [] as readonly SkinVariantRef[] }))
    : groupSkinRows(foldVariantRows(rows, (r) => fpsCardName(r, lang)));
}

/**
 * Cards per armour attach type, exactly as /codex/fps?cat=armor counts them
 * under that slot filter: the same default-browse rows, folded per slot. A
 * head count of the rows read 677 where the list said 644 (audit L22).
 */
export function armorArsenalCounts(rows: readonly CodexListRow[], lang: 'de' | 'en'): Map<string, number> {
  const bySlot = new Map<string, CodexListRow[]>();
  for (const r of rows) {
    if (!r.attachType) continue;
    const list = bySlot.get(r.attachType) ?? [];
    list.push(r);
    bySlot.set(r.attachType, list);
  }
  return new Map([...bySlot].map(([attachType, list]) => [attachType, foldFpsCards(list, false, lang).length]));
}
