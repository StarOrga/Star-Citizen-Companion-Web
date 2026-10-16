import { LocalizedText } from './codex.types';

/**
 * Countermeasure launchers (decoy / noise) on the ship page — feedback #242.
 *
 * Two facts the generic weapon helpers do not cover:
 *
 * 1. CIG reuses one localisation key across launchers of MANY ships: the
 *    Nomad's own `CNOU_Nomad_CML_Flare` carries `@item_NameAEGS_Gladius_CML_Flare`
 *    and so reads "Aegis Gladius - Decoy Launcher" (4.10: 174 of 194 launchers
 *    point at another class's key). The launcher IS the Nomad's — only its
 *    display name is borrowed. Showing that name on the Nomad reads as a
 *    foreign ship's part, so a borrowed name gives way to a neutral
 *    "Decoy launcher" / "Noise launcher" label.
 * 2. A decoy is judged by the signature it puts into the sky versus the ship's
 *    own, not by damage — {@link decoysToOutshine} turns the two into a count.
 */

export type CountermeasureKind = 'decoy' | 'noise';

/** `subType` the extractor stamps on every decoy / noise launcher. */
export function isCountermeasureLauncher(payload: unknown): boolean {
  return (payload as { subType?: unknown } | null | undefined)?.subType === 'CountermeasureLauncher';
}

/** Launcher class names: `…_CML_…`, plus the few `RSI_Skylark_Flare` style ones. */
const CML_CLASS = /(^|_)CML(_|$)|_(Flare|Chaff)$/i;

/**
 * Decoy (flare) or noise (chaff) — from the round's own params type when the
 * ammo payload is at hand, else from the class-name token CIG uses on every
 * launcher (`…_Flare` / `…_Decoy` vs `…_Chaff` / `…_Noise`).
 */
export function countermeasureKind(
  className: string | null | undefined,
  ammoPayload?: unknown,
): CountermeasureKind | null {
  const type = (
    ammoPayload as
      | { raw?: { projectileParams?: { typeParams?: { _Type_?: unknown } } } }
      | null
      | undefined
  )?.raw?.projectileParams?.typeParams?._Type_;
  if (typeof type === 'string') {
    if (/flare/i.test(type)) return 'decoy';
    if (/chaff/i.test(type)) return 'noise';
  }
  const cn = className ?? '';
  if (/(^|_)(flare|decoy)(_|$)/i.test(cn)) return 'decoy';
  if (/(^|_)(chaff|noise)(_|$)/i.test(cn)) return 'noise';
  return null;
}

/**
 * The i18n key of the neutral name a countermeasure launcher shows instead of
 * the one it borrowed from another class (see header, point 1) — or null when
 * the class owns its name (or is no launcher at all), so the caller keeps the
 * catalog name.
 */
export function borrowedCountermeasureNameKey(
  className: string | null | undefined,
  name: LocalizedText | null | undefined,
): string | null {
  const cn = className?.trim();
  if (!cn || !CML_CLASS.test(cn)) return null;
  const key = name?.key?.trim();
  if (!key) return null;
  if (key.toLowerCase() === `@item_name${cn}`.toLowerCase()) return null;
  const kind = countermeasureKind(cn);
  return kind ? `codex.countermeasure.name.${kind}` : null;
}

/**
 * How many rounds it takes before their signature clearly outshines the
 * ship's own on one channel: `floor(ship / round) + 1` — strictly MORE than
 * the ship, so a 40,000 ship against 20,000 decoys needs 3, not 2 (the
 * admin's own example). Null when either side is missing or not positive —
 * never a guessed count.
 */
export function decoysToOutshine(
  shipSignature: number | null | undefined,
  roundSignature: number | null | undefined,
): number | null {
  if (shipSignature == null || roundSignature == null) return null;
  if (!Number.isFinite(shipSignature) || !Number.isFinite(roundSignature)) return null;
  if (shipSignature <= 0 || roundSignature <= 0) return null;
  return Math.floor(shipSignature / roundSignature) + 1;
}
