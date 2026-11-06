/**
 * Ship facets of the Codex index (package B, 2026-11-06): role and crew.
 *
 * Role follows the RSI ship matrix (Combat, Transport, Exploration,
 * Industrial, Support, Competition, Ground, Multirole). The game data carries
 * it as the vehicle's `career` localisation key in the payload; a handful of
 * ships use an older `@item_ShipFocus_*` or `@vehicle_class_*` key there, so
 * each role lists every key that belongs to it.
 *
 * Crew is grouped into four bands instead of single numbers: 1, 2–3, 4–8, 9+.
 */

export const SHIP_ROLES = [
  'combat',
  'transport',
  'exploration',
  'industrial',
  'support',
  'competition',
  'ground',
  'multirole',
] as const;
export type ShipRole = (typeof SHIP_ROLES)[number];

/** Payload `career` keys per role (Codex build 4.10.2, every key seen there). */
export const SHIP_ROLE_CAREERS: Readonly<Record<ShipRole, readonly string[]>> = {
  combat: [
    '@vehicle_focus_combat',
    '@item_ShipFocus_Gunship',
    '@item_ShipFocus_CapitalShip',
    '@vehicle_class_destroyer',
    '@vehicle_class_snubfighter',
  ],
  transport: ['@vehicle_focus_transporter', '@item_ShipFocus_Transport'],
  exploration: ['@vehicle_focus_exploration'],
  industrial: ['@vehicle_focus_resources'],
  support: ['@vehicle_focus_support'],
  competition: ['@vehicle_focus_competition'],
  ground: ['@vehicle_focus_ground'],
  multirole: ['@vehicle_focus_multirole', '@item_ShipFocus_Starter'],
};

export function isShipRole(v: string): v is ShipRole {
  return (SHIP_ROLES as readonly string[]).includes(v);
}

/** The role a `career` key belongs to, or null for an unknown key. */
export function shipRoleOf(career: string | null | undefined): ShipRole | null {
  if (!career) return null;
  const key = career.trim().toLowerCase();
  for (const role of SHIP_ROLES) {
    if (SHIP_ROLE_CAREERS[role].some((c) => c.toLowerCase() === key)) return role;
  }
  return null;
}

export const CREW_BANDS = ['solo', 'small', 'medium', 'large'] as const;
export type CrewBand = (typeof CREW_BANDS)[number];

/** Inclusive crew range of a band; `max: null` is open-ended. */
export const CREW_BAND_RANGE: Readonly<Record<CrewBand, { min: number; max: number | null }>> = {
  solo: { min: 1, max: 1 },
  small: { min: 2, max: 3 },
  medium: { min: 4, max: 8 },
  large: { min: 9, max: null },
};

export function isCrewBand(v: string): v is CrewBand {
  return (CREW_BANDS as readonly string[]).includes(v);
}

/** The band a crew size falls into, or null when the size is unknown. */
export function crewBandOf(size: number | null | undefined): CrewBand | null {
  if (size == null || !Number.isFinite(size) || size < 1) return null;
  for (const band of CREW_BANDS) {
    const r = CREW_BAND_RANGE[band];
    if (size >= r.min && (r.max === null || size <= r.max)) return band;
  }
  return null;
}
