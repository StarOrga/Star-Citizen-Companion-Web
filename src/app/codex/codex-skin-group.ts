import type { CodexListRow } from './codex.service';

/**
 * Livery ("skin") grouping for catalog lists (admin feedback d5e39f86).
 *
 * CIG ships every paint job of a weapon as its own catalog record, so the FPS
 * weapon list is mostly the same twenty guns over and over: `LH86 Pistol` plus
 * thirteen `LH86 "Voyager" / "Warhawk" / "Boneyard" …` records, `Pyro RYT
 * Multi-Tool` plus eleven, and so on — 447 rows for roughly 120 distinct
 * objects in build 4.9.0. This collapses each livery family into ONE list entry
 * and hands the absorbed liveries to the detail view, which offers them in a
 * picker.
 *
 * This is the sibling of {@link ./codex-variant-fold}, and runs AFTER it:
 * the variant fold removes records that render *identically* (`…_Igniter`,
 * `…_default_*`), this one removes records that differ *only by paint*. The
 * order matters — the multi-tool's nine `_default_*` records all carry the base
 * name, so before the variant fold the base name is ambiguous and nothing here
 * would group.
 *
 * Both live purely in the READ path. Codex rows come from the data-uploader →
 * ingest pipeline and are build-scoped, so the data is never rewritten, and no
 * curated skin list exists anywhere — the rule below derives everything from
 * the records themselves:
 *
 *   A row is a livery of another row when
 *     (a) its name carries a quoted token — `LH86 "Voyager" Pistol` — and
 *     (b) removing that token yields EXACTLY the other row's name, and
 *     (c) exactly one row in the set carries that name, and
 *     (d) both class names share their first three underscore segments.
 *
 * (a)+(b) do the work; (c) refuses to guess when the base name is ambiguous,
 * and (d) is the sanity guard that keeps two unrelated objects that happen to
 * share a name apart. Anything the rule cannot prove stays a standalone entry —
 * `TBF-4 "Balefire" Combat Knife` keeps its own card because the plain `TBF-4
 * Combat Knife` is not in the catalog at all, and `SW16BR1 "Buzzsaw" Repeater`
 * keeps its own because "Buzzsaw" is the ship weapon's actual product name, not
 * a livery.
 *
 * Grouping reads `name_localized` — the language-STABLE promoted column — never
 * the translated payload name: the German record for the same gun reads
 * `LH86-Pistole (Voyager)` and the German base name is an untranslated
 * placeholder, so a language-aware key would group differently per language.
 * The livery token itself is a proper noun ("Voyager", "Warhawk") and is the
 * same in both languages, so it doubles as the picker label.
 */

/** Straight and typographic quote pairs CIG uses around a livery token. */
const QUOTED_TOKEN = /\s*["\u201c\u201d\u201e\u00ab\u00bb]([^"\u201c\u201d\u201e\u00ab\u00bb]+)["\u201c\u201d\u201e\u00ab\u00bb]\s*/;

/**
 * How many leading `_`-separated class-name segments a livery must share with
 * its base. Three is what separates manufacturer + weapon family + damage type
 * (`gmni_pistol_ballistic`) — enough that a name collision across two unrelated
 * objects cannot pass, loose enough for the records CIG numbers inconsistently
 * (`lbco_sniper_energy_imp01` is a livery of `lbco_sniper_energy_01`, so a
 * strict "base class name is a prefix" rule would miss it).
 */
const MIN_SHARED_SEGMENTS = 3;

/** One livery absorbed into a list entry. */
export interface SkinVariantRef {
  readonly classNameSlug: string;
  /** The quoted token — "Voyager", "Desert Shadow". Never empty. */
  readonly liveryName: string;
}

/** A list row that survived skin grouping, plus the liveries it absorbed. */
export type SkinGroupedRow<T extends CodexListRow = CodexListRow> = T & {
  /** Sorted by livery name; empty for the majority of rows. */
  readonly skinVariants: readonly SkinVariantRef[];
};

/** One entry of the detail view's skin picker. */
export interface SkinOption {
  readonly classNameSlug: string;
  /** `null` on the base record, whose name carries no livery token. */
  readonly liveryName: string | null;
}

/**
 * Comparison form of a catalog name. Collapses whitespace and drops the two
 * characters the extract leaves behind between the model number and the livery
 * token: a non-breaking space, and the U+FFFD replacement character of a
 * mis-decoded one (the extract's `LH86<U+FFFD> "Voyager" Pistol`), neither of
 * which the plain base record carries.
 */
export function normalizeSkinName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[\u00a0\u202f\ufffd]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Split `LH86 "Voyager" Pistol` into its base name and its livery token, or
 * `null` when the name carries no quoted token (or nothing but one).
 */
export function splitLiveryName(name: string): { base: string; livery: string } | null {
  const normalized = normalizeSkinName(name);
  const match = QUOTED_TOKEN.exec(normalized);
  if (!match) return null;
  const livery = match[1].trim();
  const base = `${normalized.slice(0, match.index)} ${normalized.slice(match.index + match[0].length)}`
    .replace(/\s+/g, ' ')
    .trim();
  if (!livery || !base) return null;
  return { base, livery };
}

/** Leading `_`-separated segments two class names have in common. */
export function sharedClassSegments(a: string, b: string): number {
  const sa = a.toLowerCase().split('_');
  const sb = b.toLowerCase().split('_');
  let n = 0;
  while (n < sa.length && n < sb.length && sa[n] === sb[n]) n++;
  return n;
}

/**
 * Class-name prefix that is guaranteed to contain a whole livery family, for
 * the detail view's sibling query. NB the caller queries it with `ilike`, where
 * `_` is a single-character wildcard — that only ever widens the result, and
 * the rule below discards whatever does not belong.
 */
export function skinQueryPrefix(classNameSlug: string): string {
  return classNameSlug.split('_').slice(0, MIN_SHARED_SEGMENTS).join('_');
}

/** base class name → its liveries, by the rule in the module comment. */
function collectGroups<T extends CodexListRow>(rows: readonly T[]): Map<string, SkinVariantRef[]> {
  const byName = new Map<string, T[]>();
  for (const row of rows) {
    const name = normalizeSkinName(row.nameLocalized);
    if (!name) continue;
    const bucket = byName.get(name);
    if (bucket) bucket.push(row);
    else byName.set(name, [row]);
  }

  const groups = new Map<string, SkinVariantRef[]>();
  for (const row of rows) {
    const split = splitLiveryName(row.nameLocalized ?? '');
    if (!split) continue;
    const candidates = (byName.get(split.base) ?? []).filter(
      (c) =>
        c.classNameSlug !== row.classNameSlug &&
        sharedClassSegments(c.classNameSlug, row.classNameSlug) >= MIN_SHARED_SEGMENTS,
    );
    // Ambiguous (or absent) base → this row keeps its own entry.
    if (candidates.length !== 1) continue;
    const base = candidates[0].classNameSlug;
    const variants = groups.get(base);
    const ref: SkinVariantRef = { classNameSlug: row.classNameSlug, liveryName: split.livery };
    if (variants) variants.push(ref);
    else groups.set(base, [ref]);
  }
  return groups;
}

function byLiveryName(a: SkinVariantRef, b: SkinVariantRef): number {
  return a.liveryName.localeCompare(b.liveryName) || a.classNameSlug.localeCompare(b.classNameSlug);
}

/**
 * Collapse each livery family into its base row, preserving the incoming order
 * of the surviving rows. Pure — the input array is never mutated.
 */
export function groupSkinRows<T extends CodexListRow>(rows: readonly T[]): SkinGroupedRow<T>[] {
  const groups = collectGroups(rows);
  const absorbed = new Set<string>();
  for (const variants of groups.values()) {
    for (const v of variants) absorbed.add(v.classNameSlug);
  }

  const out: SkinGroupedRow<T>[] = [];
  for (const row of rows) {
    if (absorbed.has(row.classNameSlug)) continue;
    const variants = groups.get(row.classNameSlug);
    out.push({ ...row, skinVariants: variants ? [...variants].sort(byLiveryName) : [] });
  }
  return out;
}

/**
 * The livery family `classNameSlug` belongs to, base record first, then the
 * liveries by name — the detail view's picker. `null` when the row has no
 * siblings, which is the normal case and hides the picker entirely.
 *
 * Works from either end: passing a livery's class name resolves the same group
 * as passing the base's, so a deep link straight onto `…_cen01` still shows the
 * full picker with that entry marked current.
 */
export function resolveSkinGroup<T extends CodexListRow>(
  rows: readonly T[],
  classNameSlug: string,
): SkinOption[] | null {
  const groups = collectGroups(rows);
  let base: string | null = null;
  if (groups.has(classNameSlug)) {
    base = classNameSlug;
  } else {
    for (const [candidate, variants] of groups) {
      if (variants.some((v) => v.classNameSlug === classNameSlug)) {
        base = candidate;
        break;
      }
    }
  }
  if (!base) return null;
  const variants = [...groups.get(base)!].sort(byLiveryName);
  return [
    { classNameSlug: base, liveryName: null },
    ...variants.map((v) => ({ classNameSlug: v.classNameSlug, liveryName: v.liveryName })),
  ];
}
