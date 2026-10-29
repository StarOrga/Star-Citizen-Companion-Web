import {
  AREA_ENTRIES,
  DOCK_SCROLL_PX,
  STAGE_DOCK_PX,
  STAGE_UNDOCK_PX,
  nextStageDocked,
  dockProgress,
  plateBackOf,
} from './fusion-bar.model';

describe('Gleiche Leiste: the scroll-linked condense progress', () => {
  it('maps the scroll distance linearly onto 0 to 1 and clamps both ends', () => {
    expect(dockProgress(0)).toBe(0);
    expect(dockProgress(-30)).toBe(0);
    expect(dockProgress(DOCK_SCROLL_PX / 2)).toBeCloseTo(0.5, 5);
    expect(dockProgress(DOCK_SCROLL_PX)).toBe(1);
    expect(dockProgress(DOCK_SCROLL_PX * 5)).toBe(1);
    expect(dockProgress(NaN)).toBe(0);
  });

  it('is reversible: the same depth gives the same progress on the way down and up', () => {
    const down = [0, 40, 80, 120, 160].map(dockProgress);
    const up = [160, 120, 80, 40, 0].map(dockProgress).reverse();
    expect(up).toEqual(down);
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeGreaterThan(down[i - 1]);
  });
});

describe('Gleiche Leiste: reduced motion jumps between the ends at the hysteresis thresholds', () => {
  it('docks once past the threshold and stays docked inside the hysteresis band', () => {
    expect(nextStageDocked(false, 0)).toBeFalse();
    expect(nextStageDocked(false, STAGE_DOCK_PX)).toBeFalse();
    expect(nextStageDocked(false, STAGE_DOCK_PX + 1)).toBeTrue();
    // Scrolling back a little does not flutter the bar back into the stage.
    expect(nextStageDocked(true, STAGE_UNDOCK_PX + 1)).toBeTrue();
    expect(nextStageDocked(true, STAGE_UNDOCK_PX)).toBeFalse();
    // Between both thresholds an undocked bar stays staged.
    expect(nextStageDocked(false, STAGE_UNDOCK_PX + 10)).toBeFalse();
  });
});

describe('the plate back link', () => {
  const codex = AREA_ENTRIES.find((a) => a.id === 'codex')!;

  it('leads to the origin: the last crumb the page header published', () => {
    const back = plateBackOf(
      [
        { labelKey: 'nav.codex', link: ['/codex'] },
        { label: 'Schiffe', link: ['/codex', 'index'], queryParams: { kind: 'ship', mfr: 'AEGS' } },
      ],
      '/codex/ship/AEGS_Avenger',
      codex,
    );
    expect(back).toEqual({
      label: 'Schiffe',
      labelKey: null,
      labelParams: null,
      link: ['/codex', 'index'],
      queryParams: { kind: 'ship', mfr: 'AEGS' },
    });
  });

  it('falls back to the area root on a sub-page without crumbs, and to nothing on the root or outside an area', () => {
    expect(plateBackOf(null, '/codex/fps', codex)?.link).toBe('/codex');
    expect(plateBackOf(null, '/codex/fps', codex)?.labelKey).toBe('nav.codex');
    expect(plateBackOf([], '/codex', codex)).toBeNull();
    expect(plateBackOf(null, '/settings', null)).toBeNull();
  });
});
