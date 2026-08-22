/**
 * Input-action category hierarchy — the CONTEXT half (L1–L5) of the SCC
 * "Input Actions Hierarchy Concept v5"
 * (Star-Citizen-Companion-App/docs/architecture/generated/input-actions-hierarchy.html).
 *
 * L1 Scope        — where am I fundamentally?          exclusive
 * L2 Environment  — refines the scope                  exclusive
 * L3 Role         — refines the environment            exclusive
 * L4 Activity     — what am I doing right now?         exclusive
 * L5 Action Group — which system does the action serve? parallel
 *
 * L6–L8 (Device / Input / Action) are the BINDING half: they are extracted
 * from defaultProfile.xml and already live on `codex_keybinds`, so nothing
 * here describes them.
 *
 * The ids are the values stored in `public.keybind_categories`; the DB mirrors
 * both the vocabulary and the two parent→child rules below as CHECK
 * constraints, so this file and the migration must stay in sync. Labels are
 * i18n keys (`codex.keybinds.taxonomy.*`), never literal text.
 */

export type KeybindScope = 'verse' | 'in_game' | 'out_of_game';

export type KeybindEnvironment =
  | 'on_foot'
  | 'in_vehicle'
  | 'spectator'
  | 'mobiglas'
  | 'starmap'
  | 'chat'
  | 'console';

export type KeybindRole =
  | 'pilot'
  | 'copilot'
  | 'gunner'
  | 'driver'
  | 'normal'
  | 'eva'
  | 'ladder';

export type KeybindActivity =
  | 'combat'
  | 'mining'
  | 'salvage'
  | 'exploring'
  | 'medical'
  | 'trading'
  | 'racing'
  | 'engineering'
  | 'hacking';

export type KeybindActionGroup =
  | 'flight_control'
  | 'weapons'
  | 'targeting'
  | 'shields'
  | 'power'
  | 'mfd_hud'
  | 'mining_tools'
  | 'movement'
  | 'camera'
  | 'communication'
  | 'interaction';

/** One action's curated place in the hierarchy. `null` = not assigned (yet). */
export interface KeybindAssignment {
  scope: KeybindScope | null;
  environment: KeybindEnvironment | null;
  role: KeybindRole | null;
  activity: KeybindActivity | null;
  actionGroup: KeybindActionGroup | null;
}

/** The five layers, in the order the UI (and the DB checks) cascade them. */
export type KeybindLayer = keyof KeybindAssignment;
export const KEYBIND_LAYERS: readonly KeybindLayer[] = [
  'scope',
  'environment',
  'role',
  'activity',
  'actionGroup',
] as const;

export const EMPTY_ASSIGNMENT: Readonly<KeybindAssignment> = Object.freeze({
  scope: null,
  environment: null,
  role: null,
  activity: null,
  actionGroup: null,
});

export const KEYBIND_SCOPES: readonly KeybindScope[] = ['verse', 'in_game', 'out_of_game'] as const;

/** L2 per scope — the exclusivity rule of layer 2. */
const ENVIRONMENTS_BY_SCOPE: Readonly<Record<KeybindScope, readonly KeybindEnvironment[]>> = {
  verse: ['on_foot', 'in_vehicle', 'spectator'],
  in_game: ['mobiglas', 'starmap', 'chat'],
  out_of_game: ['console'],
};

/** L3 per environment — environments not listed here take no role at all. */
const ROLES_BY_ENVIRONMENT: Readonly<Partial<Record<KeybindEnvironment, readonly KeybindRole[]>>> = {
  in_vehicle: ['pilot', 'copilot', 'gunner', 'driver'],
  on_foot: ['normal', 'eva', 'ladder'],
};

export const KEYBIND_ACTIVITIES: readonly KeybindActivity[] = [
  'combat',
  'mining',
  'salvage',
  'exploring',
  'medical',
  'trading',
  'racing',
  'engineering',
  'hacking',
] as const;

export const KEYBIND_ACTION_GROUPS: readonly KeybindActionGroup[] = [
  'flight_control',
  'weapons',
  'targeting',
  'shields',
  'power',
  'mfd_hud',
  'mining_tools',
  'movement',
  'camera',
  'communication',
  'interaction',
] as const;

/** Environments selectable under `scope` — empty while no scope is chosen. */
export function environmentsFor(scope: KeybindScope | null): readonly KeybindEnvironment[] {
  return scope ? ENVIRONMENTS_BY_SCOPE[scope] : [];
}

/** Roles selectable under `environment` — empty where the layer doesn't apply. */
export function rolesFor(environment: KeybindEnvironment | null): readonly KeybindRole[] {
  return environment ? (ROLES_BY_ENVIRONMENT[environment] ?? []) : [];
}

/**
 * Drop any child layer its (new) parent no longer allows. Picking a different
 * scope must not silently keep "Pilot" from the previous one — the DB would
 * reject that write anyway, and the admin would only learn about it on save.
 */
export function normalizeAssignment(a: KeybindAssignment): KeybindAssignment {
  const environment =
    a.environment && environmentsFor(a.scope).includes(a.environment) ? a.environment : null;
  const role = a.role && rolesFor(environment).includes(a.role) ? a.role : null;
  return { ...a, environment, role };
}

/** True once at least one layer is set — i.e. the row is worth persisting. */
export function isAssigned(a: KeybindAssignment): boolean {
  return KEYBIND_LAYERS.some((l) => a[l] !== null);
}

/** i18n key for a layer value, e.g. `codex.keybinds.taxonomy.scope.verse`. */
export function taxonomyKey(layer: KeybindLayer, value: string): string {
  return `codex.keybinds.taxonomy.${layer}.${value}`;
}
