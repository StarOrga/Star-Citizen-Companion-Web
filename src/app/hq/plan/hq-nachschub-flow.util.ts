import { type WishPosition, followBlueprintQty, positionKey } from '../nachschub/nachschub.model';

/** One wishlist row of step 1 with its key. */
export interface FlowRow extends WishPosition {
  readonly key: string;
}

export type FlowGroupId = 'ships' | 'items' | 'materials' | 'blueprint' | 'weapons' | 'armor' | 'components';

export interface FlowGroup {
  /** `ships` | `items` | `materials` | `bp:<className>` (the cart also: `weapons` | `armor` | `components`) */
  readonly id: string;
  readonly type: FlowGroupId;
  /** i18n key of the group title (not for blueprint groups). */
  readonly titleKey: string | null;
  /** Blueprint (or crafted item) name for a blueprint group. */
  readonly title: string | null;
  readonly rows: readonly FlowRow[];
  /** The blueprint row of a blueprint group, when the blueprint itself is wished. */
  readonly blueprint: FlowRow | null;
}

const SHIP_KINDS = new Set(['ship', 'vehicle']);

/**
 * The wishlist grouped as the cart groups it (round 3/4): ships, items, loose material, and one group per
 * blueprint (the blueprint with the material wished for it, even when the blueprint itself is not on the list).
 * Blueprint groups come last.
 */
export function groupWish(wish: readonly WishPosition[]): FlowGroup[] {
  const rows: FlowRow[] = wish.map((w) => ({ ...w, key: positionKey(w) }));
  const forKey = (w: WishPosition): string => (w.forClassName ?? '').trim().toLowerCase();
  const bpRows = rows.filter((r) => r.kind === 'blueprint');
  const bpIds = new Set(bpRows.map((r) => r.className.toLowerCase()));
  const groups: FlowGroup[] = [];
  const ships = rows.filter((r) => SHIP_KINDS.has(r.kind));
  const items = rows.filter((r) => !SHIP_KINDS.has(r.kind) && r.kind !== 'blueprint' && r.kind !== 'material' && !forKey(r));
  const loose = rows.filter((r) => !SHIP_KINDS.has(r.kind) && r.kind !== 'blueprint' && !forKey(r) && r.kind === 'material');
  if (ships.length) groups.push({ id: 'ships', type: 'ships', titleKey: 'hq.flow.group.ships', title: null, rows: ships, blueprint: null });
  if (items.length) groups.push({ id: 'items', type: 'items', titleKey: 'hq.flow.group.items', title: null, rows: items, blueprint: null });
  if (loose.length) groups.push({ id: 'materials', type: 'materials', titleKey: 'hq.flow.group.materials', title: null, rows: loose, blueprint: null });

  const targets: string[] = [];
  for (const r of bpRows) targets.push(r.className.toLowerCase());
  for (const r of rows) {
    const f = forKey(r);
    if (f && !targets.includes(f)) targets.push(f);
  }
  for (const t of targets) {
    const bp = bpRows.find((r) => r.className.toLowerCase() === t) ?? null;
    const mats = rows.filter((r) => forKey(r) === t && !(bp && r.key === bp.key));
    const members = bp ? [bp, ...mats] : mats;
    const name = bp?.name?.trim() || mats[0]?.forClassName?.trim() || t;
    groups.push({ id: `bp:${t}`, type: 'blueprint', titleKey: null, title: name, rows: members, blueprint: bpIds.has(t) ? bp : null });
  }
  return groups;
}

/** Checkbox state of a set of rows: how much of them is picked (0 none, 1 all, between = mixed). */
export function pickedShare(rows: readonly FlowRow[], picks: ReadonlyMap<string, number>): number {
  if (!rows.length) return 0;
  const full = rows.filter((r) => (picks.get(r.key) ?? 0) >= r.qty).length;
  const any = rows.filter((r) => (picks.get(r.key) ?? 0) > 0).length;
  return full === rows.length ? 1 : any > 0 ? 0.5 : 0;
}

/**
 * Set one row's picked quantity and let the blueprint of its group follow (r4 s4a-a3: taking only part of the
 * material makes "2x Gallant" adapt). Returns a new picks map. A quantity of 0 un-picks the row.
 */
export function setPicked(
  group: FlowGroup,
  picks: ReadonlyMap<string, number>,
  key: string,
  qty: number,
): Map<string, number> {
  const next = new Map(picks);
  const row = group.rows.find((r) => r.key === key);
  if (!row) return next;
  const n = Math.min(row.qty, Math.max(0, Math.round(qty)));
  if (n <= 0) next.delete(key);
  else next.set(key, n);
  const bp = group.blueprint;
  if (bp && key !== bp.key) {
    const shares = group.rows.filter((r) => r.key !== bp.key && (next.get(r.key) ?? 0) > 0).map((r) => (next.get(r.key) ?? 0) / r.qty);
    if (shares.length) next.set(bp.key, followBlueprintQty(bp.qty, shares));
    else next.delete(bp.key);
  }
  return next;
}

/** Pick (or un-pick) a whole group at full quantity. */
export function toggleGroup(group: FlowGroup, picks: ReadonlyMap<string, number>): Map<string, number> {
  const next = new Map(picks);
  const all = pickedShare(group.rows, picks) === 1;
  for (const r of group.rows) {
    if (all) next.delete(r.key);
    else next.set(r.key, r.qty);
  }
  return next;
}

export function pickedPieces(picks: ReadonlyMap<string, number>): number {
  let n = 0;
  for (const q of picks.values()) n += q;
  return n;
}
