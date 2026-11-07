import type { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import type { StepKind } from '../../shared/step/sc-step.component';
import type { SupplyItem } from '../hq-supplies.service';
import { setKey } from '../hq-supplies.service';
import type { Einsatz } from '../data/hq-einsatz.service';
import type { PlanNeed, PlanSet } from './hq-plan-selection';
import type { MapPlace } from './map/hq-map.types';

/** Favourite flag of an FPS set (`hangar_role_loadouts.favorite`); the domain type does not carry it yet. */
function fpsFavorite(l: HangarRoleLoadout): boolean {
  return (l as HangarRoleLoadout & { favorite?: boolean }).favorite === true;
}

const placeId = (system: string, planet: string | null, location: string) =>
  [system, planet, location].filter(Boolean).map((s) => (s as string).trim().toLowerCase().replace(/\s+/g, '-')).join('/');

/**
 * Where a need can be met, from what the user already planned: the location of the last Einsatz
 * step that points at the supply. TODO(map): the map package adds Codex shop data / community
 * medians as further sources (D43); this is the one that needs no extra request.
 */
export function placesFromEinsaetze(einsaetze: readonly Einsatz[]): Map<string, MapPlace> {
  const out = new Map<string, MapPlace>();
  for (const e of einsaetze) {
    for (const s of e.steps) {
      if (!s.supplyId || !s.location || !s.system) continue;
      out.set(s.supplyId, { id: placeId(s.system, null, s.location), system: s.system, planet: null, location: s.location });
    }
  }
  return out;
}

/** The sets worth showing: favourites, the active variant of each ship, every FPS set, and any set with Nachschub lines. */
export function buildPlanSets(
  ships: readonly HangarShip[],
  configs: readonly HangarShipConfig[],
  loadouts: readonly HangarRoleLoadout[],
  supplies: readonly SupplyItem[],
): PlanSet[] {
  const used = new Set(supplies.map((s) => (s.setKind && s.setId ? setKey(s.setKind, s.setId) : '')));
  const shipById = new Map(ships.map((s) => [s.id, s] as const));
  const out: PlanSet[] = [];
  for (const c of configs) {
    const ship = shipById.get(c.hangarShipId);
    if (!ship) continue;
    const key = setKey('ship', c.id);
    if (!c.isActive && !used.has(key)) continue;
    out.push({ key, kind: 'ship', id: c.id, name: `${ship.customName ?? ship.shipClassName} · ${c.name}`, favorite: ship.pinnedRank !== null });
  }
  for (const l of loadouts) out.push({ key: setKey('fps', l.id), kind: 'fps', id: l.id, name: l.name, favorite: fpsFavorite(l) });
  return out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
}

export function buildPlanNeeds(
  supplies: readonly SupplyItem[],
  sets: readonly PlanSet[],
  places: ReadonlyMap<string, MapPlace>,
): PlanNeed[] {
  const setName = new Map(sets.map((s) => [s.key, s.name] as const));
  return supplies.map((s) => {
    const key = s.setKind && s.setId ? setKey(s.setKind, s.setId) : null;
    return {
      id: s.id,
      label: s.name,
      kind: (s.stepKind ?? 'buy') as StepKind,
      qty: s.qty,
      amount: s.amount,
      status: s.done ? 'done' : 'open',
      setKey: key,
      setName: key ? (setName.get(key) ?? null) : null,
      className: s.className,
      place: places.get(s.id) ?? null,
      activity: null,
      crew: 1,
      wanted: s.wanted,
    };
  });
}
