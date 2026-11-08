import { moveStop, orderByAmount } from '../data/hq-gather';
import type { Nachschub, NachschubLineInput } from './nachschub.model';
import type { NachschubTargetIntent } from './nachschub-target-picker';

/**
 * The existing Nachschübe a Bestand selection may be added to: active ones only. A sale goes into a Verkauf, a
 * pick-up or purchase into a normal Nachschub (event / sightseeing ones have their own lines and never take Bestand
 * lines). No stop merging across Nachschübe: each target keeps its own route (R3 q-route = none).
 */
export function targetsFor(intent: NachschubTargetIntent, all: readonly Nachschub[]): Nachschub[] {
  return all
    .filter((n) => n.status === 'active')
    .filter((n) => (intent === 'sell' ? n.type === 'verkauf' : !n.type || n.type === 'normal'))
    .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
}

/** Gather lines start in route order: the place with the most first. Lines without stops stay as they are. */
export function routeOrdered(lines: readonly NachschubLineInput[]): NachschubLineInput[] {
  return lines.map((l) => (l.stops?.length ? { ...l, stops: orderByAmount(l.stops) } : l));
}

/** Moves one stop of one line (the player reorders the route); other lines are untouched. */
export function moveLineStop(lines: readonly NachschubLineInput[], line: number, from: number, to: number): NachschubLineInput[] {
  return lines.map((l, i) => (i === line && l.stops ? { ...l, stops: moveStop(l.stops, from, to) } : l));
}
