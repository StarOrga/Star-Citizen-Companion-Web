import { STEP_KINDS, type StepKind } from '../../../shared/step/sc-step.component';

/** One step as the route graphic reads it. */
export interface RouteGraphStep {
  readonly ord: number;
  readonly kind: StepKind;
  readonly label: string;
  readonly location: string | null;
  readonly system: string | null;
  readonly state: 'todo' | 'done';
}

export const ROUTE_W = 840;
export const ROUTE_H = 400;
const PAD = 14;
const BADGE = 22;
const GAP = 4;

export interface RouteSystemArea {
  readonly name: string;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface RouteBadge {
  readonly kind: StepKind;
  readonly ords: readonly number[];
  readonly x: number;
  readonly y: number;
}

export interface RouteNode {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** All step ords served here, ascending. */
  readonly ords: readonly number[];
  readonly badges: readonly RouteBadge[];
  /** Baselines of the name and of the ord line. */
  readonly nameY: number;
  readonly ordsY: number;
  readonly state: 'todo' | 'cur' | 'done';
  /** True when the node serves no step of a visible kind (it stays as a quiet dot). */
  readonly dim: boolean;
  /** The place name as the steps carry it ('' = an open stop without a place). */
  readonly location: string;
}

export interface RouteLeg {
  readonly d: string;
  readonly jump: boolean;
  readonly done: boolean;
}

export interface RouteLayout {
  readonly systems: readonly RouteSystemArea[];
  readonly nodes: readonly RouteNode[];
  readonly legs: readonly RouteLeg[];
}

/** The kinds of a step list that are actually present, in the fixed legend order. */
export function kindsIn(steps: readonly Pick<{ kind: StepKind }, 'kind'>[]): StepKind[] {
  const present = new Set(steps.map((s) => s.kind));
  return STEP_KINDS.filter((k) => present.has(k));
}

/**
 * Lays an Einsatz out on a schematic map, pure: one ellipse per star system side by side (a Stanton to Pyro
 * route gets two), every distinct place of a system a node on its ellipse in order of first visit, legs between
 * consecutive places (a leg that changes the system is a jump). A step without a place sits at an "open" node of
 * the system the route is in (`openLabel`). `current` is the ord of the next open step (null = none).
 */
export function layoutRoute(
  steps: readonly RouteGraphStep[],
  opts: { hidden?: ReadonlySet<StepKind>; current?: number | null; openLabel?: string; unknownSystem?: string } = {},
): RouteLayout {
  const hidden = opts.hidden ?? new Set<StepKind>();
  const ordered = [...steps].sort((a, b) => a.ord - b.ord);
  if (ordered.length === 0) return { systems: [], nodes: [], legs: [] };
  const openLabel = opts.openLabel ?? '?';
  const unknownSystem = opts.unknownSystem ?? '?';

  // The system of each step: its own, else the one the route was in, else the first one it names.
  const sysOf: string[] = [];
  let last: string | null = null;
  for (const s of ordered) {
    last = s.system?.trim() || last;
    sysOf.push(last ?? '');
  }
  const firstKnown = sysOf.find((x) => x) ?? unknownSystem;
  for (let i = 0; i < sysOf.length; i++) if (!sysOf[i]) sysOf[i] = firstKnown;

  const systemNames: string[] = [];
  for (const n of sysOf) if (!systemNames.includes(n)) systemNames.push(n);
  const slotW = ROUTE_W / systemNames.length;
  const systems: RouteSystemArea[] = systemNames.map((name, i) => ({
    name,
    cx: slotW * (i + 0.5),
    cy: ROUTE_H / 2,
    rx: slotW / 2 - PAD,
    ry: ROUTE_H / 2 - PAD,
  }));

  interface Draft {
    id: string;
    name: string;
    location: string;
    system: string;
    steps: RouteGraphStep[];
  }
  const drafts = new Map<string, Draft>();
  const stepNode: string[] = [];
  ordered.forEach((s, i) => {
    const loc = s.location?.trim() || '';
    const id = `${sysOf[i]}|${loc.toLowerCase()}`;
    let d = drafts.get(id);
    if (!d) {
      d = { id, name: loc || openLabel, location: loc, system: sysOf[i], steps: [] };
      drafts.set(id, d);
    }
    d.steps.push(s);
    stepNode.push(id);
  });

  const nodes: RouteNode[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  for (const sys of systems) {
    const here = [...drafts.values()].filter((d) => d.system === sys.name);
    here.forEach((d, k) => {
      const m = here.length;
      let x = sys.cx;
      let y = sys.cy + sys.ry * 0.5;
      if (m > 1) {
        const th = (3 * Math.PI) / 4 + (2 * Math.PI * k) / m;
        x = sys.cx + Math.cos(th) * sys.rx * 0.72;
        y = sys.cy + Math.sin(th) * sys.ry * 0.6;
      }
      x = Math.round(x);
      y = Math.round(y);
      pos.set(d.id, { x, y });
      const below = y >= sys.cy;
      const visible = new Map<StepKind, number[]>();
      for (const s of d.steps) {
        if (hidden.has(s.kind)) continue;
        visible.set(s.kind, [...(visible.get(s.kind) ?? []), s.ord]);
      }
      const kinds = STEP_KINDS.filter((kd) => visible.has(kd));
      const rowW = kinds.length * BADGE + Math.max(0, kinds.length - 1) * GAP;
      const by = below ? y + 16 : y - 16 - BADGE;
      const badges: RouteBadge[] = kinds.map((kd, bi) => ({
        kind: kd,
        ords: visible.get(kd)!,
        x: Math.round(x - rowW / 2 + bi * (BADGE + GAP)),
        y: by,
      }));
      const ords = d.steps.map((s) => s.ord).sort((a, b) => a - b);
      const allDone = d.steps.every((s) => s.state === 'done');
      const isCur = opts.current != null && ords.includes(opts.current);
      nodes.push({
        id: d.id,
        name: d.name,
        location: d.location,
        system: d.system,
        x,
        y,
        r: d.steps.length > 1 ? 11 : 9,
        ords,
        badges,
        nameY: below ? by + BADGE + 28 : by - 28,
        ordsY: below ? by + BADGE + 14 : by - 14,
        state: isCur ? 'cur' : allDone ? 'done' : 'todo',
        dim: kinds.length === 0,
      });
    });
  }

  const legs: RouteLeg[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = stepNode[i - 1];
    const b = stepNode[i];
    if (a === b) continue;
    const pa = pos.get(a)!;
    const pb = pos.get(b)!;
    const jump = drafts.get(a)!.system !== drafts.get(b)!.system;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const bend = 0.18;
    const cx = Math.round((pa.x + pb.x) / 2 - dy * bend);
    const cy = Math.round((pa.y + pb.y) / 2 + dx * bend);
    legs.push({
      d: jump ? `M${pa.x} ${pa.y} L${pb.x} ${pb.y}` : `M${pa.x} ${pa.y} Q${cx} ${cy} ${pb.x} ${pb.y}`,
      jump,
      done: ordered[i].state === 'done',
    });
  }
  return { systems, nodes, legs };
}
