import { EINSATZ_NAME_MAX, NACHSCHUB_NAME_MAX, clampName } from './nachschub.model';

export interface NameItem {
  readonly name: string;
  readonly qty: number;
}

/**
 * Rule-based Nachschub name (what you GET), used when the AI function is off, slow or fails. One item: its name;
 * two: "A + B"; more: "A, B +N". Quantities do not show in a name. Always within {@link NACHSCHUB_NAME_MAX}.
 * Never labelled as generated.
 */
export function fallbackNachschubName(items: readonly NameItem[], defaultName: string): string {
  const names = items.filter((i) => i.name.trim()).sort((a, b) => b.qty - a.qty).map((i) => i.name.trim());
  if (!names.length) return clampName(defaultName, NACHSCHUB_NAME_MAX);
  if (names.length === 1) return clampName(names[0], NACHSCHUB_NAME_MAX);
  if (names.length === 2) return clampName(`${names[0]} + ${names[1]}`, NACHSCHUB_NAME_MAX);
  const rest = names.length - 2;
  const suffix = ` +${rest}`;
  const head = clampName(`${names[0]}, ${names[1]}`, NACHSCHUB_NAME_MAX - suffix.length);
  return `${head}${suffix}`;
}

export interface StepLike {
  readonly kind: string;
  readonly label: string;
}

/**
 * Rule-based Einsatz name (what you DO): the verb of the most frequent step kind plus the first label of that
 * kind ("Titan-Erz abbauen" style via `verb`). Within {@link EINSATZ_NAME_MAX}.
 */
export function fallbackEinsatzName(steps: readonly StepLike[], verb: (kind: string) => string, defaultName: string): string {
  if (!steps.length) return clampName(defaultName, EINSATZ_NAME_MAX);
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  let best = steps[0].kind;
  for (const [k, n] of counts) if (n > (counts.get(best) ?? 0)) best = k;
  const label = steps.find((s) => s.kind === best)?.label ?? '';
  return clampName(`${verb(best)} ${label}`.trim(), EINSATZ_NAME_MAX);
}
