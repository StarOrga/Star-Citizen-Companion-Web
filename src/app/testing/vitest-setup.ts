/**
 * Setup for the specs that run under Vitest (`npm run test:vitest`); runs in
 * the browser before every spec file, after the builder's own TestBed setup
 * (which already loaded `zone.js/testing`).
 *
 * 1. Zone's Vitest patch. `fakeAsync` / `tick` / `flush` need every spec to
 *    run inside a ProxyZone. Under Karma, `zone.js/testing` patches Jasmine's
 *    `it`; Vitest's globals are only wrapped by this separate plugin, which
 *    the builder does not load. Without it every `fakeAsync` spec fails with
 *    "Expected to be running in 'ProxyZone'".
 *
 * 2. The new-tab guard of `new-tab-guard.spec.ts`, in Vitest's terms: a link
 *    click that would open a REAL tab or window and that nobody prevented
 *    fails the spec that made it. (See that file for why: a hidden test page
 *    renders no more frames.)
 */
import 'zone.js/plugins/vitest-patch';

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

// The setup file runs once per spec file in the same page (isolate: false),
// so the capture listeners are installed only once.
const GUARD = Symbol.for('verse-companion/new-tab-guard');
const host = globalThis as typeof globalThis & { [GUARD]?: true };
if (!host[GUARD]) {
  host[GUARD] = true;
  window.addEventListener('click', watch, true);
  window.addEventListener('auxclick', watch, true);
}

beforeEach(() => {
  linkClicks.length = 0;
});

afterEach(() => {
  for (const { event, href } of linkClicks.splice(0)) {
    if (event.defaultPrevented) continue;
    throw new Error(
      `A ${event.type} on <a href="${href}"> reached the browser, which opens a REAL tab or window: ` +
        'the test page drops to the background and renders no more frames. ' +
        'Prevent the default action once the code under test has seen the click.',
    );
  }
});
