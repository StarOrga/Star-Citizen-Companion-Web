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

describe('CodexHoloPatchComponent', () => {
  let fixture: ComponentFixture<CodexHoloPatchComponent>;
  let buildsForChannel: jasmine.Spy;
  let shipDetailForBuild: jasmine.Spy;
  let isCollaborator: () => boolean;

  function setup(collaborator: boolean): void {
    buildsForChannel = jasmine.createSpy('buildsForChannel');
    shipDetailForBuild = jasmine.createSpy('shipDetailForBuild');
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

  it('marks a never-finalised build (zero entity count) as disabled in the picker', async () => {
    setup(false);
    buildsForChannel.and.returnValue(Promise.resolve([
      build({ id: 'finalised', patchVersion: '4.10', entityCounts: { ship: 5 } }),
      build({ id: 'draft', patchVersion: '4.11', entityCounts: {}, schemaVersion: 0 }),
    ]));
    fixture.nativeElement.querySelector('.patch-trigger').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.build-row');
    expect(rows.length).toBe(2);
    expect((rows[0] as HTMLButtonElement).disabled).toBeFalse();
    expect((rows[1] as HTMLButtonElement).disabled).toBeTrue();
    expect(rows[1].querySelector('.row-flag')).toBeTruthy();
  });

  it('hides the admin schema row for a plain viewer and shows it, labelled, for a collaborator', async () => {
    setup(false);
    buildsForChannel.and.returnValue(Promise.resolve([build({ id: 'finalised' })]));
    shipDetailForBuild.and.returnValue(Promise.resolve({
      classNameSlug: 'AEGS_Gladius',
      kind: 'ship',
      row: {},
      payload: {},
      ports: [],
      strings: [],
    }));
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
    buildsForChannel.and.returnValue(Promise.resolve([build({ id: 'finalised' })]));
    shipDetailForBuild.and.returnValue(Promise.resolve({
      classNameSlug: 'AEGS_Gladius',
      kind: 'ship',
      row: {},
      payload: {},
      ports: [],
      strings: [],
    }));
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
    expect(last['WeaponPort1'].unresolved).toBeTrue();

    // admin row appears for a collaborator once a build is picked
    expect(fixture.nativeElement.querySelector('.admin-schema-row')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.admin-flag')?.textContent).toContain('codex.holo.patch.adminOnly');
  });
});
