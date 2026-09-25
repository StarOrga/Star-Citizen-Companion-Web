/**
 * No spec may open a real browser tab.
 *
 * Navigations are real anchors in this app (CLAUDE.md), so plenty of specs
 * check that a Ctrl/⌘/Shift/middle click on one falls through to the browser.
 * If the spec then lets the browser act on it, Chrome opens an actual tab and
 * puts it in front — synthetic event or not. The Karma page turns hidden, and
 * a hidden page renders no frames: `requestAnimationFrame`, `ResizeObserver`
 * and Web Animations all stop for the rest of the run. The damage lands
 * elsewhere and later — whichever frame-driven specs the random order puts
 * after the culprit time out, a different handful per run (2026-09-25: the
 * HangarPicker's two Ctrl+click specs, a Karma 404 for `/hangar` and
 * `/codex/ship/b` in the log, then the patch dossier's timeouts).
 *
 * These hooks sit at the top level, so they run around EVERY spec of a full
 * run: a link click that would open a tab or window and that nobody prevented
 * fails the spec that made it, by name. The fix is on the spec's side —
 * swallow the default action once the code under test has had its say, e.g.
 * with a `preventDefault()` listener on `window` (see the HangarPicker spec).
 */

interface LinkClick {
  event: MouseEvent;
  href: string;
}

const linkClicks: LinkClick[] = [];

/** Would the browser open this click's link somewhere other than this page? */
function opensElsewhere(event: MouseEvent, link: Element): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1 || link.getAttribute('target') === '_blank';
}

function watch(event: Event): void {
  if (!(event instanceof MouseEvent)) return;
  const link = event.composedPath().find((node): node is Element => node instanceof Element && node.matches('a[href], area[href]'));
  if (link && opensElsewhere(event, link)) linkClicks.push({ event, href: link.getAttribute('href') ?? '' });
}

// Capture phase: seen before any listener of the page can stop the event.
// Whether it was prevented is only final once the dispatch is over — hence
// the check in `afterEach`, not here.
window.addEventListener('click', watch, true);
window.addEventListener('auxclick', watch, true);

beforeEach(() => {
  linkClicks.length = 0;
});

afterEach(() => {
  for (const { event, href } of linkClicks.splice(0)) {
    if (event.defaultPrevented) continue;
    fail(
      `A ${event.type} on <a href="${href}"> reached the browser, which opens a REAL tab or window: ` +
        'the Karma page drops to the background and renders no more frames. ' +
        'Prevent the default action once the code under test has seen the click.',
    );
  }
});

// A module, not a script: nothing above leaks into the other specs' scope.
export {};
