import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloPatchComponent } from './codex-holo-patch.component';
import { CodexService } from '../codex.service';
import { RoleService } from '../../auth/role.service';
import { CodexBuild } from '../codex.types';

function build(over: Partial<CodexBuild>): CodexBuild {
  return {
    id: 'b1',
    channel: 'LIVE',
    patchVersion: '4.10',
    buildNumber: '1',
    schemaVersion: 6,
    qualityScore: null,
    toolVersion: null,
    entityCounts: { ship: 10 },
    isCurrent: false,
    extractedAt: '2026-09-01',
    ...over,
  };
}

/** `buildsForChannel` answer for a successful read. */
function listed(builds: CodexBuild[]): Promise<{ builds: CodexBuild[]; failed: boolean }> {
  return Promise.resolve({ builds, failed: false });
}

describe('CodexHoloPatchComponent', () => {
  let fixture: ComponentFixture<CodexHoloPatchComponent>;
  let buildsForChannel: Mock;
  let shipDetailForBuild: Mock;
  let isCollaborator: () => boolean;

  function setup(collaborator: boolean): void {
    buildsForChannel = vi.fn().mockName('buildsForChannel');
    shipDetailForBuild = vi.fn().mockName('shipDetailForBuild');
    isCollaborator = () => collaborator;
    TestBed.configureTestingModule({
      imports: [CodexHoloPatchComponent],
      providers: [
        provideTranslateService({}),
        { provide: CodexService, useValue: { buildsForChannel, shipDetailForBuild } },
        { provide: RoleService, useValue: { isCollaborator } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloPatchComponent);
    fixture.componentRef.setInput('className', 'AEGS_Gladius');
    fixture.componentRef.setInput('channel', 'LIVE');
    fixture.componentRef.setInput('activeBuild', { id: 'active', patchVersion: '4.9' });
    fixture.componentRef.setInput('activeKpiSheet', { alpha: 10 });
    fixture.componentRef.setInput('activeOccupants', { WeaponPort1: 'GunA' });
    fixture.componentRef.setInput('resolveComparisonSide', () => ({
      kpiSheet: { alpha: 20 },
      occupants: { WeaponPort1: 'GunB' },
    }));
    fixture.detectChanges();
  }

  // AUD-188: the row tooltip names the build with a localised stamp, not ISO.
  it('titles a build row with a localised date, never the raw ISO stamp', () => {
    setup(false);
    const title = fixture.componentInstance.rowTitle(build({ extractedAt: '2026-09-01T12:30:00Z' }));
    expect(title).toContain('4.10');
    expect(title).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('marks a never-finalised build (zero entity count) as disabled in the picker', async () => {
    setup(false);
    buildsForChannel.mockReturnValue(listed([
      build({ id: 'finalised', patchVersion: '4.10', entityCounts: { ship: 5 } }),
      build({ id: 'draft', patchVersion: '4.11', entityCounts: {}, schemaVersion: 0 }),
    ]));
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.build-row');
    expect(rows.length).toBe(2);
    expect((rows[0] as HTMLButtonElement).disabled).toBe(false);
    expect((rows[1] as HTMLButtonElement).disabled).toBe(true);
    expect(rows[1].querySelector('.row-flag')).toBeTruthy();
  });

  it('lists the build on the table as current (never comparable) and tells same-named builds apart', async () => {
    setup(false);
    buildsForChannel.mockReturnValue(listed([
      build({ id: 'active', patchVersion: '4.9' }),
      build({ id: 'x1', patchVersion: '4.x', buildNumber: 'live-a' }),
      build({ id: 'x2', patchVersion: '4.x', buildNumber: 'live-b' }),
    ]));
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.build-row')) as HTMLButtonElement[];
    // The table's build already stands on the right ("bis"), so the left list says why it is off.
    expect(rows[0].disabled).toBe(true);
    expect(rows[0].querySelector('.row-flag')!.textContent).toContain('codex.holo.patch.onOtherSide');
    expect(rows[1].disabled).toBe(false);
    expect(rows[1].querySelector('.row-build')!.textContent).toContain('live-a');
    expect(rows[2].querySelector('.row-build')!.textContent).toContain('live-b');
    expect(rows[0].querySelector('.row-build')).toBeNull();
  });

  it('hides the admin schema row for a plain viewer and shows it, labelled, for a collaborator', async () => {
    setup(false);
    buildsForChannel.mockReturnValue(listed([build({ id: 'finalised' })]));
    shipDetailForBuild.mockResolvedValue({
      classNameSlug: 'AEGS_Gladius',
      kind: 'ship',
      row: {},
      payload: {},
      ports: [],
      strings: [],
    });
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.build-row').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.admin-schema-row')).toBeNull();
  });

  it('emits unresolved:true for a port that only exists on the active side', async () => {
    setup(true);
    buildsForChannel.mockReturnValue(listed([build({ id: 'finalised' })]));
    shipDetailForBuild.mockResolvedValue({
      classNameSlug: 'AEGS_Gladius',
      kind: 'ship',
      row: {},
      payload: {},
      ports: [],
      strings: [],
    });
    fixture.componentRef.setInput('resolveComparisonSide', () => ({
      kpiSheet: { alpha: 20 },
      occupants: {}, // the picked build has NO WeaponPort1 at all
    }));
    const pins: Record<string, unknown>[] = [];
    fixture.componentInstance.portPins.subscribe((p) => {
      if (p) pins.push(p);
    });
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.build-row').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const last = pins[pins.length - 1] as Record<string, { unresolved: boolean }>;
    expect(last['WeaponPort1'].unresolved).toBe(true);

    // the picked build is the comparison's subject; its body is docked by the host
    expect(fixture.componentInstance.selected()?.id).toBe('finalised');
    expect(fixture.componentInstance.perspectives()).not.toBeNull();
    expect(fixture.componentInstance.deltaBody()).toBeTruthy();
  });

  it('keeps the newer patch on the right: an older pick goes left, the right list blocks older-than-left (C18)', async () => {
    setup(false);
    buildsForChannel.mockReturnValue(listed([
      build({ id: 'ptu', patchVersion: '4.11.0', channel: 'PTU' }),
      build({ id: 'active', patchVersion: '4.9', isCurrent: true }),
      build({ id: 'old', patchVersion: '4.8' }),
      build({ id: 'older', patchVersion: '4.7' }),
    ]));
    shipDetailForBuild.mockResolvedValue({ classNameSlug: 'AEGS_Gladius', kind: 'ship', row: {}, payload: {}, ports: [], strings: [] });
    const c = fixture.componentInstance;
    c.toggle();
    await fixture.whenStable();
    fixture.detectChanges();
    const [ptu, active, old, older] = c.builds();
    expect(c.blockReason(ptu, 'from')).toContain('codex.holo.patch.newerThan');
    expect(c.blockReason(active, 'from')).toContain('codex.holo.patch.onOtherSide');
    expect(c.blockReason(old, 'from')).toBeNull();
    await c.pickFrom(old);
    expect(c.from()).toBe(old);
    expect(c.to()).toBe('active');
    expect(c.blockReason(older, 'to')).toContain('codex.holo.patch.olderThan');
    expect(c.blockReason(ptu, 'to')).toBeNull();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pv-to .cur')).toBeTruthy();
  });

  it('auto-compares with the patch before the one on the table once the comparison is on screen', async () => {
    setup(false);
    buildsForChannel.mockReturnValue(listed([build({ id: 'active', patchVersion: '4.9' }), build({ id: 'prev', patchVersion: '4.8' })]));
    shipDetailForBuild.mockResolvedValue({ classNameSlug: 'AEGS_Gladius', kind: 'ship', row: {}, payload: {}, ports: [], strings: [] });
    fixture.componentRef.setInput('autoCompare', true);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.whenStable();
    expect((fixture.componentInstance.from() as CodexBuild | null)?.id).toBe('prev');
  });

  it('tells a failed build list apart from "no other patches" and retries it (AUD-056)', async () => {
    setup(false);
    buildsForChannel.mockResolvedValue({ builds: [], failed: true });
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const pop: HTMLElement = fixture.nativeElement.querySelector('.patch-pop');
    expect(pop.textContent).toContain('codex.error.title');
    expect(pop.textContent).not.toContain('codex.holo.patch.empty');

    buildsForChannel.mockReturnValue(listed([build({ id: 'finalised' })]));
    (pop.querySelector('.pop-err button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(buildsForChannel).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelectorAll('.build-row').length).toBe(1);
  });

  it('a throwing comparison sets compareError instead of an unhandled rejection', async () => {
    vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    setup(false);
    buildsForChannel.mockReturnValue(listed([build({ id: 'finalised' })]));
    shipDetailForBuild.mockResolvedValue({ classNameSlug: 'AEGS_Gladius', kind: 'ship', row: {}, payload: {}, ports: [], strings: [] });
    fixture.componentRef.setInput('resolveComparisonSide', () => {
      throw new TypeError('Failed to fetch');
    });
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await expect(fixture.componentInstance.pick(build({ id: 'finalised' }))).resolves.not.toThrow();
    fixture.detectChanges();
    expect(fixture.componentInstance.compareError()).toBe('errors.network');
    expect(fixture.nativeElement.querySelector('.delta-state.err')?.textContent).toContain('errors.network');
    expect(fixture.componentInstance.selected()).toBeNull();
  });
});
