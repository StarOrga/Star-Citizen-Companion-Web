import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloShareComponent, reusableShareLink } from './codex-holo-share.component';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShareLink, HangarShipConfig } from '../../hangar/hangar.types';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { CodexHoloForkGuard } from './codex-holo-fork-guard';

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

function link(over: Partial<HangarShareLink>): HangarShareLink {
  return {
    id: 'link-1', token: 'tok123456789', shipClassName: 'AEGS_Gladius', channel: 'LIVE', patchVersion: '4.10',
    loadout: [], configName: 'Standard', role: 'multipurpose', sourceConfigId: 'cfg-1',
    expiresAt: null, revokedAt: null, createdAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

const LASER = { portName: 'hardpoint_weapon_left', className: 'KLWE_LaserRepeater_S3', kind: 'weapon' };

describe('reusableShareLink (#645)', () => {
  it('reuses the NEWEST active link whose snapshot matches the config', () => {
    const old = link({ id: 'old', createdAt: '2026-09-01T00:00:00Z', loadout: [LASER] });
    const fresh = link({ id: 'fresh', createdAt: '2026-09-05T00:00:00Z', loadout: [LASER] });
    expect(reusableShareLink([old, fresh], config({ loadout: [LASER] }), 'LIVE', '4.10')?.id).toBe('fresh');
  });

  it('never reuses a link whose snapshot predates a changed loadout, another patch or a revoke', () => {
    const l = link({ loadout: [] });
    expect(reusableShareLink([l], config({ loadout: [LASER] }), 'LIVE', '4.10')).toBeNull();
    expect(reusableShareLink([link({ loadout: [LASER] })], config({ loadout: [LASER] }), 'LIVE', '4.11')).toBeNull();
    expect(reusableShareLink([link({ loadout: [LASER], revokedAt: '2026-09-02' })], config({ loadout: [LASER] }), 'LIVE', '4.10')).toBeNull();
    expect(reusableShareLink([], config({}), 'LIVE', '4.10')).toBeNull();
  });
});

describe('CodexHoloShareComponent', () => {
  let fixture: ComponentFixture<CodexHoloShareComponent>;
  let createShareLink: jasmine.Spy;
  let revokeShareLink: jasmine.Spy;
  let refreshFollowedLoadout: jasmine.Spy;
  let listShareLinks: jasmine.Spy;
  let confirm: jasmine.Spy;
  let ensureEditable: jasmine.Spy;
  let calls: string[];

  function setup(): void {
    calls = [];
    createShareLink = jasmine.createSpy('createShareLink').and.callFake(async () => {
      calls.push('create');
      return link({ id: 'new', token: 'newtoken0001' });
    });
    revokeShareLink = jasmine.createSpy('revokeShareLink').and.resolveTo(true);
    refreshFollowedLoadout = jasmine.createSpy('refreshFollowedLoadout');
    listShareLinks = jasmine.createSpy('listShareLinks').and.callFake(async () => {
      calls.push('list');
      return [];
    });
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    ensureEditable = jasmine.createSpy('ensureEditable').and.resolveTo('forked');
    TestBed.configureTestingModule({
      imports: [CodexHoloShareComponent],
      providers: [
        provideTranslateService({}),
        { provide: HangarService, useValue: { createShareLink, revokeShareLink, refreshFollowedLoadout, listShareLinks } },
        { provide: ScConfirmService, useValue: { confirm } },
        { provide: CodexHoloForkGuard, useValue: { ensureEditable } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloShareComponent);
    fixture.componentRef.setInput('shipClassName', 'AEGS_Gladius');
    fixture.componentRef.setInput('channel', 'LIVE');
    fixture.componentRef.setInput('patchVersion', '4.10');
    fixture.componentRef.setInput('signedIn', true);
    fixture.componentRef.setInput('inHangar', true);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('always renders the copy-link action (with its L key) and emits on click, even with no config', () => {
    setup();
    fixture.componentRef.setInput('config', null);
    fixture.componentRef.setInput('copyHotkey', 'L');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.link-copy') as HTMLButtonElement;
    expect(btn.querySelector('kbd')?.textContent).toBe('L');
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('L');
    let emitted = false;
    fixture.componentInstance.copyCurrentLink.subscribe(() => (emitted = true));
    btn.click();
    expect(emitted).toBeTrue();
  });

  it('lists the config\'s active links with created-at, copy and revoke', async () => {
    setup();
    listShareLinks.and.resolveTo([link({ id: 'a' }), link({ id: 'b', token: 'second000001' })]);
    fixture.componentRef.setInput('config', config({}));
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(listShareLinks).toHaveBeenCalledWith('cfg-1');
    expect(el.querySelectorAll('.link-row').length).toBe(2);
    expect(el.querySelector('.lr-date')?.textContent?.trim()).not.toBe('');
    expect(el.querySelector('.link-row .copy')).toBeTruthy();
    expect(el.querySelector('.link-row .revoke')).toBeTruthy();
  });

  it('a failed link list is an error with retry — never "no links"', async () => {
    setup();
    listShareLinks.and.rejectWith({ message: 'Failed to fetch' });
    fixture.componentRef.setInput('config', config({}));
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.links-err')).toBeTruthy();
    listShareLinks.and.resolveTo([link({})]);
    (el.querySelector('.links-err button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelectorAll('.link-row').length).toBe(1);
  });

  it('Save & share saves the draft BEFORE it asks for links, then mints and copies', async () => {
    setup();
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    const saved = config({ loadout: [LASER], updatedAt: '2026-10-08' });
    const saveDraft = jasmine.createSpy('saveDraft').and.callFake(async () => {
      calls.push('save');
      return saved;
    });
    fixture.componentRef.setInput('config', config({}));
    fixture.componentRef.setInput('unsavedChanges', 1);
    fixture.componentRef.setInput('saveDraft', saveDraft);
    await settle();
    calls.length = 0; // the initial list load
    const btn = fixture.nativeElement.querySelector('.save-share') as HTMLButtonElement;
    expect(btn.textContent).toContain('codex.holo.share.saveAndShare');
    btn.click();
    await settle();
    expect(calls).toEqual(['save', 'list', 'create']);
    expect(createShareLink).toHaveBeenCalledWith(saved, 'AEGS_Gladius', 'LIVE', '4.10');
    expect(write).toHaveBeenCalledWith(`${location.origin}/hangar/shared/newtoken0001`);
  });

  it('reuses the newest matching link instead of minting a duplicate', async () => {
    setup();
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    const existing = link({ id: 'keep', token: 'keeptoken001', loadout: [] });
    listShareLinks.and.resolveTo([existing]);
    fixture.componentRef.setInput('config', config({}));
    await settle();
    (fixture.nativeElement.querySelector('.save-share') as HTMLButtonElement).click();
    await settle();
    expect(createShareLink).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${location.origin}/hangar/shared/keeptoken001`);
  });

  it('a failed or declined save mints nothing', async () => {
    setup();
    fixture.componentRef.setInput('config', config({}));
    fixture.componentRef.setInput('unsavedChanges', 2);
    fixture.componentRef.setInput('saveDraft', async () => null);
    await settle();
    listShareLinks.calls.reset();
    (fixture.nativeElement.querySelector('.save-share') as HTMLButtonElement).click();
    await settle();
    expect(listShareLinks).not.toHaveBeenCalled();
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('a followed config goes through the fork guard first; declining shares nothing', async () => {
    setup();
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    fixture.componentRef.setInput('config', config({ followsOwner: true, ownerName: 'Kestrel', ownerUpdatedAt: '2026-09-01' }));
    await settle();
    expect(fixture.nativeElement.querySelector('.follow-hint')).toBeTruthy();
    expect(listShareLinks).not.toHaveBeenCalled(); // a following copy has no links of its own

    ensureEditable.and.resolveTo('cancelled');
    (fixture.nativeElement.querySelector('.save-share') as HTMLButtonElement).click();
    await settle();
    expect(createShareLink).not.toHaveBeenCalled();

    ensureEditable.and.resolveTo('forked');
    let refreshed: HangarShipConfig | null = null;
    fixture.componentInstance.configRefreshed.subscribe((c) => (refreshed = c));
    (fixture.nativeElement.querySelector('.save-share') as HTMLButtonElement).click();
    await settle();
    expect(refreshed!.followsOwner).toBeFalse();
    expect(createShareLink).toHaveBeenCalled();
  });

  it('revoke asks first in the app dialog (danger tone) and only then revokes', async () => {
    setup();
    listShareLinks.and.resolveTo([link({ id: 'r1' })]);
    fixture.componentRef.setInput('config', config({}));
    await settle();
    confirm.and.resolveTo(false);
    (fixture.nativeElement.querySelector('.link-row .revoke') as HTMLButtonElement).click();
    await settle();
    expect(confirm).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
    expect(revokeShareLink).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.link-row').length).toBe(1);

    confirm.and.resolveTo(true);
    (fixture.nativeElement.querySelector('.link-row .revoke') as HTMLButtonElement).click();
    await settle();
    expect(revokeShareLink).toHaveBeenCalledWith('r1');
    expect(fixture.nativeElement.querySelectorAll('.link-row').length).toBe(0);
  });

  it('says so when the clipboard refuses the copy (AUD-312)', async () => {
    spyOn(console, 'warn');
    setup();
    listShareLinks.and.resolveTo([link({})]);
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new DOMException('denied', 'NotAllowedError'));
    fixture.componentRef.setInput('config', config({}));
    await settle();
    expect(fixture.nativeElement.querySelector('.copy-failed')).toBeNull();
    (fixture.nativeElement.querySelector('.link-row .copy') as HTMLButtonElement).click();
    // Not whenStable(): that would also wait out the 3 s hide timer.
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.copy-failed')?.textContent).toContain('codex.holo.share.copyFailed');
  });

  it('read-only (a shared link on the table): no hangar share at all', async () => {
    setup();
    fixture.componentRef.setInput('config', config({}));
    fixture.componentRef.setInput('readOnly', true);
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.read-only')).toBeTruthy();
    expect(el.querySelector('.save-share')).toBeNull();
    expect(listShareLinks).not.toHaveBeenCalled();
  });

  it('forgets the links when the ship changes — a token never shows under another hull', async () => {
    setup();
    listShareLinks.and.resolveTo([link({})]);
    fixture.componentRef.setInput('config', config({}));
    await settle();
    expect(fixture.componentInstance.links().length).toBe(1);
    listShareLinks.and.resolveTo([]);
    fixture.componentRef.setInput('shipClassName', 'DRAK_Cutlass_Black');
    fixture.componentRef.setInput('config', config({ id: 'cfg-2' }));
    await settle();
    expect(fixture.componentInstance.links().length).toBe(0);
  });

  it('keeps the list when the host hands over a fresh object of the SAME config (after a save)', async () => {
    setup();
    listShareLinks.and.resolveTo([link({})]);
    fixture.componentRef.setInput('config', config({ id: 'cfg-1' }));
    await settle();
    listShareLinks.calls.reset();
    fixture.componentRef.setInput('config', config({ id: 'cfg-1', updatedAt: '2026-02-02' }));
    await settle();
    expect(listShareLinks).not.toHaveBeenCalled();
    expect(fixture.componentInstance.links().length).toBe(1);
  });
});

describe('CodexHoloShareComponent — wave 5 states', () => {
  let fixture: ComponentFixture<CodexHoloShareComponent>;

  function setup(): void {
    TestBed.configureTestingModule({
      imports: [CodexHoloShareComponent],
      providers: [
        provideTranslateService({}),
        { provide: HangarService, useValue: { createShareLink: async () => null, revokeShareLink: async () => true, refreshFollowedLoadout: async () => null, listShareLinks: async () => [] } },
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

  it('signed in, no config, unsaved changes: Save & share is offered (the save creates the config)', () => {
    setup();
    fixture.componentRef.setInput('signedIn', true);
    fixture.componentRef.setInput('inHangar', false);
    fixture.componentRef.setInput('unsavedChanges', 2);
    fixture.componentRef.setInput('saveDraft', async () => null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.save-share')).toBeTruthy();
  });

  it('warns that unsaved draft changes are not part of a hangar link', () => {
    setup();
    fixture.componentRef.setInput('unsavedChanges', 2);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.unsaved')!.textContent).toContain('codex.holo.share.unsavedHint');
  });
});
