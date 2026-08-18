// Reading a ship's STOCK fit out of `payload.defaultLoadout`.
// -----------------------------------------------------------------------------
// A loadout entry is a tree, not a row: `hardpoint_weapon_top_left` holds a gun
// MOUNT, and the gun itself sits in a sub-port of that mount. The ship page has
// always rendered the sub-slots (`LayoutChild`) as sized placeholders because
// the extract stopped at the top level — with the nested `entries` the uploader
// now emits, those placeholders can name what is actually installed.
//
// Everything here is generic tree walking over ingested identifiers. No item,
// port or ship is known to this file by name: an extract without nested entries
// simply yields empty maps and the UI keeps its previous behaviour.

import { ItemPort, LoadoutEntry } from './codex.types';
import { humanizePortType } from './codex-format';
import { CodexKind } from './codex.service';

/** Slack against a malformed/cyclic payload; the live extract nests 2 deep. */
const MAX_DEPTH = 8;

/**
 * `subPortName → installed class` for the item on ONE hardpoint.
 *
 * Only the entry's DIRECT children: they are the sub-slots of the thing bolted
 * to the hull (the gimbal's gun seat, the rack's missile stations). Deeper
 * levels belong to those children in turn, not to this hardpoint.
 *
 * Returns an empty map when the extract carries no nested fit — which the
 * caller must read as "unknown", never as "this mount is empty".
 */
export function carriedByPort(entry: LoadoutEntry | null | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const child of entry?.entries ?? []) {
    const port = child.itemPortName?.trim();
    const className = child.entityClassName?.trim();
    // First wins: a duplicated sub-port name would otherwise silently swap the
    // occupant of a slot the UI already showed.
    if (port && className && !out.has(port)) out.set(port, className);
  }
  return out;
}

/**
 * Every class name anywhere in a stock loadout, deduped and in tree order.
 *
 * The page resolves names, sizes and payloads by class name in ONE batched
 * lookup, so the sub-items have to be in the same list as the top-level ones —
 * otherwise a gun that only exists inside a mount would render as its raw
 * `KLWE_LaserRepeater_S3` identifier with no size, manufacturer or stats.
 */
export function stockLoadoutClassNames(entries: readonly LoadoutEntry[] | null | undefined): string[] {
  const seen = new Set<string>();
  const walk = (list: readonly LoadoutEntry[] | undefined, depth: number): void => {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return;
    for (const e of list) {
      const className = e?.entityClassName?.trim();
      if (className) seen.add(className);
      walk(e?.entries, depth + 1);
    }
  };
  walk(entries ?? [], 0);
  return [...seen];
}

/** What a resolved sub-slot occupant contributes to its row. */
export interface CarriedEntity {
  kind: CodexKind;
  size?: number | null;
  displayName?: string | null;
}

/** One sub-slot row — mirrors `LayoutChild` without importing the component. */
export interface CarriedSlot {
  port: string;
  typeLabel: string | null;
  size: number | null;
  className: string | null;
  kind: CodexKind | null;
  name: string | null;
  count: number;
  /**
   * Every RAW sub-port name collapsed into this row (Falle 3 / R5) — the
   * humanized `port` above cannot address a draft entry or a compatibility
   * query, only these can. A count>1 row lists every member so a draft can
   * still address one of several identical seats individually.
   */
  rawPorts: string[];
  /** Raw (un-humanized) engine type strings the sub-port declares. */
  rawTypes: string[];
}

/**
 * The sub-slots of the item on one hardpoint, paired with what the ship's stock
 * loadout puts in them.
 *
 * `ports` are the OCCUPANT's own `itemPorts` (the gun seat inside a gimbal, the
 * four stations of a rack); `carried` is `carriedByPort` for that hardpoint.
 * Rows collapse only when the port type, the port size AND the occupant match —
 * a rack with four identical missiles is one `4×` row, a mixed load is not.
 *
 * Two rules keep it from ever hiding data the extract gave us:
 *   * an untyped sub-port is skipped ONLY while nothing is installed in it;
 *   * a sub-port the loadout fills but the occupant never declares is appended
 *     with no type rather than dropped (91 of 9 317 sub-entries on 4.9.0).
 */
export function carriedSlots(
  ports: readonly ItemPort[] | null | undefined,
  carried: ReadonlyMap<string, string>,
  resolve: (className: string) => CarriedEntity | undefined,
  humanize: (portName: string | null) => string,
): CarriedSlot[] {
  const byPort = new Map([...carried].map(([k, v]) => [k.toLowerCase(), v]));
  const seen = new Set<string>();
  const out: CarriedSlot[] = [];
  const index = new Map<string, CarriedSlot>();

  const add = (
    portName: string | null,
    typeLabel: string | null,
    portSize: number | null,
    installed: string | null,
    rawTypes: string[],
  ): void => {
    const key = `${typeLabel ?? ''}|${portSize ?? ''}|${installed ?? ''}`;
    const hit = index.get(key);
    if (hit) {
      hit.count += 1;
      if (portName) hit.rawPorts.push(portName);
      return;
    }
    const entity = installed ? resolve(installed) : undefined;
    const slot: CarriedSlot = {
      port: humanize(portName),
      typeLabel,
      size: portSize ?? entity?.size ?? null,
      className: installed,
      kind: entity?.kind ?? null,
      name: installed ? (entity?.displayName ?? null) || installed : null,
      count: 1,
      rawPorts: portName ? [portName] : [],
      rawTypes,
    };
    index.set(key, slot);
    out.push(slot);
  };

  for (const p of ports ?? []) {
    const key = (p.portName ?? '').toLowerCase();
    const installed = byPort.get(key) ?? null;
    const types = (p.types ?? []).filter(Boolean);
    if (types.length === 0 && !installed) continue;
    seen.add(key);
    const size = p.minSize != null && p.minSize === p.maxSize ? p.minSize : null;
    add(p.portName ?? null, types.length > 0 ? humanizePortType(types[0]) : null, size, installed, types);
  }
  for (const [portName, installed] of carried) {
    if (!seen.has(portName.toLowerCase())) add(portName, null, null, installed, []);
  }
  return out;
}
