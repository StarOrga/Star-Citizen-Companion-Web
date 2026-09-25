/**
 * Labels for the on-foot catalog's raw tokens — shared by the FPS archive
 * (/codex/fps) and the index's card badges, which used to carry their own
 * copies of these tables (harden scan, 2026-09-25).
 */

/**
 * FPS weapon sub-types → the index's on-foot weapon groups (codex-weapon-taxonomy):
 * the facet reuses those labels ("Einhandwaffen"), a card its singular
 * (`fps.weaponType.*`). Only the tokens the catalog really carries.
 */
export const FPS_WEAPON_TYPE_ID: Readonly<Record<string, string>> = {
  Small: 'sidearm',
  Medium: 'primary',
  Large: 'heavy',
  Knife: 'melee',
  Grenade: 'throwable',
  Gadget: 'gadget',
};

/** Armour slot tokens (`fpsArmorSlot`) → the AN BORD figure's position labels. */
export const FPS_ARMOR_SLOT_ID: Readonly<Record<string, string>> = {
  Helmet: 'helmet',
  Torso: 'torso',
  Arms: 'arms',
  Legs: 'legs',
  Undersuit: 'undersuit',
  Backpack: 'backpack',
};

/**
 * Armour `sub_type` is the weight class for most pieces; for helmets and
 * undersuits it repeats the slot ("Helmet") or is the game's "UNDEFINED" —
 * those carry nothing the slot badge doesn't already say, so no badge.
 */
export const FPS_ARMOR_WEIGHT_ID: Readonly<Record<string, string>> = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
};

/** i18n key of an FPS weapon's type badge (`fps.weaponType.*`); null for an unknown token. */
export function fpsWeaponTypeKey(subType: string | null | undefined): string | null {
  const id = Object.hasOwn(FPS_WEAPON_TYPE_ID, subType ?? '') ? FPS_WEAPON_TYPE_ID[subType!] : null;
  return id ? `fps.weaponType.${id}` : null;
}

/** i18n key of an armour piece's weight badge (`fps.weight.*`); null for an unknown token. */
export function fpsArmorWeightKey(subType: string | null | undefined): string | null {
  const id = Object.hasOwn(FPS_ARMOR_WEIGHT_ID, subType ?? '') ? FPS_ARMOR_WEIGHT_ID[subType!] : null;
  return id ? `fps.weight.${id}` : null;
}
