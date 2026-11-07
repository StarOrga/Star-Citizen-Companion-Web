// Ship signature MODEL (#967) — our own estimate, never a game value.
//
// The game files carry no ship-level idle or maximum EM/IR. They carry one
// signature per component state: `<state>.em.nominal` / `<state>.ir.nominal`.
// Checked against the raw LIVE 4.10.2 extract and the StarCitizenWiki item
// pages, that nominal is the emission at FULL allocation:
//   * Ecouter radar: consumeSegments 5, minFraction 0.4, em.nominal 1800 —
//     the wiki lists 720–1,800 over 2–5 segments (360 per segment).
//   * Maelstrom power plant: generateSegments 20, em.nominal 9900 — wiki
//     0–9,900 at 495 per segment.
// So a component emits `nominal × assigned / segments`, and an item with
// minFraction 1 (quantum drives) or no segment draw emits its nominal flat.
// `powerRanges.<band>.modifier` (0.7 / 0.85 / 1 on consumers, 1 on reactors)
// is NOT applied: the wiki's per-segment figures are linear, so the modifier
// reads as a performance curve, not an emission one.
//
// Formula
//   item EM  = em.nominal × s / S        (S = full segments, s = assigned)
//   reactor  = Σ reactor em.nominal × min(load, capacity) / capacity
//              (load = Σ assigned consumer segments — EM follows consumed power)
//   IR       = Σ ir.nominal × s / S      (only coolers carry IR in the data)
//   ship     = (Σ item EM + reactor EM) × hull armor EM factor (IR alike)
// Scenarios
// Thrusters are left out (their EM follows throttle, not power allocation).
// The reactor load is capped at its capacity: an allocation cannot draw more.
//   idle    — every consumer and cooler at its minimum (⌈S × minFraction⌉),
//             shields and quantum drive off
//   max     — every consumer, cooler and shield at S, quantum drive off
//   quantum — like max, but the shield off and the quantum drive on (the
//             wiki's exclusive "Quantum" scenario)
// `decayRate` (0.15 everywhere) is a transient after a change, not part of
// the steady-state value, and is ignored.

/** `thruster` is carried but never counted: a thruster draws no segment in the
 * data and emits with throttle, which no allocation describes (the wiki leaves
 * them out as well). */
export type EmModelRole = 'powerPlant' | 'shield' | 'quantum' | 'cooler' | 'consumer' | 'thruster';

export type EmModelScenario = 'idle' | 'max' | 'quantum';

export interface EmModelItem {
  role: EmModelRole;
  /** full consumed segments at maximum allocation, count already folded in. */
  segments: number;
  /** minimumConsumptionFraction, 0..1. */
  minFraction: number;
  /** generated segments (reactors), count folded in. */
  generateSegments: number;
  /** em.nominal × count — the value at FULL allocation. */
  em: number;
  /** ir.nominal × count — the value at FULL allocation. */
  ir: number;
}

export interface EmModelResult {
  em: number;
  ir: number;
  /** consumed segments in this scenario (what the reactor has to deliver). */
  load: number;
  /** generated segments available. */
  capacity: number;
}

/** ⌈S × minFraction⌉ with the extractor's float noise (0.4000000059…) removed. */
export function minimumSegments(segments: number, minFraction: number): number {
  if (segments <= 0) return 0;
  if (minFraction >= 1) return segments;
  return Math.max(0, Math.ceil(segments * minFraction - (5e-5 * segments + 1e-9)));
}

/** An emission at `assigned` of `segments`: linear, flat when there is no draw or the item cannot throttle. */
export function scaledSignature(nominal: number, segments: number, assigned: number, minFraction = 0): number {
  if (segments <= 0 || minFraction >= 1) return assigned > 0 || segments <= 0 ? nominal : 0;
  return (nominal * Math.min(assigned, segments)) / segments;
}

function assignedSegments(item: EmModelItem, scenario: EmModelScenario): number | null {
  switch (item.role) {
    case 'shield':
      return scenario === 'max' ? item.segments : null;
    case 'quantum':
      return scenario === 'quantum' ? item.segments : null;
    case 'cooler':
    case 'consumer':
      return scenario === 'idle' ? minimumSegments(item.segments, item.minFraction) : item.segments;
    default:
      return null;
  }
}

export function emModel(
  items: readonly EmModelItem[],
  scenario: EmModelScenario,
  armor: { em: number; ir: number } | null = null,
): EmModelResult {
  let em = 0;
  let ir = 0;
  let load = 0;
  for (const item of items) {
    if (item.role === 'powerPlant') continue;
    const s = assignedSegments(item, scenario);
    if (s === null) continue; // switched off in this scenario
    load += s;
    em += scaledSignature(item.em, item.segments, s, item.minFraction);
    ir += scaledSignature(item.ir, item.segments, s, item.minFraction);
  }
  const plants = items.filter((i) => i.role === 'powerPlant');
  const capacity = plants.reduce((sum, p) => sum + p.generateSegments, 0);
  if (capacity > 0) {
    const share = Math.min(load, capacity) / capacity;
    for (const p of plants) {
      em += p.em * share;
      ir += p.ir * share;
    }
  }
  const r = (v: number) => Math.round(v);
  return { em: r(em * (armor?.em ?? 1)), ir: r(ir * (armor?.ir ?? 1)), load, capacity };
}
