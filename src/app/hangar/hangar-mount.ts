// "Montieren" — which port of a hangar ship a piece from the search goes on.
// -----------------------------------------------------------------------------
// Pure. The search CTA links to the HQ ship with `?mount=<className>`; the ship
// page asks this for the first editable port the piece fits, with the same
// verdict as the search's "Passt auf X" badge (`fitVerdict`).

import type { CodexItemPort } from '../codex/codex.types';
import type { FitIdentity } from '../codex/codex.service';
import { fitVerdict } from '../codex/search/search-compat';

/** The name of the first port the piece fits, or null (unknown piece, no fitting port). */
export function firstFittingPort(ports: readonly CodexItemPort[], piece: Pick<FitIdentity, 'kind' | 'attachType' | 'size'>): string | null {
  for (const p of ports) {
    if (!p.portName) continue;
    const port = { types: p.types ?? [], minSize: p.minSize ?? null, maxSize: p.maxSize ?? null };
    if (fitVerdict({ kind: piece.kind, attachType: piece.attachType, size: piece.size }, [port]).verdict === 'fits') return p.portName;
  }
  return null;
}
