/**
 * Floating ‹ › carousel chevrons — only meaningful between Install ↔ Setup,
 * before a run is live (see brief: "no Back during a run — abort is an
 * explicit action"). Hidden/disabled everywhere else, including the ←/→ keys
 * (wired centrally in keymap.ts, which calls `wireChevrons`'s handlers).
 */

import type { StepKey } from './step-rail.js';

export interface ChevronCtx {
  goPrev: () => void;
  goNext: () => void;
}

let ctx: ChevronCtx | null = null;

export function wireChevrons(next: ChevronCtx): void {
  ctx = next;
  const prev = document.getElementById('chevron-prev');
  const nxt = document.getElementById('chevron-next');
  prev?.addEventListener('click', () => ctx?.goPrev());
  nxt?.addEventListener('click', () => ctx?.goNext());
}

/** Show the chevrons only on install/setup, before any run has started. */
export function paintChevrons(step: StepKey, runStarted: boolean): void {
  const prev = document.getElementById('chevron-prev') as HTMLButtonElement | null;
  const nxt = document.getElementById('chevron-next') as HTMLButtonElement | null;
  const visible = !runStarted && (step === 'install' || step === 'setup');
  if (prev) {
    prev.hidden = !visible || step === 'install';
    prev.disabled = !visible || step === 'install';
  }
  if (nxt) {
    nxt.hidden = !visible || step === 'setup';
    nxt.disabled = !visible || step === 'setup';
  }
}

/** Global ←/→ handling — no-ops when the chevrons are hidden/disabled. */
export function handleChevronKey(key: string): boolean {
  const prev = document.getElementById('chevron-prev') as HTMLButtonElement | null;
  const nxt = document.getElementById('chevron-next') as HTMLButtonElement | null;
  if (key === 'ArrowLeft' && prev && !prev.hidden && !prev.disabled) {
    ctx?.goPrev();
    return true;
  }
  if (key === 'ArrowRight' && nxt && !nxt.hidden && !nxt.disabled) {
    ctx?.goNext();
    return true;
  }
  return false;
}
