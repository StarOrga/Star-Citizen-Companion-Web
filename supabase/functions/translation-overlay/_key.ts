// Validates the query of translation-overlay and maps it to the R2 key
// (translation-overlay/<lang>/<build_id|latest>.json), or null when it is malformed.
// `ns=rooms` selects the room-label slice the orchestrator writes next to latest.json
// (translation-overlay/<lang>/rooms.json, E14); it has no per-build variant.

export const OVERLAY_NAMESPACES = ['rooms'] as const;

export function overlayObjectKey(
  lang: string | null,
  buildId: string | null,
  langRe: RegExp,
  buildRe: RegExp,
  ns: string | null = null,
): string | null {
  if (!lang || !langRe.test(lang)) return null;
  if (ns !== null && ns !== '') {
    if (!(OVERLAY_NAMESPACES as readonly string[]).includes(ns)) return null;
    if (buildId !== null && buildId !== '') return null;
    return `translation-overlay/${lang}/${ns}.json`;
  }
  if (buildId !== null && buildId !== '' && !buildRe.test(buildId)) return null;
  return `translation-overlay/${lang}/${buildId ? buildId : 'latest'}.json`;
}
