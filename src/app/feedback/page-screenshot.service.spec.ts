import { CAPTURE_HIDE_ATTR, isHidden, shiftFixed } from './page-screenshot.service';

/**
 * The two rules that decide whether a page screenshot is usable at all (admin
 * feedback 312a4acc):
 *
 * - the feedback launcher and its panel must NOT be in the picture — the shot
 *   exists to show the page, and the panel is only on screen because the user
 *   is filing a report about it;
 * - `position: fixed` chrome must land where it is on screen. The capture root
 *   is translated by the scroll offset, and a fixed element's containing block
 *   in the clone is that translated root — so without the correction the header
 *   renders `scrollY` pixels too high, which on a scrolled page means "not in
 *   the picture at all".
 */
describe('page screenshot helpers', () => {
  describe('isHidden', () => {
    it('drops a subtree marked as capture-hidden', () => {
      const el = document.createElement('div');
      el.setAttribute(CAPTURE_HIDE_ATTR, '');
      expect(isHidden(el)).toBeTrue();
    });

    it('drops the CDK overlay container, where the panel portals its lightboxes', () => {
      const el = document.createElement('div');
      el.className = 'cdk-overlay-container';
      expect(isHidden(el)).toBeTrue();
    });

    it('keeps ordinary page content', () => {
      const el = document.createElement('section');
      el.className = 'sc-card';
      expect(isHidden(el)).toBeFalse();
    });

    it('keeps text nodes — they are not elements and carry no marker', () => {
      expect(isHidden(document.createTextNode('hello'))).toBeFalse();
    });
  });

  describe('shiftFixed', () => {
    it('adds the scroll offset back onto a fixed element', () => {
      const el = document.createElement('header');
      el.style.position = 'fixed';
      el.style.top = '0px';
      el.style.left = '0px';
      shiftFixed(el, 12, 400);
      expect(el.style.top).toBe('400px');
      expect(el.style.left).toBe('12px');
    });

    it('releases bottom/right so the corrected box is not over-constrained', () => {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.top = '600px';
      el.style.left = '300px';
      el.style.bottom = '24px';
      el.style.right = '24px';
      shiftFixed(el, 0, 100);
      expect(el.style.bottom).toBe('auto');
      expect(el.style.right).toBe('auto');
      expect(el.style.top).toBe('700px');
    });

    it('leaves an `auto` edge alone instead of writing NaN into it', () => {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.top = 'auto';
      shiftFixed(el, 0, 300);
      expect(el.style.top).toBe('auto');
    });

    it('does not touch anything that is not fixed', () => {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.top = '10px';
      shiftFixed(el, 0, 300);
      expect(el.style.top).toBe('10px');
    });

    it('ignores non-element nodes', () => {
      expect(() => shiftFixed(document.createTextNode('x'), 0, 10)).not.toThrow();
    });
  });
});
