/**
 * Floating ‹ › carousel chevrons — the flow's position cue on both edges.
 * Back is offered wherever no work is in flight (Setup → Install, a finished
 * or failed Extract → Setup, an idle Upload → Setup); Next only Install →
 * Setup, because every later step starts with an explicit action. The
 * renderer decides availability (`paintChevrons`), the ←/→ keys follow it
 * (wired centrally in keymap.ts, which calls `handleChevronKey`).
 */

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

/**
 * Chevrons stay on both edges; they are disabled — never hidden — while
 * stepping that way is not possible, so the cue does not jump around. The
 * caller passes availability from the actual in-flight work: going back
 * mid-run would mean aborting, which stays an explicit action.
 */
export function paintChevrons(canPrev: boolean, canNext: boolean): void {
  const prev = document.getElementById('chevron-prev') as HTMLButtonElement | null;
  const nxt = document.getElementById('chevron-next') as HTMLButtonElement | null;
  if (prev) {
    prev.hidden = false;
    prev.disabled = !canPrev;
  }
  if (nxt) {
    nxt.hidden = false;
    nxt.disabled = !canNext;
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
