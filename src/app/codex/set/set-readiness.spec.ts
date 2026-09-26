import { READY_ICON_PATHS, setReadiness } from './set-readiness';
import { READINESS_KEYS, computeReadiness } from '../codex-landing-kpi';

describe('setReadiness', () => {
  it('has a glyph for every readiness class the archive carries', () => {
    for (const key of READINESS_KEYS) expect(READY_ICON_PATHS[key]).toBeTruthy();
  });

  it('mirrors computeReadiness and adds glyph + tooltip keys', () => {
    const items = [{ className: null }];
    const plain = computeReadiness(items, new Map(), 'engineering');
    const glyphs = setReadiness(items, new Map(), 'engineering');
    expect(glyphs.map((g) => g.key)).toEqual(plain.map((r) => r.key));
    for (const g of glyphs) {
      expect(g.icon).toBe(READY_ICON_PATHS[g.key]);
      expect(g.labelKey).toBe('codex.landing.board.readiness.' + g.key);
      expect(g.stateKey).toBe(g.ok ? 'codex.landing.board.readyOn' : 'codex.landing.board.readyOff');
    }
  });

  it('reports every class as missing on an empty set', () => {
    const glyphs = setReadiness([], new Map(), null);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((g) => !g.ok && g.stateKey === 'codex.landing.board.readyOff')).toBe(true);
  });
});
