import type { CodexKind } from '../../codex/codex.service';
import { polyHitLink } from '../../codex/codex-poly-search';
import { hqShip } from '../hq-routes';

/**
 * What an entry of "Lager per Ort" points at. The table has only a nullable `class_name`
 * column, so a manual entry stores `<kind>:<ClassName>` there (no migration); entries from the
 * desktop app or the log carry a bare class name or none and stay readable.
 */
export const STOCK_KINDS: readonly CodexKind[] = ['ship', 'item', 'component', 'weapon', 'ammunition'];

export function encodeStockRef(kind: CodexKind, className: string): string {
  return `${kind}:${className}`;
}

export function parseStockRef(ref: string | null | undefined): { kind: CodexKind | null; className: string } | null {
  const v = (ref ?? '').trim();
  if (!v) return null;
  const i = v.indexOf(':');
  if (i > 0) {
    const kind = v.slice(0, i) as CodexKind;
    if (STOCK_KINDS.includes(kind) && v.length > i + 1) return { kind, className: v.slice(i + 1) };
  }
  return { kind: null, className: v };
}

export interface StockTarget {
  commands: string[];
  queryParams: Record<string, string> | null;
}

/**
 * Where an entry leads: a ship the reader owns → their hangar ship, else the Codex page;
 * any other known kind → its Codex page; a bare class name (kind unknown) → the Codex index
 * search for the entry's name; nothing known → null (plain text).
 */
export function stockTarget(
  name: string,
  classRef: string | null | undefined,
  ownedShips: readonly { id: string; shipClassName: string }[],
): StockTarget | null {
  const ref = parseStockRef(classRef);
  if (!ref) return null;
  const owned = ownedShips.find((s) => s.shipClassName === ref.className);
  if (ref.kind === 'ship' || (!ref.kind && owned)) {
    return owned
      ? { commands: hqShip(owned.id), queryParams: null }
      : { commands: polyHitLink({ kind: 'ship', classNameSlug: ref.className }), queryParams: null };
  }
  if (ref.kind) return { commands: polyHitLink({ kind: ref.kind, classNameSlug: ref.className }), queryParams: null };
  return { commands: ['/codex/index'], queryParams: { q: name } };
}
