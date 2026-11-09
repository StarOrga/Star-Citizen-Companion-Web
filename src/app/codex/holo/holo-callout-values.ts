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

const suffix = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

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
