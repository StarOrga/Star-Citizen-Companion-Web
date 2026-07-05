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

// Suffixes carried by raw class names that add no value to a display title.
const CLASSNAME_SUFFIX = /(_SCItem|_PU|_AI|_NT)+$/i;

/**
 * Turn a raw entity class name into a readable title, for entities that ship no
 * localized name (much SC ammunition, some un-catalogued loadout items). Keeps
 * the manufacturer/size tokens but un-snake-cases and spaces them, so
 * `AMRS_LaserCannon_S3_AMMO` → `AMRS Laser Cannon S3 AMMO` instead of leaking
 * the raw slug as the heading. Generic — no per-entity rules.
 */
export function humanizeClassName(className: string | null | undefined): string {
  const raw = (className ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(CLASSNAME_SUFFIX, '')
    .split('_')
    .filter(Boolean)
    // split camelCase words ("LaserCannon" → "Laser Cannon") but keep size/grade
    // tokens like "S3"/"S01" intact (no letter↔digit split).
    .map((tok) => tok.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || raw;
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

/**
 * Format a numeric stat: comma-grouped thousands, up to 2 decimals (trailing
 * zeros trimmed), FLT_MAX → ∞.
 *
 * Deliberately locale-INDEPENDENT (manual grouping, no `toLocaleString`). The
 * SC catalog is rendered English-only, and `Number.prototype.toLocaleString`
 * proved unreliable in practice — depending on locale-data load order / host
 * Intl it could emit German separators ("1.196") even when called with
 * `'en-US'`. Manual formatting guarantees a single, stable presentation
 * everywhere regardless of the host environment.
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) >= SENTINEL) return '∞';
  const rounded = Math.round(v * 100) / 100;
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const intPart = Math.trunc(abs);
  const frac = Math.round((abs - intPart) * 100); // 0..99
  const grouped = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = grouped;
  if (frac > 0) {
    const fracStr = (frac % 10 === 0 ? String(frac / 10) : String(frac).padStart(2, '0'));
    out = `${grouped}.${fracStr}`;
  }
  return neg ? `-${out}` : out;
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

// Word tokens that mark a field as presentation/engine metadata rather than a
// user-facing stat — dropped regardless of value. Matched per camelCase /
// underscore word so "geometryTags", "displayThumbnail", "UIIconType" all hit
// while real stats ("muzzleVelocity", "MaxShieldHealth") pass through.
const NOISE_WORDS = new Set([
  'geometry', 'audio', 'visual', 'animation', 'anim', 'particle', 'material',
  'mesh', 'texture', 'icon', 'sound', 'tag', 'tags', 'record', 'helper',
  'namespace', 'template', 'thumbnail', 'tooltip', 'binding', 'display', 'ui',
]);

/** Lower-cased word tokens of an engine identifier (camelCase + underscores). */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Whether a field name is engine/presentation metadata rather than a stat. */
export function isNoiseKey(key: string): boolean {
  return keyWords(key).some((w) => NOISE_WORDS.has(w));
}

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
      if (FIELD_BLACKLIST.has(k) || isNoiseKey(k)) continue;
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
    if (isNoiseKey(k)) continue;
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

// ── compare table ─────────────────────────────────────────────────────────────

// One comparable attribute of an entity. `id` is the stable union/order key;
// `labelKey` is an i18n key (resolved by the component) or `label` is a literal
// (already-humanized) stat name. Exactly one of labelKey/label is set.
// `group` buckets the row for the purpose-grouped compare surface: 'identity'
// for who/what attributes, otherwise a StatPurpose.
export interface CompareAttr {
  id: string;
  labelKey?: string;
  label?: string;
  value: string;
  group?: string;
}

// Minimal entity shape the compare collector needs (subset of CodexDetail).
export interface CompareEntityInput {
  kind: string;
  payload: unknown;
  row: Record<string, unknown>;
  ports: { types: string[]; portName: string | null }[];
}

/**
 * Collect an entity's comparable attributes for the side-by-side table, in a
 * stable display order. Generic per entity TYPE — reuses the same curation as
 * the detail view (curated component stats, filtered weapon params, ammo damage,
 * port summary) so the comparison matches what the detail page shows.
 */
export function collectCompareAttributes(e: CompareEntityInput): CompareAttr[] {
  const out: CompareAttr[] = [];
  const row = e.row;
  const add = (id: string, labelKey: string, value: unknown, group = 'identity') => {
    if (value == null || value === '') return;
    out.push({ id, labelKey, value: String(value), group });
  };

  // Common identity attributes (same id across kinds → they align in the table).
  const mfr =
    (e.payload as { manufacturer?: { name?: { en?: string } } } | undefined)?.manufacturer?.name
      ?.en || cleanLocaleValue(row['manufacturer_code'] as string);
  add('manufacturer', 'codex.detail.manufacturer', mfr);
  if (row['size'] != null) add('size', 'codex.detail.size', 'S' + row['size']);
  add('grade', 'codex.detail.grade', row['grade']);

  if (e.kind === 'ship') {
    add('crew', 'codex.detail.crew', row['crew_size']);
    const dim = (e.payload as { dimensions?: { length: number; width: number; height: number } } | undefined)
      ?.dimensions;
    if (dim && (dim.length || dim.width || dim.height)) {
      add('dimensions', 'codex.detail.dimensions',
        `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`);
    }
    for (const s of summarizePorts(e.ports)) {
      out.push({
        id: 'hp_' + s.category, labelKey: 'codex.portCategory.' + s.category,
        value: String(s.count), group: 'identity',
      });
    }
  } else if (e.kind === 'weapon') {
    const wc = row['weapon_class'];
    if (typeof wc === 'string')
      out.push({ id: 'weaponClass', labelKey: 'codex.detail.weaponClass', value: wc, group: 'identity' });
    for (const r of meaningfulRows((e.payload as { weaponParams?: Record<string, unknown> } | undefined)?.weaponParams)) {
      out.push({
        id: 'wp_' + r.key, label: r.key, value: r.unit ? `${r.value} ${r.unit}` : r.value,
        group: classifyStatPurpose(r.key, r.unit),
      });
    }
  } else if (e.kind === 'component') {
    const ck = row['kind'];
    if (typeof ck === 'string')
      out.push({ id: 'componentKind', labelKey: 'codex.detail.componentKind', value: ck, group: 'identity' });
    for (const r of curateComponentStats(
      (e.payload as { stats?: Record<string, Record<string, unknown>> } | undefined)?.stats)) {
      out.push({
        id: 'cs_' + r.key, label: r.key, value: r.unit ? `${r.value} ${r.unit}` : r.value,
        group: classifyStatPurpose(r.key, r.unit),
      });
    }
  } else if (e.kind === 'ammunition') {
    const speed = row['speed'];
    if (typeof speed === 'number' && speed > 0)
      add('speed', 'codex.detail.speed', formatNumber(speed) + ' m/s', 'mobility');
    for (const d of ammoDamage(e.payload)) {
      out.push({
        id: 'dmg_' + d.channel, labelKey: 'codex.damage.' + d.channel,
        value: formatNumber(d.value), group: 'offense',
      });
    }
  }
  return out;
}

export interface CompareColumn {
  key: string;
  name: string;
  kind: string;
  className: string;
}
export interface CompareTableRow {
  id: string;
  labelKey?: string;
  label?: string;
  group?: string; // 'identity' | StatPurpose — purpose bucket for grouped rendering
  values: (string | null)[]; // one cell per column, null = N/A
  // UC-05: per-cell rank when the row is numerically comparable across ≥2
  // columns — 'best' = highest value, 'worst' = lowest. null = not ranked.
  highlight: ('best' | 'worst' | null)[];
  // Delta bar: cell value as % of the row maximum (only when the row is
  // ranked, i.e. ≥2 numeric values with a real spread). null = no bar.
  barPct: (number | null)[];
}

/**
 * Build a unified compare table from per-entity attribute lists. Rows are the
 * ordered union of attribute ids (first-seen order across columns); each cell
 * is the entity's value for that id, or null when it has none.
 */
export function buildCompareTable(
  columns: CompareColumn[],
  perEntity: CompareAttr[][],
): CompareTableRow[] {
  const order: string[] = [];
  const meta = new Map<string, { labelKey?: string; label?: string; group?: string }>();
  for (const attrs of perEntity) {
    for (const a of attrs) {
      if (!meta.has(a.id)) {
        meta.set(a.id, { labelKey: a.labelKey, label: a.label, group: a.group });
        order.push(a.id);
      }
    }
  }
  return order.map((id) => {
    const m = meta.get(id)!;
    const values = perEntity.map((attrs) => attrs.find((a) => a.id === id)?.value ?? null);
    return {
      id, labelKey: m.labelKey, label: m.label, group: m.group,
      values, highlight: rankRow(values), barPct: rowBars(values),
    };
  });
}

/**
 * Group compare rows by their purpose bucket, in stable display order
 * ('identity' first, then the StatPurpose order). Rows without a group land
 * in 'general'. Same bucket order as the detail view — the compare surface
 * reads with the same structure the user just learned.
 */
export function groupCompareRows(
  rows: CompareTableRow[],
): { group: string; rows: CompareTableRow[] }[] {
  const order = ['identity', ...STAT_PURPOSE_ORDER];
  const buckets = new Map<string, CompareTableRow[]>();
  for (const row of rows) {
    const g = row.group && order.includes(row.group) ? row.group : 'general';
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(row);
  }
  return order.filter((g) => buckets.has(g)).map((g) => ({ group: g, rows: buckets.get(g)! }));
}

/**
 * Whether a compare row actually differentiates the columns — used by the
 * "differences only" toggle. A row differs when it has ≥2 distinct cell
 * values (null counts as a value: present-vs-absent IS a difference).
 */
export function rowHasDifferences(row: CompareTableRow): boolean {
  return new Set(row.values).size > 1;
}

/**
 * Parse a single comparable number out of a formatted cell, or null. Rejects
 * multi-number strings (e.g. dimensions "12 × 8 × 4 m") and ∞ sentinels so they
 * are never ranked; accepts a leading size prefix ("S3" → 3) and unit suffix
 * ("1,196 m/s" → 1196).
 */
function compareNumber(v: string): number | null {
  const nums = v.match(/\d[\d,]*\.?\d*/g);
  if (!nums || nums.length !== 1) return null;
  const n = parseFloat(nums[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Mark the highest cell 'best' and the lowest 'worst' when a row has ≥2
 * numerically comparable values (higher = better, the common stat heuristic).
 * Rows that aren't uniformly numeric stay unranked.
 */
function rankRow(values: (string | null)[]): ('best' | 'worst' | null)[] {
  const nums = values.map((v) => (v == null ? null : compareNumber(v)));
  const valid = nums.filter((n): n is number => n != null);
  if (valid.length < 2) return values.map(() => null);
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  if (max === min) return values.map(() => null);
  return nums.map((n) => (n == null ? null : n === max ? 'best' : n === min ? 'worst' : null));
}

/**
 * Per-cell delta bar widths (% of the row max), under the same conditions
 * rankRow ranks: ≥2 numeric values with a real spread. Negative values are
 * clamped to 0 (bars visualise magnitude, not sign).
 */
function rowBars(values: (string | null)[]): (number | null)[] {
  const nums = values.map((v) => (v == null ? null : compareNumber(v)));
  const valid = nums.filter((n): n is number => n != null);
  if (valid.length < 2) return values.map(() => null);
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  if (max === min || max <= 0) return values.map(() => null);
  return nums.map((n) => (n == null ? null : Math.max(0, Math.round((n / max) * 100))));
}

// ── stat purpose grouping ("what is it FOR") ──────────────────────────────────

// The purpose buckets a decision stat can belong to. Display order below —
// same buckets drive the detail view sections AND the compare surface groups.
export type StatPurpose =
  | 'offense'
  | 'defense'
  | 'mobility'
  | 'powerThermal'
  | 'capacity'
  | 'handling'
  | 'general';

export const STAT_PURPOSE_ORDER: StatPurpose[] = [
  'offense', 'defense', 'mobility', 'powerThermal', 'capacity', 'handling', 'general',
];

// Keyword → purpose, checked in STAT_PURPOSE_ORDER priority (offense wins over
// powerThermal for "Damage Energy", etc.). Matched per humanized-label word.
const PURPOSE_KEYWORDS: Record<Exclude<StatPurpose, 'general'>, Set<string>> = {
  offense: new Set([
    'damage', 'dps', 'fire', 'firerate', 'projectile', 'muzzle', 'burst',
    'salvo', 'missile', 'rocket', 'penetration', 'pellet', 'pellets',
  ]),
  defense: new Set([
    'shield', 'health', 'armor', 'armour', 'hull', 'resist', 'resistance',
    'absorption', 'regen', 'regeneration', 'durability', 'hardening',
  ]),
  mobility: new Set([
    'speed', 'velocity', 'acceleration', 'boost', 'thrust', 'thruster',
    'scm', 'afterburner', 'agility', 'pitch', 'yaw', 'roll', 'jump',
  ]),
  powerThermal: new Set([
    'power', 'heat', 'cooling', 'coolant', 'thermal', 'temperature',
    'em', 'ir', 'signature', 'wattage', 'draw', 'overclock', 'wear',
  ]),
  capacity: new Set([
    'capacity', 'cargo', 'scu', 'fuel', 'range', 'volume', 'storage',
    'stock', 'ammo', 'magazine', 'rounds', 'count', 'lifetime', 'duration',
  ]),
  handling: new Set([
    'spread', 'recoil', 'spool', 'charge', 'cooldown', 'delay', 'aim',
    'zoom', 'ads', 'swap', 'reload', 'stability', 'sway',
  ]),
};

// Unit → purpose fallback when no keyword hits (units are curated, so this
// is a safe signal: rpm is a fire stat, HP a durability stat, m/s movement).
const PURPOSE_BY_UNIT: Record<string, StatPurpose> = {
  rpm: 'offense',
  HP: 'defense',
  'HP/s': 'defense',
  'm/s': 'mobility',
  s: 'handling',
};

/**
 * Classify a stat row into its purpose bucket by its (humanized or raw) label
 * words, falling back to the unit, then 'general'. Keyword priority follows
 * STAT_PURPOSE_ORDER so ambiguous labels land in the more decision-relevant
 * bucket ("Damage Energy" → offense, not powerThermal).
 */
export function classifyStatPurpose(label: string, unit?: string): StatPurpose {
  // rpm is unambiguously a fire stat — decide before 'rounds' pulls
  // "Rounds Per Minute" into the capacity bucket.
  if (unit === 'rpm') return 'offense';
  const words = new Set(keyWords(label));
  for (const purpose of STAT_PURPOSE_ORDER) {
    if (purpose === 'general') break;
    const kws = PURPOSE_KEYWORDS[purpose];
    for (const w of words) if (kws.has(w)) return purpose;
  }
  if (unit && PURPOSE_BY_UNIT[unit]) return PURPOSE_BY_UNIT[unit];
  return 'general';
}

export interface StatGroup {
  purpose: StatPurpose;
  rows: StatRow[];
}

/**
 * Bucket curated stat rows by purpose, in display order. Buckets that would
 * hold nothing are omitted; callers can render a single 'general' group
 * headerless (grouping only helps once there are ≥2 buckets).
 */
export function groupStatRows(rows: StatRow[]): StatGroup[] {
  const buckets = new Map<StatPurpose, StatRow[]>();
  for (const row of rows) {
    const p = classifyStatPurpose(row.key, row.unit);
    (buckets.get(p) ?? buckets.set(p, []).get(p)!).push(row);
  }
  return STAT_PURPOSE_ORDER.filter((p) => buckets.has(p)).map((p) => ({
    purpose: p,
    rows: buckets.get(p)!,
  }));
}

// ── swap preview deltas (loadout ladder Rung 2) ───────────────────────────────

// One stat changed by a hypothetical swap: installed → candidate. `pct` is
// the relative change (null when the pair isn't numerically comparable).
export interface StatDelta {
  key: string;
  from: string;
  to: string;
  pct: number | null;
  unit?: string;
}

/**
 * Join two curated stat-row sets by label and compute the per-stat change a
 * swap would cause ("+12% Max Shield Health"), sorted by impact (|pct| desc,
 * non-numeric rows last). Rows only one side has are skipped — a delta needs
 * both ends. Pure sandbox math; nothing is persisted (Rung 2 contract).
 */
export function computeStatDeltas(
  installed: StatRow[],
  candidate: StatRow[],
  limit = 6,
): StatDelta[] {
  const byKey = new Map(candidate.map((r) => [r.key, r]));
  const out: StatDelta[] = [];
  for (const from of installed) {
    const to = byKey.get(from.key);
    if (!to || to.value === from.value) continue;
    const a = compareNumber(from.value);
    const b = compareNumber(to.value);
    const pct =
      a != null && b != null && a !== 0 ? Math.round(((b - a) / Math.abs(a)) * 100) : null;
    if (pct === 0) continue; // rounds to no change — not worth a row
    out.push({ key: from.key, from: from.value, to: to.value, pct, unit: from.unit });
  }
  out.sort((x, y) => Math.abs(y.pct ?? -1) - Math.abs(x.pct ?? -1));
  return out.slice(0, limit);
}

// ── full spec sheet (Manifest) ────────────────────────────────────────────────

export interface SpecSection {
  /** Humanized section title (from the payload struct name), '' = top-level scalars. */
  title: string;
  rows: StatRow[];
}

// Payload keys that are rendered elsewhere on the detail page (or are pure
// metadata) — the spec sheet skips them instead of duplicating.
const SPEC_SKIP_KEYS = new Set([
  'name', 'description', 'manufacturer', 'source', 'itemPorts', 'defaultLoadout',
  'className', 'guid', 'type', 'recordTag', 'tags', 'iconPath', 'previewImage',
  'entityKind', 'vehicleName', 'raw',
]);

/**
 * Flatten an entity payload into a readable full-spec sheet: one section of
 * top-level scalar values, plus one section per nested struct (stats structs,
 * flight, crew, …) with its meaningful scalar children. Depth 2 — deeper
 * nesting stays in the raw JSON view. Purely additive presentation; the same
 * noise filters as the curated views apply.
 */
export function flattenSpec(payload: unknown): SpecSection[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const top = payload as Record<string, unknown>;
  const sections: SpecSection[] = [];
  const topRows: StatRow[] = [];

  const structRows = (struct: Record<string, unknown>): StatRow[] => {
    const rows: StatRow[] = [];
    for (const [k, v] of Object.entries(struct)) {
      if (isNoiseKey(k)) continue;
      // One nesting level inside a section: flatten scalar children of
      // sub-structs ("damage.DamageEnergy" → "Damage Energy").
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (isNoiseKey(k2) || !isMeaningfulValue(v2)) continue;
          rows.push({ key: humanizeKey(k2), value: formatValue(v2), unit: unitForField(k2) });
        }
        continue;
      }
      if (!isMeaningfulValue(v)) continue;
      rows.push({ key: humanizeKey(k), value: formatValue(v), unit: unitForField(k) });
    }
    // De-dup by label, keep first (mirrors curateComponentStats).
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  };

  for (const [key, value] of Object.entries(top)) {
    if (SPEC_SKIP_KEYS.has(key) || isNoiseKey(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rows = structRows(value as Record<string, unknown>);
      if (rows.length > 0) sections.push({ title: humanizeKey(key), rows });
      continue;
    }
    if (isMeaningfulValue(value)) {
      topRows.push({ key: humanizeKey(key), value: formatValue(value), unit: unitForField(key) });
    }
  }

  return topRows.length > 0 ? [{ title: '', rows: topRows }, ...sections] : sections;
}

// ── blueprint craft-time formatting ──────────────────────────────────────────

/**
 * Format a craft/dismantle duration in seconds to a human-readable string.
 * Examples: 0 → "0 s", 45 → "45 s", 90 → "1 m 30 s", 3600 → "1 h", 3661 → "1 h 1 m 1 s".
 * Nullish or negative input → null (caller shows "n/a").
 */
export function formatCraftTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  if (s === 0) return '0 s';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} m`);
  if (sec > 0) parts.push(`${sec} s`);
  return parts.join(' ');
}

/** Format a quality fraction (0–1) as a percentage string. Returns "n/a" for null. */
export function formatQuality(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return 'n/a';
  return `${Math.round(q * 100)} %`;
}

// ── ship equipment summary ────────────────────────────────────────────────────

export interface PortSummaryEntry {
  category: HardpointCategory;
  count: number;
}

// Categories worth summarising at a glance on a ship (the combat/role-defining
// ones). `systems`/`other` are structural noise (seats, doors, lights) — they
// inflate the count without telling you anything about the hull, so we omit
// them from the headline summary (the full grouped list still shows everything).
const SUMMARY_CATEGORIES: HardpointCategory[] = [
  'weapons', 'missiles', 'defense', 'power', 'propulsion', 'avionics', 'cargo',
];

/**
 * Count a ship's hardpoints per functional category, for an at-a-glance
 * equipment summary. Input is the full port list (from codex_item_ports).
 * Returns only the role-defining categories that are present, in display order.
 */
export function summarizePorts(
  ports: { types: string[]; portName: string | null }[],
): PortSummaryEntry[] {
  const counts = new Map<HardpointCategory, number>();
  for (const p of ports) {
    const cat = categorizePort(p.types, p.portName);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return SUMMARY_CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    count: counts.get(c)!,
  }));
}
