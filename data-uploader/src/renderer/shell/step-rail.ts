/**
 * Step rail — the position indicator for the whole one-screen flow
 * (Install · Setup · Extract · Upload · Done). Paints into `#step-rail`
 * (see index.html). The active Extract/Upload node's incoming line segment
 * fills with the overall run percentage, so the rail doubles as a macro
 * progress bar without a second progress element competing for attention.
 */

import { t } from '../../lib/i18n.js';

export type StepKey = 'install' | 'setup' | 'extract' | 'upload' | 'done';

export const STEP_ORDER: StepKey[] = ['install', 'setup', 'extract', 'upload', 'done'];

function labelFor(step: StepKey): string {
  return t(`steprail.${step}`);
}

export interface StepRailState {
  current: StepKey;
  /** 0-100 fill for the incoming segment of the active extract/upload node. */
  activePct: number;
}

/**
 * Live update of the active node's incoming fill without repainting the rail —
 * called from the progress card on every overall-percentage change, so the
 * rail actually moves during a run (a full repaint only happens per view).
 */
export function setStepRailFill(pct: number): void {
  const fill = document.querySelector<HTMLElement>('#step-rail .step-rail-fill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

export function paintStepRail(s: StepRailState): void {
  const mount = document.getElementById('step-rail');
  if (!mount) return;
  const curIdx = STEP_ORDER.indexOf(s.current);
  mount.innerHTML = STEP_ORDER.map((step, i) => {
    const state = i < curIdx ? 'done' : i === curIdx ? 'active' : 'locked';
    const fill =
      i === curIdx && (step === 'extract' || step === 'upload')
        ? `<span class="step-rail-fill" style="width:${Math.max(0, Math.min(100, s.activePct))}%"></span>`
        : '';
    const segment =
      i > 0
        ? `<span class="step-rail-seg ${i <= curIdx ? 'filled' : ''}">${fill}</span>`
        : '';
    return `${segment}<span class="step-rail-node step-rail-node--${state}" data-step="${step}" title="${labelFor(step)}">
        <span class="step-rail-dot"></span>
        <span class="step-rail-label">${labelFor(step)}</span>
      </span>`;
  }).join('');
}
