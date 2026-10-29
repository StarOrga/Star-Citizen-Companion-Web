// Validates the query of translation-overlay and maps it to the R2 key
// (translation-overlay/<lang>/<build_id|latest>.json), or null when it is malformed.

export function overlayObjectKey(
  lang: string | null,
  buildId: string | null,
  langRe: RegExp,
  buildRe: RegExp,
): string | null {
  if (!lang || !langRe.test(lang)) return null;
  if (buildId !== null && buildId !== '' && !buildRe.test(buildId)) return null;
  return `translation-overlay/${lang}/${buildId ? buildId : 'latest'}.json`;
}
