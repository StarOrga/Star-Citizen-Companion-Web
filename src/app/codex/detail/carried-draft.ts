import { draftKey } from '../codex-loadout-draft';

/** What a carried sub-slot contributes to the aggregate stats: its payload, or nothing. */
export interface CarriedItem {
  kind: string | null;
  payload: unknown;
  ammoPayload: unknown;
}

/**
 * The occupants a mount carries, with the loadout DRAFT applied per sub-slot (`mount.gun`).
 *
 * The aggregate readers (the strip's EM / IR / power, the Damage panel) used to take a mount's
 * carried guns from the STOCK loadout even when the draft had swapped one, so the strip kept
 * the old EM while the callout already showed the new gun (round-7 E9). A swapped child gives
 * its draft item, an emptied child gives nothing, a still-hydrating swap gives nothing rather
 * than a stale number — the same rules a top-level port follows.
 */
export function carriedWithDraft(
  topPort: string,
  carried: ReadonlyMap<string, string>,
  draft: ReadonlyMap<string, string | null>,
  stock: (className: string) => CarriedItem | null,
  swapped: (path: string, value: string) => CarriedItem | 'pending' | null,
): CarriedItem[] {
  const out: CarriedItem[] = [];
  for (const [childPort, className] of carried) {
    const path = draftKey(topPort, childPort);
    if (draft.has(path)) {
      const value = draft.get(path) ?? null;
      if (value === null) continue;
      const item = swapped(path, value);
      if (item && item !== 'pending') out.push(item);
      continue;
    }
    const item = stock(className);
    if (item) out.push(item);
  }
  return out;
}
