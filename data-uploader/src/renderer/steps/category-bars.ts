/**
 * Five category bars shown side by side under the Extract card (Ⓐ″3):
 * Schiffe, Fahrzeuge, Komponenten, Waffen, Texte. No grand total (216.900) is
 * ever shown — only per-category counts, since the sidecar's `count` events
 * carry a running value per counter key but no per-category total ahead of
 * time. Each bar is count-only while the category is running (striped,
 * indeterminate) and turns solid/green once the extract phase advances past
 * "Auslesen" (validate/bundle/done). Every count event flashes a bright head
 * on its bar once — the "Datenpunkt-Tick" — `prefers-reduced-motion` swaps
 * the flash for a static bright head (handled purely in CSS).
 */

import { t } from '../../lib/i18n.js';

interface Category {
  key: string;
  labelKey: string;
  counters: string[];
}

const CATEGORIES: Category[] = [
  { key: 'ships', labelKey: 'category.ships', counters: ['ships'] },
  { key: 'vehicles', labelKey: 'category.vehicles', counters: ['vehicles'] },
  { key: 'components', labelKey: 'category.components', counters: ['components', 'items'] },
  { key: 'weapons', labelKey: 'category.weapons', counters: ['weapons', 'ammunition'] },
  { key: 'strings', labelKey: 'category.strings', counters: ['strings'] },
];

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
    fill?.classList.remove('active', 'done', 'flash');
    if (count) count.textContent = '0';
  }
}

/** Update the per-category running totals from the extractor's cumulative `count` map. */
export function updateCategoryBars(countMap: Record<string, number>): void {
  for (const c of CATEGORIES) {
    const total = c.counters.reduce((sum, k) => sum + (countMap[k] ?? 0), 0);
    if (total <= 0) continue;
    const fill = document.getElementById(`cat-fill-${c.key}`);
    const count = document.getElementById(`cat-count-${c.key}`);
    if (count) count.textContent = total.toLocaleString();
    if (fill && !fill.classList.contains('done')) {
      fill.classList.add('active');
      // Datenpunkt-Tick: one bright-head flash per event, raw (no smoothing).
      fill.classList.remove('flash');
      // eslint-disable-next-line no-void
      void fill.offsetWidth; // restart the CSS animation
      fill.classList.add('flash');
    }
  }
}

/** Extraction moved past "Auslesen" — freeze every bar at 100%/green. */
export function markCategoriesComplete(): void {
  for (const c of CATEGORIES) {
    const fill = document.getElementById(`cat-fill-${c.key}`);
    fill?.classList.remove('active');
    fill?.classList.add('done');
  }
}
