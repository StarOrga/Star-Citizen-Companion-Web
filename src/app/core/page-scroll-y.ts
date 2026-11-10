/** The class the CDK block scroll strategy puts on `<html>` while a modal overlay is open. */
export const CDK_SCROLL_BLOCK_CLASS = 'cdk-global-scrollblock';

/**
 * The page's real scroll depth, also while a CDK overlay blocks the scroll.
 *
 * The block strategy (confirm dialogs, pickers, quick search) pins `<html>` with
 * `position: fixed; top: -<y>px`, so `window.scrollY` drops to 0 and the browser fires
 * a scroll event — although the page did not move on screen. Scroll-linked chrome
 * (the condensing subheader, hide-on-scroll bars) read that 0 as "back at the top" and
 * jumped into their top-of-page state behind the dialog (#336). While the block is on,
 * the frozen offset lives in `<html>`'s inline `top`; this returns it instead.
 */
export function pageScrollY(): number {
  if (typeof window === 'undefined') return 0;
  const html = document.documentElement;
  if (html.classList.contains(CDK_SCROLL_BLOCK_CLASS)) {
    const top = parseFloat(html.style.top);
    if (Number.isFinite(top)) return Math.max(0, -top);
  }
  return window.scrollY;
}
