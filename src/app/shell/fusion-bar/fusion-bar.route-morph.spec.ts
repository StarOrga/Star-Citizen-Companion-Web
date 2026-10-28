import { routeMorphOf, scrollMorphOf } from './fusion-bar.model';

/**
 * Wave A parity (audit G14 / N1–N3): the dock state machine must tell the
 * user's own scroll from a route change or a programmatic scroll reset.
 */
describe('fusion bar: route-aware dock state machine', () => {
  it('plays the morph only for the user scroll', () => {
    expect(scrollMorphOf(false, true, false)).toBe('dock');
    expect(scrollMorphOf(true, false, false)).toBe('undock');
    expect(scrollMorphOf(true, true, false)).toBeNull();
  });

  it('ignores a route-driven scroll reset: it snaps, never the undock morph', () => {
    expect(scrollMorphOf(true, false, true)).toBe('snap');
    expect(scrollMorphOf(false, true, true)).toBe('snap');
    expect(scrollMorphOf(false, false, true)).toBeNull();
  });

  it('morphs header and bar between main page and subpage, undocks docked main → main', () => {
    expect(routeMorphOf(true, false, false)).toBe('dock');
    expect(routeMorphOf(true, false, true)).toBe('dock');
    expect(routeMorphOf(false, true, false)).toBe('undock');
    expect(routeMorphOf(true, true, true)).toBe('undock');
    expect(routeMorphOf(true, true, false)).toBeNull();
    expect(routeMorphOf(false, false, false)).toBeNull();
  });
});
