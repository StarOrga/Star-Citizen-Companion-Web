import type { HoloSilhouette } from '../holo-silhouette';
import { rotateShipBox, type SilThumb } from '../../shared/sil-thumb/sil-thumbs.service';

/**
 * Longest the ship detail keeps its skeleton (the arriving silhouette) after the data is in,
 * waiting for the hull outline the Holotable draws. Usually 0: the outline is read alongside
 * the detail. Past this the stage enters without it, as before.
 */
export const SILHOUETTE_HOLD_MS = 900;

/**
 * The detail's own hull silhouette as an arrival thumb — the same nose-up turn the small
 * tiles use, so the skeleton shows the ship even when the batched tile read has not answered.
 */
export function arrivalThumbOf(sil: Pick<HoloSilhouette, 'viewBox' | 'path'> | null): SilThumb | null {
  if (!sil?.viewBox || !sil.path) return null;
  const r = rotateShipBox(sil.viewBox);
  return r ? { viewBox: r.viewBox, path: sil.path, transform: r.transform } : { viewBox: sil.viewBox, path: sil.path, transform: '' };
}
