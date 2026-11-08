/**
 * Patch renames. CIG sometimes renames an announced patch (4.11 became 5.0 on
 * the roadmap); the patch is the same one, only its name changed. Our stored
 * keys (comet tips, star maps, news) stay on the name they were created under,
 * so every surface resolves through this one map for DISPLAY and for matching.
 * New rename = one entry here: `announced name -> current name`.
 */
export const PATCH_ALIASES: Readonly<Record<string, string>> = {
  '4.11': '5.0',
};

/** The current name of a patch line (follows renames, chains included). */
export function currentPatchName(line: string, aliases: Readonly<Record<string, string>> = PATCH_ALIASES): string {
  let cur = line;
  const seen = new Set<string>();
  while (aliases[cur] !== undefined && !seen.has(cur)) {
    seen.add(cur);
    cur = aliases[cur];
  }
  return cur;
}

/** The name a patch was announced under, when it was renamed since; else null. */
export function formerPatchName(line: string, aliases: Readonly<Record<string, string>> = PATCH_ALIASES): string | null {
  if (currentPatchName(line, aliases) !== line) return line;
  return Object.keys(aliases).find((k) => currentPatchName(k, aliases) === line) ?? null;
}

/** True when both names denote the same patch. */
export function samePatch(a: string, b: string, aliases: Readonly<Record<string, string>> = PATCH_ALIASES): boolean {
  return currentPatchName(a, aliases) === currentPatchName(b, aliases);
}
