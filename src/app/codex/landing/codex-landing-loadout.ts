import type { ComponentKeyStats } from '../codex.service';
import { LandingValue } from './codex-landing-data.types';

/**
 * The loadout callout set of the holotable (#884, concept
 * 20261102-2215-holotisch-loadout-callouts): five part types in a fixed
 * order. The first three a ship carries become callouts; a missing part
 * (no quantum drive on a snub, no shield on a ground vehicle) lets the next
 * one move up, the rest goes to "Weitere Werte".
 */
export const LOADOUT_KEYS = ['loadout.weapons', 'loadout.shield', 'loadout.quantum', 'loadout.power', 'loadout.cooler'] as const;
export type LoadoutKey = (typeof LOADOUT_KEYS)[number];

/** Stock-loadout components by the class-name prefix of the installed item. */
const COMPONENT_PREFIX: Readonly<Record<Exclude<LoadoutKey, 'loadout.weapons'>, RegExp>> = {
  'loadout.shield': /^SHLD_/i,
  'loadout.quantum': /^QDRV_/i,
  'loadout.power': /^POWR_/i,
  'loadout.cooler': /^COOL_/i,
};

/** Weapon mounts by port name; controllers, racks, seats and tool turrets are not weapons. */
const WEAPON_PORT = /gun|weapon|turret/i;
const NOT_WEAPON = /controller|rack|locker|seat|access|console|tractor|salvage|mining/i;
/** Size in a mount or weapon class name: `Mount_Gimbal_S3`, `..._S03_...`. */
const CLASS_SIZE = /(?:^|_)S0?(\d{1,2})(?:_|$)/i;

/** Candidate ports kept per value — mirrors the flight set. */
const MAX_PORTS = 6;

export interface LoadoutPart {
  port: string;
  className: string;
}

/** The stock-loadout parts of a ship per loadout key, in payload order. Keys without a part are left out. */
export function loadoutParts(payload: unknown): Partial<Record<LoadoutKey, LoadoutPart[]>> {
  const entries = (payload as { defaultLoadout?: readonly { itemPortName?: string | null; entityClassName?: string | null }[] | null })
    ?.defaultLoadout;
  const out: Partial<Record<LoadoutKey, LoadoutPart[]>> = {};
  const add = (key: LoadoutKey, part: LoadoutPart) => (out[key] ??= []).push(part);
  for (const e of Array.isArray(entries) ? entries : []) {
    const port = e?.itemPortName;
    const className = e?.entityClassName;
    if (!port || !className) continue;
    const component = (Object.keys(COMPONENT_PREFIX) as (keyof typeof COMPONENT_PREFIX)[]).find((k) => COMPONENT_PREFIX[k].test(className));
    if (component) add(component, { port, className });
    else if (WEAPON_PORT.test(port) && !NOT_WEAPON.test(port) && !NOT_WEAPON.test(className)) add('loadout.weapons', { port, className });
  }
  return out;
}

/** Candidate anchor ports per loadout key (the mounts themselves, so the leader line ends on the part). */
export function loadoutAnchorPorts(payload: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, parts] of Object.entries(loadoutParts(payload))) {
    out[key] = [...new Set(parts.map((p) => p.port))].slice(0, MAX_PORTS);
  }
  return out;
}

/** Component class names whose stats the loadout set needs (weapons need none: count and size come from the name). */
export function loadoutComponentClasses(payload: unknown): string[] {
  const parts = loadoutParts(payload);
  return (['loadout.shield', 'loadout.quantum', 'loadout.power', 'loadout.cooler'] as const).flatMap((k) =>
    (parts[k] ?? []).map((p) => p.className),
  );
}

/** "3 × S3", "4 × S2–S3", or the bare count when no size is readable. */
export function weaponText(sizes: readonly (number | null)[]): string {
  const known = sizes.filter((s): s is number => s !== null);
  if (known.length !== sizes.length || known.length === 0) return String(sizes.length);
  const min = Math.min(...known);
  const max = Math.max(...known);
  return `${sizes.length} × ${min === max ? `S${min}` : `S${min}–S${max}`}`;
}

/**
 * The loadout values of a ship, in {@link LOADOUT_KEYS} order: weapons as
 * count × size (the value is the summed mount size, the comparison basis),
 * shield HP summed over all generators, the fastest quantum drive in km/s,
 * power segments and cooling summed. A part without stats (component missing
 * from the build) yields no value, never a zero.
 */
export function loadoutValues(payload: unknown, stats: ReadonlyMap<string, ComponentKeyStats>): LandingValue[] {
  const parts = loadoutParts(payload);
  const out: LandingValue[] = [];
  const weapons = parts['loadout.weapons'] ?? [];
  if (weapons.length) {
    const sizes = weapons.map((w) => {
      const m = CLASS_SIZE.exec(w.className);
      return m ? Number(m[1]) : null;
    });
    const sum = sizes.reduce<number>((a, s) => a + (s ?? 0), 0);
    out.push({ key: 'loadout.weapons', value: sum || weapons.length, unit: null, text: weaponText(sizes) });
  }
  const sumOf = (key: LoadoutKey, field: keyof ComponentKeyStats): number | null => {
    const nums = (parts[key] ?? []).map((p) => stats.get(p.className)?.[field]).filter((n): n is number => typeof n === 'number' && n > 0);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const shield = sumOf('loadout.shield', 'shield');
  if (shield) out.push({ key: 'loadout.shield', value: shield, unit: 'hp' });
  const drives = (parts['loadout.quantum'] ?? []).map((p) => stats.get(p.className)?.quantum).filter((n): n is number => typeof n === 'number' && n > 0);
  if (drives.length) out.push({ key: 'loadout.quantum', value: Math.round(Math.max(...drives) / 1000), unit: 'km/s' });
  const power = sumOf('loadout.power', 'power');
  if (power) out.push({ key: 'loadout.power', value: power, unit: null });
  const cooling = sumOf('loadout.cooler', 'cooling');
  if (cooling) out.push({ key: 'loadout.cooler', value: cooling, unit: null });
  return out;
}

/**
 * Class mean and maximum per loadout value over the cohort's own loadout
 * values (only members that carry the value count). More is better for every
 * loadout value.
 */
export function withLoadoutClassStats(values: readonly LandingValue[], cohort: readonly (readonly LandingValue[])[]): LandingValue[] {
  return values.map((v) => {
    const nums = cohort.map((c) => c.find((x) => x.key === v.key)?.value).filter((n): n is number => typeof n === 'number' && n > 0);
    if (nums.length < 2) return { ...v, classAvg: null, classMax: null, higherIsBetter: true };
    return { ...v, classAvg: nums.reduce((a, b) => a + b, 0) / nums.length, classMax: Math.max(...nums), higherIsBetter: true };
  });
}
