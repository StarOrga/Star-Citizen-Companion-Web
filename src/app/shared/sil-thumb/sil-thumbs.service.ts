import { Injectable, inject, signal } from '@angular/core';
import { CodexService } from '../../codex/codex.service';
import type { SilhouetteKind } from '../../codex/holo-silhouette';
import { logWarn } from '../../core/log';

/** A silhouette ready to draw: the (already rotated, for ships) view box plus the stroke path. */
export interface SilThumb {
  readonly viewBox: string;
  readonly path: string;
  /** Inner feature edges (open polylines, same viewBox), when the silhouette carries them. */
  readonly edges?: string;
  /** SVG transform for the path (ships are drawn nose-right). Empty for everything else. */
  readonly transform: string;
}

/** The silhouette slices a wish / stock kind may live in; the first hit wins. */
export function silhouetteKindsOf(kind: string): readonly SilhouetteKind[] {
  switch (kind) {
    case 'ship':
    case 'vehicle':
      return ['ship'];
    case 'weapon':
      return ['weapon'];
    case 'component':
      return ['component'];
    case 'item':
      // The uploader emits armor under its own kind, the web stores the same entities as items.
      return ['item', 'armor'];
    default:
      return [];
  }
}

/** Ships are traced nose-up; every tile in the app lays them nose-right: quarter turn about the centre. */
export function rotateShipBox(viewBox: string): { viewBox: string; transform: string } | null {
  const p = viewBox.trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) return null;
  const [x, y, w, h] = p;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { viewBox: `${cx - h / 2} ${cy - w / 2} ${h} ${w}`, transform: `rotate(90 ${cx} ${cy})` };
}

/**
 * Silhouettes for small tiles (cart, quick access, search rows): one batched read per new class set, answered into a
 * signal. A class without a silhouette keeps its kind icon for good (advisory, never an error state).
 */
@Injectable({ providedIn: 'root' })
export class SilThumbsService {
  private readonly codex = inject(CodexService);
  private readonly thumbs = signal<ReadonlyMap<string, SilThumb>>(new Map());
  private readonly asked = new Set<string>();

  /** The thumb of an entry, or null while unknown / when there is none. Reads a signal. */
  thumbOf(kind: string, className: string): SilThumb | null {
    return this.thumbs().get(`${silhouetteKindsOf(kind)[0] ?? kind}:${className.toLowerCase()}`) ?? null;
  }

  /** Ask for silhouettes of entries not asked for yet. Safe to call from a computed / effect repeatedly. */
  request(entries: readonly { kind: string; className: string }[]): void {
    const byKind = new Map<SilhouetteKind, string[]>();
    for (const e of entries) {
      const kinds = silhouetteKindsOf(e.kind);
      if (!kinds.length || !e.className) continue;
      const key = `${e.kind}:${e.className.toLowerCase()}`;
      if (this.asked.has(key)) continue;
      this.asked.add(key);
      for (const k of kinds) byKind.set(k, [...(byKind.get(k) ?? []), e.className]);
    }
    for (const [kind, classNames] of byKind) {
      void this.codex
        .silhouettes(kind, classNames)
        .then((found) => {
          if (!found.size) return;
          const next = new Map(this.thumbs());
          for (const [cls, s] of found) {
            const t: SilThumb = kind === 'ship' ? this.rotated(s.viewBox, s.path) : { viewBox: s.viewBox, path: s.path, transform: '', ...(s.edges ? { edges: s.edges } : {}) };
            // A second slice (armor) for an item lands under the item key when the first one found nothing.
            const key = `${kind === 'armor' ? 'item' : kind}:${cls.toLowerCase()}`;
            if (!next.has(key)) next.set(key, t);
          }
          this.thumbs.set(next);
        })
        .catch((err) => logWarn('sil-thumbs', 'silhouettes unavailable', err));
    }
  }

  private rotated(viewBox: string, path: string): SilThumb {
    const r = rotateShipBox(viewBox);
    return r ? { viewBox: r.viewBox, path, transform: r.transform } : { viewBox, path, transform: '' };
  }
}
