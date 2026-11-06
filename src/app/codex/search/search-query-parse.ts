// Values in the typed text become chips (concept 2026-11-02 lines C2, C8).
// -----------------------------------------------------------------------------
// "s4", "größe 3", "size 3" → a size chip; "klasse a", "grade a" → a grade
// chip. The matched words leave the text (`rest`), so the name search is not
// polluted by them. Pure and framework-free: the engine parses, the UI renders
// the chips, `switchChip` swaps a value (S1 → S3) from the chip's menu.
//
// Parsing works on WHITESPACE tokens only, so "P4-AR", "Z-S1" or "s3-rail"
// are never split. Kind words ("waffen", "ships") are deliberately NOT parsed:
// "ship" is part of too many item names ("Ship Armor") to eat it from a query.

import type { SearchChip, SearchChipOption } from './search-result-model';

/** Sizes the datamine knows (S0 … S10). */
export const SIZE_VALUES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Component grades (class A … D). */
export const GRADE_VALUES: readonly string[] = ['A', 'B', 'C', 'D'];

export interface ParsedQuery {
  /** Chips found in the text, in order of appearance (one per attribute). */
  chips: SearchChip[];
  /** The text without the words that became chips, single-spaced. */
  rest: string;
  /** Per chip id: the words it was read from ("größe 3", "s4") — for the "gelesen als" line. */
  words: Record<string, string>;
}

const SIZE_WORDS = new Set(['groesse', 'grosse', 'gross', 'size', 'gr', 'sz']);
const GRADE_WORDS = new Set(['klasse', 'class', 'grade', 'kl']);

function fold(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/\.$/, '');
}

export function sizeChip(size: number, source: SearchChip['source'] = 'parsed'): SearchChip {
  return {
    id: `${source}:size`,
    source,
    labelKey: 'search.chip.size',
    labelParams: { size },
    filter: { size },
    options: SIZE_VALUES.map((v) => option(`${v}`, 'search.chip.size', { size: v })),
    switchable: true,
  };
}

export function gradeChip(grade: string, source: SearchChip['source'] = 'parsed'): SearchChip {
  const g = grade.toUpperCase();
  return {
    id: `${source}:grade`,
    source,
    labelKey: 'search.chip.grade',
    labelParams: { grade: g },
    filter: { grade: g },
    options: GRADE_VALUES.map((v) => option(v, 'search.chip.grade', { grade: v })),
    switchable: true,
  };
}

function option(value: string, labelKey: string, labelParams: Record<string, string | number>): SearchChipOption {
  return { value, labelKey, labelParams, count: null };
}

const WISHED_WORDS = new Set(['gemerkt', 'wunschliste', 'wished', 'wishlist']);
const NEEDED_WORDS = new Set(['nachschub', 'needed', 'missing']);
const STOCK_WORDS = new Set(['lager', 'inventar', 'inventory', 'stock']);

/** "gemerkt" / "fehlt mir" / "lager" among the words: the filter chip and the words it used. */
function ownWordChip(words: readonly string[]): { chip: SearchChip; used: string[] } | null {
  for (let i = 0; i < words.length; i++) {
    const w = fold(words[i]);
    const own = (id: string, labelKey: string, filter: SearchChip['filter'], used: string[]): { chip: SearchChip; used: string[] } => ({
      chip: { id: `parsed:${id}`, source: 'parsed', labelKey, labelParams: null, filter, switchable: false },
      used,
    });
    if (WISHED_WORDS.has(w)) return own('wished', 'search.chip.wished', { wished: true }, [words[i]]);
    if (NEEDED_WORDS.has(w)) return own('needed', 'search.chip.needed', { needed: true }, [words[i]]);
    if (w === 'fehlt' && fold(words[i + 1] ?? '') === 'mir') return own('needed', 'search.chip.needed', { needed: true }, [words[i], words[i + 1]]);
    if (STOCK_WORDS.has(w)) return own('stock', 'search.chip.section.stock', { ownKinds: ['item'], ownFirst: true }, [words[i]]);
  }
  return null;
}

/** Pull size and grade chips out of the text. At most one chip per attribute (the first wins). */
export function parseQuery(text: string): ParsedQuery {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  let size: number | null = null;
  let grade: string | null = null;
  const words2: Record<string, string> = {};
  for (let i = 0; i < words.length; i++) {
    const w = fold(words[i]);
    const next = i + 1 < words.length ? fold(words[i + 1]) : '';
    let m: RegExpMatchArray | null;
    const start = i;
    const before: { size: number | null; grade: string | null } = { size, grade };
    if (size === null && (m = w.match(/^s(\d{1,2})$/)) && SIZE_VALUES.includes(+m[1])) {
      size = +m[1];
    } else if (size === null && (m = w.match(/^(groesse|grosse|size|gr|sz)(\d{1,2})$/)) && SIZE_VALUES.includes(+m[2])) {
      size = +m[2];
    } else if (size === null && SIZE_WORDS.has(w) && /^s?\d{1,2}$/.test(next) && SIZE_VALUES.includes(+next.replace('s', ''))) {
      size = +next.replace('s', '');
      i++;
    } else if (grade === null && (m = w.match(/^(klasse|class|grade|kl)([a-d])$/))) {
      grade = m[2].toUpperCase();
    } else if (grade === null && GRADE_WORDS.has(w) && /^[a-d]$/.test(next)) {
      grade = next.toUpperCase();
      i++;
    } else {
      keep.push(words[i]);
    }
    if (size !== before.size) words2['parsed:size'] = words.slice(start, i + 1).join(' ');
    if (grade !== before.grade) words2['parsed:grade'] = words.slice(start, i + 1).join(' ');
  }
  const chips: SearchChip[] = [];
  // Own-data words only count as a filter beside a search term ("gemerkt aegis"); alone they stay text.
  const ownWord = ownWordChip(keep);
  if (ownWord && keep.length > ownWord.used.length) {
    chips.push(ownWord.chip);
    for (const w of ownWord.used) keep.splice(keep.indexOf(w), 1);
    words2[ownWord.chip.id] = ownWord.used.join(' ');
  }
  if (size !== null) chips.push(sizeChip(size));
  if (grade !== null) chips.push(gradeChip(grade));
  return { chips, rest: keep.join(' '), words: words2 };
}

/**
 * The chip with another value picked from its menu (S1 → S3). Returns the chip
 * unchanged when the chip is not switchable or the value is unknown.
 */
export function switchChip(chip: SearchChip, value: string): SearchChip {
  if (!chip.switchable || !chip.options?.some((o) => o.value === value)) return chip;
  if (chip.filter.size !== undefined) return { ...sizeChip(+value, chip.source), options: chip.options };
  if (chip.filter.grade !== undefined) return { ...gradeChip(value, chip.source), options: chip.options };
  if (chip.filter.groups) {
    const picked = chip.options.find((o) => o.value === value)!;
    return {
      ...chip,
      id: `${chip.source}:kind:${value}`,
      labelKey: picked.labelKey,
      labelParams: picked.labelParams ?? null,
      filter: { ...chip.filter, groups: [value as never] },
    };
  }
  return chip;
}

/** Fill the option counts of a chip from a value → count map (values missing from it count 0). */
export function withOptionCounts(chip: SearchChip, counts: Readonly<Record<string, number>>): SearchChip {
  if (!chip.options) return chip;
  return { ...chip, options: chip.options.map((o) => ({ ...o, count: counts[o.value] ?? 0 })) };
}

/** True when the menu needs its mini-search (more than 7 values — owner, round 1). */
export function needsMiniSearch(chip: SearchChip): boolean {
  return (chip.options?.length ?? 0) > 7;
}
