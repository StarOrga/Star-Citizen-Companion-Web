// Per-hardpoint stats of the item a ship actually has equipped.
// -----------------------------------------------------------------------------
// The codex hardpoint layout used to show only the port label plus the
// installed item's name/size — which reads as "Hardpoint Controller Weapon /
// Weapons / S1" and tells a pilot nothing. This module turns a resolved
// loadout entry into the handful of numbers that matter FOR ITS TYPE:
// a gun gets damage / projectile speed / range, a shield gets HP / regen,
// a quantum drive gets jump range / spool-up, a thruster gets thrust.
//
// HARD RULE — never invent a number. Everything here is read out of the
// extractor payload as-is (or derived by one documented formula, `range =
// projectileSpeed × lifetime`). A stat our extract does not carry is simply
// not emitted, so the UI omits the row instead of printing a zero.
//
// What the 4.9.0 extract actually carries (re-audited against the live catalog
// on 2026-07-26, build b77f1586 / patch 4.9.0):
//   * ammunition rows: projectile speed, lifetime, per-channel impact damage,
//     and `raw.projectileParams.penetrationParams.basePenetrationDistance`
//   * shields: MaxShieldHealth, MaxShieldRegen, regen delays, decay ratio
//   * quantum drives: jumpRange, driveSpeed, spoolUpTime, cooldownTime, …
//   * thrusters: thrustCapacity, fuel burn rate
//   * fuel tanks: capacity (SCU, in the ResourceContainer struct)
//   * every entity: manufacturer code, size, grade and a type discriminator
//     (weapon.subType / component.kind / item.attachType) — the "KLA · Gun"
//     identity line
// What it does NOT carry (verified zero / null on ALL 1 303 weapon rows —
// needs the P4K extractor, not the web app):
//   * weapon fireRate → therefore no DPS and no sustained-fire numbers
//   * weapon ammoContainerRecord → therefore no magazine / max-ammo count
//   * weapon heatPerShot on ship guns → no overheat numbers
//   * cooler cooling rate, power-plant power output, cargo-grid SCU

import { formatNumber, humanizeClassName } from './codex-format';
import { findStat, toFiniteNumber } from '../hangar/loadout-stats';

/** How the UI renders a raw stat value (source units documented per case). */
export type EquippedStatFormat =
  | 'int' // 194,400
  | 'dec' // 43.65 (≤2 decimals, trailing zeros trimmed)
  | 'perSec' // 14,256 /s — value already per-second
  | 'seconds' // 5.55 s
  | 'metres' // 1,924 m
  | 'metresDec' // 0.09 m — sub-metre distances (armour penetration)
  | 'mps' // 1,480 m/s
  | 'gm' // source metres → 340 Gm
  | 'kms' // source m/s → 196,000 km/s
  | 'scu' // 1.6 SCU
  | 'kn' // source newtons → 1,587 kN
  | 'percent'; // source 0–1 ratio → 25 %

/** One curated headline stat of an equipped item. */
export interface EquippedStat {
  /** i18n key under `codex.equipped.*`. */
  labelKey: string;
  /** Raw value in the source unit documented by `format`. */
  value: number;
  format: EquippedStatFormat;
  /** True when the value was computed rather than read verbatim (UI marks it). */
  derived?: boolean;
}

/**
 * CryEngine writes FLT_MAX (~3.4e38) for "unset/unlimited" — most visibly on
 * quantum-drive jumpRange. Anything at or above this is a sentinel, not data.
 * Mirrors the hangar's threshold so both surfaces agree.
 */
const FLT_MAX_SENTINEL = 1e30;

/** Keep only strictly positive, finite, non-sentinel values. */
function usable(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (v <= 0) return null; // 0 means "extractor left it unset" everywhere we checked
  return v >= FLT_MAX_SENTINEL ? null : v;
}

function push(
  out: EquippedStat[],
  labelKey: string,
  raw: number | null,
  format: EquippedStatFormat,
  derived = false,
): void {
  const v = usable(raw);
  if (v === null) return;
  out.push(derived ? { labelKey, value: v, format, derived } : { labelKey, value: v, format });
}

// ── ammunition join ──────────────────────────────────────────────────────────
// The extract does NOT resolve a weapon's ammoContainerRecord (null on all 430
// ship weapons that carry weaponParams), so the only link from a gun to its
// projectile is CIG's own class-name convention: `<weaponClass>_AMMO`. That is
// an EXACT name match, never a prefix or fuzzy search — a wrong projectile
// would silently print wrong damage. Spot-checked against erkul.games:
// KLWE_LaserRepeater_S3 → 43.65 dmg / 1480 m/s / 1924 m, all three exact.
// Coverage: ~71% of subType=Gun weapons; mounts (turrets, racks) have no ammo
// of their own and correctly resolve to nothing.

/** The ammunition class name a weapon's projectile stats would live under. */
export function ammoClassNameFor(weaponClassName: string | null | undefined): string | null {
  const cn = weaponClassName?.trim();
  return cn ? `${cn}_AMMO` : null;
}

/** Every ammo class name worth batch-fetching for a set of weapon classes. */
export function ammoClassNamesFor(weaponClassNames: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const cn of weaponClassNames) {
    const ammo = ammoClassNameFor(cn);
    if (ammo) out.add(ammo);
  }
  return [...out];
}

/** Per-channel damage set, as stored on ammo payloads and some weaponParams. */
type DamageSetLike = Record<string, number | null | undefined> | null | undefined;

const DAMAGE_CHANNELS = [
  'physical',
  'energy',
  'distortion',
  'thermal',
  'biochemical',
  'stun',
] as const;

/**
 * Read the per-channel impact damage from either the promoted `impactDamage`
 * set or the raw `projectileParams.damage.Damage<Channel>` fallback the
 * extractor leaves intact. Returns only channels that actually do damage.
 */
export function impactDamageChannels(payload: unknown): { channel: string; value: number }[] {
  const p = payload as
    | {
        impactDamage?: DamageSetLike;
        weaponParams?: { impactDamage?: DamageSetLike };
        raw?: { projectileParams?: { damage?: Record<string, unknown> } };
      }
    | undefined;
  const direct = p?.impactDamage ?? p?.weaponParams?.impactDamage ?? null;
  const nested = p?.raw?.projectileParams?.damage ?? null;
  const out: { channel: string; value: number }[] = [];
  for (const channel of DAMAGE_CHANNELS) {
    const cap = channel.charAt(0).toUpperCase() + channel.slice(1);
    const v = usable(
      toFiniteNumber(direct?.[channel] ?? nested?.['Damage' + cap] ?? null),
    );
    if (v !== null) out.push({ channel, value: v });
  }
  return out;
}

/** Total alpha damage across all channels — the "Alpha Damage" the admin asked for. */
export function alphaDamage(payload: unknown): number | null {
  const channels = impactDamageChannels(payload);
  if (channels.length === 0) return null;
  return channels.reduce((sum, c) => sum + c.value, 0);
}

/**
 * The damage channels a weapon actually deals, strongest first. Drives the
 * damage-type tag on the hardpoint row (`ENERGY`, `PHYSICAL`, `DISTORTION` …) —
 * the one identity fact that tells a pilot at a glance whether a gun eats
 * shields or hull. Reads the projectile first, falling back to weapons that
 * carry their own impactDamage. Almost always exactly one channel.
 */
export function damageChannelsOf(payload: unknown, ammoPayload: unknown): string[] {
  const rows = impactDamageChannels(ammoPayload);
  const used = rows.length > 0 ? rows : impactDamageChannels(payload);
  return [...used].sort((a, b) => b.value - a.value).map((r) => r.channel);
}

/**
 * How far a round bites into armour, in metres. Lives only in the untouched
 * `raw` projectile params — the extractor does not promote it, but it IS there
 * on every gun that has ammo (spot-check: KLWE_LaserRepeater_S3 → 0.085 m,
 * matching the "pen 0.09" third-party tools publish).
 */
export function penetrationDistance(ammoPayload: unknown): number | null {
  const p = ammoPayload as
    | { raw?: { projectileParams?: { penetrationParams?: Record<string, unknown> } } }
    | undefined;
  const raw = p?.raw?.projectileParams?.penetrationParams?.['basePenetrationDistance'];
  return usable(toFiniteNumber(raw ?? null));
}

/**
 * Effective projectile range in metres. Derived — a bullet simply stops
 * existing when its lifetime expires, so `speed × lifetime` is the distance it
 * can cover. This is the same figure third-party tools publish as "range".
 */
export function projectileRange(
  speed: number | null | undefined,
  lifetime: number | null | undefined,
): number | null {
  const s = usable(toFiniteNumber(speed));
  const l = usable(toFiniteNumber(lifetime));
  return s === null || l === null ? null : s * l;
}

/**
 * DPS = total alpha damage × shots per second. Only computable once the
 * extractor resolves a real fireRate (rounds/min); it is 0 on every weapon in
 * the 4.9.0 catalog, so this returns null today and starts working by itself
 * the moment the extract carries the value.
 */
export function damagePerSecond(
  alpha: number | null,
  fireRateRpm: number | null | undefined,
): number | null {
  const a = usable(alpha);
  const rpm = usable(toFiniteNumber(fireRateRpm));
  return a === null || rpm === null ? null : (a * rpm) / 60;
}

// ── per-type stat pickers ────────────────────────────────────────────────────

const SHIELD_STRUCT = 'shield';
const QUANTUM_STRUCT = 'quantum';
const THRUSTER_STRUCT = 'thruster';

type StatsMap = Record<string, Record<string, unknown>> | undefined;

function statsOf(payload: unknown): StatsMap {
  const s = (payload as { stats?: unknown } | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

/** Item durability — the one stat that is meaningful for every component. */
function pushHealth(out: EquippedStat[], stats: StatsMap): void {
  push(out, 'codex.equipped.health', findStat(stats, null, ['Health']), 'int');
}

function weaponStats(payload: unknown, ammoPayload: unknown): EquippedStat[] {
  const out: EquippedStat[] = [];
  // Damage lives on the projectile for guns, and directly on weaponParams for
  // the handful of turrets/mounts that carry their own impactDamage.
  const alpha = alphaDamage(ammoPayload) ?? alphaDamage(payload);
  push(out, 'codex.equipped.alphaDamage', alpha, 'dec');

  const fireRate = toFiniteNumber(
    (payload as { weaponParams?: Record<string, unknown> } | undefined)?.weaponParams?.[
      'fireRate'
    ] ?? null,
  );
  push(out, 'codex.equipped.fireRate', fireRate, 'int');
  push(out, 'codex.equipped.dps', damagePerSecond(alpha, fireRate), 'dec', true);

  const ammo = ammoPayload as { speed?: number | null; lifetime?: number | null } | undefined;
  push(out, 'codex.equipped.projectileSpeed', toFiniteNumber(ammo?.speed ?? null), 'mps');
  push(out, 'codex.equipped.range', projectileRange(ammo?.speed, ammo?.lifetime), 'metres', true);
  push(out, 'codex.equipped.penetration', penetrationDistance(ammoPayload), 'metresDec');
  return out;
}

function componentStats(kind: string, payload: unknown): EquippedStat[] {
  const out: EquippedStat[] = [];
  const stats = statsOf(payload);

  switch (kind) {
    case 'Shield':
      push(out, 'codex.equipped.shieldHp', findStat(stats, SHIELD_STRUCT, ['MaxShieldHealth']), 'int');
      push(
        out,
        'codex.equipped.shieldRegen',
        findStat(stats, SHIELD_STRUCT, ['MaxShieldRegen']),
        'perSec',
      );
      push(
        out,
        'codex.equipped.regenDelay',
        findStat(stats, SHIELD_STRUCT, ['DamagedRegenDelay']),
        'seconds',
      );
      push(
        out,
        'codex.equipped.downedDelay',
        findStat(stats, SHIELD_STRUCT, ['DownedRegenDelay']),
        'seconds',
      );
      break;
    case 'QuantumDrive':
      push(out, 'codex.equipped.jumpRange', findStat(stats, QUANTUM_STRUCT, ['jumpRange']), 'gm');
      push(
        out,
        'codex.equipped.driveSpeed',
        findStat(stats, QUANTUM_STRUCT, ['params.driveSpeed', 'driveSpeed']),
        'kms',
      );
      push(
        out,
        'codex.equipped.spoolTime',
        findStat(stats, QUANTUM_STRUCT, ['params.spoolUpTime', 'spoolUpTime']),
        'seconds',
      );
      push(
        out,
        'codex.equipped.cooldown',
        findStat(stats, QUANTUM_STRUCT, ['params.cooldownTime', 'cooldownTime']),
        'seconds',
      );
      break;
    case 'Thruster':
      // thrustCapacityNew supersedes thrustCapacity where both exist.
      push(
        out,
        'codex.equipped.thrust',
        findStat(stats, THRUSTER_STRUCT, ['thrustCapacityNew', 'thrustCapacity']),
        'kn',
      );
      break;
    case 'FuelTank':
    case 'QuantumFuelTank':
      push(
        out,
        'codex.equipped.fuelCapacity',
        findStat(stats, null, ['capacity.standardCargoUnits', 'capacity']),
        'scu',
      );
      break;
    case 'FuelIntake':
      push(out, 'codex.equipped.fuelRate', findStat(stats, 'fuelintake', ['fuelPushRate']), 'perSec');
      break;
    default:
      // Coolers and power plants land here: the extract carries no cooling rate
      // and no power output, so durability is honestly all we can show.
      break;
  }

  pushHealth(out, stats);
  push(
    out,
    'codex.equipped.distortion',
    findStat(stats, 'distortion', ['Maximum']),
    'int',
  );
  return out;
}

/** How many stats a single hardpoint row shows before it hurts readability. */
export const MAX_STATS_PER_SLOT = 6;

/** Input for {@link equippedStats} — one resolved hardpoint occupant. */
export interface EquippedItem {
  /** codex kind of the installed entity ('weapon' | 'component' | 'item' | …). */
  kind: string | null;
  /** the installed entity's payload, or null when unresolved. */
  payload: unknown;
  /** the matching `<class>_AMMO` payload for guns, when one exists. */
  ammoPayload?: unknown;
}

/**
 * The curated headline stats for what is installed on a hardpoint, picked by
 * the occupant's type: a gun never shows a shield row, a shield never shows a
 * DPS row. Returns [] when the extract has nothing worth printing.
 *
 * `limit` caps how many rows come back — a hardpoint card only has room for a
 * handful, while a comparison table wants every column the type can fill, so
 * that surface passes `Infinity`.
 */
export function equippedStats(item: EquippedItem, limit = MAX_STATS_PER_SLOT): EquippedStat[] {
  const { kind, payload, ammoPayload } = item;
  if (!payload || typeof payload !== 'object') return [];
  const entityKind = (payload as { entityKind?: string }).entityKind ?? kind ?? '';

  let rows: EquippedStat[];
  if (entityKind === 'weapon') {
    rows = weaponStats(payload, ammoPayload);
  } else if (entityKind === 'component') {
    rows = componentStats((payload as { kind?: string }).kind ?? '', payload);
  } else {
    // Plain items (controllers, seats, racks…) carry no performance stats.
    rows = [];
  }
  return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
}

// Type discriminators the extract fills in with a placeholder rather than
// leaving empty — showing them would put "Undefined" on the row.
const PLACEHOLDER_TYPE = new Set(['undefined', 'unknown', 'none', 'other']);

/**
 * What the installed thing IS, in one word: "Gun", "Gun Turret", "Quantum
 * Drive", "Mid Range Radar". Reads the type discriminator that the entity's own
 * kind uses (component → `kind`, weapon/item → `subType`, then `attachType`),
 * so an item without a subType still identifies itself by what it attaches to.
 *
 * Deliberately NOT translated: like every other catalog value on the page these
 * are engine identifiers rendered readably, not UI copy.
 */
export function equippedTypeLabel(item: EquippedItem): string | null {
  const p = item.payload as
    | { entityKind?: string; kind?: string; subType?: string; attachType?: string }
    | null
    | undefined;
  if (!p || typeof p !== 'object') return null;
  const entityKind = p.entityKind ?? item.kind ?? '';
  const candidates =
    entityKind === 'component' ? [p.kind, p.subType, p.attachType] : [p.subType, p.attachType];
  for (const c of candidates) {
    const s = (c ?? '').trim();
    if (s && !PLACEHOLDER_TYPE.has(s.toLowerCase())) return humanizeClassName(s);
  }
  return null;
}

/**
 * True when a slot holds a real gun but our extract has no numbers for it —
 * the cue for the UI to say "stats missing from this extract" instead of
 * rendering a silently bare row.
 */
export function weaponStatsUnavailable(item: EquippedItem): boolean {
  const p = item.payload as { entityKind?: string; subType?: string } | null | undefined;
  if (!p || p.entityKind !== 'weapon') return false;
  if (p.subType !== 'Gun') return false; // mounts/turrets legitimately have none
  return equippedStats(item).length === 0;
}

// ── port classification ──────────────────────────────────────────────────────

// A gun/turret MOUNT — something a pilot bolts a weapon onto.
const WEAPON_MOUNT_PORT = /weapon|turret|gimbal/i;
// …excluding the fire-group controller module and the interior rack that stores
// the crew's personal FPS weapons. Both merely have "weapon" in the name.
const NOT_A_MOUNT_PORT = /controller|weapon_?rack/i;

/**
 * Whether a port name denotes an actual ship-weapon mount. Used to tell
 * "this ship's guns are missing from the extract" apart from "this ship has
 * no gun mounts at all" — a distinction the pilot deserves.
 */
export function isWeaponMountPort(portName: string | null | undefined): boolean {
  if (!portName) return false;
  return WEAPON_MOUNT_PORT.test(portName) && !NOT_A_MOUNT_PORT.test(portName);
}

// ── rendering ────────────────────────────────────────────────────────────────

/**
 * Render one stat's value with its unit. Unit suffixes are physical symbols
 * (m, m/s, HP, s, SCU, kN, Gm, km/s, %) — identical in DE and EN, so they stay
 * out of the translation files while every LABEL is translated via `labelKey`.
 */
export function formatEquippedStat(stat: EquippedStat): string {
  const v = stat.value;
  switch (stat.format) {
    case 'int':
      return formatNumber(Math.round(v));
    case 'dec':
      return formatNumber(v);
    case 'perSec':
      return `${formatNumber(Math.round(v))}/s`;
    case 'seconds':
      return `${formatNumber(v)} s`;
    case 'metres':
      return `${formatNumber(Math.round(v))} m`;
    case 'metresDec':
      // Sub-metre distances would round to a flat "0 m" — keep the decimals.
      return `${formatNumber(v)} m`;
    case 'mps':
      return `${formatNumber(Math.round(v))} m/s`;
    case 'gm':
      // metres → giga-metres, matching the hangar's jump-range presentation.
      return `${formatNumber(Math.round(v / 1_000_000))} Gm`;
    case 'kms':
      return `${formatNumber(Math.round(v / 1_000))} km/s`;
    case 'scu':
      return `${formatNumber(v)} SCU`;
    case 'kn':
      return `${formatNumber(Math.round(v / 1_000))} kN`;
    case 'percent':
      return `${formatNumber(Math.round(v * 100))} %`;
  }
}

// ── identical-slot grouping ──────────────────────────────────────────────────

/** Minimal slot shape the grouping needs (a superset is fine). */
export interface GroupableSlot {
  className: string | null;
  size: number | null;
  grade: string | null;
  /**
   * Extra identity beyond the installed class — set it when two hardpoints can
   * hold the SAME item and still differ (e.g. two identical gimbal mounts with
   * different guns inside). Slots that differ here never collapse into one row.
   */
  variantKey?: string | null;
}

/** A run of hardpoints holding the exact same thing, collapsed to one row. */
export interface GroupedSlot<T extends GroupableSlot> {
  /** The first slot of the run — carries the port label and the swap action. */
  slot: T;
  /** How many identical hardpoints this row stands for (≥1). */
  count: number;
  /** Every port label in the run, for the tooltip. */
  ports: T[];
}

/**
 * Collapse identical occupants into one row so a ship with twelve identical
 * manoeuvring thrusters reads "12×" instead of twelve near-duplicate lines.
 * Grouping is by installed class + size + grade, so "3× S3" only ever appears
 * when the ship really does carry three of the same size-3 item. Empty ports
 * group with each other (same null class) but never with a filled one.
 * Order of first appearance is preserved.
 */
export function groupIdenticalSlots<T extends GroupableSlot>(slots: T[]): GroupedSlot<T>[] {
  const out: GroupedSlot<T>[] = [];
  const index = new Map<string, GroupedSlot<T>>();
  for (const slot of slots) {
    const key = `${slot.className ?? ' empty'}|${slot.size ?? ''}|${slot.grade ?? ''}|${slot.variantKey ?? ''}`;
    const hit = index.get(key);
    if (hit) {
      hit.count += 1;
      hit.ports.push(slot);
    } else {
      const group: GroupedSlot<T> = { slot, count: 1, ports: [slot] };
      index.set(key, group);
      out.push(group);
    }
  }
  return out;
}

/**
 * The size badge for a grouped row: "3× S3" when several identical sized items
 * share a category, "S3" for a single one, and nothing at all when the extract
 * has no size for the occupant (never guess a size).
 */
export function sizeBadge(count: number, size: number | null): string | null {
  if (size == null) return count > 1 ? `${count}×` : null;
  return count > 1 ? `${count}× S${size}` : `S${size}`;
}

/** Above this many distinct positions the suffix list stops being readable. */
const MAX_LISTED_PORT_VARIANTS = 3;

/**
 * A label that is true for EVERY port in a collapsed row. Reusing the first
 * port's name would lie: the Nomad's three empty gun mounts are top-left,
 * top-right and bottom, so "3× Hardpoint Weapon Top Left" claims three
 * top-left mounts.
 *
 * So: take the words all ports share, then append the differing tails when
 * there are few enough to read — "Hardpoint Weapon (Top Left / Top Right /
 * Bottom)" is both accurate and more useful than either alternative. Beyond
 * three variants (twelve manoeuvring thrusters…) only the shared part is kept
 * and the full list stays in the row's hover text.
 */
export function commonPortLabel(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];

  const wordLists = labels.map((l) => l.trim().split(/\s+/).filter(Boolean));
  const [first, ...rest] = wordLists;
  let shared = 0;
  while (
    shared < first.length &&
    !rest.some((words) => words[shared]?.toLowerCase() !== first[shared].toLowerCase())
  ) {
    shared++;
  }
  if (shared === 0) return labels[0];

  const prefix = first.slice(0, shared).join(' ');
  const suffixes = [...new Set(wordLists.map((w) => w.slice(shared).join(' ')).filter(Boolean))];
  if (suffixes.length === 0 || suffixes.length > MAX_LISTED_PORT_VARIANTS) return prefix;
  return `${prefix} (${suffixes.join(' / ')})`;
}
