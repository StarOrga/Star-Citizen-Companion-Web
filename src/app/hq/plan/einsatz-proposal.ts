import type { StepKind } from '../../shared/step/sc-step.component';
import type { MapNeed, MapPlace } from './map/hq-map.types';
import { buildRoute } from './map/hq-route';

/**
 * Step 3 of "Neuer Nachschub": from what the Nachschub holds to proposed Einsaetze (concept round 4, s4c). Pure and
 * deterministic. The Einsatz is the primary structure ("was tue ich"), the goods are the chips behind it.
 *
 *   mission  Blaupausen are won on missions
 *   buy      everything bought, ordered along the route (nearest first inside a star system)
 *   mine     material the reader mines instead of buying (+ a refine step each)
 *   craft    ALWAYS last: crafting the blueprint's item is itself an Einsatz
 *
 * Material is NOT grouped by blueprint here (you need Aluminium from one place); the blueprint is only mentioned
 * in `purpose`. The reader can switch a material line between buy and mine, or split it (5 buy, 3 mine); any other
 * line is bought (a merchant is known) or crafted (a blueprint is known), changeable per line (W5.4). A line to buy
 * without a known place makes no step (W5.5, `unplacedLines`).
 */

export type EinsatzRole = 'mission' | 'buy' | 'mine' | 'craft' | 'event';
export const EINSATZ_ROLES: readonly EinsatzRole[] = ['mission', 'buy', 'mine', 'craft', 'event'];

/** One thing the Nachschub holds, as the proposal reads it. */
export interface ProposalLine {
  /** Stable key (the wishlist position key). */
  readonly key: string;
  readonly name: string;
  readonly className: string | null;
  /** Wishlist kind: blueprint | ship | item | material ... */
  readonly kind: string;
  readonly qty: number;
  /** Blueprint (or crafted item) a material is for; '' / null = on its own. */
  readonly forClassName: string | null;
  readonly forName: string | null;
  /** A blueprint that makes this item is known (Codex recipe lookup); only then can the line be crafted. */
  readonly craftable?: boolean;
  /** Running events whose reward IS this line (exact class); only then the fourth way "Event" exists. */
  readonly eventIds?: readonly string[];
  /**
   * Set on a line the proposal made itself for a line the reader chose to craft (its missing blueprint or a missing
   * ingredient): the key of that crafted line. Such a line is planned like any other, but it is not a wishlist position.
   */
  readonly derivedFor?: string;
}

/** What crafting one item takes, from the Codex recipe. */
export interface CraftRecipe {
  readonly blueprintClassName: string;
  readonly blueprintName: string;
  /** Per crafted piece. */
  readonly ingredients: readonly { readonly className: string; readonly name: string; readonly qty: number }[];
}

/** One ingredient of a crafted line against the stock: what the whole line needs, what is there, what is missing. */
export interface CraftIngredientCheck {
  readonly className: string;
  readonly name: string;
  readonly need: number;
  readonly have: number;
  readonly missing: number;
}

/** Whether a line to craft can be crafted from what the reader has, and what the Nachschub still has to plan. */
export interface CraftCheck {
  readonly blueprintClassName: string;
  readonly blueprintName: string;
  /** The blueprint is in the Sammlung (written by hand or by the companion app's `blueprint.received`). */
  readonly blueprintOwned: boolean;
  readonly ingredients: readonly CraftIngredientCheck[];
}

/** Units are whole pieces or SCU; float noise from the stock sums is trimmed before rounding a shortfall up. */
const ceilQty = (n: number): number => Math.ceil(Math.round(n * 1e6) / 1e6);

/**
 * Check a line the reader wants to craft against the Sammlung (blueprint) and the Inventar (ingredients). Ingredient
 * needs are per crafted piece times the line's quantity. Each crafted line is checked on its own: two lines sharing an
 * ingredient both count the same stock (the shortfall is a plan, not a reservation).
 */
export function craftCheck(
  l: Pick<ProposalLine, 'qty'>,
  recipe: CraftRecipe,
  have: { blueprint(className: string): boolean; stock(className: string): number },
): CraftCheck {
  const byClass = new Map<string, { className: string; name: string; qty: number }>();
  for (const i of recipe.ingredients) {
    if (!i.className || !(i.qty > 0)) continue;
    const k = i.className.toLowerCase();
    const cur = byClass.get(k);
    byClass.set(k, { className: i.className, name: cur?.name ?? i.name, qty: (cur?.qty ?? 0) + i.qty });
  }
  const ingredients = [...byClass.values()].map((i) => {
    const need = ceilQty(i.qty * l.qty);
    const stock = Math.max(0, have.stock(i.className));
    return { className: i.className, name: i.name, need, have: stock, missing: Math.max(0, ceilQty(need - stock)) };
  });
  return {
    blueprintClassName: recipe.blueprintClassName,
    blueprintName: recipe.blueprintName,
    blueprintOwned: have.blueprint(recipe.blueprintClassName),
    ingredients,
  };
}

/**
 * The lines a crafted line adds to the plan: its blueprint when the reader does not have it (a mission line), and each
 * missing ingredient (a material line "for" the crafted item, bought or mined like any other material).
 */
export function craftDerivedLines(l: ProposalLine, check: CraftCheck): ProposalLine[] {
  const out: ProposalLine[] = [];
  if (!check.blueprintOwned && check.blueprintClassName) {
    out.push({
      key: `craft:${l.key}:bp`,
      name: check.blueprintName,
      className: check.blueprintClassName,
      kind: 'blueprint',
      qty: 1,
      forClassName: null,
      forName: null,
      derivedFor: l.key,
    });
  }
  for (const i of check.ingredients) {
    if (i.missing <= 0) continue;
    out.push({
      key: `craft:${l.key}:${i.className.toLowerCase()}`,
      name: i.name,
      className: i.className,
      kind: 'material',
      qty: i.missing,
      forClassName: l.className,
      forName: l.name,
      derivedFor: l.key,
    });
  }
  return out;
}

/** How a line is met: bought at a merchant, crafted from its blueprint, or gathered (mined) as material. */
export type LineMode = 'buy' | 'craft' | 'mine' | 'event';

/** How a material line is met: `buy` + `mine` = its quantity. */
export interface LineSplit {
  readonly buy: number;
  readonly mine: number;
}

export interface DraftStep {
  readonly kind: StepKind;
  readonly label: string;
  readonly location: string | null;
  readonly system: string | null;
  readonly className: string | null;
  readonly qty: number | null;
  /** The ProposalLine this step serves (resolved to a supply line id when the Nachschub is saved). */
  readonly lineKey: string | null;
  readonly missionRef: string | null;
}

export interface DraftGood {
  readonly name: string;
  readonly qty: number;
  /** Blueprint purposes ("fuer Gallant, P4-AR"), mentioned but never grouped. */
  readonly purpose: string | null;
}

export interface DraftEinsatz {
  readonly role: EinsatzRole;
  readonly steps: readonly DraftStep[];
  readonly goods: readonly DraftGood[];
}

export function isBlueprintLine(l: Pick<ProposalLine, 'kind'>): boolean {
  return l.kind === 'blueprint';
}

/** A material that can be mined instead of bought: it is wished for a blueprint, or is raw material itself. */
export function isMaterialLine(l: Pick<ProposalLine, 'kind' | 'forClassName'>): boolean {
  return !!(l.forClassName ?? '').trim() || l.kind === 'material';
}

/**
 * Default split: material goes to buy when a shop is known, else to mine; everything that is not material is
 * bought (blueprints are not: they come from missions and are not split).
 */
export function defaultSplit(l: ProposalLine, hasShop: boolean): LineSplit {
  if (isBlueprintLine(l)) return { buy: 0, mine: 0 };
  if (isMaterialLine(l) && !hasShop) return { buy: 0, mine: l.qty };
  return { buy: l.qty, mine: 0 };
}

/** Keep a split valid: both parts are whole numbers >= 0 and sum to the quantity (the buy part wins). */
export function normalizeSplit(l: ProposalLine, s: LineSplit): LineSplit {
  if (isBlueprintLine(l)) return { buy: 0, mine: 0 };
  if (!isMaterialLine(l)) return { buy: l.qty, mine: 0 };
  const buy = Math.min(l.qty, Math.max(0, Math.round(s.buy)));
  return { buy, mine: l.qty - buy };
}

/** Switch a line wholly to buy or wholly to mine (the toggle). */
export function toggleMethod(l: ProposalLine, s: LineSplit): LineSplit {
  return normalizeSplit(l, s.buy >= l.qty ? { buy: 0, mine: l.qty } : { buy: l.qty, mine: 0 });
}

/** Move the split with a stepper: `buy` units are bought, the rest mined. */
export function setBuyPart(l: ProposalLine, buy: number): LineSplit {
  return normalizeSplit(l, { buy, mine: l.qty - buy });
}

export interface ProposalCtx {
  /** Where a line can be bought (nearest/cheapest shop, or the place the reader set), null = no place known. */
  placeOf(l: ProposalLine): MapPlace | null;
  /** The reader's split choice per material line key; absent = the default. */
  split?: ReadonlyMap<string, LineSplit>;
  /** The reader's choice per non-material line key (buy / craft); absent or not available = the default. */
  mode?: ReadonlyMap<string, LineMode>;
  /** Lines the reader took out of the Einsatz: no step is made for them. */
  excluded?: ReadonlySet<string>;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * The ways a non-material, non-blueprint line can be met, given what is known: buy only with a place (a merchant),
 * craft only with a known blueprint. Materials are not here: they switch/split between buy and mine.
 */
export function availableModes(l: ProposalLine, hasPlace: boolean): LineMode[] {
  if (isBlueprintLine(l) || isMaterialLine(l)) return [];
  const out: LineMode[] = [];
  if (hasPlace) out.push('buy');
  if (l.craftable) out.push('craft');
  if (l.eventIds?.length) out.push('event');
  return out;
}

/** The mode a non-material line stands on: the reader's choice if still available, else buy, else craft, else none. */
export function modeOf(l: ProposalLine, ctx: ProposalCtx): LineMode | null {
  const avail = availableModes(l, ctx.placeOf(l) !== null);
  const chosen = ctx.mode?.get(l.key);
  if (chosen && avail.includes(chosen)) return chosen;
  return avail[0] ?? null;
}

/** How many pieces of a line are bought / mined. Blueprints are neither (missions), a placeless line buys nothing. */
function partsOf(l: ProposalLine, ctx: ProposalCtx): LineSplit {
  if (isBlueprintLine(l)) return { buy: 0, mine: 0 };
  if (isMaterialLine(l)) return normalizeSplit(l, ctx.split?.get(l.key) ?? defaultSplit(l, ctx.placeOf(l) !== null));
  return { buy: modeOf(l, ctx) === 'buy' ? l.qty : 0, mine: 0 };
}

/**
 * Lines that would be bought but have no place: they get no step (a placeless buy step is a step nobody can do) and
 * wait for the reader to open the Codex, set a place, or take the line out. Blueprints and crafted lines never wait.
 */
export function unplacedLines(lines: readonly ProposalLine[], ctx: ProposalCtx): ProposalLine[] {
  return lines.filter((l) => {
    if (ctx.excluded?.has(l.key) || isBlueprintLine(l) || ctx.placeOf(l) !== null) return false;
    if (isMaterialLine(l)) return partsOf(l, ctx).buy > 0;
    return modeOf(l, ctx) === null;
  });
}

/** The proposed Einsaetze, in the order they are done; empty roles are left out. */
export function proposeEinsaetze(all: readonly ProposalLine[], ctx: ProposalCtx): DraftEinsatz[] {
  const out: DraftEinsatz[] = [];
  const lines = all.filter((l) => !ctx.excluded?.has(l.key));

  // Missions: one per blueprint line.
  const bps = lines.filter(isBlueprintLine);
  if (bps.length) {
    out.push({
      role: 'mission',
      steps: bps.map((l) => ({
        kind: 'mission',
        label: l.name,
        location: null,
        system: null,
        className: l.className,
        qty: l.qty,
        lineKey: l.key,
        missionRef: l.className,
      })),
      goods: bps.map((l) => ({ name: l.name, qty: l.qty, purpose: null })),
    });
  }

  // Buying: only what has a place, ordered along the route.
  const buys = lines.filter((l) => partsOf(l, ctx).buy > 0 && ctx.placeOf(l) !== null);
  if (buys.length) {
    const byKey = new Map(buys.map((l) => [l.key, l] as const));
    const needs: MapNeed[] = buys.map((l) => ({ id: l.key, label: l.name, kind: 'buy' as const, qty: partsOf(l, ctx).buy, status: 'open' as const, colorKey: 'n', place: ctx.placeOf(l)! }));
    const ordered: ProposalLine[] = [];
    const placeByKey = new Map<string, MapPlace>();
    for (const stop of buildRoute(needs, null)) {
      for (const id of stop.needIds) {
        const l = byKey.get(id);
        if (l) {
          ordered.push(l);
          placeByKey.set(id, stop.place);
        }
      }
    }
    out.push({
      role: 'buy',
      steps: ordered.map((l) => {
        const place = placeByKey.get(l.key)!;
        return {
          kind: 'buy' as const,
          label: l.name,
          location: place.location,
          system: place.system,
          className: l.className,
          qty: partsOf(l, ctx).buy,
          lineKey: l.key,
          missionRef: null,
        };
      }),
      goods: ordered.map((l) => ({ name: l.name, qty: partsOf(l, ctx).buy, purpose: purposeOf(l) })),
    });
  }

  // Mining (gathering), each followed by refining it.
  const mines = lines.filter((l) => partsOf(l, ctx).mine > 0);
  if (mines.length) {
    const steps: DraftStep[] = [];
    for (const l of mines) {
      steps.push({ kind: 'mine', label: l.name, location: null, system: null, className: l.className, qty: partsOf(l, ctx).mine, lineKey: l.key, missionRef: null });
    }
    for (const l of mines) {
      steps.push({ kind: 'refine', label: l.name, location: null, system: null, className: l.className, qty: partsOf(l, ctx).mine, lineKey: l.key, missionRef: null });
    }
    out.push({ role: 'mine', steps, goods: mines.map((l) => ({ name: l.name, qty: partsOf(l, ctx).mine, purpose: purposeOf(l) })) });
  }

  // Crafting is the last Einsatz: one step per blueprint / crafted item the materials are for.
  const crafted = new Map<string, { name: string; className: string; qty: number; lineKey: string | null }>();
  // A line the reader chose to craft (its blueprint is known) is itself a craft step, tied to that line; its own
  // missing material (derived lines "for" it) adds no second step.
  for (const l of lines) {
    const c = (l.className ?? '').toLowerCase();
    if (c && modeOf(l, ctx) === 'craft' && !crafted.has(c)) crafted.set(c, { name: l.name, className: l.className ?? '', qty: l.qty, lineKey: l.key });
  }
  for (const l of lines) {
    const target = (l.forClassName ?? '').trim();
    if (!target || crafted.has(target.toLowerCase())) continue;
    const times = bps.find((b) => (b.className ?? '').toLowerCase() === target.toLowerCase())?.qty ?? 1;
    crafted.set(target.toLowerCase(), { name: l.forName?.trim() || target, className: target, qty: times, lineKey: null });
  }
  for (const b of bps) {
    // A blueprint without material on the Nachschub is still crafted once you have it; a blueprint the proposal added
    // for a crafted line is that line's craft step already.
    const c = (b.className ?? '').toLowerCase();
    if (c && !b.derivedFor && !crafted.has(c)) crafted.set(c, { name: b.name, className: b.className ?? '', qty: b.qty, lineKey: null });
  }
  if (crafted.size) {
    const steps: DraftStep[] = [...crafted.values()].map((c) => ({
      kind: 'craft' as const,
      label: c.name,
      location: null,
      system: null,
      className: c.className,
      qty: c.qty,
      lineKey: c.lineKey,
      missionRef: null,
    }));
    out.push({ role: 'craft', steps, goods: steps.map((s) => ({ name: s.label, qty: s.qty ?? 1, purpose: null })) });
  }
  return out;
}

function purposeOf(l: ProposalLine): string | null {
  return (l.forClassName ?? '').trim() ? (l.forName?.trim() || l.forClassName!.trim()) : null;
}

/** Counts shown in the header of step 3: Einsaetze and steps in total. */
export function proposalCounts(drafts: readonly DraftEinsatz[]): { einsaetze: number; steps: number } {
  return { einsaetze: drafts.length, steps: sum(drafts.map((d) => d.steps.length)) };
}

/** "fuer Gallant, P4-AR": the distinct purposes of an Einsatz' goods, mentioned (not grouped). */
export function purposesOf(d: DraftEinsatz): string[] {
  return [...new Set(d.goods.map((g) => g.purpose).filter((p): p is string => !!p))];
}
