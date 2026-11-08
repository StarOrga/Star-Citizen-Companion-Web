/*
 * Nachschub model - the pure rules of the path Wunschliste -> Nachschub -> Bestand (concept
 * 20261107-1410-nachschub-hq, docs/concepts/nachschub-hq-ui-spec.md). No I/O, no Angular: every transition
 * is a function from values to values so it can be specced without a backend. The services
 * (`NachschubService`, `WishlistStore`) call these and persist the result.
 *
 * Wording: the thing is a "Nachschub" (plural "Nachschuebe"), never "Paket". Code keeps the neutral
 * table name `hq_supply_packages`; the exported type is `Nachschub`.
 */

import type { HqGatherStop } from '../data/hq-db.types';

/** Active slots per user; further Nachschuebe are archived. */
export const NACHSCHUB_MAX_SLOTS = 7;
/** Name limits: Nachschub = what you get, Einsatz = what you do. */
export const NACHSCHUB_NAME_MAX = 28;
export const EINSATZ_NAME_MAX = 40;
export const WISH_QTY_MAX = 999;

export type NachschubStatus = 'active' | 'archived';
/**
 * normal = craft/buy/collect; event = rewards of an event; sightseeing = an event without reward (src/app/hq/events/event-nachschub.ts);
 * verkauf = "Geld verdienen": an aUEC goal, lines come from the Bestand, progress from the sales the app reports.
 */
export type NachschubType = 'normal' | 'event' | 'sightseeing' | 'verkauf';

/** A Nachschub as the client holds it (`hq_supply_packages`). */
export interface Nachschub {
  readonly id: string;
  readonly name: string;
  readonly status: NachschubStatus;
  /** 1..7 while active, null once archived. */
  readonly slot: number | null;
  /** Inventory quantity per supply line id at planning time. A missing key = no baseline yet. */
  readonly snapshot: Readonly<Record<string, number>>;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  /** Absent = normal. */
  readonly type?: NachschubType;
  /** sc_events.id for type event / sightseeing. */
  readonly eventId?: string | null;
  /** Verkauf only: the aUEC goal. */
  readonly goalAuec?: number | null;
  /** Verkauf only: aUEC earned so far. */
  readonly progressAuec?: number;
}

/** Largest aUEC goal (mirrors the DB check). */
export const SELL_GOAL_MAX = 1_000_000_000_000;

/** A usable aUEC goal (whole aUEC, 1..{@link SELL_GOAL_MAX}), else null. */
export function parseSellGoal(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw.replace(/[\s.,']/g, '')) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= SELL_GOAL_MAX ? Math.round(n) : null;
}

/** Progress of a Verkauf Nachschub: earned, goal, share 0..1 and whether the goal is reached. Null for any other type. */
export function sellProgress(n: Pick<Nachschub, 'type' | 'goalAuec' | 'progressAuec'>): { earned: number; goal: number; share: number; reached: boolean } | null {
  if (n.type !== 'verkauf' || !n.goalAuec || n.goalAuec <= 0) return null;
  const earned = Math.max(0, n.progressAuec ?? 0);
  return { earned, goal: n.goalAuec, share: Math.min(1, earned / n.goalAuec), reached: earned >= n.goalAuec };
}

/**
 * A line the Bestand hands to a Nachschub ("Abholen planen" / "Verkaufen"): one item, the amount, and where it lies.
 * With `stops` it becomes a gather line (several places, route ordered by amount); with one place a gather of one stop.
 */
export interface NachschubLineInput {
  readonly name: string;
  readonly className: string | null;
  /** Amount in `unit`; pieces are whole numbers. */
  readonly amount: number;
  readonly unit: 'pcs' | 'scu';
  /** Where it is picked up, in route order. Empty/absent = a plain line without a place. */
  readonly stops?: readonly HqGatherStop[];
}

/** One wishlist position (any kind; `forClassName` groups material under its blueprint). */
export interface WishPosition {
  readonly kind: string;
  readonly className: string;
  readonly name: string | null;
  readonly qty: number;
  /** Blueprint (or crafted item) this material is wished for; '' / null = wished on its own. */
  readonly forClassName?: string | null;
}

/** Identity of a wishlist position. Material wished for two blueprints is two positions. */
export function positionKey(p: Pick<WishPosition, 'kind' | 'className' | 'forClassName'>): string {
  const base = `${p.kind}:${p.className.toLowerCase()}`;
  const f = (p.forClassName ?? '').trim().toLowerCase();
  return f ? `${base}@${f}` : base;
}

export function clampWishQty(n: number): number {
  return Number.isFinite(n) ? Math.min(WISH_QTY_MAX, Math.max(1, Math.round(n))) : 1;
}

/** What a click on a wish node does: nothing on the list yet -> put 1 on it; already on it -> open the cart (r4 s8-a3). */
export function wishNodeClick(currentQty: number): 'add' | 'openCart' {
  return currentQty > 0 ? 'openCart' : 'add';
}

// ---------------------------------------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------------------------------------

/** Lowest free slot (1..7) among the active Nachschuebe, or null when all are taken. */
export function freeSlot(all: readonly Pick<Nachschub, 'status' | 'slot'>[]): number | null {
  const taken = new Set(all.filter((n) => n.status === 'active' && n.slot !== null).map((n) => n.slot));
  for (let s = 1; s <= NACHSCHUB_MAX_SLOTS; s++) if (!taken.has(s)) return s;
  return null;
}

/** "Neuer Nachschub" is blocked while all slots are active; the reason is an i18n key. */
export function newNachschubBlock(all: readonly Pick<Nachschub, 'status' | 'slot'>[]): string | null {
  return freeSlot(all) === null ? 'hq.nachschub.slotsFull' : null;
}

/** Trim to a name limit on a code-point boundary (no half emoji / surrogate). */
export function clampName(raw: string, max: number): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const cps = Array.from(clean);
  if (cps.length <= max) return clean;
  const cut = cps.slice(0, max);
  // Prefer a word boundary when it keeps most of the text.
  const joined = cut.join('');
  const sp = joined.lastIndexOf(' ');
  return (sp >= Math.floor(max * 0.6) ? joined.slice(0, sp) : joined).replace(/[\s,;:.\-–]+$/u, '');
}

// ---------------------------------------------------------------------------------------------------------
// Wishlist -> Nachschub
// ---------------------------------------------------------------------------------------------------------

/** One pick of the "take from wishlist" step: the position key and how many (undefined = the full quantity). */
export interface WishPick {
  readonly key: string;
  readonly qty?: number;
}

export interface TakeResult {
  /** What goes into the Nachschub (qty = taken). */
  readonly taken: readonly WishPosition[];
  /** What stays on the wishlist (positions fully taken are gone, split ones keep the rest). */
  readonly remaining: readonly WishPosition[];
}

/**
 * Take positions from the wishlist into a Nachschub. Default is the FULL quantity; a smaller `qty` splits
 * (5 of 20: 5 move, 15 stay). A qty above what is wished is capped; unknown keys are ignored. Taking part of a
 * blueprint's material group adapts the blueprint line too (r4 s4a-a3: "2x Gallant" follows) via
 * {@link followBlueprintQty}.
 */
export function takeFromWishlist(wish: readonly WishPosition[], picks: readonly WishPick[]): TakeResult {
  const want = new Map<string, number | undefined>();
  for (const p of picks) want.set(p.key, p.qty);
  const taken: WishPosition[] = [];
  const remaining: WishPosition[] = [];
  for (const w of wish) {
    const k = positionKey(w);
    if (!want.has(k)) {
      remaining.push(w);
      continue;
    }
    const asked = want.get(k);
    const n = asked === undefined ? w.qty : Math.min(w.qty, Math.max(0, Math.round(asked)));
    if (n <= 0) {
      remaining.push(w);
      continue;
    }
    taken.push({ ...w, qty: n });
    if (w.qty - n > 0) remaining.push({ ...w, qty: w.qty - n });
  }
  return { taken, remaining };
}

/**
 * Taking only part of a blueprint's material keeps the blueprint count in step: the blueprint needs as many
 * copies as the largest share of any of its materials that moves ("passt sich auch an"). `shares` are the
 * fractions (0..1] taken per material of that blueprint.
 */
export function followBlueprintQty(blueprintQty: number, shares: readonly number[]): number {
  if (!shares.length) return blueprintQty;
  const max = Math.max(...shares.map((s) => Math.min(1, Math.max(0, s))));
  return Math.max(1, Math.min(blueprintQty, Math.ceil(blueprintQty * max - 1e-9)));
}

/** How much of `add` does not fit on a wish that already holds `have` (a wish tops out at {@link WISH_QTY_MAX}). */
export function wishOverflow(have: number, add: number): number {
  return Math.max(0, Math.round(have) + Math.round(add) - WISH_QTY_MAX);
}

/** Add `qty` to a position (or create it) - the way returned lines "count up" on the wishlist. */
export function addToWishlist(wish: readonly WishPosition[], add: WishPosition): readonly WishPosition[] {
  const k = positionKey(add);
  let hit = false;
  const next = wish.map((w) => {
    if (positionKey(w) !== k) return w;
    hit = true;
    return { ...w, qty: clampWishQty(w.qty + add.qty) };
  });
  return hit ? next : [...next, { ...add, qty: clampWishQty(add.qty) }];
}

// ---------------------------------------------------------------------------------------------------------
// Lines: closing, progress, archive
// ---------------------------------------------------------------------------------------------------------

/** What the rules need to know about one Nachschub line. */
export interface LineState {
  readonly id: string;
  /** How much the line needs (qty, or the exact amount). */
  readonly need: number;
  /** Ticked off by hand. */
  readonly ticked: boolean;
}

export interface LineStatus {
  readonly closed: boolean;
  /** Inventory rise since planning (0 when no baseline yet). */
  readonly rise: number;
  /** The baseline used, or null when there is none yet and the caller must store `current` as one. */
  readonly baseline: number | null;
  /** How the line closed. */
  readonly by: 'tick' | 'inventory' | null;
}

const EPS = 1e-9;

/**
 * A line closes ONLY on an inventory rise against the snapshot taken at planning (manual entry or the SCC-App
 * live signal - both just raise the stock) or by a manual tick. Never by time. For a ship line `current` is the
 * number of copies in the Hangar. A line without a baseline (migrated, or added after planning) reports
 * `baseline: null`: the caller stores `current` as its baseline (see {@link withBaseline}).
 */
export function lineStatus(line: LineState, snapshot: Readonly<Record<string, number>>, current: number, consumed = 0): LineStatus {
  const base = snapshot[line.id];
  const baseline = typeof base === 'number' && Number.isFinite(base) ? base : null;
  // `consumed` = the part of the rise that older lines of the same class already took (see {@link evaluateNachschub}).
  const rise = baseline === null ? 0 : Math.max(0, current - baseline - Math.max(0, consumed));
  if (line.ticked) return { closed: true, rise, baseline, by: 'tick' };
  if (baseline !== null && rise + EPS >= line.need) return { closed: true, rise, baseline, by: 'inventory' };
  return { closed: false, rise, baseline, by: null };
}

/** Snapshot with a baseline for `lineId` (kept if there already is one). */
export function withBaseline(snapshot: Readonly<Record<string, number>>, lineId: string, current: number): Readonly<Record<string, number>> {
  return lineId in snapshot ? snapshot : { ...snapshot, [lineId]: Math.max(0, current) };
}

export function nachschubProgress(statuses: readonly Pick<LineStatus, 'closed'>[]): { done: number; total: number } {
  return { done: statuses.filter((s) => s.closed).length, total: statuses.length };
}

/** A Nachschub with at least one line and every line closed is finished. */
export function isFinished(statuses: readonly Pick<LineStatus, 'closed'>[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s.closed);
}

/** Archive a finished Nachschub: status archived, slot freed (r4 s3-a1: by itself). */
export function archive(n: Nachschub, at: string): Nachschub {
  return { ...n, status: 'archived', slot: null, archivedAt: at };
}

/** Bring an archived Nachschub back if a slot is free; null when all 7 are taken. */
export function reactivate(all: readonly Nachschub[], id: string): Nachschub | null {
  const n = all.find((x) => x.id === id);
  const slot = freeSlot(all);
  return n && slot !== null ? { ...n, status: 'active', slot, archivedAt: null } : null;
}

/** Run the auto-archive over all active Nachschuebe; `finishedIds` come from {@link isFinished} per Nachschub. */
export function autoArchive(all: readonly Nachschub[], finishedIds: ReadonlySet<string>, at: string): readonly Nachschub[] {
  return all.map((n) => (n.status === 'active' && finishedIds.has(n.id) ? archive(n, at) : n));
}

// ---------------------------------------------------------------------------------------------------------
// Emptying / deleting
// ---------------------------------------------------------------------------------------------------------

export interface OpenLine {
  readonly id: string;
  readonly kind: string;
  readonly className: string;
  readonly name: string;
  readonly qty: number;
  readonly forClassName?: string | null;
  readonly closed: boolean;
}

export interface ClearResult {
  /** Ids of the lines that leave the Nachschub (the open ones; closed lines stay as history). */
  readonly removeIds: readonly string[];
  /** Wishlist after the return (unchanged when `backToWishlist` is false). */
  readonly wishlist: readonly WishPosition[];
}

/**
 * "Nachschub leeren": all OPEN lines leave; with `backToWishlist` (default on in the UI) they are counted up on
 * the wishlist, otherwise they are simply dropped.
 */
export function clearNachschub(lines: readonly OpenLine[], wish: readonly WishPosition[], backToWishlist: boolean): ClearResult {
  const open = lines.filter((l) => !l.closed);
  let next = wish;
  if (backToWishlist) {
    for (const l of open) {
      next = addToWishlist(next, { kind: l.kind, className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName });
    }
  }
  return { removeIds: open.map((l) => l.id), wishlist: next };
}

// ---------------------------------------------------------------------------------------------------------
// Owning fulfils the wish (the event claim shrinks the wished reward class with it)
// ---------------------------------------------------------------------------------------------------------

export interface FulfilResult {
  /** New wished quantity (0 = the wish is gone). */
  readonly qty: number;
  /** Quantity before. */
  readonly previous: number;
}

/** `gained` copies landed in Inventar/Hangar: the wished quantity shrinks by them. */
export function fulfilWish(wishedQty: number, gained: number): FulfilResult {
  return { qty: Math.max(0, wishedQty - Math.max(0, Math.round(gained))), previous: wishedQty };
}

// ---------------------------------------------------------------------------------------------------------
// Blueprint material -> wishlist
// ---------------------------------------------------------------------------------------------------------

export interface MaterialNeed {
  readonly className: string;
  readonly name: string;
  /** Amount for ONE blueprint (SCU for raw material, else pieces). */
  readonly perBlueprint: number;
}

/**
 * "Material xN auf die Wunschliste": N crafts of a blueprint put every ingredient on the wishlist, grouped under
 * the blueprint (`forClassName`). Wish quantities are whole numbers, so fractional SCU round UP (a wish of
 * 0.36 SCU x 3 = 1.08 -> 2). Ingredients without a class name are skipped by the caller.
 */
export function blueprintMaterialWishes(blueprintClassName: string, materials: readonly MaterialNeed[], times: number): readonly WishPosition[] {
  const n = clampWishQty(times);
  return materials
    .filter((m) => m.className && m.perBlueprint > 0)
    .map((m) => ({
      kind: 'material',
      className: m.className,
      name: m.name,
      qty: clampWishQty(Math.ceil(m.perBlueprint * n - 1e-9)),
      forClassName: blueprintClassName,
    }));
}

// ---------------------------------------------------------------------------------------------------------
// Evaluating a whole Nachschub
// ---------------------------------------------------------------------------------------------------------

export interface EvalLine extends LineState {
  /** Ship lines count copies in the Hangar, everything else the Inventar quantity of the class. */
  readonly ship: boolean;
  readonly className: string | null;
}

export interface Evaluation {
  readonly statuses: ReadonlyMap<string, LineStatus>;
  /** The snapshot with baselines added for lines that had none (persist when `snapshotChanged`). */
  readonly snapshot: Readonly<Record<string, number>>;
  readonly snapshotChanged: boolean;
  /** Lines that just closed on an inventory rise and are not ticked yet: the caller ticks them. */
  readonly closeIds: readonly string[];
  readonly progress: { done: number; total: number };
  readonly finished: boolean;
}

/**
 * Rise already handed to lines of a class during one evaluation pass, keyed by {@link riseKey}. One pool is shared
 * across all active Nachschuebe (oldest first) so a single stock gain closes ONE line of a class, not every line
 * that happens to ask for the same thing (H4).
 */
export type RisePool = Map<string, (readonly [number, number])[]>;

/**
 * Stock levels in (`lo`, `hi`] that no older line claimed yet; claims the lowest `want` of them into `claimed`.
 * Units are stock LEVELS, so a line counts only what rose above its own baseline: an older line's claim below that
 * baseline (stock that was already there at planning) never eats into a newer line's rise.
 */
function claimFree(claimed: (readonly [number, number])[], lo: number, hi: number, want: number): number {
  if (hi <= lo + EPS) return 0;
  const parts = claimed.filter(([a, b]) => b > lo && a < hi).sort((x, y) => x[0] - y[0]);
  const gaps: [number, number][] = [];
  let at = lo;
  for (const [a, b] of parts) {
    if (a > at + EPS) gaps.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
    if (at >= hi) break;
  }
  if (at < hi - EPS) gaps.push([at, hi]);
  const free = gaps.reduce((n, [a, b]) => n + (b - a), 0);
  let left = Math.max(0, Math.min(want, free));
  for (const [a, b] of gaps) {
    if (left <= EPS) break;
    const take = Math.min(left, b - a);
    claimed.push([a, a + take]);
    left -= take;
  }
  return free;
}

export function riseKey(l: Pick<EvalLine, 'ship' | 'className'>): string | null {
  const c = (l.className ?? '').trim().toLowerCase();
  return c ? `${l.ship ? 's' : 'i'}:${c}` : null;
}

/**
 * One pass over a Nachschub: status per line, baselines, which lines close by inventory, and whether it is done.
 * `owned(line)` is the current Inventar quantity (or Hangar copies for a ship line).
 *
 * Baseline rules:
 *  - a missing baseline (migrated or later added line) is filled from the CURRENT stock: the line counts from now;
 *  - a baseline above the current stock is LOWERED to it (M1): the stock fell (used up, row deleted), so a later
 *    purchase must raise it from the new low, otherwise the line could never close again.
 * Sharing (H4): with a `pool`, every line of a class sees only the stock levels above its own baseline that no older
 * line claimed, then claims the lowest `min(need, free)` of them - open or closed alike, so a closed line keeps its
 * share on the next pass, and what an older line counted below a newer line's baseline never blocks the newer one. Lines are
 * handled in the order given; the caller passes the Nachschuebe oldest first.
 */
export function evaluateNachschub(
  lines: readonly EvalLine[],
  snapshot: Readonly<Record<string, number>>,
  owned: (line: EvalLine) => number,
  pool?: RisePool,
): Evaluation {
  let snap = snapshot;
  const statuses = new Map<string, LineStatus>();
  const closeIds: string[] = [];
  for (const l of lines) {
    const current = Math.max(0, owned(l));
    const have = snap[l.id];
    if (typeof have !== 'number' || !Number.isFinite(have)) snap = withBaseline(snap, l.id, current);
    else if (current < have) snap = { ...snap, [l.id]: current };
    const key = pool ? riseKey(l) : null;
    let used = 0;
    if (key && pool) {
      const claimed = pool.get(key) ?? [];
      pool.set(key, claimed);
      const base = snap[l.id] ?? current;
      used = Math.max(0, current - base - claimFree(claimed, base, current, l.need));
    }
    const st = lineStatus(l, snap, current, used);
    if (st.closed && st.by === 'inventory') closeIds.push(l.id);
    statuses.set(l.id, st);
  }
  const list = [...statuses.values()];
  return { statuses, snapshot: snap, snapshotChanged: snap !== snapshot, closeIds, progress: nachschubProgress(list), finished: isFinished(list) };
}

// ---------------------------------------------------------------------------------------------------------
// Edge rules
// ---------------------------------------------------------------------------------------------------------

/**
 * The catalogue never deletes player rows: an item missing from the current build is only flagged
 * ("nicht mehr im Spiel"), its wish / stock / Nachschub line stays.
 */
export function gameStatus(className: string, catalogue: ReadonlySet<string>): 'inGame' | 'notInGame' {
  return catalogue.has(className) ? 'inGame' : 'notInGame';
}

/** An announced ship wish (keyed by its folded name) that the catalogue now carries, to be turned into a live wish. */
export interface AnnouncedFollow {
  readonly foldedName: string;
  readonly shipClassName: string;
}

/**
 * An announced ship's wish follows it live: when the catalogue gets a ship whose folded name equals the wish key,
 * the wish becomes a normal ship wish (class name known). `catalogShips` maps folded name -> class name.
 */
export function followAnnounced(wishedAnnouncedFolded: readonly string[], catalogShips: ReadonlyMap<string, string>): readonly AnnouncedFollow[] {
  const out: AnnouncedFollow[] = [];
  for (const f of wishedAnnouncedFolded) {
    const cls = catalogShips.get(f);
    if (cls) out.push({ foldedName: f, shipClassName: cls });
  }
  return out;
}

/** What "Ingame-Bestand zuruecksetzen" (wipe) removes: everything the game wrote, never what the player typed. */
export function ingameSources(): readonly string[] {
  return ['log', 'search', 'community', 'ocr'];
}

/** A second copy of a ship is allowed: the count of the one hangar row goes up. */
export function nextShipCopies(current: number | undefined): number {
  return Math.min(WISH_QTY_MAX, Math.max(1, Math.round(current ?? 1)) + 1);
}
