/**
 * Five category bars under the Extract and the Upload card, in the order the
 * work actually runs: Texte, Schiffe, Komponenten, Waffen, Gegenstände — the
 * extractor projects its catalogs and the catalog upload sends its tables in
 * this same order, so the bars fill left to right.
 *
 * Each bar is driven by cumulative counts per source key — the sidecar's
 * `count` events while extracting, the catalog phases' rows sent while
 * uploading. Once an `expected` total is known for every key of a category
 * (the classification pre-pass, a one-shot counter's final value, a phase's
 * row total) the bar becomes a real "x / y" percentage. Until then it shows an
 * honest scanning stripe — no number is ever invented. At completion a bar is
 * solid success, or empty + "—" when the category yielded nothing. Every
 * change flashes a bright head on its bar once (the "Datenpunkt-Tick");
 * `prefers-reduced-motion` swaps the flash for a static head (CSS only).
 */

import { t } from '../../lib/i18n.js';

export type CategorySource = 'extract' | 'upload';

interface Category {
  key: string;
  labelKey: string;
  /** Extractor counter keys (sidecar `count` events). */
  counters: string[];
  /** Catalog upload phases (catalog-bridge progress events). */
  phases: string[];
}

const CATEGORIES: Category[] = [
  { key: 'strings', labelKey: 'category.strings', counters: ['strings'], phases: ['codex_locale_strings'] },
  { key: 'ships', labelKey: 'category.ships', counters: ['ships'], phases: ['codex_ships'] },
  { key: 'components', labelKey: 'category.components', counters: ['components'], phases: ['codex_components'] },
  {
    key: 'weapons',
    labelKey: 'category.weapons',
    counters: ['weapons', 'ammunition'],
    phases: ['codex_weapons', 'codex_ammunition'],
  },
  { key: 'items', labelKey: 'category.items', counters: ['items'], phases: ['codex_items'] },
];

/**
 * Planned upload totals per catalog phase, seeded from the extract's entity
 * counts so every bar shows "0 / y" before its phase starts; the phase's own
 * row total replaces the seed once it runs.
 */
export function uploadExpectedFromCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CATEGORIES) {
    c.counters.forEach((counter, i) => {
      const phase = c.phases[i];
      if (phase && typeof counts[counter] === 'number') out[phase] = counts[counter];
    });
  }
  return out;
}

/** Last running total per category — the source of truth for the "empty" verdict at completion. */
const totals: Record<string, number> = {};

export function categoryBarsHtml(): string {
  return `
    <div class="category-bars" id="category-bars">
      ${CATEGORIES.map(
        (c) => `
        <div class="category-bar" id="cat-bar-${c.key}">
          <div class="category-bar-label">${t(c.labelKey)}</div>
          <div class="category-bar-track"><span class="category-bar-fill" id="cat-fill-${c.key}"></span></div>
          <div class="category-bar-count" id="cat-count-${c.key}">0</div>
        </div>`,
      ).join('')}
    </div>`;
}

export function resetCategoryBars(): void {
  for (const c of CATEGORIES) {
    const fill = document.getElementById(`cat-fill-${c.key}`);
    const count = document.getElementById(`cat-count-${c.key}`);
    fill?.classList.remove('active', 'done', 'flash', 'empty', 'measured');
    fill?.style.removeProperty('width');
    count?.classList.remove('empty');
    if (count) count.textContent = '0';
    totals[c.key] = 0;
  }
}

/** Planned total for a category, or null while any of its keys is still unannounced. */
function expectedFor(keys: string[], expectedMap: Record<string, number>): number | null {
  let sum = 0;
  for (const k of keys) {
    const e = expectedMap[k];
    if (typeof e !== 'number') return null;
    sum += e;
  }
  return sum;
}

/**
 * Update the bars from a cumulative count map plus the `expected` totals
 * announced so far, keyed by extractor counter (`source: 'extract'`) or by
 * catalog phase (`'upload'`). A category with a known total gets a measured
 * width; one without keeps the scanning stripe.
 */
export function updateCategoryBars(
  countMap: Record<string, number>,
  expectedMap: Record<string, number> = {},
  source: CategorySource = 'extract',
): void {
  for (const c of CATEGORIES) {
    const keys = source === 'upload' ? c.phases : c.counters;
    const total = keys.reduce((sum, k) => sum + (countMap[k] ?? 0), 0);
    const fill = document.getElementById(`cat-fill-${c.key}`);
    const count = document.getElementById(`cat-count-${c.key}`);
    if (!fill || fill.classList.contains('done')) continue;
    const expected = expectedFor(keys, expectedMap);
    if (expected !== null && expected > 0) {
      fill.classList.add('measured');
      fill.classList.remove('active');
      fill.style.width = `${Math.min(100, (total / expected) * 100)}%`;
      if (count) count.textContent = `${total.toLocaleString()} / ${expected.toLocaleString()}`;
    } else if (total > 0) {
      fill.classList.add('active');
      if (count) count.textContent = total.toLocaleString();
    }
    if (total <= 0) continue;
    if (total !== totals[c.key]) {
      // Datenpunkt-Tick: one bright-head flash per real change, raw (no smoothing).
      fill.classList.remove('flash');
      // eslint-disable-next-line no-void
      void fill.offsetWidth; // restart the CSS animation
      fill.classList.add('flash');
    }
    totals[c.key] = total;
    count?.classList.remove('empty');
  }
}

/**
 * The work behind the bars is over — freeze every bar: solid success where
 * the category produced items, empty + "—" where it produced none (a full
 * green bar over a zero would claim a completeness that never happened).
 * Idempotent: called on the validate/bundle phase AND on done, so the verdict
 * comes from the tracked counts, not from a class the first call removed.
 */
export function markCategoriesComplete(): void {
  for (const c of CATEGORIES) {
    const fill = document.getElementById(`cat-fill-${c.key}`);
    const count = document.getElementById(`cat-count-${c.key}`);
    const empty = (totals[c.key] ?? 0) <= 0;
    fill?.classList.remove('active', 'flash', 'measured');
    fill?.style.removeProperty('width');
    fill?.classList.add('done');
    fill?.classList.toggle('empty', empty);
    if (count) {
      count.classList.toggle('empty', empty);
      count.textContent = empty ? '—' : (totals[c.key] ?? 0).toLocaleString();
    }
  }
}
