import {
  AREA_ENTRIES,
  STAGE_DOCK_PX,
  STAGE_UNDOCK_PX,
  nextStageDocked,
  pageOwnsStageSlot,
  plateBackOf,
  stageMorphOf,
} from './fusion-bar.model';

describe('Gleiche Leiste: the stage dock state machine', () => {
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

  it('plays the morph once per crossing, in the direction of the crossing', () => {
    expect(stageMorphOf(false, true)).toBe('dock');
    expect(stageMorphOf(true, false)).toBe('undock');
    expect(stageMorphOf(true, true)).toBeNull();
    expect(stageMorphOf(false, false)).toBeNull();
  });

  it('knows which main pages bring their own stage slot', () => {
    expect(pageOwnsStageSlot('/verse')).toBeTrue();
    expect(pageOwnsStageSlot('/codex?q=x')).toBeTrue();
    expect(pageOwnsStageSlot('/hq')).toBeFalse();
    expect(pageOwnsStageSlot('/admin/hub')).toBeFalse();
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
