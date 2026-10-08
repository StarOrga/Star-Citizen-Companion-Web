/**
 * The Upload card's stage list — a checklist that replaces the step chips,
 * the detail line and the stack of success lines that used to fill the card:
 *
 *   ✓ Bundle                 +12 / −3
 *   ● Codex
 *       ✓ Silhouetten bauen  4.494
 *       ○ Einträge hochladen            ← the category bars open under this row
 *   ○ 3D-Modelle                          only while it runs
 *       ○ Modelle bauen
 *       ○ Modelle hochladen
 *
 * Every row carries its own state, so nothing reads "done" while its stage is
 * still pending (the old full category bars under a running silhouette build).
 * What used to be a line of text — bundle id, first-upload note, build counts,
 * category totals — is the row's tooltip (`data-tip`, info tier).
 *
 * Plain functions looking elements up by id: a call after the view is gone is
 * a no-op, same as the rest of the renderer.
 */

import { t } from '../../lib/i18n.js';

export type StageKey = 'bundle' | 'codex' | 'silhouettes' | 'entries' | 'skins' | 'skinsBuild' | 'skinsUpload';
/** The rows that do work; `codex` and `skins` only follow their two sub-rows. */
const LEAVES: StageKey[] = ['bundle', 'silhouettes', 'entries', 'skinsBuild', 'skinsUpload'];
const PARENT: Partial<Record<StageKey, { parent: StageKey; first: StageKey; second: StageKey }>> = {
  silhouettes: { parent: 'codex', first: 'silhouettes', second: 'entries' },
  entries: { parent: 'codex', first: 'silhouettes', second: 'entries' },
  skinsBuild: { parent: 'skins', first: 'skinsBuild', second: 'skinsUpload' },
  skinsUpload: { parent: 'skins', first: 'skinsBuild', second: 'skinsUpload' },
};
export type StageState = 'pending' | 'active' | 'done' | 'warn' | 'paused' | 'failed' | 'skipped';

const ICON: Record<StageState, string> = {
  pending: '○',
  active: '●',
  done: '✓',
  warn: '!',
  paused: '⏸',
  failed: '✕',
  skipped: '–',
};

const LABEL_KEY: Record<StageKey, string> = {
  bundle: 'upload.steps.bundle',
  codex: 'upload.steps.codex',
  silhouettes: 'upload.stages.silhouettes',
  entries: 'upload.stages.entries',
  skins: 'upload.steps.skins',
  skinsBuild: 'upload.stages.skinsBuild',
  skinsUpload: 'upload.stages.skinsUpload',
};

function row(key: StageKey, inner = ''): string {
  return `
    <li class="upload-stage" id="stage-${key}" data-stage="${key}" data-state="pending">
      <div class="upload-stage-line" id="stage-${key}-line">
        <span class="upload-stage-icon" aria-hidden="true">${ICON.pending}</span>
        <span class="upload-stage-label">${t(LABEL_KEY[key])}</span>
        <span class="upload-stage-meta" id="stage-${key}-meta"></span>
        <span class="sr-only" id="stage-${key}-state">${t('upload.stages.state.pending')}</span>
      </div>
      ${inner}
    </li>`;
}

/** `barsHtml` (the category bars) is mounted under the entries row. */
export function uploadStagesHtml(barsHtml: string): string {
  return `
    <ol class="upload-stages" aria-label="${t('upload.stages.aria')}">
      ${row('bundle')}
      ${row(
        'codex',
        `<ol class="upload-stages-sub">
          ${row('silhouettes')}
          ${row('entries', `<div class="upload-stage-bars" id="stage-entries-bars" hidden>${barsHtml}</div>`)}
        </ol>`,
      )}
      ${row(
        'skins',
        `<ol class="upload-stages-sub">
          ${row('skinsBuild')}
          ${row('skinsUpload')}
        </ol>`,
      )}
    </ol>`;
}

const el = (key: StageKey): HTMLElement | null => document.getElementById(`stage-${key}`);

function paint(key: StageKey, state: StageState, meta?: string): void {
  const li = el(key);
  if (!li) return;
  li.dataset.state = state;
  if (state === 'active') li.setAttribute('aria-current', 'step');
  else li.removeAttribute('aria-current');
  const icon = li.querySelector(':scope > .upload-stage-line > .upload-stage-icon');
  if (icon) icon.textContent = ICON[state];
  const stateEl = document.getElementById(`stage-${key}-state`);
  if (stateEl) stateEl.textContent = t(`upload.stages.state.${state}`);
  if (meta !== undefined) {
    const metaEl = document.getElementById(`stage-${key}-meta`);
    if (metaEl) metaEl.textContent = meta;
  }
}

/** A parent row (Codex, 3D-Modelle) follows its two sub-rows. */
function paintParent(parent: StageKey, first: StageKey, second: StageKey): void {
  const a = (el(first)?.dataset.state ?? 'pending') as StageState;
  const b = (el(second)?.dataset.state ?? 'pending') as StageState;
  const both = [a, b];
  const state: StageState = both.includes('failed')
    ? 'failed'
    : both.includes('paused')
      ? 'paused'
      : both.includes('active')
        ? 'active'
        : b === 'done' || b === 'skipped'
          ? a === 'warn'
            ? 'warn'
            : b === 'skipped' && (a === 'skipped' || a === 'pending')
              ? 'skipped'
              : 'done'
          : a === 'pending'
            ? 'pending'
            : 'active';
  paint(parent, state);
}

/** Set a row's state and (optionally) its right-hand meta text. */
export function setStage(key: StageKey, state: StageState, meta?: string): void {
  paint(key, state, meta);
  if (key === 'entries') {
    const bars = document.getElementById('stage-entries-bars');
    if (bars) bars.hidden = state !== 'active';
  }
  const family = PARENT[key];
  if (family) paintParent(family.parent, family.first, family.second);
}

/** Only the meta text (a ticking "948 / 4.494"), state untouched. */
export function setStageMeta(key: StageKey, meta: string): void {
  const metaEl = document.getElementById(`stage-${key}-meta`);
  if (metaEl) metaEl.textContent = meta;
}

/** The row's tooltip — the details that used to be lines of text. */
export function tipStage(key: StageKey, text: string): void {
  // On the row's own line, not the <li>: a sub-row must not show its parent's tip.
  const li = document.getElementById(`stage-${key}-line`);
  if (!li) return;
  if (text) {
    li.dataset.tip = text;
    li.tabIndex = 0; // the tooltip also opens on keyboard focus
  } else {
    delete li.dataset.tip;
    li.removeAttribute('tabindex');
  }
}

/** The row that is running right now (deepest first), if any. */
export function activeStage(): StageKey | null {
  for (const key of LEAVES) {
    if (el(key)?.dataset.state === 'active') return key;
  }
  return null;
}

/** A pause lands on whichever row was running. */
export function pauseActiveStage(): void {
  const key = activeStage();
  if (key) setStage(key, 'paused');
}

export function resetStages(): void {
  for (const key of LEAVES) {
    setStage(key, 'pending', '');
    tipStage(key, '');
  }
  tipStage('codex', '');
  tipStage('skins', '');
}
