import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloShareComponent } from './codex-holo-share.component';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShipConfig } from '../../hangar/hangar.types';

function config(over: Partial<HangarShipConfig>): HangarShipConfig {
  return {
    id: 'cfg-1',
    hangarShipId: 'ship-1',
    name: 'Standard',
    role: 'multipurpose',
    loadout: [],
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    sourceConfigId: null,
    followsOwner: false,
    ownerUserId: null,
    forkedAt: null,
    ownerName: null,
    ownerUpdatedAt: null,
    sharedChannel: null,
    sharedPatchVersion: null,
    ...over,
  };
}

describe('CodexHoloShareComponent', () => {
  let fixture: ComponentFixture<CodexHoloShareComponent>;
  let createShareLink: jasmine.Spy;
  let revokeShareLink: jasmine.Spy;
  let refreshFollowedLoadout: jasmine.Spy;

  function setup(): void {
    createShareLink = jasmine.createSpy('createShareLink');
    revokeShareLink = jasmine.createSpy('revokeShareLink');
    refreshFollowedLoadout = jasmine.createSpy('refreshFollowedLoadout');
    TestBed.configureTestingModule({
      imports: [CodexHoloShareComponent],
      providers: [
        provideTranslateService({}),
        { provide: HangarService, useValue: { createShareLink, revokeShareLink, refreshFollowedLoadout } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloShareComponent);
    fixture.componentRef.setInput('shipClassName', 'AEGS_Gladius');
    fixture.componentRef.setInput('channel', 'LIVE');
    fixture.componentRef.setInput('patchVersion', '4.10');
  }

  it('always renders the unchanged copy-link action and emits on click, even with no config', () => {
    setup();
    fixture.componentRef.setInput('config', null);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.link-copy') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    let emitted = false;
    fixture.componentInstance.copyCurrentLink.subscribe(() => (emitted = true));
    btn.click();
    expect(emitted).toBeTrue();
  });

  it('shows the followed-by hint and no create-link button for a config that still follows its owner', () => {
    setup();
    fixture.componentRef.setInput('config', config({ followsOwner: true, ownerName: 'Kestrel', ownerUpdatedAt: '2026-09-01' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.follow-hint')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.hangar-share')).toBeNull();
  });

  it('creates a hangar share link for an own config and shows copy + revoke actions', async () => {
    setup();
    createShareLink.and.returnValue(Promise.resolve({
      id: 'link-1', token: 'tok123', shipClassName: 'AEGS_Gladius', channel: 'LIVE', patchVersion: '4.10',
      loadout: [], configName: 'Standard', role: 'multipurpose', sourceConfigId: 'cfg-1',
      expiresAt: null, revokedAt: null, createdAt: '2026-09-01',
    }));
    fixture.componentRef.setInput('config', config({}));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.hangar-share button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(createShareLink).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.link-url')?.textContent).toContain('tok123');
    expect(fixture.nativeElement.querySelector('.actions button.danger')).toBeTruthy();
  });
});
