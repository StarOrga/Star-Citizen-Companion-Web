/**
 * Five category bars under the Extract card: Schiffe, Komponenten, Waffen,
 * Gegenstände, Texte. Each one is driven by the sidecar's cumulative `count`
 * events; once the sidecar has announced an `expected` total for every counter
 * of a category (the classification pre-pass, or the final value of a one-shot
 * counter) the bar becomes a real "x / y" percentage. Until then it shows an
 * honest scanning stripe — no number is ever invented. At completion a bar is
 * solid success, or empty + "—" when the category yielded nothing. Every count
 * event flashes a bright head on its bar once (the "Datenpunkt-Tick");
 * `prefers-reduced-motion` swaps the flash for a static head (CSS only).
 */

import { t } from '../../lib/i18n.js';

interface Category {
  key: string;
  labelKey: string;
  counters: string[];
}

const CATEGORIES: Category[] = [
  { key: 'ships', labelKey: 'category.ships', counters: ['ships'] },
  { key: 'components', labelKey: 'category.components', counters: ['components'] },
  { key: 'weapons', labelKey: 'category.weapons', counters: ['weapons', 'ammunition'] },
  { key: 'items', labelKey: 'category.items', counters: ['items'] },
  { key: 'strings', labelKey: 'category.strings', counters: ['strings'] },
];

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

/** Planned total for a category, or null while any of its counters is still unannounced. */
function expectedFor(c: Category, expectedMap: Record<string, number>): number | null {
  let sum = 0;
  for (const k of c.counters) {
    const e = expectedMap[k];
    if (typeof e !== 'number') return null;
    sum += e;
  }
  return sum;
}

/**
 * Update the bars from the extractor's cumulative `count` map plus the
 * `expected` totals announced so far. A category with a known total gets a
 * measured width; one without keeps the scanning stripe.
 */
export function updateCategoryBars(countMap: Record<string, number>, expectedMap: Record<string, number> = {}): void {
  for (const c of CATEGORIES) {
    const total = c.counters.reduce((sum, k) => sum + (countMap[k] ?? 0), 0);
    const fill = document.getElementById(`cat-fill-${c.key}`);
    const count = document.getElementById(`cat-count-${c.key}`);
    if (!fill || fill.classList.contains('done')) continue;
    const expected = expectedFor(c, expectedMap);
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
 * Extraction moved past "Auslesen" — freeze every bar: solid success where the
 * category produced items, empty + "—" where it produced none (a full green
 * bar over a zero would claim a completeness that never happened). Idempotent:
 * called on the validate/bundle phase AND on done, so the verdict comes from
 * the tracked counts, not from a class the first call removed.
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
