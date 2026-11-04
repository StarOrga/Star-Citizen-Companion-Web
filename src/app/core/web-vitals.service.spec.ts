import { areaOf, clsFromShifts, inpFromInteractions } from './web-vitals.service';

describe('web vitals helpers', () => {
  it('reports only the first path segment', () => {
    expect(areaOf('/codex/ship/AEGS_Gladius')).toBe('/codex');
    expect(areaOf('/verse')).toBe('/verse');
    expect(areaOf('/')).toBe('/');
    expect(areaOf('')).toBe('/');
  });

  it('takes the largest session window for CLS', () => {
    // Window 1: 0.1 + 0.05 (gap < 1 s); window 2 starts after a 2 s gap: 0.2 + 0.02.
    const shifts = [
      { startTime: 100, value: 0.1 },
      { startTime: 600, value: 0.05 },
      { startTime: 2600, value: 0.2 },
      { startTime: 3000, value: 0.02 },
    ];
    expect(clsFromShifts(shifts)).toBe(0.22);
    expect(clsFromShifts([])).toBe(0);
  });

  it('closes a CLS window after 5 s even without a gap', () => {
    const shifts = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.01 }));
    // 0, 900 … 4500 fit into the first window (6 shifts); 5400 starts a new one.
    expect(clsFromShifts(shifts)).toBe(0.06);
  });

  it('uses the worst interaction, ignoring one outlier per 50 for INP', () => {
    expect(inpFromInteractions([])).toBeNull();
    expect(inpFromInteractions([40, 120, 80])).toBe(120);
    const many = Array.from({ length: 60 }, (_, i) => 50 + i);
    many.push(900); // one outlier among 61 interactions is ignored
    expect(inpFromInteractions(many)).toBe(109);
  });
});
