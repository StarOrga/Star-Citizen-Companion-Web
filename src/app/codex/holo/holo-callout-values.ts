import type { CalloutValue } from '../asset-package/asset-package-viewer.component';
import { type EquippedStat, formatEquippedStat } from '../codex-equipped-stats';
import type { ShipModuleSection } from '../ship-module-sections';

/** Stat label keys (`codex.equipped.*` suffix) a type of component leads with, most meaningful first. */
const LEAD: Readonly<Record<string, readonly string[]>> = {
  weapons: ['dps', 'alphaDamage', 'fireRate', 'range', 'projectileSpeed'],
  remoteTurrets: ['dps', 'alphaDamage', 'fireRate', 'range', 'projectileSpeed'],
  missiles: ['missileCount', 'missileSize', 'range', 'alphaDamage'],
  pod: ['tractorForce', 'tractorRange', 'tractorSpeed', 'range'],
  shields: ['shieldHp', 'shieldRegen', 'regenDelay', 'downedDelay'],
  powerPlants: ['powerOutput', 'health', 'emSignature'],
  quantum: ['driveSpeed', 'jumpRange', 'spoolTime', 'fuelRate'],
  radar: ['radarSensitivity', 'pingCooldown', 'aimAssistRange'],
  coolers: ['coolingRate', 'powerDraw', 'coolantDraw', 'irSignature'],
  lifeSupport: ['powerDraw', 'health'],
  countermeasures: ['cmCapacity', 'cmLifetime', 'cmRadius'],
  default: ['health', 'powerDraw', 'powerOutput'],
};

export const statSuffix = (key: string): string => key.slice(key.lastIndexOf('.') + 1);
const suffix = statSuffix;

/** i18n key of a callout value's short label (`codex.holo.statShort.*`): "Alpha", "Energie", "EM" — the full label would be cut. */
export function shortStatKey(labelKey: string): string {
  return `codex.holo.statShort.${statSuffix(labelKey)}`;
}

/** A component block holds exactly one item type: the type the callout names. */
const SECTION_TYPE: Readonly<Partial<Record<ShipModuleSection, string>>> = {
  shields: 'shield',
  powerPlants: 'powerPlant',
  coolers: 'cooler',
  quantum: 'quantumDrive',
  radar: 'radar',
  lifeSupport: 'lifeSupport',
  missiles: 'missileRack',
  countermeasures: 'countermeasure',
};

/** The weapon's class from its class name (`BEHR_BallisticGatling_S3` → gatling), damage type first where it names one. */
function weaponTypeOf(className: string): string | null {
  const c = className.toLowerCase();
  if (c.includes('gatling')) return 'gatling';
  if (c.includes('scatter')) return 'scattergun';
  if (c.includes('massdriver')) return 'massDriver';
  if (c.includes('railgun')) return 'railgun';
  if (c.includes('tractor')) return 'tractorBeam';
  const dmg = c.includes('laser') ? 'laser' : c.includes('ballistic') ? 'ballistic' : c.includes('distortion') ? 'distortion' : null;
  if (c.includes('repeater')) return dmg ? `${dmg}Repeater` : 'repeater';
  if (c.includes('cannon')) return dmg ? `${dmg}Cannon` : 'cannon';
  return null;
}

/**
 * The TYPE a callout and a hull tag name (C9/C10): the weapon class of the gun a
 * weapon slot holds ("Gatling", "Laserkanone"), the item type of a component
 * ("Kühler", "Schild"). Null = unknown — the caller falls back to the category.
 */
export function partTypeKey(section: ShipModuleSection | null, className: string | null): string | null {
  if (section === 'weapons' || section === 'remoteTurrets') {
    const t = className ? weaponTypeOf(className) : null;
    return t ? `codex.holo.partType.${t}` : null;
  }
  const t = section ? SECTION_TYPE[section] : undefined;
  return t ? `codex.holo.partType.${t}` : null;
}

/**
 * The three values of a callout: the stats a type of component is known for
 * first (weapon: DPS, Alpha, Feuerrate; shield: HP, Regen, Verzögerung;
 * cooler: Kühlleistung, Leistung …), then whatever else the extract has, then
 * the size and grade so a part with few stats still fills its row.
 */
export function calloutValuesOf(
  section: ShipModuleSection | null,
  stats: readonly EquippedStat[],
  size: number | null,
  grade: string | null,
  label: (key: string) => string,
  sizeLabel: string,
  gradeLabel: string,
): CalloutValue[] {
  const lead = LEAD[section ?? 'default'] ?? LEAD['default'];
  const rank = (s: EquippedStat): number => {
    const i = lead.indexOf(suffix(s.labelKey));
    return i < 0 ? lead.length : i;
  };
  const ordered = [...stats].sort((a, b) => rank(a) - rank(b));
  const out: CalloutValue[] = ordered.slice(0, 3).map((s) => ({ label: label(s.labelKey), value: formatEquippedStat(s) }));
  if (out.length < 3 && size != null) out.push({ label: sizeLabel, value: `S${size}` });
  if (out.length < 3 && grade) out.push({ label: gradeLabel, value: grade });
  return out;
}
