import { isMiddleClick, isPlainLeftClick } from './modified-click.util';

function click(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', { button: 0, ...init });
}

describe('modified-click util (d2171662)', () => {
  it('treats a bare left click as plain — the app handles it', () => {
    expect(isPlainLeftClick(click())).toBe(true);
  });

  it('does not treat a middle click as plain — the browser opens a new tab', () => {
    expect(isPlainLeftClick(click({ button: 1 }))).toBe(false);
    expect(isMiddleClick(click({ button: 1 }))).toBe(true);
  });

  it('does not treat a right click as plain', () => {
    expect(isPlainLeftClick(click({ button: 2 }))).toBe(false);
  });

  for (const mod of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
    it(`lets ${mod} fall through to the browser`, () => {
      expect(isPlainLeftClick(click({ [mod]: true }))).toBe(false);
    });
  }

  it('reports only the middle button as a middle click', () => {
    expect(isMiddleClick(click({ button: 0 }))).toBe(false);
    expect(isMiddleClick(click({ button: 2 }))).toBe(false);
  });
});
