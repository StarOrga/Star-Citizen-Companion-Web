/**
 * Every spec starts at the top of the page, whatever ran before it.
 *
 * Specs share one Karma page and run in random order. Once leftovers make that
 * page tall, a spec that scrolls leaves `window.scrollY` behind for the rest of
 * the run, and every spec that needs the top of the page fails (the fusion bar
 * reads as docked, the header as compressed). That showed up as rare red runs
 * in unrelated specs, so the reset is global: a top-level `afterEach` applies to
 * every spec in the bundle.
 */
afterEach(() => {
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
});

describe('spec isolation: page scroll', () => {
  let tall: HTMLElement;

  it('may leave the page scrolled', () => {
    tall = document.createElement('div');
    tall.style.height = '10000px';
    document.body.appendChild(tall);
    window.scrollTo({ top: 500, behavior: 'instant' });
    expect(window.scrollY).toBeGreaterThan(0);
  });

  afterAll(() => {
    expect(window.scrollY, 'reset by the global afterEach').toBe(0);
    tall.remove();
  });
});
