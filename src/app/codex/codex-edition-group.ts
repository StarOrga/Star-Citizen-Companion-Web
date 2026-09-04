import type { CodexListRow } from './codex.service';
import { cleanLocaleValue } from './codex-format';

/**
 * Edition ("variant") grouping for the SHIP catalog (admin feedback 77ecad2a).
 *
 * CIG ships one vehicle record per *file*, so a single hull appears in the
 * catalog many times over: `DRAK_Cutlass_Black` plus six more records that all
 * read `Drake Cutlass Black`, and on top of that the marketing editions —
 * `Aegis Idris-P Wikelo War Special`, `Aegis Hammerhead 2949 Best In Show
 * Edition`, `Anvil F8C Lightning Executive Edition`. The A-Z grid showed each
 * of them as its own card. This collapses an edition family into ONE list entry
 * and hands the absorbed records to the detail view, which offers them in a
 * picker.
 *
 * This is the ship-side sibling of {@link ./codex-skin-group} (weapon liveries)
 * and runs AFTER {@link ./codex-variant-fold}, exactly like that one: the fold
 * removes records that render *identically*, this one removes records that are
 * the same hull under a different file name or edition badge.
 *
 * Read path only. Ship rows come from the data-uploader → ingest pipeline and
 * are build-scoped, so nothing is rewritten and no curated edition list exists
 * anywhere — the rule derives everything from the records themselves:
 *
 *   A row is an edition of another row when
 *     (a) the other row's class name is a proper `_`-segment PREFIX of its own
 *         (`AEGS_Idris_P` → `AEGS_Idris_P_Collector_Military`), and it is the
 *         LONGEST such row in the set (nearest ancestor), and
 *     (b) either the two rows carry the SAME display name — a pure duplicate
 *         record — or the row's name is the base name plus a trailing phrase
 *         whose last word is an edition marker ("… Wikelo War **Special**",
 *         "… 2949 Best In Show **Edition**").
 *
 * (a) alone is far too greedy: `MISC_Freelancer_MAX`, `MISC_Reliant_Mako`,
 * `ANVL_Hornet_F7C_Mk2` and `TMBL_Cyclone_AA` are all prefix-extensions of
 * another record and all genuinely different ships. (b) is what separates a
 * badge from a model — and it is deliberately conservative, so anything the
 * rule cannot prove keeps its own entry: `ARGO MOLE Alliance` stays standalone
 * because "Alliance" is not an edition marker, and `C.O. Mustang CitizenCon
 * 2948 Edition` stays standalone because its name does not start with its
 * base's ("C.O. Mustang Alpha").
 *
 * Against live 4.9.0 ship data (352 buyable records) the grid goes 352 → 293
 * (the existing variant fold) → 248 entries, 37 families, 45 records absorbed.
 *
 * Grouping reads `name_localized` — the language-STABLE promoted column — never
 * the translated payload name, for the same reason the livery grouping does: a
 * language-aware key would group differently per language (the German record
 * for the Hammerhead edition reads "Best In Show 2949 Edition" while many base
 * ships have no German name at all). The edition phrase is a proper noun and
 * doubles as the picker label in both languages.
 */

/**
 * Trailing words that mark a name as an *edition* of the base ship rather than
 * a different model. Matched against the LAST word of the trailing phrase only,
 * so `Anvil Carrack Expedition` (a real, separate ship) does not match
 * "Edition", and `Anvil Terrapin Medic` does not match anything at all.
 */
const EDITION_MARKERS: ReadonlySet<string> = new Set(['edition', 'special']);

/** How many leading `_` segments the detail view's sibling query keeps. */
const QUERY_PREFIX_SEGMENTS = 2;

/** One record absorbed into a list entry. */
export interface EditionRef {
  readonly classNameSlug: string;
  /** Picker label — "Wikelo War Special", "Exec Military". Never empty. */
  readonly editionName: string;
}

/** A list row that survived edition grouping, plus the records it absorbed. */
export type EditionGroupedRow<T extends CodexListRow = CodexListRow> = T & {
  /** Sorted by edition name; empty for the majority of rows. */
  readonly editions: readonly EditionRef[];
};

/** One entry of the detail view's edition picker. */
export interface EditionOption {
  readonly classNameSlug: string;
  /** `null` on the base record, which is the ship as such. */
  readonly editionName: string | null;
}

/**
 * Comparison form of a catalog name. Collapses whitespace and drops the
 * characters the extract leaves between words — a non-breaking space and the
 * U+FFFD replacement character of a mis-decoded one (`CHCO Auris<U+FFFD>PDC
 * Monitor`), neither of which the sibling record necessarily carries.
 */
export function normalizeEditionName(raw: string | null | undefined): string {
  if (!raw) return '';
  return cleanLocaleValue(raw)
    .replace(/[\u00a0\u202f\ufffd]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The trailing edition phrase of `name` relative to `baseName`, or `null` when
 * the name is not "base name + edition phrase".
 *
 *   ('Aegis Idris-P', 'Aegis Idris-P Wikelo War Special') → 'Wikelo War Special'
 *   ('Drake Cutter',  'Drake Cutter Rambler')             → null
 */
export function editionSuffixName(
  baseName: string | null | undefined,
  name: string | null | undefined,
): string | null {
  const base = normalizeEditionName(baseName);
  const full = normalizeEditionName(name);
  if (!base || !full || !full.startsWith(`${base} `)) return null;
  const rest = full.slice(base.length).trim();
  if (!rest) return null;
  const words = rest.split(' ');
  const last = words[words.length - 1].replace(/[^\p{L}]/gu, '').toLowerCase();
  return EDITION_MARKERS.has(last) ? rest : null;
}

/**
 * Picker label for a duplicate record, read off the part of the class name the
 * base does not have: `DRAK_Cutlass_Black` + `DRAK_Cutlass_Black_PU_Boarding` →
 * "PU Boarding". Its siblings render under the same display name, so the raw
 * file term IS the only thing that tells them apart — which is fine inside the
 * picker, and is exactly the noise this module keeps out of the grid.
 */
export function humanizeEditionSuffix(baseClassName: string, classNameSlug: string): string {
  const suffix = classNameSlug.slice(baseClassName.length).replace(/^_+/, '');
  const label = suffix
    .split('_')
    .filter(Boolean)
    .map((tok) => tok.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label || classNameSlug;
}

/**
 * Class-name prefix guaranteed to contain a whole edition family, for the
 * detail view's sibling query — manufacturer + model (`AEGS_Idris` for
 * `AEGS_Idris_P_Collector_Military`). Every family root is at least that long,
 * so this is a cheap superset; `resolveEditionGroup` discards what does not
 * belong. NB the caller queries it with `ilike`, where `_` is a single-character
 * wildcard — that only ever widens the result further.
 */
export function editionQueryPrefix(classNameSlug: string): string {
  return classNameSlug.split('_').slice(0, QUERY_PREFIX_SEGMENTS).join('_');
}

interface Link {
  readonly base: string;
  /** Set for rule (b); `null` for a same-name duplicate, labelled from the class name. */
  readonly editionName: string | null;
}

/** Nearest ancestor of every row, when the rule accepts it. */
function directLinks<T extends CodexListRow>(rows: readonly T[]): Map<string, Link> {
  const byClass = new Map<string, T>();
  for (const row of rows) byClass.set(row.classNameSlug, row);

  const links = new Map<string, Link>();
  for (const row of rows) {
    // Nearest ancestor: walk segments off the end until one is a known record.
    const segments = row.classNameSlug.split('_');
    let base: T | undefined;
    for (let i = segments.length - 1; i > 0 && !base; i--) {
      base = byClass.get(segments.slice(0, i).join('_'));
    }
    if (!base) continue;

    const baseName = normalizeEditionName(base.nameLocalized);
    const name = normalizeEditionName(row.nameLocalized);
    if (baseName && baseName === name) {
      links.set(row.classNameSlug, { base: base.classNameSlug, editionName: null });
      continue;
    }
    const edition = editionSuffixName(base.nameLocalized, row.nameLocalized);
    if (edition) links.set(row.classNameSlug, { base: base.classNameSlug, editionName: edition });
  }
  return links;
}

/**
 * Family root of a class name — the links chain (`…_Exec_Military` → `…_Exec` →
 * `…_F8C`) and the picker is flat, so every member resolves all the way up.
 * Every hop is strictly shorter than the last, so the walk always terminates.
 */
function rootOf(links: Map<string, Link>, classNameSlug: string): string {
  let current = classNameSlug;
  for (let link = links.get(current); link; link = links.get(current)) current = link.base;
  return current;
}

/** family root → the records it absorbed, by the rule in the module comment. */
function collectGroups<T extends CodexListRow>(rows: readonly T[]): Map<string, EditionRef[]> {
  const links = directLinks(rows);
  const groups = new Map<string, EditionRef[]>();
  for (const [classNameSlug, link] of links) {
    const base = rootOf(links, classNameSlug);
    const ref: EditionRef = {
      classNameSlug,
      // Labels are relative to the ROOT, not to the direct parent, so a chained
      // record reads "Exec Military" rather than a bare "Military".
      editionName: link.editionName ?? humanizeEditionSuffix(base, classNameSlug),
    };
    const refs = groups.get(base);
    if (refs) refs.push(ref);
    else groups.set(base, [ref]);
  }
  return groups;
}

function byEditionName(a: EditionRef, b: EditionRef): number {
  return a.editionName.localeCompare(b.editionName) || a.classNameSlug.localeCompare(b.classNameSlug);
}

/**
 * Collapse each edition family into its base row, preserving the incoming order
 * of the surviving rows. Pure — the input array is never mutated.
 */
export function groupEditionRows<T extends CodexListRow>(rows: readonly T[]): EditionGroupedRow<T>[] {
  const groups = collectGroups(rows);
  const absorbed = new Set<string>();
  for (const refs of groups.values()) {
    for (const ref of refs) absorbed.add(ref.classNameSlug);
  }

  const out: EditionGroupedRow<T>[] = [];
  for (const row of rows) {
    if (absorbed.has(row.classNameSlug)) continue;
    const refs = groups.get(row.classNameSlug);
    out.push({ ...row, editions: refs ? [...refs].sort(byEditionName) : [] });
  }
  return out;
}

/**
 * The edition family `classNameSlug` belongs to, base record first, then the
 * editions by name — the detail view's picker. `null` when the row has no
 * siblings, which is the normal case and hides the picker entirely.
 *
 * Works from either end: passing an edition's class name resolves the same
 * group as passing the base's, so a deep link straight onto
 * `AEGS_Idris_P_Collector_Military` still shows the full picker with that entry
 * marked current.
 */
export function resolveEditionGroup<T extends CodexListRow>(
  rows: readonly T[],
  classNameSlug: string,
): EditionOption[] | null {
  const groups = collectGroups(rows);
  let base: string | null = null;
  if (groups.has(classNameSlug)) {
    base = classNameSlug;
  } else {
    for (const [candidate, refs] of groups) {
      if (refs.some((r) => r.classNameSlug === classNameSlug)) {
        base = candidate;
        break;
      }
    }
  }
  if (!base) return null;
  const refs = [...groups.get(base)!].sort(byEditionName);
  return [
    { classNameSlug: base, editionName: null },
    ...refs.map((r) => ({ classNameSlug: r.classNameSlug, editionName: r.editionName })),
  ];
}
