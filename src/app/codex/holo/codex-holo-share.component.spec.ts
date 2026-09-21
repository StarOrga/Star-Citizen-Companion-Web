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

describe('CodexHoloShareComponent — wave 5 states', () => {
  let fixture: ComponentFixture<CodexHoloShareComponent>;

  function setup(): void {
    TestBed.configureTestingModule({
      imports: [CodexHoloShareComponent],
      providers: [
        provideTranslateService({}),
        { provide: HangarService, useValue: { createShareLink: async () => null, revokeShareLink: async () => true, refreshFollowedLoadout: async () => null } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloShareComponent);
    fixture.componentRef.setInput('shipClassName', 'AEGS_Gladius');
    fixture.componentRef.setInput('channel', 'LIVE');
    fixture.componentRef.setInput('patchVersion', '4.10');
  }

  it('confirms the copy on the button itself when the host reports linkCopied', () => {
    setup();
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button.link-copy')!;
    expect(btn.textContent).toContain('codex.holo.share.copyLink');
    fixture.componentRef.setInput('linkCopied', true);
    fixture.detectChanges();
    expect(btn.textContent).toContain('codex.holo.share.copied');
    expect(btn.classList.contains('done')).toBe(true);
  });

  it('signed out: explains why there is no hangar link instead of hiding it', () => {
    setup();
    fixture.componentRef.setInput('signedIn', false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('codex.holo.share.signInHint');
  });

  it('signed in but not in the hangar: offers "add to hangar" and emits it', () => {
    setup();
    fixture.componentRef.setInput('signedIn', true);
    fixture.componentRef.setInput('inHangar', false);
    fixture.detectChanges();
    let emitted = 0;
    fixture.componentInstance.addToHangar.subscribe(() => emitted++);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('codex.holo.share.notInHangarHint');
    (el.querySelector('.hangar-share button') as HTMLButtonElement).click();
    expect(emitted).toBe(1);
  });

  it('warns that unsaved draft changes are not part of a hangar link', () => {
    setup();
    fixture.componentRef.setInput('unsavedChanges', 2);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.unsaved')!.textContent).toContain('codex.holo.share.unsavedHint');
  });

  it('keeps a minted link when the host hands over a fresh object of the SAME config (after a save)', () => {
    setup();
    fixture.componentRef.setInput('config', config({ id: 'cfg-1' }));
    fixture.detectChanges();
    fixture.componentInstance.link.set({ id: 'l1', token: 'tok', configId: 'cfg-1', createdAt: '2026-01-01', revokedAt: null } as never);
    fixture.componentRef.setInput('config', config({ id: 'cfg-1', updatedAt: '2026-02-02' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.link()).not.toBeNull();
    fixture.componentRef.setInput('config', config({ id: 'cfg-2' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.link()).toBeNull();
  });

  it('forgets a minted link when the ship changes — a token never shows under another hull', () => {
    setup();
    fixture.detectChanges();
    fixture.componentInstance.link.set({ id: 'l1', token: 'tok', configId: 'cfg-1', createdAt: '2026-01-01', revokedAt: null } as never);
    fixture.componentRef.setInput('shipClassName', 'DRAK_Cutlass_Black');
    fixture.detectChanges();
    expect(fixture.componentInstance.link()).toBeNull();
  });
});
