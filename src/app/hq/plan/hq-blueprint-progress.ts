import { humanizeClassName } from '../../codex/codex-format';
import type { SupplyItem } from '../hq-supplies.service';

/** One blueprint with material in Nachschub: how many of its material lines are there already. */
export interface BlueprintProgress {
  readonly className: string;
  readonly name: string;
  /** Material lines that lie ready (`done`). */
  readonly have: number;
  /** All material lines of the blueprint. */
  readonly total: number;
}

/**
 * Progress per blueprint, read from existing Nachschub lines only (no table of its own).
 * A material line is every line whose `forClassName` points at the blueprint (see ItemPathService.addToNachschub);
 * it is "there" when its own `done` flag is set ("liegt bereit"). The blueprint's own line only
 * supplies the display name. Sorted: least finished first, then by name.
 */
export function blueprintProgress(items: readonly SupplyItem[]): BlueprintProgress[] {
  const groups = new Map<string, { className: string; have: number; total: number }>();
  for (const i of items) {
    const cn = i.forClassName?.trim();
    if (!cn) continue;
    const key = cn.toLowerCase();
    const g = groups.get(key) ?? { className: cn, have: 0, total: 0 };
    g.total += 1;
    if (i.done) g.have += 1;
    groups.set(key, g);
  }
  const nameOf = (cn: string): string => {
    const own = items.find((i) => i.entityKind === 'blueprint' && (i.className ?? '').toLowerCase() === cn.toLowerCase());
    return own?.name || humanizeClassName(cn) || cn;
  };
  return [...groups.values()]
    .map((g) => ({ ...g, name: nameOf(g.className) }))
    .sort((a, b) => a.have / a.total - b.have / b.total || a.name.localeCompare(b.name));
}
