import { routeMorphOf } from './fusion-bar.model';

/**
 * A route change plays the header/bar morph only between a main page and a
 * subpage. On a main page the condense follows the scroll (see dockProgress),
 * so a page switch from a docked main page only jumps back silently.
 */
describe('fusion bar: route-aware morph', () => {
  it('morphs header and bar between main page and subpage', () => {
    expect(routeMorphOf(true, false)).toBe('dock');
    expect(routeMorphOf(true, false)).toBe('dock');
    expect(routeMorphOf(false, true)).toBe('undock');
  });

  it('never morphs a main to main switch, docked or not: the progress snaps to 0 instead', () => {
    expect(routeMorphOf(true, true)).toBeNull();
    expect(routeMorphOf(true, true)).toBeNull();
    expect(routeMorphOf(false, false)).toBeNull();
  });
});
