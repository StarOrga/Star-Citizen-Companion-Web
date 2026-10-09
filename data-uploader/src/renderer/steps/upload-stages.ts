/**
 * The stage list of a run step. A run is cut vertically — every step takes ONE
 * topic all the way from the game files to the server before the next starts:
 *
 *   1 · Codex        ○ Daten extrahieren   ○ Bundle hochladen   ○ Einträge hochladen
 *   2 · Silhouetten  ○ Silhouetten bauen   ○ Silhouetten hochladen
 *   3 · 3D-Modelle   ○ Modelle bauen       ○ Modelle hochladen
 *
 * Each step is its own screen; only its rows are in the DOM. The state of
 * every row lives HERE (not in the DOM), so a re-render — the next step's
 * screen, a language switch, coming back after a pause — paints each row the
 * way it actually stands instead of "pending".
 *
 * What used to be a line of text — bundle id, first-upload note, build counts,
 * category totals — is the row's tooltip (`data-tip`, info tier).
 */

import { t } from '../../lib/i18n.js';

export type PipelineStep = 'codex' | 'silhouettes' | 'models';
export const PIPELINE_STEPS: readonly PipelineStep[] = ['codex', 'silhouettes', 'models'];

export type StageKey = 'extract' | 'bundle' | 'entries' | 'silBuild' | 'silUpload' | 'skinsBuild' | 'skinsUpload';

export const STEP_STAGES: Record<PipelineStep, readonly StageKey[]> = {
  codex: ['extract', 'bundle', 'entries'],
  silhouettes: ['silBuild', 'silUpload'],
  models: ['skinsBuild', 'skinsUpload'],
};

const ALL: readonly StageKey[] = PIPELINE_STEPS.flatMap((s) => STEP_STAGES[s]);

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

interface Row {
  state: StageState;
  meta: string;
  tip: string;
}

const rows = new Map<StageKey, Row>(ALL.map((k) => [k, { state: 'pending', meta: '', tip: '' }]));

const row = (key: StageKey): Row => rows.get(key) as Row;

function rowHtml(key: StageKey): string {
  const r = row(key);
  const tip = r.tip ? ` data-tip="${escapeAttr(r.tip)}" tabindex="0"` : '';
  return `
    <li class="upload-stage" id="stage-${key}" data-stage="${key}" data-state="${r.state}"${r.state === 'active' ? ' aria-current="step"' : ''}>
      <div class="upload-stage-line" id="stage-${key}-line"${tip}>
        <span class="upload-stage-icon" aria-hidden="true">${ICON[r.state]}</span>
        <span class="upload-stage-label">${t(`pipeline.stage.${key}`)}</span>
        <span class="upload-stage-meta" id="stage-${key}-meta">${escapeText(r.meta)}</span>
        <span class="sr-only" id="stage-${key}-state">${t(`upload.stages.state.${r.state}`)}</span>
      </div>
    </li>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** The rows of `step`. */
export function stagesHtml(step: PipelineStep): string {
  const items = STEP_STAGES[step].map((key) => rowHtml(key)).join('');
  return `<ol class="upload-stages" aria-label="${t('upload.stages.aria')}">${items}</ol>`;
}

function paint(key: StageKey): void {
  const li = document.getElementById(`stage-${key}`);
  if (!li) return;
  const r = row(key);
  li.dataset.state = r.state;
  if (r.state === 'active') li.setAttribute('aria-current', 'step');
  else li.removeAttribute('aria-current');
  const icon = li.querySelector(':scope > .upload-stage-line > .upload-stage-icon');
  if (icon) icon.textContent = ICON[r.state];
  const stateEl = document.getElementById(`stage-${key}-state`);
  if (stateEl) stateEl.textContent = t(`upload.stages.state.${r.state}`);
  const metaEl = document.getElementById(`stage-${key}-meta`);
  if (metaEl) metaEl.textContent = r.meta;
}

/** Set a row's state and (optionally) its right-hand meta text. */
export function setStage(key: StageKey, state: StageState, meta?: string): void {
  const r = row(key);
  r.state = state;
  if (meta !== undefined) r.meta = meta;
  paint(key);
}

/** Only the meta text (a ticking "948 / 4.494"), state untouched. */
export function setStageMeta(key: StageKey, meta: string): void {
  row(key).meta = meta;
  const metaEl = document.getElementById(`stage-${key}-meta`);
  if (metaEl) metaEl.textContent = meta;
}

/** The row's tooltip — the details that used to be lines of text. */
export function tipStage(key: StageKey, text: string): void {
  row(key).tip = text;
  const line = document.getElementById(`stage-${key}-line`);
  if (!line) return;
  if (text) {
    line.dataset.tip = text;
    line.tabIndex = 0; // the tooltip also opens on keyboard focus
  } else {
    delete line.dataset.tip;
    line.removeAttribute('tabindex');
  }
}

export function stageState(key: StageKey): StageState {
  return row(key).state;
}

/** The row that is running right now, if any. */
export function activeStage(): StageKey | null {
  return ALL.find((k) => row(k).state === 'active') ?? null;
}

/** A pause lands on whichever row was running. */
export function pauseActiveStage(): void {
  const key = activeStage();
  if (key) setStage(key, 'paused');
}

/** A step is finished once none of its rows is pending, running or paused. */
export function stepFinished(step: PipelineStep): boolean {
  return STEP_STAGES[step].every((k) => !['pending', 'active', 'paused'].includes(row(k).state));
}

/** Back to "pending" — all rows, or only the given ones. */
export function resetStages(keys: readonly StageKey[] = ALL): void {
  for (const key of keys) {
    rows.set(key, { state: 'pending', meta: '', tip: '' });
    paint(key);
    tipStage(key, '');
  }
}
