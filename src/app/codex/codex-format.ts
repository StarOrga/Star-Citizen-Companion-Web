// Codex presentation helpers — pure, framework-free formatting + grouping logic.
// -----------------------------------------------------------------------------
// The codex payloads are raw datamine output: descriptions carry literal "\n"
// escape sequences, component `stats` are huge struct dumps (mostly engine
// noise + unresolved @LOC_* keys + file paths), numbers include FLT_MAX
// sentinels, and hardpoint port `types` are PascalCase engine identifiers.
//
// Everything here is GENERIC per entity *type* — no per-ship / per-item special
// cases. The detail view composes these into a readable presentation.

// ── text ─────────────────────────────────────────────────────────────────────

/**
 * Restore real newlines/tabs from literal escape sequences that survived the
 * extractor's JSON double-encoding. Stored descriptions look like
 * `"Manufacturer: MISC\\nFocus: …"` — i.e. a backslash followed by `n`, which
 * `white-space: pre-wrap` renders verbatim. This turns them into real breaks.
 */
/**
 * A display string that is safe to show: drops unresolved global.ini keys
 * (`@item_Name_…`, `@vehicle_class_…`) and engine placeholders, returning the
 * fallback instead. Used for name/role values that may carry a raw key when the
 * extractor could not resolve a translation.
 */
export function cleanLocaleValue(
  v: string | null | undefined,
  fallback = '',
): string {
  const s = (v ?? '').trim();
  if (!s || s.startsWith('@') || s === '@LOC_EMPTY' || s === '@LOC_PLACEHOLDER') {
    return fallback;
  }
  return s;
}

export function unescapeText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/[ \t]+\n/g, '\n') // trim trailing spaces before a break
    .trim();
}

// Acronyms that should stay upper-cased when humanizing identifiers.
const ACRONYMS = new Set([
  'SCM', 'HP', 'EM', 'IR', 'QD', 'QT', 'UI', 'AI', 'ID', 'FPS', 'PU', 'NT',
  'ATC', 'GUID', 'SCU', 'RGB',
]);

// Struct-name wrappers stripped before humanizing a component-stats group title.
const STRUCT_NOISE = /^(SCItem|EntityComponent|Item|InteriorMap|SSC|SC|S)/;

/**
 * Turn an engine identifier (`MaxShieldHealth`, `scmSpeed`, `jump_range`,
 * `SCItemShieldGeneratorParams`) into a human label
 * (`Max Shield Health`, `SCM Speed`, `Jump Range`, `Shield Generator`).
 */
export function humanizeKey(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/Params$/, '').replace(/Component$/, '');
  if (STRUCT_NOISE.test(s) && s.length > 3) s = s.replace(STRUCT_NOISE, '');
  s = s
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .trim();
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

// ── numbers / value filtering ─────────────────────────────────────────────────

// Floats at/above this are FLT_MAX-style sentinels ("unset" / "infinite").
const SENTINEL = 1e12;

/** Format a numeric stat: group thousands, ≤2 decimals, FLT_MAX → ∞. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) >= SENTINEL) return '∞';
  const r = Math.round(v * 100) / 100;
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const PATH_LIKE = /[\\/]|\.(xml|mtl|svg|dds|cga|json)$/i;
const GUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a raw payload value is worth showing to a human. Filters out nulls,
 * empties, unresolved localisation keys (`@LOC_EMPTY`, `@…`), file paths,
 * GUIDs, and engine-internal `_Type_`-style markers.
 */
export function isMeaningfulValue(v: unknown): v is string | number {
  if (v == null) return false;
  if (typeof v === 'boolean') return false; // config flags — not user-facing stats
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) < SENTINEL;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    if (s.startsWith('@')) return false;
    if (s === 'None' || s === 'Unknown') return false;
    if (PATH_LIKE.test(s)) return false;
    if (GUID_LIKE.test(s)) return false;
    return true;
  }
  return false;
}

/** Render a meaningful scalar (number → formatted, string → as-is). */
export function formatValue(v: string | number): string {
  return typeof v === 'number' ? formatNumber(v) : String(v);
}

// ── component stats curation ──────────────────────────────────────────────────

export interface StatRow {
  key: string;
  value: string;
  unit?: string;
}

// Conservative unit lookup, keyed by the lower-cased raw field name (after a
// trailing `Params` strip). Only fields whose unit is unambiguous are mapped —
// a wrong unit is worse than none, so anything uncertain stays unitless.
const UNIT_MAP: Record<string, string> = {
  health: 'HP',
  maxshieldhealth: 'HP',
  maxshieldregen: 'HP/s',
  scmspeed: 'm/s',
  maxspeed: 'm/s',
  boostspeed: 'm/s',
  muzzlevelocity: 'm/s',
  projectilespeed: 'm/s',
  speed: 'm/s',
  firerate: 'rpm',
  roundsperminute: 'rpm',
  rpm: 'rpm',
  lifetime: 's',
};

/** Unit string for a known engine field leaf name, or undefined. */
export function unitForField(raw: string): string | undefined {
  return UNIT_MAP[raw.toLowerCase().replace(/params$/, '')];
}

// Struct names inside component `stats` that carry genuinely useful, kind-
// specific performance numbers. Everything else (purchasable params, signature
// system, fire igniter, scan data, interior visibility, …) is engine noise.
const USEFUL_STAT_STRUCT = /^SCItem.*Params$/;
const HEALTH_STRUCT = 'SHealthComponentParams';
const DISTORTION_STRUCT = 'SDistortionParams';

// Field names to drop even inside an otherwise-useful struct.
const FIELD_BLACKLIST = new Set([
  'tracePoint',
  'ReservePoolInitialHealthRatio',
  'ReservePoolMaxHealthRatio',
  'ReservePoolRegenRateRatio',
  'ElectricalChargeDamageResistance',
]);

/**
 * Curate a component's heterogeneous `stats` map down to the rows that matter,
 * generically: the kind-specific `SCItem<Kind>Params` struct, plus Health and
 * Distortion capacity. Returns humanized, formatted rows — no per-kind hardcode.
 */
export function curateComponentStats(
  stats: Record<string, Record<string, unknown>> | undefined,
): StatRow[] {
  if (!stats) return [];
  const rows: StatRow[] = [];
  const pushStruct = (struct: Record<string, unknown> | undefined) => {
    if (!struct) return;
    for (const [k, v] of Object.entries(struct)) {
      if (FIELD_BLACKLIST.has(k)) continue;
      if (!isMeaningfulValue(v)) continue;
      rows.push({ key: humanizeKey(k), value: formatValue(v), unit: unitForField(k) });
    }
  };

  for (const [name, struct] of Object.entries(stats)) {
    if (USEFUL_STAT_STRUCT.test(name)) pushStruct(struct as Record<string, unknown>);
  }
  // Always surface durability + distortion capacity when present.
  const health = stats[HEALTH_STRUCT]?.['Health'];
  if (isMeaningfulValue(health)) rows.push({ key: 'Health', value: formatValue(health), unit: 'HP' });
  const distMax = stats[DISTORTION_STRUCT]?.['Maximum'];
  if (isMeaningfulValue(distMax))
    rows.push({ key: 'Distortion capacity', value: formatValue(distMax) });

  // De-dup by label (some structs repeat e.g. Health), keep first.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** Generic filtered rows for any flat scalar record (weaponParams, ammo raw). */
export function meaningfulRows(
  obj: Record<string, unknown> | undefined,
): StatRow[] {
  if (!obj) return [];
  const rows: StatRow[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!isMeaningfulValue(v)) continue;
    rows.push({ key: humanizeKey(k), value: formatValue(v), unit: unitForField(k) });
  }
  return rows;
}

// ── ammunition damage (with raw fallback) ─────────────────────────────────────

export interface DamageRow {
  channel: string; // i18n suffix: physical/energy/distortion/thermal/biochemical/stun
  value: number;
}

const DAMAGE_CHANNELS = [
  'physical', 'energy', 'distortion', 'thermal', 'biochemical', 'stun',
] as const;

/**
 * Pull per-channel impact damage from the ammo payload. Prefers the promoted
 * `impactDamage` set; falls back to the nested
 * `raw.projectileParams.damage.Damage<Channel>` the extractor leaves intact.
 */
export function ammoDamage(payload: unknown): DamageRow[] {
  const p = payload as
    | {
        impactDamage?: Record<string, number | null> | null;
        raw?: { projectileParams?: { damage?: Record<string, number> } };
      }
    | undefined;
  const out: DamageRow[] = [];
  const direct = p?.impactDamage ?? null;
  const nested = p?.raw?.projectileParams?.damage ?? null;
  for (const ch of DAMAGE_CHANNELS) {
    const cap = ch.charAt(0).toUpperCase() + ch.slice(1);
    const v =
      (direct?.[ch] as number | null | undefined) ??
      (nested?.['Damage' + cap] as number | undefined);
    if (typeof v === 'number' && v > 0) out.push({ channel: ch, value: v });
  }
  return out;
}

// ── hardpoint / loadout categorisation ────────────────────────────────────────

export type HardpointCategory =
  | 'weapons'
  | 'missiles'
  | 'power'
  | 'propulsion'
  | 'defense'
  | 'avionics'
  | 'cargo'
  | 'systems'
  | 'other';

// Display order of categories in the hardpoints / loadout sections.
export const HARDPOINT_CATEGORY_ORDER: HardpointCategory[] = [
  'weapons', 'missiles', 'defense', 'power', 'propulsion',
  'avionics', 'cargo', 'systems', 'other',
];

// Port `type` (PascalCase engine id) → category. First recognised type wins.
const TYPE_CATEGORY: Record<string, HardpointCategory> = {
  WeaponGun: 'weapons', WeaponMount: 'weapons', WeaponAttachment: 'weapons',
  WeaponDefensive: 'weapons', Turret: 'weapons', TurretBase: 'weapons',
  Gun: 'weapons', ToolArm: 'weapons', TractorBeam: 'weapons',
  Missile: 'missiles', MissileLauncher: 'missiles', MissileController: 'missiles',
  BombLauncher: 'missiles', GroundVehicleMissileLauncher: 'missiles',
  PowerPlant: 'power', EnergyController: 'power', Battery: 'power',
  CapacitorAssignmentController: 'power',
  MainThruster: 'propulsion', ManneuverThruster: 'propulsion', Thruster: 'propulsion',
  JumpDrive: 'propulsion', QuantumDrive: 'propulsion', QuantumFuelTank: 'propulsion',
  QuantumInterdictionGenerator: 'propulsion', FuelTank: 'propulsion',
  FuelIntake: 'propulsion', ExternalFuelTank: 'propulsion', FuelController: 'propulsion',
  Shield: 'defense', ShieldController: 'defense', Armor: 'defense',
  Cooler: 'defense', CoolerController: 'defense',
  Radar: 'avionics', Scanner: 'avionics', Ping: 'avionics', Relay: 'avionics',
  CommsController: 'avionics', FlightController: 'avionics', AIModule: 'avionics',
  TargetSelector: 'avionics', MiningModifier: 'avionics', SalvageModifier: 'avionics',
  Cargo: 'cargo', CargoGrid: 'cargo', Container: 'cargo',
  SalvageInternalStorage: 'cargo', SalvageFillerStation: 'cargo', SalvageHead: 'cargo',
  LifeSupportGenerator: 'systems', LifeSupportTank: 'systems', GravityGenerator: 'systems',
  Door: 'systems', DoorController: 'systems', LandingSystem: 'systems',
  AirTrafficController: 'systems', DockingCollar: 'systems', SelfDestruct: 'systems',
  LightController: 'systems',
};

// Fallback: classify by keywords in the port NAME (loadout has no `types`).
const NAME_KEYWORDS: [RegExp, HardpointCategory][] = [
  [/weapon|gun|turret|gimbal|mount|tractor/i, 'weapons'],
  [/missile|bomb|rocket|countermeasure|cml/i, 'missiles'],
  [/shield|armor|cooler/i, 'defense'],
  [/power_?plant|battery|capacitor|energy/i, 'power'],
  [/thruster|quantum|fuel|jump|maneuver|mav_/i, 'propulsion'],
  [/radar|scanner|ping|relay|comm|avionic|flight|salvage|mining|ifcs/i, 'avionics'],
  [/cargo|container|storage/i, 'cargo'],
  [/seat|door|light|life|grav|landing|dock|atc|self_?destruct|ladder|interior|room/i, 'systems'],
];

/** Classify a hardpoint by its accepted types (preferred) then its name. */
export function categorizePort(types: string[], portName: string | null): HardpointCategory {
  for (const t of types) {
    const c = TYPE_CATEGORY[t];
    if (c) return c;
  }
  if (portName) {
    for (const [re, cat] of NAME_KEYWORDS) if (re.test(portName)) return cat;
  }
  return 'other';
}

/** Human label for a single accepted-type token. */
export function humanizePortType(t: string): string {
  return humanizeKey(t);
}
